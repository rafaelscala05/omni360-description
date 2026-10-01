// Geração de descrição + SEO de um produto do catálogo, no servidor, via
// Vertex — com o MESMO template do botão "Gerar" do app
// (src/services/descriptionTemplate.ts), para o texto do Alfred sair igual.
// Usada pelo worker do lote (loteWorker.ts). Extraída de tools/produtos.ts
// quando a geração saiu do preview() e passou a rodar item a item em job.

import crypto from 'node:crypto';
import sharp from 'sharp';
import { GoogleGenAI } from '@google/genai';
import firebaseAppletConfig from '../../firebase-applet-config.json';
import { adminDb, adminStorage } from '../firebaseAdmin';
import { buildAmbientPromptRequest } from '../../src/services/ambientPrompt';
import { defaultTemplate, fillTemplate } from '../../src/services/descriptionTemplate';
import {
  normalizarAtributos, normalizarGeracao, skuDe, textoPuro, variacoesDoPai,
  type CategoriaDoc, type DefAtributo, type DescricaoGerada, type ProdutoDoc,
} from './produtosRules';
import { fetchImageAsBase64 } from '../safeUrl';
import type { ResultadoAmbientada, ResultadoAtributos } from '../../src/modules/agent/lote';

const TEXT_MODEL = 'gemini-2.5-flash';
const VERTEX_PROJECT = process.env.VERTEX_PROJECT_ID || firebaseAppletConfig.projectId;
const VERTEX_LOCATION = process.env.VERTEX_LOCATION || 'us-central1';

export const produtosCol = (uid: string) => adminDb.collection('users').doc(uid).collection('products');

export async function lerCatalogo(uid: string): Promise<ProdutoDoc[]> {
  const snap = await produtosCol(uid).get();
  return snap.docs.map((d) => ({ ...(d.data() as Record<string, unknown>), _docId: d.id }));
}

// Mesmo formato de regras visuais que productService.ts acrescenta ao template.
const REGRAS_VISUAIS = `
ESPECIFICAÇÕES VISUAIS DA DESCRIÇÃO (OBRIGATÓRIO):
1. Use HTML semântico e profissional.
2. Adicione espaçamento extra entre parágrafos, subtítulos e itens de lista para facilitar a leitura.
3. Utilize tags <h2> e <h3> para criar seções lógicas e organizadas.
4. Transforme blocos de texto denso em listas (<ul> e <li>).
5. O resultado deve ser visualmente limpo, com ar de e-commerce premium.
6. Não invente medidas, potência, garantia ou certificações que não estejam nos dados; quando um dado importante faltar, escreva sem ele.`;

export async function gerarDescricao(ai: GoogleGenAI, produto: ProdutoDoc, catalogo: ProdutoDoc[]): Promise<DescricaoGerada> {
  const prompt = fillTemplate(produto, defaultTemplate, variacoesDoPai(catalogo, skuDe(produto))) + '\n\n' + REGRAS_VISUAIS;
  let ultimoErro: unknown;
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    try {
      const resp = await ai.models.generateContent({
        model: TEXT_MODEL,
        contents: prompt,
        config: { temperature: 0.7, maxOutputTokens: 8192, responseMimeType: 'application/json' },
      });
      const texto = (resp.text ?? '').trim().replace(/^```json\s*/i, '').replace(/```$/, '');
      return normalizarGeracao(JSON.parse(texto || '{}'));
    } catch (e) {
      ultimoErro = e;
      const msg = e instanceof Error ? e.message : String(e);
      if (!/503|UNAVAILABLE|high demand|temporarily|JSON|não devolveu/i.test(msg) || tentativa === 3) break;
      await new Promise((r) => setTimeout(r, tentativa * 1000));
    }
  }
  throw ultimoErro;
}

