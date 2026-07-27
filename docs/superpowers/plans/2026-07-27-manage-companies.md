# Manage Companies (Gerenciar Empresas) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user rename or delete a "company" (`ContentProject`) from a new management screen reached via the project-selector dropdown in the Agente de Conteúdo module.

**Architecture:** Two new Firestore-backed functions in `contentService.ts` (`renameProject`, `deleteProject` with cascade cleanup of every subcollection under the project), a new full-screen overlay component `CompanyManager.tsx` that lists projects and calls those functions, and a small wiring change in `ContentApp.tsx` to open the overlay and to correct stale-selection handling when the selected project disappears.

**Tech Stack:** React 19, TypeScript, Firebase Firestore (modular SDK: `collection`, `getDocs`, `doc`, `updateDoc`, `writeBatch`), Tailwind CSS v4, lucide-react icons.

## Global Constraints

- No automated test suite exists in this repo (per `CLAUDE.md`) — validation is manual via `npm run dev`. Every task ends with a manual verification step instead of an automated test run.
- All UI text is pt-BR, matching existing copy conventions in `ContentApp.tsx` / `CategoryManager.tsx`.
- `npm run lint` (`tsc --noEmit`) must pass after every task that touches `.ts`/`.tsx` files.
- Firestore batched writes are capped at 500 operations per batch — `deleteProject` must chunk accordingly.

---

### Task 1: `renameProject` and `deleteProject` in `contentService.ts`

**Files:**
- Modify: `src/services/contentService.ts` (add after `updateProjectConfig`, around line 147)

**Interfaces:**
- Consumes: existing `db` import, existing `projectsCol(uid)` helper (line 126), Firestore modular SDK functions already imported at the top of the file (`collection`, `doc`, `updateDoc`, `addDoc`, `setDoc`, `serverTimestamp` — confirm `getDocs` and `writeBatch` are imported; add them to the existing `firebase/firestore` import if missing).
- Produces:
  - `renameProject(uid: string, projectId: string, nomeEmpresa: string): Promise<void>`
  - `deleteProject(uid: string, projectId: string): Promise<void>`
  Both are consumed by `CompanyManager.tsx` in Task 2.

- [ ] **Step 1: Check existing Firestore imports**

Read the top of `src/services/contentService.ts` and confirm whether `getDocs` and `writeBatch` are already imported from `firebase/firestore`. If not, add them to the existing import statement.

- [ ] **Step 2: Add `renameProject`**

Insert directly after `updateProjectConfig` (after line 147):

```ts
export async function renameProject(uid: string, projectId: string, nomeEmpresa: string): Promise<void> {
  await updateDoc(doc(db, `users/${uid}/contentProjects/${projectId}`), {
    'config.nomeEmpresa': nomeEmpresa,
    updatedAt: new Date().toISOString(),
  });
}
```

- [ ] **Step 3: Add `deleteProject`**

Insert directly after `renameProject`:

```ts
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
```

- [ ] **Step 4: Type-check**

Run: `npm run lint`
Expected: no new TypeScript errors from `contentService.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/services/contentService.ts
git commit -m "feat(content): add renameProject and cascading deleteProject"
```

---

### Task 2: `CompanyManager.tsx` overlay component

**Files:**
- Create: `src/modules/content/CompanyManager.tsx`

**Interfaces:**
- Consumes: `ContentProject` type from `./types`; `renameProject`, `deleteProject` from `../../services/contentService` (Task 1).
- Produces: default export `CompanyManager({ uid, projects, onClose }: { uid: string; projects: ContentProject[]; onClose: () => void })`, consumed by `ContentApp.tsx` in Task 3.

- [ ] **Step 1: Write the component**

