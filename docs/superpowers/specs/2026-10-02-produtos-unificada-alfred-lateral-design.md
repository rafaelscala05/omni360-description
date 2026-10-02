# Produtos: lista com integração, filtros e Alfred na lateral

Data: 2026-10-02 · Status: desenho aprovado, aguardando revisão da spec

## Objetivo

A tela Produtos do agente (`ProdutosAgenteScreen.tsx`, `mainView === 'agenteProdutos'`) vira o lugar onde o usuário vê o catálogo inteiro, entende de onde cada produto veio e se está em dia com o ERP, filtra, seleciona e manda gerar descrição ou imagem em massa — com o Alfred numa coluna lateral mostrando o que está fazendo.

Sucesso: em desktop e celular, selecionar N produtos → "Gerar descrição para todas" → ver quem fica de fora e por quê → confirmar → ver cada item ser gravado, sem sair da tela.

## Fora do escopo

- **Tabela completa** (`mainView === 'products'`) não muda.
- **Novo Produto conversacional** — segunda spec, depois desta (depende do `PainelAlfred` daqui).
- Mover a assinatura do Bling (`_blingPushed`) do navegador para o servidor.
- Histórico de versões de descrição por produto (o "Desfazer" usa o que o lote já guarda).

## Decisões tomadas

| Pergunta | Decisão |
|---|---|
| Base | Trabalhar sobre a `ProdutosAgenteScreen` existente |
| Sincronização | Vínculo + pendência ("Tiny · 2 não enviadas") |
| Conversa do painel | A mesma thread da aba Alfred |
| Painel | Fixo ≥1280px, recolhível 768–1280, folha no celular |
| Confirmação | Montada pela tela (sem IA), com etapas reais animadas |
| Gravação | Direta (lote em `auto: true`) |
| Sobrescrever ambientadas | Acrescenta (as antigas ficam) |

---

## Parte 1 · A lista

### Linha

```
☐  [foto]  Nome do produto        [Tiny · em dia]   descrição ✓  foto ✓  ambientada ○
           SKU-123
```

- Caixa de seleção no **começo** da linha (hoje à direita). O resto da linha abre o produto (`onAbrirProduto`), como hoje.
- **Selo de integração**, um por vínculo (`_tinyProductId`, `_wakeProductId`, `_blingProductId`, `_idworksProductId`):
  - `Tiny · em dia` — neutro;
  - `Tiny · 2 não enviadas` — âmbar; tooltip/toque lista os grupos (título, descrição, SEO, imagens);
  - `Só no OMNI360` — contorno, quando não há vínculo.
- Celular: selos e pílulas descem para baixo do nome.
- Só produtos principais, como hoje (`principais()`).

### Topo

- Busca por nome ou SKU (existe; desktop no topo, celular atrás da lupa).
- Botão **Filtros** com contador ("Filtros · 2"); filtros ativos viram pílulas removíveis abaixo.
- Atalhos **Categorias**, **Envio ERP** e **Tabela completa** ficam juntos no topo.
- Os segmentos Catálogo/Imagens/Vídeos e as pílulas de filtro rápido de hoje **saem** — viram opções do painel.

### Painel de filtros

Popover no desktop, folha que sobe da base no celular. Multi-seleção, contagem ao lado de cada opção.

- **Integração:** Tiny · Wake · Bling · IdWorks · Só no OMNI360
- **Sincronização:** Em dia · Com alterações não enviadas
- **Conteúdo:** Sem descrição · Sem foto · Sem ambientada · Sem atributos · Sem vídeo
- **Categoria:** lista com busca

Semântica: **OU dentro do grupo, E entre grupos.** "Limpar" zera.
Padrão ao abrir: Conteúdo = {Sem descrição, Sem foto} (equivale ao "Incompletos" de hoje).

### Paginação

- **50 produtos por página** (substitui o "Mostrar mais" de 60 em 60).
- Rodapé da lista: `1–50 de 412` · `‹ Anterior` `1 2 3 … 9` `Próxima ›`. No celular, só `‹  2 de 9  ›`.
- Mudar busca ou filtros volta para a página 1; trocar de página rola a lista até o topo.
- A seleção sobrevive à troca de página (é um `Set` de ids, como hoje).
- Caixa do cabeçalho marca **os 50 da página**. Com a página toda marcada e mais resultados no filtro, aparece a faixa: "50 desta página selecionados · **Selecionar todos os 412 do filtro**" (e o inverso, "Limpar seleção").
- Contagem dos filtros e o "N selecionados" da barra sempre consideram o total, não só a página.
- Página e tamanho ficam em `produtosAgente.ts` (`paginar(lista, pagina, 50)`), cobertos pelo verify.

