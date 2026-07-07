## Alfreds marketing components — build conventions

**Scope**: this bundle ships only `src/marketing/components/` (the Alfreds
marketing site's presentational layer) — 12 components, not the whole
omni360-description app. Product/CRUD UI (modals, category manager, etc.)
is out of scope.

**Routing wrapper (required).** `AgentCard`, `Hero`, `FinalCTA`,
`PricingSummary`, `MarketingNav`, `MarketingFooter` render `<Link>`/`<NavLink>`
from `react-router-dom`. Every render in this project is already wrapped in
`MemoryRouter` — when composing a page from these components elsewhere, wrap
the tree in a router (`BrowserRouter` in a real app) or the `Link`s throw.

**Theme system — not CSS classes, a prop.** Brand color/logo comes from
`getTheme(theme)` (`theme.ts`), not Tailwind classes you write yourself.
`theme` is one of `'brand' | 'product' | 'content'`:
- `brand` / `product` → orange accent (`#FF5B03`), light background.
- `content` → ink/dark accent, dark background.
Components that take a `theme` prop (`Hero`, `FinalCTA`, `FeatureShowcase`)
derive their own accent/background classes internally — don't hand-pick
colors for them.

**Styling idiom: Tailwind v4 with brand tokens.** Utility classes only, no
CSS modules. The brand palette is defined via Tailwind v4 `@theme` in
`src/index.css` and available as real utility classes:

| Token | Class examples | Use |
|---|---|---|
| `--color-orange #FF5B03` | `bg-orange`, `text-orange`, `border-orange/30` | Primary brand accent |
| `--color-ink #141311` | `bg-ink`, `text-ink`, `border-ink/10` | Dark surfaces / body text |
| `--color-porcelain #E8E0D5` | `bg-porcelain`, `text-porcelain/70` | Light surfaces |
| `--font-display` (Bricolage Grotesque) | `font-display` | Headings only — body text uses the default Inter stack |

Fractional opacity suffixes (`/10`, `/30`, `/70`) are used throughout for
subtle borders and secondary text — follow that convention rather than
introducing new gray scales.

**Layout wrapper: `Section`.** Every marketing page is a stack of
`<Section tone="light"|"dark">…</Section>` blocks — full-width band, content
capped at `max-w-6xl`, `py-20 md:py-28`. Compose new marketing UI as
children of `Section`, not as top-level `<div>`s with your own max-width.

**Where the truth lives**: `styles.css` (root) → `@import`s `_ds_bundle.css`,
which carries the compiled Tailwind output including the `@theme` tokens
above. Component API contracts are each `<Name>.d.ts`; the per-component
`.prompt.md` documents props with real defaults from this codebase.

**Example — a themed feature section**, adapted from the Home page:

```tsx
<Section tone="light">
  <Hero
    theme="brand"
    eyebrow="Agentes de IA para e-commerce"
    titleLead="Uma equipe de"
    titleAccent="Agentes de IA"
    subtitle="Os agentes cuidam do cadastro, do SEO e do conteúdo da sua loja."
    primaryCta={{ label: 'Começar grátis', to: '/entrar' }}
  />
</Section>
```
