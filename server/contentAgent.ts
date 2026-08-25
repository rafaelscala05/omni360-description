// Backend for the "Agência de Criação de Conteúdo" (Alfred) module.
//
// Unlike the Product agent (which runs AI in the browser via Firebase AI Logic),
// the content pipeline runs server-side so it can execute autonomously on a
// schedule — without the user's browser open. AI calls use @google/genai in
// Vertex AI mode (VERTEX_PROJECT_ID/VERTEX_LOCATION, project-based auth via
// ADC — mirrors the Veo client in videoAgent.ts), not the Gemini Developer
// API/AI Studio key; persistence + credit debit use the Admin SDK.

import type express from 'express';
import crypto from 'crypto';
import * as cheerio from 'cheerio';
import sharp from 'sharp';
import { GoogleGenAI } from '@google/genai';
import { adminDb, adminStorage } from './firebaseAdmin';
import { CREDIT_ACTIONS, resolveCreditCost, type CreditAction } from '../src/credits';
import firebaseAppletConfig from '../firebase-applet-config.json';
import { assertSafeUrl, fetchHtmlSafely } from './safeUrl';

const STORAGE_BUCKET = firebaseAppletConfig.storageBucket;
import type {
  ContentProject,
  ContentCluster,
  ClusterKeyword,
  CalendarArticle,
  ArticleStage,
  ArticleSize,
} from '../src/modules/content/types';
import type { BlogPost, BlogPostProduct, BlogSettings, BlogDomainDoc } from '../src/modules/content/blog/types';
import { slugify, uniqueSlug } from '../src/modules/content/blog/slug';
import { markdownToHtml } from '../src/modules/content/markdown';
import * as seRanking from './seRankingClient';
import { getLatestFinishedAudit, auditSummaryText, omitUndefined } from './seoAgent';
import { loadStoreContext, extractSeedKeywords, discoverKeywordPool } from './keywordDiscovery';
import { logPublishCall } from './contentTelemetry';

const TEXT_MODEL = 'gemini-2.5-flash';
const IMAGE_MODEL = 'gemini-2.5-flash-image';

// Word-count target per article size, used in Stage 3 (Draft) of the pipeline.
const ARTICLE_SIZE_WORD_RANGES: Record<ArticleSize, [number, number]> = {
  curto: [600, 900],
  medio: [1200, 1800],
  longo: [2200, 3000],
};

const VERTEX_PROJECT = process.env.VERTEX_PROJECT_ID || firebaseAppletConfig.projectId;
const VERTEX_LOCATION = process.env.VERTEX_LOCATION || 'us-central1';

function getClient(): GoogleGenAI {
  if (!VERTEX_PROJECT) {
    throw Object.assign(new Error('VERTEX_PROJECT_ID não configurado no servidor'), { status: 500 });
  }
  return new GoogleGenAI({ vertexai: true, project: VERTEX_PROJECT, location: VERTEX_LOCATION });
}

// Retries transient 503/UNAVAILABLE/high-demand errors with linear backoff
// (mirrors src/services/aiService.ts withRetry).
async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error;
      const msg = error instanceof Error ? error.message : String(error);
      const is503 =
        msg.includes('503') ||
        msg.includes('UNAVAILABLE') ||
        msg.includes('high demand') ||
        msg.includes('temporarily');
      if (is503 && attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, attempt * 1000));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

// Tolerant JSON parser: strips markdown fences, falls back to first {...}/[...] block.
function parseJson<T = unknown>(text: string): T {
  let cleaned = (text || '').trim();
  cleaned = cleaned.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    return JSON.parse(cleaned || '{}');
  } catch {
    const match = cleaned.match(/[[{][\s\S]*[\]}]/);
    if (match) return JSON.parse(match[0]);
    throw new Error('A IA não retornou um JSON válido.');
  }
}

interface GenOptions {
  systemInstruction?: string;
  temperature?: number;
  json?: boolean;
}

// Plain text/JSON generation.
async function generateText(prompt: string, options: GenOptions = {}): Promise<string> {
  const ai = getClient();
  const resp = await withRetry(() =>
    ai.models.generateContent({
      model: TEXT_MODEL,
      contents: prompt,
      config: {
        systemInstruction: options.systemInstruction,
        temperature: options.temperature,
        ...(options.json ? { responseMimeType: 'application/json' } : {}),
      },
    }),
  );
  return resp.text ?? '';
}

// Grounded generation using the Google Search tool (for fresh, factual research).
// responseMimeType is intentionally NOT set — grounding frequently ignores it.
async function generateGrounded(prompt: string, options: GenOptions = {}): Promise<string> {
  const ai = getClient();
  const resp = await withRetry(() =>
    ai.models.generateContent({
      model: TEXT_MODEL,
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        systemInstruction: options.systemInstruction,
        temperature: options.temperature,
      },
    }),
  );
  return resp.text ?? '';
}

// Generates a cover image, returns raw base64 PNG cropped to COVER_IMAGE_ASPECT_RATIO
// (the model doesn't reliably honor the aspect ratio requested in the prompt).
// When referenceImage is given, sends it as an inlineData part alongside the
// prompt so the model anchors the new image on it (image-to-image), same
// multi-part pattern as generateImage() in src/services/aiService.ts.
const COVER_IMAGE_ASPECT_RATIO = 16 / 9;

async function generateImageBase64(
  prompt: string,
  referenceImage?: { mimeType: string; data: string },
): Promise<string> {
  const ai = getClient();
  const contents = referenceImage
    ? [{ inlineData: { mimeType: referenceImage.mimeType, data: referenceImage.data } }, { text: prompt }]
    : prompt;
  const resp = await withRetry(() =>
    ai.models.generateContent({
      model: IMAGE_MODEL,
      contents: contents as never,
      config: { responseModalities: ['TEXT', 'IMAGE'] },
    }),
  );
  for (const candidate of resp.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      const data = (part as { inlineData?: { data?: string } }).inlineData?.data;
      if (data) return cropToAspectRatio(Buffer.from(data, 'base64'), COVER_IMAGE_ASPECT_RATIO);
    }
  }
  throw new Error('O modelo não retornou uma imagem.');
}

// Center-crops an image buffer to the given w/h ratio via sharp, returns base64 PNG.
async function cropToAspectRatio(buffer: Buffer, ratio: number): Promise<string> {
  const meta = await sharp(buffer).metadata();
  const srcW = meta.width ?? 0;
  const srcH = meta.height ?? 0;
  if (!srcW || !srcH) return buffer.toString('base64');

  const srcRatio = srcW / srcH;
  let cropW = srcW;
  let cropH = srcH;
  if (srcRatio > ratio) {
    cropW = Math.round(srcH * ratio);
  } else {
    cropH = Math.round(srcW / ratio);
  }
  const left = Math.round((srcW - cropW) / 2);
  const top = Math.round((srcH - cropH) / 2);

  const cropped = await sharp(buffer)
    .extract({ left, top, width: cropW, height: cropH })
    .png()
    .toBuffer();
  return cropped.toString('base64');
}

// Persists a base64 image to Firebase Storage and returns a permanent download
// URL. App Hosting instances have an ephemeral, per-instance filesystem, so
// writing to local disk (the previous approach) lost images on every deploy,
// restart, or scale-out — mirrors the pattern already used for videos in
// videoAgent.ts.
async function saveImage(base64: string, uid: string, articleId: string): Promise<string> {
  const bucket = adminStorage.bucket(STORAGE_BUCKET);
  const storagePath = `content-images/${uid}/${articleId}/${Date.now()}.png`;
  const downloadToken = crypto.randomUUID();
  await bucket.file(storagePath).save(Buffer.from(base64, 'base64'), {
    contentType: 'image/png',
    metadata: {
      cacheControl: 'public, max-age=31536000',
      metadata: { firebaseStorageDownloadTokens: downloadToken },
    },
  });
  return `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o/${encodeURIComponent(storagePath)}?alt=media&token=${downloadToken}`;
}

// ---------------------------------------------------------------------------
// Credit debit (Admin SDK) — mirrors consumeCredit() in src/App.tsx, but runs
// server-side so the autonomous pipeline can charge without a browser.
// ---------------------------------------------------------------------------

async function getCreditCosts(): Promise<Record<string, number>> {
  try {
    const snap = await adminDb.collection('config').doc('credits').get();
    const data = snap.exists ? snap.data() : null;
    return (data?.costs as Record<string, number>) ?? {};
  } catch {
    return {};
  }
}

interface DebitMeta {
  productName?: string;
  sku?: string;
  userName?: string;
}

async function debitCreditsAdmin(uid: string, action: CreditAction, meta: DebitMeta = {}): Promise<number> {
  const costs = await getCreditCosts();
  const cost = resolveCreditCost(costs, action.key);
  const userRef = adminDb.collection('users').doc(uid);

  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    if (!snap.exists) throw new Error('Usuário não encontrado.');
    const current = snap.data()?.credits ?? 0;
    if (current < cost) throw Object.assign(new Error('INSUFFICIENT_CREDITS'), { status: 402 });

    const next = current - cost;
    tx.update(userRef, { credits: next });
    const logRef = userRef.collection('credit_logs').doc();
    tx.set(logRef, {
      actionType: action.label,
      actionKey: action.key,
      productName: meta.productName ?? 'N/A',
      sku: meta.sku ?? 'N/A',
      userName: meta.userName ?? '',
      creditsConsumed: cost,
      timestamp: new Date().toISOString(),
    });
    return next;
  });
}