As pílulas de cada linha mostram sempre os quatro aspectos (descrição, atributos, foto, ambientada) com as cores de `aspectos.tsx`; vídeo aparece quando o filtro "Sem vídeo" está ativo.

### Código

- `produtosAgente.ts`: `FiltrosProdutos` (objeto por grupo), `filtrarProdutos(lista, filtros, busca)`, `contarOpcoes(lista, filtros)` — a contagem de cada opção considera os outros grupos ativos.
- Componentes novos em `src/modules/agent/produtos/`: `LinhaProduto.tsx`, `SeloIntegracao.tsx`, `PainelFiltros.tsx`.
- Verificar: `scripts/verify-produtos-agente.mjs` atualizado.

---

## Parte 2 · Registro da sincronização

### Dados

Por produto, um mapa por integração com assinatura por grupo:

```ts
_tinyPushed?:    { titulo?: string; descricao?: string; seo?: string; imagens?: string };
_wakePushed?:    { descricao?: string; seo?: string; imagens?: string };
_idworksPushed?: { descricao?: string; seo?: string; imagens?: string };  // tipo já existe, nada grava hoje
// _blingPushed continua como está
```

Só os grupos que cada push escreve. Fiscal nunca entra (nenhum push manda fiscal).

### Regra pura — `src/modules/agent/sincronizacao.ts`

Usado pelos dois lados (como `lote.ts`).

- `assinaturaGrupo(p, grupo)` — o `djb2` e os grupos de `tinyGroup` hoje no `App.tsx`, extraídos para cá; o `App.tsx` passa a importar daqui (o fluxo do Bling continua igual).
- `estadoIntegracao(p, integracao)` → `{ tipo: 'sem-vinculo' } | { tipo: 'em-dia' } | { tipo: 'pendente', grupos }`.
- **Sem assinatura gravada** (produto anterior a esta entrega): em dia se `getProductStatusFlags` não indica nada gerado/editado no app; senão pendente nos grupos gerados.
- Verificar: `scripts/verify-sincronizacao.mjs` (hash estável, cada estado, fallback).

### Quem grava — sempre o servidor, no ponto da escrita

A assinatura é calculada dentro do mesmo `if` que põe o campo no corpo do envio (mesmo princípio do push log), só para grupos com `step === 'ok'`, e gravada com `merge` no doc do produto via Admin SDK.

| Integração | Onde | Atende |
|---|---|---|
| Tiny | `pushV2Lote` (`server/tinyV2.ts`) via `tinyProvider.ts` | Integrações e `tiny.catalogo.enviar` |
| Wake | `pushWakeProduto` (`server/wakeAgent.ts`) | Integrações e `wake.catalogo.enviar` |
| IdWorks | `pushIdworksProduto` (`server/idworksAgent.ts`) | Integrações e `idworks.catalogo.enviar` |

Variação do Tiny: o push grava só imagem pelo pai; a assinatura `imagens` vai no doc da variação enviada.

### Importação e webhooks

Gravam a assinatura do que chegou, então produto importado nasce em dia, e mudança vinda do ERP volta a ficar em dia:
`server/tinyImportWorker.ts`, `server/tinyWebhook.ts`, `server/idworksImportWorker.ts`, `server/idworksWebhook.ts`, e a importação Wake (hoje no cliente, `App.tsx` ~1762, junto do snapshot em `wake_versions`).

### Verificação

`verify-tiny-push.mjs` e equivalentes passam a conferir que a assinatura gravada corresponde ao conteúdo que saiu no corpo.

---

## Parte 3 · Alfred na lateral e ações em massa

### Uma conversa, dois lugares

O estado do chat que hoje vive no `AgentHomeScreen` (mensagens, ações, `parcial`, `leituras`, streaming, erro, ajuste) sai para:

- `src/modules/agent/useConversaAlfred.ts` — hook com a thread e os envios;
- `src/modules/agent/PainelAlfred.tsx` — `ChatThread` + `Composer` + cards locais.

Ambos usados pelo `AgentHomeScreen` e pela tela de Produtos. Mesma thread. O painel envia `WorkspaceContext` com `tela: 'produtos'`, `skus` (≤50), `totalSelecionados` e os filtros ativos.

### Layout

- **≥1280px:** coluna fixa à direita (~380px), lista ao centro, barra de próximo passo sob a lista.
- **768–1280px:** painel recolhido num botão "Alfred" no topo; abre como coluna sobreposta.
- **Celular:** folha que sobe da base, abre sozinha quando uma ação da barra é tocada, arrastável até tela cheia. Mantém as regras do composer (`text-[16px]`, `useAlturaTeclado`, `scrollTop` em vez de `scrollIntoView`).
- Tudo em tokens `--ag-*`, dentro do escopo `.alfreds`.

