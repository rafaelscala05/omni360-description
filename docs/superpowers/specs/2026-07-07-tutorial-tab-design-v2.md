# Aba de Tutorial — Design v2 (recriação fiel das telas reais)

Substitui o fluxo descrito em `2026-07-07-tutorial-tab-design.md`. Mantém
inalterados: objetivo, não-objetivos, arquitetura (mainView, sidebar,
componente isolado, zero chamadas reais), visual base e ausência de testes
automatizados. Este documento substitui apenas a seção "Fluxo do wizard".

## Motivação da mudança

O wizard genérico (cards abstratos "Produto de exemplo", "Gerar Atributos"
etc.) não transmite como o fluxo funciona *dentro do produto real*. A versão
2 recria visualmente — em um componente ainda isolado, sem reaproveitar os
componentes reais — a tabela de catálogo e o modal de edição de produto,
para que o usuário veja exatamente as telas que vai usar de verdade.

## Fluxo revisado (4 telas macro)

### 1. Boas-vindas

Inalterado: card centralizado explicando que é uma simulação com produto
fictício, sem custo de créditos. Botão "Começar" leva à tela 2.

### 2. Catálogo (mockup)

Recria o cabeçalho da tabela real de produtos
(`src/App.tsx`, tabela em `paginatedProducts.map`): colunas IMG, SKU,
Título, Categoria, Marca, Status, Ações — mesmas classes
(`bg-[#f7f9fb] border-b border-slate-200`, `text-xs tracking-wider
uppercase` nos headers).

Uma única linha (o produto mock, `MOCK_PRODUCT`) no estado "antes":
- Coluna Status: chips apagados (mesmo componente visual dos badges
  Descrição/Atributos/Imagens, todos em cinza `bg-slate-50 text-slate-300`).
- Coluna Ações: os 4 botões reais (`Eye` "Visualizar", `Tag` "Gerar
  Atributos", `ImageIcon` "Gerar Imagens", `Sparkles` "Gerar Descrição"),
  todos no estilo "pendente" (`bg-white text-slate-400 border-slate-200`).

Um callout (balão pequeno, `bg-slate-900 text-white text-xs rounded-lg`)
aponta para o botão `Sparkles` com o texto "Clique para abrir o produto".
Clicar em qualquer botão de ação ou na linha abre a tela 3 (modal).

### 3. Modal de produto (mockup)

Recria o chrome do `ProductEditModal` real:

**Header** (`h-16 bg-white border-b border-slate-200`): botão voltar
(`ArrowLeft`, volta para a tela 2), foto+SKU+título do produto mock, botão
"Salvar e Fechar" (`bg-[#FF5B03] text-white`) — visual apenas, `onClick`
volta para a tela 2 (equivalente ao "Cancelar/Fechar" real, já que não há o
que salvar). Um botão adicional discreto "Concluir tutorial" fica sempre
visível no header (leva direto à tela 4).

**Sidebar de abas** (mesmas 5 abas reais, mesmos ícones e classes de
`ProductEditModal.tsx:493-503`):
| Aba | Ícone | Conteúdo simulado |
|---|---|---|
| Geral | `Layout` | Campo de categoria pré-preenchido com badge "Detectado por IA" (`MOCK_CATEGORY_PATH.join(' > ')`) |
| Atributos | `Tag` | Header gradiente "Atributos Inteligentes" + botão "Preencher com IA" |
| Conteúdo | `Sparkles` | Header escuro "Escritor Criativo IA" + botão "Gerar Conteúdo Premium" |
| Imagens | `ImageIcon` | Seção "Imagens & Ambientação (IA)" + botão "Gerar Imagens com IA" |
| Vídeo | `Video` | Progresso em estágios (reaproveita o padrão já implementado do widget "Fila de Produção") |

Navegação entre abas é por **clique direto na aba** (`setActiveTab`-like
local state), não por Avançar/Voltar — replicando a UX real. A aba ativa
recebe `bg-orange-50 text-[#FF5B03]`; abas cuja simulação já rodou recebem
o `CheckCircle2` verde à direita, igual ao real.

Conteúdo de cada aba (mock, sem API):

- **Geral**: um `<select>` desabilitado mostrando
  `MOCK_CATEGORY_PATH.join(' > ')` já selecionado, com badge roxo "Sugerido
  por IA" ao lado — não há "Simular geração" aqui, a categoria já vem
  atribuída (reflete o dado computado a partir da descrição no fluxo real).
- **Atributos**: recria o header gradiente
  `from-orange-600 via-purple-600 to-pink-600` com botão "Preencher com IA"
  (`Wand2` + `Loader2` durante loading). Ao concluir, mostra os cards de
  atributo (`MOCK_ATTRIBUTES`) com badge "SUGESTÃO" (`bg-purple-100
  text-purple-600`) e botão "Confirmar" por card — clicar em "Confirmar"
  remove o badge de sugestão e marca a aba como concluída (`CheckCircle2`)
  quando todos os atributos forem confirmados.
- **Conteúdo**: recria o header escuro `bg-slate-900` "Escritor Criativo
  IA" com botão "Gerar Conteúdo Premium" (`Sparkles`/`Loader2`). Ao
  concluir, mostra uma caixa branca com a descrição mock
  (`MOCK_DESCRIPTION_HTML`, renderizada como preview read-only, não
  editável — não reproduz o `WYSIWYGEditor` completo) e uma segunda caixa
  com os campos de SEO (`MOCK_SEO`), replicando os rótulos "Meta Title" /
  "Meta Description" do real.
- **Imagens**: recria a seção com foto grande à esquerda (placeholder
  ilustrativo) e texto explicativo + botão "Gerar Imagens com IA"
  (gradiente laranja, igual ao real). Ao concluir, mostra a grade de 3
  ambientações (mesmo grid `sm:grid-cols-2 md:grid-cols-3` do real).
- **Vídeo**: mantém a implementação já construída (estágios
  "Gerando roteiro..." → "Renderizando cenas..." → "Gerando narração..." →
  "Mixando áudio..." → "Finalizando vídeo...", depois `<video>` com
  fallback). Não replica o fluxo completo de seleção de cena/roteiro do
  `VideoGenerationTab` real (647 linhas) — desproporcional para o tutorial.

### 4. Concluído

Inalterado: resumo + "Reiniciar tutorial" (volta à tela 1) + "Ir para meus
produtos" (`onFinish`).

## Estado

`screen: 'welcome' | 'catalog' | 'modal' | 'done'` controla a tela macro.
Dentro de `'modal'`, `activeTab: 'geral' | 'atributos' | 'conteudo' |
'imagens' | 'video'` controla a aba ativa. Cada aba mantém seu próprio par
`loading`/`generated` (ou `confirmed` por atributo, no caso de Atributos),
igual ao padrão já usado na v1. Nenhum dado ou navegação é persistido —
reabrir a aba Tutorial sempre volta para `'welcome'`.

## Não-objetivos (adicionais a esta versão)

- Não replica o editor WYSIWYG completo (`WYSIWYGEditor`), o fluxo de
  seleção de imagem/roteiro do `VideoGenerationTab`, nem a tabela real com
  múltiplos produtos, paginação ou filtros — apenas os elementos visuais
  necessários para reconhecer as telas reais.
- Não há teclado/acessibilidade avançada além do que os elementos nativos
  (`button`, `select`) já oferecem.
