# Alfred que se monta — Fundação (fases 1–3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Contas novas nascem no shell do Alfred, escolhem um ou mais objetivos (Produto, Mercado Livre, Conteúdo) numa Tela 0 nova, aderem aos módulos pelo servidor com crédito de missão, e o Alfred passa a mostrar o que ainda pode ser montado em vez de esconder.

**Architecture:** Uma função pura, `montarAlfred` (`src/modules/agent/capacidades.ts`), deriva o estado de cada peça a partir de objetivos, módulos, conexões e marcos; Ferramentas, Fontes e a Semana leem dela. A adesão é uma rota só (`POST /api/onboarding/aderir`) que, numa transação, cria `users/{uid}/adesoes/{objetivo}` com `create()`, liga os módulos, acrescenta o objetivo e concede o crédito de missão uma única vez. A coorte nova `missao-v2` ganha `modules.produtos` na criação, o que basta para o shell do Alfred e o provider `produtos`.

**Tech Stack:** React 19 + TypeScript (Vite), Express (`tsx`), Firebase Auth/Firestore (Admin SDK no servidor), Tailwind v4 com tokens `--ag-*`. Testes são scripts puros `npx tsx scripts/verify-*.mjs` (o projeto não tem framework de teste).

**Spec:** `docs/superpowers/specs/2026-10-02-alfred-que-se-monta-design.md` (visual: <https://claude.ai/artifact/1PPnm2XHBtBJ5QwZ3DSdS9>)

**Fora deste plano:** a Missão Mercado Livre como trilha de `missionSteps.ts` (fase 4 — plano próprio; aqui escolher Mercado Livre adere e abre a tela do otimizador que já existe), a oferta de automático por confiança e as pontes entre peças (fase 5 — plano próprio), e a migração da base (fase 6).

## Global Constraints

- Coorte nova: `cohort: 'missao-v2'`, gravada só na criação da conta. Contas `missao-v1` e sem coorte **não mudam de comportamento**.
- Objetivos: exatamente `'produto' | 'meli' | 'conteudo'`. Wake **não** é objetivo.
- Módulos por objetivo: `produto → modules.produtos`; `meli → modules.meliListingOptimizer`; `conteudo → modules.contentAgent + modules.blog`.
- Crédito de missão: padrão `produto: 10`, `meli: 20`, `conteudo: 15`; sobrescrito por `config/credits.missao.{objetivo}` quando for inteiro entre 0 e 200. Concedido **só no servidor**, uma vez por objetivo, com `credit_logs` (`type: 'bonus'`, `actionKey: 'missao_bonus_{objetivo}'`).
- O cliente nunca grava `modules.meliListingOptimizer`, `credits` para cima nem `users/{uid}/adesoes` (as regras já impedem os dois primeiros; `adesoes` fica sem regra = negado).
- Uma missão por sessão: a Tela 0 aceita vários objetivos, abre só o primeiro.
- Toda cor nova nas telas do agente vem de token `--ag-*`; nada de `divide-*`; borda sempre com `borderColor` explícito (regra do CLAUDE.md).
- Todo texto de UI em pt-BR.
- `npm run lint` não pode ganhar erro novo em relação à linha de base medida no Task 1 (há erros pré-existentes em `App.tsx`/`ProductEditModal.tsx`).

## Review Focus

1. **Duplo toque em "Começar" ou duas abas abertas** — o crédito de missão entra uma vez só e a segunda chamada responde sem erro. Coberto em Task 2 (`planejarAdesao` com objetivo já aderido) e no `create()` dentro da transação (Task 3).
2. **Corpo malformado vindo do navegador** (`objetivos` vazio, repetido, com valor desconhecido, ou não-array) — 422 com mensagem em pt-BR; repetidos são colapsados, não cobrados duas vezes. Task 2.
3. **`config/credits.missao` com lixo** (negativo, string, 10 000) — cai no padrão, nunca concede valor absurdo. Task 2.
4. **Conta legada (`missao-v1` ou sem coorte)** — não vê a Tela 0 nova, não ganha `modules.produtos`, não muda de shell. Task 5 (`isCoorteObjetivos`) e Task 1 (`temAlfred` só com flags reais).
5. **Peça "para montar" brigando com a missão aberta** — enquanto houver missão `agora`, a Semana não oferece peça nova; e Fontes não mostra Mercado Livre como "disponível" enquanto o status do ML ainda está carregando para quem já tem o módulo. Tasks 7 e 8.

---

## File Structure

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `src/modules/agent/capacidades.ts` | criar | Tipos `Objetivo`/`Peca`, `temAlfred`, `modulosDoObjetivo`, `montarAlfred`, `proximaPecaParaMontar`. Puro. |
| `scripts/verify-capacidades.mjs` | criar | Verificação de `capacidades.ts`. |
| `server/adesaoRules.ts` | criar | `validarPedidoAdesao`, `bonusDaMissao`, `planejarAdesao`, `TEXTO_ADESAO`. Puro. |
| `scripts/verify-adesao.mjs` | criar | Verificação de `adesaoRules.ts`. |
| `server/onboardingAgent.ts` | modificar | Rota `POST /api/onboarding/aderir`. |
| `src/services/onboardingService.ts` | modificar | `aderirObjetivos(objetivos)`. |
| `server/agent/connections.ts` | modificar | `produtos` e `requireAnyModule` via `temAlfred`. |
| `src/modules/onboarding/mission/missionTypes.ts` | modificar | `missao-v2`, `isCoorteObjetivos`. |
| `src/App.tsx` | modificar | `hasProdutosModule`, `objetivos`, `temAgente` único, criação da conta, Tela 0 nova, aterrissagem, adesão em Fontes/Semana/Ferramentas. |
| `src/modules/onboarding/mission/trilha.ts` | modificar | Trilha por objetivos (item `meli`). |
| `scripts/verify-trilha.mjs` | modificar | Casos com `objetivos`. |
| `src/modules/agent/semana.ts` | modificar | `MissaoSemana` com `meli`; tarefa "montar" (`destino: 'montar'`). |
| `src/modules/agent/useSemana.ts` | modificar | `ExtrasSemana.pecaParaMontar`. |
| `scripts/verify-semana.mjs` | modificar | Casos da peça para montar. |
| `src/modules/agent/conectores.ts` | modificar | ML/Conteúdo sem módulo entram como "disponível". |
| `scripts/verify-conectores.mjs` | modificar | Novo comportamento sem módulo. |
| `src/modules/agent/FerramentasScreen.tsx` | modificar | Seção "Para montar". |
| `src/modules/onboarding/mission/objetivos.ts` | criar | Seleção ordenada e textos da Tela 0. Puro. |
| `scripts/verify-objetivos.mjs` | criar | Verificação de `objetivos.ts`. |
| `src/modules/onboarding/mission/ObjetivosPicker.tsx` | criar | Tela 0 com três objetivos. |
| `CLAUDE.md`, spec | modificar | Documentação. |

---

### Task 1: `capacidades.ts` — a regra única das peças

**Files:**
- Create: `src/modules/agent/capacidades.ts`
- Create: `scripts/verify-capacidades.mjs`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `type Objetivo = 'produto' | 'meli' | 'conteudo'`, `const OBJETIVOS: readonly Objetivo[]`
  - `type PecaId = 'produtos' | 'meli' | 'conteudo' | 'erp' | 'video'`
  - `type EstadoPeca = 'oculta' | 'disponivel' | 'ativa' | 'conectada' | 'com-resultado'`
  - `interface ModulosConta { produtos?: boolean; contentAgent?: boolean; operationsAgent?: boolean; blog?: boolean; meliListingOptimizer?: boolean; video?: boolean }`
  - `interface ContaAlfred { objetivos: Objetivo[]; modules: ModulosConta; conexoes: { erp: boolean; meli: boolean; site: boolean }; marcos: { produtos: number; produtosComDescricao: number; propostaPublicada?: boolean; artigoNoBlog?: boolean; envioErp?: boolean; videoGerado?: boolean } }`
  - `interface Peca { id: PecaId; estado: EstadoPeca; titulo: string; libera: string; objetivo: Objetivo | null }`
  - `temAlfred(m: ModulosConta): boolean`
  - `modulosDoObjetivo(o: Objetivo): (keyof ModulosConta)[]`
  - `montarAlfred(c: ContaAlfred): Peca[]`
  - `proximaPecaParaMontar(pecas: Peca[], objetivos: Objetivo[]): Peca | null`

- [ ] **Step 1: Medir a linha de base do lint**

Run: `npm run lint 2>&1 | grep -c "error TS"`
Anote o número (esperado: 3, pré-existentes). Todo Task seguinte compara com ele.

- [ ] **Step 2: Escrever o verify que falha**

```js
// scripts/verify-capacidades.mjs
// Regra única das peças do Alfred (src/modules/agent/capacidades.ts).
// Rodar com: npx tsx scripts/verify-capacidades.mjs
import { temAlfred, modulosDoObjetivo, montarAlfred, proximaPecaParaMontar, OBJETIVOS } from '../src/modules/agent/capacidades.ts';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? '  ok' : 'FALHA'}  ${label}${ok ? '' : ` → esperado ${JSON.stringify(expected)}, veio ${JSON.stringify(actual)}`}`);
}

const conta = (over = {}) => ({
  objetivos: [],
  modules: {},
  conexoes: { erp: false, meli: false, site: false },
  marcos: { produtos: 0, produtosComDescricao: 0 },
  ...over,
});
const estados = (c) => Object.fromEntries(montarAlfred(c).map((p) => [p.id, p.estado]));

check('ordem dos objetivos', OBJETIVOS, ['produto', 'meli', 'conteudo']);

// temAlfred: só flags reais ligam o shell.
check('conta sem módulo não tem Alfred', temAlfred({}), false);
check('conta legada com Conteúdo tem Alfred', temAlfred({ contentAgent: true }), true);
check('conta legada com Operacional tem Alfred', temAlfred({ operationsAgent: true }), true);
check('coorte nova (produtos) tem Alfred', temAlfred({ produtos: true }), true);
check('só Mercado Livre não liga o shell', temAlfred({ meliListingOptimizer: true }), false);
check('flag false não conta', temAlfred({ produtos: false, contentAgent: false }), false);