### Barra de próximo passo

Com seleção: `12 selecionados · [Gerar descrição para todas] [Gerar imagem para todas] · Pedir ao Alfred`.
Sem seleção: "Selecionar os N sem descrição" (como hoje). `BarraProximoPasso.tsx` passa a aceitar duas ações.

### Card de confirmação (local, sem IA)

Inserido no painel como item local (não persistido) ao tocar uma ação.

1. **Etapas reais animadas** (300–500 ms entre linhas, mesmo efeito "pensando" do chat):
   - "Lendo os 12 produtos selecionados…"
   - "Conferindo descrições — 3 já têm: Camiseta, Tênis, Boné"
   - (imagem) "2 sem foto pública ficam de fora: …"
   - "Calculando custo — 9 × 3 = 27 créditos"
2. **Resumo + botões:** **Gerar só os 9** (principal) · **Sobrescrever os 12** · Cancelar.
3. Saldo insuficiente → botão principal vira "Faltam X créditos · Recarregar".
4. Nenhum a gerar no modo pular → "Todos já têm descrição" com só **Sobrescrever** e Cancelar.

Regra pura em `src/modules/agent/confirmacaoMassa.ts` (quem entra, quem fica de fora e por quê, custo) — verificar com `scripts/verify-confirmacao-massa.mjs`.

### Rota nova — `POST /api/agent/lotes`

Corpo: `{ ferramenta: 'produtos.descricoes.gerar' | 'produtos.ambientadas.gerar', docIds: string[], sobrescrever: boolean, threadId }`.

- **Recalcula no servidor** quem entra (o corpo vem do navegador): pula quem já tem descrição/ambientada salvo `sobrescrever`; imagem sempre exige foto.
- Quebra em lotes de 50 (descrições) / 10 (`MAX_AMBIENTADAS_POR_LOTE`), cada um via `criarLote` com `auto: true`; os seguintes ficam enfileirados e começam quando o anterior termina.
- Ambientadas: mantém a checagem de saldo do lote inteiro.
- Grava na thread uma mensagem do Alfred com o card do lote (mesmo vínculo `acaoLote` que `contentAgentChat.ts` usa), para aparecer também na aba Alfred.
- Débito por item gravado, como hoje.

### Progresso e Desfazer

`LoteCard` ganha modo texto corrido: "✍️ escrevendo Camiseta… ✓ Camiseta · ✓ Tênis · ⚠ Boné: sem foto pública", com Pausar/Parar (rotas existentes) e "lote 1 de 4" quando enfileirado.

Ao fim: "9 gravadas · 27 créditos" e **Desfazer**:
- descrições — devolve `descricaoAntes` de cada item gravado, se o texto atual ainda for o que o lote gravou (não desfaz edição posterior do usuário);
- imagens — remove de `_ambientImages` as URLs que o lote acrescentou.

Rota `POST /api/agent/lotes/:id/desfazer`; desfazer não estorna créditos.

A lista atualiza as pílulas a cada leva gravada pelo `result.gravados` existente (que já faz o App reler o catálogo).

### Pedido livre

Texto digitado no composer vai ao modelo como hoje, com `leitura`/`acao` reais do SSE.

---

## Erros

- Falha de checagem de integração ≠ "sem vínculo": o selo usa só dados do produto, então não depende de status de rede.
- Item que falha no lote aparece com o motivo na linha do progresso; os outros seguem.
- Rota de lotes recusa `docIds` vazio, ferramenta fora da lista e produtos que não são do usuário.

## Ordem sugerida de implementação

1. `sincronizacao.ts` + verificação; gravação nos três pushes; importação/webhooks.
2. Lista: linha, selo, filtros, paginação (pode ir ao ar sozinha).
3. `useConversaAlfred` + `PainelAlfred` extraídos, `AgentHomeScreen` usando-os sem mudança visível.
4. Painel na tela de Produtos + barra com duas ações + card de confirmação.
5. Rota `/api/agent/lotes`, progresso em texto, Desfazer.

## Verificação manual

Rodar `npm run dev`, entrar com uma conta com agente e Tiny conectado: filtrar por "Tiny · com alterações não enviadas", gerar descrição para 3 (1 já com descrição, modo pular), ver o selo virar pendente, enviar ao Tiny pelo Alfred e ver voltar a "em dia". Repetir no celular (DevTools, 390px).
