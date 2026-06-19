// Backend for the "Agência de Criação de Conteúdo" (Alfred) module.
//
// Unlike the Product agent (which runs AI in the browser via Firebase AI Logic),
// the content pipeline runs server-side so it can execute autonomously on a
// schedule — without the user's browser open. AI calls use @google/genai with
// GEMINI_API_KEY; persistence + credit debit use the Admin SDK.

import type express from 'express';
import fs from 'fs';
import path from 'path';
import { GoogleGenAI } from '@google/genai';
import { adminDb } from './firebaseAdmin';
import { CREDIT_ACTIONS, resolveCreditCost, type CreditAction } from '../src/credits';
import type {
  ContentProject,
  ContentCluster,
  CalendarArticle,
  ArticleStage,
} from '../src/modules/content/types';

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

function systemFor(project: ContentProject): string {
  const c = project.config;
  return [
    'Você é Alfred, um agente sênior de marketing de conteúdo.',
    `Empresa: ${c.nomeEmpresa}. ${c.descricao}`,
    `Produto/serviço principal: ${c.produtoServico}.`,
    `Público-alvo: ${c.publicoAlvo}.`,
    `Tom de voz: ${c.tomDeVoz}.`,
    c.objetivos?.length ? `Objetivos: ${c.objetivos.join(', ')}.` : '',
    c.palavrasChave?.length ? `Palavras-chave alvo: ${c.palavrasChave.join(', ')}.` : '',
    'Escreva sempre em português do Brasil.',
  ]
    .filter(Boolean)
    .join('\n');
}

// ---------------------------------------------------------------------------
// Fase 2 — Clusters
// ---------------------------------------------------------------------------

async function generateClusters(uid: string, project: ContentProject): Promise<ContentCluster[]> {
  const storeContext = await loadStoreContext(uid);
  const prompt = [
    'Pesquise o segmento da empresa e gere de 4 a 6 clusters temáticos estratégicos de conteúdo.',
    storeContext ? `Contexto da loja:\n${storeContext}` : '',
    'Para cada cluster: nome, estratégia (por que importa) e de 5 a 8 ideias de artigos com título e palavra-chave principal.',
    'Responda ESTRITAMENTE em JSON no formato:',
    '[{"nome":"...","estrategia":"...","artigos":[{"titulo":"...","kw":"..."}]}]',
  ]
    .filter(Boolean)
    .join('\n\n');

  const text = await generateGrounded(prompt, { systemInstruction: systemFor(project), temperature: 0.7 });
  const raw = parseJson<Array<{ nome: string; estrategia: string; artigos: Array<{ titulo: string; kw: string }> }>>(text);
  const now = new Date().toISOString();

  const batch = adminDb.batch();
  const col = projectRef(uid, project.id).collection('clusters');
  const created: ContentCluster[] = raw.map((c) => {
    const ref = col.doc();
    const cluster: ContentCluster = {
      id: ref.id,
      nome: c.nome ?? 'Cluster',
      estrategia: c.estrategia ?? '',
      artigos: Array.isArray(c.artigos) ? c.artigos : [],
      aprovado: false,
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
  const clusters = clustersSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ContentCluster, 'id'>) }));
  const approved = clusters.filter((c) => c.aprovado);
  const source = approved.length ? approved : clusters;

  // Flatten all article ideas, tagging each with its cluster id.
  const ideas = source.flatMap((c) => c.artigos.map((a) => ({ ...a, clusterId: c.id })));
  if (!ideas.length) throw Object.assign(new Error('Nenhum cluster com artigos para agendar'), { status: 400 });

  // Ask the AI to prioritize; assign dates deterministically in code.
  const prompt = [
    'Priorize estas ideias de artigos por relevância estratégica e potencial de busca.',
    'Responda ESTRITAMENTE em JSON como um array de índices (0-based) na nova ordem:',
    JSON.stringify(ideas.map((i, idx) => ({ idx, titulo: i.titulo, kw: i.kw }))),
    'Exemplo de resposta: [3,0,1,2]',
  ].join('\n\n');

  let order: number[];
  try {
    order = parseJson<number[]>(await generateText(prompt, { systemInstruction: systemFor(project), temperature: 0.3 }));
    if (!Array.isArray(order) || order.length !== ideas.length) throw new Error('bad');
  } catch {
    order = ideas.map((_, i) => i); // fallback: keep original order
  }

  const interval = frequencyToIntervalDays(project.config.frequenciaPostagens);
  const now = new Date().toISOString();
  const batch = adminDb.batch();
  const col = projectRef(uid, project.id).collection('calendar');

  const created: CalendarArticle[] = order.map((origIdx, position) => {
    const idea = ideas[origIdx];
    const date = new Date();
    date.setDate(date.getDate() + (position + 1) * interval);
    const ref = col.doc();
    const article: CalendarArticle = {
      id: ref.id,
      titulo: idea.titulo,
      kwPrincipal: idea.kw,
      clusterId: idea.clusterId,
      scheduledDate: toIsoDate(date),
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

    // ETAPA 4 — Cover image
    let imageUrl: string | undefined;
    try {
      const imgPrompt = [
        `Imagem de capa para um artigo de blog sobre "${article.titulo}".`,
        'Composição limpa, elementos simbólicos do tema, sem texto e sem rostos hiperrealistas.',
        `Estilo alinhado à marca ${project.config.nomeEmpresa}. Formato 16:9, alta resolução.`,
      ].join(' ');
      const base64 = await generateImageBase64(imgPrompt);
      imageUrl = saveImage(base64, uploadsDir, baseUrl);
      await debitCreditsAdmin(uid, CREDIT_ACTIONS.contentImage, { productName: article.titulo });
    } catch (e) {
      console.error('content image generation failed:', e);
    }
    await setStage(4, { imageUrl });

    // ETAPA 5 — Review + humanization
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

    await debitCreditsAdmin(uid, CREDIT_ACTIONS.contentArticle, { productName: article.titulo });
    await artRef.update({
      stage: 5,
      status: 'revisao',
      articleFinal,
      slug: slug ?? null,
      metaDescription: metaDescription ?? null,
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
      const url = await publishToWordpress(decoded.uid, req.params.projectId, req.params.articleId);
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

// In development only, run the tick periodically so autonomous production can be
// tested locally without Cloud Scheduler. Cloud Run scales to zero, so this is
// NOT relied upon in production (Cloud Scheduler hits the endpoint instead).
export function startContentScheduler(uploadsDir: string): void {
  if (process.env.NODE_ENV === 'production') return;
  if (!process.env.CONTENT_CRON_SECRET) return;
  const baseUrl =
    process.env.APP_URL && process.env.APP_URL !== 'MY_APP_URL'
      ? process.env.APP_URL
      : `http://localhost:${process.env.PORT || '3000'}`;
  const ONE_HOUR = 60 * 60 * 1000;
  setInterval(() => {
    runCronTick(uploadsDir, baseUrl).catch((e) => console.error('dev content scheduler tick failed:', e));
  }, ONE_HOUR);
  console.log('Dev content scheduler started (hourly tick).');
}
