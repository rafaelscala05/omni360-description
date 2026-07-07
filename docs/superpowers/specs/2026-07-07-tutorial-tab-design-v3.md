# Aba de Tutorial — Design v3 (spotlight guiado)

Adiciona ao design v2 (`2026-07-07-tutorial-tab-design-v2.md`) um sistema de
destaque visual ("spotlight") que obriga o usuário a clicar exatamente no
elemento certo em cada etapa, escurecendo o resto da tela. Não altera as
telas já implementadas (catálogo, modal, abas) — apenas adiciona a camada
de guia por cima delas.

## Motivação

A navegação livre por abas (v2) exige que o usuário já saiba o fluxo. Para
um tutorial de primeiro contato, é melhor indicar explicitamente "clique
aqui agora" a cada passo, bloqueando o resto da tela.

## Mecanismo

**Alvo derivado do estado** — uma função pura `getGuideTarget()` calcula, a
cada render, qual é o único elemento habilitado, com base no `screen`,
`activeTab` e nas flags já existentes (`descriptionGenerated`,
`attributesGenerated`, `confirmedAttrs`, `imagesGenerated`, `videoStatus`).
Não há um contador de passo separado — o alvo é sempre consequência direta
do estado atual, então voltar/avançar no fluxo real (ex.: usuário clica errado
e nada acontece, pois só o alvo é clicável) nunca desincroniza o guia.

Sequência resultante:
1. `welcome` → botão "Começar".
2. `catalog` → ícone de gerar descrição (Sparkles) na linha do produto.
3. Modal, aba Conteúdo → botão "Gerar Conteúdo Premium" (ou nada, se
   `descriptionLoading`) → depois de gerado, aba "Atributos" na sidebar.
4. Aba Atributos → botão "Preencher com IA" → depois de gerado, o botão
   "Confirmar" do primeiro atributo ainda não confirmado (um de cada vez,
   em ordem) → depois de todos confirmados, aba "Imagens".
5. Aba Imagens → botão "Gerar Imagens com IA" → depois de gerado, aba
   "Vídeo".
6. Aba Vídeo → botão "Gerar Vídeo com IA" (ou nada, se `processing`) →
   depois de `done`, botão "Concluir tutorial" no header do modal.

A aba "Geral" não faz parte da sequência obrigatória (é informativa, sem
ação de "gerar") — o usuário nunca é guiado até ela, mas ela continua
visível como pano de fundo (coberta pelo overlay, como qualquer elemento
fora do alvo atual).

Nenhum elemento novo de clique é criado. Cada alvo já existe na v2 (botões
"Gerar...", abas da sidebar, "Concluir tutorial", "Começar"); recebem apenas
um atributo `data-tour="<id>"` para o spotlight localizá-los via
`document.querySelector`.

## Componente `TutorialSpotlight`

Overlay `fixed inset-0` renderizado sempre que `getGuideTarget()` retorna
um alvo não-nulo (ou seja, em toda tela exceto `done`, e exceto durante os
estados `*Loading`/`processing`, quando não há nada para clicar):

- Mede o elemento-alvo via `getBoundingClientRect()` num `useLayoutEffect`
  disparado sempre que o `id` do alvo muda (o que já acontece a cada
  transição de estado relevante), mais um listener de `resize` da janela
  enquanto o overlay está montado.
- Renderiza 4 faixas escuras (`bg-black/60`, `pointer-events-auto`, sem
  `onClick`) cobrindo tudo ao redor do retângulo do alvo — bloqueiam
  cliques em qualquer outro lugar da tela (outras abas, "Voltar", "Salvar e
  Fechar", outros ícones de ação da linha) simplesmente por estarem
  visualmente por cima deles.
- Renderiza um anel (`border-2 border-[#FF5B03] rounded-lg animate-pulse`,
  `pointer-events-none`) exatamente sobre o retângulo do alvo — o alvo em
  si fica sem nenhuma camada por cima, então o clique chega normalmente ao
  botão real.
- Renderiza um balão de texto (`bg-slate-900 text-white text-sm rounded-lg
  px-4 py-2.5 shadow-xl`, `pointer-events-none`) logo abaixo do alvo (ou
  acima, se não houver espaço vertical suficiente abaixo) com a instrução
  daquele passo.

## Não-objetivos

- Não adiciona um botão "Pular"/"Sair do guia" — a v2 já mantinha o "Pular
  tutorial"/"Concluir tutorial" acessível fora da sequência forçada; nesta
  v3, esses botões só ficam clicáveis quando forem o próprio alvo atual
  (no fim da sequência).
- Não implementa `ResizeObserver`/`MutationObserver` — o recálculo por
  `useLayoutEffect` (disparado pela troca de estado) mais o listener de
  `resize` da janela é suficiente, já que todo reflow relevante é
  consequência direta de uma mudança de estado já observada.
