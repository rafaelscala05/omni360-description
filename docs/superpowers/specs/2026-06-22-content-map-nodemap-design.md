---
title: Meu Mapa de Conteúdo — Nodemap
date: 2026-06-22
status: approved
---

# Meu Mapa de Conteúdo — Design Spec

## Resumo

Adicionar duas funcionalidades relacionadas ao módulo de Conteúdo (Alfred):

1. **Nodemap "Meu Mapa de Conteúdo"** no Painel de Operações (`DashboardPanel`), mostrando a hierarquia Site → Clusters → Artigos com tamanho de nó proporcional ao volume de pesquisas.
2. **Edição manual de volumes e adição de palavras-chave** no `ClusterDetailView`, seção "Palavras-chave por intenção".

---

## Parte 1 — Nodemap no DashboardPanel

### Posicionamento

Seção abaixo dos 3 cards existentes ("Em produção", "Concluídos", "Próximas publicações"), ocupando largura total do painel, altura fixa de 520px.

### Hierarquia de nós

```
Site principal (hub, centro fixo)
  └── Cluster A
        ├── Artigo 1
        └── Artigo 2
  └── Cluster B
        └── Artigo 3
```

### Layout

Radial manual calculado em React:
- Site no centro do canvas
- Clusters distribuídos em ângulos iguais (360° / n) a um raio R₁ fixo do centro
- Artigos distribuídos em ângulos iguais ao redor do seu cluster pai, a um raio R₂ fixo

### Sizing dos nós

| Nó | Fórmula de raio | Mínimo | Máximo |
|---|---|---|---|
| Site | fixo | 40px | 40px |
| Cluster | `clamp(20, 50, sumVolumes / 500)` | 20px | 50px |
| Artigo | `clamp(8, 20, kwVolume / 500)` | 8px | 20px |

- `sumVolumes` = soma de todos os `volume` das `palavrasChave` do cluster (ignora `undefined`)
- `kwVolume` = volume da keyword no cluster que corresponde ao `kwPrincipal` do artigo; se não encontrar, usa 10px (tamanho padrão)

### Cores

Paleta de 8 cores por índice de cluster. Artigos herdam cor do cluster pai com opacidade reduzida.

```ts
const CLUSTER_COLORS = [
  '#f97316', // orange
  '#10b981', // emerald
  '#8b5cf6', // violet
  '#f59e0b', // amber
  '#14b8a6', // teal
  '#f43f5e', // rose
  '#6366f1', // indigo
  '#06b6d4', // cyan
];
```

- Site: `#004ac6` (brand)
- Edges: `stroke="#cbd5e1"`, espessura 1px

### Biblioteca

`@xyflow/react` (React Flow v12+). Nós e edges configurados via arrays de objetos. Pan/zoom nativos habilitados.

### Tipos de nós customizados

- `SiteNode` — círculo fixo grande, label "Site"
- `ClusterNode` — círculo tamanho variável, label = `cluster.nome`, tooltip com volume total
- `ArticleNode` — círculo pequeno, label = título truncado, tooltip com título completo e status

### Interatividade

- Hover em qualquer nó: tooltip nativo React Flow com nome + volume (ou "sem volume")
- Click em ClusterNode: chama callback `onSelectCluster(clusterId)` → DashboardPanel navega para ClustersView com aquele cluster

### Dados necessários

`DashboardPanel` já recebe `uid` e `projectId`. Precisa subscrever também a:
- `listenClusters(uid, projectId, ...)` — para obter clusters + palavrasChave
- `listenCalendar(uid, projectId, ...)` — para obter artigos (já subscrito)

### Arquivo a criar

`src/modules/content/ContentMapView.tsx` — componente isolado que recebe `clusters`, `articles`, e `onSelectCluster`. `DashboardPanel` importa e renderiza abaixo dos cards.

---

## Parte 2 — Edição de Volumes e KWs no ClusterDetailView

### Localização

Seção "Palavras-chave por intenção" em `ClusterDetailView.tsx`.

### Comportamento atual

Cada KW exibe: termo + volume (ou `—`). Volume é somente leitura.

### Novo comportamento

#### Modo leitura (cada KW chip):

```
[● Informacional]  marketing digital  1.200/mês  [✏️]  [🗑️]
```

#### Modo edição inline (ao clicar ✏️):

Linha expande para formulário inline:
- Input texto: termo (pré-preenchido)
- Select: intenção (informacional / comercial / transacional / navegacional)
- Input numérico: volume/mês (opcional)
- Botões: Salvar | Cancelar

#### Adicionar nova palavra-chave

Botão `+ Adicionar palavra-chave` no rodapé da seção de KWs. Abre formulário inline (mesmos campos, vazios).

#### Excluir palavra-chave

Botão 🗑️ em cada chip. Remove a KW e salva imediatamente.

### Persistência

Novo helper em `contentService.ts`:

```ts
export async function updateClusterKeywords(
  uid: string,
  projectId: string,
  clusterId: string,
  keywords: ClusterKeyword[],
): Promise<void>
```

Faz `updateDoc` no doc do cluster com `{ palavrasChave: keywords }`.

### Tipos

Nenhuma mudança em `types.ts` — `volume?: number` já existe em `ClusterKeyword`.

### Nota futura

Quando a API de Search Insights for integrada, apenas substitui os valores de `volume` via batch — a estrutura de dados não muda.

---

## Arquivos a criar/modificar

| Arquivo | Ação |
|---|---|
| `src/modules/content/ContentMapView.tsx` | Criar — nodemap React Flow |
| `src/modules/content/DashboardPanel.tsx` | Modificar — adicionar seção Mapa + subscrever clusters |
| `src/modules/content/ClusterDetailView.tsx` | Modificar — edição inline de KWs + adicionar KW |
| `src/services/contentService.ts` | Modificar — adicionar `updateClusterKeywords` |
| `package.json` | Modificar — adicionar `@xyflow/react` |

---

## Fora do escopo

- Integração com API de Search Insights (futuro)
- Drag de nós no mapa (os nós são posicionados automaticamente)
- Click em ArticleNode navegar para o artigo (pode ser adicionado depois)
