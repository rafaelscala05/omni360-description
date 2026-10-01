// Geração de descrição + SEO de um produto do catálogo, no servidor, via
// Vertex — com o MESMO template do botão "Gerar" do app
// (src/services/descriptionTemplate.ts), para o texto do Alfred sair igual.
// Usada pelo worker do lote (loteWorker.ts). Extraída de tools/produtos.ts
// quando a geração saiu do preview() e passou a rodar item a item em job.

import { GoogleGenAI } from '@google/genai';
import firebaseAppletConfig from '../../firebase-applet-config.json';
import { adminDb } from '../firebaseAdmin';
import { defaultTemplate, fillTemplate } from '../../src/services/descriptionTemplate';
import { normalizarGeracao, skuDe, variacoesDoPai, type DescricaoGerada, type ProdutoDoc } from './produtosRules';

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
