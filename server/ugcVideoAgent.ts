// server/ugcVideoAgent.ts
//
// UGC ("user-generated content") video pipeline: a user-created avatar speaks
// to camera and interacts with the product, instead of the classic pipeline's
// muted hands + voice-over. Mirrors server/videoAgent.ts's shape, reusing the
// generic Veo/ffmpeg/credit helpers from server/videoShared.ts.
// See docs/superpowers/specs/2026-09-23-ugc-avatar-video-design.md.
import type express from 'express';
import {
  getGeminiClient, TEXT_MODEL, fetchImageAsBase64, formatAttributes, sendError,
} from './videoShared';

export interface UgcVideoClip {
  papel: 'gancho' | 'demonstracao' | 'cta';
  fala: string;
  acaoVisual: string;
}

export interface UgcVideoScript {
  cena: string;
  avatarDescricao: string;
  clipes: UgcVideoClip[];
}

interface VideoDeps {
  verifyFirebaseToken: (req: express.Request) => Promise<import('firebase-admin/auth').DecodedIdToken>;
}

const UGC_ROLES = ['gancho', 'demonstracao', 'cta'] as const;

export function validateUgcScript(parsed: any): parsed is UgcVideoScript {
  if (!parsed || typeof parsed.cena !== 'string' || !parsed.cena.trim()) return false;
  if (typeof parsed.avatarDescricao !== 'string') return false;
  if (!Array.isArray(parsed.clipes) || parsed.clipes.length < 2 || parsed.clipes.length > 3) return false;
  return parsed.clipes.every((c: any) =>
    c &&
    (UGC_ROLES as readonly string[]).includes(c.papel) &&
    typeof c.fala === 'string' && c.fala.trim() &&
    typeof c.acaoVisual === 'string' && c.acaoVisual.trim());
}

export function buildUgcScriptPrompt(params: {
  description: string;
  brand: string;
  productName: string;
  category: string;
  attributes: Record<string, string>;
  avatarDescricao: string;
}): string {
  const { description, brand, productName, category, attributes, avatarDescricao } = params;

  return `Você é um roteirista de vídeos UGC (User Generated Content) para redes sociais e páginas de produto.

Crie um roteiro de vídeo VERTICAL (9:16) em que um AVATAR (uma pessoa) aparece falando diretamente para a câmera, interagindo com o produto — no estilo de um vídeo de influenciador real, não uma peça publicitária de estúdio.

**Avatar (a pessoa que vai aparecer no vídeo):**
${avatarDescricao}

**Informações do produto:**
${productName ? `Nome: ${productName}\n` : ''}${category ? `Categoria: ${category}\n` : ''}${brand ? `Marca: ${brand}\n` : ''}Descrição: ${description}

**Atributos do produto (use no máximo 1 a 2 dos mais relevantes):**
${formatAttributes(attributes)}

**REGRAS OBRIGATÓRIAS:**
- Formato VERTICAL (9:16), estilo UGC autêntico (câmera na mão ou tripé caseiro, iluminação natural, estética espontânea — não é produção de estúdio comercial).
- O AVATAR aparece em quadro, olha e fala DIRETAMENTE para a câmera, segurando/usando o produto.
- Gere de 2 a 3 clipes de ~8s cada, nos papéis, NESTA ORDEM:
  1) "gancho": primeiros segundos, prende atenção — o avatar reage ao produto ou faz uma pergunta/afirmação chamativa.
  2) "demonstracao": o avatar usa/mostra o produto, citando 1 a 2 atributos reais (nunca invente características).
  3) "cta" (opcional, só inclua se o roteiro tiver 3 clipes): fechamento com chamada para ação.
- "fala": o que o avatar diz, em português do Brasil, tom espontâneo e conversacional (nunca comercial engessado), no máximo ~20 palavras (cabe em ~8s falado).
- "acaoVisual": o que acontece na cena além da fala (gestos, ângulo de câmera, manipulação do produto).
- Nunca invente atributos que não estejam na lista de atributos ou na descrição.

**CAMPOS (responda em pt-BR):**
- cena: ambientação coerente entre os clipes (ex.: "quarto iluminado, luz natural de janela") (máx. 120 caracteres).
- avatarDescricao: repita a descrição do avatar fornecida acima, sem alterações.
- clipes: array de 2 a 3 objetos, cada um com "papel", "fala" e "acaoVisual".

Retorne APENAS um JSON válido neste formato exato (sem markdown, sem texto extra):
{
  "cena": "...",
  "avatarDescricao": "...",
  "clipes": [
    { "papel": "gancho", "fala": "...", "acaoVisual": "..." },
    { "papel": "demonstracao", "fala": "...", "acaoVisual": "..." }
  ]
}`;
}

export async function generateUgcScript(
  params: {
    description: string;
    brand: string;
    productName: string;
    category: string;
    attributes: Record<string, string>;
    avatarDescricao: string;
  },
  productImageBase64: string,
  productImageMimeType: string,
  avatarImageBase64: string,
  avatarImageMimeType: string,
): Promise<UgcVideoScript> {
  const ai = getGeminiClient();
  const prompt = buildUgcScriptPrompt(params);

  const result = await ai.models.generateContent({
    model: TEXT_MODEL,
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType: avatarImageMimeType, data: avatarImageBase64 } },
          { inlineData: { mimeType: productImageMimeType, data: productImageBase64 } },
          { text: prompt },
        ],
      },
    ],
    config: { responseMimeType: 'application/json' },
  });

  const text = result.text?.trim() ?? '{}';
  const cleaned = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
  const parsed = JSON.parse(cleaned);
  if (!validateUgcScript(parsed)) {
    throw new Error('Roteiro UGC gerado inválido — campos obrigatórios ausentes');
  }
  return parsed;
}

export function registerUgcVideoRoutes(app: express.Application, deps: VideoDeps): void {
  const { verifyFirebaseToken } = deps;

  app.post('/api/video/ugc/generate-script', async (req, res) => {
    try {
      await verifyFirebaseToken(req);
      const {
        description, brand, productImageUrl, avatarImageUrl, avatarDescricao, productName, category, attributes,
      } = req.body as {
        description: string;
        brand?: string;
        productImageUrl: string;
        avatarImageUrl: string;
        avatarDescricao: string;
        productName?: string;
        category?: string;
        attributes?: Record<string, string>;
      };
      if (!description || !productImageUrl || !avatarImageUrl || !avatarDescricao) {
        return res.status(400).json({ error: 'description, productImageUrl, avatarImageUrl e avatarDescricao são obrigatórios' });
      }
      const [productImage, avatarImage] = await Promise.all([
        fetchImageAsBase64(productImageUrl),
        fetchImageAsBase64(avatarImageUrl),
      ]);
      const script = await generateUgcScript(
        {
          description,
          brand: brand ?? '',
          productName: productName ?? '',
          category: category ?? '',
          attributes: attributes ?? {},
          avatarDescricao,
        },
        productImage.base64,
        productImage.mimeType,
        avatarImage.base64,
        avatarImage.mimeType,
      );
      res.json({ script });
    } catch (err) {
      sendError(res, err);
    }
  });

  // Task 7 adds `app.post('/api/video/ugc/start-job', ...)` to this same function.
}