check('módulos do objetivo produto', modulosDoObjetivo('produto'), ['produtos']);
check('módulos do objetivo meli', modulosDoObjetivo('meli'), ['meliListingOptimizer']);
check('módulos do objetivo conteudo', modulosDoObjetivo('conteudo'), ['contentAgent', 'blog']);

check('ordem fixa das peças', montarAlfred(conta()).map((p) => p.id), ['produtos', 'meli', 'conteudo', 'erp', 'video']);
check('conta vazia: módulos disponíveis, ERP e vídeo ocultos', estados(conta()), {
  produtos: 'disponivel', meli: 'disponivel', conteudo: 'disponivel', erp: 'oculta', video: 'oculta',
});

const nova = conta({ modules: { produtos: true } });
check('coorte nova: Produtos ativa', estados(nova).produtos, 'ativa');
check('com produto no catálogo: conectada', estados({ ...nova, marcos: { produtos: 3, produtosComDescricao: 0 } }).produtos, 'conectada');
check('com descrição: com resultado', estados({ ...nova, marcos: { produtos: 3, produtosComDescricao: 1 } }).produtos, 'com-resultado');
check('legado com Operacional também tem Produtos ativa', estados(conta({ modules: { operationsAgent: true } })).produtos, 'ativa');

const ml = conta({ modules: { meliListingOptimizer: true } });
check('ML ligado sem OAuth: ativa', estados(ml).meli, 'ativa');
check('ML conectado', estados({ ...ml, conexoes: { erp: false, meli: true, site: false } }).meli, 'conectada');
check('ML com proposta publicada', estados({ ...ml, conexoes: { erp: false, meli: true, site: false }, marcos: { produtos: 0, produtosComDescricao: 0, propostaPublicada: true } }).meli, 'com-resultado');

const co = conta({ modules: { contentAgent: true, blog: true } });
check('Conteúdo ligado: ativa', estados(co).conteudo, 'ativa');
check('Conteúdo com projeto: conectada', estados({ ...co, conexoes: { erp: false, meli: false, site: true } }).conteudo, 'conectada');

check('ERP aparece depois do 1º produto', estados(conta({ marcos: { produtos: 1, produtosComDescricao: 0 } })).erp, 'disponivel');
check('ERP conectado', estados(conta({ conexoes: { erp: true, meli: false, site: false } })).erp, 'conectada');
check('ERP com envio', estados(conta({ conexoes: { erp: true, meli: false, site: false }, marcos: { produtos: 1, produtosComDescricao: 0, envioErp: true } })).erp, 'com-resultado');
check('vídeo só com o módulo', estados(conta({ modules: { video: true } })).video, 'ativa');

const pecaErp = montarAlfred(conta()).find((p) => p.id === 'erp');
check('ERP não é aderível (é conexão)', pecaErp.objetivo, null);
check('peça ML adere pelo objetivo meli', montarAlfred(conta()).find((p) => p.id === 'meli').objetivo, 'meli');

// Próxima peça: só disponível e aderível; os objetivos marcados vêm antes.
const pecasNova = montarAlfred(nova);
check('próxima peça segue a ordem fixa sem objetivo', proximaPecaParaMontar(pecasNova, [])?.id, 'meli');
check('objetivo marcado vem primeiro', proximaPecaParaMontar(pecasNova, ['conteudo'])?.id, 'conteudo');
const tudo = montarAlfred(conta({ modules: { produtos: true, meliListingOptimizer: true, contentAgent: true, blog: true } }));
check('tudo montado: nenhuma peça', proximaPecaParaMontar(tudo, []), null);

console.log(failures === 0 ? '\nTudo ok.' : `\n${failures} falha(s).`);
process.exit(failures === 0 ? 0 : 1);
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx tsx scripts/verify-capacidades.mjs`
Expected: erro de import (`Cannot find module '../src/modules/agent/capacidades.ts'`).

- [ ] **Step 4: Implementar**

```ts
// src/modules/agent/capacidades.ts
// As peças do Alfred: o que cada conta tem montado e o que ainda pode montar.
// PURO e usado pelos dois lados (o servidor importa `temAlfred`). Verificar
// com `npx tsx scripts/verify-capacidades.mjs`.
//
// Toda peça passa pelas mesmas camadas — objetivo → módulo → conexão →
// permissão — e o estado é sempre derivado, nunca gravado. Nenhuma tela deve
// voltar a decidir sozinha a partir de um `hasX` solto.

export type Objetivo = 'produto' | 'meli' | 'conteudo';
export const OBJETIVOS: readonly Objetivo[] = ['produto', 'meli', 'conteudo'] as const;

export type PecaId = 'produtos' | 'meli' | 'conteudo' | 'erp' | 'video';
export type EstadoPeca = 'oculta' | 'disponivel' | 'ativa' | 'conectada' | 'com-resultado';

export interface ModulosConta {
  produtos?: boolean;
  contentAgent?: boolean;
  operationsAgent?: boolean;
  blog?: boolean;
  meliListingOptimizer?: boolean;
  video?: boolean;
}

export interface ContaAlfred {
  objetivos: Objetivo[];
  modules: ModulosConta;
  conexoes: { erp: boolean; meli: boolean; site: boolean };
  /** O que a conta já produziu. Ausente = não sabemos = não conta. */
  marcos: {
    produtos: number;
    produtosComDescricao: number;
    propostaPublicada?: boolean;
    artigoNoBlog?: boolean;
    envioErp?: boolean;
    videoGerado?: boolean;
  };
}

export interface Peca {
  id: PecaId;
  estado: EstadoPeca;
  titulo: string;
  /** O que a peça dá ao Alfred — "Libera: …" quando disponível. */
  libera: string;
  /** Objetivo que monta a peça pela adesão. null = é conexão, não módulo. */
  objetivo: Objetivo | null;
}

/** O shell do Alfred e o provider `produtos`: qualquer módulo de agente ligado. */
export function temAlfred(m: ModulosConta): boolean {
  return m.produtos === true || m.contentAgent === true || m.operationsAgent === true;
}

export function modulosDoObjetivo(o: Objetivo): (keyof ModulosConta)[] {
  if (o === 'produto') return ['produtos'];
  if (o === 'meli') return ['meliListingOptimizer'];
  return ['contentAgent', 'blog'];
}

const escada = (ativa: boolean, conectada: boolean, resultado: boolean, semModulo: EstadoPeca): EstadoPeca =>
  !ativa ? semModulo : resultado ? 'com-resultado' : conectada ? 'conectada' : 'ativa';

export function montarAlfred(c: ContaAlfred): Peca[] {
  const m = c.modules;
  return [
    {
      id: 'produtos', titulo: 'Produtos', libera: 'descrições, atributos e imagens', objetivo: 'produto',
      estado: escada(temAlfred(m), c.marcos.produtos > 0, c.marcos.produtosComDescricao > 0, 'disponivel'),
    },
    {
      id: 'meli', titulo: 'Mercado Livre', libera: 'títulos, fichas e fotos dos anúncios', objetivo: 'meli',
      estado: escada(m.meliListingOptimizer === true, c.conexoes.meli, c.marcos.propostaPublicada === true, 'disponivel'),
    },
    {
      id: 'conteudo', titulo: 'Conteúdo e blog', libera: 'artigos, calendário e SEO', objetivo: 'conteudo',
      estado: escada(m.contentAgent === true, c.conexoes.site, c.marcos.artigoNoBlog === true, 'disponivel'),
    },
    {
      // Não tem módulo: "ativa" é já ter o que mandar para o ERP.
      id: 'erp', titulo: 'Loja / ERP', libera: 'envio do catálogo para a sua loja', objetivo: null,
      estado: c.conexoes.erp
        ? (c.marcos.envioErp ? 'com-resultado' : 'conectada')
        : c.marcos.produtos > 0 ? 'disponivel' : 'oculta',
    },
    {
      id: 'video', titulo: 'Vídeo', libera: 'vídeos dos seus produtos', objetivo: null,
      // Vídeo não tem passo de conexão: ativa → com-resultado.
      estado: escada(m.video === true, false, c.marcos.videoGerado === true, 'oculta'),
    },
  ];
}

