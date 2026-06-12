# Ambient Image Generation — Melhoria de Fidelidade Visual

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Melhorar a fidelidade visual das imagens ambientadas geradas pelo Imagen 4, fazendo o Gemini analisar a imagem do produto antes de gerar prompts em inglês com descrição visual embutida.

**Architecture:** O frontend processa a imagem primeiro e a envia ao backend junto com dados textuais. O Gemini faz uma análise multimodal do produto e retorna 3 prompts em inglês com atributos visuais específicos. O Imagen 4 usa esses prompts junto com a imagem de referência para gerar cenas com produto reconhecível.

**Tech Stack:** Express/TypeScript (`server.ts`), `@google/genai` SDK (Vertex AI), React 19 (`ImageSearchModal.tsx`), Vertex AI Imagen 4 REST API.

---

## Arquivos modificados

- `server.ts:551–652` — endpoint `/generate-ambient-images`: trocar model ID
- `server.ts:656–707` — endpoint `/generate-ambient-prompts`: aceitar base64, multimodal, prompts em inglês
- `src/components/ImageSearchModal.tsx:170–228` — `handleGenerateAmbient`: inverter ordem, passar base64, remover delay

---

## Task 1: Migrar Imagen 3 → Imagen 4

**Files:**
- Modify: `server.ts:575`

- [ ] **Trocar o model ID na linha 575 de `server.ts`**

Localizar a linha:
```typescript
const model = 'imagen-3.0-capability-001';
```

Substituir por:
```typescript
const model = 'imagen-4.0-generate-001';
```

- [ ] **Melhorar a mensagem de erro para orientar sobre disponibilidade regional**

Localizar o bloco de erro na linha ~636:
```typescript
throw new Error(`Erro na Vertex API (${vertexResponse.status}): ${errMsg}`);
```

Substituir por:
```typescript
const regionHint = vertexResponse.status === 404
  ? ` Verifique se o Imagen 4 está disponível na região configurada em VERTEX_LOCATION (atual: "${process.env.VERTEX_LOCATION || 'us-central1'}"). Tente trocar para "us-central1".`
  : '';
throw new Error(`Erro na Vertex API (${vertexResponse.status}): ${errMsg}${regionHint}`);
```

- [ ] **Iniciar o servidor e confirmar que ele sobe sem erros**

```bash
npm run dev
```

Expected: servidor iniciando na porta 3000 sem erros de compilação TypeScript.

- [ ] **Commit**

```bash
git add server.ts
git commit -m "feat: migrate Imagen 3 to Imagen 4 for ambient image generation"
```

---

## Task 2: Atualizar `/generate-ambient-prompts` para multimodal + inglês

**Files:**
- Modify: `server.ts:656–707`

- [ ] **Substituir o corpo completo do endpoint `/generate-ambient-prompts`**

Localizar de `app.post("/api/gemini/generate-ambient-prompts"` até o fechamento `});` na linha ~707 e substituir pelo seguinte:

```typescript
  app.post("/api/gemini/generate-ambient-prompts", async (req, res) => {
    try {
      const { productName, brand, category, description, base64Data, mimeType } = req.body;
      if (!productName) {
        return res.status(400).json({ error: "productName é obrigatório." });
      }

      const productContext = [productName, brand, category, description]
        .filter(Boolean)
        .join(". ");

      const prompt = `You are an expert in product photography and AI image generation for e-commerce.

${base64Data ? 'Analyze the product image provided and use your visual observation as the primary source of truth.' : ''}
Use the following product information as additional context: ${productContext}

Your task is to generate 3 image generation prompts in ENGLISH for use with Google Imagen 4.

${base64Data ? `Step 1 — Visual analysis: Carefully observe the product in the image and identify:
- Primary and secondary colors with finish (matte, glossy, metallic, transparent, etc.)
- Materials visible (plastic, metal, fabric, wood, glass, rubber, etc.)
- Shape and form factor
- Distinctive visual features: logo placement, patterns, textures, unique design elements

Step 2 — ` : ''}Generate 3 prompts following this exact order and format. Prompts 1 and 2 MUST embed the specific visual attributes${base64Data ? ' from your Step 1 analysis' : ' of the product'} so Google Imagen recreates the exact same product appearance.

