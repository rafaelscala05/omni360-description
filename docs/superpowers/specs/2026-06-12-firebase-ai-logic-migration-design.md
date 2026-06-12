# Migração das Chamadas de IA para Firebase AI Logic

**Data:** 2026-06-12
**Status:** Aprovado para planejamento

## Objetivo

Centralizar toda a geração de IA (texto e imagem) no **Firebase AI Logic** usando o SDK `firebase/ai` com `VertexAIBackend('global')`, eliminando o `GEMINI_API_KEY` e os 7 endpoints `/api/gemini/*` do `server.ts`. As chamadas passam a rodar no client (browser), autenticadas via Firebase.

## Contexto Atual

Hoje o fluxo é:

```
Frontend → fetch('/api/gemini/...') → server.ts → @google/genai → Gemini API (GEMINI_API_KEY)
```

Os 7 endpoints no `server.ts`:

1. `generate-description` — descrição HTML + SEO, texto+imagem, schema estruturado
2. `generate-attributes` — atributos via texto, JSON
3. `generate-attributes-from-image` — atributos via imagem, JSON
4. `generate-category-hierarchy` — árvore de categorias, JSON
5. `generate-ambient-prompts` — gera 3 prompts em inglês, texto+imagem, JSON
6. `generate-ambient-images` — geração de imagem (`gemini-2.5-flash-image`)
7. `enrich-product-data` — GTIN/NCM/dimensões via Google Search grounding

## Arquitetura Nova

```
Frontend → firebase/ai (VertexAIBackend) → Vertex AI (via Firebase Auth)
```

O servidor deixa de orquestrar IA. Apenas `/api/upload` permanece.

### SDK confirmado (`firebase ^12.12.0`)

Exports verificados em `firebase/ai`: `getAI`, `getGenerativeModel`, `VertexAIBackend`, `ResponseModality` (`TEXT`/`IMAGE`), `Schema` (helpers `object`/`array`/`string`/`integer`/`number`/`boolean`/`enumString`/`anyOf`), `SchemaType`, `HarmCategory`, `HarmBlockThreshold`. A tool `googleSearch` é suportada (`GoogleSearchTool`). `systemInstruction` aceito em `ModelParams`.

## Arquivos

### Novos

**`src/services/aiService.ts`** — núcleo do Firebase AI:

```typescript
import { getAI, getGenerativeModel, VertexAIBackend } from 'firebase/ai';
import { app } from '../firebase';

const ai = getAI(app, { backend: new VertexAIBackend('global') });

export const textModel  = getGenerativeModel(ai, { model: 'gemini-2.5-flash' });
export const imageModel = getGenerativeModel(ai, {
  model: 'gemini-2.5-flash-image',
  generationConfig: { responseModalities: [ResponseModality.TEXT, ResponseModality.IMAGE] },
  safetySettings: [...4 categorias OFF],
});
export const enrichModel = getGenerativeModel(ai, {
  model: 'gemini-2.5-flash',
  tools: [{ googleSearch: {} }],
  systemInstruction: '...',
});
```

Helpers exportados:
- `withRetry(fn)` — backoff em 503/UNAVAILABLE, 3 tentativas (réplica de `generateContentWithFallback`)
- `extractImage(result)` — varre `candidates[].content.parts[].inlineData.data`
- `parseJsonResponse(text)` — strip de fences ```` ```json ```` + fallback regex `{...}`

**`src/utils/imageUtils.ts`** — extrai `fetchAndProcessImage` do `ImageSearchModal` (carrega imagem, tenta Firebase Storage SDK, depois fetch direto, depois 4 proxies CORS públicos; normaliza para JPEG ≤1024px). Compartilhado entre `ImageSearchModal` e `productService` (geração de descrição).

### Modificados

| Arquivo | Mudança |
|---|---|
| `src/firebase.ts` | Exportar `app` |
| `src/services/productService.ts` | 3 `fetch()` → `textModel`; monta prompts (movidos do server); usa `imageUtils` |
| `src/services/categoryService.ts` | 1 `fetch()` → `textModel` |
| `src/App.tsx` | `enrich-product-data` `fetch()` → `enrichModel` |
| `src/components/ImageSearchModal.tsx` | 2 `fetch()` → `textModel` + `imageModel`; remove `fetchAndProcessImage` local (importa de `imageUtils`) |
| `server.ts` | Remove os 7 endpoints `/api/gemini/*`; mantém só `/api/upload`; remove helpers de IA (`getGeminiClient`, `generateContentWithFallback`, `handleGeminiError`, `getVertexClient`) e imports de `@google/genai` |

## Diferenças de API (`@google/genai` → `firebase/ai`)

| Aspecto | Antes | Depois |
|---|---|---|
| Texto da resposta | `response.text` (prop) | `result.response.text()` (método) |
| Config | `config: {...}` | `generationConfig: {...}` no modelo/chamada |
| Schema | `Type.OBJECT` | `Schema.object({...})` / `SchemaType.OBJECT` |
| Google Search | `config.tools` | `tools` no modelo |
| Safety | `config.safetySettings` | `safetySettings` no modelo |
| Modalidades | `Modality.IMAGE` | `ResponseModality.IMAGE` |
| Imports | `@google/genai` | `firebase/ai` |

### Extração de imagem (geração de imagem)

```typescript
for (const candidate of result.response.candidates ?? []) {
  for (const part of candidate.content?.parts ?? []) {
    if (part.inlineData?.data) { imageData = part.inlineData.data; break; }
  }
}
```

## Detalhe por chamada

1. **generate-description** — prompt montado no client (template replace, `visualEnhancementRules`, `attributeInstructions`); imagem via `fetchAndProcessImage` → `inlineData`; modelo dedicado com `responseSchema` reescrito em `Schema.object`.
2. **generate-attributes** — prompt no client; `textModel` JSON mode, temp 0.2.
3. **generate-attributes-from-image** — `inlineData` + prompt; JSON mode, temp 0.2.
4. **generate-category-hierarchy** — prompt no client; JSON mode, temp 0.2.
5. **generate-ambient-prompts** — prompt grande em inglês vira constante no client; texto+imagem; JSON mode.
6. **generate-ambient-images** — `imageModel` com `responseModalities: [TEXT, IMAGE]` + 4 `safetySettings` OFF; extrai `inlineData` → `data:image/png;base64,...`.
7. **enrich-product-data** — `enrichModel` com `googleSearch` + `systemInstruction`. **Não** forçar `responseMimeType: json` (grounding costuma ignorar); manter parsing tolerante (`parseJsonResponse`).

## Tratamento de Erro

`handleGeminiError` (server) é descartado. Cada serviço no client trata inline: detecção de quota (429/RESOURCE_EXHAUSTED) e mensagem genérica. Sem `GEMINI_API_KEY`, mensagens sobre chave inválida deixam de ser relevantes.

## Considerações

- **Firebase AI Logic precisa estar habilitado** no console Firebase (API Vertex AI no projeto). Pré-requisito de infra, fora do código.
- **Token usage**: o endpoint de enriquecimento hoje retorna `usageMetadata`. No client, ler de `result.response.usageMetadata` se disponível; caso contrário zerar (consistente com `generate-ambient-images` que já zera).
- **Créditos**: a lógica de débito de créditos (Firestore, em `App.tsx`/`ImageSearchModal`) permanece intacta — independe de onde a IA roda.

## Fora de Escopo

- Refatoração não relacionada.
- Remoção dos arquivos `test_*.ts` na raiz (já usam `@google/genai`/`GEMINI_API_KEY` diretamente; não fazem parte do runtime do app).
- Configuração de infra do Firebase AI Logic (habilitação de API).
