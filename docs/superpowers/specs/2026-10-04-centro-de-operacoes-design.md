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

- `startOpsSyncScheduler` (servidor principal, a cada minuto): `collectionGroup('ops_sync').where('proximaEm','<=',agora)`, lease em transação, um ciclo limitado — nunca um job longo.
- Orçamento do ciclo: 30% do limite por minuto do plano no Tiny (header `x-limit-api`; api2-limites-api: 20 nos planos antigos, 30 Crescer, 60 Evoluir, 120 Potencializar), entre 4 e 40 chamadas; 6 enquanto o limite não é conhecido. O limite é da conta inteira — o integrador da loja usa o mesmo —, então o sync nunca pode tomá-lo. Consequência: ~350 pedidos em 90 dias levam ~40 min no Crescer.
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

## Contrato do Tiny (conferido na documentação em 2026-10-04)

- `pedidos.pesquisa.php` aceita `dataAtualizacao` (dd/mm/yyyy hh:mm:ss); exige ao menos um filtro (datas servem); 100 por página; `dataInicial`/`dataFinal` filtram pela **data de cadastramento**, que o doc guarda como `data_pedido` — normalmente iguais.
- A situação é filtrada por código (`preparando_envio`, `pronto_envio`, `nao_entregue`…) e pode voltar como descrição ("Faturado (atendido)"); `normalizarSituacao` aceita os dois.
- `pedido.obter.php` traz `itens[].item.{codigo,quantidade,valor_unitario}`, `ecommerce.{nomeEcommerce,canalVenda}` (canal = `canalVenda`, senão `nomeEcommerce`) e as datas `data_faturamento`/`data_envio`/`data_entrega` — base da fase Entrega.
- `tinyV2CallRaw` marca 401 em qualquer erro com "inválido" no texto; o sync só trata como credencial se o texto falar de token (`ehCredencial`), senão um "Data inválida" pausaria a conta.

## Verificação

`npx tsx scripts/verify-ops.mjs` (papéis, normalização, indicadores, estoque) e `npx tsx scripts/verify-ops-sync.mjs` (ciclo inteiro contra um Tiny falso que segue o contrato acima e um Firestore em memória: importação, orçamento por ciclo, incremental, modo janela, credencial × parâmetro ruim, inatividade). Índice novo: `ops_sync.proximaEm` em escopo COLLECTION_GROUP (`firestore.indexes.json`) — precisa de deploy dos índices antes do worker achar contas.

---

# Fase 2 · Entrega, Catálogo ERP × loja e Preços

**Data:** 2026-10-04 · pedido direto do usuário ("crie as áreas que ficaram de fora").

## Entrega (pedidos do Tiny)

O doc de `ops_pedidos` passa a guardar, do `pedido.obter`, `dataFaturamento`, `dataEnvio`, `dataEntrega`, `dataPrevista` e `formaEnvio`. Mudança de situação no incremental pede detalhe de novo (antes só mudança de valor), senão as datas de envio/entrega nunca chegariam. Indicadores (`painelEntrega`, pedidos dos últimos 60 dias): mediana e p90 de pedido→envio e envio→entrega, % entregue até a data prevista, atrasados (não entregue/cancelado e previsão vencida), não entregues e tempo de transporte por forma de envio. Sem migração: nenhum `ops_pedidos` existe em produção.

## Catálogo da loja (Wake)

Novo sync `server/ops/lojaSync.ts`, mesmo desenho do de pedidos (estado em `ops_sync/wake-catalogo`, `tipo: 'catalogo'`, lease, liga na visita, pausa após 14 dias):
- `GET /produtos?quantidadeRegistros=50&camposAdicionais=Estoque`, paginado pelo cursor `produtoVarianteIdDe` + header `X-Ultimo-Produto-Variante-Id` — o parâmetro `pagina` foi descontinuado em 21/09/2026.
- Varredura completa a cada 24 h (marca `rodada`; no fim, apaga o que não apareceu = removido da loja); entre elas, incremental por `alteradosPartirDe` (aaaa-mm-dd hh:mm:ss, ≤ 48 h — passou disso, varredura completa).
- Doc `ops_loja/{produtoVarianteId}`: sku, nome, produtoId, parentId, precoPor, precoDe, precoCusto, estoque (físico − reservado, somado nos CDs), exibirSite, valido.
- Limite da Wake: 120/min **por grupo de endpoints**, compartilhado com o integrador do ERP, e 5 requisições acima do limite bloqueiam o token por 1 h. O ciclo gasta no máximo 15 chamadas, tem fetch próprio **sem retry em 429** (o `fbitsFetch` repete) e respeita o `Retry-After`.
- Agendador único (`server/ops/scheduler.ts`) despacha por `tipo`.

## Comparação (`ops/catalogo.ts`, puro; calculado no servidor em `/api/ops/painel`)

Lado ERP = catálogo do OMNI360 vindo do ERP (tem `_tinyProductId`/`_blingProductId`/`_idworksProductId`), só folhas (simples e variações), pela SKU. Preço final do ERP = `Preço promocional` quando > 0 e menor que `Preço`, senão `Preço`; da loja = `precoPor`.
- Catálogo: no ERP e fora da loja (ordenado por estoque — venda perdida), na loja e fora do ERP, oculto/inválido na loja com estoque, estoque diferente entre os dois.
- Preços: preço final diferente (> R$ 0,01), sem preço na loja, promoções da loja (`precoDe > precoPor`, desconto médio), abaixo do custo e margem < 15% — custo da Wake (`precoCusto`), senão do ERP (`Preço de custo`, que a importação do Tiny passa a gravar de `preco_custo`).
- Só Wake: catálogo/preços sem a comparação (promoções, margem, ocultos com estoque). Só ERP: pede para conectar a loja.

## Alfred

`ops.painel.resumo` ganha a entrega; `ops.loja.resumo` (provider `wake`) devolve catálogo e preços. Cada seção do painel tem "Pedir ao Alfred" com os SKUs — o Alfred já tem `wake.produto.preco` e `wake.produto.atualizar` (com aprovação).