Prompt 0 — Background replacement (BGSWAP mode): Describe ONLY the new background environment. Do NOT describe the product — it will be composited pixel-perfect from the reference image. Focus on: the scene/setting, lighting quality and direction, surrounding objects, context of use, atmosphere. Be specific and cinematic. Example: "Modern kitchen countertop with white marble surface, warm golden hour sunlight from a side window, fresh herbs and a linen cloth nearby, soft bokeh background"

Prompt 1 — Product in use: A person using the product naturally in everyday life. MUST explicitly include the product's visual appearance (e.g. "same matte black aluminum bottle with red logo and silver cap"). Describe: the person (age range, casual/professional), the action, the environment, the lighting, the mood. The product must look identical to the reference.

Prompt 2 — Scale reference: A person holding or standing next to the product to clearly show its real size. MUST explicitly include the product's visual appearance. Use a clean neutral background. Focus on the size proportion between person and product. The product must look identical to the reference.

Return ONLY valid JSON with this exact structure, no markdown, no explanations:
{"prompts": ["prompt0", "prompt1", "prompt2"], "productDescription": "concise visual description of the product (colors, materials, key features)"}`;

      const client = getVertexClient();

      const parts: any[] = [];
      if (base64Data) {
        const cleanBase64 = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
        parts.push({ inlineData: { mimeType: mimeType || 'image/jpeg', data: cleanBase64 } });
      }
      parts.push({ text: prompt });

      const response = await client.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{ role: "user", parts }],
        config: { responseMimeType: "application/json" }
      });

      const raw = response.text?.trim() || "{}";
      let parsed: { prompts?: string[]; productDescription?: string };
      try {
        parsed = JSON.parse(raw);
      } catch {
        const match = raw.match(/\{[\s\S]*\}/);
        parsed = match ? JSON.parse(match[0]) : {};
      }

      if (!Array.isArray(parsed.prompts) || parsed.prompts.length !== 3) {
        throw new Error("Gemini não retornou 3 prompts no formato esperado.");
      }

      res.json({ prompts: parsed.prompts, productDescription: parsed.productDescription || '' });
    } catch (error: any) {
      console.error("Backend error generating ambient prompts:", error.message || error);
      res.status(500).json({ error: error.message || "Erro desconhecido ao gerar prompts." });
    }
  });
```

- [ ] **Reiniciar o servidor e confirmar que sobe sem erros de TypeScript**

```bash
npm run dev
```

Expected: servidor na porta 3000 sem erros.

- [ ] **Testar o endpoint manualmente via curl (sem imagem)**

```bash
curl -X POST http://localhost:3000/api/gemini/generate-ambient-prompts \
  -H "Content-Type: application/json" \
  -d '{"productName":"Garrafa Térmica Inox 500ml","brand":"Stanley","category":"Utilidades"}'
```

Expected: JSON com `{"prompts": ["...", "...", "..."], "productDescription": "..."}` onde os 3 prompts estão em inglês.

- [ ] **Commit**

```bash
git add server.ts
git commit -m "feat: multimodal ambient prompt generation with English prompts and visual anchoring"
```

---

## Task 3: Atualizar `ImageSearchModal.tsx` — reordenar fluxo e passar base64

**Files:**
- Modify: `src/components/ImageSearchModal.tsx:24–27` (estado)
- Modify: `src/components/ImageSearchModal.tsx:170–228` (handleGenerateAmbient)

- [ ] **Adicionar estado `productDescription` após a linha 27**

Localizar:
```typescript
  const [tokenUsage, setTokenUsage] = useState({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
```

Substituir por:
```typescript
  const [tokenUsage, setTokenUsage] = useState({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
  const [productDescription, setProductDescription] = useState('');
```

- [ ] **Resetar `productDescription` no `useEffect` (linha ~33)**

Localizar dentro do useEffect:
```typescript
      setImagePrompts(['', '', '']);
      setTokenUsage({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
```

Substituir por:
```typescript
      setImagePrompts(['', '', '']);
      setTokenUsage({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
      setProductDescription('');
```

- [ ] **Resetar `productDescription` em `handleClose` (linha ~296)**

Localizar dentro de `handleClose`:
```typescript
    setImageRegenerating([false, false, false]);
    onClose();
```

Substituir por:
```typescript
    setImageRegenerating([false, false, false]);
    setProductDescription('');
    onClose();
```

- [ ] **Substituir o corpo de `handleGenerateAmbient` — inverter ordem e passar base64**