/** A peça que a semana oferece: disponível, aderível, objetivos marcados antes. */
export function proximaPecaParaMontar(pecas: Peca[], objetivos: Objetivo[]): Peca | null {
  const candidatas = pecas.filter((p) => p.estado === 'disponivel' && p.objetivo !== null);
  const marcada = objetivos.map((o) => candidatas.find((p) => p.objetivo === o)).find(Boolean);
  return marcada ?? candidatas[0] ?? null;
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx tsx scripts/verify-capacidades.mjs`
Expected: todas as linhas `ok`, termina com `Tudo ok.`

- [ ] **Step 6: Commit**

```bash
git add src/modules/agent/capacidades.ts scripts/verify-capacidades.mjs
git commit -m "feat(alfred): regra única das peças (capacidades.ts)"
```

---

### Task 2: Regras puras da adesão

**Files:**
- Create: `server/adesaoRules.ts`
- Create: `scripts/verify-adesao.mjs`

**Interfaces:**
- Consumes: `Objetivo`, `OBJETIVOS`, `modulosDoObjetivo` de `src/modules/agent/capacidades.ts` (Task 1).
- Produces:
  - `BONUS_MISSAO_PADRAO: Record<Objetivo, number>`
  - `TEXTO_ADESAO: Record<Objetivo, string>`
  - `validarPedidoAdesao(body: unknown): { ok: true; objetivos: Objetivo[] } | { ok: false; erro: string }`
  - `bonusDaMissao(config: unknown, o: Objetivo): number`
  - `planejarAdesao(p: { pedidos: Objetivo[]; jaAderidos: Objetivo[]; config: unknown }): { novos: Objetivo[]; creditos: number; campos: Record<string, true> }`

- [ ] **Step 1: Escrever o verify que falha**

```js
// scripts/verify-adesao.mjs
// Regras puras da adesão a módulos (server/adesaoRules.ts).
// Rodar com: npx tsx scripts/verify-adesao.mjs
import { validarPedidoAdesao, bonusDaMissao, planejarAdesao, BONUS_MISSAO_PADRAO, TEXTO_ADESAO } from '../server/adesaoRules.ts';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? '  ok' : 'FALHA'}  ${label}${ok ? '' : ` → esperado ${JSON.stringify(expected)}, veio ${JSON.stringify(actual)}`}`);
}

check('padrões do crédito de missão', BONUS_MISSAO_PADRAO, { produto: 10, meli: 20, conteudo: 15 });
check('todo objetivo tem texto de aceite', Object.keys(TEXTO_ADESAO).sort(), ['conteudo', 'meli', 'produto']);

// Pedido vindo do navegador.
check('pedido válido mantém a ordem', validarPedidoAdesao({ objetivos: ['meli', 'produto'] }), { ok: true, objetivos: ['meli', 'produto'] });
check('repetido é colapsado', validarPedidoAdesao({ objetivos: ['meli', 'meli', 'produto'] }), { ok: true, objetivos: ['meli', 'produto'] });
check('vazio é recusado', validarPedidoAdesao({ objetivos: [] }).ok, false);
check('sem corpo é recusado', validarPedidoAdesao(null).ok, false);
check('não-array é recusado', validarPedidoAdesao({ objetivos: 'meli' }).ok, false);
check('objetivo desconhecido é recusado', validarPedidoAdesao({ objetivos: ['wake'] }).ok, false);
check('mensagem em pt-BR', validarPedidoAdesao({ objetivos: ['wake'] }).erro, 'Objetivo desconhecido: wake');

// Valor do crédito: config/credits.missao, com teto.
check('sem config usa o padrão', bonusDaMissao(undefined, 'meli'), 20);
check('config válida vence', bonusDaMissao({ missao: { meli: 35 } }, 'meli'), 35);
check('zero é válido (desliga o bônus)', bonusDaMissao({ missao: { meli: 0 } }, 'meli'), 0);
check('negativo cai no padrão', bonusDaMissao({ missao: { meli: -5 } }, 'meli'), 20);
check('string cai no padrão', bonusDaMissao({ missao: { meli: '50' } }, 'meli'), 20);
check('acima de 200 cai no padrão', bonusDaMissao({ missao: { meli: 10000 } }, 'meli'), 20);
check('fracionário cai no padrão', bonusDaMissao({ missao: { meli: 2.5 } }, 'meli'), 20);

// Planejamento: o que é novo paga, o que já foi aderido só religa.
const p1 = planejarAdesao({ pedidos: ['meli', 'produto'], jaAderidos: [], config: undefined });
check('dois novos: soma dos créditos', p1.creditos, 30);
check('dois novos: ambos novos', p1.novos, ['meli', 'produto']);
check('campos de módulo', p1.campos, { 'modules.meliListingOptimizer': true, 'modules.produtos': true });

const p2 = planejarAdesao({ pedidos: ['meli'], jaAderidos: ['meli'], config: undefined });
check('já aderido não paga de novo', p2.creditos, 0);
check('já aderido não é novo', p2.novos, []);
check('já aderido religa o módulo', p2.campos, { 'modules.meliListingOptimizer': true });

const p3 = planejarAdesao({ pedidos: ['conteudo'], jaAderidos: [], config: { missao: { conteudo: 40 } } });
check('conteúdo liga dois módulos', p3.campos, { 'modules.contentAgent': true, 'modules.blog': true });
check('conteúdo com config', p3.creditos, 40);

console.log(failures === 0 ? '\nTudo ok.' : `\n${failures} falha(s).`);
process.exit(failures === 0 ? 0 : 1);
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx tsx scripts/verify-adesao.mjs`
Expected: erro de import de `server/adesaoRules.ts`.

- [ ] **Step 3: Implementar**

```ts
// server/adesaoRules.ts
// Regras puras da adesão a módulos (sem I/O). A rota POST /api/onboarding/aderir
// em onboardingAgent.ts só faz a transação em volta disto.
//
// Adesão é livre: aceitou o objetivo, o módulo liga. Cada objetivo paga o
// crédito de missão uma única vez — quem decide "uma vez" é o create() do doc
// users/{uid}/adesoes/{objetivo}; aqui só se calcula o que pagar.

import { OBJETIVOS, modulosDoObjetivo, type Objetivo } from '../src/modules/agent/capacidades';

export const BONUS_MISSAO_PADRAO: Record<Objetivo, number> = { produto: 10, meli: 20, conteudo: 15 };
const BONUS_MAXIMO = 200;

/** Texto gravado com o aceite — o mesmo mostrado na Tela 0 e no "Montar". */
export const TEXTO_ADESAO: Record<Objetivo, string> = {
  produto: 'Ativar o Agente de Produto para melhorar as descrições do meu catálogo.',
  meli: 'Ativar o Agente Mercado Livre para otimizar os meus anúncios.',
  conteudo: 'Ativar o Agente de Conteúdo para montar e escrever o meu blog.',
};

export function validarPedidoAdesao(body: unknown): { ok: true; objetivos: Objetivo[] } | { ok: false; erro: string } {
  const raw = (body as { objetivos?: unknown } | null)?.objetivos;
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, erro: 'Escolha ao menos um objetivo' };
  const objetivos: Objetivo[] = [];
  for (const o of raw) {
    if (!(OBJETIVOS as readonly unknown[]).includes(o)) return { ok: false, erro: `Objetivo desconhecido: ${String(o)}` };
    if (!objetivos.includes(o as Objetivo)) objetivos.push(o as Objetivo);
  }
  return { ok: true, objetivos };
}

/** config/credits.missao.{objetivo}, se for inteiro entre 0 e 200; senão o padrão. */
export function bonusDaMissao(config: unknown, o: Objetivo): number {
  const v = (config as { missao?: Record<string, unknown> } | undefined)?.missao?.[o];
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= BONUS_MAXIMO ? v : BONUS_MISSAO_PADRAO[o];
}

export function planejarAdesao(p: { pedidos: Objetivo[]; jaAderidos: Objetivo[]; config: unknown }): {
  novos: Objetivo[];
  creditos: number;
  campos: Record<string, true>;
} {
  const novos = p.pedidos.filter((o) => !p.jaAderidos.includes(o));
  const campos: Record<string, true> = {};
  for (const o of p.pedidos) for (const m of modulosDoObjetivo(o)) campos[`modules.${m}`] = true;
  return { novos, creditos: novos.reduce((s, o) => s + bonusDaMissao(p.config, o), 0), campos };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx tsx scripts/verify-adesao.mjs`
Expected: `Tudo ok.`

- [ ] **Step 5: Commit**

```bash
git add server/adesaoRules.ts scripts/verify-adesao.mjs
git commit -m "feat(onboarding): regras puras da adesão com crédito de missão"
```

---

### Task 3: Rota `POST /api/onboarding/aderir` e cliente

**Files:**
- Modify: `server/onboardingAgent.ts` (dentro de `registerOnboardingRoutes`, depois de `/api/onboarding/mission-contact`)
- Modify: `src/services/onboardingService.ts`
- Modify: `src/App.tsx` (`habilitarConteudo`, ~linha 1918)

**Interfaces:**
- Consumes: `validarPedidoAdesao`, `planejarAdesao`, `bonusDaMissao`, `TEXTO_ADESAO` (Task 2); `Objetivo` (Task 1).
- Produces:
  - Rota `POST /api/onboarding/aderir` com corpo `{ objetivos: Objetivo[] }` → `200 { novos: Objetivo[]; creditsAdded: number }`, `422 { error }`.
  - Cliente: `aderirObjetivos(objetivos: Objetivo[]): Promise<{ novos: Objetivo[]; creditsAdded: number }>`.
  - Doc `users/{uid}/adesoes/{objetivo}`: `{ objetivo, aceitoEm: string (ISO), texto: string, creditos: number }`.
  - Campo `users/{uid}.objetivos: Objetivo[]` (ordem de aceite).

- [ ] **Step 1: Implementar a rota**

Em `server/onboardingAgent.ts`, adicionar ao import do topo:

```ts
import { planejarAdesao, validarPedidoAdesao, bonusDaMissao, TEXTO_ADESAO } from './adesaoRules';
```

E, dentro de `registerOnboardingRoutes`, logo depois do handler de `/api/onboarding/mission-contact`:

```ts
  // Adesão a módulos (coorte missao-v2 e o "Montar" das peças do Alfred).
  // Livre: aceitou, liga. O crédito de missão é pago uma vez por objetivo —
  // o create() de adesoes/{objetivo} dentro da transação é o que garante isso
  // contra duplo clique e duas abas. Objetivo já aderido só religa o módulo.
  app.post('/api/onboarding/aderir', async (req, res) => {
    try {
      const decoded = await verifyFirebaseToken(req);
      const pedido = validarPedidoAdesao(req.body);
      if (pedido.ok === false) throw Object.assign(new Error(pedido.erro), { status: 422 });

      const userRef = adminDb.collection('users').doc(decoded.uid);
      const configRef = adminDb.collection('config').doc('credits');
      const adesaoRef = (o: string) => userRef.collection('adesoes').doc(o);

      const result = await adminDb.runTransaction(async (tx) => {
        // Todas as leituras antes de qualquer escrita.
        const userSnap = await tx.get(userRef);
        if (!userSnap.exists) throw Object.assign(new Error('Usuário não encontrado'), { status: 404 });
        const configSnap = await tx.get(configRef);
        const adesoes = await Promise.all(pedido.objetivos.map((o) => tx.get(adesaoRef(o))));
        const jaAderidos = pedido.objetivos.filter((_, i) => adesoes[i].exists);

        const plano = planejarAdesao({ pedidos: pedido.objetivos, jaAderidos, config: configSnap.data() });
        const agora = new Date().toISOString();

        for (const o of plano.novos) {
          tx.create(adesaoRef(o), { objetivo: o, aceitoEm: agora, texto: TEXTO_ADESAO[o], creditos: bonusDaMissao(configSnap.data(), o) });
        }
        tx.update(userRef, {
          ...plano.campos,
          objetivos: FieldValue.arrayUnion(...pedido.objetivos),
          ...(plano.creditos > 0 ? { credits: FieldValue.increment(plano.creditos) } : {}),
        });
        for (const o of plano.novos) {
          const creditos = bonusDaMissao(configSnap.data(), o);
          if (creditos === 0) continue;
          tx.set(userRef.collection('credit_logs').doc(), {
            type: 'bonus',
            actionType: 'Crédito de missão',
            actionKey: `missao_bonus_${o}`,
            productName: 'N/A',
            sku: 'N/A',
            userName: decoded.name ?? decoded.email ?? '',
            creditsConsumed: 0,
            creditsAdded: creditos,
            timestamp: agora,
          });
        }
        return { novos: plano.novos, creditsAdded: plano.creditos };
      });

      for (const o of result.novos) void recordEvent(decoded.uid, 'module_adopted', { objetivo: o });
      res.json(result);
    } catch (err) {
      sendError(res, err);
    }
  });
```