// ---------------------------------------------------------------------------
// Firestore helpers
// ---------------------------------------------------------------------------

function projectRef(uid: string, projectId: string) {
  return adminDb.collection('users').doc(uid).collection('contentProjects').doc(projectId);
}

async function loadProject(uid: string, projectId: string): Promise<ContentProject> {
  const snap = await projectRef(uid, projectId).get();
  if (!snap.exists) throw Object.assign(new Error('Projeto não encontrado'), { status: 404 });
  return { id: snap.id, ...(snap.data() as Omit<ContentProject, 'id'>) };
}

// publicoAlvo migrated from string → string[]; tolerate both shapes.
function asList(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter(Boolean) as string[];
  if (typeof v === 'string' && v.trim()) return [v.trim()];
  return [];
}

function systemFor(project: ContentProject): string {
  const c = project.config;
  const publico = asList(c.publicoAlvo);
  return [
    'Você é Alfred, um agente sênior de marketing de conteúdo.',
    `Empresa: ${c.nomeEmpresa}. ${c.descricao}`,
    `Produto/serviço principal: ${c.produtoServico}.`,
    publico.length ? `Público-alvo: ${publico.join(', ')}.` : '',
    `Tom de voz: ${c.tomDeVoz}.`,
    c.objetivos?.length ? `Objetivos: ${c.objetivos.join(', ')}.` : '',
    c.palavrasChave?.length ? `Palavras-chave alvo: ${c.palavrasChave.join(', ')}.` : '',
    'Escreva sempre em português do Brasil.',
  ]
    .filter(Boolean)
    .join('\n');
}

// ---------------------------------------------------------------------------
// Onboarding aid — analyze a website with AI and pre-fill the config
// ---------------------------------------------------------------------------

export interface ScannedConfig {
  nomeEmpresa?: string;
  descricao?: string;
  produtoServico?: string;
  publicoAlvo?: string[];
  tomDeVoz?: string;
  objetivos?: string[];
  palavrasChave?: string[];
}

// Fetches a website, extracts readable text, and asks the AI to infer the
// company profile so the onboarding form can be pre-filled.
async function scanWebsite(rawUrl: string): Promise<ScannedConfig> {
  const url = await assertSafeUrl(rawUrl);
  const html = await fetchHtmlSafely(rawUrl);

  // Extract a compact, readable digest of the page.
  const $ = cheerio.load(html);
  $('script, style, noscript, svg').remove();
  const title = $('title').first().text().trim();
  const metaDesc = $('meta[name="description"]').attr('content')?.trim() ?? '';
  const headings = $('h1, h2, h3').map((_, el) => $(el).text().trim()).get().filter(Boolean).slice(0, 30);
  const bodyText = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 6000);
  const digest = [
    `URL: ${url.toString()}`,
    title && `Título: ${title}`,
    metaDesc && `Meta description: ${metaDesc}`,
    headings.length && `Cabeçalhos: ${headings.join(' | ')}`,
    `Conteúdo: ${bodyText}`,
  ].filter(Boolean).join('\n');

  const prompt = [
    'Analise o conteúdo do site abaixo e infira o perfil da empresa para marketing de conteúdo.',
    'Responda ESTRITAMENTE em JSON com as chaves:',
    '{"nomeEmpresa":"","descricao":"","produtoServico":"","publicoAlvo":["..."],"tomDeVoz":"","objetivos":["..."],"palavrasChave":["..."]}',
    '- publicoAlvo: 2 a 5 personas/segmentos curtos.',
    '- tomDeVoz: uma ou duas palavras (ex.: "técnico e confiável").',
    '- objetivos: 2 a 4 objetivos de conteúdo plausíveis.',
    '- palavrasChave: 4 a 8 termos relevantes.',
    'Use português do Brasil. Se algo não for inferível, deixe vazio.',
    '',
    digest,
  ].join('\n');

  const text = await generateText(prompt, { json: true, temperature: 0.4 });
  const parsed = parseJson<ScannedConfig>(text);
  return {
    nomeEmpresa: parsed.nomeEmpresa ?? '',
    descricao: parsed.descricao ?? '',
    produtoServico: parsed.produtoServico ?? '',
    publicoAlvo: Array.isArray(parsed.publicoAlvo) ? parsed.publicoAlvo : [],
    tomDeVoz: parsed.tomDeVoz ?? '',
    objetivos: Array.isArray(parsed.objetivos) ? parsed.objetivos : [],
    palavrasChave: Array.isArray(parsed.palavrasChave) ? parsed.palavrasChave : [],
  };
}

// ---------------------------------------------------------------------------
// Fase 2 — Clusters
// ---------------------------------------------------------------------------

const SEARCH_INTENTS: ReadonlyArray<ClusterKeyword['intencao']> = ['informacional', 'comercial', 'transacional', 'navegacional'];

function normalizeIntent(v: unknown): ClusterKeyword['intencao'] {
  const s = String(v ?? '').toLowerCase();
  return (SEARCH_INTENTS as readonly string[]).includes(s) ? (s as ClusterKeyword['intencao']) : 'informacional';
}

// Below this many real candidates, the Domain Analysis pool (what the site
// already ranks for) is too thin to build 4-6 clusters on its own — usually a
// brand-new domain with little/no organic footprint yet.
const MIN_DOMAIN_POOL_SIZE = 5;

async function generateClusters(uid: string, project: ContentProject): Promise<ContentCluster[]> {
  const store = await loadStoreContext(uid);
  const audit = await getLatestFinishedAudit(uid, project.id);
  const auditSummary = audit ? auditSummaryText(audit) : null;

  // Primary source: real keywords from the Domain Analysis run during the
  // "Setup do Cliente" auditing step (what the domain ranks for + gaps vs. a
  // named competitor). Only fall back to expanding product/category names via
  // SE Ranking's related/similar/longtail when that pool is too thin.
  let pool = audit?.keywordPool ?? [];
  if (pool.length < MIN_DOMAIN_POOL_SIZE) {
    const seeds = extractSeedKeywords(project, store);
    pool = seRanking.mergeKeywordCandidates([pool, await discoverKeywordPool(seeds)]);
  }

  const poolByTerm = new Map(pool.map((k) => [k.termo.trim().toLowerCase(), k]));
  const poolText = pool
    .map((k) => `${k.termo} — ${k.volume ?? '?'} buscas/mês — intenção: ${k.intencao}`)
    .join('\n');

  const prompt = [
    'Você recebeu uma lista real de palavras-chave (com volume de busca mensal e intenção) pesquisada para o segmento da empresa.',
    'Agrupe essas palavras-chave em 4 a 6 clusters temáticos estratégicos de conteúdo.',
    store.text ? `Contexto da loja:\n${store.text}` : '',
    auditSummary ? `Auditoria de SEO do site:\n${auditSummary}` : '',
    poolText ? `Palavras-chave pesquisadas (termo — volume/mês — intenção):\n${poolText}` : '',
    'Para cada cluster, forneça:',
    '- "nome": o TEMA PRINCIPAL do cluster (curto).',
    '- "estrategia": uma descrição do tema abordado e por que importa (2 a 3 frases).',
    '- "palavrasChave": de 5 a 10 palavras-chave ESCOLHIDAS PRIORITARIAMENTE DA LISTA ACIMA (copie o "termo" exatamente como aparece, para preservar o volume real), cada uma com sua "intencao".',
    'Só proponha um termo fora da lista se for estritamente necessário para cobrir um tema relevante do negócio que a lista não cobriu.',
    'Não repita a mesma palavra-chave em mais de um cluster.',
    'A "intencao" deve ser uma de: "informacional", "comercial", "transacional", "navegacional".',
    'NÃO gere ideias de artigos.',
    'Responda ESTRITAMENTE em JSON no formato:',
    '[{"nome":"...","estrategia":"...","palavrasChave":[{"termo":"...","intencao":"informacional"}]}]',
  ]
    .filter(Boolean)
    .join('\n\n');

  const text = await generateGrounded(prompt, { systemInstruction: systemFor(project), temperature: 0.7 });
  const raw = parseJson<Array<{ nome: string; estrategia: string; palavrasChave: Array<{ termo: string; intencao: string }> }>>(text);

  // Resolve each keyword's real volume/intention: prefer the discovered pool
  // (real data); anything the AI proposed outside the pool is an "orphan" and
  // gets a single batched backfill call before persisting.
  const allRaw = raw.flatMap((c) => (Array.isArray(c.palavrasChave) ? c.palavrasChave.filter((k) => k?.termo) : []));
  const orphanTerms = Array.from(
    new Set(
      allRaw
        .map((k) => k.termo.trim())
        .filter((termo) => termo && !poolByTerm.has(termo.toLowerCase())),
    ),
  );
  const orphanMetrics = orphanTerms.length ? await seRanking.getKeywordsMetrics(orphanTerms) : {};

  // Preserva TODOS os campos reais da SE Ranking (volume, cpc, dificuldade,
  // competição, posição, tráfego, origem) — só o termo/intenção é reescrito
  // quando não há dado real algum para o termo (proposta livre da IA).
  const resolveKeyword = (k: { termo: string; intencao: string }): ClusterKeyword => {
    const termo = k.termo.trim();
    const pooled = poolByTerm.get(termo.toLowerCase());
    if (pooled) return pooled;
    const metrics = orphanMetrics[termo];
    return metrics ?? { termo, intencao: normalizeIntent(k.intencao) };
  };

  const now = new Date().toISOString();
  const batch = adminDb.batch();
  const col = projectRef(uid, project.id).collection('clusters');
  const created: ContentCluster[] = raw.map((c) => {
    const ref = col.doc();
    const cluster: ContentCluster = {
      id: ref.id,
      nome: c.nome ?? 'Tema',
      estrategia: c.estrategia ?? '',
      palavrasChave: Array.isArray(c.palavrasChave) ? c.palavrasChave.filter((k) => k?.termo).map(resolveKeyword) : [],
      aprovado: false,
      excluido: false,
      createdAt: now,
    };
    const { id, ...data } = cluster;
    batch.set(ref, omitUndefined(data));
    return cluster;
  });
  await batch.commit();
  return created;
}