Localizar a função `handleGenerateAmbient` completa (linhas 170–229) e substituir por:

```typescript
  const handleGenerateAmbient = async () => {
    if (!selectedImageUrl || !product) return;
    if (!(await consumeCredit('Geração de Ambientação', product['Descrição'], product['Código (SKU)']))) return;

    setIsGenerating(true);
    setStep('ambient');

    try {
      // 1. Process image first — needed by Gemini for visual analysis
      const { base64Data, mimeType } = await fetchAndProcessImage(selectedImageUrl);

      // 2. Generate prompts WITH the product image so Gemini can visually anchor them
      const promptsRes = await fetch('/api/gemini/generate-ambient-prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productName: product['Descrição'] || '',
          brand: product['Marca'] || '',
          category: product['Categoria'] || '',
          description: product['Descrição complementar'] || '',
          base64Data,
          mimeType
        })
      });

      if (!promptsRes.ok) {
        const err = await promptsRes.json().catch(() => ({}));
        throw new Error(err.error || 'Erro ao gerar prompts de ambientação.');
      }

      const { prompts, productDescription: desc } = await promptsRes.json();
      setImagePrompts(prompts);
      if (desc) setProductDescription(desc);

      // 3. Generate all 3 ambient images (retry/backoff handled inside callGenerateImage)
      const validImages: string[] = [];
      for (let i = 0; i < 3; i++) {
        try {
          const imgData = await callGenerateImage(base64Data, mimeType, prompts[i], i);
          validImages.push(imgData || '');
        } catch (genError: any) {
          const isQuota = /429|RESOURCE_EXHAUSTED|quota|limite/.test(genError.message || "");
          if (isQuota && validImages.length > 0) break;
          if (i === 0) throw genError;
          validImages.push('');
        }
      }

      if (validImages.every(img => !img)) throw new Error("Não foi possível gerar nenhuma imagem.");
      setAmbientImages(validImages);

    } catch (error: any) {
      console.error("Erro ao gerar ambientações:", error);
      const isQuota = /429|RESOURCE_EXHAUSTED|quota|limite/.test(error.message || "");
      alert(isQuota
        ? "O limite de uso da IA foi atingido (Erro 429). Aguarde um momento e tente novamente."
        : `Erro: ${error.message || "Erro ao processar a imagem."}`
      );
      setStep('search');
    } finally {
      setIsGenerating(false);
    }
  };
```

- [ ] **Reiniciar o servidor e confirmar que sobe sem erros**

```bash
npm run dev
```

Expected: sem erros de TypeScript no terminal.

- [ ] **Commit**

```bash
git add src/components/ImageSearchModal.tsx
git commit -m "feat: process image before prompt generation, pass base64 for visual analysis, remove 2s delay"
```

---

## Task 4: Validação manual end-to-end

- [ ] **Abrir o app em http://localhost:3000**

- [ ] **Selecionar um produto com URL de imagem conhecida**

Colar uma URL de imagem de produto no campo e clicar em "Gerar Ambientações".

- [ ] **Verificar no terminal do servidor os logs de debug**

Expected nos logs:
```
[DEBUG] imageIndex: 0, mode: BGSWAP (direct image)
[DEBUG] imageIndex: 1, mode: SUBJECT_REFERENCE
[DEBUG] imageIndex: 2, mode: SUBJECT_REFERENCE
```

Confirmar que não há erro `model not found` (Imagen 4 disponível na região).

- [ ] **Verificar os prompts gerados**

Na UI, os campos de texto abaixo de cada imagem devem conter texto em inglês (não português).

- [ ] **Verificar fidelidade visual**

As 3 imagens geradas devem mostrar o mesmo produto (cor, forma, material reconhecíveis). A imagem 0 (BGSWAP) deve ser pixel-perfeita no produto.

- [ ] **Testar regeneração individual**

Editar o prompt de uma das imagens e clicar em "Gerar novamente". Confirmar que regenera com sucesso.

- [ ] **Testar fallback sem base64 (garantia de retrocompatibilidade)**

```bash
curl -X POST http://localhost:3000/api/gemini/generate-ambient-prompts \
  -H "Content-Type: application/json" \
  -d '{"productName":"Cadeira de Escritório","brand":"Herman Miller"}'
```

Expected: prompts retornados em inglês mesmo sem imagem.
