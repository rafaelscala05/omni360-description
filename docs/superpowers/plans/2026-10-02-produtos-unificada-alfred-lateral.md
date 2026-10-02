# Produtos com integração, filtros e Alfred na lateral — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A tela Produtos do agente mostra origem e sincronização de cada produto, filtra por painel, pagina de 50 em 50 e manda gerar descrição ou ambientada em massa com confirmação "pular ou sobrescrever" e progresso ao vivo num painel lateral do Alfred.

**Architecture:** Três camadas. (1) Regras puras e sem I/O em `src/modules/agent/*.ts`, usadas pelo cliente e pelo servidor e cobertas por `scripts/verify-*.mjs` (padrão do projeto, sem framework de teste). (2) Servidor: carimbo de sincronização gravado no ponto do envio/importação e uma rota que cria lotes em massa em modo automático sobre o `criarLote`/`loteWorker` existentes. (3) UI: a `ProdutosAgenteScreen` existente ganha lista nova e o `PainelAlfred`, extraído do `AgentHomeScreen` para as duas telas usarem a mesma conversa.

**Tech Stack:** React 19, Tailwind v4 com tokens `--ag-*` (escopo `.alfreds`), Express + Firebase Admin SDK, Firestore, `tsx` para os scripts de verificação, `tsc --noEmit` como lint.

**Spec:** `docs/superpowers/specs/2026-10-02-produtos-unificada-alfred-lateral-design.md`

## Global Constraints

- A Tabela completa (`mainView === 'products'`) não muda.
- Todo texto de UI em pt-BR.
- Cor nenhuma literal nas telas do agente: só tokens `--ag-*`; nada de `divide-*`; `border-*` sempre com `borderColor`/`border` explícito com token.
- Campo de texto no celular com `text-[16px]` (zoom do iOS); auto-scroll com `scrollTop`, nunca `scrollIntoView`.
- Margem lateral das telas do agente: `.ag-tela-x`, nunca `px-*` próprio no contêiner externo.
- Só produtos principais na lista (`principais()`); variação herda do pai.
- Fiscal nunca entra na sincronização de Tiny/Wake/IdWorks (nenhum push manda fiscal).
- Importação carimba título, descrição e SEO; **imagens só o envio carimba** (o ERP re-hospeda as URLs).
- Lotes: 50 por lote de descrições (`MAX_DESCRICOES_POR_LOTE`), 10 por lote de ambientadas (`MAX_AMBIENTADAS_POR_LOTE`).
- Lote da ação em massa nasce com `auto: true` (grava direto); débito por item gravado, como hoje.
- Ambientadas no modo sobrescrever **acrescentam** (as antigas ficam).
- Paginação: 50 por página (`POR_PAGINA = 50`).
- Painel do Alfred: coluna fixa ≥1280px (`useTelaLarga`), recolhível entre 768 e 1280, folha no celular.
- Desfazer não estorna créditos.
- Verificar com `npx tsx scripts/<script>.mjs` e `npm run lint` (não há outro test runner).

## Review Focus

- **Produto antigo sem carimbo:** com descrição gerada por IA deve aparecer "não enviada"; nunca tocado no app deve aparecer "em dia" — Task 1 testa os dois.
- **Desfazer depois de o usuário editar:** a descrição editada à mão depois do lote não pode ser trocada pela antiga — Task 7 testa `camposDeRestauro`/`podeRestaurar`.
- **Todos os selecionados já têm:** o card não pode oferecer "Gerar só os 0"; só "Sobrescrever" e Cancelar — Task 6 testa.
- **Seleção que atravessa páginas e filtros:** a ação em massa usa toda a seleção, não só a página; "Selecionar todos os N do filtro" só aparece com a página inteira marcada e mais resultados fora dela — Task 4 testa `estadoSelecao`.
- **Desfazer duas vezes / duplo clique:** a segunda chamada não faz nada — Task 7 testa `marcarDesfeito`.

---

## File Structure

**Criar**
- `src/modules/agent/sincronizacao.ts` — hash por grupo, conteúdo local vs. enviado, estado por integração (puro, cliente+servidor).
- `scripts/verify-sincronizacao.mjs`
- `server/syncStamp.ts` — grava `_tinyPushed`/`_wakePushed`/`_idworksPushed` (Admin SDK).
- `src/modules/agent/confirmacaoMassa.ts` — quem entra, quem fica de fora, custo, etapas do "pensando" (puro).
- `scripts/verify-confirmacao-massa.mjs`
- `server/agent/loteMassa.ts` — cria lotes em massa e o desfazer.
- `src/modules/agent/useConversaAlfred.ts` — estado da conversa (extraído do `AgentHomeScreen`).
- `src/modules/agent/PainelAlfred.tsx` — thread + composer + slot para cards locais.
- `src/modules/agent/produtos/SeloIntegracao.tsx`, `LinhaProduto.tsx`, `PainelFiltros.tsx`, `Paginacao.tsx`, `CardConfirmacao.tsx`, `FolhaAlfred.tsx`.

**Modificar**
- `src/types/models.ts` — campos `_tinyPushed`, `_wakePushed` (e documentar `_idworksPushed`).
- `src/App.tsx` — Bling usa a assinatura legada do módulo; Wake import carimba; Wake push manda `imagensUrls`; props novas da `ProdutosAgenteScreen`.
- `server/tinyProvider.ts`, `server/agent/tools/tiny.ts`, `server/wakeAgent.ts`, `server/idworksAgent.ts`, `server/agent/tools/erps.ts` — carimbo após o envio.
- `server/tinyImportWorker.ts`, `server/idworksImportWorker.ts` — carimbo na importação (os webhooks passam pelo mesmo upsert).
- `src/modules/agent/produtosAgente.ts` + `scripts/verify-produtos-agente.mjs` — filtros por grupo, paginação, seleção.
- `src/modules/agent/lote.ts` + `scripts/verify-lote.mjs` — `antes`, `origem`, `desfeito`, `linhasAoVivo`, desfazer.
- `server/agent/loteRoutes.ts` — rota de criação em massa e ação `desfazer`.
- `server/agent/contentAgentChat.ts` — exporta `registrarTrocaNaConversa`.
- `src/services/agentChatService.ts` — `criarLotesEmMassa`, `AcaoLote` com `desfazer`.
- `src/modules/agent/chat/LoteCard.tsx` — linhas ao vivo e Desfazer.
- `src/modules/agent/BarraProximoPasso.tsx` — segunda ação.
- `src/modules/agent/AgentHomeScreen.tsx` — passa a usar `useConversaAlfred`.
- `src/modules/agent/ProdutosAgenteScreen.tsx` — lista nova + painel.
- `CLAUDE.md` — documentar.

---

### Task 1: Regra pura de sincronização

**Files:**
- Create: `src/modules/agent/sincronizacao.ts`
- Create: `scripts/verify-sincronizacao.mjs`
- Modify: `src/App.tsx:1906-1935` (`djb2`, `tinyGroup` passam a vir do módulo)

**Interfaces:**
- Produces:
  - `type IntegracaoSync = 'tiny' | 'wake' | 'idworks' | 'bling'`
  - `type GrupoSync = 'titulo' | 'descricao' | 'seo' | 'imagens' | 'fiscal'`
  - `interface ConteudoEnvio { titulo?: string; descricaoHtml?: string; seoTitle?: string; seoDescription?: string; seoKeywords?: string; imagens?: string[] }`
  - `type Carimbo = Partial<Record<GrupoSync, string>>`
  - `type EstadoSync = { tipo: 'sem-vinculo' } | { tipo: 'em-dia' } | { tipo: 'pendente'; grupos: GrupoSync[] }`
  - `djb2(s: string): string`
  - `conteudoDoProduto(p: Record<string, unknown>, integ: IntegracaoSync): ConteudoEnvio`
  - `assinaturasDoEnvio(integ, c: ConteudoEnvio, steps: Record<string, string | undefined>): Carimbo`
  - `assinaturasDeImportacao(integ, c: ConteudoEnvio): Carimbo`
  - `estadoIntegracao(p: Record<string, unknown>, integ: IntegracaoSync): EstadoSync`
  - `integracoesDe(p): { integracao: IntegracaoSync; estado: EstadoSync }[]`
  - `assinaturaLegada(p, g: 'descricao'|'seo'|'fiscal'|'imagens'): { has: boolean; sig: string }`
  - `CAMPO_VINCULO`, `CAMPO_CARIMBO`, `GRUPOS_DA_INTEGRACAO`, `ROTULO_INTEGRACAO`, `ROTULO_GRUPO`

- [ ] **Step 1: Write the failing test**

Create `scripts/verify-sincronizacao.mjs`:

```js
// Verificação da regra de sincronização (src/modules/agent/sincronizacao.ts).
// Rodar com: npx tsx scripts/verify-sincronizacao.mjs
import {
  djb2, conteudoDoProduto, assinaturasDoEnvio, assinaturasDeImportacao, estadoIntegracao, integracoesDe, assinaturaLegada,
} from '../src/modules/agent/sincronizacao.ts';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? '  ok' : 'FALHA'}  ${label}${ok ? '' : ` → esperado ${JSON.stringify(expected)}, veio ${JSON.stringify(actual)}`}`);
}

const base = {
  _id: 'A', 'Código (SKU)': 'A', 'Descrição': 'Camiseta',
  'Descrição complementar': '<p>texto</p>', 'Título SEO': 'Camiseta azul', 'Descrição SEO': 'meta', 'Palavras chave SEO': 'camiseta',
  'URL imagem 1': 'https://x/1.jpg', _tinyProductId: '10',
};

// Hash estável e independente de espaços nas pontas e da ordem das imagens.
check('djb2 é estável', djb2('abc'), djb2('abc'));
const c1 = conteudoDoProduto({ ...base, _ambientImages: ['https://x/a.jpg'] }, 'tiny');
const c2 = conteudoDoProduto({ ...base, 'Descrição complementar': '  <p>texto</p>  ', _ambientImages: ['https://x/a.jpg'] }, 'tiny');
check('conteúdo tiny junta ambientadas e URL imagem', c1.imagens, ['https://x/1.jpg', 'https://x/a.jpg']);
check('wake só conta ambientadas como imagem', conteudoDoProduto({ ...base, _ambientImages: ['https://x/a.jpg'] }, 'wake').imagens, ['https://x/a.jpg']);
check('espaço nas pontas não muda a assinatura',
  assinaturasDeImportacao('tiny', c1).descricao, assinaturasDeImportacao('tiny', c2).descricao);

// Envio: só grupos com passo "ok" ou "sem alteração" são carimbados.
const env = assinaturasDoEnvio('tiny', c1, { titulo: 'sobrescrita desativada', descricao: 'ok', seo: 'ok (seo_title acima de 120)', imagens: 'sem alteração' });
check('envio carimba só ok/sem alteração', Object.keys(env).sort(), ['descricao', 'imagens']);
check('envio wake ignora grupo fora da integração', Object.keys(assinaturasDoEnvio('wake', c1, { titulo: 'ok', descricao: 'ok' })), ['descricao']);

// Importação nunca carimba imagens (o ERP re-hospeda as URLs).
check('importação carimba título, descrição e SEO', Object.keys(assinaturasDeImportacao('tiny', c1)).sort(), ['descricao', 'seo', 'titulo']);

// Estado
check('sem vínculo', estadoIntegracao(base, 'wake'), { tipo: 'sem-vinculo' });
const carimbado = { ...base, _tinyPushed: { ...assinaturasDeImportacao('tiny', conteudoDoProduto(base, 'tiny')), imagens: assinaturasDoEnvio('tiny', conteudoDoProduto(base, 'tiny'), { imagens: 'ok' }).imagens } };
check('carimbo igual ao local = em dia', estadoIntegracao(carimbado, 'tiny'), { tipo: 'em-dia' });
check('descrição mudou depois do carimbo = pendente',
  estadoIntegracao({ ...carimbado, 'Descrição complementar': '<p>novo</p>' }, 'tiny'), { tipo: 'pendente', grupos: ['descricao'] });
check('grupo vazio no local nunca fica pendente',
  estadoIntegracao({ ...carimbado, 'Título SEO': '', 'Descrição SEO': '', 'Palavras chave SEO': '' }, 'tiny'), { tipo: 'em-dia' });

// Review Focus 1: produto antigo, sem carimbo nenhum.
check('sem carimbo e nada gerado = em dia', estadoIntegracao(base, 'tiny'), { tipo: 'em-dia' });
check('sem carimbo com descrição gerada por IA = pendente',
  estadoIntegracao({ ...base, _statusDescricao: 'Gerado por IA', _statusSEO: 'Gerado por IA' }, 'tiny'), { tipo: 'pendente', grupos: ['descricao', 'seo'] });
check('sem carimbo de imagem com ambientada = imagem pendente',
  estadoIntegracao({ ...carimbado, _tinyPushed: { ...carimbado._tinyPushed, imagens: undefined }, _ambientImages: ['https://x/a.jpg'] }, 'tiny'),
  { tipo: 'pendente', grupos: ['imagens'] });

// Bling continua com a assinatura legada gravada pelo navegador.
const bling = { ...base, _tinyProductId: undefined, _blingProductId: '7', _statusDescricao: 'Gerado por IA' };
check('bling sem _blingPushed e descrição gerada = pendente', estadoIntegracao(bling, 'bling'), { tipo: 'pendente', grupos: ['descricao'] });
check('bling com _blingPushed igual = em dia',
  estadoIntegracao({ ...bling, _blingPushed: { descricao: assinaturaLegada(bling, 'descricao').sig } }, 'bling'), { tipo: 'em-dia' });

check('integracoesDe lista só as vinculadas',
  integracoesDe({ ...base, _wakeProductId: 'w1' }).map((i) => i.integracao), ['tiny', 'wake']);

if (failures) { console.error(`\n${failures} falha(s).`); process.exit(1); }
console.log('\nTudo certo.');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/verify-sincronizacao.mjs`
Expected: FAIL — `Cannot find module '../src/modules/agent/sincronizacao.ts'`.

- [ ] **Step 3: Write the implementation**

Create `src/modules/agent/sincronizacao.ts`:

```ts
// Sincronização com o ERP — "Tiny · em dia" / "Tiny · 2 não enviadas".
//
// Puro e sem I/O, usado dos dois lados: o servidor carimba (server/syncStamp.ts,
// no envio e na importação) e o cliente compara o carimbo com o produto para
// pintar o selo. Verificar com `npx tsx scripts/verify-sincronizacao.mjs`.
//
// Um carimbo é, por grupo de campos, o hash do conteúdo que o ERP tem (porque
// acabamos de enviar ou porque acabou de chegar dele). Pendente = o produto
// local tem conteúdo naquele grupo e o hash dele não bate com o carimbo.
//
// Três regras que não são óbvias:
// - Importação carimba título, descrição e SEO, nunca imagens: o ERP
//   re-hospeda as URLs e o carimbo nunca bateria com as locais.
// - Grupo vazio no local nunca fica pendente: nenhum push manda vazio.
// - Sem carimbo (produto anterior a isto), conta como pendente só o que foi
//   gerado no app (a mesma regra que o envio do Bling já usava), para o
//   catálogo não amanhecer inteiro em âmbar.

export type IntegracaoSync = 'tiny' | 'wake' | 'idworks' | 'bling';
export type GrupoSync = 'titulo' | 'descricao' | 'seo' | 'imagens' | 'fiscal';
export type Carimbo = Partial<Record<GrupoSync, string>>;
export type EstadoSync = { tipo: 'sem-vinculo' } | { tipo: 'em-dia' } | { tipo: 'pendente'; grupos: GrupoSync[] };

export interface ConteudoEnvio {
  titulo?: string;
  descricaoHtml?: string;
  seoTitle?: string;
  seoDescription?: string;
  seoKeywords?: string;
  imagens?: string[];
}

export const INTEGRACOES: IntegracaoSync[] = ['tiny', 'wake', 'bling', 'idworks'];

export const CAMPO_VINCULO = {
  tiny: '_tinyProductId', wake: '_wakeProductId', idworks: '_idworksProductId', bling: '_blingProductId',
} as const;

export const CAMPO_CARIMBO = {
  tiny: '_tinyPushed', wake: '_wakePushed', idworks: '_idworksPushed', bling: '_blingPushed',
} as const;

/** Só o que cada push escreve. */
export const GRUPOS_DA_INTEGRACAO: Record<IntegracaoSync, GrupoSync[]> = {
  tiny: ['titulo', 'descricao', 'seo', 'imagens'],
  wake: ['descricao', 'seo', 'imagens'],
  idworks: ['descricao', 'seo', 'imagens'],
  bling: ['descricao', 'seo', 'fiscal', 'imagens'],
};

export const ROTULO_INTEGRACAO: Record<IntegracaoSync, string> = { tiny: 'Tiny', wake: 'Wake', bling: 'Bling', idworks: 'IdWorks' };
export const ROTULO_GRUPO: Record<GrupoSync, string> = {
  titulo: 'título', descricao: 'descrição', seo: 'SEO', imagens: 'imagens', fiscal: 'fiscal',
};

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());