// ---------------------------------------------------------------------------
// Fase 3 — Calendar
// ---------------------------------------------------------------------------

// Parses "2x por semana" / "4x por mês" / "semanal" into an interval in days.
function frequencyToIntervalDays(freq: string): number {
  const f = (freq || '').toLowerCase();
  const num = parseInt(f.match(/(\d+)/)?.[1] ?? '', 10);
  if (f.includes('semana')) return num > 0 ? Math.max(1, Math.round(7 / num)) : 7;
  if (f.includes('mês') || f.includes('mes')) return num > 0 ? Math.max(1, Math.round(30 / num)) : 7;
  if (f.includes('dia') || f.includes('diár') || f.includes('diar')) return 1;
  return 7;
}

function toIsoDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

async function generateCalendar(uid: string, project: ContentProject): Promise<CalendarArticle[]> {
  const clustersSnap = await projectRef(uid, project.id).collection('clusters').get();
  const clusters = clustersSnap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<ContentCluster, 'id'>) }))
    .filter((c) => !c.excluido);
  const approved = clusters.filter((c) => c.aprovado);
  const source = approved.length ? approved : clusters;
  if (!source.length) throw Object.assign(new Error('Nenhum cluster ativo para agendar'), { status: 400 });

  // Clusters no longer carry pre-made article ideas — derive article topics from
  // each cluster's theme + keywords, tagging each topic with its cluster id.
  const clusterBrief = source.map((c) => ({
    clusterId: c.id,
    tema: c.nome,
    descricao: c.estrategia,
    palavrasChave: (c.palavrasChave ?? []).map((k) => `${k.termo} (${k.intencao})`),
  }));

  const prompt = [
    'A partir dos clusters abaixo (tema + palavras-chave por intenção), proponha tópicos de artigos para o calendário editorial.',
    'Para cada cluster, gere de 3 a 6 tópicos. Priorize por potencial de tráfego e relevância estratégica.',
    'Cada tópico deve ter um título atraente e uma palavra-chave principal coerente com o cluster.',
    'Para cada tópico, defina também um "tamanho" ideal de artigo, com base na profundidade que o tema pede:',
    '- "curto": tema pontual, resposta direta ou dica rápida, pouco material a cobrir.',
    '- "medio": conteúdo explicativo padrão — use este para a maioria dos temas.',
    '- "longo": guia completo, comparativo ou pilar do cluster, com muito material/subtemas a cobrir.',
    'Responda ESTRITAMENTE em JSON, já na ordem de prioridade desejada:',
    '[{"titulo":"...","kwPrincipal":"...","clusterId":"<id do cluster>","tamanho":"curto"|"medio"|"longo"}]',
    '',
    `CLUSTERS:\n${JSON.stringify(clusterBrief)}`,
  ].join('\n');

  const validSize = (v: unknown): ArticleSize => (v === 'curto' || v === 'medio' || v === 'longo' ? v : 'medio');

  let topics: Array<{ titulo: string; kwPrincipal: string; clusterId: string; tamanho: ArticleSize }>;
  try {
    type RawTopic = { titulo: string; kwPrincipal: string; clusterId: string; tamanho?: unknown };
    const raw = parseJson<RawTopic[]>(await generateText(prompt, { systemInstruction: systemFor(project), temperature: 0.5 }));
    topics = (Array.isArray(raw) ? raw : [])
      .filter((t) => t?.titulo && source.some((c) => c.id === t.clusterId))
      .map((t) => ({ titulo: t.titulo, kwPrincipal: t.kwPrincipal, clusterId: t.clusterId, tamanho: validSize(t.tamanho) }));
    if (!topics.length) throw new Error('empty');
  } catch {
    // Fallback: one topic per cluster keyword.
    topics = source.flatMap((c) =>
      (c.palavrasChave ?? []).slice(0, 3).map((k) => ({ titulo: `${c.nome}: ${k.termo}`, kwPrincipal: k.termo, clusterId: c.id, tamanho: 'medio' as ArticleSize })),
    );
  }
  if (!topics.length) throw Object.assign(new Error('Não foi possível derivar tópicos dos clusters'), { status: 400 });

  const interval = frequencyToIntervalDays(project.config.frequenciaPostagens);
  const now = new Date().toISOString();
  const batch = adminDb.batch();
  const col = projectRef(uid, project.id).collection('calendar');

  const defaultTime = project.config.frequenciaPostagens?.toLowerCase().includes('diár') ? '08:00' : '09:00';

  const created: CalendarArticle[] = topics.map((topic, position) => {
    const date = new Date();
    date.setDate(date.getDate() + (position + 1) * interval);
    const ref = col.doc();
    const article: CalendarArticle = {
      id: ref.id,
      titulo: topic.titulo,
      kwPrincipal: topic.kwPrincipal,
      clusterId: topic.clusterId,
      tamanho: topic.tamanho,
      scheduledDate: toIsoDate(date),
      scheduledTime: defaultTime,
      status: 'agendado',
      stage: 0,
      createdAt: now,
      updatedAt: now,
    };
    const { id, ...data } = article;
    batch.set(ref, data);
    return article;
  });
  await batch.commit();
  return created;
}

// ---------------------------------------------------------------------------
// Fase 4 — Article production pipeline (5 stages)
// ---------------------------------------------------------------------------

