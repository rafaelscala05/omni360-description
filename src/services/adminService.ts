// Client do CRM admin. Todo acesso a dados de outro usuário passa por
// /api/admin/* — as coleções do CRM são negadas ao client nas rules, então o
// servidor (Admin SDK) é a única porta de entrada.
//
// Mesmo padrão de fetch de src/services/referralService.ts.

import { auth } from '../firebase';
import type {
  AdminStats,
  CrmNote,
  CrmSummary,
  CrmTask,
  CustomerDetailPayload,
  CustomerListItem,
  PipelineStatus,
  TimelineEntry,
} from '../types/crm';

async function call<T>(
  url: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = 'GET',
  body?: unknown,
): Promise<T> {
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

export interface CustomerFilters {
  stage?: string;
  health?: string;
  pipeline?: string;
  q?: string;
  stagnant?: boolean;
}

export const checkAdmin = () => call<{ admin: boolean; uid: string; name: string }>('/api/admin/me');

export const getStats = () => call<AdminStats>('/api/admin/stats');

export function listCustomers(filters: CustomerFilters = {}) {
  const qs = new URLSearchParams();
  if (filters.stage) qs.set('stage', filters.stage);
  if (filters.health) qs.set('health', filters.health);
  if (filters.pipeline) qs.set('pipeline', filters.pipeline);
  if (filters.q) qs.set('q', filters.q);
  if (filters.stagnant) qs.set('stagnant', 'true');
  const suffix = qs.toString() ? `?${qs}` : '';
  return call<{ customers: CustomerListItem[] }>(`/api/admin/customers${suffix}`);
}

export const getCustomer = (uid: string) => call<CustomerDetailPayload>(`/api/admin/customers/${uid}`);

export const getTimeline = (uid: string) =>
  call<{ entries: TimelineEntry[] }>(`/api/admin/customers/${uid}/timeline`);

export const setPipeline = (uid: string, status: PipelineStatus) =>
  call<{ ok: boolean }>(`/api/admin/customers/${uid}/pipeline`, 'POST', { status });

export const setTags = (uid: string, tags: string[]) =>
  call<{ ok: boolean; tags: string[] }>(`/api/admin/customers/${uid}/tags`, 'POST', { tags });

export const adjustCredits = (uid: string, delta: number, reason: string) =>
  call<{ ok: boolean; credits: number }>(`/api/admin/customers/${uid}/credits`, 'POST', { delta, reason });

export const listNotes = (uid: string) => call<{ notes: CrmNote[] }>(`/api/admin/customers/${uid}/notes`);

export const addNote = (uid: string, body: string) =>
  call<{ ok: boolean; id: string }>(`/api/admin/customers/${uid}/notes`, 'POST', { body });

export const deleteNote = (uid: string, noteId: string) =>
  call<{ ok: boolean }>(`/api/admin/customers/${uid}/notes/${noteId}`, 'DELETE');

export const listTasks = (onlyOpen = false) =>
  call<{ tasks: CrmTask[] }>(`/api/admin/tasks${onlyOpen ? '?open=true' : ''}`);

export const addTask = (input: { uid: string; title: string; dueDate: string }) =>
  call<{ ok: boolean; id: string }>('/api/admin/tasks', 'POST', input);

export const toggleTask = (id: string, done: boolean) =>
  call<{ ok: boolean }>(`/api/admin/tasks/${id}`, 'PATCH', { done });

export const reconcile = (uid?: string) =>
  call<{ ok: boolean; processed?: number; failed?: number; crm?: CrmSummary }>(
    '/api/admin/reconcile',
    'POST',
    uid ? { uid } : {},
  );
