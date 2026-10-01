# Alfred · duas portas — o que falta e próximas etapas

Referência de desenho: canvas "Alfreds — Mapa UX Agêntico × Ferramentas"
(https://claude.ai/artifact/RsBzaPJHUVEWP6w6HXHDz3) — telas A1–A5 (Alfred,
mobile), F1–F2 (Ferramentas, mobile), D1–D2 (desktop), DS1 (Liquid Glass,
escolhido), Inventário e Conselho de design.

## Já implementado

**Fase 1** (`feat/alfred-duas-portas`, commit 96ff4a5)
- Alfred abre na "Sua semana" (`SemanaPanel`, `semana.ts`, `useSemana`), com origem por cor e "Fazer com Alfred" / "Abrir".
- Telas Atividade e Ferramentas; tab bar de 3 abas + Menu; "Pedir ao Alfred" de Ferramentas para o chat (`promptAlfred`).

**Fase 2** (`claude/fase-2-visual-implementation-v6j6f0`)
- Ferramentas do agente: `produtos.incompletos.listar`, `produtos.buscar`, `produtos.descricoes.gerar` (Vertex, lote ≤10, só catálogo) e `meli.propostas.listar`, `meli.proposta.ver`, `meli.proposta.publicar` (trava fixa).
- Semana dá "Fazer com Alfred" em descrições e propostas do MELI quando o provider existe.
- Card de Plano no chat (`plano.ts`, `PlanoCard.tsx`) montado do que o turno fez; log atrás de "Ver como ele trabalhou".
- Aprovação em lote: amostra navegável item a item, custo em créditos, "aprovar sozinho" para as próximas, recibo no card executado.
- Autonomia por ferramenta ligada de verdade (`agent_settings/config` → grafo; `GET/PUT /api/agent/settings`); escrita automática vira doc em `agent_actions` (`auto: true`).
- Atividade: Para você · Rodando (vídeos em produção) · Feito.
- Tema claro/escuro único para todas as telas do agente; tab bar em Liquid Glass seguindo o tema; barra "Próximo passo" fixa no desktop.

## Antes de tudo: validar o que já foi feito

Nada da Fase 1 nem da Fase 2 foi testado com login (o Google Sign-In não roda no ambiente de nuvem).
1. Publicar de novo o serviço do grafo (`Dockerfile.contentAgent`) — as ferramentas novas rodam nele.
2. Com uma conta real: pedir "complete as descrições" → conferir o Plano, a amostra, o débito de créditos, a gravação no catálogo e o recarregamento do catálogo no app.
3. Publicar uma proposta do MELI pelo chat → conferir `meli_mutation_runs` e o anúncio.
4. Ligar "aprovar sozinho" numa descrição → o próximo lote deve rodar sem perguntar e aparecer em Atividade › Feito.
5. Trocar o tema no Alfred e passar pelas três abas (tab bar e barra Próximo passo devem acompanhar).
6. Vídeo em produção aparece em Atividade › Rodando com o progresso das cenas.

## O que foi desenhado e ainda não existe

### Navegação e visual (DS1 · Liquid Glass)
- [ ] **Trilho desktop de vidro (D1/D2)**: o menu lateral escuro continua; o desenho pede um trilho estreito com as 3 portas + avatar da Conta (Missões, Integrações, Empresa, Créditos, Indique viram o menu do avatar).
- [ ] **Liquid Glass no resto do app**: Produtos, Conteúdo, Mercado Livre, Integrações, Histórico ainda no visual antigo (fundo `#f7f9fb`, cores literais). Exige levar os tokens `--ag-*` para fora do escopo `.alfreds` e decidir se o tema escuro passa a valer no app todo.
- [ ] **Avatar da Conta no topo (mobile)**: no desenho a Conta sai do Menu e vira o avatar no cabeçalho de Ferramentas.

### Alfred (A1–A3, D1)
- [ ] **Desktop em 3 colunas (D1)**: Semana | Chat | coluna "Precisa de você · Rodando · Feito hoje" ao lado, em vez de alternar Semana/Conversa.
- [ ] **Cabeçalho da tarefa no chat (A2)**: "‹ Semana · Descrições · 12 produtos · Trabalhando" quando a conversa nasceu de uma tarefa da semana.
- [x] **Progresso dentro do passo (A2)** — lote em job (`lote.ts`, `loteWorker.ts`, `LoteCard.tsx`); o texto original era: "7 de 12 · agora: Luminária Pendente Aço". Hoje a geração do lote acontece inteira dentro do `preview()`; precisa emitir progresso por item (evento SSE novo ou doc de job) e mostrar no PlanoCard.
- [x] **Revisar parcial (A2/A3)** — aprovação por item no `LoteCard`, com descarte por item: "As 5 primeiras estão prontas — revisar enquanto termino o resto" e "Aprovar 5 prontas". Depende do item acima (lote em job, não num único preview).
- [x] **Pausar (A2)**: faixa acima do composer (`LoteEmAndamento.tsx`) e no card, com Continuar e "Parar aqui".
- [ ] **"Ajustar no chat" na aprovação (A3)**: abrir o composer já com o contexto da ação pendente.
- [ ] **Régua de fontes no rodapé da semana (D1)**: "4 fontes · +2 para conectar ›".