async function runArticlePipeline(
  uid: string,
  projectId: string,
  articleId: string,
): Promise<void> {
  const project = await loadProject(uid, projectId);
  const sys = systemFor(project);
  const artRef = projectRef(uid, projectId).collection('calendar').doc(articleId);
  const snap = await artRef.get();
  if (!snap.exists) throw Object.assign(new Error('Artigo não encontrado'), { status: 404 });
  const article = { id: snap.id, ...(snap.data() as Omit<CalendarArticle, 'id'>) };

  const setStage = async (stage: ArticleStage, fields: Partial<CalendarArticle>) => {
    await artRef.update({ stage, status: 'em_producao', updatedAt: new Date().toISOString(), ...fields });
  };

  try {
    // ETAPA 1 — Deep Research (grounded)
    const researchBrief = await generateGrounded(
      [
        `Faça uma pesquisa aprofundada para o artigo: "${article.titulo}" (palavra-chave: "${article.kwPrincipal}").`,
        'Liste: principais pontos a cobrir, dados/estatísticas recentes, perguntas frequentes (People Also Ask), ângulo diferenciado e fontes.',
      ].join('\n'),
      { systemInstruction: sys, temperature: 0.5 },
    );
    await setStage(1, { researchBrief });

    // ETAPA 2 — Outline
    const articleOutline = await generateText(
      [
        `Com base nesta pesquisa, crie um outline detalhado (H1, H2, H3) para "${article.titulo}".`,
        'Inclua título otimizado para SEO, meta description e resumo de cada seção.',
        'Os títulos de H2/H3 devem ser sempre específicos ao conteúdo daquela seção. NUNCA use títulos genéricos como "Introdução", "Conclusão", "Considerações finais" ou "Resumo".',
        `PESQUISA:\n${researchBrief}`,
      ].join('\n\n'),
      { systemInstruction: sys, temperature: 0.5 },
    );
    await setStage(2, { articleOutline });

    // ETAPA 3 — Draft
    const [minWords, maxWords] = ARTICLE_SIZE_WORD_RANGES[article.tamanho ?? 'medio'];
    const articleDraft = await generateText(
      [
        `Escreva o artigo completo em Markdown seguindo o outline abaixo, com ${minWords} a ${maxWords} palavras.`,
        'Parágrafos curtos, subtítulos escaneáveis, KW principal no H1 e primeiro parágrafo, CTA ao final.',
        'Comece direto pelo conteúdo do artigo: NUNCA inclua saudação, auto-apresentação ou menção ao autor/persona (por exemplo "Olá! [nome] aqui", "Prepare-se para uma leitura que...", "Sou [nome] e vou te contar"). O primeiro parágrafo deve ir direto ao assunto do H1, sem repetir o título.',
        `OUTLINE:\n${articleOutline}`,
      ].join('\n\n'),
      { systemInstruction: sys, temperature: 0.7 },
    );
    await setStage(3, { articleDraft });

    // ETAPA 4 — Review + humanization
    const articleFinal = await generateText(
      [
        'Revise e humanize o artigo abaixo: elimine construções típicas de IA, adicione opiniões assertivas e exemplos concretos, mantenha o tom de voz.',
        'Se o texto abaixo começar com qualquer saudação, auto-apresentação ou menção à persona/autor (por exemplo "Olá! [nome] aqui", "Prepare-se para..."), REMOVA essa abertura por completo e reescreva o início para começar direto no conteúdo do primeiro parágrafo.',
        'Se algum H2/H3 ainda tiver título genérico ("Introdução", "Conclusão", "Considerações finais", "Resumo"), renomeie para algo específico do conteúdo daquela seção — sem remover a seção.',
        'Corte ou reescreva maneirismos típicos de texto gerado por IA, incluindo: construções de falso contraste ("Não é sobre X, é sobre Y", "Não se trata apenas de X, mas de Y"); frases de efeito/clichês ("Em um mundo cada vez mais [adjetivo]...", "É importante ressaltar/destacar que...", "Vale a pena mencionar que..."); e uso de "Em suma"/"Em resumo" como muleta de transição.',
        'Ao final, em uma linha separada, forneça: SLUG: <slug-amigavel> e META: <meta description>.',
        `ARTIGO:\n${articleDraft}`,
      ].join('\n\n'),
      { systemInstruction: sys, temperature: 0.6 },
    );

    const slug = articleFinal.match(/SLUG:\s*([a-z0-9-]+)/i)?.[1];
    const metaDescription = articleFinal.match(/META:\s*(.+)/i)?.[1]?.trim();

    await setStage(4, { articleFinal, slug: slug ?? undefined, metaDescription: metaDescription ?? undefined });

    // ETAPA 5 — Cover image (after review so the AI has full article context)
    const estiloLabel = (() => {
      const e = project.config.estiloImagem;
      if (!e) return 'fotorrealista';
      return e === 'Ilustracao' ? 'Ilustração' : e;
    })();

    let imageUrl: string | undefined;
    try {
      const imgPrompt = [
        `Imagem de capa para um artigo de blog sobre "${article.titulo}".`,
        `Contexto: ${articleFinal.slice(0, 400)}.`,
        `Estilo visual: ${estiloLabel}. Composição limpa, elementos simbólicos do tema, sem texto e sem rostos hiperrealistas.`,
        'Não inclua nome de empresa, marca, logotipo ou qualquer texto/escrita na imagem. Formato paisagem 16:9, alta resolução.',
      ].join(' ');
      const base64 = await generateImageBase64(imgPrompt);
      imageUrl = await saveImage(base64, uid, articleId);
      await debitCreditsAdmin(uid, CREDIT_ACTIONS.contentImage, { productName: article.titulo });
    } catch (e) {
      console.error('content image generation failed:', e);
    }

    await debitCreditsAdmin(uid, CREDIT_ACTIONS.contentArticle, { productName: article.titulo });
    await artRef.update({
      stage: 5,
      status: 'revisao',
      imageUrl: imageUrl ?? null,
      lastError: null,
      updatedAt: new Date().toISOString(),
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    await artRef.update({ status: 'erro', lastError: msg, updatedAt: new Date().toISOString() });
    throw error;
  }
}

// Downloads an existing image (e.g. a product photo) and returns it as base64
// + mime type, for use as a reference image in generateImageBase64().
async function fetchImageAsBase64(rawUrl: string): Promise<{ mimeType: string; data: string }> {
  // baseProductImageUrl is client-supplied (authenticated), so it goes through
  // the same SSRF guard as other user-supplied URLs in this file (scanWebsite).
  const url = await assertSafeUrl(rawUrl);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('Não foi possível baixar a imagem do produto.');
  const buf = Buffer.from(await resp.arrayBuffer());
  const mimeType = resp.headers.get('content-type') || 'image/jpeg';
  return { mimeType, data: buf.toString('base64') };
}

async function regenerateArticleImage(
  uid: string,
  projectId: string,
  articleId: string,
  opts: { mode: 'improve' | 'fromProduct'; improvementPrompt?: string; baseProductImageUrl?: string },
): Promise<string> {
  const project = await loadProject(uid, projectId);
  const artRef = projectRef(uid, projectId).collection('calendar').doc(articleId);
  const snap = await artRef.get();
  if (!snap.exists) throw Object.assign(new Error('Artigo não encontrado'), { status: 404 });
  const article = { id: snap.id, ...(snap.data() as Omit<CalendarArticle, 'id'>) };

  const estiloLabel = (() => {
    const e = project.config.estiloImagem;
    if (!e) return 'fotorrealista';
    return e === 'Ilustracao' ? 'Ilustração' : e;
  })();

  const promptParts = [
    `Imagem de capa para um artigo de blog sobre "${article.titulo}".`,
    `Contexto: ${(article.articleFinal ?? article.articleDraft ?? '').slice(0, 400)}.`,
    `Estilo visual: ${estiloLabel}. Composição limpa, elementos simbólicos do tema, sem texto e sem rostos hiperrealistas.`,
    'Não inclua nome de empresa, marca, logotipo ou qualquer texto/escrita na imagem. Formato paisagem 16:9, alta resolução.',
  ];

  let referenceImage: { mimeType: string; data: string } | undefined;
  if (opts.mode === 'improve') {
    if (!opts.improvementPrompt?.trim()) {
      throw Object.assign(new Error('Descreva o ajuste desejado para a imagem.'), { status: 400 });
    }
    promptParts.push(`Ajustes solicitados pelo usuário: ${opts.improvementPrompt.trim()}.`);
  } else {
    if (!opts.baseProductImageUrl) {
      throw Object.assign(new Error('Imagem do produto não informada.'), { status: 400 });
    }
    referenceImage = await fetchImageAsBase64(opts.baseProductImageUrl);
    promptParts.push(
      'Use a imagem do produto anexada como referência visual central da composição, mantendo suas cores e formato reconhecíveis.',
    );
  }

  const base64 = await generateImageBase64(promptParts.join(' '), referenceImage);
  const imageUrl = await saveImage(base64, uid, articleId);
  await debitCreditsAdmin(uid, CREDIT_ACTIONS.contentImage, { productName: article.titulo });
  await artRef.update({ imageUrl, updatedAt: new Date().toISOString() });
  return imageUrl;
}

// ---------------------------------------------------------------------------
// Fase 5 — WordPress publishing
// ---------------------------------------------------------------------------

// A conversão Markdown→HTML (WP e blog nativo) vive em
// src/modules/content/markdown.ts (marked), compartilhada com o client.

// Converts a subset of Markdown to Sanity Portable Text blocks.
// Handles: headings (#, ##, ###), bold (**text**), paragraphs.
function markdownToPortableText(md: string): object[] {
  type PTSpan = { _type: 'span'; _key: string; text: string; marks: string[] };
  type PTBlock = { _type: 'block'; _key: string; style: string; children: PTSpan[]; markDefs: [] };

  let key = 0;
  const nextKey = () => `k${key++}`;

  const cleaned = md
    .replace(/SLUG:.*$/im, '')
    .replace(/META:.*$/im, '')
    .trim();

  const blocks: PTBlock[] = [];

  for (const rawLine of cleaned.split(/\n{2,}/)) {
    const line = rawLine.trim();
    if (!line) continue;

    let style = 'normal';
    let text = line;
    if (line.startsWith('### ')) { style = 'h3'; text = line.slice(4); }
    else if (line.startsWith('## ')) { style = 'h2'; text = line.slice(3); }
    else if (line.startsWith('# ')) { style = 'h1'; text = line.slice(2); }

    const children: PTSpan[] = [];
    const boldRegex = /\*\*(.+?)\*\*/g;
    let last = 0;
    let match: RegExpExecArray | null;
    while ((match = boldRegex.exec(text)) !== null) {
      if (match.index > last) {
        children.push({ _type: 'span', _key: nextKey(), text: text.slice(last, match.index), marks: [] });
      }
      children.push({ _type: 'span', _key: nextKey(), text: match[1], marks: ['strong'] });
      last = match.index + match[0].length;
    }
    if (last < text.length) {
      children.push({ _type: 'span', _key: nextKey(), text: text.slice(last), marks: [] });
    }
    if (!children.length) {
      children.push({ _type: 'span', _key: nextKey(), text, marks: [] });
    }

    blocks.push({ _type: 'block', _key: nextKey(), style, children, markDefs: [] });
  }

  return blocks;
}

async function publishToWordpress(uid: string, projectId: string, articleId: string): Promise<string> {
  const project = await loadProject(uid, projectId);
  const { wordpressUrl, wordpressUser } = project.config;
  if (!wordpressUrl || !wordpressUser) {
    throw Object.assign(new Error('Credenciais do WordPress não configuradas'), { status: 400 });
  }
  const secretSnap = await projectRef(uid, projectId).collection('secrets').doc('wordpress').get();
  const appPassword = secretSnap.exists ? (secretSnap.data() as { appPassword?: string }).appPassword : undefined;
  if (!appPassword) throw Object.assign(new Error('Application Password do WordPress ausente'), { status: 400 });

  const artRef = projectRef(uid, projectId).collection('calendar').doc(articleId);
  const snap = await artRef.get();
  if (!snap.exists) throw Object.assign(new Error('Artigo não encontrado'), { status: 404 });
  const article = { id: snap.id, ...(snap.data() as Omit<CalendarArticle, 'id'>) };
  if (!article.articleFinal) throw Object.assign(new Error('Artigo ainda não produzido'), { status: 400 });

  const base = wordpressUrl.replace(/\/+$/, '');
  const auth = 'Basic ' + Buffer.from(`${wordpressUser}:${appPassword}`).toString('base64');

  // Upload featured image (best-effort).
  let featuredMedia: number | undefined;
  if (article.imageUrl) {
    try {
      const imgResp = await fetch(article.imageUrl);
      if (imgResp.ok) {
        const buf = Buffer.from(await imgResp.arrayBuffer());
        const mediaResp = await fetch(`${base}/wp-json/wp/v2/media`, {
          method: 'POST',
          headers: {
            Authorization: auth,
            'Content-Type': 'image/png',
            'Content-Disposition': `attachment; filename="${article.slug || 'capa'}.png"`,
          },
          body: buf,
        });
        if (mediaResp.ok) featuredMedia = ((await mediaResp.json()) as { id: number }).id;
      }
    } catch (e) {
      console.error('WP media upload failed:', e);
    }
  }

  const postBody = {
    title: article.titulo,
    content: markdownToHtml(article.articleFinal),
    status: 'publish',
    slug: article.slug || undefined,
    excerpt: article.metaDescription || undefined,
    featured_media: featuredMedia,
  };
  const postUrl = `${base}/wp-json/wp/v2/posts`;
  const inicio = Date.now();
  const postResp = await fetch(postUrl, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify(postBody),
  });
  const postBodyText = await postResp.text();
  let postJson: unknown = postBodyText;
  try { postJson = JSON.parse(postBodyText); } catch { /* corpo não é JSON — mantém texto cru */ }
  await logPublishCall(uid, projectId, {
    destino: 'wordpress', operacao: 'posts', alvo: postUrl, articleId, articleTitulo: article.titulo,
    requisicao: postBody, resposta: postJson, status: postResp.status, ok: postResp.ok,
    erro: postResp.ok ? undefined : postBodyText, ms: Date.now() - inicio,
  });
  if (!postResp.ok) {
    throw Object.assign(new Error(`Falha ao publicar no WordPress: ${postResp.status} — ${postBodyText}`), { status: 502 });
  }
  const post = postJson as { id: number; link: string };

  await debitCreditsAdmin(uid, CREDIT_ACTIONS.contentPublish, { productName: article.titulo });
  await artRef.update({
    status: 'publicado',
    urlPublicado: post.link,
    dataPublicacao: new Date().toISOString(),
    publishDestination: 'wordpress',
    wordpressPostId: post.id,
    updatedAt: new Date().toISOString(),
  });
  return post.link;
}

async function unpublishFromWordpress(uid: string, projectId: string, articleId: string, wordpressPostId: number, articleTitulo: string): Promise<void> {
  const project = await loadProject(uid, projectId);
  const { wordpressUrl, wordpressUser } = project.config;
  if (!wordpressUrl || !wordpressUser) throw Object.assign(new Error('Credenciais do WordPress não configuradas'), { status: 400 });
  const secretSnap = await projectRef(uid, projectId).collection('secrets').doc('wordpress').get();
  const appPassword = secretSnap.exists ? (secretSnap.data() as { appPassword?: string }).appPassword : undefined;
  if (!appPassword) throw Object.assign(new Error('Application Password do WordPress ausente'), { status: 400 });

  const base = wordpressUrl.replace(/\/+$/, '');
  const auth = 'Basic ' + Buffer.from(`${wordpressUser}:${appPassword}`).toString('base64');
  const url = `${base}/wp-json/wp/v2/posts/${wordpressPostId}`;
  const inicio = Date.now();
  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'draft' }),
  });
  const bodyText = await resp.text();
  await logPublishCall(uid, projectId, {
    destino: 'wordpress', operacao: 'posts.update', alvo: url, articleId, articleTitulo,
    requisicao: { status: 'draft' }, resposta: bodyText, status: resp.status, ok: resp.ok,
    erro: resp.ok ? undefined : bodyText, ms: Date.now() - inicio,
  });
  if (!resp.ok) {
    throw Object.assign(new Error(`Falha ao despublicar do WordPress: ${resp.status} — ${bodyText}`), { status: 502 });
  }
}