- [ ] **Step 2: Cliente**

Em `src/services/onboardingService.ts`, ao lado de `enviarContatoMissao`:

```ts
import type { Objetivo } from '../modules/agent/capacidades';

/** Adesão livre: liga os módulos e paga o crédito de missão (uma vez por objetivo). */
export const aderirObjetivos = (objetivos: Objetivo[]) =>
  callJson<{ novos: Objetivo[]; creditsAdded: number }>('/api/onboarding/aderir', 'POST', { objetivos });
```

- [ ] **Step 3: `habilitarConteudo` passa pela rota**

Em `src/App.tsx`, substituir o corpo de `habilitarConteudo`:

```ts
  // Quem inicia a Missão Conteúdo adere ao Conteúdo pelo servidor (liga
  // contentAgent + blog e paga o crédito de missão uma vez) — sem isso o blog
  // criado na missão ficaria inalcançável.
  const habilitarConteudo = async () => {
    if (!user) return;
    await aderirObjetivos(['conteudo']);
  };
```

e importar `aderirObjetivos` de `./services/onboardingService` (o arquivo já importa `enviarContatoMissao` de lá).

- [ ] **Step 4: Lint**

Run: `npm run lint 2>&1 | grep -c "error TS"`
Expected: igual à linha de base do Task 1.

- [ ] **Step 5: Verificação manual (dev server)**

Run: `npm run dev`, entrar com uma conta de teste, e no console do navegador:

```js
const t = await (await import('/src/firebase.ts')).auth.currentUser.getIdToken();
const r = (b) => fetch('/api/onboarding/aderir', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` }, body: JSON.stringify(b) }).then((x) => x.json());
console.log(await r({ objetivos: ['meli'] }));   // { novos: ['meli'], creditsAdded: 20 }
console.log(await r({ objetivos: ['meli'] }));   // { novos: [], creditsAdded: 0 }
console.log(await Promise.all([r({ objetivos: ['produto'] }), r({ objetivos: ['produto'] })])); // só um com creditsAdded 10
console.log(await r({ objetivos: ['wake'] }));   // { error: 'Objetivo desconhecido: wake' }
```

Conferir no Firestore: `users/{uid}.modules.meliListingOptimizer === true`, `objetivos` = `['meli','produto']`, um doc em `adesoes/meli` e `adesoes/produto`, dois `credit_logs` com `actionKey: missao_bonus_*`. Se `callJson` usar outro cabeçalho de auth, copie o que ele usa.

- [ ] **Step 6: Commit**

```bash
git add server/onboardingAgent.ts src/services/onboardingService.ts src/App.tsx
git commit -m "feat(onboarding): adesão livre a módulos com crédito de missão no servidor"
```

---

### Task 4: Servidor reconhece `modules.produtos`

**Files:**
- Modify: `server/agent/connections.ts` (`resolveAgentContext`, `requireAnyModule`)

**Interfaces:**
- Consumes: `temAlfred` (Task 1).
- Produces: contas com só `modules.produtos` recebem o provider `produtos` e passam por `requireAnyModule`.

- [ ] **Step 1: Implementar**

No topo de `server/agent/connections.ts`:

```ts
import { temAlfred } from '../../src/modules/agent/capacidades';
```

Em `resolveAgentContext`, trocar:

```ts
  if (modules.contentAgent === true || modules.operationsAgent === true) providers.push('produtos');
```

por:

```ts
  // O catálogo existe para toda conta com Alfred: contas legadas (Conteúdo ou
  // Operacional) e a coorte missao-v2 (modules.produtos, ligado na criação).
  if (temAlfred(modules)) providers.push('produtos');
