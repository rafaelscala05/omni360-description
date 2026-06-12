# Ambient Image Generation — Melhoria de Fidelidade Visual

**Data:** 2026-06-11  
**Status:** Aprovado  
**Escopo:** `server.ts`, `src/components/ImageSearchModal.tsx`

---

## Problema

O fluxo atual de geração de imagens ambientadas tem dois problemas que se reforçam:

1. **Deriva visual do produto** — nas imagens 1 e 2 (com pessoa), o Imagen re-renderiza o produto podendo mudar cor, forma e detalhes porque o prompt de texto não descreve os atributos visuais específicos.
2. **Prompts genéricos** — o Gemini gera prompts baseado apenas em campos de texto (`Descrição`, `Marca`, `Categoria`) sem ver a imagem real, e os prompts saem em português (subótimo para Imagen, treinado majoritariamente em inglês).

A imagem já é enviada ao Imagen via `referenceImages` — o problema não é a ausência da referência, mas a fraqueza do texto do prompt que a acompanha.

---

## Solução

### 1. Reordenação do fluxo no frontend

**Antes:**
```
generate-prompts(texto) → process-image → generate-images × 3
```

**Depois:**
```
process-image → generate-prompts(texto + base64) → generate-images × 3
```

A imagem é processada primeiro para que o Gemini possa analisá-la visualmente ao gerar os prompts.

### 2. Prompt multimodal no Gemini (`/api/gemini/generate-ambient-prompts`)

O endpoint passa a aceitar `base64Data` e `mimeType` além dos campos textuais. A requisição ao Gemini 2.5 Flash inclui a imagem do produto.

O prompt instrui o Gemini a:

1. Analisar visualmente o produto: cor(es) e acabamento, material(is), forma, identificadores visuais distintos (logo, padrão, textura)
2. Usar essa análise para gerar 3 prompts **em inglês** com a descrição visual embutida:

   - **Prompt 0 (BGSWAP):** descreve APENAS o novo fundo/ambiente. NÃO descreve o produto — os pixels serão preservados. Foco: cena, iluminação, contexto de uso.
   - **Prompt 1 (Produto em uso):** pessoa usando o produto naturalmente. DEVE incluir a descrição visual exata extraída (ex: "same matte black aluminum product with red logo"). Descreve pessoa, ação, ambiente.
   - **Prompt 2 (Escala e tamanho):** pessoa segurando/ao lado do produto para mostrar tamanho real. DEVE incluir a descrição visual. Fundo neutro, foco na proporção.

O endpoint retorna:
```json
{
  "prompts": ["p0", "p1", "p2"],
  "productDescription": "descrição visual extraída pelo Gemini"
}
```

`productDescription` é armazenado no estado do componente para uso futuro (exibição, edição pelo usuário).

### 3. Migração para Imagen 4 (`/api/gemini/generate-ambient-images`)

```
Antes: imagen-3.0-capability-001
Depois: imagen-4.0-generate-001
```

O payload estrutural permanece idêntico:
- `imageIndex === 0`: `REFERENCE_TYPE_RAW` + `EDIT_MODE_BGSWAP`
- `imageIndex === 1, 2`: `REFERENCE_TYPE_SUBJECT` + `SUBJECT_TYPE_PRODUCT`

Se o modelo retornar 404 ou `model not found`, o erro deve indicar explicitamente para verificar a disponibilidade regional do Imagen 4 no `VERTEX_LOCATION` configurado.

### 4. Remoção do delay hardcoded

O `setTimeout(2000)` entre as 3 chamadas ao Imagen é removido. O retry com backoff exponencial já implementado em `callGenerateImage` é suficiente para lidar com rate limits.

---

## Arquivos alterados

| Arquivo | Mudança |
|---|---|
| `src/components/ImageSearchModal.tsx` | Inverter ordem de `process-image` e `generate-prompts`; passar `base64Data`+`mimeType` ao endpoint de prompts; armazenar `productDescription` no estado; remover `setTimeout(2000)` |
| `server.ts` | `/generate-ambient-prompts`: aceitar `base64Data`+`mimeType`, enviar multimodal ao Gemini, gerar prompts em inglês com descrição visual; `/generate-ambient-images`: trocar model ID para `imagen-4.0-generate-001` |

---

## O que não muda

- Estrutura de UI e UX do modal (2 steps: search → ambient)
- Lógica de `callGenerateImage` com retry/backoff
- Upload final das imagens via `/api/upload`
- Payload `referenceImages` enviado ao Imagen
- Campos retornados ao frontend (`image`, `usage`)
- Créditos consumidos por operação

---

## Riscos

| Risco | Mitigação |
|---|---|
| Imagen 4 indisponível na região configurada | Mensagem de erro clara orientando verificar `VERTEX_LOCATION` no `.env` |
| Gemini falha ao extrair descrição visual (imagem baixa qualidade) | Se `productDescription` vier vazio, prompts continuam funcionando (baseados no texto) |
| Latência extra do Gemini multimodal | +3–6s aceitável dado que qualidade é prioridade (confirmado pelo usuário) |