/**
 * _id/_ref determinísticos: evita duplicar categoria a cada publish. O _type
 * entra no _id porque é configurável (ver ContentProjectConfig) — sem isso,
 * mudar sanityCategoryType depois de já ter publicado colide com o _id
 * antigo (outro _type) e o Studio recusa a referência como "invalid type".
 */
function sanityCategoryDocId(categoryType: string, nome: string): string {
  return `${categoryType}-${slugify(nome)}`;
}

async function sanityMutate(
  uid: string,
  projectId: string,
  articleId: string,
  articleTitulo: string,
  sanityProjectId: string,
  dataset: string,
  apiToken: string,
  operacao: string,
  mutations: unknown[],
): Promise<unknown> {
  const apiUrl = `https://${sanityProjectId}.api.sanity.io/v2021-10-21/data/mutate/${dataset}`;
  const inicio = Date.now();
  let resp: Response;
  try {
    resp = await fetch(apiUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mutations }),
    });
  } catch (e) {
    await logPublishCall(uid, projectId, {
      destino: 'sanity', operacao, alvo: apiUrl, articleId, articleTitulo,
      requisicao: { mutations }, status: null, ok: false,
      erro: e instanceof Error ? e.message : String(e), ms: Date.now() - inicio,
    });
    throw e;
  }
  const bodyText = await resp.text();
  let bodyJson: unknown = bodyText;
  try { bodyJson = JSON.parse(bodyText); } catch { /* corpo não é JSON — mantém texto cru */ }

  await logPublishCall(uid, projectId, {
    destino: 'sanity', operacao, alvo: apiUrl, articleId, articleTitulo,
    requisicao: { mutations }, resposta: bodyJson, status: resp.status, ok: resp.ok,
    erro: resp.ok ? undefined : bodyText, ms: Date.now() - inicio,
  });

  if (!resp.ok) {
    throw Object.assign(new Error(`Falha ao falar com o Sanity: ${resp.status} — ${bodyText}`), { status: 502 });
  }
  return bodyJson;
}

// Sanity é headless: uma imagem só aparece no documento se ela existir antes
// como um asset (`sanity.imageAsset`) e o documento guardar uma referência a
// ele — não dá para apontar direto para uma URL externa como no WordPress.
async function uploadImageToSanity(
  uid: string,
  projectId: string,
  articleId: string,
  articleTitulo: string,
  sanityProjectId: string,
  dataset: string,
  apiToken: string,
  imageUrl: string,
): Promise<string> {
  const imgResp = await fetch(imageUrl);
  if (!imgResp.ok) throw new Error(`Não foi possível baixar a imagem de capa: ${imgResp.status}`);
  const buf = Buffer.from(await imgResp.arrayBuffer());
  const mimeType = imgResp.headers.get('content-type') || 'image/png';

  const apiUrl = `https://${sanityProjectId}.api.sanity.io/v2021-10-21/assets/images/${dataset}`;
  const inicio = Date.now();
  const resp = await fetch(apiUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': mimeType },
    body: buf,
  });
  const bodyText = await resp.text();
  let bodyJson: unknown = bodyText;
  try { bodyJson = JSON.parse(bodyText); } catch { /* corpo não é JSON — mantém texto cru */ }

  await logPublishCall(uid, projectId, {
    destino: 'sanity', operacao: 'assets.images', alvo: apiUrl, articleId, articleTitulo,
    requisicao: { imageUrl, mimeType }, resposta: bodyJson, status: resp.status, ok: resp.ok,
    erro: resp.ok ? undefined : bodyText, ms: Date.now() - inicio,
  });
  if (!resp.ok) {
    throw Object.assign(new Error(`Falha ao enviar imagem para o Sanity: ${resp.status} — ${bodyText}`), { status: 502 });
  }
  const assetId = (bodyJson as { document?: { _id?: string } }).document?._id;
  if (!assetId) throw new Error('Sanity não retornou o _id do asset da imagem.');
  return assetId;
}

async function loadSanityCreds(uid: string, projectId: string): Promise<{ sanityProjectId: string; dataset: string; apiToken: string }> {
  const project = await loadProject(uid, projectId);
  const { sanityProjectId, sanityDataset } = project.config;
  if (!sanityProjectId) throw Object.assign(new Error('Project ID do Sanity não configurado'), { status: 400 });
  const dataset = sanityDataset || 'production';
  const secretSnap = await projectRef(uid, projectId).collection('secrets').doc('sanity').get();
  const apiToken = secretSnap.exists ? (secretSnap.data() as { apiToken?: string }).apiToken : undefined;
  if (!apiToken) throw Object.assign(new Error('API Token do Sanity ausente'), { status: 400 });
  return { sanityProjectId, dataset, apiToken };
}

