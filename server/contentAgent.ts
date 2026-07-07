// Backend for the "Agência de Criação de Conteúdo" (Alfred) module.
//
// Unlike the Product agent (which runs AI in the browser via Firebase AI Logic),
// the content pipeline runs server-side so it can execute autonomously on a
// schedule — without the user's browser open. AI calls use @google/genai with
// GEMINI_API_KEY; persistence + credit debit use the Admin SDK.

import type express from 'express';
import fs from 'fs';
import path from 'path';
import net from 'net';
import { lookup } from 'dns/promises';
import * as cheerio from 'cheerio';
import { GoogleGenAI } from '@google/genai';
import { adminDb } from './firebaseAdmin';
import { CREDIT_ACTIONS, resolveCreditCost, type CreditAction } from '../src/credits';
import type {
  ContentProject,
  ContentCluster,
  ClusterKeyword,
  CalendarArticle,
  ArticleStage,
} from '../src/modules/content/types';
import type { BlogPost, BlogSettings } from '../src/modules/content/blog/types';
import { slugify, uniqueSlug } from '../src/modules/content/blog/slug';

const TEXT_MODEL = 'gemini-2.5-flash';
const IMAGE_MODEL = 'gemini-2.5-flash-image';

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw Object.assign(new Error('GEMINI_API_KEY não configurada no servidor'), { status: 500 });
  }
  return new GoogleGenAI({ apiKey });
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

// Generates a cover image, returns raw base64 (no data: prefix).
async function generateImageBase64(prompt: string): Promise<string> {
  const ai = getClient();
  const resp = await withRetry(() =>
    ai.models.generateContent({
      model: IMAGE_MODEL,
      contents: prompt,
      config: { responseModalities: ['TEXT', 'IMAGE'] },
    }),
  );
  for (const candidate of resp.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      const data = (part as { inlineData?: { data?: string } }).inlineData?.data;
      if (data) return data;
    }
  }
  throw new Error('O modelo não retornou uma imagem.');
}

// Persists a base64 image to ./uploads and returns an absolute URL.
function saveImage(base64: string, uploadsDir: string, baseUrl: string): string {
  const filename = `content_${Date.now()}.png`;
  fs.writeFileSync(path.join(uploadsDir, filename), base64, 'base64');
  return `${baseUrl.replace(/\/+$/, '')}/uploads/${filename}`;
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

// Pulls a compact summary of the user's product catalog + categories so the AI
// can ground content in what the store actually sells (cross-module data share).
async function loadStoreContext(uid: string): Promise<string> {
  const userRef = adminDb.collection('users').doc(uid);
  const [prodSnap, catSnap] = await Promise.all([
    userRef.collection('products').limit(40).get(),
    userRef.collection('categories').limit(60).get(),
  ]);
  const products = prodSnap.docs
    .map((d) => {
      const p = d.data() as Record<string, unknown>;
      return (p['Nome'] || p['Descrição'] || p['Título SEO'] || '') as string;
    })
    .filter(Boolean)
    .slice(0, 40);
  const categories = catSnap.docs.map((d) => (d.data() as { name?: string }).name).filter(Boolean);
  const parts: string[] = [];
  if (products.length) parts.push(`Produtos do catálogo: ${products.join('; ')}`);
  if (categories.length) parts.push(`Categorias: ${categories.join('; ')}`);
  return parts.join('\n');
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

// SSRF guard: block private/loopback/link-local targets (mirrors server.ts).
function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || a === 0;
  }
  const v6 = ip.toLowerCase();
  if (v6 === '::1' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe8') || v6.startsWith('fe9') || v6.startsWith('fea') || v6.startsWith('feb')) return true;
  if (v6.startsWith('::ffff:')) return isPrivateIp(v6.slice(7));
  return false;
}

async function assertSafeUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw Object.assign(new Error('URL inválida'), { status: 400 });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw Object.assign(new Error('Protocolo não permitido'), { status: 400 });
  }
  const results = await lookup(url.hostname, { all: true });
  if (!results.length || results.some((r) => isPrivateIp(r.address))) {
    throw Object.assign(new Error('Destino não permitido'), { status: 400 });
  }
  return url;
}

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

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let html: string;
  try {
    const resp = await fetch(url.toString(), {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AlfredBot/1.0)' },
    });
    if (!resp.ok) throw Object.assign(new Error(`Não foi possível acessar o site (${resp.status})`), { status: 502 });
    html = await resp.text();
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw Object.assign(new Error('Tempo esgotado ao acessar o site'), { status: 504 });
    throw e;
  } finally {
    clearTimeout(timer);
  }

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