```tsx
import React, { useState } from 'react';
import { X, Edit, Trash2, Save, Loader2, Building2 } from 'lucide-react';
import type { ContentProject } from './types';
import { renameProject, deleteProject } from '../../services/contentService';

interface Props {
  uid: string;
  projects: ContentProject[];
  onClose: () => void;
}

const CompanyManager: React.FC<Props> = ({ uid, projects, onClose }) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const startEdit = (p: ContentProject) => {
    setEditingId(p.id);
    setDraftName(p.config.nomeEmpresa);
    setConfirmingDeleteId(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraftName('');
  };

  const saveEdit = async (id: string) => {
    const name = draftName.trim();
    if (!name) return;
    setBusyId(id);
    try {
      await renameProject(uid, id, name);
      setEditingId(null);
    } finally {
      setBusyId(null);
    }
  };

  const confirmDelete = async (id: string) => {
    setBusyId(id);
    try {
      await deleteProject(uid, id);
      setConfirmingDeleteId(null);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-white flex flex-col animate-in fade-in duration-200">
      <header className="h-16 bg-white border-b border-slate-200 px-4 md:px-6 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <Building2 className="w-5 h-5 text-slate-400 shrink-0" />
          <h1 className="text-lg font-bold text-slate-900 truncate">Gerenciar empresas</h1>
        </div>
        <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500 transition-colors shrink-0">
          <X className="w-5 h-5" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-[#f7f9fb]">
        <div className="max-w-2xl mx-auto flex flex-col gap-2">
          {projects.map((p) => (
            <div key={p.id} className="bg-white border border-slate-200 rounded-xl p-4">
              {editingId === p.id ? (
                <div className="flex items-center gap-2">
                  <input
                    autoFocus
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#FF5B03]/30"
                  />
                  <button
                    onClick={() => saveEdit(p.id)}
                    disabled={busyId === p.id || !draftName.trim()}
                    className="p-2 rounded-lg bg-[#FF5B03] text-white hover:bg-[#E14E00] disabled:opacity-50 transition-colors"
                  >
                    {busyId === p.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  </button>
                  <button onClick={cancelEdit} className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 transition-colors">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : confirmingDeleteId === p.id ? (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm text-slate-700">
                    Excluir <strong>{p.config.nomeEmpresa}</strong> e todos os seus dados (clusters, artigos, calendário, blog)? Esta ação não pode ser desfeita.
                  </p>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => confirmDelete(p.id)}
                      disabled={busyId === p.id}
                      className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-700 disabled:opacity-50 transition-colors"
                    >
                      {busyId === p.id ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Excluir'}
                    </button>
                    <button
                      onClick={() => setConfirmingDeleteId(null)}
                      className="px-3 py-1.5 rounded-lg text-slate-600 text-xs font-medium hover:bg-slate-100 transition-colors"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-slate-900 truncate">{p.config.nomeEmpresa}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => startEdit(p)} className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 transition-colors" title="Renomear">
                      <Edit className="w-4 h-4" />
                    </button>
                    <button onClick={() => setConfirmingDeleteId(p.id)} className="p-2 rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-600 transition-colors" title="Excluir">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default CompanyManager;
```

- [ ] **Step 2: Type-check**

Run: `npm run lint`
Expected: no TypeScript errors from the new file.

- [ ] **Step 3: Commit**

```bash
git add src/modules/content/CompanyManager.tsx
git commit -m "feat(content): add CompanyManager overlay to rename/delete companies"
```

---

### Task 3: Wire into `ContentApp.tsx`

**Files:**
- Modify: `src/modules/content/ContentApp.tsx`

**Interfaces:**
- Consumes: `CompanyManager` default export from `./CompanyManager` (Task 2).

- [ ] **Step 1: Import `CompanyManager` and add state**

At the top imports (near line 15, alongside `CompanyProfile`):

```ts
import CompanyManager from './CompanyManager';
```

Near the other `useState` declarations (line 38, after `projectMenuOpen`):

```ts
const [managingCompanies, setManagingCompanies] = useState(false);
```

- [ ] **Step 2: Add the "Gerenciar empresas" button to the dropdown**

In the dropdown block (lines 114-132), insert a new button between the `projects.map(...)` list and the "Novo projeto" button:

```tsx
<button
  onClick={() => { setManagingCompanies(true); setProjectMenuOpen(false); }}
  className="w-full text-left px-3 py-2 text-sm text-slate-300 hover:bg-white/10 border-t border-white/10"
>
  Gerenciar empresas
</button>
```

- [ ] **Step 3: Fix stale-selection fallback in `listenProjects` callback**

Replace the callback at lines 43-49:

```tsx
useEffect(() =>
  listenProjects(uid, (list) => {
    setProjects(list);
    setReady(true);
    setSelectedId((prev) => (prev && list.some((p) => p.id === prev)) ? prev : (list[0]?.id ?? null));
  }),
[uid]);
```

- [ ] **Step 4: Render the overlay**

At the end of the root returned `<div>` (after the closing `</div>` of the "Main" flex container, before the outer div closes, around line 223), add:

```tsx
{managingCompanies && (
  <CompanyManager uid={uid} projects={projects} onClose={() => setManagingCompanies(false)} />
)}
```

- [ ] **Step 5: Type-check**

Run: `npm run lint`
Expected: no TypeScript errors.

- [ ] **Step 6: Manual verification**

Run: `npm run dev`
In the browser: open the Agente de Conteúdo, open the project dropdown, click "Gerenciar empresas" — verify the overlay opens listing all companies. Rename one company and confirm the name updates in the dropdown after closing the overlay. Create a throwaway test company, delete it from the manager, confirm it disappears from both the manager list and the dropdown, and that if it was the selected company, the app falls back to another company (or the onboarding screen if none remain).

- [ ] **Step 7: Commit**

```bash
git add src/modules/content/ContentApp.tsx
git commit -m "feat(content): wire Gerenciar empresas into project selector"
```

---

## Self-Review Notes

- **Spec coverage:** entry point (Task 3 step 2), rename (Task 1 + 2), cascade delete (Task 1), stale-selection fallback (Task 3 step 3), overlay UI (Task 2) — all spec sections have a task.
- **Type consistency:** `CompanyManager` props (`uid`, `projects`, `onClose`) match between Task 2's definition and Task 3's usage. `renameProject`/`deleteProject` signatures match between Task 1 and Task 2's calls.
- **No placeholders:** every step has literal code or an exact manual-verification script.
