# Centro de Operações (painel do Agente de Operações)

**Data:** 2026-10-04 · **Status:** aprovado em conversa (seções 1 e 2); seções 3 e 4 decididas na implementação, a pedido.

## Problema

"Abrir Operações" (Ferramentas, coluna de agentes) levava para `fontes` — a lista de conectores. O gestor quer um centro de operações do e-commerce: quanto vendeu, o que está parado, o que vai acabar.

## Escopo da v1

Vendas + Funil do pedido + Estoque. Fica para depois: Catálogo ERP × loja, Preços, Entrega (tempo de envio/entrega — exige `pedido.obter` com datas, que o mesmo job já busca), adaptadores Bling/IdWorks/Wake de pedidos.

## 1 · Classificador de papel (`src/modules/agent/ops/papeis.ts`, puro)

- `papelDe(plataforma)` → `erp` (Tiny, Bling, IdWorks) · `loja` (Wake) · `marketplace` (Mercado Livre). Fixo por plataforma, decidido no código — o usuário não configura.
- `fonteDe(dominio, conectados)`, domínios `pedidos` · `estoque` · `catalogo_loja`: pedidos e estoque vêm do primeiro ERP conectado (Tiny → Bling → IdWorks); sem ERP, da Wake. `catalogo_loja` é sempre a Wake. Sem fonte → `null` (o painel pede para conectar, nunca mostra zero).
- Pedidos nunca vêm de duas fontes: o pedido da Wake também está no Tiny, somar duplicaria.
- `temAdaptadorPedidos(fonte)`: só `tiny` na v1. Fonte sem adaptador → o painel diz que ainda não lê pedidos dela.

## 2 · Dados

`users/{uid}/ops_pedidos/{fonte}_{id}` (compacto, só o servidor escreve, o cliente não lê):
`fonte, idExterno, numero, data (YYYY-MM-DD), situacao (normalizada), situacaoOriginal, valor, canal, itens [{sku, qtd, valor}], detalhado, atualizadoEm`.

- Situação normalizada: `aberto | aprovado | faturado | enviado | entregue | cancelado | outro` (mapa em `ops/pedidos.ts`).
- Canal = `ecommerce.nomeEcommerce` do `pedido.obter` (vazio → "Sem canal").
- O pedido chega em duas etapas: resumo de `pedidos.pesquisa` (receita, ticket, funil) e depois o detalhe (`detalhado: true`: itens e canal). Cobertura em dias e canais mostram a fração detalhada enquanto não chega a 100%.

`users/{uid}/ops_sync/{fonte}`: `ultimaVisita, proximaEm, leaseId, leaseUntil, incremental {desde, inicioRodada, pagina, modo}, backfill {ate, alvo, pagina}, erro, ultimoCicloEm`.

Estoque não tem coleção: vem de `Estoque`/`Estoque mínimo` que a importação e o webhook do Tiny já gravam no catálogo.

## 3 · Worker (`server/ops/pedidosSync.ts`)

- `startOpsSyncScheduler` (servidor principal, a cada minuto): `collectionGroup('ops_sync').where('proximaEm','<=',agora)`, lease de 5 min em transação, um ciclo limitado (~40 chamadas) — nunca um job longo.
- Ciclo, em ordem: (1) incremental por data de alteração (`dataAtualizacao`, sobreposição de 10 min; se o Tiny recusar o parâmetro, cai para reescanear os últimos 7 dias por data do pedido — `modo: 'janela'`); (2) detalhe dos `detalhado == false`; (3) backfill de 7 em 7 dias até 90 dias atrás.
- `proximaEm`: +15 min quando em dia, +1 min com backfill/detalhe pendente.
- Liga na primeira visita ao painel (`create()` idempotente); para quando a fonte desconecta ou ninguém abre o painel há 14 dias (`proximaEm` some; a próxima visita religa).
- Erros: credencial (401) → `erro: 'credencial'`, pausa e o painel leva às Fontes; outros → backoff. Toda chamada passa por `withLog` (aparece nos Logs).

## 4 · Painel e Alfred

- `GET /api/ops/painel` (servidor): resolve fontes, liga/visita o sync, lê `ops_pedidos` dos últimos 60 dias e devolve os indicadores calculados por `ops/indicadores.ts` (puro, o mesmo que a ferramenta do Alfred usa), cache de 60 s. Decisão: o cálculo é no servidor e não no cliente — 60 dias podem ser milhares de docs, e assim `ops_pedidos` não precisa de regra de leitura.
  - Vendas: receita, pedidos e ticket (cancelados fora) em hoje / 7 / 30 dias, com o período anterior; série diária de 30 dias; canais.
  - Funil: contagem por situação (pedidos dos últimos 30 dias); parados = aberto/aprovado há > 2 dias, faturado há > 3 dias.
  - `vendidos30d`: quantidade por SKU (base da cobertura).
- Estoque é calculado no cliente (`indicadoresEstoque`), sobre o catálogo já em memória + `vendidos30d`: esgotados que vendiam, abaixo do mínimo, cobertura < 14 dias, sem estoque informado. Folhas apenas (variações e simples), pela SKU.
- Tela `OperacoesScreen.tsx` (`mainView === 'operacoes'`, porta Ferramentas, coluna de agentes acesa em Operações): cabeçalho com fontes e "atualizado há X"/"importando histórico · N%", três seções, cada uma com "Pedir ao Alfred" (prompt com o contexto da seção). Fontes e conectores fica a um toque.
- Ferramenta `ops.painel.resumo` (leitura, provider da fonte de pedidos): o Alfred responde "quanto vendi" a partir de `ops_pedidos`, sem chamar o Tiny.

## Verificação

`npx tsx scripts/verify-ops.mjs` (papéis, normalização, indicadores, estoque). Índice novo: `ops_sync.proximaEm` em escopo COLLECTION_GROUP (`firestore.indexes.json`) — precisa de deploy dos índices antes do worker achar contas.
