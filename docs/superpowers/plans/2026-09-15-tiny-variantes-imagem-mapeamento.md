# Tiny v2: variantes com título próprio e imagem pelo mapeamento — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Variante importada do Tiny ganha título `{pai} - {grade}` e, no push, grava só a própria imagem no `urlImagem` do mapeamento, sempre pelo produto pai.

**Architecture:** O webhook monta título e `Variações` da variante a partir do pai. O cliente para de copiar imagens do pai para as variantes e manda `urlImagem` (imagem própria) no payload. O servidor ganha `pushV2Lote`, que lê cada item no Tiny, agrupa variações por `idProdutoPai` e envia um único `produto.alterar` por pai com `Developer-Id`, levando todas as variações e `mapeamentos` só nas do lote (montados pela função pura `buildV2VariacoesPayload`).

**Tech Stack:** TypeScript, Express (`server/`), React 19 (`src/`), scripts de verificação `.mjs` rodados com `npx tsx`.

**Spec:** `docs/superpowers/specs/2026-09-15-tiny-variantes-imagem-mapeamento-design.md`

## Global Constraints

- Escopo: API v2 do Tiny. O caminho v3 (`buildProductPutBody`, `tinyFetch`) não muda.
- Branch de trabalho: `tiny-variantes-imagem`.
- O valor do `Developer-Id` **nunca** entra em arquivo versionado. Variável: `TINY_DEVELOPER_ID`. Secret de produção: `tiny-developer-id`.
- Nunca enviar `mapeamentos: []` — um array vazio apaga os mapeamentos da variação no Tiny.
- Textos de passo (pt-BR), exatamente:
  - `no Tiny este campo pertence ao produto pai`
  - `sem imagem própria`
  - `variação ainda não mapeada no Tiny — envie o produto pela integração primeiro`
  - `variação não encontrada no produto pai no Tiny`
  - `o Tiny não informou o produto pai desta variação`
  - `o produto pai não está como "com variações" no Tiny`
  - `Developer-Id do Tiny não configurado`
- Título da variante: `{nome do pai} - {valores da grade unidos por " / "}`; grade vazia → só o nome do pai.
- `Variações`: `"Chave: Valor"` unidos por `"||"`.
- Invariantes existentes do push v2 continuam (ver `CLAUDE.md`, seção Tiny): só título, descrição complementar, SEO e imagens vêm do local; o resto é eco do `produto.obter`.
- Verificação: `npx tsx scripts/verify-tiny-push.mjs` termina com `Tudo certo.`; `npm run lint` não pode ganhar erros além dos 3 que já existem hoje (`src/App.tsx(865,32)`, `src/App.tsx(1593,11)`, `src/components/modals/ProductEditModal.tsx(333,13)`).
- Toda mensagem de commit termina com a linha `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## File Structure

| Arquivo | Responsabilidade | Tarefa |
|---|---|---|
| `server/tinyWebhook.ts` (modificar) | Normalizador do webhook: título e `Variações` da variante | 1 |
| `src/services/tinyVariantImage.ts` (criar) | Função pura `urlImagemPropria` | 2 |
| `src/App.tsx` (modificar) | Para de propagar imagens pai→variantes; manda `urlImagem` no push | 2 |
| `server/tinyAgent.ts`, `src/services/tinyService.ts` (modificar) | `TinyPushProduct.urlImagem?` | 2 |
| `server/tinyV2.ts` (modificar) | Eco de `descricao_complementar`; cabeçalhos extras; `pushV2Lote` | 3, 5 |
| `server/tinyV2Variacoes.ts` (criar) | Função pura `buildV2VariacoesPayload` + textos de passo | 4 |
| `server/tinyProvider.ts` (modificar) | Rota `/api/tiny/push` usa `pushV2Lote` na v2 | 5 |
| `scripts/verify-tiny-push.mjs` (modificar) | Casos novos de verificação | 1–5 |
| `.env.example`, `apphosting.yaml`, `CLAUDE.md` (modificar) | Configuração e documentação | 5, 6 |
| `scripts/diag-tiny-variacoes.mjs` (criar) | Diagnóstico só de leitura para o teste real | 6 |

Todas as seções novas do script de verificação são inseridas **imediatamente antes** da última linha de resumo:

```js
console.log(failures === 0 ? '\nTudo certo.' : `\n${failures} falha(s).`);
```

---

### Task 1: Webhook — título e grade da variante

**Files:**
- Modify: `server/tinyWebhook.ts:66-94`
- Test: `scripts/verify-tiny-push.mjs`

**Interfaces:**
- Consumes: `normalizeWebhookPayload(dados)` (já exportada), `TinyNormalizedProduct` de `server/tinyAgent.ts`.
- Produces: `normalizeWebhookPayload` mantém a assinatura; variações passam a ter `nome` = título composto e `variacaoGrade` com `||`.

- [ ] **Step 1: Escrever o teste que falha**

No topo de `scripts/verify-tiny-push.mjs`, depois dos imports existentes, adicionar:

```js
import { normalizeWebhookPayload } from '../server/tinyWebhook.ts';
```

Antes da linha de resumo, inserir:

```js
// --- 5. webhook: título e grade da variante -------------------------------
// O webhook não manda nome por variação. O título é o nome do pai + os valores
// da grade, e 'Variações' usa o separador || que a lista do catálogo divide.
const webhook = normalizeWebhookPayload({
  id: '100',
  codigo: 'COB',
  nome: 'Cobertor Manta Bebê Colibri Jolitex',
  variacoes: [
    { id: '101', codigo: 'COB-1', grade: [{ chave: 'Cor', valor: 'Rosa' }] },
    { id: '102', codigo: 'COB-2', grade: [{ chave: 'Cor', valor: 'Azul' }, { chave: 'Tamanho', valor: 'P' }] },
    { id: '103', codigo: 'COB-3', grade: [] },
  ],
});
check('título com 1 atributo', webhook.variacoes[0].nome, 'Cobertor Manta Bebê Colibri Jolitex - Rosa');
check('título com 2 atributos', webhook.variacoes[1].nome, 'Cobertor Manta Bebê Colibri Jolitex - Azul / P');
check('grade vazia fica só com o nome do pai', webhook.variacoes[2].nome, 'Cobertor Manta Bebê Colibri Jolitex');
check('Variações com ||', webhook.variacoes[1].variacaoGrade, 'Cor: Azul||Tamanho: P');
check('grade vazia não grava Variações', webhook.variacoes[2].variacaoGrade, undefined);
check('SKU da variante continua o código', webhook.variacoes[0].sku, 'COB-1');
check('variante aponta para o SKU do pai', webhook.variacoes[0].codigoPai, 'COB');
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx tsx scripts/verify-tiny-push.mjs`
Expected: linhas `FALHA  título com 1 atributo → esperado "Cobertor Manta Bebê Colibri Jolitex - Rosa", veio "COB-1"` e `FALHA  Variações com ||`; saída termina com `falha(s).`

- [ ] **Step 3: Implementar**

Em `server/tinyWebhook.ts`, substituir o bloco que começa em `// Tiny doesn't send a display name per variação — reuse its own codigo so the` e vai até o fim de `normalizeWebhookPayload` por:

