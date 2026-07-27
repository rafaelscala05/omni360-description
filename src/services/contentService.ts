// Client service for the "Agência de Criação de Conteúdo" (Alfred) module.
//
// CRUD + realtime listeners go straight to Firestore (owner-scoped by rules);
// AI/pipeline/publish operations call the server (which runs the AI, debits
// credits, and writes results back — reflected here via the listeners).

import {
  collection,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  getDocs,
  onSnapshot,
  query,
  orderBy,
  limit as fsLimit,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import type {
  ContentProject,
  ContentProjectConfig,
  ContentCluster,
  CalendarArticle,
  ArticleSize,
  SeoAudit,
} from '../modules/content/types';

// ---------------------------------------------------------------------------
// Server calls (Bearer token, same pattern as CreditPurchaseModal)
// ---------------------------------------------------------------------------

async function callJson<T>(url: string, method: 'GET' | 'POST', body?: unknown): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new Error('Não autenticado');
  const token = await user.getIdToken();
  const resp = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error || `Erro ${resp.status}`);
  }
  return resp.json() as Promise<T>;
}

const postJson = <T>(url: string) => callJson<T>(url, 'POST');

// Approved/published articles available to reuse in product descriptions.
export const listReusableArticles = () =>
  callJson<{ articles: Array<{ id: string; titulo: string; articleFinal: string }> }>(
    '/api/content/articles/reusable',
    'GET',
  );

// Analyzes a website with AI and returns an inferred company profile.
export interface ScannedConfig {
  nomeEmpresa?: string;
  descricao?: string;
  produtoServico?: string;
  publicoAlvo?: string[];
  tomDeVoz?: string;
  objetivos?: string[];
  palavrasChave?: string[];
}

export const scanWebsite = (url: string) =>
  callJson<{ config: ScannedConfig }>('/api/content/scan-website', 'POST', { url });

export const generateClusters = (projectId: string) =>
  postJson<{ clusters: ContentCluster[] }>(`/api/content/projects/${projectId}/generate-clusters`);

export const generateCalendar = (projectId: string) =>
  postJson<{ calendar: CalendarArticle[] }>(`/api/content/projects/${projectId}/generate-calendar`);

// Triggers a full SE Ranking site audit for the project's configured siteUrl.
export const triggerSeoAudit = (projectId: string) =>
  postJson<{ audit: SeoAudit }>(`/api/content/projects/${projectId}/seo-audit`);

// Polls SE Ranking for the crawl's current status; no-op (and free) once finished/failed.
export const refreshSeoAudit = (projectId: string, auditId: string) =>
  postJson<{ audit: SeoAudit }>(`/api/content/projects/${projectId}/seo-audit/${auditId}/refresh`);

// Stops waiting on a slow/stuck crawl — marks it canceled locally (free, no SE
// Ranking-side cancellation). Domain Analysis is unaffected, it resolves independently.
export const cancelSeoAudit = (projectId: string, auditId: string) =>
  postJson<{ audit: SeoAudit }>(`/api/content/projects/${projectId}/seo-audit/${auditId}/cancel`);

export const produceArticle = (projectId: string, articleId: string) =>
  postJson<{ ok: true }>(`/api/content/projects/${projectId}/articles/${articleId}/produce`);

export const publishArticle = (
  projectId: string,
  articleId: string,
  destination?: 'blog' | 'wordpress' | 'sanity',
) =>
  callJson<{ url: string }>(
    `/api/content/projects/${projectId}/articles/${articleId}/publish`,
    'POST',
    destination ? { destination } : undefined,
  );

export type RegenerateImagePayload =
  | { mode: 'improve'; improvementPrompt: string }
  | { mode: 'fromProduct'; baseProductImageUrl: string };

export const regenerateArticleImage = (
  projectId: string,
  articleId: string,
  payload: RegenerateImagePayload,
) =>
  callJson<{ imageUrl: string }>(
    `/api/content/projects/${projectId}/articles/${articleId}/regenerate-image`,
    'POST',
    payload,
  );

// ---------------------------------------------------------------------------
// Firestore CRUD
// ---------------------------------------------------------------------------

function projectsCol(uid: string) {
  return collection(db, `users/${uid}/contentProjects`);
}

export async function createProject(uid: string, config: ContentProjectConfig): Promise<string> {
  const now = new Date().toISOString();
  const ref = await addDoc(projectsCol(uid), {
    config,
    status: 'ativo',
    ownerId: uid,
    createdAt: now,
    updatedAt: now,
  });
  return ref.id;
}

export async function updateProjectConfig(uid: string, projectId: string, config: ContentProjectConfig): Promise<void> {
  await updateDoc(doc(db, `users/${uid}/contentProjects/${projectId}`), {
    config,
    updatedAt: new Date().toISOString(),
  });
}