### Ferramentas (F1, F2, D2)
- [ ] **F1 em lista**: no celular, um agente por linha com chip de pendência ("12", "em dia") em vez dos cartões grandes; bloco Conta com Créditos e Integrações ("4 ativas · 1 alerta").
- [ ] **D2 "Alfred sugere"**: coluna lateral com pedidos prontos ("Resumir pedidos parados há mais de 2 dias", "Criar banner para o fim de semana") e Missões "2 de 5".
- [ ] **Cartões com mais números (D2)**: Produtos "não enviados ao ERP", Conteúdo "achados da auditoria SEO" e "publicados no mês", MELI "anúncios sem vídeo", Operações "pedidos em aberto no Tiny" e "banners ativos na Wake".
- [x] **F2 · Agente Produtos** (`ProdutosAgenteScreen.tsx`, `produtosAgente.ts`): segmentos Catálogo · Categorias · Imagens · Vídeos · Envio ERP; filtros Incompletos · Todos · Fora do ERP; pílulas por produto (descrição / atributos / foto / ambientada); seleção em massa. Imagens e Vídeos são listas que abrem o modal do produto na aba certa; Categorias e Envio ERP ainda levam às telas antigas. "Não enviados" virou **Fora do ERP** (sem vínculo com Tiny/Bling/IdWorks/Wake): não há registro de push por produto para saber o que foi enviado.
- [ ] **Barra "Próximo passo · N selecionados" fixa na base de toda tela de agente** com a ação principal ("Gerar descrições") e o atalho "Pedir ao Alfred". Feita em Produtos; falta Conteúdo e Mercado Livre.
- [x] **"Pedir ao Alfred" com contexto da tela e da seleção**: `WorkspaceContext` ganhou `tela` + `skus` + `totalSelecionados` (`server/agent/workspaceContext.ts`, saneado no Express antes de ir ao system prompt); vale para a conversa toda até outro pedido de outra tela; `produtos.buscar` aceita `skus`. Só Produtos manda seleção por enquanto.
- [ ] **"Abrir na ferramenta" do chat com o item selecionado**: link que cai na tela exata (ex.: produto aberto no modal, anúncio do MELI aberto).

### Atividade e conectores (A4, A5)
- [ ] **A4 · Fontes e conectores**: tela com "Precisa de atenção" (checagem falhou → Verificar), "Conectados" (com quantas ferramentas cada um libera) e "Disponíveis" ("Libera: banners, preço, SEO da loja" → Conectar). Hoje é a régua no topo do Alfred + a tela de Integrações antiga.
- [ ] **Publicar artigo direto da Atividade (A5)**: trava fixa de conteúdo com "Ver prévia" / "Publicar" no próprio card.
- [ ] **Recibo abrindo o log**: "Recibo" → o que foi gravado + as chamadas HTTP (`agent_logs`) daquela ação.
- [ ] **Notificação só quando precisa de você**: push para aprovação pendente ou tarefa bloqueada; progresso e conclusão sem barulho. Não existe infraestrutura de push hoje.

### Semana (Conselho · "a semana é o produto")
- [ ] **Missões viram a primeira semana** (sem trilha paralela) para a coorte de onboarding.
- [ ] **Custo e tempo estimado em cada tarefa** ("~4 min · 12 créditos").
- [ ] **Mais fontes de tarefa**: achados da auditoria SEO (uma tarefa por achado), "vídeo para o produto mais vendido", "banner da campanha de fim de semana", "pedidos parados" (Tiny), produtos não enviados ao ERP, anúncios do MELI sem vídeo.
- [ ] **Recalcular toda segunda** e guardar a semana (hoje é recalculada a cada render a partir do estado atual; não há histórico de semanas).

### Ferramentas do agente que faltam (Inventário: "falta tool")
- [ ] Atributos por categoria (texto e foto) em lote.
- [ ] Imagens ambientadas (sugerir quando só há foto em fundo branco) — custo alto, precisa de amostra.
- [ ] Categorias e hierarquia ("propõe a árvore; uma aprovação para tudo").
- [ ] Vídeo de produto (iniciar job; progresso já aparece em Rodando).
- [ ] Envio ao ERP pelo chat (parcial hoje: só pela tela de Integrações) — reaproveitar `pushLog` como recibo.
- [ ] Importar/exportar planilha (avisar o que chegou incompleto e criar tarefas).
- [ ] MELI: vídeo studio e geração de foto (`/pictures/generate`) pelo chat.
- [ ] Bling e IdWorks no chat (hoje só importação e envio).
- [ ] Mostrar o custo antes de gastar em **todas** as ferramentas que debitam (hoje só as mapeadas em `creditActionsFor`; as de conteúdo debitam mais fundo e não aparecem no `custo`).

## Ordem sugerida

1. **Validação com login** (lista acima) e correções que aparecerem.
2. ~~**F2 + barra de seleção + "Pedir ao Alfred" com contexto**~~ — feito para Produtos; falta validar com login (abrir Ferramentas › Produtos, selecionar, "Gerar N descrições" → confirmação com custo → progresso na barra; e "Pedir ao Alfred" → o grafo deve chamar `produtos.buscar` com os SKUs selecionados). Exige republicar o serviço do grafo.
3. ~~**Lote em job com progresso**~~ — feito para descrições (`produtos.descricoes.gerar`, teto subiu de 10 para 50). Para outra ferramenta virar lote: `lote: true` no registro, o `preview()` chama `criarLote`, e um gerador em `GERADORES` (`loteWorker.ts`). Falta validar com login: pedir 12 descrições, aprovar as prontas no meio, pausar/continuar, e ver o servidor principal retomar um lote se o serviço do grafo cair. Exige deploy das regras e índices do Firestore (`agent_jobs`) e do serviço do grafo.
4. **Novas ferramentas** na ordem do valor: atributos → envio ao ERP pelo chat → vídeo → categorias → ambientadas.
5. **A4 Conectores** e **D1 em 3 colunas**.
6. **Liquid Glass no app todo + trilho desktop** (maior raio de impacto visual; fazer por último e por tela).
7. Notificações push.
