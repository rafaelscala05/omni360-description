// Client service do módulo Blog. CRUD direto no Firestore (owner-scoped pelas
// rules) + chamadas ao servidor para slug global e domínios (coleções raiz
// server-only). Mesmo padrão do contentService.ts.
import {
  collection, doc, addDoc, setDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import type { BlogSettings, BlogPost, BlogCategory } from '../modules/content/blog/types';

async function callJson<T>(url: string, method: 'POST' | 'DELETE', body?: unknown): Promise<T> {
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

const blogDoc = (uid: string, projectId: string) =>
  doc(db, `users/${uid}/contentProjects/${projectId}/blog/settings`);
const postsCol = (uid: string, projectId: string) =>
  collection(db, `users/${uid}/contentProjects/${projectId}/blogPosts`);
const catsCol = (uid: string, projectId: string) =>
  collection(db, `users/${uid}/contentProjects/${projectId}/blogCategories`);

export function listenBlogSettings(
  uid: string, projectId: string, cb: (s: BlogSettings | null) => void,
): () => void {
  return onSnapshot(blogDoc(uid, projectId), (snap) => cb(snap.exists() ? (snap.data() as BlogSettings) : null));
}

export async function saveBlogSettings(
  uid: string, projectId: string, patch: Partial<BlogSettings>,
): Promise<void> {
  await setDoc(blogDoc(uid, projectId), { ...patch, updatedAt: new Date().toISOString() }, { merge: true });
}

export function listenBlogPosts(
  uid: string, projectId: string, cb: (posts: BlogPost[]) => void,
): () => void {
  const q = query(postsCol(uid, projectId), orderBy('updatedAt', 'desc'));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ ...(d.data() as Omit<BlogPost, 'id'>), id: d.id }))));
}

export async function saveBlogPost(
  uid: string, projectId: string, post: Omit<BlogPost, 'id'> & { id?: string },
): Promise<string> {
  const { id, ...data } = post;
  const payload = { ...data, updatedAt: new Date().toISOString() };
  if (id) {
    await updateDoc(doc(postsCol(uid, projectId), id), payload);
    return id;
  }
  const ref = await addDoc(postsCol(uid, projectId), payload);
  return ref.id;
}

export async function deleteBlogPost(uid: string, projectId: string, postId: string): Promise<void> {
  await deleteDoc(doc(postsCol(uid, projectId), postId));
}

export function listenBlogCategories(
  uid: string, projectId: string, cb: (cats: BlogCategory[]) => void,
): () => void {
  const q = query(catsCol(uid, projectId), orderBy('name'));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ ...(d.data() as Omit<BlogCategory, 'id'>), id: d.id }))));
}

export async function saveBlogCategory(
  uid: string, projectId: string, cat: Omit<BlogCategory, 'id' | 'createdAt'> & { id?: string },
): Promise<string> {
  const { id, ...rest } = cat;
  // Firestore rejeita valores undefined em addDoc/updateDoc — remove as chaves.
  const data = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
  if (id) {
    await updateDoc(doc(catsCol(uid, projectId), id), data);
    return id;
  }
  const ref = await addDoc(catsCol(uid, projectId), { ...data, createdAt: new Date().toISOString() });
  return ref.id;
}

export async function deleteBlogCategory(uid: string, projectId: string, catId: string): Promise<void> {
  await deleteDoc(doc(catsCol(uid, projectId), catId));
}

export const claimBlogSlug = (projectId: string, slug: string) =>
  callJson<{ slug: string }>(`/api/blog/projects/${projectId}/claim-slug`, 'POST', { slug });

export const addBlogDomain = (projectId: string, domain: string) =>
  callJson<{ domain: string; cnameTarget: string; verified: boolean; detail?: string }>(
    `/api/blog/projects/${projectId}/domains`, 'POST', { domain },
  );

export const verifyBlogDomain = (projectId: string, domain: string) =>
  callJson<{ verified: boolean; detail?: string }>(
    `/api/blog/projects/${projectId}/domains/${encodeURIComponent(domain)}/verify`, 'POST',
  );

export const removeBlogDomain = (projectId: string, domain: string) =>
  callJson<{ ok: true }>(`/api/blog/projects/${projectId}/domains/${encodeURIComponent(domain)}`, 'DELETE');