export async function renameProject(uid: string, projectId: string, nomeEmpresa: string): Promise<void> {
  await updateDoc(doc(db, `users/${uid}/contentProjects/${projectId}`), {
    'config.nomeEmpresa': nomeEmpresa,
    updatedAt: new Date().toISOString(),
  });
}

const PROJECT_SUBCOLLECTIONS = ['clusters', 'calendar', 'seoAudits', 'blogPosts', 'blogCategories'] as const;
const PROJECT_FIXED_DOCS = ['secrets/wordpress', 'secrets/sanity', 'blog/settings'] as const;

export async function deleteProject(uid: string, projectId: string): Promise<void> {
  const base = `users/${uid}/contentProjects/${projectId}`;
  const refsToDelete: ReturnType<typeof doc>[] = [];

  for (const sub of PROJECT_SUBCOLLECTIONS) {
    const snap = await getDocs(collection(db, `${base}/${sub}`));
    snap.forEach((d) => refsToDelete.push(d.ref));
  }
  for (const fixedPath of PROJECT_FIXED_DOCS) {
    refsToDelete.push(doc(db, `${base}/${fixedPath}`));
  }
  refsToDelete.push(doc(db, base));

  const CHUNK = 500;
  for (let i = 0; i < refsToDelete.length; i += CHUNK) {
    const batch = writeBatch(db);
    for (const ref of refsToDelete.slice(i, i + CHUNK)) {
      batch.delete(ref);
    }
    await batch.commit();
  }
}

// Stores the sensitive WordPress Application Password in a separate subdoc the
// client can write but never read back (Firestore rules: read=false).
export async function saveWordpressSecret(uid: string, projectId: string, appPassword: string): Promise<void> {
  await setDoc(doc(db, `users/${uid}/contentProjects/${projectId}/secrets/wordpress`), {
    appPassword,
    updatedAt: serverTimestamp(),
  });
}

// Stores the sensitive Sanity API Token in a separate subdoc the
// client can write but never read back (Firestore rules: read=false).
export async function saveSanitySecret(uid: string, projectId: string, apiToken: string): Promise<void> {
  await setDoc(doc(db, `users/${uid}/contentProjects/${projectId}/secrets/sanity`), {
    apiToken,
    updatedAt: serverTimestamp(),
  });
}

export async function approveCluster(uid: string, projectId: string, clusterId: string, aprovado: boolean): Promise<void> {
  await updateDoc(doc(db, `users/${uid}/contentProjects/${projectId}/clusters/${clusterId}`), { aprovado });
}

// Edits only the cluster's main theme name.
export async function updateClusterName(uid: string, projectId: string, clusterId: string, nome: string): Promise<void> {
  await updateDoc(doc(db, `users/${uid}/contentProjects/${projectId}/clusters/${clusterId}`), { nome });
}

export async function updateClusterKeywords(
  uid: string,
  projectId: string,
  clusterId: string,
  keywords: import('../modules/content/types').ClusterKeyword[],
): Promise<void> {
  await updateDoc(
    doc(db, `users/${uid}/contentProjects/${projectId}/clusters/${clusterId}`),
    { palavrasChave: keywords },
  );
}

// Soft-delete: keeps the document (and any linked articles) but removes the
// cluster from the active listing. Linked articles surface under "Sem cluster".
export async function excludeCluster(uid: string, projectId: string, clusterId: string): Promise<void> {
  await updateDoc(doc(db, `users/${uid}/contentProjects/${projectId}/clusters/${clusterId}`), { excluido: true, aprovado: false });
}

export async function updateArticle(
  uid: string,
  projectId: string,
  articleId: string,
  fields: Partial<CalendarArticle>,
): Promise<void> {
  await updateDoc(doc(db, `users/${uid}/contentProjects/${projectId}/calendar/${articleId}`), {
    ...fields,
    updatedAt: new Date().toISOString(),
  });
}

export async function moveArticle(
  uid: string,
  projectId: string,
  articleId: string,
  novoClusterId: string,
): Promise<void> {
  await updateDoc(doc(db, `users/${uid}/contentProjects/${projectId}/calendar/${articleId}`), {
    clusterId: novoClusterId,
    updatedAt: new Date().toISOString(),
  });
}

// Manual (non-AI) cluster creation. Entra pronto para uso (aprovado=true) já
// que o próprio usuário definiu o tema — sem etapa de aprovação como os
// clusters gerados por IA. Palavras-chave podem ser adicionadas depois em
// ClusterDetailView.
export async function createClusterManual(
  uid: string,
  projectId: string,
  data: { nome: string; estrategia: string },
): Promise<string> {
  const ref = await addDoc(collection(db, `users/${uid}/contentProjects/${projectId}/clusters`), {
    nome: data.nome,
    estrategia: data.estrategia,
    palavrasChave: [],
    aprovado: true,
    excluido: false,
    createdAt: new Date().toISOString(),
  });
  return ref.id;
}