async function sanityQuery<T>(
  sanityProjectId: string, dataset: string, apiToken: string, groq: string, params: Record<string, string> = {},
): Promise<T> {
  const url = new URL(`https://${sanityProjectId}.api.sanity.io/v2021-10-21/data/query/${dataset}`);
  url.searchParams.set('query', groq);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(`$${k}`, JSON.stringify(v));
  const resp = await fetch(url.toString(), { headers: { Authorization: `Bearer ${apiToken}` } });
  const text = await resp.text();
  if (!resp.ok) throw Object.assign(new Error(`Falha ao consultar o Sanity: ${resp.status} — ${text}`), { status: 502 });
  return (JSON.parse(text) as { result: T }).result;
}

// Descobre os _type existentes no dataset amostrando documentos (não depende de
// `sanity schema deploy`, que a maioria dos projetos nunca roda — funciona com
// qualquer dataset acessível pelo token). Tipos internos do Sanity são excluídos.
async function detectSanityTypes(uid: string, projectId: string): Promise<Array<{ type: string; count: number }>> {
  const { sanityProjectId, dataset, apiToken } = await loadSanityCreds(uid, projectId);
  const types = await sanityQuery<string[]>(sanityProjectId, dataset, apiToken, '*[0...1000]._type');
  const counts = new Map<string, number>();
  for (const t of types) {
    if (!t || t.startsWith('sanity.') || t.startsWith('system.')) continue;
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);
}

type SanityFieldKind = 'portableText' | 'reference' | 'referenceArray' | 'string' | 'slug' | 'image' | 'other';

function inferSanityFieldKind(value: unknown): SanityFieldKind {
  if (Array.isArray(value)) {
    const first = value[0] as Record<string, unknown> | undefined;
    if (first && typeof first === 'object' && first._type === 'block') return 'portableText';
    if (first && typeof first === 'object' && first._type === 'reference') return 'referenceArray';
    return 'other';
  }
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if (v._type === 'slug') return 'slug';
    if (v._type === 'reference') return 'reference';
    if (v._type === 'image') return 'image';
    return 'other';
  }
  if (typeof value === 'string') return 'string';
  return 'other';
}

// Amostra um documento existente do tipo dado e devolve os campos com um
// "palpite" de natureza (texto rico, referência(s), string...) — é isso que
// deixa a UI sugerir qual campo é o corpo do artigo e qual é a categoria, em
// vez do usuário precisar abrir o Studio pra ler o schema.
async function detectSanityFields(uid: string, projectId: string, type: string): Promise<Array<{ field: string; kind: SanityFieldKind }>> {
  const { sanityProjectId, dataset, apiToken } = await loadSanityCreds(uid, projectId);
  const doc = await sanityQuery<Record<string, unknown> | null>(sanityProjectId, dataset, apiToken, '*[_type == $type][0]', { type });
  if (!doc) return [];
  return Object.keys(doc)
    .filter((k) => !k.startsWith('_'))
    .map((field) => ({ field, kind: inferSanityFieldKind(doc[field]) }));
}

async function publishToSanity(uid: string, projectId: string, articleId: string): Promise<string> {
  const project = await loadProject(uid, projectId);
  const {
    sanityProjectId, sanityDataset, sanityBlogUrl,
    sanityDocType, sanityBodyField, sanityCategoryField, sanityCategoryType, sanityCategoryNameField,
    sanityImageField, sanityCategoryIsArray,
  } = project.config;
  if (!sanityProjectId) {
    throw Object.assign(new Error('Project ID do Sanity não configurado'), { status: 400 });
  }
  const dataset = sanityDataset || 'production';

  const secretSnap = await projectRef(uid, projectId).collection('secrets').doc('sanity').get();
  const apiToken = secretSnap.exists ? (secretSnap.data() as { apiToken?: string }).apiToken : undefined;
  if (!apiToken) throw Object.assign(new Error('API Token do Sanity ausente'), { status: 400 });

  const artRef = projectRef(uid, projectId).collection('calendar').doc(articleId);
  const snap = await artRef.get();
  if (!snap.exists) throw Object.assign(new Error('Artigo não encontrado'), { status: 404 });
  const article = { id: snap.id, ...(snap.data() as Omit<CalendarArticle, 'id'>) };
  if (!article.articleFinal) throw Object.assign(new Error('Artigo ainda não produzido'), { status: 400 });

  const slug = article.slug || article.titulo.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const docId = `article-${articleId}`;
  const docType = (sanityDocType || 'post').trim();
  // Se o campo de corpo do schema do cliente tiver outro nome (ex.: 'content'),
  // escrever em 'body' publica um documento sem o conteúdo aparecer no site —
  // o frontend do cliente lê o campo pelo nome dele, não pelo nosso.
  const bodyField = (sanityBodyField || 'body').trim();

  const doc: Record<string, unknown> = {
    _id: docId,
    _type: docType,
    title: article.titulo,
    slug: { _type: 'slug', current: slug },
    [bodyField]: markdownToPortableText(article.articleFinal),
    excerpt: article.metaDescription || undefined,
    publishedAt: new Date().toISOString(),
  };

  // O schema do Sanity é do cliente, não nosso — o nome do tipo/campo de
  // categoria é configurável (ver ContentProjectConfig). Sem sanityCategoryField
  // configurado, publica sem categoria (comportamento anterior).
  const categoryField = sanityCategoryField?.trim();
  const mutations: unknown[] = [];
  if (categoryField && article.clusterId) {
    const clusterSnap = await projectRef(uid, projectId).collection('clusters').doc(article.clusterId).get();
    const clusterNome = clusterSnap.exists ? (clusterSnap.data() as ContentCluster).nome : undefined;
    if (clusterNome) {
      const categoryType = (sanityCategoryType || 'category').trim();
      const nameField = (sanityCategoryNameField || 'title').trim();
      const categoryDocId = sanityCategoryDocId(categoryType, clusterNome);
      // createIfNotExists: garante o doc de categoria sem sobrescrever edições
      // que o cliente já tenha feito nele direto no Studio.
      // `slug` é convenção do Sanity (não configurável aqui, como o nome do
      // campo já assume em outros tipos do schema) — sem ele, páginas do
      // frontend do cliente que buscam categoria por slug ficam quebradas.
      mutations.push({
        createIfNotExists: {
          _id: categoryDocId,
          _type: categoryType,
          [nameField]: clusterNome,
          slug: { _type: 'slug', current: slugify(clusterNome) },
        },
      });
      const ref = { _type: 'reference', _ref: categoryDocId };
      // Schemas do starter usam array (`categories`); outros, referência única
      // (`category`) — escrever array num campo de referência única também
      // dispara "Unknown fields" no Studio, porque o shape não bate com o schema.
      doc[categoryField] = sanityCategoryIsArray === false ? ref : [{ ...ref, _key: crypto.randomUUID() }];
    }
  }

  // Imagem de capa: o Sanity não aceita URL externa direto num campo `image`
  // — precisa subir o binário como asset primeiro e referenciar o _id dele.
  const imageField = sanityImageField?.trim();
  if (imageField && article.imageUrl) {
    const assetId = await uploadImageToSanity(
      uid, projectId, articleId, article.titulo, sanityProjectId, dataset, apiToken, article.imageUrl,
    );
    doc[imageField] = { _type: 'image', asset: { _type: 'reference', _ref: assetId } };
  }

  mutations.push({ createOrReplace: doc });

  await sanityMutate(uid, projectId, articleId, article.titulo, sanityProjectId, dataset, apiToken, 'mutate', mutations);

  // O Sanity é headless: não publica em uma URL própria. Só é possível montar
  // um link para o artigo publicado se o cliente informou onde o frontend
  // renderiza o conteúdo (sanityBlogUrl). Sem isso, aponta para o painel de
  // gestão do projeto, que sempre existe — nunca para um Studio hospedado
  // "adivinhado" em {projectId}.sanity.studio, que pode não estar implantado.
  const documentUrl = sanityBlogUrl
    ? `${sanityBlogUrl.replace(/\/+$/, '')}/conteudo/${slug}`
    : `https://www.sanity.io/manage/project/${sanityProjectId}`;

  await debitCreditsAdmin(uid, CREDIT_ACTIONS.contentPublish, { productName: article.titulo });
  await artRef.update({
    status: 'publicado',
    urlPublicado: documentUrl,
    dataPublicacao: new Date().toISOString(),
    publishDestination: 'sanity',
    updatedAt: new Date().toISOString(),
  });

  return documentUrl;
}