```

Em `requireAnyModule`, trocar o `if` por:

```ts
  if (!temAlfred(modules)) {
```

e atualizar o comentário da função para "users/{uid}.modules.produtos, .contentAgent ou .operationsAgent".

- [ ] **Step 2: Verificar**

Run: `npx tsx scripts/verify-capacidades.mjs && npx tsx scripts/verify-agent-tools.mjs`
Expected: `Tudo ok.` nos dois (o segundo confirma que o registry não quebrou).

Run: `npm run lint 2>&1 | grep -c "error TS"` → igual à linha de base.

- [ ] **Step 3: Commit**

```bash
git add server/agent/connections.ts
git commit -m "feat(agent): modules.produtos libera o catálogo e as rotas do Alfred"
```

---

### Task 5: Coorte `missao-v2` nasce no shell do Alfred

**Files:**
- Modify: `src/modules/onboarding/mission/missionTypes.ts`
- Modify: `scripts/verify-mission-steps.mjs` (casos da coorte)
- Modify: `src/App.tsx` (estado, criação da conta, `temAgente`, aterrissagem)

**Interfaces:**
- Consumes: `temAlfred`, `Objetivo` (Task 1).
- Produces:
  - `type MissionCohort = 'missao-v1' | 'missao-v2'`; `COORTE_ATUAL = 'missao-v2'`
  - `isCoorteMissao(c)`: verdadeiro para v1 **e** v2 (tudo que hoje depende da jornada de missão continua valendo)
  - `isCoorteObjetivos(c)`: verdadeiro só para v2
  - Em `App.tsx`: `hasProdutosModule: boolean`, `objetivos: Objetivo[]`, `temAgente: boolean` declarado uma vez, logo depois dos `useState` de módulo.

- [ ] **Step 1: Teste**

No fim de `scripts/verify-mission-steps.mjs`, antes do `console.log` final, acrescentar (e incluir `isCoorteMissao, isCoorteObjetivos, COORTE_ATUAL` no import de `missionTypes.ts`):

```js
check('coorte atual é a v2', COORTE_ATUAL, 'missao-v2');
check('v1 continua na jornada de missão', isCoorteMissao('missao-v1'), true);
check('v2 está na jornada de missão', isCoorteMissao('missao-v2'), true);
check('sem coorte é legado', isCoorteMissao(undefined), false);
check('v1 não vê a Tela 0 de objetivos', isCoorteObjetivos('missao-v1'), false);
check('v2 vê a Tela 0 de objetivos', isCoorteObjetivos('missao-v2'), true);
check('lixo não é coorte', isCoorteObjetivos('missao-v3'), false);
```

Se o script usar outro nome para o helper de asserção, use o dele.

Run: `npx tsx scripts/verify-mission-steps.mjs`
Expected: FALHA (`isCoorteObjetivos` não existe).

- [ ] **Step 2: `missionTypes.ts`**

Substituir o bloco da coorte:

```ts
/** Coorte gravada em users/{uid}.cohort na criação da conta. */
export type MissionCohort = 'missao-v1' | 'missao-v2';
export const COORTE_ATUAL: MissionCohort = 'missao-v2';

/** Jornada de missão (v1 e v2). Ausência de coorte = fluxo legado. */
export function isCoorteMissao(cohort: unknown): boolean {
  return cohort === 'missao-v1' || cohort === 'missao-v2';
}

/** Só a v2: nasce no Alfred e escolhe objetivos na Tela 0 nova. */
export function isCoorteObjetivos(cohort: unknown): boolean {
  return cohort === 'missao-v2';
}
```

Run: `npx tsx scripts/verify-mission-steps.mjs` → `Tudo ok.`

- [ ] **Step 3: Estado e criação da conta em `App.tsx`**

1. Junto de `const [hasOperationsAgent, setHasOperationsAgent] = useState<boolean>(false);` (~linha 310):

```ts
  const [hasProdutosModule, setHasProdutosModule] = useState<boolean>(false);
  const [objetivos, setObjetivos] = useState<Objetivo[]>([]);
  // Uma regra só para "esta conta tem Alfred" (capacidades.ts) — o mesmo
  // temAlfred que o servidor usa para liberar o provider `produtos`.
  const temAgente = temAlfred({ produtos: hasProdutosModule, contentAgent: hasContentAgent, operationsAgent: hasOperationsAgent });
```

Imports: `import { temAlfred, type Objetivo } from './modules/agent/capacidades';` e `isCoorteObjetivos` junto de `COORTE_ATUAL, isCoorteMissao`.

2. No `setDoc` de criação da conta (~linha 592), acrescentar depois de `cohort: COORTE_ATUAL,`:

```ts
              // A coorte nova nasce com o Agente de Produto: é o que liga o
              // shell do Alfred e o provider `produtos` desde o primeiro login.
              modules: { produtos: true },
```

(As regras permitem: `modules` é map e não contém `meliListingOptimizer`.)

3. No `onSnapshot` do usuário, ao lado de `setHasOperationsAgent(...)`:

```ts
              setHasProdutosModule(snap.data().modules?.produtos === true);
              setObjetivos(Array.isArray(snap.data().objetivos) ? snap.data().objetivos : []);
```

4. Apagar a declaração antiga `const temAgente = hasContentAgent || hasOperationsAgent;` (~linha 3251) e trocar **toda** ocorrência de `hasContentAgent || hasOperationsAgent` em `App.tsx` por `temAgente` (são ~14: `usePendentesAlfred`, `useVideosDoAlfred`, `abrirDestino`, `onPedirAlfred`, os blocos do menu, `hasAgente={...}`, `mostrarAgente={...}`). Conferir com:

Run: `grep -n "hasContentAgent || hasOperationsAgent" src/App.tsx`
Expected: nenhuma linha.

- [ ] **Step 4: Aterrissagem da v2 no Alfred**

No efeito de aterrissagem na trilha (~linha 538), trocar o corpo para que a v2 abra na Semana do Alfred e não na trilha antiga:

```ts
  useEffect(() => {
    if (!isCoorteMissao(cohort) || !jornadaConcluida || trilhaAterrissou.current) return;
    trilhaAterrissou.current = true;
    if (mainViewRef.current === 'products') setMainView(isCoorteObjetivos(cohort) ? 'home' : 'missoes');
  }, [cohort, jornadaConcluida]);
```

E, no bloco da jornada de missão (~linha 3405), `aoConcluir`:

```ts
    const aoConcluir = () => { setJornadaConcluida(true); setMainView(isCoorteObjetivos(cohort) ? 'home' : 'missoes'); };
```

- [ ] **Step 5: Lint e verificação manual**

Run: `npm run lint 2>&1 | grep -c "error TS"` → igual à linha de base.

Manual: `npm run dev`, criar conta nova (aba anônima, Google de teste). Esperado: doc do usuário com `cohort: 'missao-v2'` e `modules.produtos: true`; ainda aparece o `MissionPicker` antigo (a Tela 0 nova vem no Task 9). Uma conta antiga (`missao-v1`) segue igual: mesmo shell, mesma trilha.

- [ ] **Step 6: Commit**

```bash
git add src/modules/onboarding/mission/missionTypes.ts scripts/verify-mission-steps.mjs src/App.tsx
git commit -m "feat(onboarding): coorte missao-v2 nasce com o Alfred (modules.produtos)"
```

---

### Task 6: Trilha montada pelos objetivos

**Files:**
- Modify: `src/modules/onboarding/mission/trilha.ts`
- Modify: `scripts/verify-trilha.mjs`
- Modify: `src/modules/agent/semana.ts` (`MissaoSemana`, mapeamento de origem)
- Modify: `src/App.tsx` (`extrasSemana.missoes`, `acaoDaTrilha`)

**Interfaces:**
- Consumes: `Objetivo` (Task 1); `objetivos` em `App.tsx` (Task 5).
- Produces:
  - `ItemId` ganha `'meli'`; `SinalTrilha` ganha `objetivos?: Objetivo[]` e `meliConectado?: boolean`.
  - Sem `objetivos` (v1): trilha idêntica à de hoje.
  - Com `objetivos` (v2): itens de missão só dos objetivos marcados, na ordem marcada, depois `catalogo`, `erp`, `publicar-blog` (só se Conteúdo marcado) e `empresa`.
  - `MissaoSemana` ganha `'meli'`.

- [ ] **Step 1: Teste**

Em `scripts/verify-trilha.mjs`, antes do `console.log` final:

```js
// Coorte v2: a trilha segue os objetivos marcados, na ordem.
const ids = (s) => montarTrilha(s).map((i) => i.id);
check('v1 (sem objetivos) não muda', ids(vazio), ['produto', 'conteudo', 'catalogo', 'erp', 'publicar-blog', 'empresa']);
check('v2 só ML', ids({ ...vazio, objetivos: ['meli'] }), ['meli', 'catalogo', 'erp', 'empresa']);
check('v2 ML depois produto', ids({ ...vazio, objetivos: ['meli', 'produto'] }), ['meli', 'produto', 'catalogo', 'erp', 'empresa']);
check('v2 com conteúdo traz publicar blog', ids({ ...vazio, objetivos: ['conteudo'] }), ['conteudo', 'catalogo', 'erp', 'publicar-blog', 'empresa']);
check('v2 ML conectado fica feito', estados({ ...vazio, objetivos: ['meli'], meliConectado: true }).meli, 'feito');
check('v2 ML sem conexão é agora', estados({ ...vazio, objetivos: ['meli'] }).meli, 'agora');
check('título do item ML', montarTrilha({ ...vazio, objetivos: ['meli'] })[0].titulo, 'Conectar seu Mercado Livre');
```

Run: `npx tsx scripts/verify-trilha.mjs` → FALHA.

- [ ] **Step 2: Implementar em `trilha.ts`**

```ts
import type { MissionId } from './missionTypes';
import type { Objetivo } from '../../agent/capacidades';

export type EstadoItem = 'feito' | 'agora' | 'bloqueado' | 'opcional';
export type ItemId = 'produto' | 'conteudo' | 'meli' | 'catalogo' | 'erp' | 'publicar-blog' | 'empresa';

export interface ItemTrilha { id: ItemId; titulo: string; meta: string; estado: EstadoItem }

export interface SinalTrilha {
  missoes: { missionId: MissionId; concluidaEm?: string; dados: Record<string, unknown> }[];
  produtos: number;
  erpConectado: boolean;
  empresaCompleta: boolean;
  /** Coorte v2: só os objetivos marcados viram missão, na ordem marcada. */
  objetivos?: Objetivo[];
  meliConectado?: boolean;
}

export function montarTrilha(s: SinalTrilha): ItemTrilha[] {
  const concluida = (id: MissionId) => s.missoes.find((m) => m.missionId === id && m.concluidaEm);
  const conteudo = concluida('conteudo');
  const blogPublicado = conteudo?.dados.blogPublicado === true;

  const missao: Record<Objetivo, ItemTrilha> = {
    produto: { id: 'produto', titulo: 'Aprimorar seu primeiro produto', meta: 'Agente de Produto', estado: concluida('produto') ? 'feito' : 'agora' },
    conteudo: { id: 'conteudo', titulo: 'Montar seu blog', meta: 'Agente de Conteúdo', estado: conteudo ? 'feito' : 'agora' },
    // Até a Missão ML existir (fase 4), conectar a conta é a chegada.
    meli: { id: 'meli', titulo: 'Conectar seu Mercado Livre', meta: 'Agente Mercado Livre', estado: s.meliConectado ? 'feito' : 'agora' },
  };
  const resto = (comBlog: boolean): ItemTrilha[] => [
    { id: 'catalogo', titulo: 'Trazer o resto do catálogo', meta: 'cole mais links ou suba a planilha', estado: s.produtos > 1 ? 'feito' : 'agora' },
    { id: 'erp', titulo: 'Conectar seu ERP', meta: 'publica direto na sua loja', estado: s.erpConectado ? 'feito' : 'agora' },
    ...(comBlog ? [{
      id: 'publicar-blog' as const,
      titulo: 'Publicar seu blog',
      meta: conteudo ? 'libera o blog para o Google' : 'libera depois que o blog existir',
      estado: (blogPublicado ? 'feito' : conteudo ? 'agora' : 'bloqueado') as EstadoItem,
    }] : []),
    { id: 'empresa', titulo: 'Completar dados da empresa', meta: 'necessário só para emitir nota', estado: s.empresaCompleta ? 'feito' : 'opcional' },
  ];

  if (!s.objetivos) return [missao.produto, missao.conteudo, ...resto(true)];
  return [...s.objetivos.map((o) => missao[o]), ...resto(s.objetivos.includes('conteudo'))];
}
```

Run: `npx tsx scripts/verify-trilha.mjs` → `Tudo ok.`

- [ ] **Step 3: Semana e App**

1. `src/modules/agent/semana.ts`: `export type MissaoSemana = 'produto' | 'conteudo' | 'meli' | 'catalogo' | 'erp' | 'publicar-blog' | 'empresa';` e, no mapeamento de origem das missões (~linha 321), acrescentar `meli`:

```ts
    origem: m.id === 'meli' ? 'meli'
      : m.id === 'conteudo' || m.id === 'publicar-blog' ? 'conteudo'
        : m.id === 'produto' || m.id === 'catalogo' ? 'produto' : 'operacoes',
```

2. `App.tsx`, `extrasSemana`: nos dois `montarTrilha({...})` (resumo e lista), acrescentar

```ts
        ...(isCoorteObjetivos(cohort) ? { objetivos, meliConectado: hasMeliListingOptimizer && meliConectadoTrilha } : {}),
```

onde `meliConectadoTrilha` vem de `useEstadoMeli(temAgente && hasMeliListingOptimizer)` (import de `./modules/agent/useFontes`), declarado perto do `extrasSemana`:

```ts
  const estadoMeliTrilha = useEstadoMeli(isCoorteObjetivos(cohort) && hasMeliListingOptimizer);
  // EstadoMeli é `{ conectado, status }` ou `{ erro }`; falha de checagem não conta como conectado.
  const meliConectadoTrilha = !!estadoMeliTrilha && 'conectado' in estadoMeliTrilha && estadoMeliTrilha.conectado === true;
```

e acrescentar `objetivos, hasMeliListingOptimizer, meliConectadoTrilha` às dependências do `useMemo`.

3. `acaoDaTrilha` (~linha 2465): tratar `meli` nos dois ramos:

```ts
      if (id === 'meli') { setMainView('meli'); return; }
```

(no ramo `feito`, antes de `if (id === 'produto' …)`; e no ramo de ação, antes de `if (id === 'produto' || id === 'conteudo')`).

- [ ] **Step 4: Verificar**

Run: `npx tsx scripts/verify-trilha.mjs && npx tsx scripts/verify-semana.mjs`
Expected: `Tudo ok.` nos dois.
Run: `npm run lint 2>&1 | grep -c "error TS"` → linha de base.

- [ ] **Step 5: Commit**

```bash
git add src/modules/onboarding/mission/trilha.ts scripts/verify-trilha.mjs src/modules/agent/semana.ts src/App.tsx
git commit -m "feat(onboarding): trilha da v2 segue os objetivos marcados"
```

---

### Task 7: Semana oferece uma peça para montar

**Files:**
- Modify: `src/modules/agent/semana.ts`
- Modify: `src/modules/agent/useSemana.ts`
- Modify: `scripts/verify-semana.mjs`
- Modify: `src/App.tsx` (`extrasSemana`, `abrirDestino`)

**Interfaces:**
- Consumes: `montarAlfred`, `proximaPecaParaMontar`, `Objetivo` (Task 1); `aderirObjetivos` (Task 3).
- Produces:
  - `DestinoTarefa` ganha `'montar'`; `TarefaSemana` ganha `montar?: Objetivo`.
  - `SinaisSemana.pecaParaMontar?: { objetivo: Objetivo; titulo: string; libera: string } | null`
  - Tarefa `id: 'montar-{objetivo}'`, origem pelo objetivo, estado `'aberta'`, só quando nenhuma missão `agora` está aberta.
  - `ExtrasSemana.pecaParaMontar` repassado como os outros extras.
  - `App.tsx`: `montarPeca(o: Objetivo): Promise<void>` — adere e abre a tela da peça.

- [ ] **Step 1: Teste**

Em `scripts/verify-semana.mjs`, antes do resumo final:

```js
// Peça para montar: uma por vez, e nunca por cima de uma missão aberta.
const peca = { objetivo: 'meli', titulo: 'Mercado Livre', libera: 'títulos, fichas e fotos dos anúncios' };
const comPeca = montarSemana({ ...base, pecaParaMontar: peca });
check('peça vira tarefa montar-meli', comPeca.map((t) => [t.id, t.destino, t.montar, t.origem]), [['montar-meli', 'montar', 'meli', 'meli']]);
check('título da tarefa de montar', comPeca[0].titulo, 'Montar Mercado Livre no Alfred');
check('detalhe diz o que libera', comPeca[0].detalhe, 'Libera: títulos, fichas e fotos dos anúncios');
const comMissao = montarSemana({ ...base, pecaParaMontar: peca, missoes: [{ id: 'produto', titulo: 'Aprimorar seu primeiro produto', meta: 'Agente de Produto', estado: 'agora' }] });
check('com missão agora, sem peça', comMissao.some((t) => t.id === 'montar-meli'), false);
const soOpcional = montarSemana({ ...base, pecaParaMontar: peca, missoes: [{ id: 'empresa', titulo: 'x', meta: 'y', estado: 'opcional' }] });
check('missão só opcional não bloqueia a peça', soOpcional.some((t) => t.id === 'montar-meli'), true);
check('sem peça, nada', montarSemana({ ...base, pecaParaMontar: null }), []);
```

Run: `npx tsx scripts/verify-semana.mjs` → FALHA.

- [ ] **Step 2: Implementar em `semana.ts`**

1. Tipos:

```ts
import type { Objetivo } from './capacidades';
export type DestinoTarefa = 'produtos' | 'conteudo' | 'meli' | 'integracoes' | 'atividade' | 'missao' | 'montar';
```

Em `TarefaSemana`, depois de `missao?`:

```ts
  /** destino === 'montar': qual objetivo aderir. */
  montar?: Objetivo;
```

Em `SinaisSemana`, depois de `missoes?`:

```ts
  /** A próxima peça do Alfred (proximaPecaParaMontar). Só entra sem missão `agora` aberta. */
  pecaParaMontar?: { objetivo: Objetivo; titulo: string; libera: string } | null;
```

2. Logo depois do bloco das missões (antes do `flexiveis.sort`):

```ts
  // Uma peça nova por vez, e só quando a primeira semana (missões) não tem
  // nada `agora`: oferecer outro agente no meio da missão divide a atenção.
  const p = s.pecaParaMontar;
  if (p && !(s.missoes ?? []).some((m) => m.estado === 'agora')) {
    flexiveis.push({
      id: `montar-${p.objetivo}`,
      origem: p.objetivo === 'produto' ? 'produto' : p.objetivo === 'meli' ? 'meli' : 'conteudo',
      titulo: `Montar ${p.titulo} no Alfred`,
      detalhe: `Libera: ${p.libera}`,
      estado: 'aberta',
      destino: 'montar',
      montar: p.objetivo,
    });
  }
```

Run: `npx tsx scripts/verify-semana.mjs` → `Tudo ok.`

- [ ] **Step 3: `useSemana.ts`**

Em `ExtrasSemana`:

```ts
  /** A próxima peça do Alfred para montar (capacidades.ts). */
  pecaParaMontar?: SinaisSemana['pecaParaMontar'];
```

Desestruturar junto: `const { categories, hasVideo, missoes, pecaParaMontar } = extras;`, passar `pecaParaMontar,` ao lado de `missoes,` no objeto de sinais (~linha 312) e acrescentar `pecaParaMontar` às dependências (~linha 318).

- [ ] **Step 4: App — calcular a peça e tratar o destino**

1. Perto de `extrasSemana`, montar as peças:

```ts
  // As peças do Alfred para esta conta (capacidades.ts). O status do ML não é
  // conhecido aqui; para a Semana basta saber o que está montado ou não.
  const pecasAlfred = useMemo(() => montarAlfred({
    objetivos,
    modules: { produtos: hasProdutosModule, contentAgent: hasContentAgent, operationsAgent: hasOperationsAgent, meliListingOptimizer: hasMeliListingOptimizer, video: hasVideoModule, blog: hasBlogModule },
    conexoes: { erp: products.some((p) => p._tinyProductId || p._blingProductId || p._idworksProductId), meli: false, site: projetosConteudo > 0 },
    marcos: { produtos: products.length, produtosComDescricao: products.filter((p) => String(p['Descrição complementar'] ?? '').trim()).length },
  }), [objetivos, hasProdutosModule, hasContentAgent, hasOperationsAgent, hasMeliListingOptimizer, hasVideoModule, hasBlogModule, products, projetosConteudo]);
```

Import `montarAlfred, proximaPecaParaMontar` de `./modules/agent/capacidades`. Nota: `projetosConteudo` só é ouvido para a coorte de missão (efeito `listenProjects`); para as outras contas fica 0, o que só afeta o estado `conectada` de Conteúdo, não se a peça está disponível.

2. Em `extrasSemana`, acrescentar (só para quem tem Alfred):

```ts
    pecaParaMontar: temAgente
      ? (() => { const p = proximaPecaParaMontar(pecasAlfred, objetivos); return p && p.objetivo ? { objetivo: p.objetivo, titulo: p.titulo, libera: p.libera } : null; })()
      : null,
```

e `pecasAlfred, temAgente` nas dependências do `useMemo`.

3. `montarPeca` e o destino `montar`, perto de `abrirDestino`:

```ts
  // "Montar" uma peça: adesão livre pelo servidor e a tela da peça em seguida.
  // O snapshot do usuário traz os módulos novos; a tela não espera por ele.
  const montarPeca = async (o: Objetivo) => {
    try {
      await aderirObjetivos([o]);
    } catch (err) {
      console.error('Erro ao aderir:', err);
      alert('Não foi possível ativar agora. Tente de novo em instantes.');
      return;
    }
    if (o === 'meli') setMainView('meli');
    else if (o === 'conteudo') setWorkspace('content');
    else setMainView('agenteProdutos');
  };
```

E na primeira linha de `abrirDestino`:

```ts
    if (destino === 'montar') { if (tarefa?.montar) void montarPeca(tarefa.montar); return; }
```

com o tipo do parâmetro `tarefa?: { missao?: ItemId; montar?: Objetivo }`.

Atenção à ordem: `montarPeca` usa `setWorkspace`, declarado antes; `abrirDestino` é declarado na linha ~322 — declarar `montarPeca` imediatamente acima dele. O efeito que manda o usuário de volta a `products` quando `mainView === 'meli' && !hasMeliListingOptimizer` (~linha 528) pode disparar antes do snapshot trazer o módulo; troque a condição por `if (mainView === 'meli' && !hasMeliListingOptimizer && !meliAderindo.current)`, com `const meliAderindo = useRef(false);` ligado em `montarPeca` antes do `await` (para `o === 'meli'`) e desligado num `useEffect(() => { if (hasMeliListingOptimizer) meliAderindo.current = false; }, [hasMeliListingOptimizer]);`.

- [ ] **Step 5: Verificar**

Run: `npx tsx scripts/verify-semana.mjs && npm run lint 2>&1 | grep -c "error TS"`
Expected: `Tudo ok.`; contagem igual à linha de base.

Manual: conta v2 com a missão de produto concluída e sem ML → a Semana mostra "Montar Mercado Livre no Alfred"; tocar abre a tela do Mercado Livre (com o "Conectar conta"), e `adesoes/meli` aparece no Firestore com o crédito.

- [ ] **Step 6: Commit**

```bash
git add src/modules/agent/semana.ts src/modules/agent/useSemana.ts scripts/verify-semana.mjs src/App.tsx
git commit -m "feat(alfred): a semana oferece a próxima peça para montar"
```

---

### Task 8: Ferramentas e Fontes mostram o que dá para montar

**Files:**
- Modify: `src/modules/agent/conectores.ts` (`entradasDoApp`)
- Modify: `scripts/verify-conectores.mjs`
- Modify: `src/modules/agent/FerramentasScreen.tsx`
- Modify: `src/App.tsx` (`conectarFonte`, props de `FerramentasScreen`)

**Interfaces:**
- Consumes: `Peca`, `Objetivo` (Task 1); `pecasAlfred`, `montarPeca` (Task 7).
- Produces:
  - `entradasDoApp`: sem módulo, `meli` e `content` entram como `{ chave, conectado: false }` (grupo "disponível"); com o ML ligado e o status ainda carregando, o ML continua fora.
  - `FerramentasScreen` recebe `pecas: Peca[]` e `onMontar: (o: Objetivo) => void`.

- [ ] **Step 1: Teste**

Em `scripts/verify-conectores.mjs`, substituir a linha

```js
check('sem módulo, sem Mercado Livre nem Conteúdo', semModulos.some((e) => e.chave === 'meli' || e.chave === 'content'), false);
```

por:

```js
check('sem módulo, ML e Conteúdo ficam disponíveis para montar', montarFontes(semModulos).disponiveis.map((x) => x.chave), ['meli', 'content']);
check('sem módulo, a linha diz o que libera', montarFontes(semModulos).disponiveis.map((x) => x.linha), ['Libera: anúncios e propostas do otimizador', 'Libera: artigos, calendário e SEO']);
```

(Se `integracoes` do script tiver ERPs desconectados, eles também aparecem em `disponiveis`; nesse caso filtre: `.filter((x) => x.chave === 'meli' || x.chave === 'content')`.)

O caso existente `'ML ainda não checado não aparece (nem como disponível)'` (`hasMeli: true, meli: null`) continua valendo e deve seguir passando.

Run: `npx tsx scripts/verify-conectores.mjs` → FALHA.

- [ ] **Step 2: `entradasDoApp`**

Trocar os dois blocos finais:

```ts
  if (opts.hasMeli) {
    if (opts.meli) {
      lista.push('erro' in opts.meli && opts.meli.erro
        ? { chave: 'meli', conectado: false, erro: opts.meli.erro }
        : {
          chave: 'meli',
          conectado: (opts.meli as { conectado: boolean }).conectado,
          reautorizar: (opts.meli as { status: string }).status === 'reauthorization_required',
        });
    }
  } else {
    // Sem módulo: a fonte fica em "Disponíveis" — conectar é aderir (livre).
    lista.push({ chave: 'meli', conectado: false });
  }
  if (opts.hasContentAgent) {
    const n = opts.projetos;
    lista.push({ chave: 'content', conectado: true, detalhe: n == null ? null : `${n} ${n === 1 ? 'projeto' : 'projetos'}` });
  } else {
    lista.push({ chave: 'content', conectado: false });
  }
```

E atualizar o comentário de `entradasDoApp`: "Mercado Livre e Conteúdo entram sempre: com o módulo, pelo estado real; sem ele, como disponíveis (aderir é livre)."

Em `AgentHomeScreen.tsx:215`, a condição `(hasMeli && !meli)` continua certa (só espera o status de quem tem o módulo). Nada a mudar lá.

Run: `npx tsx scripts/verify-conectores.mjs` → `tudo certo`.

- [ ] **Step 3: Fontes adere ao conectar**

Em `App.tsx`, `conectarFonte`:

```ts
  const conectarFonte = (chave: ChaveFonte) => {
    // Sem o módulo, "Conectar" é a adesão (livre) e já abre a tela da peça.
    if (chave === 'meli') { if (hasMeliListingOptimizer) abrirDestino('meli'); else void montarPeca('meli'); }
    else if (chave === 'content') { if (hasContentAgent) abrirDestino('conteudo'); else void montarPeca('conteudo'); }
    else if (chave === 'produtos') abrirDestino('produtos');
    else setMainView('integrations');
  };
```

`conectarFonte` (~linha 358) fica depois de `montarPeca` (declarado no Task 7 acima de `abrirDestino`) — confira a ordem.

- [ ] **Step 4: Seção "Para montar" em Ferramentas**

1. Em `Props` de `FerramentasScreen.tsx`:

```ts
  /** Peças do Alfred (capacidades.ts) — as disponíveis viram "Para montar". */
  pecas: Peca[];
  onMontar: (o: Objetivo) => void;
```

com `import type { Objetivo, Peca } from './capacidades';`, e desestruturar `pecas, onMontar`.

2. Antes do `return`:

```ts
  const paraMontar = pecas.filter((p) => p.estado === 'disponivel' && p.objetivo !== null);
```

3. Componente local, ao lado de `LinhaAgente`:

```tsx
/** Peça que a conta ainda não tem: tracejada, com o que libera, e "Montar". */
const LinhaParaMontar: React.FC<{ peca: Peca; onMontar: () => void }> = ({ peca, onMontar }) => (
  <div
    className="flex items-center gap-3 px-4 py-3 rounded-[18px]"
    style={{ border: '1.5px dashed', borderColor: 'var(--ag-hairline)' }}
  >
    <div className="min-w-0 flex-1">
      <p className="text-[15px] font-semibold" style={{ color: 'var(--ag-text)' }}>{peca.titulo}</p>
      <p className="text-[13px]" style={{ color: 'var(--ag-text-2)' }}>Libera: {peca.libera}</p>
    </div>
    <button
      onClick={onMontar}
      className="min-h-[44px] px-4 rounded-full text-[14px] font-semibold"
      style={{ background: 'var(--ag-accent)', color: 'var(--ag-on-accent)' }}
    >
      Montar
    </button>
  </div>
);
```

Antes de usar, confirmar os nomes dos tokens em `src/index.css` (`grep -n "\-\-ag-text-2\|\-\-ag-on-accent\|\-\-ag-hairline" src/index.css`); se `--ag-text-2`/`--ag-on-accent` não existirem, usar os equivalentes que a própria `FerramentasScreen` já usa para texto secundário e para o texto sobre `--ag-accent`.

4. Renderizar a seção nos dois layouts:
   - **F1 (celular)**: depois do `</section>` que fecha a lista de `LinhaAgente`, dentro do `md:hidden`:

```tsx
              {paraMontar.length > 0 && (
                <section className="flex flex-col gap-2">
                  <h2 className="text-[13px] font-semibold uppercase tracking-wide px-1" style={{ color: 'var(--ag-text-2)' }}>Para montar</h2>
                  {paraMontar.map((p) => <LinhaParaMontar key={p.id} peca={p} onMontar={() => onMontar(p.objetivo!)} />)}
                </section>
              )}
```

   - **D2 (desktop)**: o mesmo bloco, logo depois do último `Cartao` da grade (`lg:grid-cols-2`), envolto em `<div className="lg:col-span-2">…</div>`.

5. Em `App.tsx`, no `<FerramentasScreen …>`: `pecas={pecasAlfred}` e `onMontar={(o) => { void montarPeca(o); }}`.

- [ ] **Step 5: Verificar**

Run: `npx tsx scripts/verify-conectores.mjs && npm run lint 2>&1 | grep -c "error TS"`
Expected: `tudo certo`; linha de base.

Manual (`npm run dev`), conta só com `modules.produtos`: Ferramentas mostra Produtos e, em "Para montar", Mercado Livre e Conteúdo e blog; tema escuro legível (alternar no Alfred). Fontes mostra os dois em "Disponíveis"; "Conectar" no ML adere e abre a tela do ML. Conta legada com ML ligado: Fontes igual a antes.

- [ ] **Step 6: Commit**

```bash
git add src/modules/agent/conectores.ts scripts/verify-conectores.mjs src/modules/agent/FerramentasScreen.tsx src/App.tsx
git commit -m "feat(alfred): Ferramentas e Fontes mostram as peças para montar"
```

---

### Task 9: Tela 0 com três objetivos

**Files:**
- Create: `src/modules/onboarding/mission/objetivos.ts`
- Create: `scripts/verify-objetivos.mjs`
- Create: `src/modules/onboarding/mission/ObjetivosPicker.tsx`
- Modify: `src/App.tsx` (bloco da jornada de missão, ~linha 3405)
- Modify: `src/analytics.ts` (`trackMissionStarted` aceita `objetivos`)

**Interfaces:**
- Consumes: `Objetivo`, `OBJETIVOS` (Task 1); `aderirObjetivos` (Task 3); `isCoorteObjetivos`, `objetivos` (Task 5); `TEXTO_ADESAO` é do servidor — a tela tem o próprio texto curto e o servidor grava o dele.
- Produces:
  - `alternarObjetivo(sel: Objetivo[], o: Objetivo): Objetivo[]`
  - `rotuloComecar(sel: Objetivo[]): string`
  - `missaoDoObjetivo(o: Objetivo): MissionId | null`
  - `OBJETIVO_INFO: Record<Objetivo, { titulo: string; sub: string; agente: string; curto: string }>`
  - `<ObjetivosPicker onComecar={(sel: Objetivo[]) => Promise<void>} />`

- [ ] **Step 1: Teste**

```js
// scripts/verify-objetivos.mjs
// Tela 0 da coorte v2 (src/modules/onboarding/mission/objetivos.ts).
// Rodar com: npx tsx scripts/verify-objetivos.mjs
import { alternarObjetivo, rotuloComecar, missaoDoObjetivo, OBJETIVO_INFO } from '../src/modules/onboarding/mission/objetivos.ts';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? '  ok' : 'FALHA'}  ${label}${ok ? '' : ` → esperado ${JSON.stringify(expected)}, veio ${JSON.stringify(actual)}`}`);
}

check('marcar acrescenta no fim', alternarObjetivo(['meli'], 'produto'), ['meli', 'produto']);
check('desmarcar tira e mantém a ordem', alternarObjetivo(['meli', 'produto', 'conteudo'], 'produto'), ['meli', 'conteudo']);
check('não muta a lista recebida', (() => { const a = ['meli']; alternarObjetivo(a, 'produto'); return a; })(), ['meli']);

check('nada marcado', rotuloComecar([]), 'Escolha um para começar');
check('começa pelo primeiro marcado', rotuloComecar(['meli', 'produto']), 'Começar pelo Mercado Livre');
check('produto', rotuloComecar(['produto']), 'Começar pelas descrições');
check('conteúdo', rotuloComecar(['conteudo']), 'Começar pelo blog');

check('produto tem missão', missaoDoObjetivo('produto'), 'produto');
check('conteúdo tem missão', missaoDoObjetivo('conteudo'), 'conteudo');
check('ML ainda não tem missão (fase 4)', missaoDoObjetivo('meli'), null);

check('títulos são os objetivos do cliente', Object.values(OBJETIVO_INFO).map((i) => i.titulo), [
  'Melhorar a descrição dos produtos', 'Otimizar meu Mercado Livre', 'Gerar conteúdo para o meu blog',
]);

console.log(failures === 0 ? '\nTudo ok.' : `\n${failures} falha(s).`);
process.exit(failures === 0 ? 0 : 1);
```