export interface ManualArticleInput {
  titulo: string;
  kwPrincipal: string;
  tamanho: ArticleSize;
  scheduledDate: string;
  clusterId: string; // '' quando criado sem cluster
  produtosVinculados: string[];
  priority: number;
}

// Cria só a "ficha" do artigo (sem disparar o pipeline de IA) — status/stage
// iniciais idênticos a um artigo recém-gerado pelo calendário, para que as
// ações já existentes em ArticleView (gerar pesquisa, outline, etc.)
// funcionem sem diferenciação de origem.
export async function createArticleManual(
  uid: string,
  projectId: string,
  data: ManualArticleInput,
): Promise<string> {
  const now = new Date().toISOString();
  const ref = await addDoc(collection(db, `users/${uid}/contentProjects/${projectId}/calendar`), {
    titulo: data.titulo,
    kwPrincipal: data.kwPrincipal,
    clusterId: data.clusterId,
    scheduledDate: data.scheduledDate,
    tamanho: data.tamanho,
    produtosVinculados: data.produtosVinculados,
    status: 'agendado',
    stage: 0,
    priority: data.priority,
    createdAt: now,
    updatedAt: now,
  });
  return ref.id;
}

// Persists new priority values after a drag-and-drop reorder (or the
// one-time migration that backfills missing priorities). Chunked at 20
// writes per batch, same convention as App.tsx's saveToCloud.
export async function updateArticlesPriority(
  uid: string,
  projectId: string,
  updates: { id: string; priority: number }[],
): Promise<void> {
  let batch = writeBatch(db);
  let opCount = 0;
  for (const { id, priority } of updates) {
    batch.update(doc(db, `users/${uid}/contentProjects/${projectId}/calendar/${id}`), {
      priority,
      updatedAt: new Date().toISOString(),
    });
    opCount++;
    if (opCount >= 20) {
      await batch.commit();
      batch = writeBatch(db);
      opCount = 0;
    }
  }
  if (opCount > 0) await batch.commit();
}

// ---------------------------------------------------------------------------
// Product linking (Content module has no other visibility into the Product
// domain — this reads users/{uid}/products directly, same path App.tsx uses,
// no new server endpoint needed).
// ---------------------------------------------------------------------------

export interface LinkableProduct {
  id: string;
  nome: string;
  sku: string;
  imagemPrincipal?: string;
}

export async function listProductsForLinking(uid: string): Promise<LinkableProduct[]> {
  const snap = await getDocs(collection(db, `users/${uid}/products`));
  return snap.docs.map((d) => {
    const data = d.data() as Record<string, unknown>;
    const selectedImage = typeof data._selectedImage === 'string' ? data._selectedImage : undefined;
    const firstImage = typeof data['URL imagem 1'] === 'string' ? (data['URL imagem 1'] as string) : undefined;
    const id = (typeof data._id === 'string' && data._id) || d.id;
    const nome = (typeof data['Descrição'] === 'string' && data['Descrição']) || '(sem nome)';
    const sku = (typeof data['Código (SKU)'] === 'string' && data['Código (SKU)']) || '';
    return { id, nome, sku, imagemPrincipal: selectedImage || firstImage };
  });
}

// ---------------------------------------------------------------------------
// Realtime listeners
// ---------------------------------------------------------------------------

export function listenProjects(uid: string, cb: (projects: ContentProject[]) => void): () => void {
  return onSnapshot(projectsCol(uid), (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ContentProject, 'id'>) })));
  });
}

export function listenClusters(uid: string, projectId: string, cb: (clusters: ContentCluster[]) => void): () => void {
  return onSnapshot(collection(db, `users/${uid}/contentProjects/${projectId}/clusters`), (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ContentCluster, 'id'>) })));
  });
}

export function listenLatestSeoAudit(uid: string, projectId: string, cb: (audit: SeoAudit | null) => void): () => void {
  const q = query(
    collection(db, `users/${uid}/contentProjects/${projectId}/seoAudits`),
    orderBy('createdAt', 'desc'),
    fsLimit(1),
  );
  return onSnapshot(
    q,
    (snap) => {
      const doc0 = snap.docs[0];
      cb(doc0 ? ({ id: doc0.id, ...(doc0.data() as Omit<SeoAudit, 'id'>) }) : null);
    },
    (err) => console.error('listenLatestSeoAudit falhou (regras do Firestore desatualizadas?):', err),
  );
}

export function listenCalendar(uid: string, projectId: string, cb: (articles: CalendarArticle[]) => void): () => void {
  const q = query(
    collection(db, `users/${uid}/contentProjects/${projectId}/calendar`),
    orderBy('scheduledDate', 'asc'),
  );
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CalendarArticle, 'id'>) })));
  });
}