async function unpublishFromSanity(uid: string, projectId: string, articleId: string, articleTitulo: string): Promise<void> {
  const project = await loadProject(uid, projectId);
  const { sanityProjectId, sanityDataset } = project.config;
  if (!sanityProjectId) throw Object.assign(new Error('Project ID do Sanity não configurado'), { status: 400 });
  const dataset = sanityDataset || 'production';

  const secretSnap = await projectRef(uid, projectId).collection('secrets').doc('sanity').get();
  const apiToken = secretSnap.exists ? (secretSnap.data() as { apiToken?: string }).apiToken : undefined;
  if (!apiToken) throw Object.assign(new Error('API Token do Sanity ausente'), { status: 400 });

  const docId = `article-${articleId}`;
  // Não apaga o doc de categoria (pode estar em uso por outros artigos) — só o post.
  await sanityMutate(uid, projectId, articleId, articleTitulo, sanityProjectId, dataset, apiToken, 'mutate.delete', [
    { delete: { id: docId } },
  ]);
}

// Congela os produtos vinculados ao artigo num snapshot leve (mesmo espírito
// de coverImageUrl/title: cópia, não referência viva — o post publicado
// continua exibindo a vitrine mesmo que o produto seja depois editado/removido).
async function snapshotLinkedProducts(uid: string, produtosVinculados: string[] | undefined): Promise<BlogPostProduct[]> {
  if (!produtosVinculados?.length) return [];
  const ids = new Set(produtosVinculados);
  const snap = await adminDb.collection('users').doc(uid).collection('products').get();
  const out: BlogPostProduct[] = [];
  for (const d of snap.docs) {
    const data = d.data() as Record<string, unknown>;
    const id = (typeof data._id === 'string' && data._id) || d.id;
    if (!ids.has(id)) continue;
    const nome = (typeof data['Descrição'] === 'string' && data['Descrição']) || '(sem nome)';
    const selectedImage = typeof data._selectedImage === 'string' ? data._selectedImage : undefined;
    const firstImage = typeof data['URL imagem 1'] === 'string' ? (data['URL imagem 1'] as string) : undefined;
    const rawPrice = data['Preço promocional'] ?? data['Preço'];
    const preco = typeof rawPrice === 'number' ? rawPrice
      : typeof rawPrice === 'string' && rawPrice.trim() ? Number(rawPrice.replace(',', '.')) : undefined;
    out.push({
      id,
      nome,
      ...(selectedImage || firstImage ? { imagemPrincipal: selectedImage || firstImage } : {}),
      ...(preco != null && !Number.isNaN(preco) ? { preco } : {}),
    });
  }
  return out;
}

