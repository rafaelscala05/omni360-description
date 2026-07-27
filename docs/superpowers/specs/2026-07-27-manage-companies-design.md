# Manage Companies (Gerenciar Empresas) — Design

## Context

In the Agente de Conteúdo module (`src/modules/content/`), each "empresa" is a `ContentProject` document under `users/{uid}/contentProjects/{id}`. Today the sidebar project selector dropdown (`ContentApp.tsx`) only lets the user switch between projects or create a new one — there's no way to rename or delete an existing company.

## Goal

Add a "Gerenciar" entry point to the project dropdown that opens a management screen listing all companies, where the user can rename a company or delete it (with cascade cleanup of its data).

## Entry Point

In `ContentApp.tsx`, inside the existing project-selector dropdown (lines ~114-132), add a new button below the project list and above "Novo projeto":

```
Gerenciar empresas
```

Clicking it closes the dropdown and opens the management screen.

## Screen: `CompanyManager.tsx`

New component under `src/modules/content/CompanyManager.tsx`, following the modal/overlay pattern used by `src/components/categories/CategoryManager.tsx` (full-screen backdrop, centered panel, `onClose` prop) rather than a new `ContentView` — this keeps it a cross-cutting action independent of the currently selected project's view.

Props: `{ uid: string; projects: ContentProject[]; selectedId: string | null; onClose: () => void }`. Projects list comes from the already-subscribed `listenProjects` state in `ContentApp.tsx` — no separate fetch.

Behavior:
- Renders each project as a row: name + created date.
- Row has an edit icon → replaces the name with a text input + save/cancel icons. Save calls `renameProject(uid, id, newName)`; empty name is rejected client-side (keep existing name, no-op).
- Row has a delete icon (trash) → shows an inline confirmation ("Excluir “X” e todos os seus dados? Esta ação não pode ser desfeita.") with confirm/cancel before calling `deleteProject(uid, id)`. This mirrors the destructive-action pattern already used elsewhere in the app (confirm before firing).
- No local list re-fetch needed — `ContentApp`'s `listenProjects` `onSnapshot` subscription updates `projects` automatically after any write, and `CompanyManager` receives the updated list via props.
- Empty state message if `projects.length === 0` isn't reachable in practice (the manager can only be opened when at least one project exists, since with zero projects `ContentApp` shows the onboarding flow instead), so no special-case needed.

## Service Layer (`src/services/contentService.ts`)

### `renameProject(uid: string, projectId: string, nomeEmpresa: string): Promise<void>`

Partial update — only touches `config.nomeEmpresa` and `updatedAt`, leaving the rest of `config` untouched:

```ts
await updateDoc(doc(db, `users/${uid}/contentProjects/${projectId}`), {
  'config.nomeEmpresa': nomeEmpresa,
  updatedAt: new Date().toISOString(),
});
```

### `deleteProject(uid: string, projectId: string): Promise<void>`

Cascades through every subcollection/doc nested under the project (mapped from the existing codebase — see Architecture doc below) before deleting the project doc itself:

- Collections to fully clear (query all docs, delete each): `clusters`, `calendar`, `seoAudits`, `blogPosts`, `blogCategories`
- Fixed docs to delete: `secrets/wordpress`, `secrets/sanity`, `blog/settings`
- Finally: delete the project doc

Implementation uses Firestore `writeBatch`, chunked at 500 operations per batch (Firestore's per-batch limit), since a project can have an unbounded number of clusters/calendar entries. Order: gather all doc refs from every collection above via `getDocs`, plus the fixed doc paths (unconditional, no existence check needed — deleting a non-existent doc is a no-op) and the project doc ref itself, then commit in chunks.

## Wiring in `ContentApp.tsx`

- New state: `const [managingCompanies, setManagingCompanies] = useState(false);`
- The new dropdown button sets `managingCompanies = true` and `projectMenuOpen = false`.
- Render `{managingCompanies && <CompanyManager uid={uid} projects={projects} selectedId={selectedId} onClose={() => setManagingCompanies(false)} />}` as an overlay alongside the existing sidebar/main layout (same level as the sidebar backdrop, so it sits on top of everything).
- No special handling needed for "deleted the currently selected company": `listenProjects`'s existing callback (`setSelectedId((prev) => prev ?? list[0]?.id ?? null)`) only fills in a selection when `prev` is null — it won't auto-correct a stale `selectedId` pointing at a deleted doc. This is a real gap: **the callback must change** so that when the current `selectedId` is no longer present in the new list, it falls back to `list[0]?.id ?? null`:
  ```ts
  setSelectedId((prev) => (prev && list.some((p) => p.id === prev)) ? prev : (list[0]?.id ?? null));
  ```
  With `selectedId` becoming `null` when the list is empty, the existing `!projects.length` check in the render ternary already routes to `OnboardingWizard`.

## Out of Scope

- Bulk delete / multi-select.
- Undo / soft-delete / trash bin for companies.
- Editing any other company field (description, product/service, URLs) from this screen — that's already covered by `CompanyProfile.tsx` / `OnboardingWizard`.