```ts
// Tiny doesn't send a display name per variação. The title is the parent's
// name plus the grade values ("Cobertor … - Azul / P"), and 'Variações' uses
// the "Chave: Valor||Chave: Valor" format the catalog UI splits on.
function gradeDaVariacao(v: any): Array<{ chave: string; valor: string }> {
  if (!Array.isArray(v?.grade)) return [];
  return v.grade
    .map((g: any) => ({ chave: String(g?.chave ?? '').trim(), valor: String(g?.valor ?? '').trim() }))
    .filter((g: { valor: string }) => g.valor);
}

function normalizeWebhookVariacao(v: any, parent: TinyNormalizedProduct): TinyNormalizedProduct {
  const grade = gradeDaVariacao(v);
  const valores = grade.map((g) => g.valor).join(' / ');
  const variacaoGrade = grade.map((g) => (g.chave ? `${g.chave}: ${g.valor}` : g.valor)).join('||');
  return {
    tinyId: String(v?.id),
    sku: v?.codigo ?? '',
    nome: [parent.nome, valores].filter(Boolean).join(' - '),
    gtin: v?.gtin || undefined,
    precoPor: num(v?.preco),
    precoDe: num(v?.precoPromocional),
    estoque: num(v?.estoqueAtual),
    codigoPai: parent.sku || undefined,
    variacaoGrade: variacaoGrade || undefined,
    categorias: [],
    imagens: collectWebhookImages(v),
    raw: v,
  };
}

export function normalizeWebhookPayload(dados: any): { parent: TinyNormalizedProduct; variacoes: TinyNormalizedProduct[] } {
  const parent = normalizeWebhookParent(dados);
  const variacoes = Array.isArray(dados?.variacoes)
    ? dados.variacoes.map((v: any) => normalizeWebhookVariacao(v, parent))
    : [];
  return { parent, variacoes };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx tsx scripts/verify-tiny-push.mjs`
Expected: todas as linhas `  ok`, termina com `Tudo certo.`

- [ ] **Step 5: Commit**

```bash
git add server/tinyWebhook.ts scripts/verify-tiny-push.mjs
git commit -m "fix(tiny): variante do webhook ganha título {pai} - {grade} e Variações com ||

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Imagem própria da variante no cliente

**Files:**
- Create: `src/services/tinyVariantImage.ts`
- Modify: `src/App.tsx` (import perto da linha 51; `tinyPushPayloadOf` em ~1847; `handleSaveImages` em ~2208-2238)
- Modify: `server/tinyAgent.ts:243-253` (`TinyPushProduct`)
- Modify: `src/services/tinyService.ts:43-52` (`TinyPushProduct`)
- Test: `scripts/verify-tiny-push.mjs`

**Interfaces:**
- Consumes: `Product` de `src/types/models.ts` (`_selectedImage?: string`, `'URL imagem 1'?: string`, `'Código do pai'?: string`).
- Produces: `urlImagemPropria(produto, pai?): string | undefined`; `TinyPushProduct.urlImagem?: string` (servidor e cliente) — consumido por `pushV2Lote` na Task 5.

- [ ] **Step 1: Escrever o teste que falha**

No topo de `scripts/verify-tiny-push.mjs`, adicionar:

```js
import { urlImagemPropria } from '../src/services/tinyVariantImage.ts';
```

Antes da linha de resumo, inserir:

```js
// --- 6. urlImagemPropria: variante sem imagem própria fica sem imagem ------
const paiImg = { 'Código (SKU)': 'COB', _selectedImage: 'https://img/pai.jpg' };
check('produto simples leva a própria imagem', urlImagemPropria({ _selectedImage: 'https://img/a.jpg' }), 'https://img/a.jpg');
check('sem _selectedImage usa URL imagem 1', urlImagemPropria({ 'URL imagem 1': 'https://img/b.jpg' }), 'https://img/b.jpg');
check('variante com imagem própria', urlImagemPropria({ 'Código do pai': 'COB', _selectedImage: 'https://img/rosa.jpg' }, paiImg), 'https://img/rosa.jpg');
check('imagem igual à do pai conta como herdada', urlImagemPropria({ 'Código do pai': 'COB', _selectedImage: 'https://img/pai.jpg' }, paiImg), undefined);
check('herdada também quando o pai só tem URL imagem 1', urlImagemPropria({ 'Código do pai': 'COB', 'URL imagem 1': 'https://img/p1.jpg' }, { 'URL imagem 1': 'https://img/p1.jpg' }), undefined);
check('variante sem imagem', urlImagemPropria({ 'Código do pai': 'COB' }, paiImg), undefined);
check('imagem não pública (data:) não vale', urlImagemPropria({ _selectedImage: 'data:image/png;base64,AAA' }), undefined);
check('produto sem pai não é comparado', urlImagemPropria({ _selectedImage: 'https://img/pai.jpg' }, paiImg), 'https://img/pai.jpg');
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx tsx scripts/verify-tiny-push.mjs`
Expected: erro de módulo não encontrado para `../src/services/tinyVariantImage.ts`.

- [ ] **Step 3: Criar `src/services/tinyVariantImage.ts`**

```ts
// Imagem que um produto leva para o Tiny no urlImagem do mapeamento (usada só
// quando o Tiny diz que o item é variação). Pura — sem I/O — para ser verificada
// em scripts/verify-tiny-push.mjs.
import type { Product } from '../types/models';

type ComImagem = Pick<Product, '_selectedImage' | 'URL imagem 1' | 'Código do pai'>;

// Imagem principal: a escolhida no omni360, senão a primeira importada. Só vale
// URL pública http(s) — o Tiny baixa a imagem; data: e blob: não servem.
function imagemPrincipal(p?: ComImagem): string | undefined {
  const url = p?._selectedImage || p?.['URL imagem 1'];
  return typeof url === 'string' && /^https?:\/\//i.test(url) ? url : undefined;
}