Run: `npx tsx scripts/verify-objetivos.mjs` → FALHA (import).

- [ ] **Step 2: `objetivos.ts`**

```ts
// Tela 0 da coorte missao-v2: o cliente marca um ou mais objetivos, na ordem
// que quiser; o primeiro vira a missão desta sessão. PURO — verificar com
// `npx tsx scripts/verify-objetivos.mjs`.

import type { Objetivo } from '../../agent/capacidades';
import type { MissionId } from './missionTypes';

export const OBJETIVO_INFO: Record<Objetivo, { titulo: string; sub: string; agente: string; curto: string }> = {
  produto: { titulo: 'Melhorar a descrição dos produtos', sub: 'cole o link de um produto ou suba a planilha', agente: 'Agente de Produto', curto: 'pelas descrições' },
  meli: { titulo: 'Otimizar meu Mercado Livre', sub: 'títulos, fichas e fotos dos seus anúncios', agente: 'Agente Mercado Livre', curto: 'pelo Mercado Livre' },
  conteudo: { titulo: 'Gerar conteúdo para o meu blog', sub: 'montamos o blog a partir do seu site', agente: 'Agente de Conteúdo', curto: 'pelo blog' },
};

export function alternarObjetivo(sel: Objetivo[], o: Objetivo): Objetivo[] {
  return sel.includes(o) ? sel.filter((x) => x !== o) : [...sel, o];
}

export function rotuloComecar(sel: Objetivo[]): string {
  return sel.length ? `Começar ${OBJETIVO_INFO[sel[0]].curto}` : 'Escolha um para começar';
}

/** Missão de tela cheia do objetivo. ML ainda não tem (fase 4): abre a tela do otimizador. */
export function missaoDoObjetivo(o: Objetivo): MissionId | null {
  return o === 'meli' ? null : o;
}
```

