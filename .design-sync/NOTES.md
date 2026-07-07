# design-sync notes — omni360-description (Alfreds marketing components)

## Scope
This project syncs **only** `src/marketing/components/` (12 of the repo's
components). The rest of the app (`src/components/`, product/CRUD UI) is
intentionally out of scope — see the "Alfreds" chat that requested this sync.

## Repo shape — no dist, no Storybook
This repo is a Vite SPA, not a packaged component library. There is no
`dist/index.js` entry and no `.storybook/`. The converter runs in **package
shape with synth-entry** (`cfg.shape: "package"`, no `cfg.entry` pointing at
a real file — `--entry ./src/marketing/components/index.ts` is passed
deliberately pointing at a non-existent file so `resolveDistEntry` walks up
from its dirname to find the repo's real `package.json`, then falls through
to synthesizing an entry from `cfg.srcDir`).

## `.ds-sync/_srcstage/` — MUST be recreated on every fresh clone / re-sync
`cfg.srcDir` points at `.ds-sync/_srcstage`, a directory of **symlinks**
(not committed — `.ds-sync/` is fully gitignored) mirroring
`src/marketing/components/*.tsx` **minus** `IntegrationsGrid.tsx` (see
below). This dir does not survive a clone. Recreate it before building:

```sh
mkdir -p .ds-sync/_srcstage
for f in src/marketing/components/*.tsx; do
  base=$(basename "$f")
  [ "$base" != "IntegrationsGrid.tsx" ] && ln -sf "$(pwd)/$f" ".ds-sync/_srcstage/$base"
done
```

If a new marketing component is added to `src/marketing/components/`, symlink
it into `_srcstage` too (or lift the IntegrationsGrid exclusion if its
underlying gap is fixed — see below) before re-running the build.

## Known exclusions
- **`FAQ.tsx`** — dropped by `dts.mjs`'s `isComponentName` heuristic, which
  rejects `/^[A-Z][A-Z0-9_]+$/` (treats all-caps identifiers as
  enum/const-like). `FAQ` is a legitimate component, just acronym-named.
  Not worked around (would require forking `dts.mjs`, judged not worth it
  for one component this run). To fix: fork `.design-sync/overrides/dts.mjs`
  and relax `isComponentName`, e.g. only reject all-caps names containing
  `_` or longer than ~5 chars.
- **`IntegrationsGrid.tsx`** — imports a `.webp` asset
  (`src/assets/integrations/shopify.webp`). The converter's esbuild loader
  table (`lib/bundle.mjs` `sharedBuildOptions`) only maps `.svg`/`.png`/
  `.woff`/`.woff2` to `dataurl` — no `.webp` entry, and there's no config
  override for it (not an `ASSUMPTION`-tagged heuristic). Excluded from
  `_srcstage` (see above) rather than forking `bundle.mjs` (explicitly
  off-limits per the base skill — it's part of the app's output contract).
  To fix: convert the source asset to `.png`/`.svg`, or fork `bundle.mjs`
  if the base skill's guidance on that changes.

## Fork: `.design-sync/overrides/source-kit.mjs`
All 12 synced components are `export default function Name(...)` /
`export default Name;` — no named exports. The upstream synth-entry
generator does `export * from <file>` per source file, which **does not
re-export a `default`**, so the synthesized entry produced zero components
on `window.Alfreds` until this fork. The fork additionally emits
`export { default as <RealName> } from <file>` per file, using the same
declaration-name recovery `deriveComponentsFromSrc` already does. Declared
in `cfg.libOverrides`. This is likely relevant to any similarly-shaped
default-export-only app (i.e., NOT storybook/DS-package specific) — worth
upstreaming if this pattern recurs.

## cssEntry is a hashed build filename — changes every `npm run build`
`cfg.cssEntry` = `dist/assets/index-DPF49KoK.css`, produced by
`npm run build` (Vite + Tailwind v4 compile the `@theme` tokens + utility
classes actually used). **This hash changes on every build.** Before any
re-sync: run `npm run build`, find the new `dist/assets/index-*.css` file,
and update `cfg.cssEntry` to match — a stale path fails the build with
`[CSS_IMPORT_MISSING]`.

## Provider
`react-router-dom`'s `Link`/`NavLink` are used by `AgentCard`, `Hero`,
`FinalCTA`, `PricingSummary`, `MarketingNav`, `MarketingFooter`. Wired via
`cfg.extraEntries: ["react-router-dom"]` + `cfg.provider: {"component":
"MemoryRouter"}` — every preview render (authored or floor card) is wrapped
in `MemoryRouter` automatically.

## Repo devDependency additions (outside `.ds-sync/`)
- `@types/react` — added to the **main repo's** `node_modules`/
  `package.json` (was missing entirely; needed for `ts-morph` prop
  extraction — without it every `<Name>Props` interface would emit empty).
  This is a legitimate, low-risk addition for a TS+JSX project; flagged
  here since it wasn't asked for explicitly.
- `playwright` + chromium — installed only inside `.ds-sync/node_modules`
  (isolated, gitignored), used for the render check. Not a repo dependency.

## Authored previews (6 of 12 components)
`Section`, `Hero`, `AgentCard`, `CaseCard`, `FeatureShowcase`, `FinalCTA`
have hand-authored `.design-sync/previews/<Name>.tsx` (committed), composed
from real usage in `src/marketing/pages/HomePage.tsx` and
`src/marketing/content.ts`. The other 6 (`HowItWorks`, `MarketingFooter`,
`MarketingNav`, `PricingSummary`, `SegmentGrid`, `TrustSection`) ship as
floor cards — none are broken (render check confirmed all render non-empty
with default/floor props), just not richly authored yet. Authorable
incrementally on any future re-sync; nothing here blocks that.

## Known render warns
None outstanding — final `package-validate.mjs` run was clean (0 bad, 0
warnings) after the `cardMode: "column"` fix for `AgentCard`/`CaseCard`
(GRID_OVERFLOW — both had a wide `Grid`/`Row` story).

## Re-sync risks
- **`.ds-sync/_srcstage` symlinks** (above) — the single biggest re-sync
  trap. A re-sync run from a fresh clone that skips recreating this
  directory will hit `[NO_DIST]`/`[ZERO_MATCH]` since `cfg.srcDir` won't
  resolve.
- **`cssEntry` hash** (above) — stale after any `npm run build`.
- The marketing components' Portuguese copy is hardcoded (not i18n) — the
  authored previews mirror the real home page copy verbatim; if the home
  page copy changes, the previews will read as stale marketing content
  (cosmetic only, doesn't affect grading/rendering).
- `IntegrationsGrid` and `FAQ` are silently absent from the DS project.
  Nothing marks this in the uploaded output itself — a future maintainer
  browsing the Design System pane won't see why 2 of 14 marketing
  components are missing without reading this file.