async function generateClusters(uid: string, project: ContentProject): Promise<ContentCluster[]> {
  const storeContext = await loadStoreContext(uid);
  const prompt = [
    'Pesquise o segmento da empresa e gere de 4 a 6 clusters temáticos estratégicos de conteúdo.',
    storeContext ? `Contexto da loja:\n${storeContext}` : '',
    'Para cada cluster, forneça:',
    '- "nome": o TEMA PRINCIPAL do cluster (curto).',
    '- "estrategia": uma descrição do tema abordado e por que importa (2 a 3 frases).',
    '- "palavrasChave": de 5 a 10 das PRINCIPAIS palavras-chave para atrair tráfego, cada uma classificada por intenção de pesquisa.',
    'A "intencao" deve ser uma de: "informacional", "comercial", "transacional", "navegacional".',
    'NÃO gere ideias de artigos.',
    'Responda ESTRITAMENTE em JSON no formato:',
    '[{"nome":"...","estrategia":"...","palavrasChave":[{"termo":"...","intencao":"informacional"}]}]',
  ]
    .filter(Boolean)
    .join('\n\n');

  const text = await generateGrounded(prompt, { systemInstruction: systemFor(project), temperature: 0.7 });
  const raw = parseJson<Array<{ nome: string; estrategia: string; palavrasChave: Array<{ termo: string; intencao: string }> }>>(text);
  const now = new Date().toISOString();

  const batch = adminDb.batch();
  const col = projectRef(uid, project.id).collection('clusters');
  const created: ContentCluster[] = raw.map((c) => {
    const ref = col.doc();
    const cluster: ContentCluster = {
      id: ref.id,
      nome: c.nome ?? 'Tema',
      estrategia: c.estrategia ?? '',
      palavrasChave: Array.isArray(c.palavrasChave)
        ? c.palavrasChave.filter((k) => k?.termo).map((k) => ({ termo: k.termo, intencao: normalizeIntent(k.intencao) }))
        : [],
      aprovado: false,
      excluido: false,
      createdAt: now,
    };
    const { id, ...data } = cluster;
    batch.set(ref, data);
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
    'Responda ESTRITAMENTE em JSON, já na ordem de prioridade desejada:',
    '[{"titulo":"...","kwPrincipal":"...","clusterId":"<id do cluster>"}]',
    '',
    `CLUSTERS:\n${JSON.stringify(clusterBrief)}`,
  ].join('\n');

  let topics: Array<{ titulo: string; kwPrincipal: string; clusterId: string }>;
  try {
    topics = parseJson<typeof topics>(await generateText(prompt, { systemInstruction: systemFor(project), temperature: 0.5 }));
    topics = (Array.isArray(topics) ? topics : []).filter((t) => t?.titulo && source.some((c) => c.id === t.clusterId));
    if (!topics.length) throw new Error('empty');
  } catch {
    // Fallback: one topic per cluster keyword.
    topics = source.flatMap((c) =>
      (c.palavrasChave ?? []).slice(0, 3).map((k) => ({ titulo: `${c.nome}: ${k.termo}`, kwPrincipal: k.termo, clusterId: c.id })),
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
  uploadsDir: string,
  baseUrl: string,
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
        `PESQUISA:\n${researchBrief}`,
      ].join('\n\n'),
      { systemInstruction: sys, temperature: 0.5 },
    );
    await setStage(2, { articleOutline });

    // ETAPA 3 — Draft
    const articleDraft = await generateText(
      [
        `Escreva o artigo completo em Markdown seguindo o outline abaixo, com 1.200 a 2.500 palavras.`,
        'Parágrafos curtos, subtítulos escaneáveis, KW principal no H1 e primeiro parágrafo, CTA ao final.',
        `OUTLINE:\n${articleOutline}`,
      ].join('\n\n'),
      { systemInstruction: sys, temperature: 0.7 },
    );
    await setStage(3, { articleDraft });

    // ETAPA 4 — Review + humanization
    const articleFinal = await generateText(
      [
        'Revise e humanize o artigo abaixo: elimine construções típicas de IA, adicione opiniões assertivas e exemplos concretos, mantenha o tom de voz.',
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
        `Marca: ${project.config.nomeEmpresa}. Formato 16:9, alta resolução.`,
      ].join(' ');
      const base64 = await generateImageBase64(imgPrompt);
      imageUrl = saveImage(base64, uploadsDir, baseUrl);
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

// ---------------------------------------------------------------------------
// Fase 5 — WordPress publishing
// ---------------------------------------------------------------------------

// Minimal Markdown→HTML good enough for WP body (headings, bold, paragraphs).
function markdownToHtml(md: string): string {
  return md
    .replace(/SLUG:.*$/im, '')
    .replace(/META:.*$/im, '')
    .replace(/^### (.*)$/gim, '<h3>$1</h3>')
    .replace(/^## (.*)$/gim, '<h2>$1</h2>')
    .replace(/^# (.*)$/gim, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .split(/\n{2,}/)
    .map((block) => (/^<h[1-3]>/.test(block.trim()) ? block.trim() : `<p>${block.trim().replace(/\n/g, '<br>')}</p>`))
    .join('\n');
}

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

  const postResp = await fetch(`${base}/wp-json/wp/v2/posts`, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: article.titulo,
      content: markdownToHtml(article.articleFinal),
      status: 'publish',
      slug: article.slug || undefined,
      excerpt: article.metaDescription || undefined,
      featured_media: featuredMedia,
    }),
  });
  if (!postResp.ok) {
    const body = await postResp.text();
    throw Object.assign(new Error(`Falha ao publicar no WordPress: ${postResp.status} — ${body}`), { status: 502 });
  }
  const post = (await postResp.json()) as { link: string };

  await debitCreditsAdmin(uid, CREDIT_ACTIONS.contentPublish, { productName: article.titulo });
  await artRef.update({
    status: 'publicado',
    urlPublicado: post.link,
    dataPublicacao: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return post.link;
}

async function publishToSanity(uid: string, projectId: string, articleId: string): Promise<string> {
  const project = await loadProject(uid, projectId);
  const { sanityProjectId, sanityDataset } = project.config;
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

  const mutations = [
    {
      createOrReplace: {
        _id: docId,
        _type: 'post',
        title: article.titulo,
        slug: { _type: 'slug', current: slug },
        body: markdownToPortableText(article.articleFinal),
        excerpt: article.metaDescription || undefined,
        publishedAt: new Date().toISOString(),
      },
    },
  ];

  const apiUrl = `https://${sanityProjectId}.api.sanity.io/v2021-10-21/data/mutate/${dataset}`;
  const mutateResp = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ mutations }),
  });

  if (!mutateResp.ok) {
    const body = await mutateResp.text();
    throw Object.assign(new Error(`Falha ao publicar no Sanity: ${mutateResp.status} — ${body}`), { status: 502 });
  }

  const documentUrl = `https://${sanityProjectId}.sanity.studio/desk/post;${docId}`;

  await debitCreditsAdmin(uid, CREDIT_ACTIONS.contentPublish, { productName: article.titulo });
  await artRef.update({
    status: 'publicado',
    urlPublicado: documentUrl,
    dataPublicacao: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  return documentUrl;
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

  const excerpt = (article.metaDescription || article.articleFinal.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ').trim().slice(0, 200);

  await postRef.set({
    title: article.titulo,
    slug,
    html: article.articleFinal,
    excerpt,
    coverImageUrl: article.imageUrl ?? '',
    categoryIds: [],
    status: 'published',
    publishedAt: now,
    seo: { metaTitle: article.titulo, metaDescription: article.metaDescription ?? '' },
    sourceArticleId: articleId,
    createdAt: existing.empty ? now : (existing.docs[0].data() as BlogPost).createdAt,
    updatedAt: now,
  }, { merge: true });

  // URL pública: domínio verificado (se houver) ou /b/{slug} na plataforma.
  const domainsSnap = await adminDb.collection('blogDomains')
    .where('uid', '==', uid).where('projectId', '==', projectId).where('verified', '==', true).limit(1).get();
  const base = domainsSnap.empty
    ? `${(process.env.APP_URL || '').replace(/\/+$/, '') || 'http://localhost:3000'}/b/${settings.slug}`
    : `https://${domainsSnap.docs[0].id}`;
  const url = `${base}/${slug}`;

  await debitCreditsAdmin(uid, CREDIT_ACTIONS.contentPublish, { productName: article.titulo });
  await artRef.update({
    status: 'publicado',
    urlPublicado: url,
    dataPublicacao: now,
    updatedAt: now,
  });

  return url;
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

async function runCronTick(uploadsDir: string, baseUrl: string): Promise<{ produced: number; errors: number }> {
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
      await runArticlePipeline(uid, projectId, doc.id, uploadsDir, baseUrl);
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
  uploadsDir: string;
}

function baseUrlFrom(req: express.Request): string {
  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol;
  return process.env.APP_URL && process.env.APP_URL !== 'MY_APP_URL'
    ? process.env.APP_URL
    : `${proto}://${req.headers.host}`;
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
  const { verifyFirebaseToken, uploadsDir } = deps;

  app.post('/api/content/projects/:id/generate-clusters', async (req, res) => {
    try {
      const decoded = await verifyFirebaseToken(req);
      const project = await loadProject(decoded.uid, req.params.id);
      await debitCreditsAdmin(decoded.uid, CREDIT_ACTIONS.contentClusters, {
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
      await runArticlePipeline(decoded.uid, req.params.projectId, req.params.articleId, uploadsDir, baseUrlFrom(req));
      res.json({ ok: true });
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

  // Autonomous scheduler entry point. Protected by a shared secret (Cloud Scheduler
  // sends it in the x-content-cron-secret header). Never gated by a user token.
  app.post('/api/content/cron/tick', async (req, res) => {
    const secret = process.env.CONTENT_CRON_SECRET;
    if (!secret || req.headers['x-content-cron-secret'] !== secret) {
      return res.status(401).json({ error: 'Não autorizado' });
    }
    try {
      const result = await runCronTick(uploadsDir, baseUrlFrom(req));
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
export function startContentScheduler(uploadsDir: string): void {
  if (!process.env.CONTENT_CRON_SECRET) return;
  const baseUrl =
    process.env.APP_URL && process.env.APP_URL !== 'MY_APP_URL'
      ? process.env.APP_URL
      : `http://localhost:${process.env.PORT || '3000'}`;
  const ONE_HOUR = 60 * 60 * 1000;
  const tick = () =>
    runCronTick(uploadsDir, baseUrl).catch((e) => console.error('content scheduler tick failed:', e));
  tick();
  setInterval(tick, ONE_HOUR);
  console.log('Content scheduler started (immediate tick + hourly).');
}
