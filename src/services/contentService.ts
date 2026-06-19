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
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import type {
  ContentProject,
  ContentProjectConfig,
  ContentCluster,
  CalendarArticle,
} from '../modules/content/types';

// ---------------------------------------------------------------------------
// Server calls (Bearer token, same pattern as CreditPurchaseModal)
// ---------------------------------------------------------------------------

async function callJson<T>(url: string, method: 'GET' | 'POST'): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new Error('Não autenticado');
  const token = await user.getIdToken();
  const resp = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
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

export const generateClusters = (projectId: string) =>
  postJson<{ clusters: ContentCluster[] }>(`/api/content/projects/${projectId}/generate-clusters`);

export const generateCalendar = (projectId: string) =>
  postJson<{ calendar: CalendarArticle[] }>(`/api/content/projects/${projectId}/generate-calendar`);

export const produceArticle = (projectId: string, articleId: string) =>
  postJson<{ ok: true }>(`/api/content/projects/${projectId}/articles/${articleId}/produce`);

export const publishArticle = (projectId: string, articleId: string) =>
  postJson<{ url: string }>(`/api/content/projects/${projectId}/articles/${articleId}/publish`);

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

// Stores the sensitive WordPress Application Password in a separate subdoc the
// client can write but never read back (Firestore rules: read=false).
export async function saveWordpressSecret(uid: string, projectId: string, appPassword: string): Promise<void> {
  await setDoc(doc(db, `users/${uid}/contentProjects/${projectId}/secrets/wordpress`), {
    appPassword,
    updatedAt: serverTimestamp(),
  });
}

export async function approveCluster(uid: string, projectId: string, clusterId: string, aprovado: boolean): Promise<void> {
  await updateDoc(doc(db, `users/${uid}/contentProjects/${projectId}/clusters/${clusterId}`), { aprovado });
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

export function listenCalendar(uid: string, projectId: string, cb: (articles: CalendarArticle[]) => void): () => void {
  const q = query(
    collection(db, `users/${uid}/contentProjects/${projectId}/calendar`),
    orderBy('scheduledDate', 'asc'),
  );
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CalendarArticle, 'id'>) })));
  });
}
