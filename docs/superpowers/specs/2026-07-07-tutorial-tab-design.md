# Aba de Tutorial — Design

## Objetivo

Adicionar uma aba "Tutorial" na sidebar, acima de "Integrações", que mostra um
passo-a-passo guiado e simulado do fluxo completo do app com um produto
fictício: gerar descrição → atributos → categoria → imagens ambientadas →
vídeo. Serve para novos usuários entenderem o produto sem gastar créditos
nem depender de dados reais.

## Não-objetivos

- Não chama nenhuma API real (Gemini, Firestore, upload).
- Não debita créditos.
- Não reaproveita os componentes reais de produto (`ProductEditModal`,
  `ImageSearchModal` etc.) — eles estão fortemente acoplados ao estado global
  do `App.tsx` (produtos, Firestore, créditos), e usá-los aqui exigiria
  simular esse estado com risco de disparar efeitos colaterais reais.

## Arquitetura

- Novo valor de `mainView`: `'tutorial'`, ao lado de
  `'products' | 'categories' | 'history' | 'integrations'` (`src/App.tsx`).
- Novo botão na sidebar, no bloco fixo inferior (`src/App.tsx`, mesmo bloco
  onde está "Integrações"), posicionado **acima** do botão de Integrações.
  Ícone `GraduationCap` (lucide-react), mesmo padrão visual dos outros itens
  desse bloco.
- Novo componente isolado: `src/components/tutorial/TutorialView.tsx`.
  - Estado 100% local (`useState`/`useEffect` internos ao componente).
  - Nenhuma prop de dados reais é necessária; o componente só precisa,
    opcionalmente, de um callback `onFinish` para voltar a
    `mainView: 'products'` a partir da tela final.
  - Todos os `setTimeout` usados para simular progresso são limpos no
    unmount do componente.
- Renderização em `App.tsx`: um novo ramo
  `mainView === 'tutorial' ? <TutorialView onFinish={() => setMainView('products')} /> : ...`
  seguindo o mesmo padrão de `IntegrationsView`.

## Fluxo do wizard (8 telas)

Stepper no topo (bolinhas numeradas com rótulo curto), botões
"Voltar"/"Avançar" e link "Pular tutorial" (vai para a tela final).
Progresso do wizard não é persistido — sempre recomeça na tela 1 ao reabrir.

1. **Boas-vindas** — título, explicação de que é uma simulação com produto
   fictício e que não consome créditos nem afeta dados reais. Botão "Começar".

2. **Produto de exemplo** — card mostrando o produto mock "antes":
   - SKU: `TENIS-AZUL-42`
   - Nome cru: "TENIS ESPORTIVO MASC AZUL 42"
   - Foto: placeholder ilustrativo (bloco com ícone `ImageIcon` do
     lucide-react e label "Foto do produto"), sem depender de arquivo de
     imagem real.

3. **Gerar Descrição** — botão "Simular geração ✨". Ao clicar:
   - mostra estado de "gerando..." por ~1.2s (spinner, mesmo padrão visual
     usado nos botões de geração reais);
   - revela um preview HTML mock de descrição de produto + título e meta
     description SEO (texto plausível e fixo, em pt-BR).
   - Botão "Avançar" só habilita depois da simulação rodar (ou o usuário
     pode rodar de novo).

4. **Gerar Atributos** — botão "Simular geração ✨" com o mesmo padrão de
   loading; revela uma lista de atributos como chips/badges (ex: Cor: Azul,
   Material: Mesh, Tamanho: 42), no estilo visual das badges já usadas no
   catálogo.

5. **Categorizar** — mostra a atribuição do produto a uma categoria mock em
   árvore (ex: Calçados > Esportivo > Tênis), com uma pequena transição/
   animação indicando o "encaixe" na hierarquia.

6. **Gerar Imagens Ambientadas** — botão "Simular geração ✨"; revela 3
   placeholders ilustrativos lado a lado (blocos com ícone de imagem e
   label "Ambientação 1/2/3"), no mesmo estilo de grid usado no
   `ImageSearchModal`.

7. **Gerar Vídeo** — reaproveita visualmente o padrão do widget "Fila de
   Produção" já existente no sidebar (barra de progresso + steps: roteiro →
   cenas → narração → mixagem → render), com timers falsos avançando por
   ~4-5s no total. Ao concluir:
   - renderiza `<video controls src="/tutorial/demo-video.mp4" />`;
   - se o arquivo não existir (evento `onError` do `<video>`), mostra um
     fallback amigável: ícone de vídeo + texto "Vídeo de exemplo em breve"
     (não é um erro visível ao usuário, é tratado como estado esperado).
   - O arquivo real deve ser colocado em `public/tutorial/demo-video.mp4`
     (fora do escopo desta implementação — será adicionado depois).

8. **Conclusão** — resumo em bullets do que foi mostrado, com dois botões:
   "Ir para meus produtos" (chama `onFinish`) e "Reiniciar tutorial" (volta
   ao passo 1).

## Visual

Reaproveita a paleta e classes Tailwind já usadas no app (`#FF5B03` como cor
de destaque, cards `rounded-2xl border border-slate-200 shadow-sm`, botões
no padrão dos demais CTAs). Não introduz um novo design system nem
dependências novas.

## Testes

Não há suíte automatizada no projeto (validação manual via `npm run dev`,
conforme `CLAUDE.md`). Validação: abrir a aba Tutorial, percorrer as 8 telas
avançando e voltando, confirmar que nenhuma chamada de rede é feita
(DevTools → Network) e que os créditos exibidos no header não mudam.