Run: `npx tsx scripts/verify-objetivos.mjs` → `Tudo ok.`

- [ ] **Step 3: `ObjetivosPicker.tsx`**

Mesma linguagem visual do `MissionPicker` (fora do escopo `.alfreds`, cores literais da marca — é a tela de antes do shell), seleção múltipla com o número da ordem:

```tsx
// Tela 0 da coorte missao-v2: "o que você quer resolver", vários objetivos,
// o primeiro marcado vira a missão desta sessão (uma por sessão). Os outros
// ficam na Semana do Alfred.

import React, { useState } from 'react';
import { OBJETIVOS, type Objetivo } from '../../agent/capacidades';
import { OBJETIVO_INFO, alternarObjetivo, rotuloComecar } from './objetivos';

interface Props {
  onComecar: (objetivos: Objetivo[]) => Promise<void>;
}

const ObjetivosPicker: React.FC<Props> = ({ onComecar }) => {
  const [sel, setSel] = useState<Objetivo[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const comecar = async () => {
    if (!sel.length || enviando) return;
    setEnviando(true);
    setErro(null);
    try {
      await onComecar(sel);
    } catch {
      setErro('Não conseguimos ativar agora. Confira a conexão e toque de novo.');
      setEnviando(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f7f9fb]">
      <div className="mx-auto flex w-full max-w-md flex-col gap-4 p-5">
        <div>
          <h1 className="font-display text-2xl font-extrabold tracking-tight">O que você quer resolver?</h1>
          <p className="mt-1 text-sm text-slate-500">Pode marcar mais de um. Começamos pelo primeiro.</p>
        </div>
        <div className="flex flex-col gap-3">
          {OBJETIVOS.map((o) => {
            const i = sel.indexOf(o);
            const info = OBJETIVO_INFO[o];
            return (
              <button
                key={o}
                type="button"
                aria-pressed={i >= 0}
                onClick={() => setSel((s) => alternarObjetivo(s, o))}
                className={[
                  'w-full text-left rounded-2xl border bg-white p-4 grid grid-cols-[24px_1fr] gap-3 transition',
                  i >= 0 ? 'border-[#FF5B03] ring-2 ring-[#FF5B03]/20' : 'border-slate-200',
                ].join(' ')}
              >
                <span
                  aria-hidden
                  className={[
                    'mt-0.5 h-6 w-6 rounded-md border grid place-items-center text-xs font-bold',
                    i >= 0 ? 'bg-[#FF5B03] border-[#FF5B03] text-white' : 'border-slate-300',
                  ].join(' ')}
                >
                  {i >= 0 ? i + 1 : ''}
                </span>
                <span className="flex flex-col gap-1">
                  <span className="font-display text-base font-bold leading-tight">{info.titulo}</span>
                  <span className="text-xs text-slate-500">{info.sub}</span>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#FF5B03]">{info.agente}</span>
                </span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          disabled={!sel.length || enviando}
          onClick={comecar}
          className="w-full min-h-[44px] rounded-xl bg-[#FF5B03] px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
        >
          {enviando ? 'Ativando…' : rotuloComecar(sel)}
        </button>
        {erro && <p role="alert" className="text-center text-xs text-red-600">{erro}</p>}
        <p className="text-center text-[11px] text-slate-400">Uns 5 minutos. Pode parar e voltar depois.</p>
      </div>
    </div>
  );
};

export default ObjetivosPicker;
```