// Fase 5 — publicação no Blog nativo (CMS da plataforma).
// Copia o artigo final para blogPosts como published e retorna a URL pública.
async function publishToBlog(uid: string, projectId: string, articleId: string): Promise<string> {
  const settingsSnap = await projectRef(uid, projectId).collection('blog').doc('settings').get();
  if (!settingsSnap.exists || !(settingsSnap.data() as BlogSettings).enabled) {
    throw Object.assign(new Error('Blog nativo não está configurado/habilitado para este projeto'), { status: 400 });
  }
  const settings = settingsSnap.data() as BlogSettings;

  const artRef = projectRef(uid, projectId).collection('calendar').doc(articleId);
  const snap = await artRef.get();
  if (!snap.exists) throw Object.assign(new Error('Artigo não encontrado'), { status: 404 });
  const article = { id: snap.id, ...(snap.data() as Omit<CalendarArticle, 'id'>) };
  if (!article.articleFinal) {
    throw Object.assign(new Error('Artigo ainda não tem versão final para publicar'), { status: 400 });
  }

  const postsCol = projectRef(uid, projectId).collection('blogPosts');

  // Se já publicado antes (re-publish), reaproveita o mesmo post/slug.
  const existing = await postsCol.where('sourceArticleId', '==', articleId).limit(1).get();
  const now = new Date().toISOString();

  let slug: string;
  let postRef;
  if (!existing.empty) {
    postRef = existing.docs[0].ref;
    slug = (existing.docs[0].data() as BlogPost).slug;
  } else {
    const all = await postsCol.get();
    const taken = new Set(all.docs.map((d) => (d.data() as BlogPost).slug));
    slug = uniqueSlug(article.slug || slugify(article.titulo), taken);
    postRef = postsCol.doc();
  }

  // O pipeline entrega o artigo em Markdown; o blog nativo armazena HTML.
  const htmlBody = markdownToHtml(article.articleFinal);
  const excerpt = (article.metaDescription || htmlBody.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ').trim().slice(0, 200);
  const products = await snapshotLinkedProducts(uid, article.produtosVinculados);

  await postRef.set({
    title: article.titulo,
    slug,
    html: htmlBody,
    excerpt,
    coverImageUrl: article.imageUrl ?? '',
    // Só inicializa categoryIds em post novo; no re-publish o merge preserva
    // as categorias atribuídas pelo usuário no editor do blog.
    ...(existing.empty ? { categoryIds: [] } : {}),
    status: 'published',
    publishedAt: now,
    seo: { metaTitle: article.titulo, metaDescription: article.metaDescription ?? '' },
    products,
    ...(article.responsavel ? { authorName: article.responsavel } : {}),
    sourceArticleId: articleId,
    createdAt: existing.empty ? now : (existing.docs[0].data() as BlogPost).createdAt,
    updatedAt: now,
  }, { merge: true });

  // URL pública: domínio verificado (se houver) ou /b/{slug} na plataforma.
  // 'proxy' serve só sob /blog no domínio do cliente, nunca na raiz — por
  // isso entra como um caso à parte, não como o domínio canônico.
  const domainsSnap = await adminDb.collection('blogDomains')
    .where('uid', '==', uid).where('projectId', '==', projectId).where('verified', '==', true).get();
  const rootDomain = domainsSnap.docs.find((d) => (d.data() as BlogDomainDoc).method !== 'proxy');
  const proxyDomain = domainsSnap.docs.find((d) => (d.data() as BlogDomainDoc).method === 'proxy');
  const base = rootDomain
    ? `https://${rootDomain.id}`
    : proxyDomain
      ? `https://${proxyDomain.id}/blog`
      : `${(process.env.APP_URL || '').replace(/\/+$/, '') || 'http://localhost:3000'}/b/${settings.slug}`;
  const url = `${base}/${slug}`;

  // Sem débito de créditos: o artigo já foi pago na produção; content_publish
  // aplica-se apenas às integrações externas (WordPress/Sanity).
  await artRef.update({
    status: 'publicado',
    urlPublicado: url,
    dataPublicacao: now,
    publishDestination: 'blog',
    updatedAt: now,
  });

  return url;
}

async function unpublishFromBlog(uid: string, projectId: string, articleId: string): Promise<void> {
  const postsCol = projectRef(uid, projectId).collection('blogPosts');
  const existing = await postsCol.where('sourceArticleId', '==', articleId).limit(1).get();
  if (existing.empty) return; // já não está publicado no blog nativo — nada a fazer
  await existing.docs[0].ref.update({ status: 'draft', updatedAt: new Date().toISOString() });
}

// Fase 5 — despublicação: some do destino externo/blog e o artigo volta a
// 'aprovado' (não 'agendado' — o conteúdo final continua pronto, só não está
// mais no ar). O destino é lido de publishDestination; artigos publicados
// antes dessa feature não têm o campo, então cai na mesma prioridade do
// publish (sanity > wordpress > blog nativo) usada quando nenhum destino é informado.
async function unpublishArticle(uid: string, projectId: string, articleId: string): Promise<void> {
  const artRef = projectRef(uid, projectId).collection('calendar').doc(articleId);
  const snap = await artRef.get();
  if (!snap.exists) throw Object.assign(new Error('Artigo não encontrado'), { status: 404 });
  const article = { id: snap.id, ...(snap.data() as Omit<CalendarArticle, 'id'>) };
  if (article.status !== 'publicado') {
    throw Object.assign(new Error('Artigo não está publicado'), { status: 400 });
  }

  const project = await loadProject(uid, projectId);
  const destino = article.publishDestination
    ?? (project.config.sanityProjectId ? 'sanity' : project.config.wordpressUrl ? 'wordpress' : 'blog');

  if (destino === 'sanity') {
    await unpublishFromSanity(uid, projectId, articleId, article.titulo);
  } else if (destino === 'wordpress') {
    if (!article.wordpressPostId) {
      throw Object.assign(new Error('Artigo publicado no WordPress antes desta função existir — sem o ID do post não é possível despublicar automaticamente. Remova manualmente no WordPress.'), { status: 400 });
    }
    await unpublishFromWordpress(uid, projectId, articleId, article.wordpressPostId, article.titulo);
  } else {
    await unpublishFromBlog(uid, projectId, articleId);
  }

  await artRef.update({
    status: 'aprovado',
    urlPublicado: null,
    dataPublicacao: null,
    publishDestination: null,
    updatedAt: new Date().toISOString(),
  });
}

// Approved/published articles the Product agent can reuse in descriptions
// (cross-module data share: Produto usa conteúdo gerado). Scoped to the user's
// own projects (no global collectionGroup).
async function getReusableArticles(uid: string): Promise<Array<{ id: string; titulo: string; articleFinal: string }>> {
  const projectsSnap = await adminDb.collection('users').doc(uid).collection('contentProjects').get();
  const out: Array<{ id: string; titulo: string; articleFinal: string }> = [];
  for (const proj of projectsSnap.docs) {
    const calSnap = await proj.ref.collection('calendar').where('status', 'in', ['aprovado', 'publicado']).get();
    for (const doc of calSnap.docs) {
      const d = doc.data() as CalendarArticle;
      if (d.articleFinal) out.push({ id: doc.id, titulo: d.titulo, articleFinal: d.articleFinal });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Cron tick — autonomous production of due articles (Fase 4 trigger)
// ---------------------------------------------------------------------------

async function runCronTick(): Promise<{ produced: number; errors: number }> {
  const today = toIsoDate(new Date());
  // collectionGroup across all users; path: users/{uid}/contentProjects/{pid}/calendar/{aid}
  const due = await adminDb
    .collectionGroup('calendar')
    .where('status', '==', 'agendado')
    .where('scheduledDate', '<=', today)
    .limit(25)
    .get();

  let produced = 0;
  let errors = 0;
  for (const doc of due.docs) {
    const segments = doc.ref.path.split('/');
    // ['users', uid, 'contentProjects', pid, 'calendar', aid]
    const uid = segments[1];
    const projectId = segments[3];
    try {
      await runArticlePipeline(uid, projectId, doc.id);
      produced++;
    } catch (e) {
      console.error(`cron: failed to produce ${doc.ref.path}:`, e);
      errors++;
    }
  }
  return { produced, errors };
}

// ---------------------------------------------------------------------------
// Route registration + dev scheduler
// ---------------------------------------------------------------------------

interface ContentDeps {
  verifyFirebaseToken: (req: express.Request) => Promise<{ uid: string; email?: string; name?: string }>;
}

function sendError(res: express.Response, err: unknown) {
  const e = err as { status?: number; message?: string };
  const status = e.status ?? 500;
  if (e.message === 'INSUFFICIENT_CREDITS') {
    return res.status(402).json({ error: 'Créditos insuficientes' });
  }
  console.error('content endpoint error:', err);
  return res.status(status).json({ error: e.message ?? 'Erro interno' });
}

export function registerContentRoutes(app: express.Application, deps: ContentDeps): void {
  const { verifyFirebaseToken } = deps;

  app.post('/api/content/projects/:id/generate-clusters', async (req, res) => {
    try {
      const decoded = await verifyFirebaseToken(req);
      const project = await loadProject(decoded.uid, req.params.id);
      await debitCreditsAdmin(decoded.uid, CREDIT_ACTIONS.contentClusters, {
        productName: project.config.nomeEmpresa,
        userName: decoded.name ?? decoded.email,
      });
      // A geração agora também pesquisa palavras-chave reais via SE Ranking.
      await debitCreditsAdmin(decoded.uid, CREDIT_ACTIONS.seoKeywordResearch, {
        productName: project.config.nomeEmpresa,
        userName: decoded.name ?? decoded.email,
      });
      const clusters = await generateClusters(decoded.uid, project);
      res.json({ clusters });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/content/projects/:id/generate-calendar', async (req, res) => {
    try {
      const decoded = await verifyFirebaseToken(req);
      const project = await loadProject(decoded.uid, req.params.id);
      await debitCreditsAdmin(decoded.uid, CREDIT_ACTIONS.contentCalendar, {
        productName: project.config.nomeEmpresa,
        userName: decoded.name ?? decoded.email,
      });
      const calendar = await generateCalendar(decoded.uid, project);
      res.json({ calendar });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/content/scan-website', async (req, res) => {
    try {
      await verifyFirebaseToken(req);
      const { url } = req.body as { url?: string };
      if (!url?.trim()) return res.status(400).json({ error: 'url é obrigatória' });
      const config = await scanWebsite(url.trim());
      res.json({ config });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get('/api/content/articles/reusable', async (req, res) => {
    try {
      const decoded = await verifyFirebaseToken(req);
      const articles = await getReusableArticles(decoded.uid);
      res.json({ articles });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/content/projects/:projectId/articles/:articleId/produce', async (req, res) => {
    try {
      const decoded = await verifyFirebaseToken(req);
      await runArticlePipeline(decoded.uid, req.params.projectId, req.params.articleId);
      res.json({ ok: true });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/content/projects/:projectId/articles/:articleId/regenerate-image', async (req, res) => {
    try {
      const decoded = await verifyFirebaseToken(req);
      const body = req.body as {
        mode?: 'improve' | 'fromProduct';
        improvementPrompt?: string;
        baseProductImageUrl?: string;
      };
      const { mode, improvementPrompt, baseProductImageUrl } = body;
      if (mode !== 'improve' && mode !== 'fromProduct') {
        return res.status(400).json({ error: 'mode inválido' });
      }
      const imageUrl = await regenerateArticleImage(
        decoded.uid,
        req.params.projectId,
        req.params.articleId,
        { mode, improvementPrompt, baseProductImageUrl },
      );
      res.json({ imageUrl });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/content/projects/:projectId/articles/:articleId/publish', async (req, res) => {
    try {
      const decoded = await verifyFirebaseToken(req);
      const project = await loadProject(decoded.uid, req.params.projectId);
      const { destination } = (req.body ?? {}) as { destination?: 'blog' | 'wordpress' | 'sanity' };
      let url: string;
      if (destination === 'blog') {
        url = await publishToBlog(decoded.uid, req.params.projectId, req.params.articleId);
      } else if (destination === 'sanity' || (!destination && project.config.sanityProjectId)) {
        url = await publishToSanity(decoded.uid, req.params.projectId, req.params.articleId);
      } else {
        url = await publishToWordpress(decoded.uid, req.params.projectId, req.params.articleId);
      }
      res.json({ url });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/content/projects/:projectId/articles/:articleId/unpublish', async (req, res) => {
    try {
      const decoded = await verifyFirebaseToken(req);
      await unpublishArticle(decoded.uid, req.params.projectId, req.params.articleId);
      res.json({ ok: true });
    } catch (err) {
      sendError(res, err);
    }
  });

  // Diagnóstico: as últimas chamadas HTTP que a publicação fez para Sanity/WordPress,
  // com requisição, resposta e status. Mesmo espírito de GET /api/agent/logs.
  app.get('/api/content/projects/:projectId/publish-logs', async (req, res) => {
    try {
      const decoded = await verifyFirebaseToken(req);
      await loadProject(decoded.uid, req.params.projectId); // valida posse do projeto
      const limit = Math.min(Number(req.query.limit ?? 50), 200);
      const snap = await projectRef(decoded.uid, req.params.projectId)
        .collection('publishLogs').orderBy('at', 'desc').limit(limit).get();
      const logs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      res.json({ logs });
    } catch (err) {
      sendError(res, err);
    }
  });

  // "Verificar schema": amostra o dataset do Sanity pra descobrir quais _type
  // existem, sem depender de `sanity schema deploy` (a maioria dos projetos
  // nunca roda isso). É o que popula os selects de tipo de artigo/categoria
  // na integração em vez do usuário digitar de cabeça.
  app.get('/api/content/projects/:projectId/sanity/schema-types', async (req, res) => {
    try {
      const decoded = await verifyFirebaseToken(req);
      const types = await detectSanityTypes(decoded.uid, req.params.projectId);
      res.json({ types });
    } catch (err) {
      sendError(res, err);
    }
  });

  // Dado um _type (escolhido a partir de schema-types), lista os campos de um
  // documento de exemplo com um palpite de natureza (texto rico/referência/
  // string) — popula os selects de campo (corpo, categoria, nome da categoria).
  app.get('/api/content/projects/:projectId/sanity/schema-fields', async (req, res) => {
    try {
      const decoded = await verifyFirebaseToken(req);
      const type = String(req.query.type || '').trim();
      if (!type) return res.status(400).json({ error: 'type é obrigatório' });
      const fields = await detectSanityFields(decoded.uid, req.params.projectId, type);
      res.json({ fields });
    } catch (err) {
      sendError(res, err);
    }
  });

  // Autonomous scheduler entry point. Protected by a shared secret (Cloud Scheduler
  // sends it in the x-content-cron-secret header). Never gated by a user token.
  app.post('/api/content/cron/tick', async (req, res) => {
    const secret = process.env.CONTENT_CRON_SECRET;
    if (!secret || req.headers['x-content-cron-secret'] !== secret) {
      return res.status(401).json({ error: 'Não autorizado' });
    }
    try {
      const result = await runCronTick();
      res.json(result);
    } catch (err) {
      sendError(res, err);
    }
  });
}

// Runs a periodic tick in any environment when CONTENT_CRON_SECRET is set.
// Fires once on startup (to catch any overdue articles) then every hour.
// In production, also accepts external calls via POST /api/content/cron/tick
// (e.g. from Google Cloud Scheduler) for more precise scheduling.
export function startContentScheduler(): void {
  if (!process.env.CONTENT_CRON_SECRET) return;
  const ONE_HOUR = 60 * 60 * 1000;
  const tick = () => runCronTick().catch((e) => console.error('content scheduler tick failed:', e));
  tick();
  setInterval(tick, ONE_HOUR);
  console.log('Content scheduler started (immediate tick + hourly).');
}