// Variante sem imagem própria fica sem imagem. Uma imagem idêntica à principal
// do pai é tratada como herdada: é o que sobrou da antiga propagação pai→filhos
// em handleSaveImages, e mandá-la gravaria a foto do pai na variação.
export function urlImagemPropria(produto: ComImagem, pai?: ComImagem): string | undefined {
  const url = imagemPrincipal(produto);
  if (!url) return undefined;
  if (produto['Código do pai'] && imagemPrincipal(pai) === url) return undefined;
  return url;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx tsx scripts/verify-tiny-push.mjs`
Expected: termina com `Tudo certo.`

- [ ] **Step 5: Adicionar `urlImagem` ao tipo nos dois lados**

Em `server/tinyAgent.ts`, dentro de `export interface TinyPushProduct`, logo depois de `imagens?: string[];`:

```ts
  // Imagem principal própria (sem a herdada do pai). Só usada quando o Tiny diz
  // que o item é variação: vira o urlImagem do mapeamento, gravado pelo pai.
  urlImagem?: string;
```

Em `src/services/tinyService.ts`, dentro de `export interface TinyPushProduct`, logo depois de `imagens?: string[];`:

```ts
  /** Imagem principal própria; vira o urlImagem do mapeamento quando o item é variação. */
  urlImagem?: string;
```

- [ ] **Step 6: Mandar `urlImagem` no payload do push**

Em `src/App.tsx`, logo abaixo de `import type { TinyPushProduct, TinyPushResult } from './services/tinyService';`:

```ts
import { urlImagemPropria } from './services/tinyVariantImage';
```

Substituir a função `tinyPushPayloadOf` inteira (hoje uma arrow que devolve o objeto direto) por:

```ts
  const tinyPushPayloadOf = (p: Product): TinyPushProduct => {
    const paiSku = p['Código do pai'];
    const pai = paiSku ? productsRef.current.find((x) => x['Código (SKU)'] === paiSku) : undefined;
    return {
      tinyId: p._tinyProductId!,
      sku: p['Código (SKU)'],
      nome: p['Descrição'],
      descricaoHtml: p['Descrição complementar'],
      seoTitle: p['Título SEO'],
      seoDescription: p['Descrição SEO'],
      seoKeywords: p['Palavras chave SEO'],
      imagens: collectTinyImages(p),
      // Só a imagem própria: é o que o servidor grava no mapeamento de uma variante.
      urlImagem: urlImagemPropria(p, pai),
    };
  };
```

- [ ] **Step 7: Parar de propagar imagens do pai para as variantes**

Em `src/App.tsx`, dentro de `handleSaveImages`, substituir:

```ts
      updated[idx] = updateProduct(updated[idx]);

      // Also update children if any
      const parentSku = updated[idx]['Código (SKU)'];
      if (parentSku) {
        for (let i = 0; i < updated.length; i++) {
          if (updated[i]['Código do pai'] === parentSku) {
            updated[i] = updateProduct(updated[i]);
          }
        }
      }

      return updated;
```

por:

```ts
      // Só o próprio produto. Variante não herda a imagem do pai: ela vai para o
      // mapeamento da variação no Tiny, e a do pai gravaria a foto errada lá
      // (docs/superpowers/specs/2026-09-15-tiny-variantes-imagem-mapeamento-design.md).
      updated[idx] = updateProduct(updated[idx]);

      return updated;
```

- [ ] **Step 8: Checar tipos**

Run: `npm run lint`
Expected: exatamente os 3 erros pré-existentes listados em Global Constraints, nenhum novo.

- [ ] **Step 9: Commit**

```bash
git add src/services/tinyVariantImage.ts src/App.tsx server/tinyAgent.ts src/services/tinyService.ts scripts/verify-tiny-push.mjs
git commit -m "feat(tiny): variante manda só a imagem própria e não herda mais a do pai

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Ecoar `descricao_complementar` no `produto.alterar`

Motivo: `produto.alterar.php` zera escalar que fica fora do payload (`CLAUDE.md`, invariante 2). Hoje a descrição complementar só entra quando a local muda. O push de uma variante escreve no registro do **pai** sem texto local — sem este eco, a descrição do pai seria zerada.

**Files:**
- Modify: `server/tinyV2.ts:313-314` (dentro de `buildV2AlterarPayload`)
- Test: `scripts/verify-tiny-push.mjs`

**Interfaces:**
- Consumes: `buildV2AlterarPayload(current, prod, sobrescreverTitulo)` (existente).
- Produces: mesma assinatura; `produto.descricao_complementar` passa a vir do Tiny quando a local não sobrescreve. Consumido por `pushV2Lote` (Task 5).

- [ ] **Step 1: Escrever o teste que falha**

Antes da linha de resumo, inserir:

```js
// --- 7. descricao_complementar ecoada do Tiny ------------------------------
// É escalar como os pesos: fora do payload, o alterar zera. O push de uma
// variante escreve no pai sem texto local, então a descrição do pai tem que ir.
const soSeo = buildV2AlterarPayload(noTinyV2, { tinyId: '777', seoTitle: 'Outro título SEO' });
check('descrição do Tiny ecoada quando não há local', soSeo.produto.descricao_complementar, '<p>antiga</p>');
check('eco da descrição não entra no log', soSeo.enviado.map((e) => e.campo), ['Título SEO']);
check('eco da descrição não marca o passo', soSeo.steps.descricao, 'sem dado local');
const semDescricaoNoTiny = buildV2AlterarPayload({ ...noTinyV2, descricao_complementar: '' }, { tinyId: '777', seoTitle: 'Outro título SEO' });
check('descrição vazia no Tiny não é inventada', 'descricao_complementar' in semDescricaoNoTiny.produto, false);
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx tsx scripts/verify-tiny-push.mjs`
Expected: `FALHA  descrição do Tiny ecoada quando não há local → esperado "<p>antiga</p>", veio undefined`

- [ ] **Step 3: Implementar**

Em `server/tinyV2.ts`, logo depois da linha:

```ts
  if (typeof current?.categoria === 'string' && current.categoria.trim()) produto.categoria = current.categoria;
```

adicionar:

```ts
  // descricao_complementar is a scalar like pesos: left out, alterar resets it.
  // Echo Tiny's own value; the local one overrides it below only when it differs.
  // A variant push writes to the PARENT record with no local text at all.
  if (typeof current?.descricao_complementar === 'string' && current.descricao_complementar !== '') {
    produto.descricao_complementar = current.descricao_complementar;
  }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx tsx scripts/verify-tiny-push.mjs`
Expected: termina com `Tudo certo.` (os casos antigos de descrição — `descrição local é a única coisa nova` — continuam passando, porque a local sobrescreve o eco).

- [ ] **Step 5: Commit**

```bash
git add server/tinyV2.ts scripts/verify-tiny-push.mjs
git commit -m "fix(tiny): ecoa descricao_complementar do Tiny no produto.alterar v2

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: `buildV2VariacoesPayload` (função pura)

**Files:**
- Create: `server/tinyV2Variacoes.ts`
- Test: `scripts/verify-tiny-push.mjs`

**Interfaces:**
- Consumes: `logTexto`, `push`, `PushLogEntry` de `server/pushLog.ts`.
- Produces (exportados):
  - constantes `PASSO_PERTENCE_AO_PAI`, `PASSO_SEM_IMAGEM`, `PASSO_NAO_MAPEADA`, `PASSO_NAO_ENCONTRADA`, `PASSO_SEM_PAI`, `PASSO_PAI_SEM_VARIACOES`, `PASSO_SEM_DEVELOPER_ID` (strings de Global Constraints);
  - `interface VarianteDoLote { tinyId: string; urlImagem?: string }`;
  - `interface VariacoesPayload { variacoes: Array<{ variacao: Record<string, unknown> }>; passoImagem: Record<string, string>; enviado: Record<string, PushLogEntry[]>; temMapeamento: boolean }`;
  - `buildV2VariacoesPayload(paiAtual: any, variantes: VarianteDoLote[]): VariacoesPayload`.
  - Fixture `paiTiny` no script — reusada pela Task 5.

- [ ] **Step 1: Escrever o teste que falha**

No topo de `scripts/verify-tiny-push.mjs`, adicionar:

```js
import {
  buildV2VariacoesPayload, PASSO_PERTENCE_AO_PAI, PASSO_SEM_IMAGEM, PASSO_NAO_MAPEADA,
  PASSO_NAO_ENCONTRADA, PASSO_SEM_PAI, PASSO_PAI_SEM_VARIACOES, PASSO_SEM_DEVELOPER_ID,
} from '../server/tinyV2Variacoes.ts';
```

Antes da linha de resumo, inserir:

```js
// --- 8. buildV2VariacoesPayload: todas as variações, mapeamento só no lote --
// Registro do pai como o produto.obter responde COM Developer-Id (é o que traz
// os mapeamentos de cada variação).
const paiTiny = {
  id: '500', codigo: 'COB', nome: 'Cobertor Manta Bebê Colibri Jolitex', unidade: 'UN', preco: '149.00',
  origem: '0', situacao: 'A', tipo: 'P', classe_produto: 'V', tipoVariacao: 'P',
  descricao_complementar: '<p>descrição do pai</p>', seo: { seo_title: 'SEO do pai' },
  variacoes: [
    { variacao: { id: '501', codigo: 'COB-501', preco: '149.00', grade: { Cor: 'Rosa' },
      mapeamentos: [{ mapeamento: { idEcommerce: 7, skuMapeamento: 'COB.501', skuMapeamentoPai: 'COB', idMapeamento: 9001, idMapeamentoPai: 9000 } }] } },
    { variacao: { id: '502', codigo: 'COB-502', preco: '139.00', grade: { Cor: 'Azul' },
      mapeamentos: [{ mapeamento: { idEcommerce: 7, skuMapeamento: 'COB.502', skuMapeamentoPai: 'COB' } }] } },
    { variacao: { id: '503', codigo: 'COB-503', preco: '149.00', grade: { Cor: 'Verde' } } },
  ],
};
const vp = buildV2VariacoesPayload(paiTiny, [
  { tinyId: '501', urlImagem: 'https://img/rosa.jpg' },
  { tinyId: '502' },
  { tinyId: '503', urlImagem: 'https://img/verde.jpg' },
  { tinyId: '999', urlImagem: 'https://img/x.jpg' },
]);
check('todas as variações do pai vão no payload', vp.variacoes.map((v) => v.variacao.id), ['501', '502', '503']);
check('variação ecoa código, preço e grade do Tiny', vp.variacoes[1].variacao, { id: '502', codigo: 'COB-502', preco: '139.00', grade: { Cor: 'Azul' } });
check('mapeamento copiado com urlImagem (sem ids da Olist)', vp.variacoes[0].variacao.mapeamentos, [
  { mapeamento: { idEcommerce: 7, skuMapeamento: 'COB.501', skuMapeamentoPai: 'COB', urlImagem: 'https://img/rosa.jpg' } },
]);
check('variante sem imagem não leva mapeamentos', 'mapeamentos' in vp.variacoes[1].variacao, false);
check('variação sem mapeamento não leva mapeamentos', 'mapeamentos' in vp.variacoes[2].variacao, false);
check('passo de imagem por variante', vp.passoImagem, { '501': 'ok', '502': PASSO_SEM_IMAGEM, '503': PASSO_NAO_MAPEADA, '999': PASSO_NAO_ENCONTRADA });
check('log só na variante gravada', Object.fromEntries(Object.entries(vp.enviado).map(([k, v]) => [k, v.map((e) => e.valor)])), {
  '501': ['https://img/rosa.jpg'], '502': [], '503': [], '999': [],
});
check('log nomeia o campo', vp.enviado['501'][0].campo, 'URL da imagem (mapeamento)');
check('há mapeamento a gravar', vp.temMapeamento, true);
check('nunca manda mapeamentos vazio', JSON.stringify(vp.variacoes).includes('"mapeamentos":[]'), false);
check('sem imagem, nada a gravar', buildV2VariacoesPayload(paiTiny, [{ tinyId: '501' }]).temMapeamento, false);
check('pai sem variações devolve lista vazia', buildV2VariacoesPayload({ id: '1' }, []).variacoes, []);
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx tsx scripts/verify-tiny-push.mjs`
Expected: erro de módulo não encontrado para `../server/tinyV2Variacoes.ts`.

- [ ] **Step 3: Criar `server/tinyV2Variacoes.ts`**

```ts
// Tiny v2: variações de um produto dentro do produto.alterar do PAI. No Tiny, a
// variação só existe em variacoes[] do pai, e a imagem própria dela só existe no
// mapeamento com o e-commerce (variacoes[].variacao.mapeamentos[].mapeamento.urlImagem,
// que só é aceito com o cabeçalho Developer-Id). Pura — sem I/O — para ser
// verificada em scripts/verify-tiny-push.mjs.
import { logTexto, push as pushLog, type PushLogEntry } from './pushLog';

export const PASSO_PERTENCE_AO_PAI = 'no Tiny este campo pertence ao produto pai';
export const PASSO_SEM_IMAGEM = 'sem imagem própria';
export const PASSO_NAO_MAPEADA = 'variação ainda não mapeada no Tiny — envie o produto pela integração primeiro';
export const PASSO_NAO_ENCONTRADA = 'variação não encontrada no produto pai no Tiny';
export const PASSO_SEM_PAI = 'o Tiny não informou o produto pai desta variação';
export const PASSO_PAI_SEM_VARIACOES = 'o produto pai não está como "com variações" no Tiny';
export const PASSO_SEM_DEVELOPER_ID = 'Developer-Id do Tiny não configurado';

export interface VarianteDoLote {
  tinyId: string;
  urlImagem?: string;
}

export interface VariacoesPayload {
  /** Todas as variações do pai, prontas para produto.variacoes. */
  variacoes: Array<{ variacao: Record<string, unknown> }>;
  /** tinyId da variante do lote → valor de steps.imagens. */
  passoImagem: Record<string, string>;
  /** tinyId da variante do lote → o que foi gravado (ver server/pushLog.ts). */
  enviado: Record<string, PushLogEntry[]>;
  /** Se ao menos uma variante do lote tem mapeamento a gravar. */
  temMapeamento: boolean;
}

const semVazios = (o: Record<string, unknown>): Record<string, unknown> => {
  Object.keys(o).forEach((k) => { if (o[k] === undefined || o[k] === null || o[k] === '') delete o[k]; });
  return o;
};

// `paiAtual` é o produto.obter do pai (com Developer-Id). Toda variação do pai
// vai no payload — mandar só parte da lista não é documentado e poderia remover
// as outras. Cada uma ecoa id/codigo/preco/grade como o Tiny devolveu. Só as
// variantes do lote com imagem própria E mapeamento existente ganham
// `mapeamentos`, copiados do obter com o urlImagem trocado. `mapeamentos` nunca
// vai vazio: um array vazio apaga os mapeamentos da variação.
export function buildV2VariacoesPayload(paiAtual: any, variantes: VarianteDoLote[]): VariacoesPayload {
  const passoImagem: Record<string, string> = {};
  const enviado: Record<string, PushLogEntry[]> = {};
  const alvos = new Map(variantes.map((v) => [String(v.tinyId), v]));
  let temMapeamento = false;

  const lista: any[] = Array.isArray(paiAtual?.variacoes)
    ? paiAtual.variacoes.map((x: any) => x?.variacao ?? x).filter((v: any) => v?.id !== undefined && v?.id !== null)
    : [];

  const variacoes = lista.map((v) => {
    const variacao = semVazios({ id: v.id, codigo: v.codigo, preco: v.preco, grade: v.grade });
    const id = String(v.id);
    const alvo = alvos.get(id);
    if (!alvo) return { variacao };

    const log: PushLogEntry[] = [];
    enviado[id] = log;
    if (!alvo.urlImagem) {
      passoImagem[id] = PASSO_SEM_IMAGEM;
      return { variacao };
    }
    const existentes = (Array.isArray(v.mapeamentos) ? v.mapeamentos : [])
      .map((m: any) => m?.mapeamento ?? m)
      .filter((m: any) => m?.skuMapeamento);
    if (!existentes.length) {
      passoImagem[id] = PASSO_NAO_MAPEADA;
      return { variacao };
    }
    variacao.mapeamentos = existentes.map((m: any) => ({
      mapeamento: semVazios({
        idEcommerce: m.idEcommerce,
        skuMapeamento: m.skuMapeamento,
        skuMapeamentoPai: m.skuMapeamentoPai,
        urlImagem: alvo.urlImagem,
      }),
    }));
    passoImagem[id] = 'ok';
    pushLog(log, logTexto('URL da imagem (mapeamento)', alvo.urlImagem));
    temMapeamento = true;
    return { variacao };
  });

  for (const v of variantes) {
    const id = String(v.tinyId);
    if (!(id in passoImagem)) {
      passoImagem[id] = PASSO_NAO_ENCONTRADA;
      enviado[id] = [];
    }
  }

  return { variacoes, passoImagem, enviado, temMapeamento };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx tsx scripts/verify-tiny-push.mjs`
Expected: termina com `Tudo certo.`

- [ ] **Step 5: Commit**

```bash
git add server/tinyV2Variacoes.ts scripts/verify-tiny-push.mjs
git commit -m "feat(tiny): monta variacoes do pai com urlImagem no mapeamento (v2)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: `pushV2Lote`, cabeçalho `Developer-Id` e rota

**Files:**
- Modify: `server/tinyV2.ts` (imports; `tinyV2CallRaw` 31-102; `tinyV2Call` 104-108; nova função `pushV2Lote` no fim do arquivo)
- Modify: `server/tinyProvider.ts:11` (import) e `103-139` (rota `/api/tiny/push`)
- Modify: `.env.example` (seção Tiny)
- Test: `scripts/verify-tiny-push.mjs`

**Interfaces:**
- Consumes: `buildV2AlterarPayload` (Task 3, com eco de descrição); `buildV2VariacoesPayload`, `VariacoesPayload` e as constantes `PASSO_*` (Task 4); `TinyPushProduct.urlImagem` (Task 2); `TinyPushResult`, `TinyPushSteps` de `server/tinyAgent.ts`; fixture `paiTiny` e `noTinyV2` do script (Task 4 e seção 3b existente).
- Produces:
  - `tinyV2CallRaw(token, endpoint, params, attempt = 0, headers: Record<string, string> = {})` — chamadas antigas com 3 argumentos continuam válidas (`server/agent/tools/tiny.ts`, `server/agent/tools/discovery.ts`);
  - `export async function tinyV2Call(uid, endpoint, params, headers?)`;
  - `export type V2Caller = (endpoint: string, params: Record<string, string>, headers?: Record<string, string>) => Promise<any>`;
  - `export async function pushV2Lote(call: V2Caller, produtos: TinyPushProduct[], opts: { sobrescreverTitulo: boolean; developerId?: string }): Promise<TinyPushResult[]>`.

- [ ] **Step 1: Escrever os testes que falham**

No topo de `scripts/verify-tiny-push.mjs`, trocar:

```js
import { tinyV2CallRaw, buildV2AlterarPayload, normalizeV2Product } from '../server/tinyV2.ts';
```

por:

```js
import { tinyV2CallRaw, buildV2AlterarPayload, normalizeV2Product, pushV2Lote } from '../server/tinyV2.ts';
```

Antes da linha de resumo, inserir:

```js
// --- 9. tinyV2CallRaw repassa cabeçalhos extras ----------------------------
{
  let capturado;
  globalThis.fetch = async (_url, init) => {
    capturado = init.headers;
    return new Response(JSON.stringify({ retorno: { status: 'OK' } }), { status: 200 });
  };
  await tinyV2CallRaw('tok', 'produto.obter.php', { id: '1' }, 0, { 'Developer-Id': 'dev-123' });
  check('Developer-Id vai no cabeçalho', capturado['Developer-Id'], 'dev-123');
  check('Content-Type continua', capturado['Content-Type'], 'application/x-www-form-urlencoded');
  await tinyV2CallRaw('tok', 'produto.obter.php', { id: '1' });
  check('sem cabeçalho extra não há Developer-Id', 'Developer-Id' in capturado, false);
  globalThis.fetch = originalFetch;
}

// --- 10. pushV2Lote: variações agrupadas pelo pai ---------------------------
const varTiny = (id, extra = {}) => ({
  id, codigo: `COB-${id}`, nome: `COB-${id}`, unidade: 'UN', preco: '149.00', origem: '0', situacao: 'A', tipo: 'P',
  tipoVariacao: 'V', idProdutoPai: '500', classe_produto: 'S', ...extra,
});
const registrosCobertor = {
  '500': paiTiny, '501': varTiny('501'), '502': varTiny('502'), '503': varTiny('503'),
  '600': { ...noTinyV2, id: '600', tipoVariacao: 'N', classe_produto: 'S' },
};
function tinyFalso(registros, { falharAlterar = false } = {}) {
  const chamadas = [];
  const call = async (endpoint, params, headers) => {
    chamadas.push({ endpoint, params, headers });
    if (endpoint === 'produto.obter.php') return { produto: registros[params.id] };
    if (endpoint === 'produto.alterar.php') {
      if (falharAlterar) throw new Error('[registro] [cod 31] erro do Tiny');
      return { status: 'OK' };
    }
    throw new Error(`endpoint inesperado: ${endpoint}`);
  };
  return { call, chamadas };
}
const alteracoes = (chamadas) => chamadas.filter((c) => c.endpoint === 'produto.alterar.php');
const payloadDe = (chamada) => JSON.parse(chamada.params.produto).produtos[0].produto;
const DEV = { sobrescreverTitulo: true, developerId: 'dev-123' };

// A. Duas variantes do mesmo pai, uma com imagem própria.
{
  const { call, chamadas } = tinyFalso(registrosCobertor);
  const res = await pushV2Lote(call, [
    { tinyId: '501', sku: 'COB-501', nome: 'Título local', descricaoHtml: '<p>local da variante</p>', seoTitle: 'SEO local', urlImagem: 'https://img/rosa.jpg' },
    { tinyId: '502', sku: 'COB-502' },
  ], DEV);
  check('A: uma única alteração, no pai', alteracoes(chamadas).map((c) => payloadDe(c).id), ['500']);
  check('A: obter do pai leva Developer-Id', chamadas.find((c) => c.endpoint === 'produto.obter.php' && c.params.id === '500').headers, { 'Developer-Id': 'dev-123' });
  check('A: alterar leva Developer-Id', alteracoes(chamadas)[0].headers, { 'Developer-Id': 'dev-123' });
  const p = payloadDe(alteracoes(chamadas)[0]);
  check('A: payload leva todas as variações do pai', p.variacoes.map((v) => v.variacao.id), ['501', '502', '503']);
  check('A: mapeamento só na variante com imagem', p.variacoes.map((v) => 'mapeamentos' in v.variacao), [true, false, false]);
  check('A: texto da variante não entra no pai', [p.nome, p.descricao_complementar], ['Cobertor Manta Bebê Colibri Jolitex', '<p>descrição do pai</p>']);
  check('A: seo do pai intacto', p.seo.seo_title, 'SEO do pai');
  check('A: resultados na ordem do lote', res.map((r) => r.tinyId), ['501', '502']);
  check('A: passos da variante com imagem', res[0].steps, { titulo: PASSO_PERTENCE_AO_PAI, descricao: PASSO_PERTENCE_AO_PAI, seo: PASSO_PERTENCE_AO_PAI, imagens: 'ok' });
  check('A: log da variante com imagem', res[0].enviado.map((e) => e.campo), ['URL da imagem (mapeamento)']);
  check('A: variante sem imagem', [res[1].ok, res[1].steps.imagens, res[1].enviado], [true, PASSO_SEM_IMAGEM, []]);
}

// B. Sem Developer-Id nada de variante é gravado.
{
  const { call, chamadas } = tinyFalso(registrosCobertor);
  const res = await pushV2Lote(call, [{ tinyId: '501', urlImagem: 'https://img/rosa.jpg' }], { sobrescreverTitulo: true });
  check('B: nenhuma alteração', alteracoes(chamadas).length, 0);
  check('B: pai nem é lido', chamadas.some((c) => c.params.id === '500'), false);
  check('B: aviso de configuração', [res[0].ok, res[0].steps.imagens], [true, PASSO_SEM_DEVELOPER_ID]);
}

// C. Pai e variante no mesmo lote: uma chamada só.
{
  const { call, chamadas } = tinyFalso(registrosCobertor);
  const res = await pushV2Lote(call, [
    { tinyId: '500', sku: 'COB', descricaoHtml: '<p>descrição nova do pai</p>' },
    { tinyId: '501', urlImagem: 'https://img/rosa.jpg' },
  ], DEV);
  check('C: uma alteração', alteracoes(chamadas).length, 1);
  const p = payloadDe(alteracoes(chamadas)[0]);
  check('C: texto do pai aplicado', p.descricao_complementar, '<p>descrição nova do pai</p>');
  check('C: variações junto', p.variacoes.length, 3);
  check('C: resultado do pai', [res[0].ok, res[0].steps.descricao], [true, 'ok']);
  check('C: resultado da variante', res[1].steps.imagens, 'ok');
}

// D. Variação sem mapeamento: nada a gravar.
{
  const { call, chamadas } = tinyFalso(registrosCobertor);
  const res = await pushV2Lote(call, [{ tinyId: '503', urlImagem: 'https://img/verde.jpg' }], DEV);
  check('D: nenhuma alteração', alteracoes(chamadas).length, 0);
  check('D: aviso de variação não mapeada', [res[0].ok, res[0].steps.imagens], [true, PASSO_NAO_MAPEADA]);
}

// E. Produto simples segue o caminho de sempre.
{
  const { call, chamadas } = tinyFalso(registrosCobertor);
  const res = await pushV2Lote(call, [{ tinyId: '600', descricaoHtml: '<p>nova</p>' }], DEV);
  check('E: uma alteração', alteracoes(chamadas).length, 1);
  check('E: alterar do simples sem Developer-Id', alteracoes(chamadas)[0].headers, undefined);
  check('E: sem variacoes no payload do simples', 'variacoes' in payloadDe(alteracoes(chamadas)[0]), false);
  check('E: passo do simples', [res[0].ok, res[0].steps.descricao], [true, 'ok']);
}

// F. Pai que não está como "com variações".
{
  const { call, chamadas } = tinyFalso({ ...registrosCobertor, '500': { ...paiTiny, classe_produto: 'S' } });
  const res = await pushV2Lote(call, [{ tinyId: '501', urlImagem: 'https://img/rosa.jpg' }], DEV);
  check('F: nenhuma alteração', alteracoes(chamadas).length, 0);
  check('F: erro de pai sem variações', [res[0].ok, res[0].steps.imagens], [false, PASSO_PAI_SEM_VARIACOES]);
}

// G. Variação sem idProdutoPai.
{
  const { call } = tinyFalso({ ...registrosCobertor, '501': varTiny('501', { idProdutoPai: undefined }) });
  const res = await pushV2Lote(call, [{ tinyId: '501', urlImagem: 'https://img/rosa.jpg' }], DEV);
  check('G: variação sem pai', [res[0].ok, res[0].steps.imagens], [false, PASSO_SEM_PAI]);
}

// H. Falha do alterar chega ao pai e à variante.
{
  const { call } = tinyFalso(registrosCobertor, { falharAlterar: true });
  const res = await pushV2Lote(call, [
    { tinyId: '500', descricaoHtml: '<p>descrição nova do pai</p>' },
    { tinyId: '501', urlImagem: 'https://img/rosa.jpg' },
  ], DEV);
  check('H: pai e variante falham', res.map((r) => r.ok), [false, false]);
  checkMatch('H: mensagem real do Tiny', res[1].steps.imagens, /cod 31/);
}

// I. Item sem ID e item repetido sempre têm resultado.
{
  const { call } = tinyFalso(registrosCobertor);
  const res = await pushV2Lote(call, [
    { tinyId: '' },
    { tinyId: '600', descricaoHtml: '<p>nova</p>' },
    { tinyId: '600', descricaoHtml: '<p>nova</p>' },
  ], { sobrescreverTitulo: true });
  check('I: sem ID Tiny', [res[0].ok, res[0].steps.titulo], [false, 'Sem ID Tiny']);
  check('I: todo item tem resultado', res.length === 3 && res.every(Boolean), true);
}
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx tsx scripts/verify-tiny-push.mjs`
Expected: `SyntaxError` dizendo que `../server/tinyV2.ts` não exporta `pushV2Lote`.

- [ ] **Step 3: Cabeçalhos extras em `tinyV2CallRaw` / `tinyV2Call`**

Em `server/tinyV2.ts`:

Trocar a assinatura

```ts
export async function tinyV2CallRaw(token: string, endpoint: string, params: Record<string, string>, attempt = 0): Promise<any> {
```

por

```ts
// `headers` carries extras such as Developer-Id, which produto.obter/alterar need
// to read and write mapeamentos.
export async function tinyV2CallRaw(token: string, endpoint: string, params: Record<string, string>, attempt = 0, headers: Record<string, string> = {}): Promise<any> {
```

Trocar

```ts
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
```

por

```ts
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
```

Nas **três** chamadas recursivas, trocar `tinyV2CallRaw(token, endpoint, params, attempt + 1)` por `tinyV2CallRaw(token, endpoint, params, attempt + 1, headers)`:
- dentro do `catch` da rede;
- no retry de 429/5xx;
- no retry de rate limit dentro de `retorno`.

Trocar a função `tinyV2Call` inteira por:

```ts
export async function tinyV2Call(uid: string, endpoint: string, params: Record<string, string>, headers?: Record<string, string>): Promise<any> {
  const token = await getV2Token(uid);
  if (!token) throw Object.assign(new Error('Tiny (v2) não conectado.'), { status: 401 });
  return tinyV2CallRaw(token, endpoint, params, 0, headers);
}
```

- [ ] **Step 4: Implementar `pushV2Lote`**

Em `server/tinyV2.ts`, trocar o import

```ts
import { SECRET_REF, sleep, NOME_MAX, type TinyNormalizedProduct, type TinyPushProduct, type TinyPushSteps } from './tinyAgent';
```

por

```ts
import { SECRET_REF, sleep, NOME_MAX, type TinyNormalizedProduct, type TinyPushProduct, type TinyPushResult, type TinyPushSteps } from './tinyAgent';
import {
  buildV2VariacoesPayload, PASSO_PERTENCE_AO_PAI, PASSO_SEM_PAI, PASSO_PAI_SEM_VARIACOES, PASSO_SEM_DEVELOPER_ID,
  type VariacoesPayload,
} from './tinyV2Variacoes';
```

No fim de `server/tinyV2.ts`, adicionar:

```ts
export type V2Caller = (endpoint: string, params: Record<string, string>, headers?: Record<string, string>) => Promise<any>;

const passosIguais = (msg: string): TinyPushSteps => ({ titulo: msg, descricao: msg, seo: msg, imagens: msg });
const passosDeVariante = (imagens: string): TinyPushSteps => ({
  titulo: PASSO_PERTENCE_AO_PAI, descricao: PASSO_PERTENCE_AO_PAI, seo: PASSO_PERTENCE_AO_PAI, imagens,
});

// Sends a batch to Tiny v2. Normal products and parents follow the usual text
// path. Variações (tipoVariacao "V") are grouped by idProdutoPai and only write
// the urlImagem of their mapeamento, in ONE produto.alterar per parent with the
// Developer-Id header: in Tiny, nome/descrição/SEO belong to the parent and a
// variação only exists inside the parent's variacoes[]. `call` is injected so the
// whole flow is verified without network (scripts/verify-tiny-push.mjs). Returns
// one result per input item, in input order.
export async function pushV2Lote(
  call: V2Caller,
  produtos: TinyPushProduct[],
  opts: { sobrescreverTitulo: boolean; developerId?: string },
): Promise<TinyPushResult[]> {
  const resultados: (TinyPushResult | undefined)[] = new Array(produtos.length).fill(undefined);
  const grupos = new Map<string, { texto?: number; variantes: number[] }>();
  const atuais = new Map<string, any>();
  const grupo = (id: string) => {
    if (!grupos.has(id)) grupos.set(id, { variantes: [] });
    return grupos.get(id)!;
  };
  const resultado = (i: number, ok: boolean, steps: TinyPushSteps, enviado: PushLogEntry[] = []) => {
    resultados[i] = { tinyId: produtos[i].tinyId, sku: produtos[i].sku, ok, steps, ...(ok ? { enviado } : {}) };
  };

  // 1. Read every item; Tiny's tipoVariacao decides the path.
  for (let i = 0; i < produtos.length; i++) {
    const prod = produtos[i];
    if (!prod.tinyId) { resultado(i, false, passosIguais('Sem ID Tiny')); continue; }
    try {
      const atual = (await call('produto.obter.php', { id: String(prod.tinyId) }))?.produto ?? {};
      if (atual?.tipoVariacao === 'V') {
        const paiId = atual?.idProdutoPai ? String(atual.idProdutoPai) : '';
        if (!paiId) { resultado(i, false, passosDeVariante(PASSO_SEM_PAI)); continue; }
        grupo(paiId).variantes.push(i);
      } else {
        grupo(String(prod.tinyId)).texto = i;
        atuais.set(String(prod.tinyId), atual);
      }
    } catch (e: any) {
      resultado(i, false, passosIguais(e?.message ?? 'erro'));
    }
  }

  // 2. One produto.alterar per group.
  for (const [paiId, g] of grupos) {
    const indices = [...(g.texto !== undefined ? [g.texto] : []), ...g.variantes];
    try {
      let paiAtual = atuais.get(paiId);
      let headers: Record<string, string> | undefined;
      let vp: VariacoesPayload | undefined;

      if (g.variantes.length) {
        if (!opts.developerId) {
          g.variantes.forEach((i) => resultado(i, true, passosDeVariante(PASSO_SEM_DEVELOPER_ID)));
        } else {
          headers = { 'Developer-Id': opts.developerId };
          paiAtual = (await call('produto.obter.php', { id: paiId }, headers))?.produto ?? {};
          if (String(paiAtual?.classe_produto ?? '') !== 'V') {
            g.variantes.forEach((i) => resultado(i, false, passosDeVariante(PASSO_PAI_SEM_VARIACOES)));
          } else {
            vp = buildV2VariacoesPayload(paiAtual, g.variantes.map((i) => ({
              tinyId: String(produtos[i].tinyId), urlImagem: produtos[i].urlImagem,
            })));
          }
        }
      }

      const temMapeamento = !!vp?.temMapeamento;
      if (paiAtual && (g.texto !== undefined || temMapeamento)) {
        const texto: TinyPushProduct = g.texto !== undefined ? produtos[g.texto] : { tinyId: paiId };
        const { produto, steps, enviado, hasAnyChange } = buildV2AlterarPayload(paiAtual, texto, opts.sobrescreverTitulo);
        if (temMapeamento) produto.variacoes = vp!.variacoes;
        if (hasAnyChange || temMapeamento) {
          const payload = JSON.stringify({ produtos: [{ produto }] });
          console.log(`[tiny-v2] produto.alterar id=${paiId} payload=${payload.slice(0, 1500)}`);
          if (temMapeamento) console.log(`[tiny-v2] produto.alterar id=${paiId} variacoes=${JSON.stringify(produto.variacoes).slice(0, 1500)}`);
          await call('produto.alterar.php', { produto: payload }, temMapeamento ? headers : undefined);
        }
        if (g.texto !== undefined) resultado(g.texto, true, steps, hasAnyChange ? enviado : []);
      }

      if (vp) {
        for (const i of g.variantes) {
          const id = String(produtos[i].tinyId);
          const passo = vp.passoImagem[id];
          resultado(i, true, passosDeVariante(passo), passo === 'ok' ? vp.enviado[id] : []);
        }
      }
    } catch (e: any) {
      const msg = e?.message ?? 'erro';
      indices.filter((i) => resultados[i] === undefined).forEach((i) => resultado(i, false, passosIguais(msg)));
    }
  }

  // A tinyId repeated in the batch overwrites its group slot; never leave a hole.
  for (let i = 0; i < produtos.length; i++) {
    if (!resultados[i]) resultado(i, false, passosIguais('produto repetido no envio'));
  }
  return resultados as TinyPushResult[];
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx tsx scripts/verify-tiny-push.mjs`
Expected: termina com `Tudo certo.`

- [ ] **Step 6: Ligar a rota**

Em `server/tinyProvider.ts`, trocar

```ts
import { listV2Page, getV2Product, updateV2Product, validateV2Token } from './tinyV2';
```

por

```ts
import { listV2Page, getV2Product, updateV2Product, validateV2Token, pushV2Lote, tinyV2Call, type V2Caller } from './tinyV2';
```

Na rota `app.post('/api/tiny/push', …)`, logo depois do bloco `if (produtos.length > MAX_PUSH_BATCH) { … }` e antes de `const resultados: TinyPushResult[] = [];`, inserir:

```ts
      // v2 groups variações under their parent (see pushV2Lote). v3 keeps the
      // per-product loop below.
      if (version === 'v2') {
        const call: V2Caller = (endpoint, params, headers) => tinyV2Call(uid, endpoint, params, headers);
        const resultados = await pushV2Lote(call, produtos, {
          sobrescreverTitulo,
          developerId: process.env.TINY_DEVELOPER_ID || undefined,
        });
        return res.json({ resultados });
      }
```

- [ ] **Step 7: Documentar a variável**

Em `.env.example`, logo depois da linha `TINY_PACE_MS=`, adicionar:

```
# TINY_DEVELOPER_ID: Developer-Id do app parceiro no Tiny (API v2). Sem ele o
# produto.alterar ignora `mapeamentos`, então o push de variantes não grava a
# imagem (urlImagem) e avisa "Developer-Id do Tiny não configurado". Secreto —
# só no servidor; em produção vem do Secret Manager (tiny-developer-id).
TINY_DEVELOPER_ID=
```

- [ ] **Step 8: Checar tipos e verificação**

Run: `npm run lint`
Expected: só os 3 erros pré-existentes.

Run: `npx tsx scripts/verify-tiny-push.mjs`
Expected: `Tudo certo.`

- [ ] **Step 9: Commit**

```bash
git add server/tinyV2.ts server/tinyProvider.ts .env.example scripts/verify-tiny-push.mjs
git commit -m "feat(tiny): push v2 agrupa variações pelo pai e grava urlImagem com Developer-Id

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Documentação, configuração de produção e script de diagnóstico

**Files:**
- Modify: `CLAUDE.md` (lista de invariantes do Tiny, depois do item 4)
- Modify: `apphosting.yaml` (depois do bloco `TINY_CLIENT_SECRET`)
- Create: `scripts/diag-tiny-variacoes.mjs`

**Interfaces:**
- Consumes: nomes de Tasks 1–5 (`pushV2Lote`, `buildV2VariacoesPayload`, `urlImagemPropria`, `TINY_DEVELOPER_ID`).
- Produces: `scripts/diag-tiny-variacoes.mjs <idPai>` — JSON estável do pai e de cada variação, usado na Task 7.

- [ ] **Step 1: `CLAUDE.md`**

Na seção do Tiny, logo depois do parágrafo que começa com `  4. **v2 \`produto.alterar.php\` reports the real reason in`, adicionar:

```markdown
  5. **Variação só grava a imagem, e sempre pelo pai.** No Tiny, nome/descrição/SEO de uma variação pertencem ao pai, e a imagem própria dela só existe no mapeamento com o e-commerce (`variacoes[].variacao.mapeamentos[].mapeamento.urlImagem`). `pushV2Lote` (`server/tinyV2.ts`) lê cada item; o que vier com `tipoVariacao = V` é agrupado por `idProdutoPai` e vira **um** `produto.alterar` no pai com o cabeçalho `Developer-Id` (`TINY_DEVELOPER_ID`; sem ele `mapeamentos` é ignorado e nada de variante é gravado). O payload leva **todas** as variações do pai e `mapeamentos` só nas do lote, copiados do `obter` com o `urlImagem` trocado (`buildV2VariacoesPayload`, `server/tinyV2Variacoes.ts`). Nunca mandar `mapeamentos: []` — apaga os vínculos. A imagem vem de `urlImagemPropria` (`src/services/tinyVariantImage.ts`): variante sem imagem própria fica sem imagem, e imagem igual à principal do pai conta como herdada (`handleSaveImages` não propaga mais imagem para as variantes). Como esse push escreve no registro inteiro do pai, `descricao_complementar` também é ecoada do Tiny. No webhook, o título da variante é `{nome do pai} - {valores da grade unidos por " / "}` e `Variações` usa `||`.
```

- [ ] **Step 2: `apphosting.yaml`**

Logo depois de:

```yaml
  - variable: TINY_CLIENT_SECRET
    secret: tiny-client-secret
```

adicionar:

```yaml
  # Developer-Id do app parceiro no Tiny (API v2): habilita gravar mapeamentos
  # (urlImagem das variações). Valor no Secret Manager (tiny-developer-id).
  - variable: TINY_DEVELOPER_ID
    secret: tiny-developer-id
```

**Não fazer merge para `main` antes de o secret existir** — o App Hosting falha o build quando um `secret:` referenciado não existe. Criar o secret é tarefa do usuário (Task 7, Step 1).

- [ ] **Step 3: Criar `scripts/diag-tiny-variacoes.mjs`**

```js
// Diagnóstico SÓ DE LEITURA (produto.obter.php) de um produto com variações no
// Tiny v2. Imprime o pai e cada variação num JSON estável, para comparar antes e
// depois de um push:
//   TINY_TOKEN=... TINY_DEVELOPER_ID=... node scripts/diag-tiny-variacoes.mjs 911205510 > antes.json
//   (push)
//   TINY_TOKEN=... TINY_DEVELOPER_ID=... node scripts/diag-tiny-variacoes.mjs 911205510 > depois.json
//   diff antes.json depois.json
// Com TINY_DEVELOPER_ID o obter também devolve os mapeamentos das variações.
const [idPai] = process.argv.slice(2);
const token = process.env.TINY_TOKEN;
const developerId = process.env.TINY_DEVELOPER_ID;
if (!token || !idPai) {
  console.error('Uso: TINY_TOKEN=... [TINY_DEVELOPER_ID=...] node scripts/diag-tiny-variacoes.mjs <idPai>');
  process.exit(1);
}

async function obter(id) {
  const res = await fetch('https://api.tiny.com.br/api2/produto.obter.php', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(developerId ? { 'Developer-Id': developerId } : {}),
    },
    body: new URLSearchParams({ token, formato: 'json', id }),
  });
  const json = await res.json();
  if (json?.retorno?.status !== 'OK') throw new Error(`obter ${id}: ${JSON.stringify(json?.retorno)}`);
  return json.retorno.produto;
}

const pai = await obter(idPai);
const { variacoes = [], ...restoDoPai } = pai;
const saida = { pai: restoDoPai, variacoes: [] };
for (const item of variacoes) {
  const naListaDoPai = item?.variacao ?? item;
  // Respeita o limite por minuto do Tiny no plano base (~60 req/min).
  await new Promise((r) => setTimeout(r, 1100));
  saida.variacoes.push({ naListaDoPai, registro: await obter(String(naListaDoPai.id)) });
}
console.log(JSON.stringify(saida, null, 2));
```

- [ ] **Step 4: Checar**

Run: `node --check scripts/diag-tiny-variacoes.mjs && npm run lint`
Expected: `node --check` sem saída; lint só com os 3 erros pré-existentes.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md apphosting.yaml scripts/diag-tiny-variacoes.mjs
git commit -m "docs(tiny): regra de variantes, secret do Developer-Id e diagnóstico de variações

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Teste real no Tiny (manual, com OK explícito do usuário)

Esta tarefa **escreve no ERP do cliente**. Não executar nenhum passo que grave no Tiny sem o OK explícito do usuário nesta sessão. Um subagente não executa esta tarefa: ela é conduzida com o usuário.

**Files:** nenhum.

**Interfaces:**
- Consumes: `scripts/diag-tiny-variacoes.mjs` (Task 6); rota `/api/tiny/push` (Task 5); título/imagem (Tasks 1–2).

- [ ] **Step 1: Configuração (usuário)**

Pedir ao usuário:
1. Adicionar `TINY_DEVELOPER_ID=<valor>` ao `.env` local (arquivo ignorado pelo git — nunca a um arquivo versionado).
2. Criar o secret de produção: `! firebase apphosting:secrets:set tiny-developer-id` (interativo; pede o valor e concede acesso ao backend).

- [ ] **Step 2: Leitura "antes" (só leitura)**

O usuário roda, com o token da conta:

```bash
! TINY_TOKEN=<token> TINY_DEVELOPER_ID=<valor> node scripts/diag-tiny-variacoes.mjs 911205510 > /tmp/tiny-antes.json
```

Conferir que `variacoes[].naListaDoPai.mapeamentos` vem preenchido. Se vier vazio, parar: sem mapeamento não há o que gravar, e o teste precisa de outro produto.

- [ ] **Step 3: Push de uma variante**

Com `npm run dev` rodando e o OK do usuário: no catálogo, expandir o Cobertor Manta Bebê Colibri Jolitex, garantir que **uma** variante tem imagem própria (diferente da do pai), marcar só ela e enviar ao Tiny. No painel de envio, esperar:
- `titulo`/`descricao`/`seo`: `no Tiny este campo pertence ao produto pai`;
- `imagens`: `ok`, com o log `URL da imagem (mapeamento)` mostrando a URL da variante.

- [ ] **Step 4: Leitura "depois" e comparação**

```bash
! TINY_TOKEN=<token> TINY_DEVELOPER_ID=<valor> node scripts/diag-tiny-variacoes.mjs 911205510 > /tmp/tiny-depois.json && diff /tmp/tiny-antes.json /tmp/tiny-depois.json
```

Expected: nenhuma diferença em `pai` (nome, `descricao_complementar`, pesos, dimensões, SEO) nem em `codigo`/`preco`/`grade`/`mapeamentos` das variações. Diferenças aceitáveis só em campos de data de alteração.

- [ ] **Step 5: Conferência visual no Tiny (usuário)**

1. Tela de mapeamentos da integração: a variante enviada mostra a imagem própria; as outras variações não mudaram.
2. `urlProduto` do mapeamento da variante continua preenchido (ele fica fora do payload — ponto não documentado).
3. Preço promocional das variações continua igual (o `obter` não devolve esse campo — ponto não documentado).

- [ ] **Step 6: Decisão**

- Tudo conforme → seguir para `superpowers:finishing-a-development-branch` (merge só depois de o secret `tiny-developer-id` existir).
- Qualquer diferença inesperada no Step 4 ou no Step 5 → parar, registrar o que mudou e voltar ao design antes de liberar. Nada de merge.