- [ ] **Step 4: `trackMissionStarted` com objetivos**

Em `src/analytics.ts` (~linha 191), a assinatura hoje é `{ missionId: MissionId; sugerida: MissionId | null; aceitouSugestao: boolean }`. Trocar por:

```ts
export function trackMissionStarted(params: {
  missionId: MissionId | 'meli'; sugerida: MissionId | null; aceitouSugestao: boolean; objetivos?: string[];
}) {
```

O corpo não muda (`logEvent` e `crmTrack` já repassam `params`; o servidor só valida o nome do evento). O `MissionPicker` da v1 continua chamando sem `objetivos`.

- [ ] **Step 5: Ligar no `App.tsx`**

No bloco `if (user && isAuthReady && isCoorteMissao(cohort) && missoesCarregadas) {` (~linha 3405), antes do `if (!emCurso && !jornadaConcluida)` do `MissionPicker`:

```tsx
    // v2: a Tela 0 é a dos objetivos, até o cliente escolher. Uma missão por
    // sessão: só o primeiro objetivo abre; os outros ficam na Semana.
    if (isCoorteObjetivos(cohort) && !emCurso && !jornadaConcluida && objetivos.length === 0) {
      return (
        <ObjetivosPicker
          onComecar={async (sel) => {
            await aderirObjetivos(sel);
            const primeiro = sel[0];
            trackMissionStarted({ missionId: missaoDoObjetivo(primeiro) ?? 'meli', sugerida: null, aceitouSugestao: false, objetivos: sel });
            const missaoId = missaoDoObjetivo(primeiro);
            if (missaoId) { setMissao(await iniciarMissao(user.uid, missaoId)); return; }
            // Mercado Livre ainda sem missão própria: abre o otimizador.
            meliAderindo.current = true;
            setObjetivos(sel);
            setMainView('meli');
          }}
        />
      );
    }
```

E o `if (!emCurso && !jornadaConcluida)` do `MissionPicker` antigo passa a ser `if (!isCoorteObjetivos(cohort) && !emCurso && !jornadaConcluida)` — sem isso, a v2 que escolheu Mercado Livre (sem missão em curso) cairia no picker antigo.

Imports: `ObjetivosPicker` de `./modules/onboarding/mission/ObjetivosPicker`, `missaoDoObjetivo` de `./modules/onboarding/mission/objetivos`.

`setObjetivos(sel)` local evita um frame com o picker de novo antes de o snapshot trazer `objetivos`. `meliAderindo` é o ref criado no Task 7.

- [ ] **Step 6: Verificar**

Run: `npx tsx scripts/verify-objetivos.mjs && npm run lint 2>&1 | grep -c "error TS"`
Expected: `Tudo ok.`; linha de base.

Manual, em ~375px (DevTools) com conta nova:
1. Tela 0 mostra os três objetivos; marcar ML e depois Produto mostra 1 e 2; botão "Começar pelo Mercado Livre".
2. Começar → abre a tela do Mercado Livre dentro do shell do Alfred (tab bar com três portas); `users/{uid}` tem `objetivos: ['meli','produto']`, `modules.meliListingOptimizer`, `modules.produtos`; saldo = 10 + 20 + 10 = 40; dois docs em `adesoes`.
3. Recarregar a página → não volta para a Tela 0; a Semana mostra "Conectar seu Mercado Livre" e "Aprimorar seu primeiro produto".
4. Outra conta nova escolhendo só Produto → abre a Missão Produto; ao concluir, aterrissa na Semana do Alfred (não na trilha antiga).
5. Desligar a rede e tocar Começar → mensagem de erro, botão volta a funcionar.
6. Conta `missao-v1` → continua vendo o `MissionPicker` antigo.

- [ ] **Step 7: Commit**

```bash
git add src/modules/onboarding/mission/objetivos.ts scripts/verify-objetivos.mjs src/modules/onboarding/mission/ObjetivosPicker.tsx src/analytics.ts src/App.tsx
git commit -m "feat(onboarding): Tela 0 com três objetivos para a coorte missao-v2"
```

---

### Task 10: Documentação

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-10-02-alfred-que-se-monta-design.md`

- [ ] **Step 1: CLAUDE.md**

Acrescentar, depois do parágrafo **Fontes e conectores (A4)**:

```markdown
**Alfred que se monta (coorte `missao-v2`).** O que a conta tem do Alfred sai de uma regra pura só, `montarAlfred` (`src/modules/agent/capacidades.ts`, verificar com `npx tsx scripts/verify-capacidades.mjs`): peças `produtos`/`meli`/`conteudo`/`erp`/`video`, estado derivado (`disponivel → ativa → conectada → com-resultado`), e `temAlfred(modules)` — `produtos`, `contentAgent` ou `operationsAgent` — é a única definição de "tem Alfred", no `App.tsx` (`temAgente`) e no servidor (`resolveAgentContext`, `requireAnyModule`). Conta nova nasce com `cohort: 'missao-v2'` e `modules.produtos: true`, escolhe objetivos na Tela 0 (`ObjetivosPicker.tsx`, regras em `objetivos.ts`) e adere por `POST /api/onboarding/aderir` (`server/adesaoRules.ts`, `npx tsx scripts/verify-adesao.mjs`): adesão livre, liga os módulos do objetivo, grava `users/{uid}.objetivos` e `users/{uid}/adesoes/{objetivo}` e paga o **crédito de missão** (`config/credits.missao.*`, padrão 10/20/15) uma vez — o `create()` do doc de adesão é o que impede pagar duas vezes. Uma missão por sessão: o primeiro objetivo abre, os outros viram itens da trilha (`montarTrilha` com `objetivos`). Peça não montada não some: Ferramentas tem "Para montar", Fontes lista ML/Conteúdo em "Disponíveis" (conectar = aderir) e a Semana oferece uma peça por vez, nunca com missão `agora` aberta. `missao-v1` e contas sem coorte não mudam.
```

- [ ] **Step 2: Spec**

Na tabela de estados da spec, trocar a coluna "Disponível" de Mercado Livre e Conteúdo para "sempre (sem módulo)", e acrescentar abaixo da tabela: "Decisão da implementação (2026-10-02): ML e Conteúdo ficam sempre disponíveis, porque condicioná-los a objetivo/ERP/site repetiria o problema 4 (o que não está ativo some). A Semana continua oferecendo uma peça por vez."

- [ ] **Step 3: Rodar todos os verifies tocados**

Run:
```bash
for s in capacidades adesao mission-steps trilha semana conectores objetivos agent-tools; do npx tsx scripts/verify-$s.mjs > /dev/null && echo "ok $s" || echo "FALHA $s"; done
```
Expected: oito linhas `ok`.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-10-02-alfred-que-se-monta-design.md
git commit -m "docs: Alfred que se monta — capacidades, adesão e Tela 0 da v2"
```

---

## Depois deste plano

- **Plano 2 (fase 4):** Missão Mercado Livre em `missionSteps.ts` (`MissionId 'meli'`), retomada do OAuth pelo doc da missão, escolha do anúncio, proposta e publicação; `missaoDoObjetivo('meli')` passa a devolver `'meli'` e o item da trilha muda de "Conectar" para a missão. Medir o custo real para calibrar `config/credits.missao.meli`.
- **Plano 3 (fase 5):** oferta de automático depois de 3 aprovações sem ajuste (`agent_settings.ofertas`) e pontes entre peças na Semana.
- **Deploy:** nenhuma regra nova do Firestore é necessária (`adesoes` fica negado ao cliente por não ter `match`). A coorte nova vale a partir do deploy do App Hosting.