export function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Únicas, só http(s), em ordem — a ordem de envio não muda a assinatura. */
function normalizarImagens(urls: unknown[]): string[] {
  return [...new Set(urls.map(str).filter((u) => /^https?:\/\//i.test(u)))].sort();
}

function imagensLocais(p: Record<string, unknown>, integ: IntegracaoSync): string[] {
  const ambientadas = Array.isArray(p._ambientImages) ? (p._ambientImages as unknown[]) : [];
  // A Wake só recebe as ambientadas (buildWakePushPayload); os outros, as fotos também.
  if (integ === 'wake') return normalizarImagens(ambientadas);
  const fotos = Array.from({ length: 6 }, (_, i) => p[`URL imagem ${i + 1}`]);
  return normalizarImagens([...ambientadas, ...fotos]);
}

export function conteudoDoProduto(p: Record<string, unknown>, integ: IntegracaoSync): ConteudoEnvio {
  return {
    titulo: str(p['Descrição']),
    descricaoHtml: str(p['Descrição complementar']),
    seoTitle: str(p['Título SEO']),
    seoDescription: str(p['Descrição SEO']),
    seoKeywords: str(p['Palavras chave SEO']),
    imagens: imagensLocais(p, integ),
  };
}

type GrupoConteudo = Exclude<GrupoSync, 'fiscal'>;

/** Texto canônico de um grupo; '' = o grupo não tem conteúdo. */
function canonico(g: GrupoConteudo, c: ConteudoEnvio): string {
  switch (g) {
    case 'titulo': return str(c.titulo);
    case 'descricao': return str(c.descricaoHtml);
    case 'seo': {
      const partes = [str(c.seoTitle), str(c.seoDescription), str(c.seoKeywords)];
      return partes.some(Boolean) ? partes.join('\u0001') : '';
    }
    case 'imagens': return normalizarImagens(c.imagens ?? []).join('\n');
  }
}

const temNoConteudo = (g: GrupoConteudo, c: ConteudoEnvio): boolean => {
  if (g === 'imagens') return c.imagens !== undefined;
  if (g === 'seo') return c.seoTitle !== undefined || c.seoDescription !== undefined || c.seoKeywords !== undefined;
  if (g === 'titulo') return c.titulo !== undefined;
  return c.descricaoHtml !== undefined;
};

const passoOk = (s?: string) => s === 'ok' || s === 'sem alteração';

/** O que o ERP tem depois de um envio: só grupos que o push confirmou. */
export function assinaturasDoEnvio(integ: IntegracaoSync, c: ConteudoEnvio, steps: Record<string, string | undefined>): Carimbo {
  const out: Carimbo = {};
  for (const g of GRUPOS_DA_INTEGRACAO[integ]) {
    if (g === 'fiscal' || !passoOk(steps[g]) || !temNoConteudo(g, c)) continue;
    out[g] = djb2(canonico(g, c));
  }
  return out;
}

/** O que o ERP tem quando o produto chega dele. Imagens ficam de fora (ver topo). */
export function assinaturasDeImportacao(integ: IntegracaoSync, c: ConteudoEnvio): Carimbo {
  const out: Carimbo = {};
  for (const g of GRUPOS_DA_INTEGRACAO[integ]) {
    if (g === 'fiscal' || g === 'imagens' || !temNoConteudo(g, c)) continue;
    out[g] = djb2(canonico(g, c));
  }
  return out;
}

/** Foi gerado/editado no app? — o mesmo sinal que o envio do Bling usava (tinyGenerated). */
function geradoNoApp(p: Record<string, unknown>, g: GrupoSync): boolean {
  switch (g) {
    case 'descricao': return p._statusDescricao === 'Gerado por IA';
    case 'seo': return p._statusSEO === 'Gerado por IA';
    case 'fiscal': return !!p._enrichmentLog;
    case 'imagens': return Array.isArray(p._ambientImages) && p._ambientImages.length > 0;
    case 'titulo': return false;
  }
}

/**
 * Assinatura antiga por grupo, a que o envio do Bling grava em `_blingPushed`
 * pelo navegador (App.tsx). Mantida idêntica para não invalidar o que já está
 * gravado.
 */
export function assinaturaLegada(p: Record<string, unknown>, g: 'descricao' | 'seo' | 'fiscal' | 'imagens'): { has: boolean; sig: string } {
  const s = (v: unknown) => String(v ?? '');
  switch (g) {
    case 'descricao': return { has: !!p['Descrição complementar'], sig: djb2(s(p['Descrição complementar'])) };
    case 'seo': {
      const parts = [p['Título SEO'], p['Descrição SEO'], p['Palavras chave SEO']];
      return { has: parts.some((x) => !!x), sig: djb2(parts.map(s).join('')) };
    }
    case 'fiscal': {
      const parts = [p['NCM (Classificação fiscal)'], p['GTIN/EAN'], p['Peso líquido (Kg)'], p['Peso bruto (Kg)'], p['Largura embalagem'], p['Altura Embalagem'], p['Comprimento embalagem']];
      return { has: parts.some((x) => x !== undefined && x !== null && x !== ''), sig: djb2(parts.map(s).join('')) };
    }
    case 'imagens': {
      const urls: string[] = [...((p._ambientImages as string[] | undefined) ?? [])];
      for (let i = 1; i <= 6; i++) {
        const u = p[`URL imagem ${i}`];
        if (typeof u === 'string' && u) urls.push(u);
      }
      const imgs = Array.from(new Set(urls.filter((u) => /^https?:\/\//i.test(u))));
      return { has: imgs.length > 0, sig: djb2(imgs.join('')) };
    }
  }
}

function estadoBling(p: Record<string, unknown>): EstadoSync {
  const carimbo = (p._blingPushed ?? {}) as Carimbo;
  const grupos = (['descricao', 'seo', 'fiscal', 'imagens'] as const).filter((g) => {
    const { has, sig } = assinaturaLegada(p, g);
    return has && geradoNoApp(p, g) && carimbo[g] !== sig;
  });
  return grupos.length ? { tipo: 'pendente', grupos: [...grupos] } : { tipo: 'em-dia' };
}

export function estadoIntegracao(p: Record<string, unknown>, integ: IntegracaoSync): EstadoSync {
  if (!str(p[CAMPO_VINCULO[integ]])) return { tipo: 'sem-vinculo' };
  if (integ === 'bling') return estadoBling(p);
  const carimbo = (p[CAMPO_CARIMBO[integ]] ?? {}) as Carimbo;
  const c = conteudoDoProduto(p, integ);
  const grupos = GRUPOS_DA_INTEGRACAO[integ].filter((g) => {
    if (g === 'fiscal') return false;
    const local = canonico(g, c);
    if (!local) return false;
    const gravado = carimbo[g];
    return gravado ? djb2(local) !== gravado : geradoNoApp(p, g);
  });
  return grupos.length ? { tipo: 'pendente', grupos } : { tipo: 'em-dia' };
}

export function integracoesDe(p: Record<string, unknown>): { integracao: IntegracaoSync; estado: EstadoSync }[] {
  return INTEGRACOES
    .map((integracao) => ({ integracao, estado: estadoIntegracao(p, integracao) }))
    .filter((i) => i.estado.tipo !== 'sem-vinculo');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/verify-sincronizacao.mjs`
Expected: todas as linhas `ok`, termina com `Tudo certo.`

- [ ] **Step 5: Make App.tsx use the module (Bling unchanged in behavior)**

In `src/App.tsx`, add to the imports:

```ts
import { assinaturaLegada } from './modules/agent/sincronizacao';
```

Replace the block from `const djb2 = (s: string): string => {` through the end of the `tinyGroup` object (`} as const;`) with:

```ts
  // A assinatura por grupo que o envio do Bling grava em _blingPushed mora em
  // sincronizacao.ts (assinaturaLegada), a mesma que o selo da tela de Produtos lê.
  const tinyGroup = {
    descricao: (p: Product) => assinaturaLegada(p as unknown as Record<string, unknown>, 'descricao'),
    seo: (p: Product) => assinaturaLegada(p as unknown as Record<string, unknown>, 'seo'),
    fiscal: (p: Product) => assinaturaLegada(p as unknown as Record<string, unknown>, 'fiscal'),
    imagens: (p: Product) => assinaturaLegada(p as unknown as Record<string, unknown>, 'imagens'),
  } as const;
```

Keep the comment above it (`// djb2/tinyGroup/tinyGenerated are no longer needed for Tiny ...`). If `djb2` is referenced anywhere else in `App.tsx` (`grep -n "djb2(" src/App.tsx`), import `djb2` from the module too.

- [ ] **Step 6: Lint**

Run: `npm run lint`
Expected: sem erros novos (compare com `git stash; npm run lint; git stash pop` se já havia erros antes).

- [ ] **Step 7: Commit**

```bash
git add src/modules/agent/sincronizacao.ts scripts/verify-sincronizacao.mjs src/App.tsx
git commit -m "feat(produtos): regra pura de sincronização com o ERP

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Carimbo no envio (servidor)

**Files:**
- Create: `server/syncStamp.ts`
- Modify: `src/types/models.ts:173-190` (campos de carimbo)
- Modify: `server/wakeAgent.ts:135-147` (`imagensUrls` no `WakePushProduct`), `server/wakeAgent.ts:421-437` (rota)
- Modify: `server/tinyProvider.ts:103-150` (rota)
- Modify: `server/idworksAgent.ts:388-402` (rota)
- Modify: `server/agent/tools/tiny.ts:535-556` (`tiny.catalogo.enviar`)
- Modify: `server/agent/tools/erps.ts` (`enviar` de Wake e IdWorks)
- Modify: `src/App.tsx:1775-1820` (`buildWakePushPayload` manda `imagensUrls`)
- Test: `scripts/verify-sincronizacao.mjs`

**Interfaces:**
- Consumes: `assinaturasDoEnvio`, `CAMPO_VINCULO`, `CAMPO_CARIMBO`, `ConteudoEnvio`, `IntegracaoSync` (Task 1).
- Produces:
  - `conteudoDoPushTiny(p: TinyPushProduct): ConteudoEnvio`, `conteudoDoPushWake(p: WakePushProduct): ConteudoEnvio`, `conteudoDoPushIdworks(p: IdworksPushProduct): ConteudoEnvio` (puros, em `server/syncStamp.ts`)
  - `carimbarEnvio(uid: string, integ: 'tiny' | 'wake' | 'idworks', itens: { erpId: string; ok: boolean; conteudo: ConteudoEnvio; steps: Record<string, string | undefined> }[]): Promise<number>`

- [ ] **Step 1: Write the failing test**

Append to `scripts/verify-sincronizacao.mjs`, **before** the final `if (failures)` line:

```js
// --- Conversores do payload de envio (server/syncStamp.ts) ---------------------
const { conteudoDoPushTiny, conteudoDoPushWake, conteudoDoPushIdworks } = await import('../server/syncStamp.ts');
check('payload tiny vira conteúdo',
  conteudoDoPushTiny({ tinyId: '1', nome: 'Camiseta', descricaoHtml: '<p>x</p>', seoTitle: 't', imagens: ['https://a'] }),
  { titulo: 'Camiseta', descricaoHtml: '<p>x</p>', seoTitle: 't', seoDescription: undefined, seoKeywords: undefined, imagens: ['https://a'] });
check('payload tiny de variação usa urlImagem',
  conteudoDoPushTiny({ tinyId: '2', urlImagem: 'https://v' }).imagens, ['https://v']);
check('payload wake usa imagensUrls, não o base64',
  conteudoDoPushWake({ produtoId: 'w', descricaoHtml: 'd', imagensUrls: ['https://amb'], imagensBase64: [{ base64: 'x', formato: 'JPG' }], campos: {} }).imagens,
  ['https://amb']);
check('payload idworks sem imagens = sem grupo de imagens',
  conteudoDoPushIdworks({ idworksId: 'i', descricaoHtml: 'd', campos: {} }).imagens, undefined);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/verify-sincronizacao.mjs`
Expected: FAIL — `Cannot find module '../server/syncStamp.ts'`.

> If importing `server/syncStamp.ts` fails because `server/firebaseAdmin` needs credentials at import time, move the three converters to `server/syncConteudo.ts` (no Admin import) and import them from there in both the script and `syncStamp.ts`.

- [ ] **Step 3: Write `server/syncStamp.ts`**

```ts
// Carimbo de sincronização: grava, no doc do produto, o hash do que o ERP
// passou a ter depois de um envio (ver src/modules/agent/sincronizacao.ts).
//
// Chamado logo depois do push, com o próprio payload que saiu — nunca relendo
// o produto, que pode ter mudado no meio — e só para os grupos que o push
// confirmou ("ok" ou "sem alteração"). Melhor-esforço: falhar aqui nunca
// derruba o envio, só deixa o selo em "não enviada" até o próximo.

import { adminDb } from './firebaseAdmin';
import {
  assinaturasDoEnvio, CAMPO_CARIMBO, CAMPO_VINCULO, type ConteudoEnvio,
} from '../src/modules/agent/sincronizacao';
import type { TinyPushProduct } from './tinyAgent';
import type { WakePushProduct } from './wakeAgent';
import type { IdworksPushProduct } from './idworksAgent';

export const conteudoDoPushTiny = (p: TinyPushProduct): ConteudoEnvio => ({
  titulo: p.nome,
  descricaoHtml: p.descricaoHtml,
  seoTitle: p.seoTitle,
  seoDescription: p.seoDescription,
  seoKeywords: p.seoKeywords,
  imagens: p.imagens ?? (p.urlImagem ? [p.urlImagem] : undefined),
});

export const conteudoDoPushWake = (p: WakePushProduct): ConteudoEnvio => ({
  descricaoHtml: p.descricaoHtml,
  seoTitle: p.seoTitle,
  seoDescription: p.seoDescription,
  seoKeywords: p.seoKeywords,
  imagens: p.imagensUrls,
});

export const conteudoDoPushIdworks = (p: IdworksPushProduct): ConteudoEnvio => ({
  descricaoHtml: p.descricaoHtml,
  seoTitle: p.seoTitle,
  seoDescription: p.seoDescription,
  seoKeywords: p.seoKeywords,
  imagens: p.imagens,
});

const produtos = (uid: string) => adminDb.collection('users').doc(uid).collection('products');

export async function carimbarEnvio(
  uid: string,
  integ: 'tiny' | 'wake' | 'idworks',
  itens: { erpId: string; ok: boolean; conteudo: ConteudoEnvio; steps: Record<string, string | undefined> }[],
): Promise<number> {
  let n = 0;
  try {
    const campoVinculo = CAMPO_VINCULO[integ];
    const campoCarimbo = CAMPO_CARIMBO[integ];
    for (const it of itens) {
      if (!it.ok || !it.erpId) continue;
      const carimbo = assinaturasDoEnvio(integ, it.conteudo, it.steps);
      if (!Object.keys(carimbo).length) continue;
      const snap = await produtos(uid).where(campoVinculo, '==', String(it.erpId)).get();
      for (const d of snap.docs) {
        // merge: grupos não enviados agora mantêm o carimbo anterior.
        await d.ref.set({ [campoCarimbo]: carimbo }, { merge: true });
        n++;
      }
    }
  } catch (e) {
    console.warn(`[sync] falha ao carimbar envio ${integ}:`, e instanceof Error ? e.message : String(e));
  }
  return n;
}
```

- [ ] **Step 4: Add `imagensUrls` to `WakePushProduct`**

In `server/wakeAgent.ts`, inside `export interface WakePushProduct`, after `imagensBase64?: ...`:

```ts
  /** As URLs que viraram `imagensBase64` — só para o carimbo de sincronização (server/syncStamp.ts). */
  imagensUrls?: string[];
```

In `src/App.tsx`, `buildWakePushPayload`, in the `out.push({ ... })` object, after `imagensBase64,`:

```ts
        imagensUrls: imagensBase64?.length ? [...(p._ambientImages ?? [])] : undefined,
```

If `src/services/wakeService.ts` re-declares the `WakePushProduct` type for the client, add the same optional field there.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx scripts/verify-sincronizacao.mjs`
Expected: todas `ok`.

- [ ] **Step 6: Wire the stamp into the three routes**

`server/tinyProvider.ts` — add the import at the top:

```ts
import { carimbarEnvio, conteudoDoPushTiny } from './syncStamp';
```

In `app.post('/api/tiny/push', ...)`, v2 branch: replace `return res.json({ resultados });` (the one right after `pushV2Lote`) with:

```ts
        await carimbarEnvio(uid, 'tiny', resultados.map((r, i) => ({
          erpId: r.tinyId, ok: r.ok, steps: r.steps as unknown as Record<string, string>, conteudo: conteudoDoPushTiny(produtos[i]),
        })));
        return res.json({ resultados });
```

And the v3 branch's final `return res.json({ resultados });` (after the `for` loop) with the same block (`resultados[i]` corresponds to `produtos[i]` there too — the loop pushes exactly one result per product, in order).

`server/wakeAgent.ts` — import `carimbarEnvio, conteudoDoPushWake` from `./syncStamp` and, in `/api/wake/push`, before `return res.json({ resultados });`:

```ts
      await carimbarEnvio(uid, 'wake', resultados.map((r, i) => ({
        erpId: r.produtoId, ok: r.ok, steps: r.steps, conteudo: conteudoDoPushWake(produtos[i]),
      })));
```

`server/idworksAgent.ts` — import `carimbarEnvio, conteudoDoPushIdworks` from `./syncStamp` and, in `/api/idworks/push`, before `return res.json({ resultados });`:

```ts
      await carimbarEnvio(uid, 'idworks', resultados.map((r, i) => ({
        erpId: r.idworksId, ok: r.ok, steps: r.steps as unknown as Record<string, string>, conteudo: conteudoDoPushIdworks(produtos[i]),
      })));
```

> Import cycle check: `syncStamp.ts` imports only **types** from the agent modules (`import type`), so there is no runtime cycle.

- [ ] **Step 7: Wire the stamp into the agent tools**

`server/agent/tools/tiny.ts`, `tiny.catalogo.enviar` `execute`: right after `const resultados = await pushV2Lote(...)`:

```ts
    await carimbarEnvio(ctx.uid, 'tiny', resultados.map((r, i) => ({
      erpId: r.tinyId, ok: r.ok, steps: r.steps as unknown as Record<string, string>, conteudo: conteudoDoPushTiny(produtos[i]),
    })));
```

with `import { carimbarEnvio, conteudoDoPushTiny } from '../../syncStamp';`.

`server/agent/tools/erps.ts`: in the Wake `enviar`, replace `return out;` with:

```ts
    await carimbarEnvio(ctx.uid, 'wake', out.map((r, i) => ({
      erpId: (r as WakePushResult).produtoId, ok: r.ok, steps: r.steps as Record<string, string>, conteudo: conteudoDoPushWake(produtos[i] as WakePushProduct),
    })));
    return out;
```

and in the IdWorks `enviar`:

```ts
    await carimbarEnvio(ctx.uid, 'idworks', out.map((r, i) => ({
      erpId: (r as IdworksPushResult).idworksId, ok: r.ok, steps: r.steps as unknown as Record<string, string>, conteudo: conteudoDoPushIdworks(produtos[i] as IdworksPushProduct),
    })));
    return out;
```

Add the imports: `carimbarEnvio, conteudoDoPushWake, conteudoDoPushIdworks` from `'../../syncStamp'`, and `type WakePushProduct, type WakePushResult` / `type IdworksPushProduct, type IdworksPushResult` to the existing imports from `wakeAgent`/`idworksAgent`. Bling's `enviar` is left as is (spec: out of scope).

- [ ] **Step 8: Types on the product**

In `src/types/models.ts`, in the Wake block add:

```ts
  _wakePushed?: { descricao?: string; seo?: string; imagens?: string }; // carimbo de sincronização (server/syncStamp.ts)
```

in the Tiny block:

```ts
  _tinyPushed?: { titulo?: string; descricao?: string; seo?: string; imagens?: string }; // carimbo de sincronização (server/syncStamp.ts)
```

and change the comment of `_idworksPushed` to `// carimbo de sincronização (server/syncStamp.ts)`.

- [ ] **Step 9: Regression checks**

Run: `npx tsx scripts/verify-tiny-push.mjs && npx tsx scripts/verify-bling-push.mjs && npx tsx scripts/verify-sincronizacao.mjs && npm run lint`
Expected: todos passam (os pushes não mudaram; o carimbo roda depois deles).

- [ ] **Step 10: Commit**

```bash
git add server/syncStamp.ts server/tinyProvider.ts server/wakeAgent.ts server/idworksAgent.ts server/agent/tools/tiny.ts server/agent/tools/erps.ts src/types/models.ts src/App.tsx scripts/verify-sincronizacao.mjs
git commit -m "feat(sync): carimbo de sincronização gravado no envio ao Tiny, Wake e IdWorks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Carimbo na importação

**Files:**
- Modify: `server/tinyImportWorker.ts:120-150` (upsert; o webhook do Tiny usa o mesmo upsert — confirme com `grep -n "upsert" server/tinyWebhook.ts`; se o webhook tiver upsert próprio, aplique o mesmo bloco lá)
- Modify: `server/idworksImportWorker.ts:55-90` (upsert, usado também por `idworksWebhook.ts`)
- Modify: `src/App.tsx` (`handleWakeImport`, objeto `mapped`)

**Interfaces:**
- Consumes: `assinaturasDeImportacao`, `CAMPO_CARIMBO` (Task 1).

- [ ] **Step 1: Tiny upsert**

In `server/tinyImportWorker.ts` import:

```ts
import { assinaturasDeImportacao } from '../src/modules/agent/sincronizacao';
```

In the upsert, right after the `data` object is built (before `t.imagens.slice(0, 6).forEach(...)`), add:

```ts
  // Chegou do Tiny: o que ele tem agora é o carimbo (imagens só o envio carimba).
  // Com set merge, o carimbo de imagens de um envio anterior continua.
  data._tinyPushed = assinaturasDeImportacao('tiny', {
    titulo: t.nome ?? '',
    descricaoHtml: t.descricaoHtml ?? '',
    seoTitle: t.seoTitle ?? '',
    seoDescription: t.seoDescription ?? '',
    seoKeywords: t.seoKeywords ?? '',
  });
```

Use the exact property that the upsert maps to `'Descrição'` for `titulo` (read the lines above `_tinyProductId: t.tinyId` — it is the same `t.<campo>` assigned to `'Descrição'`).

- [ ] **Step 2: IdWorks upsert**

In `server/idworksImportWorker.ts`, same import, and after the `data` object:

```ts
  data._idworksPushed = assinaturasDeImportacao('idworks', {
    descricaoHtml: p.descricaoHtml ?? '',
    seoTitle: p.seoTitle ?? '',
    seoDescription: p.seoDescription ?? '',
    seoKeywords: p.seoKeywords ?? '',
  });
```

(Check the normalized product type has `seoTitle`/`seoDescription`/`seoKeywords`; `erps.ts` reads `n.seoTitle` etc. from the same `normalizeProduct`, so they exist.)

- [ ] **Step 3: Wake import (client)**

In `src/App.tsx`, import `assinaturasDeImportacao` from `./modules/agent/sincronizacao` (merge into the import added in Task 1). In `handleWakeImport`, inside the `stripUndefined({ ... })` that builds `mapped`, after `_wakeInformacaoId: w.informacaoId,`:

```ts
        _wakePushed: assinaturasDeImportacao('wake', {
          descricaoHtml: w.descricaoHtml ?? '',
          seoTitle: w.seoTitle ?? '',
          seoDescription: w.seoDescription ?? '',
          seoKeywords: w.seoKeywords ?? '',
        }),
```

Note: when merging into an existing product (`next[idx] = { ...next[idx], ...mapped }`), this replaces the whole `_wakePushed` map, dropping an `imagens` stamp. Preserve it:

```ts
      if (idx >= 0) {
        const imagensCarimbadas = next[idx]._wakePushed?.imagens;
        next[idx] = { ...next[idx], ...mapped, _isDirty: true };
        if (imagensCarimbadas) next[idx]._wakePushed = { ...next[idx]._wakePushed, imagens: imagensCarimbadas };
        backups.push({ id: next[idx]._id, raw: w.raw });
      }
```

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: sem erros novos.

- [ ] **Step 5: Manual check (needs dev server and a Tiny-connected test account)**

Run `npm run dev`, importe um produto do Tiny em Integrações e confira no Firestore (console) que o doc ganhou `_tinyPushed` com `titulo`, `descricao` e `seo`, sem `imagens`.

- [ ] **Step 6: Commit**

```bash
git add server/tinyImportWorker.ts server/idworksImportWorker.ts src/App.tsx
git commit -m "feat(sync): importação e webhooks carimbam o que chegou do ERP

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Filtros por grupo, paginação e seleção (puro)

**Files:**
- Modify: `src/modules/agent/produtosAgente.ts` (acrescenta; não remove as exports antigas)
- Modify: `scripts/verify-produtos-agente.mjs`

**Interfaces:**
- Consumes: `integracoesDe`, `IntegracaoSync` (Task 1).
- Produces:
  - `type OpcaoIntegracao = IntegracaoSync | 'nenhuma'`
  - `type OpcaoSync = 'emDia' | 'pendente'`
  - `type OpcaoConteudo = 'semDescricao' | 'semFoto' | 'semAmbientada' | 'semAtributos' | 'semVideo'`
  - `interface FiltrosProdutos { integracao: OpcaoIntegracao[]; sync: OpcaoSync[]; conteudo: OpcaoConteudo[]; categoria: string[] }`
  - `FILTROS_PADRAO`, `FILTROS_VAZIOS`, `ROTULO_OPCAO`
  - `categoriaDe(p: Product): string`
  - `aplicarFiltros(lista: Product[], f: FiltrosProdutos, busca?: string): Product[]`
  - `contarOpcoes(lista, f, busca?): ContagemOpcoes` where `ContagemOpcoes = { integracao: Record<OpcaoIntegracao, number>; sync: Record<OpcaoSync, number>; conteudo: Record<OpcaoConteudo, number>; categoria: Record<string, number> }`
  - `quantosFiltrosAtivos(f): number`
  - `POR_PAGINA = 50`
  - `paginar<T>(lista: T[], pagina: number, porPagina?: number): { itens: T[]; pagina: number; totalPaginas: number; inicio: number; fim: number }`
  - `paginasVisiveis(pagina: number, total: number): (number | '…')[]`
  - `estadoSelecao(idsDaPagina: string[], selecionados: Set<string>, totalFiltrado: number): { paginaToda: boolean; oferecerTodos: boolean }`

- [ ] **Step 1: Write the failing test**

In `scripts/verify-produtos-agente.mjs`, extend the import from `produtosAgente.ts` with:
`aplicarFiltros, contarOpcoes, FILTROS_PADRAO, FILTROS_VAZIOS, quantosFiltrosAtivos, paginar, paginasVisiveis, estadoSelecao, categoriaDe`

and append, **before** the first `if (failures)`:

```js
// --- Filtros por grupo (painel de filtros) --------------------------------------
{
  const P = (sku, over = {}) => ({ _id: sku, 'Código (SKU)': sku, 'Descrição': sku, 'URL imagem 1': 'https://f', 'Descrição complementar': 'ok', ...over });
  const L = [
    P('T1', { _tinyProductId: '1', Categoria: 'Camisetas' }),                                   // tiny em dia
    P('T2', { _tinyProductId: '2', _statusDescricao: 'Gerado por IA', Categoria: 'Camisetas' }), // tiny pendente (sem carimbo, gerado)
    P('W1', { _wakeProductId: 'w', 'Descrição complementar': '' }),                              // wake, sem descrição
    P('N1', { 'URL imagem 1': '' }),                                                              // só OMNI360, sem foto
  ];
  const f = (over) => ({ ...FILTROS_VAZIOS, ...over });
  check('vazio mostra tudo', aplicarFiltros(L, FILTROS_VAZIOS).map((x) => x._id), ['T1', 'T2', 'W1', 'N1']);
  check('OU dentro do grupo', aplicarFiltros(L, f({ integracao: ['wake', 'nenhuma'] })).map((x) => x._id), ['W1', 'N1']);
  check('E entre grupos', aplicarFiltros(L, f({ integracao: ['tiny'], sync: ['pendente'] })).map((x) => x._id), ['T2']);
  check('sincronização em dia exige vínculo', aplicarFiltros(L, f({ sync: ['emDia'] })).map((x) => x._id), ['T1', 'W1']);
  check('padrão = incompletos', aplicarFiltros(L, FILTROS_PADRAO).map((x) => x._id), ['W1', 'N1']);
  check('categoria', aplicarFiltros(L, f({ categoria: ['Camisetas'] })).map((x) => x._id), ['T1', 'T2']);
  check('sem categoria tem nome', categoriaDe(L[2]), 'Sem categoria');
  check('busca combina com filtros', aplicarFiltros(L, f({ integracao: ['tiny'] }), 't2').map((x) => x._id), ['T2']);
  const c = contarOpcoes(L, f({ integracao: ['tiny'] }));
  check('contagem do próprio grupo ignora a seleção dele', c.integracao, { tiny: 2, wake: 1, bling: 0, idworks: 0, nenhuma: 1 });
  check('contagem dos outros grupos respeita a integração escolhida', c.sync, { emDia: 1, pendente: 1 });
  check('filtros ativos', quantosFiltrosAtivos(f({ integracao: ['tiny'], conteudo: ['semFoto', 'semDescricao'] })), 3);
}

// --- Paginação e seleção ----------------------------------------------------------
{
  const n = Array.from({ length: 120 }, (_, i) => i);
  const p2 = paginar(n, 2);
  check('página 2 de 50', [p2.itens[0], p2.itens.length, p2.inicio, p2.fim, p2.totalPaginas], [50, 50, 51, 100, 3]);
  check('última página parcial', paginar(n, 3).itens.length, 20);
  check('página fora do intervalo cai na última', paginar(n, 9).pagina, 3);
  check('lista vazia tem 1 página', [paginar([], 1).totalPaginas, paginar([], 1).inicio], [1, 0]);
  check('páginas visíveis com reticências', paginasVisiveis(5, 9), [1, '…', 4, 5, 6, '…', 9]);
  check('poucas páginas sem reticências', paginasVisiveis(1, 3), [1, 2, 3]);

  // Review Focus 4: seleção atravessa páginas e filtros.
  const pagina = ['a', 'b'];
  check('página toda marcada e mais no filtro oferece todos',
    estadoSelecao(pagina, new Set(['a', 'b']), 412), { paginaToda: true, oferecerTodos: true });
  check('tudo do filtro já selecionado não oferece',
    estadoSelecao(pagina, new Set(['a', 'b']), 2), { paginaToda: true, oferecerTodos: false });
  check('seleção de outra página não conta como página toda',
    estadoSelecao(pagina, new Set(['a', 'z']), 412), { paginaToda: false, oferecerTodos: false });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/verify-produtos-agente.mjs`
Expected: FAIL — `aplicarFiltros is not a function` (ou SyntaxError de import).

- [ ] **Step 3: Implement**

Append to `src/modules/agent/produtosAgente.ts` (add `import { integracoesDe, type IntegracaoSync } from './sincronizacao';` to the imports):

```ts
// ---------------------------------------------------------------------------
// Painel de filtros (lista unificada): OU dentro do grupo, E entre grupos.
// ---------------------------------------------------------------------------

export type OpcaoIntegracao = IntegracaoSync | 'nenhuma';
export type OpcaoSync = 'emDia' | 'pendente';
export type OpcaoConteudo = 'semDescricao' | 'semFoto' | 'semAmbientada' | 'semAtributos' | 'semVideo';

export interface FiltrosProdutos {
  integracao: OpcaoIntegracao[];
  sync: OpcaoSync[];
  conteudo: OpcaoConteudo[];
  categoria: string[];
}

export const FILTROS_VAZIOS: FiltrosProdutos = { integracao: [], sync: [], conteudo: [], categoria: [] };
/** Abre em "Incompletos", como antes: sem descrição OU sem foto. */
export const FILTROS_PADRAO: FiltrosProdutos = { ...FILTROS_VAZIOS, conteudo: ['semDescricao', 'semFoto'] };

export const OPCOES_INTEGRACAO: OpcaoIntegracao[] = ['tiny', 'wake', 'bling', 'idworks', 'nenhuma'];
export const OPCOES_SYNC: OpcaoSync[] = ['emDia', 'pendente'];
export const OPCOES_CONTEUDO: OpcaoConteudo[] = ['semDescricao', 'semFoto', 'semAmbientada', 'semAtributos', 'semVideo'];

export const ROTULO_OPCAO: Record<OpcaoIntegracao | OpcaoSync | OpcaoConteudo, string> = {
  tiny: 'Tiny', wake: 'Wake', bling: 'Bling', idworks: 'IdWorks', nenhuma: 'Só no OMNI360',
  emDia: 'Em dia', pendente: 'Com alterações não enviadas',
  semDescricao: 'Sem descrição', semFoto: 'Sem foto', semAmbientada: 'Sem ambientada', semAtributos: 'Sem atributos', semVideo: 'Sem vídeo',
};

export const categoriaDe = (p: Product) => str(p['Categoria']) || 'Sem categoria';

const rec = (p: Product) => p as unknown as Record<string, unknown>;

const PRED_INTEGRACAO: Record<OpcaoIntegracao, (p: Product) => boolean> = {
  tiny: (p) => !!str(p._tinyProductId),
  wake: (p) => !!str(p._wakeProductId),
  bling: (p) => !!str(p._blingProductId),
  idworks: (p) => !!str(p._idworksProductId),
  nenhuma: (p) => !noErp(p),
};
const PRED_SYNC: Record<OpcaoSync, (p: Product) => boolean> = {
  emDia: (p) => { const i = integracoesDe(rec(p)); return i.length > 0 && i.every((x) => x.estado.tipo === 'em-dia'); },
  pendente: (p) => integracoesDe(rec(p)).some((x) => x.estado.tipo === 'pendente'),
};
const PRED_CONTEUDO: Record<OpcaoConteudo, (p: Product) => boolean> = {
  semDescricao: semDescricao,
  semFoto: (p) => !temFoto(p),
  semAmbientada: (p) => temFoto(p) && !temAmbientada(p),
  semAtributos: (p) => !getProductStatusFlags(p).atributosGerados,
  semVideo: (p) => temFoto(p) && !temVideo(p) && !videoRodando(p),
};

type Grupo = keyof FiltrosProdutos;

function passaGrupo(p: Product, f: FiltrosProdutos, g: Grupo): boolean {
  switch (g) {
    case 'integracao': return !f.integracao.length || f.integracao.some((o) => PRED_INTEGRACAO[o](p));
    case 'sync': return !f.sync.length || f.sync.some((o) => PRED_SYNC[o](p));
    case 'conteudo': return !f.conteudo.length || f.conteudo.some((o) => PRED_CONTEUDO[o](p));
    case 'categoria': return !f.categoria.length || f.categoria.includes(categoriaDe(p));
  }
}

const GRUPOS: Grupo[] = ['integracao', 'sync', 'conteudo', 'categoria'];

const casaBusca = (p: Product, q: string) => !q || nomeDe(p).toLowerCase().includes(q) || skuDe(p).toLowerCase().includes(q);

export function aplicarFiltros(lista: Product[], f: FiltrosProdutos, busca = ''): Product[] {
  const q = busca.trim().toLowerCase();
  return lista.filter((p) => casaBusca(p, q) && GRUPOS.every((g) => passaGrupo(p, f, g)));
}

export interface ContagemOpcoes {
  integracao: Record<OpcaoIntegracao, number>;
  sync: Record<OpcaoSync, number>;
  conteudo: Record<OpcaoConteudo, number>;
  categoria: Record<string, number>;
}

/** Quantos cada opção mostraria: aplica busca e os OUTROS grupos, nunca o próprio. */
export function contarOpcoes(lista: Product[], f: FiltrosProdutos, busca = ''): ContagemOpcoes {
  const q = busca.trim().toLowerCase();
  const base = (g: Grupo) => lista.filter((p) => casaBusca(p, q) && GRUPOS.every((o) => o === g || passaGrupo(p, f, o)));
  const contar = <K extends string>(itens: Product[], opcoes: K[], pred: Record<K, (p: Product) => boolean>) =>
    Object.fromEntries(opcoes.map((o) => [o, itens.filter(pred[o]).length])) as Record<K, number>;
  const categoria: Record<string, number> = {};
  for (const p of base('categoria')) categoria[categoriaDe(p)] = (categoria[categoriaDe(p)] ?? 0) + 1;
  return {
    integracao: contar(base('integracao'), OPCOES_INTEGRACAO, PRED_INTEGRACAO),
    sync: contar(base('sync'), OPCOES_SYNC, PRED_SYNC),
    conteudo: contar(base('conteudo'), OPCOES_CONTEUDO, PRED_CONTEUDO),
    categoria,
  };
}

export const quantosFiltrosAtivos = (f: FiltrosProdutos) =>
  f.integracao.length + f.sync.length + f.conteudo.length + f.categoria.length;

// ---------------------------------------------------------------------------
// Paginação e seleção
// ---------------------------------------------------------------------------

export const POR_PAGINA = 50;

export function paginar<T>(lista: T[], pagina: number, porPagina = POR_PAGINA) {
  const totalPaginas = Math.max(1, Math.ceil(lista.length / porPagina));
  const atual = Math.min(Math.max(1, Math.floor(pagina) || 1), totalPaginas);
  const ini = (atual - 1) * porPagina;
  const itens = lista.slice(ini, ini + porPagina);
  return { itens, pagina: atual, totalPaginas, inicio: itens.length ? ini + 1 : 0, fim: ini + itens.length };
}

/** "1 … 4 5 6 … 9": primeira, última e a vizinhança da atual. */
export function paginasVisiveis(pagina: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: (number | '…')[] = [1];
  const ini = Math.max(2, pagina - 1);
  const fim = Math.min(total - 1, pagina + 1);
  if (ini > 2) out.push('…');
  for (let i = ini; i <= fim; i++) out.push(i);
  if (fim < total - 1) out.push('…');
  out.push(total);
  return out;
}

/** A faixa "Selecionar todos os N do filtro" só aparece com a página inteira marcada e mais resultados fora dela. */
export function estadoSelecao(idsDaPagina: string[], selecionados: Set<string>, totalFiltrado: number) {
  const paginaToda = idsDaPagina.length > 0 && idsDaPagina.every((id) => selecionados.has(id));
  return { paginaToda, oferecerTodos: paginaToda && totalFiltrado > idsDaPagina.length && selecionados.size < totalFiltrado };
}
```

`videoRodando` is already defined (not exported) at the top of the file — reuse it. `getProductStatusFlags` is already imported.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/verify-produtos-agente.mjs`
Expected: todas `ok` (as verificações antigas continuam passando).

- [ ] **Step 5: Commit**

```bash
git add src/modules/agent/produtosAgente.ts scripts/verify-produtos-agente.mjs
git commit -m "feat(produtos): filtros por grupo, paginação de 50 e estado da seleção

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Lista nova na tela de Produtos

**Files:**
- Create: `src/modules/agent/produtos/SeloIntegracao.tsx`
- Create: `src/modules/agent/produtos/LinhaProduto.tsx`
- Create: `src/modules/agent/produtos/PainelFiltros.tsx`
- Create: `src/modules/agent/produtos/Paginacao.tsx`
- Modify: `src/modules/agent/ProdutosAgenteScreen.tsx` (corpo da lista; mantém props e barra por enquanto)

**Interfaces:**
- Consumes: Task 1 (`integracoesDe`, `ROTULO_INTEGRACAO`, `ROTULO_GRUPO`, `EstadoSync`, `IntegracaoSync`), Task 4 (filtros, paginação, `estadoSelecao`).
- Produces (later tasks use the screen, not these internals): `LinhaProduto` props `{ p: Product; marcado: boolean; onMarcar: () => void; onAbrir: () => void; mostrarVideo: boolean }`.

No pure logic here (all in Task 4); verification is manual + lint.

- [ ] **Step 1: `SeloIntegracao.tsx`**

```tsx
import React from 'react';
import { ROTULO_GRUPO, ROTULO_INTEGRACAO, type EstadoSync, type IntegracaoSync } from '../sincronizacao';

/**
 * "Tiny · em dia" (neutro), "Tiny · 2 não enviadas" (âmbar, o title lista quais)
 * ou "Só no OMNI360" (contorno, sem integração).
 */
const SeloIntegracao: React.FC<{ integracao?: IntegracaoSync; estado?: EstadoSync }> = ({ integracao, estado }) => {
  const base = 'inline-flex items-center h-6 px-2 rounded-full text-[11.5px] font-medium whitespace-nowrap';
  if (!integracao || !estado) {
    return <span className={base} style={{ color: 'var(--ag-text-3)', boxShadow: 'inset 0 0 0 1px var(--ag-hairline-2)' }}>Só no OMNI360</span>;
  }
  const nome = ROTULO_INTEGRACAO[integracao];
  if (estado.tipo === 'pendente') {
    const n = estado.grupos.length;
    return (
      <span
        className={base}
        title={`Não enviado ao ${nome}: ${estado.grupos.map((g) => ROTULO_GRUPO[g]).join(', ')}`}
        style={{ background: 'var(--ag-warn-soft)', color: 'var(--ag-warn)' }}
      >
        {nome} · {n} {n === 1 ? 'não enviada' : 'não enviadas'}
      </span>
    );
  }
  return <span className={base} style={{ background: 'var(--ag-fill)', color: 'var(--ag-text-2)' }}>{nome} · em dia</span>;
};

export default SeloIntegracao;
```

- [ ] **Step 2: `LinhaProduto.tsx`**

Move `Pilula`, `primeiraImagem`, `Miniatura` and `Caixa` out of `ProdutosAgenteScreen.tsx` into this file (exact code as they are today; export `Caixa` for the header) and add:

```tsx
import React from 'react';
import type { Product } from '../../../types/models';
import { integracoesDe } from '../sincronizacao';
import { nomeDe, pilulasDe, skuDe } from '../produtosAgente';
import SeloIntegracao from './SeloIntegracao';
// ...Pilula, primeiraImagem, Miniatura, Caixa movidos para cá (sem mudança)...

interface Props {
  p: Product;
  marcado: boolean;
  onMarcar: () => void;
  onAbrir: () => void;
  /** Filtro "Sem vídeo" ativo: a pílula de vídeo entra na linha. */
  mostrarVideo: boolean;
}

/** Caixa no começo; o resto da linha abre o produto. Selos e pílulas descem no telefone. */
const LinhaProduto: React.FC<Props> = ({ p, marcado, onMarcar, onAbrir, mostrarVideo }) => {
  const integracoes = integracoesDe(p as unknown as Record<string, unknown>);
  const pilulas = [...pilulasDe(p, 'catalogo'), ...(mostrarVideo ? pilulasDe(p, 'videos').slice(1) : [])];
  return (
    <div
      className="flex items-center gap-1 pl-1 pr-3 py-2.5 transition-colors hover:bg-[var(--ag-fill)]"
      style={{ borderTop: '1px solid var(--ag-hairline)', background: marcado ? 'var(--ag-fill)' : undefined }}
    >
      <Caixa marcada={marcado} rotulo={`Selecionar ${nomeDe(p)}${skuDe(p) ? ` (${skuDe(p)})` : ''}`} onClick={onMarcar} />
      <button onClick={onAbrir} className="flex-1 min-w-0 flex flex-col lg:flex-row lg:items-center gap-1.5 lg:gap-3 text-left">
        <span className="flex-1 min-w-0 flex items-center gap-3">
          <Miniatura p={p} />
          <span className="min-w-0 flex flex-col">
            <span className="text-[14px] font-semibold text-[var(--ag-text)] truncate">{nomeDe(p)}</span>
            {skuDe(p) && <span className="text-[12px] font-mono text-[var(--ag-text-3)] truncate">{skuDe(p)}</span>}
          </span>
        </span>
        <span className="lg:w-[170px] flex gap-1 flex-wrap pl-[60px] lg:pl-0">
          {integracoes.length
            ? integracoes.map((i) => <SeloIntegracao key={i.integracao} integracao={i.integracao} estado={i.estado} />)
            : <SeloIntegracao />}
        </span>
        <span className="lg:w-[38%] flex gap-1 flex-wrap pl-[60px] lg:pl-0">
          {pilulas.map((pl) => <Pilula key={pl.rotulo} rotulo={pl.rotulo} estado={pl.estado} />)}
        </span>
      </button>
    </div>
  );
};

export default LinhaProduto;
```

In `Caixa`, change `-mr-1.5` to `-ml-0.5` (it now sits at the start of the row).

- [ ] **Step 3: `PainelFiltros.tsx`**

```tsx
import React, { useMemo, useState } from 'react';
import { Check, Search, X } from 'lucide-react';
import {
  FILTROS_VAZIOS, OPCOES_CONTEUDO, OPCOES_INTEGRACAO, OPCOES_SYNC, ROTULO_OPCAO,
  type ContagemOpcoes, type FiltrosProdutos,
} from '../produtosAgente';

interface Props {
  filtros: FiltrosProdutos;
  contagem: ContagemOpcoes;
  onMudar: (f: FiltrosProdutos) => void;
  onFechar: () => void;
  /** Telefone: folha que sobe da base; desktop: popover ancorado no botão. */
  folha: boolean;
}

const Opcao: React.FC<{ rotulo: string; n: number; marcada: boolean; onClick: () => void }> = ({ rotulo, n, marcada, onClick }) => (
  <button
    onClick={onClick}
    role="checkbox"
    aria-checked={marcada}
    className="w-full min-h-[44px] flex items-center gap-3 px-3 rounded-[12px] text-left text-[14px] text-[var(--ag-text)] hover:bg-[var(--ag-fill)]"
  >
    <span
      className="w-[20px] h-[20px] rounded-[6px] grid place-items-center shrink-0"
      style={marcada ? { background: 'var(--ag-text)', color: 'var(--ag-bg-2)' } : { border: '1.5px solid var(--ag-hairline-2)' }}
    >
      {marcada && <Check className="w-3 h-3" strokeWidth={3} />}
    </span>
    <span className="flex-1">{rotulo}</span>
    <span className="tabular-nums text-[12.5px] text-[var(--ag-text-3)]">{n}</span>
  </button>
);

const Grupo: React.FC<{ titulo: string; children: React.ReactNode }> = ({ titulo, children }) => (
  <section className="flex flex-col gap-0.5">
    <h3 className="px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--ag-text-3)]">{titulo}</h3>
    {children}
  </section>
);

function alternar<T>(lista: T[], v: T): T[] {
  return lista.includes(v) ? lista.filter((x) => x !== v) : [...lista, v];
}

const PainelFiltros: React.FC<Props> = ({ filtros, contagem, onMudar, onFechar, folha }) => {
  const [buscaCategoria, setBuscaCategoria] = useState('');
  const categorias = useMemo(() => {
    const q = buscaCategoria.trim().toLowerCase();
    return Object.entries(contagem.categoria)
      .filter(([nome]) => !q || nome.toLowerCase().includes(q))
      .sort((a, b) => b[1] - a[1]);
  }, [contagem.categoria, buscaCategoria]);

  const corpo = (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-3 pt-2">
        <span className="text-[15px] font-semibold text-[var(--ag-text)]">Filtros</span>
        <div className="flex items-center gap-1">
          <button onClick={() => onMudar(FILTROS_VAZIOS)} className="h-9 px-3 rounded-full text-[13px] font-medium text-[var(--ag-text-2)] hover:text-[var(--ag-text)]">Limpar</button>
          <button onClick={onFechar} aria-label="Fechar filtros" className="w-9 h-9 grid place-items-center rounded-full text-[var(--ag-text-2)]"><X className="w-4 h-4" /></button>
        </div>
      </div>
      <Grupo titulo="Integração">
        {OPCOES_INTEGRACAO.map((o) => (
          <Opcao key={o} rotulo={ROTULO_OPCAO[o]} n={contagem.integracao[o]} marcada={filtros.integracao.includes(o)}
            onClick={() => onMudar({ ...filtros, integracao: alternar(filtros.integracao, o) })} />
        ))}
      </Grupo>
      <Grupo titulo="Sincronização">
        {OPCOES_SYNC.map((o) => (
          <Opcao key={o} rotulo={ROTULO_OPCAO[o]} n={contagem.sync[o]} marcada={filtros.sync.includes(o)}
            onClick={() => onMudar({ ...filtros, sync: alternar(filtros.sync, o) })} />
        ))}
      </Grupo>
      <Grupo titulo="Conteúdo">
        {OPCOES_CONTEUDO.map((o) => (
          <Opcao key={o} rotulo={ROTULO_OPCAO[o]} n={contagem.conteudo[o]} marcada={filtros.conteudo.includes(o)}
            onClick={() => onMudar({ ...filtros, conteudo: alternar(filtros.conteudo, o) })} />
        ))}
      </Grupo>
      <Grupo titulo="Categoria">
        <label className="relative flex items-center mx-3 mb-1">
          <Search className="absolute left-3 w-4 h-4 text-[var(--ag-text-3)] pointer-events-none" />
          <input
            value={buscaCategoria}
            onChange={(e) => setBuscaCategoria(e.target.value)}
            placeholder="Buscar categoria"
            className="w-full h-10 pl-9 pr-3 rounded-full text-[16px] md:text-[13.5px] outline-none text-[var(--ag-text)] placeholder:text-[var(--ag-text-3)]"
            style={{ background: 'var(--ag-fill)', border: '1px solid var(--ag-hairline)' }}
          />
        </label>
        <div className="max-h-[220px] overflow-y-auto ag-scroll">
          {categorias.map(([nome, n]) => (
            <Opcao key={nome} rotulo={nome} n={n} marcada={filtros.categoria.includes(nome)}
              onClick={() => onMudar({ ...filtros, categoria: alternar(filtros.categoria, nome) })} />
          ))}
        </div>
      </Grupo>
    </div>
  );

  if (folha) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col justify-end" role="dialog" aria-label="Filtros">
        <button aria-label="Fechar filtros" className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.35)' }} onClick={onFechar} />
        <div className="relative ag-glass-strong rounded-t-[24px] max-h-[85dvh] overflow-y-auto ag-scroll pb-[max(16px,env(safe-area-inset-bottom))]">
          <div className="mx-auto mt-2 w-10 h-1 rounded-full" style={{ background: 'var(--ag-hairline-2)' }} />
          {corpo}
        </div>
      </div>
    );
  }
  return (
    <div
      className="absolute right-0 top-[calc(100%+8px)] z-40 w-[340px] max-h-[70vh] overflow-y-auto ag-scroll ag-glass-strong rounded-[20px] pb-2"
      style={{ boxShadow: 'var(--ag-shadow)', border: '1px solid var(--ag-hairline)' }}
      role="dialog"
      aria-label="Filtros"
    >
      {corpo}
    </div>
  );
};

export default PainelFiltros;
```

- [ ] **Step 4: `Paginacao.tsx`**

```tsx
import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { paginasVisiveis } from '../produtosAgente';

interface Props {
  pagina: number;
  totalPaginas: number;
  inicio: number;
  fim: number;
  total: number;
  onIr: (pagina: number) => void;
}

const Paginacao: React.FC<Props> = ({ pagina, totalPaginas, inicio, fim, total, onIr }) => {
  if (totalPaginas <= 1) return null;
  const botao = 'min-w-[40px] h-10 px-2 rounded-full text-[13.5px] font-medium tabular-nums disabled:opacity-40';
  return (
    <nav aria-label="Paginação" className="flex items-center justify-between gap-2 py-2">
      <span className="hidden sm:block text-[12.5px] text-[var(--ag-text-2)] tabular-nums">
        {inicio}–{fim} de {total.toLocaleString('pt-BR')}
      </span>
      <div className="flex-1 sm:flex-initial flex items-center justify-between sm:justify-end gap-1">
        <button className={botao} disabled={pagina === 1} onClick={() => onIr(pagina - 1)} aria-label="Página anterior"
          style={{ background: 'var(--ag-fill)', color: 'var(--ag-text)' }}>
          <ChevronLeft className="w-4 h-4 mx-auto" />
        </button>
        <span className="sm:hidden text-[13.5px] text-[var(--ag-text)] tabular-nums">{pagina} de {totalPaginas}</span>
        <span className="hidden sm:flex items-center gap-1">
          {paginasVisiveis(pagina, totalPaginas).map((n, i) => n === '…'
            ? <span key={`r${i}`} className="px-1 text-[var(--ag-text-3)]">…</span>
            : (
              <button key={n} className={botao} onClick={() => onIr(n)} aria-current={n === pagina ? 'page' : undefined}
                style={n === pagina ? { background: 'var(--ag-text)', color: 'var(--ag-bg-2)' } : { color: 'var(--ag-text-2)' }}>
                {n}
              </button>
            ))}
        </span>
        <button className={botao} disabled={pagina === totalPaginas} onClick={() => onIr(pagina + 1)} aria-label="Próxima página"
          style={{ background: 'var(--ag-fill)', color: 'var(--ag-text)' }}>
          <ChevronRight className="w-4 h-4 mx-auto" />
        </button>
      </div>
    </nav>
  );
};

export default Paginacao;
```

- [ ] **Step 5: Rework the list in `ProdutosAgenteScreen.tsx`**

Changes (keep the component's props and the `BarraProximoPasso` usage as is — Task 10 changes those):

1. Remove `segmento`/`filtro`/`limite` state, `SEGMENTOS` and the segment/filter-pill JSX. Replace with:

```tsx
  const [filtros, setFiltros] = useState<FiltrosProdutos>(FILTROS_PADRAO);
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  const [pagina, setPagina] = useState(1);
  const telaPequena = useTelaPequena();
  const listaRef = useRef<HTMLDivElement>(null);

  const visiveis = useMemo(() => aplicarFiltros(lista, filtros, busca), [lista, filtros, busca]);
  const contagem = useMemo(() => contarOpcoes(lista, filtros, busca), [lista, filtros, busca]);
  const pag = useMemo(() => paginar(visiveis, pagina), [visiveis, pagina]);
  const idsDaPagina = useMemo(() => pag.itens.map((p) => p._id), [pag.itens]);
  const selecao = estadoSelecao(idsDaPagina, selecionados, visiveis.length);
  const nFiltros = quantosFiltrosAtivos(filtros);

  useEffect(() => { setPagina(1); }, [filtros, busca]);
  const irPara = (n: number) => { setPagina(n); if (listaRef.current) listaRef.current.scrollTop = 0; };
```

(`listaRef` goes on the `ag-scroll` div that scrolls the list; use `scrollTop`, never `scrollIntoView`.)

2. `alternarTodos` marks/unmarks **the page**:

```tsx
  const alternarPagina = () => {
    const prox = new Set(selecionados);
    if (selecao.paginaToda) idsDaPagina.forEach((id) => prox.delete(id));
    else idsDaPagina.forEach((id) => prox.add(id));
    onSelecionar(prox);
  };
```

3. Top row: title + count (as today), then on the right: search (desktop), a **Filtros** button in a `relative` wrapper that renders `<PainelFiltros folha={telaPequena} ... />` when open, and the three shortcuts (`Categorias` → `onAbrirView('categories')`, `Envio ERP` → `onAbrirView('integrations')`, `Tabela completa` → `onAbrirView('products')`) as round 44px buttons with the existing style. Filtros button:

```tsx
<div className="relative">
  <button
    onClick={() => setFiltrosAbertos((v) => !v)}
    aria-expanded={filtrosAbertos}
    className="h-11 px-4 rounded-full flex items-center gap-2 text-[13.5px] font-semibold text-[var(--ag-text)]"
    style={{ background: 'var(--ag-surface-solid)', border: '1px solid var(--ag-hairline)' }}
  >
    <SlidersHorizontal className="w-4 h-4 text-[var(--ag-text-2)]" />
    Filtros{nFiltros > 0 && <span className="tabular-nums"> · {nFiltros}</span>}
  </button>
  {filtrosAbertos && (
    <PainelFiltros folha={telaPequena} filtros={filtros} contagem={contagem} onMudar={setFiltros} onFechar={() => setFiltrosAbertos(false)} />
  )}
</div>
```

4. Below the top row, active filters as removable pills (one per selected option; label from `ROTULO_OPCAO` or the category name), each with `×` that removes just that option.

5. List header: `<Caixa marcada={selecao.paginaToda} rotulo="Selecionar os desta página" onClick={alternarPagina} />` first, then `"{visiveis.length} produtos · {n} selecionados"`, and on `lg` the column headings `Integração` (w-[170px]) and `O que tem` (w-[38%]). When `selecao.oferecerTodos`, a strip under the header:

```tsx
{selecao.oferecerTodos && (
  <div className="px-4 py-2 text-[13px] text-[var(--ag-text-2)]" style={{ borderTop: '1px solid var(--ag-hairline)', background: 'var(--ag-fill)' }}>
    {idsDaPagina.length} desta página selecionados ·{' '}
    <button className="font-semibold text-[var(--ag-accent)]" onClick={() => onSelecionar(new Set([...selecionados, ...visiveis.map((p) => p._id)]))}>
      Selecionar todos os {visiveis.length.toLocaleString('pt-BR')} do filtro
    </button>
  </div>
)}
{!selecao.oferecerTodos && n > idsDaPagina.length && n > 0 && (
  <div className="px-4 py-2 text-[13px] text-[var(--ag-text-2)]" style={{ borderTop: '1px solid var(--ag-hairline)', background: 'var(--ag-fill)' }}>
    {n} selecionados no total · <button className="font-semibold text-[var(--ag-accent)]" onClick={() => onSelecionar(new Set())}>Limpar seleção</button>
  </div>
)}
```

6. Rows: `pag.itens.map((p) => <LinhaProduto key={p._id} p={p} marcado={selecionados.has(p._id)} onMarcar={() => alternar(p._id)} onAbrir={() => onAbrirProduto(p, 'geral')} mostrarVideo={filtros.conteudo.includes('semVideo')} />)`.

7. Under the list: `<Paginacao pagina={pag.pagina} totalPaginas={pag.totalPaginas} inicio={pag.inicio} fim={pag.fim} total={visiveis.length} onIr={irPara} />`. Remove the "Mostrar mais" button.

8. `selecionaveis` is now always `true` (no segments). `produtosSelecionados` stays computed from `lista` (whole catalog), not from the page — the bar acts on the whole selection.

9. Empty state text: `busca ? 'Nenhum produto com esse nome ou SKU.' : lista.length === 0 ? 'O catálogo está vazio.' : nFiltros ? 'Nenhum produto com esses filtros.' : 'Nada aqui.'`, plus a "Limpar filtros" button when `nFiltros > 0`.

Imports to add: `useRef`, `SlidersHorizontal` (lucide), `useTelaPequena` from `./useViewport`, the Task 4 exports, `LinhaProduto`, `{ Caixa }` from `./produtos/LinhaProduto`, `PainelFiltros`, `Paginacao`. Remove now-unused imports (`FILTROS_DO_SEGMENTO`, `ABA_DO_SEGMENTO`, `contarFiltros`, `filtrarProdutos`, `ROTULO_FILTRO`, `ASPECTO*` if only used by moved code).

- [ ] **Step 6: Lint**

Run: `npm run lint`
Expected: sem erros novos.

- [ ] **Step 7: Manual check**

`npm run dev`, entre com uma conta com agente, Ferramentas → Produtos:
- abre com "Filtros · 2" (sem descrição, sem foto) e as duas pílulas ativas;
- selo "Tiny · em dia"/"… não enviadas"/"Só no OMNI360" coerente;
- filtros OU/E e contagens mudam juntos; categoria com busca;
- paginação 50 por página, volta à 1 ao filtrar, rola ao topo ao trocar;
- marcar a página inteira mostra "Selecionar todos os N do filtro";
- 390px (DevTools): selos/pílulas sob o nome, filtros como folha, paginação `‹ 2 de 9 ›`;
- tema escuro: nada ilegível.

- [ ] **Step 8: Commit**

```bash
git add src/modules/agent/produtos src/modules/agent/ProdutosAgenteScreen.tsx
git commit -m "feat(produtos): lista com integração, painel de filtros e paginação

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Confirmação em massa (puro)

**Files:**
- Create: `src/modules/agent/confirmacaoMassa.ts`
- Create: `scripts/verify-confirmacao-massa.mjs`

**Interfaces:**
- Produces:
  - `type FerramentaMassa = 'produtos.descricoes.gerar' | 'produtos.ambientadas.gerar'`
  - `FERRAMENTAS_MASSA: FerramentaMassa[]`
  - `TAMANHO_LOTE: Record<FerramentaMassa, number>` (50 / 10)
  - `interface CandidatoMassa { id: string; nome: string; temDescricao: boolean; temAmbientada: boolean; temFoto: boolean }`
  - `interface Confirmacao { ferramenta: FerramentaMassa; total: number; novos: CandidatoMassa[]; jaTem: CandidatoMassa[]; semFoto: CandidatoMassa[]; custoUnitario: number }`
  - `montarConfirmacao(ferramenta, candidatos: CandidatoMassa[], custoUnitario: number): Confirmacao`
  - `alvos(c: Confirmacao, sobrescrever: boolean): CandidatoMassa[]`
  - `custoDe(c: Confirmacao, sobrescrever: boolean): number`
  - `etapasPensando(c: Confirmacao): string[]`
  - `emLotes<T>(itens: T[], tamanho: number): T[][]`
  - `listaNomes(itens: { nome: string }[], max?: number): string`

- [ ] **Step 1: Write the failing test**

```js
// Verificação da confirmação "pular ou sobrescrever" (src/modules/agent/confirmacaoMassa.ts).
// Rodar com: npx tsx scripts/verify-confirmacao-massa.mjs
import { montarConfirmacao, alvos, custoDe, etapasPensando, emLotes, listaNomes, TAMANHO_LOTE } from '../src/modules/agent/confirmacaoMassa.ts';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? '  ok' : 'FALHA'}  ${label}${ok ? '' : ` → esperado ${JSON.stringify(expected)}, veio ${JSON.stringify(actual)}`}`);
}

const c = (id, over = {}) => ({ id, nome: `P${id}`, temDescricao: false, temAmbientada: false, temFoto: true, ...over });
const sel = [c('1'), c('2', { temDescricao: true }), c('3', { temDescricao: true, temAmbientada: true }), c('4', { temFoto: false })];

const d = montarConfirmacao('produtos.descricoes.gerar', sel, 3);
check('descrição: novos e já têm', [d.novos.map((x) => x.id), d.jaTem.map((x) => x.id), d.semFoto.length], [['1', '4'], ['2', '3'], 0]);
check('pular gera só os novos', alvos(d, false).map((x) => x.id), ['1', '4']);
check('sobrescrever gera todos', alvos(d, true).map((x) => x.id), ['1', '4', '2', '3']);
check('custo por modo', [custoDe(d, false), custoDe(d, true)], [6, 12]);

const i = montarConfirmacao('produtos.ambientadas.gerar', sel, 1);
check('imagem: sem foto fica de fora sempre', [i.novos.map((x) => x.id), i.jaTem.map((x) => x.id), i.semFoto.map((x) => x.id)], [['1', '2'], ['3'], ['4']]);
check('sobrescrever imagem não inclui sem foto', alvos(i, true).map((x) => x.id), ['1', '2', '3']);

// Review Focus 3: todos já têm.
const todos = montarConfirmacao('produtos.descricoes.gerar', [c('a', { temDescricao: true })], 3);
check('todos já têm: nada no modo pular', [alvos(todos, false).length, alvos(todos, true).length], [0, 1]);

const etapas = etapasPensando(d);
check('etapas reais', etapas, [
  'Lendo os 4 produtos selecionados…',
  'Conferindo descrições — 2 já têm: P2, P3',
  'Calculando custo — 2 × 3 = 6 créditos',
]);
check('etapas de imagem citam quem fica sem foto', etapasPensando(i)[2], 'Sem foto para servir de base — 1 fica de fora: P4');

check('lotes de 50 e 10', [TAMANHO_LOTE['produtos.descricoes.gerar'], TAMANHO_LOTE['produtos.ambientadas.gerar']], [50, 10]);
check('emLotes', emLotes([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
check('lista de nomes corta com "e mais"', listaNomes([{ nome: 'a' }, { nome: 'b' }, { nome: 'c' }, { nome: 'd' }], 2), 'a, b e mais 2');

if (failures) { console.error(`\n${failures} falha(s).`); process.exit(1); }
console.log('\nTudo certo.');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/verify-confirmacao-massa.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// Confirmação de "Gerar descrição/imagem para todas" — quem entra, quem já tem,
// quem fica de fora e quanto custa.
//
// Puro e usado dos dois lados: a tela monta o card com isto (sem IA, número
// sempre certo) e a rota POST /api/agent/lotes refaz a mesma conta no servidor,
// porque o corpo vem do navegador. Verificar com
// `npx tsx scripts/verify-confirmacao-massa.mjs`.

export type FerramentaMassa = 'produtos.descricoes.gerar' | 'produtos.ambientadas.gerar';
export const FERRAMENTAS_MASSA: FerramentaMassa[] = ['produtos.descricoes.gerar', 'produtos.ambientadas.gerar'];

/** Os mesmos tetos das ferramentas (MAX_DESCRICOES_POR_LOTE / MAX_AMBIENTADAS_POR_LOTE). */
export const TAMANHO_LOTE: Record<FerramentaMassa, number> = {
  'produtos.descricoes.gerar': 50,
  'produtos.ambientadas.gerar': 10,
};

export interface CandidatoMassa {
  id: string;
  nome: string;
  temDescricao: boolean;
  temAmbientada: boolean;
  temFoto: boolean;
}

export interface Confirmacao {
  ferramenta: FerramentaMassa;
  total: number;
  /** Ainda não têm — o que "Gerar só os N" gera. */
  novos: CandidatoMassa[];
  /** Já têm — entram só com "Sobrescrever". */
  jaTem: CandidatoMassa[];
  /** Imagem sem foto de base: fica de fora nos dois modos. */
  semFoto: CandidatoMassa[];
  custoUnitario: number;
}

export function montarConfirmacao(ferramenta: FerramentaMassa, candidatos: CandidatoMassa[], custoUnitario: number): Confirmacao {
  const imagem = ferramenta === 'produtos.ambientadas.gerar';
  const semFoto = imagem ? candidatos.filter((c) => !c.temFoto) : [];
  const elegiveis = imagem ? candidatos.filter((c) => c.temFoto) : candidatos;
  const ja = (c: CandidatoMassa) => (imagem ? c.temAmbientada : c.temDescricao);
  return {
    ferramenta,
    total: candidatos.length,
    novos: elegiveis.filter((c) => !ja(c)),
    jaTem: elegiveis.filter(ja),
    semFoto,
    custoUnitario,
  };
}

export const alvos = (c: Confirmacao, sobrescrever: boolean) => (sobrescrever ? [...c.novos, ...c.jaTem] : c.novos);
export const custoDe = (c: Confirmacao, sobrescrever: boolean) => alvos(c, sobrescrever).length * c.custoUnitario;

export function listaNomes(itens: { nome: string }[], max = 3): string {
  const nomes = itens.slice(0, max).map((i) => i.nome).join(', ');
  return itens.length > max ? `${nomes} e mais ${itens.length - max}` : nomes;
}

/** As linhas do "pensando" — cada uma é um fato que a tela de fato conferiu. */
export function etapasPensando(c: Confirmacao): string[] {
  const imagem = c.ferramenta === 'produtos.ambientadas.gerar';
  const n = c.total;
  const linhas = [`Lendo ${n === 1 ? 'o produto selecionado' : `os ${n} produtos selecionados`}…`];
  const oque = imagem ? 'imagens ambientadas' : 'descrições';
  linhas.push(c.jaTem.length
    ? `Conferindo ${oque} — ${c.jaTem.length} já ${c.jaTem.length === 1 ? 'tem' : 'têm'}: ${listaNomes(c.jaTem)}`
    : `Conferindo ${oque} — nenhum tem ainda`);
  if (c.semFoto.length) linhas.push(`Sem foto para servir de base — ${c.semFoto.length} fica${c.semFoto.length === 1 ? '' : 'm'} de fora: ${listaNomes(c.semFoto)}`);
  const k = c.novos.length;
  linhas.push(`Calculando custo — ${k} × ${c.custoUnitario} = ${k * c.custoUnitario} créditos`);
  return linhas;
}

export function emLotes<T>(itens: T[], tamanho: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) out.push(itens.slice(i, i + tamanho));
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/verify-confirmacao-massa.mjs`
Expected: todas `ok`.

- [ ] **Step 5: Commit**

```bash
git add src/modules/agent/confirmacaoMassa.ts scripts/verify-confirmacao-massa.mjs
git commit -m "feat(produtos): regra pura da confirmação pular/sobrescrever

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Lote — campos de origem, linhas ao vivo e desfazer (puro)

**Files:**
- Modify: `src/modules/agent/lote.ts`
- Modify: `scripts/verify-lote.mjs`

**Interfaces:**
- Produces:
  - `ItemLote.antes?: AntesDescricao` where `interface AntesDescricao { tituloSeo: string; descricaoSeo: string; palavrasChave: string; statusDescricao: string | null; statusSEO: string | null }`
  - `LoteJob.origem?: 'massa'`, `LoteJob.desfeito?: boolean`
  - `linhasAoVivo(job: Pick<LoteJob, 'itens'>): { texto: string; tom: 'trabalhando' | 'ok' | 'alerta' }[]`
  - `podeDesfazer(job: LoteJob): boolean`
  - `marcarDesfeito(job: LoteJob, agoraIso: string): LoteJob | null`
  - `podeRestaurar(descricaoAtual: string, descricaoGravada: string): boolean`
  - `camposDeRestauro(item: ItemLote): Record<string, unknown> | null`

- [ ] **Step 1: Write the failing test**

Append to `scripts/verify-lote.mjs` (before its final failure check; add the new names to its import from `lote.ts`):

```js
// --- Lote em massa: linhas ao vivo e desfazer -------------------------------------
{
  const item = (id, estado, over = {}) => ({ id, docId: id, sku: id, nome: `P${id}`, estado, ...over });
  const job = {
    id: 'j', tool: 'produtos.descricoes.gerar', args: {}, chave: 'k', actionId: 'a', status: 'rodando', auto: true, avisos: [],
    origem: 'massa', createdAt: 'x', updatedAt: 'x',
    itens: [
      item('1', 'gravado', { descricaoAntes: '<p>velha</p>', resultado: { descricao: '<p>nova</p>', tituloSeo: 'T', descricaoSeo: 'D', palavrasChave: 'K' },
        antes: { tituloSeo: 't0', descricaoSeo: 'd0', palavrasChave: 'k0', statusDescricao: 'Descrição original', statusSEO: null } }),
      item('2', 'gerando'),
      item('3', 'falhou', { erro: 'sem foto pública' }),
      item('4', 'fila'),
    ],
  };
  check('linhas ao vivo', linhasAoVivo(job), [
    { texto: '✓ P1', tom: 'ok' },
    { texto: '✍️ escrevendo P2…', tom: 'trabalhando' },
    { texto: '⚠ P3: sem foto pública', tom: 'alerta' },
    { texto: '+1 na fila', tom: 'trabalhando' },
  ]);

  const fim = { ...job, status: 'concluido', itens: job.itens.map((i) => (i.estado === 'gerando' || i.estado === 'fila' ? { ...i, estado: 'gravado' } : i)) };
  check('só desfaz lote concluído com gravados', [podeDesfazer(job), podeDesfazer(fim)], [false, true]);

  // Review Focus 5: desfazer duas vezes.
  const desfeito = marcarDesfeito(fim, 'agora');
  check('marca desfeito', desfeito?.desfeito, true);
  check('segunda vez não faz nada', marcarDesfeito(desfeito, 'agora'), null);
  check('lote desfeito não oferece desfazer de novo', podeDesfazer(desfeito), false);

  // Review Focus 2: usuário editou depois do lote.
  check('restaura se o texto ainda é o gravado', podeRestaurar(' <p>nova</p> ', '<p>nova</p>'), true);
  check('não restaura edição do usuário', podeRestaurar('<p>editei</p>', '<p>nova</p>'), false);

  check('campos de restauro da descrição', camposDeRestauro(job.itens[0]), {
    'Descrição complementar': '<p>velha</p>', 'Título SEO': 't0', 'Descrição SEO': 'd0', 'Palavras chave SEO': 'k0',
    _statusDescricao: 'Descrição original', _statusSEO: null,
  });
  check('item sem resultado não restaura', camposDeRestauro(job.itens[1]), null);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/verify-lote.mjs`
Expected: FAIL — `linhasAoVivo is not a function`.

- [ ] **Step 3: Implement in `src/modules/agent/lote.ts`**

Add to `ItemLote` (after `descricaoAntes`):

```ts
  /** SEO e status de antes (lote em massa) — o que o Desfazer devolve junto com `descricaoAntes`. */
  antes?: AntesDescricao;
```

Add above `ItemLote`:

```ts
export interface AntesDescricao {
  tituloSeo: string;
  descricaoSeo: string;
  palavrasChave: string;
  statusDescricao: string | null;
  statusSEO: string | null;
}
```

Add to `LoteJob` (after `auto`):

```ts
  /** Nasceu do "Gerar … para todas" da tela de Produtos (POST /api/agent/lotes). */
  origem?: 'massa';
  /** O Desfazer já rodou — não roda de novo. */
  desfeito?: boolean;
```

Append at the end of the file:

```ts
// ---------------------------------------------------------------------------
// Lote em massa: progresso em texto e Desfazer
// ---------------------------------------------------------------------------

export interface LinhaAoVivo { texto: string; tom: 'trabalhando' | 'ok' | 'alerta' }

/** "✓ Camiseta · ✍️ escrevendo Tênis… · ⚠ Boné: sem foto pública · +3 na fila". */
export function linhasAoVivo(job: Pick<LoteJob, 'itens'>): LinhaAoVivo[] {
  const out: LinhaAoVivo[] = [];
  let fila = 0;
  for (const i of job.itens) {
    if (i.estado === 'fila') { fila++; continue; }
    if (i.estado === 'gravado') out.push({ texto: `✓ ${i.nome}`, tom: 'ok' });
    else if (i.estado === 'gerando' || i.estado === 'pronto' || i.estado === 'gravando') out.push({ texto: `✍️ escrevendo ${i.nome}…`, tom: 'trabalhando' });
    else if (i.estado === 'falhou' || i.estado === 'pulado') out.push({ texto: `⚠ ${i.nome}${i.erro ? `: ${i.erro}` : ''}`, tom: 'alerta' });
  }
  if (fila) out.push({ texto: `+${fila} na fila`, tom: 'trabalhando' });
  return out;
}

const DESFAZIVEIS = ['produtos.descricoes.gerar', 'produtos.ambientadas.gerar'];

export function podeDesfazer(job: LoteJob): boolean {
  return DESFAZIVEIS.includes(job.tool) && !job.desfeito && statusDerivado(job) === 'concluido'
    && job.itens.some((i) => i.estado === 'gravado');
}

export function marcarDesfeito(job: LoteJob, agoraIso: string): LoteJob | null {
  if (!podeDesfazer(job)) return null;
  return { ...job, desfeito: true, updatedAt: agoraIso };
}

const limpar = (s: string) => s.trim();

/** Só devolve a descrição antiga se ninguém mexeu depois do lote. */
export const podeRestaurar = (descricaoAtual: string, descricaoGravada: string) =>
  limpar(descricaoAtual) === limpar(descricaoGravada);

/** Campos que o Desfazer grava de volta num item de descrição; null = nada a desfazer. */
export function camposDeRestauro(item: ItemLote): Record<string, unknown> | null {
  if (item.estado !== 'gravado' || !item.resultado || !('descricao' in item.resultado)) return null;
  const a = item.antes;
  return {
    'Descrição complementar': item.descricaoAntes ?? '',
    'Título SEO': a?.tituloSeo ?? '',
    'Descrição SEO': a?.descricaoSeo ?? '',
    'Palavras chave SEO': a?.palavrasChave ?? '',
    _statusDescricao: a?.statusDescricao ?? null,
    _statusSEO: a?.statusSEO ?? null,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/verify-lote.mjs`
Expected: todas `ok`.

- [ ] **Step 5: Commit**

```bash
git add src/modules/agent/lote.ts scripts/verify-lote.mjs
git commit -m "feat(lote): linhas ao vivo e regras puras do Desfazer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Rotas — criar lotes em massa e desfazer

**Files:**
- Create: `server/agent/loteMassa.ts`
- Modify: `server/agent/loteRoutes.ts`
- Modify: `server/agent/contentAgentChat.ts` (exporta `registrarTrocaNaConversa`)
- Modify: `src/services/agentChatService.ts`

**Interfaces:**
- Consumes: `montarConfirmacao`, `alvos`, `emLotes`, `TAMANHO_LOTE`, `FERRAMENTAS_MASSA`, `listaNomes` (Task 6); `marcarDesfeito`, `podeRestaurar`, `camposDeRestauro`, `AntesDescricao` (Task 7); `criarLote`, `mutarLote`, `lerLote` (`loteStore.ts`); `scheduleLote` (`loteWorker.ts`); `lerCatalogo`, `produtosCol`, `fotoPrincipal` (`produtosGeracao.ts`); `estimateCredits` (o mesmo import que `server/agent/tools/produtos.ts` usa).
- Produces:
  - Server: `criarLotesEmMassa(uid, corpo: { ferramenta: string; docIds: string[]; sobrescrever: boolean }): Promise<RespostaMassa>`; `desfazerLote(uid, id): Promise<{ restaurados: number; mantidos: number }>`; `registrarTrocaNaConversa(uid, textoUsuario, textoAlfred, actionIds)`.
  - HTTP: `POST /api/agent/lotes` → `RespostaMassa = { actionIds: string[]; lotes: number; gerados: number; jaTem: number; semFoto: number; custo: number }`; `POST /api/agent/lotes/:id/desfazer` → `{ restaurados: number; mantidos: number }`.
  - Client: `criarLotesEmMassa(ferramenta: FerramentaMassa, docIds: string[], sobrescrever: boolean): Promise<RespostaMassa>`; `AcaoLote` inclui `'desfazer'`.

> **Decisão registrada (desvio da spec):** os lotes de uma mesma ação nascem juntos e rodam em paralelo, em vez de enfileirados. O worker é por lote com lease (`loteWorker.ts`) e a recuperação (`recoverLotes`) varre todo lote `rodando`, então uma fila exigiria um estado novo que o `statusDerivado` não tem. Para imagens isso dá até 2 chamadas por lote em paralelo; se aparecer 429 do Vertex na verificação manual, volte aqui e implemente a fila. O card de cada lote continua mostrando o próprio progresso; a mensagem do Alfred diz em quantos lotes dividiu.

- [ ] **Step 1: Export the conversation helper in `contentAgentChat.ts`**

Add after `ensureUserThread`:

```ts
/**
 * Grava uma troca na conversa sem passar pelo modelo — o "Gerar … para todas"
 * da tela de Produtos: o pedido do usuário e a resposta com os cards dos lotes.
 * O grafo não vê estas mensagens (não entram no checkpointer); a tela vê,
 * porque lê a mesma coleção.
 */
export async function registrarTrocaNaConversa(uid: string, textoUsuario: string, textoAlfred: string, actionIds: string[]): Promise<void> {
  await ensureUserThread(uid);
  const agora = Date.now();
  await saveMessage(uid, AGENT_THREAD_ID, { role: 'user', texto: textoUsuario, createdAt: new Date(agora).toISOString() });
  await saveMessage(uid, AGENT_THREAD_ID, { role: 'model', texto: textoAlfred, actionIds, createdAt: new Date(agora + 1).toISOString() });
}
```

(`AGENT_THREAD_ID` is declared further down the file as a `const`; that is fine — it is read at call time. If TypeScript complains about use-before-declaration, move the `const AGENT_THREAD_ID` line above `saveMessage`.)

- [ ] **Step 2: Write `server/agent/loteMassa.ts`**

```ts
// "Gerar descrição/imagem para todas" da tela de Produtos, sem passar pelo
// modelo: a tela já mostrou a confirmação (confirmacaoMassa.ts) e o usuário
// escolheu pular ou sobrescrever. Aqui a mesma conta é refeita — o corpo vem do
// navegador —, os produtos viram lotes em modo automático (cada item é gravado
// assim que fica pronto, débito por item gravado) e a troca vai para a conversa
// para os cards aparecerem no painel e na aba Alfred.

import {
  alvos, emLotes, FERRAMENTAS_MASSA, listaNomes, montarConfirmacao, TAMANHO_LOTE,
  type CandidatoMassa, type FerramentaMassa,
} from '../../src/modules/agent/confirmacaoMassa';
import { camposDeRestauro, marcarDesfeito, podeRestaurar, type AntesDescricao } from '../../src/modules/agent/lote';
import { adminDb } from '../firebaseAdmin';
import { criarLote, lerLote, mutarLote } from './loteStore';
import { scheduleLote } from './loteWorker';
import { fotoPrincipal, lerCatalogo, produtosCol } from './produtosGeracao';
import { estimateCredits } from './credits'; // ajuste ao caminho real — o mesmo de server/agent/tools/produtos.ts
import { registrarTrocaNaConversa } from './contentAgentChat';
import type { ProdutoDoc } from './produtosGeracao'; // ajuste: onde ProdutoDoc é exportado

export interface RespostaMassa { actionIds: string[]; lotes: number; gerados: number; jaTem: number; semFoto: number; custo: number }

const MAX_IDS = 1000;
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());
const erro = (msg: string, status: number) => Object.assign(new Error(msg), { status });

const candidato = (p: ProdutoDoc): CandidatoMassa => ({
  id: p._docId,
  nome: str(p['Descrição']) || str(p['Código (SKU)']) || '(sem nome)',
  temDescricao: !!str(p['Descrição complementar']),
  temAmbientada: (((p as Record<string, unknown>)._ambientImages as unknown[] | undefined) ?? []).length > 0,
  temFoto: !!fotoPrincipal(p as Record<string, unknown>),
});

const antesDe = (p: ProdutoDoc): AntesDescricao => ({
  tituloSeo: str(p['Título SEO']),
  descricaoSeo: str(p['Descrição SEO']),
  palavrasChave: str(p['Palavras chave SEO']),
  statusDescricao: (p as Record<string, unknown>)._statusDescricao as string ?? null,
  statusSEO: (p as Record<string, unknown>)._statusSEO as string ?? null,
});

export async function criarLotesEmMassa(
  uid: string,
  corpo: { ferramenta?: unknown; docIds?: unknown; sobrescrever?: unknown },
): Promise<RespostaMassa> {
  const ferramenta = corpo.ferramenta as FerramentaMassa;
  if (!FERRAMENTAS_MASSA.includes(ferramenta)) throw erro('Ferramenta não suportada.', 400);
  const ids = Array.isArray(corpo.docIds) ? [...new Set(corpo.docIds.filter((i): i is string => typeof i === 'string'))] : [];
  if (!ids.length) throw erro('Nenhum produto selecionado.', 400);
  if (ids.length > MAX_IDS) throw erro(`No máximo ${MAX_IDS} produtos por vez.`, 400);
  const sobrescrever = corpo.sobrescrever === true;

  // Só produtos do próprio usuário (lidos da coleção dele) e só principais.
  const porDoc = new Map((await lerCatalogo(uid)).map((p) => [p._docId, p]));
  const produtos = ids.map((id) => porDoc.get(id)).filter((p): p is ProdutoDoc => !!p && !str(p['Código do pai']));
  if (!produtos.length) throw erro('Nenhum dos produtos foi encontrado no catálogo.', 404);

  const def = { name: ferramenta, provider: 'produtos' as const };
  const custoUnitario = await estimateCredits(def, { payload: { itens: [produtos[0]] } });
  const conf = montarConfirmacao(ferramenta, produtos.map(candidato), custoUnitario);
  const escolhidos = alvos(conf, sobrescrever);
  if (!escolhidos.length) {
    throw erro(conf.semFoto.length === conf.total ? 'Nenhum dos produtos tem foto para servir de base.' : 'Todos já têm — escolha sobrescrever para gerar de novo.', 409);
  }
  const custo = escolhidos.length * custoUnitario;
  const saldo = Number((await adminDb.collection('users').doc(uid).get()).data()?.credits ?? 0);
  if (saldo < custo) throw erro(`Isto custa até ${custo} créditos e o saldo é ${saldo}.`, 402);

  const imagem = ferramenta === 'produtos.ambientadas.gerar';
  const partes = emLotes(escolhidos, TAMANHO_LOTE[ferramenta]);
  const actionIds: string[] = [];
  for (const [k, parte] of partes.entries()) {
    const docs = parte.map((c) => porDoc.get(c.id)!);
    const n = docs.length;
    const { job } = await criarLote({
      uid,
      tool: ferramenta,
      provider: 'produtos',
      // docIds + modo na chave: repetir o mesmo pedido enquanto ele roda reencontra o lote.
      args: { docIds: parte.map((c) => c.id), sobrescrever, origem: 'massa' },
      itens: docs.map((p) => ({
        docId: p._docId,
        sku: str(p['Código (SKU)']),
        nome: candidato(p).nome,
        ...(imagem ? {} : { descricaoAntes: String(p['Descrição complementar'] ?? ''), antes: antesDe(p) }),
      })),
      preview: {
        resumo: imagem
          ? `Criar imagens ambientadas de ${n === 1 ? '1 produto' : `${n} produtos`}`
          : `Escrever ${n === 1 ? 'a descrição de 1 produto' : `as descrições de ${n} produtos`}`,
        alvo: partes.length > 1 ? `Lote ${k + 1} de ${partes.length} · ${listaNomes(parte)}` : listaNomes(parte),
        campos: [],
        avisos: [imagem
          ? 'As imagens são acrescentadas ao produto (as ambientadas que ele já tem continuam). Nada vai ao ERP.'
          : 'Grava só no catálogo do OMNI360 (descrição e SEO). Nada vai ao ERP.'],
        custo: n * custoUnitario,
      },
      auto: true,
    });
    // origem no job (criarLote não conhece o campo): marca numa transação.
    await mutarLote(uid, job.id, (j) => ({ ...j, origem: 'massa' }));
    scheduleLote(uid, job.id);
    actionIds.push(job.actionId);
  }

  const oque = imagem ? 'imagens ambientadas' : 'descrição';
  const nAlvo = escolhidos.length;
  const textoUsuario = `Gerar ${oque} para ${nAlvo} ${nAlvo === 1 ? 'produto' : 'produtos'}${sobrescrever ? ' (sobrescrevendo os que já têm)' : conf.jaTem.length ? ` (pulando ${conf.jaTem.length} que já ${conf.jaTem.length === 1 ? 'tem' : 'têm'})` : ''}.`;
  const textoAlfred = partes.length > 1
    ? `Comecei. Dividi em ${partes.length} lotes; cada item é gravado assim que fica pronto.`
    : 'Comecei. Cada item é gravado assim que fica pronto.';
  await registrarTrocaNaConversa(uid, textoUsuario, textoAlfred, actionIds);

  return { actionIds, lotes: partes.length, gerados: nAlvo, jaTem: conf.jaTem.length, semFoto: conf.semFoto.length, custo };
}

/**
 * Desfaz um lote concluído. Descrição: devolve texto, SEO e status de antes
 * (e a descrição das variações), só onde o texto atual ainda é o que o lote
 * gravou. Imagens: tira de `_ambientImages` as URLs que o lote acrescentou.
 * Não estorna créditos. Marcado `desfeito` antes de escrever: duplo clique
 * não roda duas vezes.
 */
export async function desfazerLote(uid: string, id: string): Promise<{ restaurados: number; mantidos: number }> {
  const job = await mutarLote(uid, id, (j) => marcarDesfeito(j, new Date().toISOString()));
  if (!job) throw erro('Este lote não pode ser desfeito.', 409);
  let restaurados = 0;
  let mantidos = 0;
  const agora = new Date().toISOString();
  for (const item of job.itens) {
    if (item.estado !== 'gravado' || !item.resultado) continue;
    const ref = produtosCol(uid).doc(item.docId);
    const snap = await ref.get();
    if (!snap.exists) { mantidos++; continue; }
    const atual = snap.data() as Record<string, unknown>;
    if ('imagens' in item.resultado) {
      const remover = new Set(item.resultado.imagens);
      const imgs = ((atual._ambientImages as string[] | undefined) ?? []).filter((u) => !remover.has(u));
      await ref.update({ _ambientImages: imgs, updatedAt: agora });
      restaurados++;
      continue;
    }
    const campos = camposDeRestauro(item);
    const gravada = 'descricao' in item.resultado ? item.resultado.descricao : '';
    if (!campos || !podeRestaurar(String(atual['Descrição complementar'] ?? ''), gravada)) { mantidos++; continue; }
    const batch = adminDb.batch();
    batch.update(ref, { ...campos, updatedAt: agora });
    if (item.sku) {
      const filhas = await produtosCol(uid).where('Código do pai', '==', item.sku).get();
      filhas.docs
        .filter((f) => podeRestaurar(String(f.data()['Descrição complementar'] ?? ''), gravada))
        .forEach((f) => batch.update(f.ref, { 'Descrição complementar': item.descricaoAntes ?? '', updatedAt: agora }));
    }
    await batch.commit();
    restaurados++;
  }
  return { restaurados, mantidos };
}
```

Before saving, resolve the two `// ajuste` imports: `grep -n "estimateCredits\|ProdutoDoc" server/agent/tools/produtos.ts | head` shows the real module paths — use exactly those.

- [ ] **Step 3: Routes in `server/agent/loteRoutes.ts`**

Import `criarLotesEmMassa, desfazerLote` from `./loteMassa`. Register **before** the existing `app.post('/api/agent/lotes/:id/:acao', ...)`:

```ts
  app.post('/api/agent/lotes', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      await requireAnyModule(uid);
      return res.json(await criarLotesEmMassa(uid, req.body ?? {}));
    } catch (e: any) {
      return res.status(httpStatus(e)).json({ message: e?.message });
    }
  });
```

and in the `switch (acao)` add:

```ts
        case 'desfazer':
          return res.json(await desfazerLote(uid, id));
```

- [ ] **Step 4: Client service**

In `src/services/agentChatService.ts`:

```ts
export type AcaoLote = 'aprovar' | 'descartar' | 'pausar' | 'retomar' | 'parar' | 'desfazer';
```

and add:

```ts
export interface RespostaMassa { actionIds: string[]; lotes: number; gerados: number; jaTem: number; semFoto: number; custo: number }

/** "Gerar … para todas" da tela de Produtos: cria os lotes em modo automático e grava a troca na conversa. */
export const criarLotesEmMassa = (ferramenta: FerramentaMassa, docIds: string[], sobrescrever: boolean) =>
  call<RespostaMassa>('/api/agent/lotes', 'POST', { ferramenta, docIds, sobrescrever });
```

with `import type { FerramentaMassa } from '../modules/agent/confirmacaoMassa';`.

- [ ] **Step 5: Lint and pure checks**

Run: `npm run lint && npx tsx scripts/verify-lote.mjs && npx tsx scripts/verify-confirmacao-massa.mjs && npx tsx scripts/verify-agent-produtos.mjs`
Expected: tudo passa.

- [ ] **Step 6: Manual check of the route (dev server, conta de teste com créditos)**

With `npm run dev` running and logged in, in the browser console:

```js
const t = await (await import('/src/firebase.ts')).auth.currentUser.getIdToken();
await (await fetch('/api/agent/lotes', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
  body: JSON.stringify({ ferramenta: 'produtos.descricoes.gerar', docIds: ['<id de um produto sem descrição>'], sobrescrever: false }) })).json();
```

Expected: `{ actionIds: [...], lotes: 1, gerados: 1, ... }`; na aba Alfred aparecem a mensagem do usuário, a resposta e o card do lote; o produto ganha a descrição sem pedir aprovação. Then `POST /api/agent/lotes/<jobId>/desfazer` → `{ restaurados: 1, mantidos: 0 }` e a descrição volta a vazia. Repeat → HTTP 409.

- [ ] **Step 7: Commit**

```bash
git add server/agent/loteMassa.ts server/agent/loteRoutes.ts server/agent/contentAgentChat.ts src/services/agentChatService.ts
git commit -m "feat(lote): rota de geração em massa em modo automático e Desfazer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Extrair a conversa do Alfred (`useConversaAlfred` + `PainelAlfred`)

**Files:**
- Create: `src/modules/agent/useConversaAlfred.ts`
- Create: `src/modules/agent/PainelAlfred.tsx`
- Modify: `src/modules/agent/AgentHomeScreen.tsx`

**Interfaces:**
- Produces:

```ts
export interface ConversaAlfred {
  mensagens: ThreadMessage[];
  acoes: Record<string, AgentAction>;
  listaAcoes: AgentAction[];
  parcial: string;
  leituras: { tool: string; ok: boolean; erro?: string }[];
  streaming: boolean;
  erro: string | null;
  setErro: (m: string | null) => void;
  interagiu: boolean;
  enviar: (texto: string, contexto?: WorkspaceContext) => Promise<void>;
  enviarDoComposer: (texto: string) => Promise<void>;
  executar: (id: string) => Promise<void>;
  rejeitar: (id: string) => Promise<void>;
  parar: () => void;
  comecarAjuste: (a: AgentAction) => void;
  iniciarAjuste: (actionId: string) => void;
  etiquetaAjuste: { resumo: string; onCancelar: () => void } | null;
  definirContexto: (c: WorkspaceContext | undefined) => void;
}
export function useConversaAlfred(uid: string, opts?: { aoEnviar?: () => void }): ConversaAlfred;
```

`PainelAlfred` props:

```ts
interface Props {
  uid: string;
  conversa: ConversaAlfred;
  /** Cards locais (ex.: confirmação em massa) — aparecem no fim da conversa. */
  rodape?: React.ReactNode;
  vazio?: React.ReactNode;
  onFoco?: (f: boolean) => void;
  recuoTeclado?: number;
  emFoco?: boolean;
  acimaDoComposer?: React.ReactNode;
}
```

This is a pure refactor: no visible change in the Alfred tab.

- [ ] **Step 1: Create `useConversaAlfred.ts`**

Move from `AgentHomeScreen.tsx`, **verbatim**, the following into the hook body:
- state: `mensagens`, `acoes`, `parcial`, `leituras`, `streaming`, `erro`, `interagiu`, `ajustandoId`; refs `abortRef`, `contextoRef`, `turnoComErroRef`, `mensagensAoIniciarRef`; `listaAcoes` memo;
- the `listenMessages`/`listenActions` effect and the "rascunho local" effect on `mensagens`;
- `handlers`, `enviar`, `responder`, `ajustando` + its effect, `comecarAjuste`, `enviarDoComposer`, `etiquetaAjuste`, `executar`, `rejeitar`, `parar`.

Two changes while moving:
1. `enviar` calls `setModo('chat')` today — replace with `opts?.aoEnviar?.()`. Same for `comecarAjuste` and `enviarDoComposer`.
2. Add:

```ts
  const iniciarAjuste = (actionId: string) => { opts?.aoEnviar?.(); setAjustandoId(actionId); };
  const definirContexto = (c: WorkspaceContext | undefined) => { contextoRef.current = c; };
```

Return the `ConversaAlfred` object. Keep the comments that explain each piece (they move with the code). Imports: `ajustarAcao, enviarMensagem, executarAcao, listenActions, listenMessages, rejeitarAcao` from `../../services/agentChatService`, types from `../../types/agent`.

- [ ] **Step 2: Create `PainelAlfred.tsx`**

```tsx
import React from 'react';
import ChatThread from './chat/ChatThread';
import Composer from './chat/Composer';
import LoteEmAndamento from './chat/LoteEmAndamento';
import type { ConversaAlfred } from './useConversaAlfred';

interface Props {
  uid: string;
  conversa: ConversaAlfred;
  rodape?: React.ReactNode;
  vazio?: React.ReactNode;
  onFoco?: (f: boolean) => void;
  recuoTeclado?: number;
  emFoco?: boolean;
  acimaDoComposer?: React.ReactNode;
}

/**
 * A conversa do Alfred em qualquer tela: a mesma thread (useConversaAlfred),
 * o mesmo pensamento ao vivo e os mesmos cards. `rodape` recebe cards locais
 * que não são mensagens persistidas (a confirmação da tela de Produtos).
 */
const PainelAlfred: React.FC<Props> = ({ uid, conversa, rodape, vazio, onFoco, recuoTeclado = 0, emFoco = false, acimaDoComposer }) => {
  const temConversa = conversa.mensagens.length > 0 || conversa.streaming || conversa.interagiu || !!rodape;
  return (
    <div className="h-full min-h-0 flex flex-col">
      {temConversa ? (
        <ChatThread
          uid={uid}
          mensagens={conversa.mensagens}
          acoes={conversa.acoes}
          parcial={conversa.parcial}
          leituras={conversa.leituras}
          streaming={conversa.streaming}
          erro={conversa.erro}
          onExecutar={conversa.executar}
          onRejeitar={conversa.rejeitar}
          onAjustar={conversa.comecarAjuste}
          rodape={rodape}
        />
      ) : (vazio ?? <div className="flex-1" />)}
      <Composer
        disabled={false}
        streaming={conversa.streaming}
        onEnviar={(t) => { void conversa.enviarDoComposer(t); }}
        ajustando={conversa.etiquetaAjuste}
        onParar={conversa.parar}
        onFoco={onFoco ?? (() => {})}
        recuoTeclado={recuoTeclado}
        emFoco={emFoco}
        acima={<>{acimaDoComposer}<LoteEmAndamento uid={uid} /></>}
      />
    </div>
  );
};

export default PainelAlfred;
```

`ChatThread` needs a new optional prop `rodape?: React.ReactNode` rendered after the last message and before the live draft, **inside** the scrolling area; its auto-scroll effect must also run when `rodape` changes (add it to that effect's dependency list). Check `Composer`'s prop types (`onFoco` required?) and match them.

- [ ] **Step 3: `AgentHomeScreen` uses the hook**

Replace the moved code with:

```tsx
  const conversa = useConversaAlfred(uid, { aoEnviar: () => setModo('chat') });
  const { mensagens, acoes, listaAcoes, streaming, erro, interagiu, enviar, executar, rejeitar, comecarAjuste } = conversa;
```

The `promptInicial` effect uses `conversa.iniciarAjuste(promptInicial.ajustarAcaoId)` (plus `setModo('chat')`, which `aoEnviar` already does) instead of `setAjustandoId`. Every remaining reference to the moved names now reads from `conversa`. Leave the three layouts (`larga`, phone, normal) as they are, but replace each `<ChatThread …/>` + `<Composer …/>` pair with `<PainelAlfred uid={uid} conversa={conversa} vazio={…the existing empty state JSX…} onFoco={focar} recuoTeclado={…same value as today…} emFoco={…same…} acimaDoComposer={…the existing faixaPasso (and the `modo === 'chat'` condition where it existed)…} />`. Keep `CabecalhoTarefa` above it. `LoteEmAndamento` now comes from inside `PainelAlfred`; remove it from `acima`.

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: sem erros novos.

- [ ] **Step 5: Manual regression of the Alfred tab**

`npm run dev`: mandar mensagem (pensamento ao vivo aparece), aprovar/recusar um card, "Ajustar no chat", "Pedir ao Alfred" vindo de outra tela, um lote em andamento mostra a faixa "Pausar", desktop ≥1280 em 3 colunas, telefone com teclado (390px). Tudo como antes.

- [ ] **Step 6: Commit**

```bash
git add src/modules/agent/useConversaAlfred.ts src/modules/agent/PainelAlfred.tsx src/modules/agent/AgentHomeScreen.tsx src/modules/agent/chat/ChatThread.tsx
git commit -m "refactor(alfred): conversa extraída em useConversaAlfred e PainelAlfred

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Painel do Alfred na tela de Produtos, barra com duas ações e card de confirmação

**Files:**
- Create: `src/modules/agent/produtos/CardConfirmacao.tsx`
- Create: `src/modules/agent/produtos/FolhaAlfred.tsx`
- Modify: `src/modules/agent/BarraProximoPasso.tsx`
- Modify: `src/modules/agent/chat/LoteCard.tsx`
- Modify: `src/modules/agent/ProdutosAgenteScreen.tsx`
- Modify: `src/App.tsx:3878-3891`

**Interfaces:**
- Consumes: `useConversaAlfred`, `PainelAlfred` (Task 9); `montarConfirmacao`, `alvos`, `custoDe`, `etapasPensando`, `CandidatoMassa`, `FerramentaMassa` (Task 6); `criarLotesEmMassa` (Task 8); `linhasAoVivo`, `podeDesfazer` (Task 7); `semDescricao`, `temFoto`, `temAmbientada`, `nomeDe`, `pedidoDaSelecao`, `MAX_SKUS_CONTEXTO` (`produtosAgente.ts`).
- Produces: `BarraProximoPasso` prop `acaoSecundaria?: AcaoBarra | null`; `ProdutosAgenteScreen` new props `uid: string; credits: number; custoPorImagem: number; onFocoChange?: (f: boolean) => void; onRecarregar: () => void`.

- [ ] **Step 1: `BarraProximoPasso` with a second action**

Add `acaoSecundaria?: AcaoBarra | null;` to `Props`. In `Conteudo`, render it between `acao` and the Alfred button, same height, style `{ background: 'var(--ag-fill-2)', color: 'var(--ag-text)' }`, with `{acaoSecundaria.rotulo}` and the `detalhe`. When there are two actions, put them in a `grid grid-cols-2 gap-2 flex-1` wrapper so they split the width on the phone; the Alfred button stays `w-12 shrink-0`. Update `BarraProximoPasso` early-return: `if (!resto.acao && !resto.acaoSecundaria && !resto.onPedirAlfred) return null;`. Mercado Livre and Conteúdo don't pass it — unchanged.

- [ ] **Step 2: `CardConfirmacao.tsx`**

```tsx
import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { alvos, custoDe, etapasPensando, type Confirmacao } from '../confirmacaoMassa';

interface Props {
  conf: Confirmacao;
  saldo: number;
  onConfirmar: (sobrescrever: boolean) => Promise<void>;
  onCancelar: () => void;
  onRecarregar: () => void;
}

/** Atraso entre as linhas do "pensando" — o bastante para ler, curto para não irritar. */
const PASSO_MS = 420;

/**
 * Card local (não persistido) no painel do Alfred: as etapas reais da
 * conferência entram uma a uma, depois o resumo e os botões. O padrão é
 * gerar só os que não têm.
 */
const CardConfirmacao: React.FC<Props> = ({ conf, saldo, onConfirmar, onCancelar, onRecarregar }) => {
  const etapas = etapasPensando(conf);
  const [visiveis, setVisiveis] = useState(0);
  const [enviando, setEnviando] = useState<boolean | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    setVisiveis(0);
    const timers = etapas.map((_, i) => setTimeout(() => setVisiveis(i + 1), (i + 1) * PASSO_MS));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conf]);

  const pronto = visiveis >= etapas.length;
  const nNovos = alvos(conf, false).length;
  const nTodos = alvos(conf, true).length;
  const imagem = conf.ferramenta === 'produtos.ambientadas.gerar';
  const faltaPara = (s: boolean) => Math.max(0, custoDe(conf, s) - saldo);

  const confirmar = async (sobrescrever: boolean) => {
    setEnviando(sobrescrever);
    setErro(null);
    try { await onConfirmar(sobrescrever); } catch (e) { setErro(e instanceof Error ? e.message : 'Falha ao começar.'); setEnviando(null); }
  };

  const principal = { background: 'var(--ag-accent)', color: 'var(--ag-accent-ink)' };
  const secundario = { background: 'var(--ag-fill-2)', color: 'var(--ag-text)' };
  const botao = 'min-h-[44px] px-4 rounded-full text-[13.5px] font-semibold flex items-center justify-center gap-2 disabled:opacity-50';

  return (
    <div className="ag-glass rounded-[20px] px-4 py-3 flex flex-col gap-2" style={{ boxShadow: 'var(--ag-shadow-sm)' }}>
      <ul className="flex flex-col gap-1 text-[13px] text-[var(--ag-text-2)]" aria-live="polite">
        {etapas.slice(0, visiveis).map((t) => <li key={t} className="animate-in fade-in">▸ {t}</li>)}
        {!pronto && <li className="flex items-center gap-2 text-[var(--ag-text-3)]"><Loader2 className="w-3.5 h-3.5 animate-spin" /> pensando…</li>}
      </ul>
      {pronto && (
        <>
          <p className="text-[14px] font-semibold text-[var(--ag-text)]">
            {nNovos
              ? `${nNovos} ${nNovos === 1 ? 'será gerado' : 'serão gerados'}.`
              : `Todos já têm ${imagem ? 'imagem ambientada' : 'descrição'}.`}
            {imagem && conf.jaTem.length > 0 && ' Sobrescrever acrescenta 3 imagens novas; as antigas ficam.'}
          </p>
          {erro && <p className="text-[13px]" style={{ color: 'var(--ag-danger)' }}>{erro}</p>}
          <div className="flex flex-wrap gap-2">
            {nNovos > 0 && (faltaPara(false) > 0
              ? <button className={botao} style={principal} onClick={onRecarregar}>Faltam {faltaPara(false)} créditos · Recarregar</button>
              : (
                <button className={botao} style={principal} disabled={enviando !== null} onClick={() => confirmar(false)}>
                  {enviando === false && <Loader2 className="w-4 h-4 animate-spin" />}
                  Gerar só os {nNovos} · {custoDe(conf, false)} créditos
                </button>
              ))}
            {conf.jaTem.length > 0 && (faltaPara(true) > 0 && nNovos === 0
              ? <button className={botao} style={principal} onClick={onRecarregar}>Faltam {faltaPara(true)} créditos · Recarregar</button>
              : (
                <button className={botao} style={nNovos ? secundario : principal} disabled={enviando !== null || faltaPara(true) > 0} onClick={() => confirmar(true)}>
                  {enviando === true && <Loader2 className="w-4 h-4 animate-spin" />}
                  Sobrescrever os {nTodos}
                </button>
              ))}
            <button className={botao} style={{ color: 'var(--ag-text-2)' }} disabled={enviando !== null} onClick={onCancelar}>Cancelar</button>
          </div>
        </>
      )}
    </div>
  );
};

export default CardConfirmacao;
```

- [ ] **Step 3: `FolhaAlfred.tsx` (phone sheet)**

```tsx
import React, { useRef, useState } from 'react';

type Altura = 'fechada' | 'meia' | 'cheia';

interface Props {
  altura: Altura;
  onAltura: (a: Altura) => void;
  children: React.ReactNode;
}

/**
 * O painel do Alfred no telefone: folha que sobe da base. Meia altura ao abrir
 * por uma ação; o puxador alterna meia/cheia; arrastar para baixo fecha.
 * Fechada, vira só o puxador "Alfred" acima da barra.
 */
const FolhaAlfred: React.FC<Props> = ({ altura, onAltura, children }) => {
  const inicio = useRef<number | null>(null);
  const [arrasto, setArrasto] = useState(0);
  const soltar = () => {
    if (arrasto > 80) onAltura(altura === 'cheia' ? 'meia' : 'fechada');
    else if (arrasto < -60) onAltura('cheia');
    inicio.current = null;
    setArrasto(0);
  };
  const puxador = (
    <button
      className="w-full pt-2 pb-1.5 flex flex-col items-center gap-1 touch-none"
      onClick={() => onAltura(altura === 'fechada' ? 'meia' : altura === 'meia' ? 'cheia' : 'meia')}
      onPointerDown={(e) => { inicio.current = e.clientY; }}
      onPointerMove={(e) => { if (inicio.current !== null) setArrasto(e.clientY - inicio.current); }}
      onPointerUp={soltar}
      onPointerCancel={soltar}
      aria-label={altura === 'fechada' ? 'Abrir o Alfred' : 'Redimensionar o painel do Alfred'}
    >
      <span className="w-10 h-1 rounded-full" style={{ background: 'var(--ag-hairline-2)' }} />
      {altura === 'fechada' && <span className="text-[12.5px] font-semibold text-[var(--ag-text-2)]">Alfred</span>}
    </button>
  );
  const h = altura === 'cheia' ? '88dvh' : altura === 'meia' ? '52dvh' : 'auto';
  return (
    <div
      className="ag-glass-strong rounded-t-[24px] flex flex-col min-h-0 shrink-0"
      style={{ height: h, transform: arrasto > 0 ? `translateY(${arrasto}px)` : undefined, borderTop: '1px solid var(--ag-hairline)', transition: inicio.current === null ? 'height 220ms ease' : undefined }}
    >
      {puxador}
      {altura !== 'fechada' && <div className="flex-1 min-h-0">{children}</div>}
    </div>
  );
};

export default FolhaAlfred;
```

- [ ] **Step 4: `LoteCard` — live lines and Desfazer**

In `src/modules/agent/chat/LoteCard.tsx`, import `linhasAoVivo, podeDesfazer` from `../lote` and `Undo2` from lucide. When `job?.auto` is true (lote that grava sozinho), render, below the header and above the existing body, a list:

```tsx
{job?.auto && (
  <ul className="px-4 py-2 flex flex-col gap-0.5 text-[13px]" aria-live="polite">
    {linhasAoVivo(job).map((l, i) => (
      <li key={i} style={{ color: l.tom === 'ok' ? 'var(--ag-ok)' : l.tom === 'alerta' ? 'var(--ag-warn)' : 'var(--ag-text-2)' }}>{l.texto}</li>
    ))}
  </ul>
)}
```

In the footer, when `job && podeDesfazer(job)`, add next to the summary:

```tsx
<Botao onClick={() => agir('desfazer')} ocupado={ocupado === 'desfazer'} icone={<Undo2 className="w-4 h-4" />}>Desfazer</Botao>
```

and when `job?.desfeito`, show `Desfeito` in `var(--ag-text-3)`. The summary for an auto lote reads `"{gravados} gravadas · {gravados × custoPorItem} créditos"`. `agir('desfazer')` already goes through `agirNoLote` (Task 8 added `'desfazer'` to `AcaoLote`); the response shape differs, so `agir` must not read `.status` from it (it doesn't today — it only awaits).

- [ ] **Step 5: Wire the panel into `ProdutosAgenteScreen`**

Add props `uid`, `credits`, `custoPorImagem`, `onFocoChange?`, `onRecarregar`. In the body:

```tsx
  const larga = useTelaLarga();          // ≥1280: coluna fixa
  const telaPequena = useTelaPequena();  // telefone: folha
  const alturaTeclado = useAlturaTeclado();
  const [painelAberto, setPainelAberto] = useState(false);   // 768–1280
  const [folha, setFolha] = useState<'fechada' | 'meia' | 'cheia'>('fechada');
  const [focado, setFocado] = useState(false);
  const [confirmando, setConfirmando] = useState<Confirmacao | null>(null);
  const conversa = useConversaAlfred(uid);

  // O painel fala da tela: seleção e filtros vão no contexto de cada mensagem.
  useEffect(() => {
    conversa.definirContexto({
      tela: 'produtos',
      ...(n ? { skus: produtosSelecionados.map(skuDe).filter(Boolean).slice(0, MAX_SKUS_CONTEXTO), totalSelecionados: n } : {}),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [produtosSelecionados]);

  const mostrarPainel = () => { if (telaPequena) setFolha((f) => (f === 'fechada' ? 'meia' : f)); else if (!larga) setPainelAberto(true); };

  const candidatos = (): CandidatoMassa[] => produtosSelecionados.map((p) => ({
    id: p._id, nome: nomeDe(p), temDescricao: !semDescricao(p), temAmbientada: temAmbientada(p), temFoto: temFoto(p),
  }));
  const pedirConfirmacao = (ferramenta: FerramentaMassa) => {
    setConfirmando(montarConfirmacao(ferramenta, candidatos(), ferramenta === 'produtos.ambientadas.gerar' ? custoPorImagem : custoPorDescricao));
    mostrarPainel();
  };
  const confirmar = async (sobrescrever: boolean) => {
    if (!confirmando) return;
    await criarLotesEmMassa(confirmando.ferramenta, alvos(confirmando, sobrescrever).map((c) => c.id), sobrescrever);
    setConfirmando(null); // os cards dos lotes chegam pela conversa
  };
```

Bar actions when `hasAgente && n > 0`:

```tsx
  acao = { rotulo: 'Gerar descrição para todas', onClick: () => pedirConfirmacao('produtos.descricoes.gerar') };
  acaoSecundaria = { rotulo: 'Gerar imagem para todas', onClick: () => pedirConfirmacao('produtos.ambientadas.gerar') };
  onPedirAlfred = () => { mostrarPainel(); void conversa.enviar(pedidoDaSelecao(produtosSelecionados).texto, pedidoDaSelecao(produtosSelecionados).contexto); };
```

Without selection: the current "Selecionar os N sem descrição" action. Without agent (`!hasAgente`): keep today's single `onGerarDescricoes` action and no panel.

Panel node:

```tsx
  const painel = (
    <PainelAlfred
      uid={uid}
      conversa={conversa}
      rodape={confirmando && (
        <CardConfirmacao conf={confirmando} saldo={credits} onConfirmar={confirmar} onCancelar={() => setConfirmando(null)} onRecarregar={onRecarregar} />
      )}
      vazio={<p className="flex-1 grid place-items-center px-6 text-center text-[13.5px] text-[var(--ag-text-2)]">Selecione produtos e escolha uma ação, ou peça qualquer coisa ao Alfred.</p>}
      onFoco={(f) => { setFocado(f); onFocoChange?.(f); }}
      recuoTeclado={telaPequena ? alturaTeclado : 0}
      emFoco={telaPequena && focado}
    />
  );
```

Layout:
- **`larga`**: `<div className="flex h-full">` → left `flex-1 min-w-0 flex flex-col` (list + `BarraProximoPasso`) and right `<aside className="w-[380px] shrink-0 flex flex-col min-h-0" style={{ borderLeft: '1px solid var(--ag-hairline)' }}>` with a 44px header ("Alfred", `AlfredLogo` size 22) and `{painel}`.
- **768–1280** (`!larga && !telaPequena`): an "Alfred" button in the top bar toggles `painelAberto`; when open, an absolutely positioned `aside` (right-0, top-0, bottom-0, w-[380px], `ag-glass-strong`, z-30, `boxShadow: var(--ag-shadow)`) with a close button and `{painel}`.
- **phone** (`telaPequena`): below the `BarraProximoPasso`, `<FolhaAlfred altura={folha} onAltura={setFolha}>{painel}</FolhaAlfred>`. When `folha !== 'fechada'`, hide the bar (`BarraProximoPasso` not rendered) so the sheet has the space; when the composer is focused, the App already hides the tab bar via `onFocoChange`.

Imports: `useTelaLarga, useTelaPequena, useAlturaTeclado` from `./useViewport`; `useConversaAlfred`; `PainelAlfred`; `CardConfirmacao`; `FolhaAlfred`; `montarConfirmacao, alvos, type Confirmacao, type CandidatoMassa, type FerramentaMassa` from `./confirmacaoMassa`; `criarLotesEmMassa` from `../../services/agentChatService`; `temAmbientada, temFoto, MAX_SKUS_CONTEXTO` from `./produtosAgente`; `AlfredLogo` from `../../components/alfredLogo/AlfredLogo`.

- [ ] **Step 6: App wiring**

In `src/App.tsx`, `<ProdutosAgenteScreen ... />` gains:

```tsx
              uid={user!.uid}
              credits={credits}
              custoPorImagem={getCreditCost(CREDIT_ACTIONS.ambientImage.key)}
              onFocoChange={setAlfredFocado}
              onRecarregar={() => abrirRecarga()}
```

Use the real names in `App.tsx`: the credits state (`grep -n "const \[credits\|userCredits" src/App.tsx`), the focus setter the Alfred tab already receives (`grep -n "alfredFocado" src/App.tsx`) and the handler the Conta menu uses to open the credit top-up (`grep -n "Recarregar\|setShowCredit\|recarga" src/App.tsx`). `onPedirAlfred` stays for the no-agent path; with agent the screen no longer leaves to the Alfred tab.

Wrap the list column of the screen so that, for `!hasAgente`, nothing of the panel renders and `uid` is not required at runtime (`user` exists whenever this screen is reachable).

- [ ] **Step 7: Lint**

Run: `npm run lint`
Expected: sem erros novos.

- [ ] **Step 8: Manual check — the main flow**

`npm run dev`, conta com agente e créditos:
1. Desktop ≥1280: selecionar 3 produtos (1 com descrição) → "Gerar descrição para todas" → no painel à direita as etapas entram uma a uma → "2 serão gerados" → **Gerar só os 2** → aparecem a troca e o card com "✍️ escrevendo…" → "✓ …" → as pílulas da lista viram ✓ → **Desfazer** devolve.
2. "Gerar imagem para todas" com um produto sem foto: a etapa "Sem foto para servir de base" aparece e ele fica de fora.
3. Todos já com descrição: só "Sobrescrever os N" e Cancelar.
4. Saldo baixo: botão vira "Faltam X créditos · Recarregar".
5. Texto livre no composer ("quais destes estão sem SEO?") mostra o pensamento real do modelo.
6. Trocar para a aba Alfred: a mesma conversa, com os cards.
7. 1024px: botão "Alfred" abre o painel sobreposto.
8. 390px: a ação abre a folha em meia altura com o card; arrastar para baixo fecha; focar o composer esconde a tab bar e o teclado não cobre o campo.
9. Tema escuro em todos os casos.

- [ ] **Step 9: Commit**

```bash
git add src/modules/agent/produtos/CardConfirmacao.tsx src/modules/agent/produtos/FolhaAlfred.tsx src/modules/agent/BarraProximoPasso.tsx src/modules/agent/chat/LoteCard.tsx src/modules/agent/ProdutosAgenteScreen.tsx src/App.tsx
git commit -m "feat(produtos): Alfred na lateral, gerar para todas com confirmação e progresso ao vivo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Documentação e verificação final

**Files:**
- Modify: `CLAUDE.md` (parágrafo "Agente Produtos (F2)" e lista de verificações)

- [ ] **Step 1: Update `CLAUDE.md`**

Replace the "**Agente Produtos (F2).**" paragraph's description of the list with the new behavior, keeping its style (pt-BR, dense, with file paths and the non-obvious rules). It must mention:
- lista com selo de integração (`SeloIntegracao`, regra em `src/modules/agent/sincronizacao.ts`, verificar com `npx tsx scripts/verify-sincronizacao.mjs`); carimbo `_tinyPushed`/`_wakePushed`/`_idworksPushed` gravado pelo servidor no envio (`server/syncStamp.ts`, também pelas ferramentas do Alfred) e na importação; importação nunca carimba imagens; sem carimbo, pendente só o que foi gerado no app; Bling continua com `_blingPushed` do navegador;
- painel de filtros (OU no grupo, E entre grupos, padrão = sem descrição OU sem foto) e paginação de 50, ambos em `produtosAgente.ts`;
- painel do Alfred: mesma conversa da aba Alfred via `useConversaAlfred`/`PainelAlfred`; coluna ≥1280, sobreposto 768–1280, `FolhaAlfred` no telefone;
- "Gerar … para todas": confirmação local (`confirmacaoMassa.ts`, `npx tsx scripts/verify-confirmacao-massa.mjs`) com etapas reais animadas; `POST /api/agent/lotes` (`server/agent/loteMassa.ts`) refaz a conta, cria lotes `auto: true` em paralelo (50/10) e grava a troca na conversa (`registrarTrocaNaConversa`, invisível ao grafo); Desfazer (`POST /api/agent/lotes/:id/desfazer`) só restaura descrição que ninguém editou depois, não estorna créditos.

- [ ] **Step 2: Run every check**

```bash
npx tsx scripts/verify-sincronizacao.mjs && \
npx tsx scripts/verify-produtos-agente.mjs && \
npx tsx scripts/verify-confirmacao-massa.mjs && \
npx tsx scripts/verify-lote.mjs && \
npx tsx scripts/verify-tiny-push.mjs && \
npx tsx scripts/verify-bling-push.mjs && \
npx tsx scripts/verify-agent-produtos.mjs && \
npx tsx scripts/verify-semana.mjs && \
npm run lint && npm run build
```

Expected: tudo passa; `vite build` conclui.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: Produtos com integração, filtros, paginação e Alfred na lateral

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