/** Roda `fn` em no máximo `n` itens ao mesmo tempo — o Vertex limita requisições por minuto. */
export async function emParalelo<T, R>(itens: T[], n: number, fn: (t: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const out: PromiseSettledResult<R>[] = new Array(itens.length);
  let proximo = 0;
  await Promise.all(Array.from({ length: Math.min(n, itens.length) }, async () => {
    while (proximo < itens.length) {
      const i = proximo++;
      try { out[i] = { status: 'fulfilled', value: await fn(itens[i]) }; } catch (e) { out[i] = { status: 'rejected', reason: e }; }
    }
  }));
  return out;
}

/** Um cliente por processo — o worker gera vários itens seguidos. */
let cliente: GoogleGenAI | null = null;
export function clienteVertex(): GoogleGenAI {
  if (!VERTEX_PROJECT) throw Object.assign(new Error('VERTEX_PROJECT_ID não configurado no servidor.'), { status: 500 });
  cliente ??= new GoogleGenAI({ vertexai: true, project: VERTEX_PROJECT, location: VERTEX_LOCATION });
  return cliente;
}

// ---------------------------------------------------------------------------
// Atributos da categoria — o mesmo pedido de suggestProductAttributes
// (src/services/productService.ts), mas texto e foto numa chamada só.
// ---------------------------------------------------------------------------

export async function lerCategorias(uid: string): Promise<CategoriaDoc[]> {
  const snap = await adminDb.collection('users').doc(uid).collection('categories').get();
  return snap.docs.map((d) => ({ ...(d.data() as Omit<CategoriaDoc, 'id'>), id: d.id }));
}

/** Primeira foto pública do produto, para a IA olhar cor, material, formato. Sem foto (ou foto inacessível), segue só com o texto. */
async function fotoDoProduto(p: ProdutoDoc): Promise<{ mimeType: string; data: string } | null> {
  const url = [p._selectedImage, ...Object.keys(p).filter((k) => /^URL imagem/i.test(k)).sort().map((k) => p[k])]
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .find((v) => /^https:\/\//i.test(v));
  if (!url) return null;
  try {
    const img = await fetchImageAsBase64(url, 6 * 1024 * 1024);
    return { mimeType: img.contentType, data: img.base64 };
  } catch {
    return null;
  }
}

export async function gerarAtributos(ai: GoogleGenAI, produto: ProdutoDoc, defs: DefAtributo[]): Promise<ResultadoAtributos> {
  const atuais = (produto.attributes ?? {}) as Record<string, { value?: string | string[]; confirmed?: boolean }>;
  const lista = defs.map((d) => {
    const v = atuais[d.key]?.value;
    const estado = v && (!Array.isArray(v) || v.length) ? ` (Valor atual: ${JSON.stringify(v)})` : ' (Vazio)';
    return `- ${d.key} (${d.label}): Tipo: ${d.type}, Opções permitidas: ${d.options?.length ? d.options.join(', ') : 'Qualquer'}${estado}`;
  }).join('\n');
  const texto = `
Você é um assistente especialista em catálogo de e-commerce.
Analise o produto (dados e, se houver, a foto anexada) e preencha os atributos esperados da categoria.

Produto:
Nome: ${produto['Descrição'] ?? ''}
Marca: ${produto['Marca'] ?? ''}
Categoria: ${Array.isArray(produto.categoryPath) ? (produto.categoryPath as string[]).join(' > ') : produto['Categoria'] ?? ''}
Descrição: ${textoPuro(String(produto['Descrição complementar'] ?? '')).slice(0, 3000)}

Atributos esperados:
${lista}

Instruções:
1. Preencha os atributos "(Vazio)" com o que os dados ou a foto mostram. Em PORTUGUÊS DO BRASIL.
2. Só sugira mudar um "(Valor atual)" se ele estiver claramente errado.
3. Em 'select' e 'multiselect', escolha EXATAMENTE entre as opções permitidas; sem certeza, não sugira.
4. Não invente medidas, materiais ou especificações que não estejam nos dados ou visíveis na foto.

Retorne APENAS este JSON:
{ "attributes": { "ChaveDoAtributo": { "value": "Valor", "confidence": 0.9 } } }`;
  const foto = await fotoDoProduto(produto);
  const parts = foto ? [{ inlineData: foto }, { text: texto }] : [{ text: texto }];
  let ultimoErro: unknown;
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    try {
      const resp = await ai.models.generateContent({
        model: TEXT_MODEL,
        contents: [{ role: 'user', parts }],
        config: { temperature: 0.2, maxOutputTokens: 4096, responseMimeType: 'application/json' },
      });
      const bruto = (resp.text ?? '').trim().replace(/^```json\s*/i, '').replace(/```$/, '');
      const atributos = normalizarAtributos(JSON.parse(bruto || '{}'), defs, atuais);
      if (!atributos.length) throw Object.assign(new Error('a IA não encontrou atributos para preencher'), { definitivo: true });
      return { atributos };
    } catch (e) {
      ultimoErro = e;
      if ((e as { definitivo?: boolean }).definitivo) break;
      const msg = e instanceof Error ? e.message : String(e);
      if (!/503|UNAVAILABLE|high demand|temporarily|JSON/i.test(msg) || tentativa === 3) break;
      await new Promise((r) => setTimeout(r, tentativa * 1000));
    }
  }
  throw ultimoErro;
}

// ---------------------------------------------------------------------------
// Árvore de categorias — o pedido de generateCategoryHierarchy
// (src/services/categoryService.ts), sabendo também das categorias que já existem.
// ---------------------------------------------------------------------------

export async function gerarArvore(ai: GoogleGenAI, nomes: string[], existentes: string[], segmento?: string): Promise<unknown> {
  const prompt = `
Você é um especialista em arquitetura de dados e e-commerce.
O catálogo da loja usa estes nomes de categoria, que ainda não estão organizados:
[${nomes.join(', ')}]
${existentes.length ? `\nCategorias que a loja JÁ TEM (use o mesmo nome se uma delas for o pai certo): [${existentes.join(', ')}]\n` : ''}
${segmento ? `O segmento do negócio é: ${segmento}` : ''}

Organize os nomes em uma estrutura pai/filho.

Diretrizes:
1. Use EXATAMENTE os nomes passados (eles casam com os produtos); você pode criar categorias-pai novas para agrupá-los.
2. No máximo 3 níveis.
3. Não invente subcategorias que nenhum produto usa.
4. Nomes em PORTUGUÊS DO BRASIL.

Retorne SOMENTE este JSON:
{ "hierarchy": [ { "name": "Calçados", "children": [ { "name": "Tênis", "children": [] } ] } ] }`;
  const resp = await ai.models.generateContent({
    model: TEXT_MODEL,
    contents: prompt,
    config: { temperature: 0.2, maxOutputTokens: 8192, responseMimeType: 'application/json' },
  });
  const texto = (resp.text ?? '').trim().replace(/^```json\s*/i, '').replace(/```$/, '');
  return JSON.parse(texto || '{}');
}

// ---------------------------------------------------------------------------
// Imagens ambientadas — o mesmo fluxo do ImageSearchModal: a IA olha a foto e
// escreve 3 cenas (buildAmbientPromptRequest), o modelo de imagem gera cada
// uma a partir da foto real, e as 3 vão para o Storage.
// ---------------------------------------------------------------------------

const IMAGE_MODEL = process.env.AMBIENT_IMAGE_MODEL || 'gemini-2.5-flash-image';
const STORAGE_BUCKET = firebaseAppletConfig.storageBucket;
/** Lado das ambientadas salvas (quadradas, como o padrão 1:1 do modal). */
const LADO_AMBIENTADA = 1200;

let clienteImagem: GoogleGenAI | null = null;
/** O modelo de imagem só responde na região global do Vertex (ver server/meli/pictureGenerator.ts). */
function vertexImagem(): GoogleGenAI {
  if (!VERTEX_PROJECT) throw Object.assign(new Error('VERTEX_PROJECT_ID não configurado no servidor.'), { status: 500 });
  clienteImagem ??= new GoogleGenAI({ vertexai: true, project: VERTEX_PROJECT, location: 'global' });
  return clienteImagem;
}

export function fotoPrincipal(p: Record<string, unknown>): string | null {
  const url = [p._selectedImage, p['URL imagem 1']].map((v) => (typeof v === 'string' ? v.trim() : '')).find((v) => /^https:\/\//i.test(v));
  return url ?? null;
}

async function comRetentativa<T>(fn: () => Promise<T>, tentativas = 3): Promise<T> {
  let ultimo: unknown;
  for (let i = 1; i <= tentativas; i++) {
    try { return await fn(); } catch (e) {
      ultimo = e;
      const msg = e instanceof Error ? e.message : String(e);
      if (!/429|503|RESOURCE_EXHAUSTED|UNAVAILABLE|quota|temporarily/i.test(msg) || i === tentativas) break;
      await new Promise((r) => setTimeout(r, i * 2000));
    }
  }
  throw ultimo;
}

export async function gerarAmbientadas(uid: string, ai: GoogleGenAI, produto: ProdutoDoc): Promise<ResultadoAmbientada> {
  const url = fotoPrincipal(produto);
  if (!url) throw new Error('o produto não tem foto pública (https) para servir de base');
  const original = await fetchImageAsBase64(url, 8 * 1024 * 1024);
  const base = await sharp(Buffer.from(original.base64, 'base64')).rotate()
    .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
  const foto = { mimeType: 'image/jpeg', data: base.toString('base64') };

  const pedido = buildAmbientPromptRequest({
    productName: String(produto['Descrição'] ?? ''),
    brand: String(produto['Marca'] ?? ''),
    category: String(produto['Categoria'] ?? ''),
    description: textoPuro(String(produto['Descrição complementar'] ?? '')).slice(0, 2000),
  }, true);
  const roteiro = await comRetentativa(async () => {
    const resp = await ai.models.generateContent({
      model: TEXT_MODEL,
      contents: [{ role: 'user', parts: [{ inlineData: foto }, { text: pedido }] }],
      config: { temperature: 0.7, responseMimeType: 'application/json' },
    });
    const r = JSON.parse((resp.text ?? '').trim().replace(/^```json\s*/i, '').replace(/```$/, '') || '{}') as { prompts?: unknown };
    if (!Array.isArray(r.prompts) || r.prompts.length !== 3) throw new Error('JSON: a IA não devolveu as 3 cenas');
    return r.prompts.map(String);
  });

  const imagens: string[] = [];
  for (const [i, cena] of roteiro.entries()) {
    try {
      const resp = await comRetentativa(() => vertexImagem().models.generateContent({
        model: IMAGE_MODEL,
        contents: [{ role: 'user', parts: [{ inlineData: foto }, { text: cena }] }],
        config: { responseModalities: ['TEXT', 'IMAGE'] },
      }));
      const dados = resp.candidates?.[0]?.content?.parts?.find((part) => part.inlineData?.data)?.inlineData?.data;
      if (!dados) continue;
      const saida = await sharp(Buffer.from(dados, 'base64')).rotate()
        .resize(LADO_AMBIENTADA, LADO_AMBIENTADA, { fit: 'cover', position: 'attention' }).jpeg({ quality: 88 }).toBuffer();
      const caminho = `users/${uid}/product-images/alfred_${produto._docId}_${Date.now()}_${i}.jpg`;
      const token = crypto.randomUUID();
      await adminStorage.bucket(STORAGE_BUCKET).file(caminho).save(saida, {
        contentType: 'image/jpeg', resumable: false, metadata: { metadata: { firebaseStorageDownloadTokens: token } },
      });
      imagens.push(`https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o/${encodeURIComponent(caminho)}?alt=media&token=${token}`);
    } catch (e) {
      // Uma cena que falha não derruba as outras; nenhuma imagem é falha do item.
      if (i === roteiro.length - 1 && !imagens.length) throw e;
    }
  }
  if (!imagens.length) throw new Error('o modelo de imagem não devolveu nenhuma ambientação');
  return { imagens };
}
