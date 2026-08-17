// Discovery tools: how the agent learns what an API can do at runtime.
//
// The curated tools in wake.ts / tiny.ts cover the common operations. These
// three cover the long tail without giving the model a way around the approval
// gate:
//
//   docs.buscar      — reads Wake's documentation index and pages
//   wake.api.chamar  — arbitrary Wake call, GET only
//   tiny.api.chamar  — arbitrary Tiny v2 call, read-style endpoints only
//
// All three are mode:'read'. That is the whole safety story: a read tool has no
// execute(), and actions.ts is the only code path that can write. So the escape
// hatches genuinely cannot mutate anything, no matter what the model decides to
// call — the restriction is structural, not a prompt instruction.

import { fbitsFetch } from '../../wakeAgent';
import { tinyV2CallRaw } from '../../tinyV2';
import { registerTool } from '../registry';
import { withLog } from '../telemetry';
import type { ToolCtx } from '../types';

const LLMS_INDEX = 'https://wakecommerce.readme.io/llms.txt';

interface DocEntry { titulo: string; url: string; resumo: string }

let indexCache: { at: number; entries: DocEntry[] } | null = null;
const INDEX_TTL_MS = 60 * 60 * 1000;

async function loadIndex(): Promise<DocEntry[]> {
  if (indexCache && Date.now() - indexCache.at < INDEX_TTL_MS) return indexCache.entries;
  const res = await fetch(LLMS_INDEX);
  if (!res.ok) throw Object.assign(new Error('Não consegui carregar o índice da documentação da Wake.'), { status: 502 });
  const txt = await res.text();
  const entries: DocEntry[] = [];
  // Lines look like: - [Título](https://…md): resumo opcional
  for (const line of txt.split('\n')) {
    const m = line.match(/^\s*-\s*\[([^\]]+)\]\((https?:\/\/[^)]+)\)(?::\s*(.*))?$/);
    if (m) entries.push({ titulo: m[1], url: m[2], resumo: (m[3] ?? '').trim() });
  }
  indexCache = { at: Date.now(), entries };
  return entries;
}

function scoreEntry(e: DocEntry, termos: string[]): number {
  const hay = `${e.titulo} ${e.resumo} ${e.url}`.toLowerCase();
  let score = 0;
  for (const t of termos) {
    if (!t) continue;
    if (e.titulo.toLowerCase().includes(t)) score += 3;
    else if (hay.includes(t)) score += 1;
  }
  return score;
}

registerTool({
  name: 'docs.buscar',
  provider: 'docs',
  mode: 'read',
  description: 'Consulta a documentação oficial da API da Wake. Use quando precisar descobrir qual endpoint existe para uma operação que não tem ferramenta dedicada, ou quais campos um endpoint aceita. Sem "pagina", devolve os títulos e URLs mais relevantes; com "pagina", devolve o conteúdo daquela página.',
  schema: {
    type: 'object',
    properties: {
      consulta: { type: 'string', description: 'Termos de busca, ex.: "atualizar estoque" ou "hotsite conteudos".' },
      pagina: { type: 'string', description: 'URL exata de uma página do índice, para ler o conteúdo completo.' },
    },
  },
  read: async (_ctx, a: { consulta?: string; pagina?: string }) => {
    if (a.pagina) {
      if (!a.pagina.startsWith('https://wakecommerce.readme.io/')) {
        throw Object.assign(new Error('Só é possível ler páginas da documentação da Wake.'), { status: 400 });
      }
      const res = await fetch(a.pagina);
      if (!res.ok) throw Object.assign(new Error(`Página não encontrada (HTTP ${res.status}).`), { status: 404 });
      const texto = await res.text();
      // Doc pages embed sample images as huge base64 blobs; strip long lines so
      // a single lookup doesn't swallow the model's context window.
      const limpo = texto.split('\n').filter((l) => l.length < 400).join('\n');
      return { url: a.pagina, conteudo: limpo.slice(0, 12000) };
    }

    const termos = (a.consulta ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    if (!termos.length) throw Object.assign(new Error('Informe "consulta" ou "pagina".'), { status: 400 });
    const entries = await loadIndex();
    const ranked = entries
      .map((e) => ({ e, s: scoreEntry(e, termos) }))
      .filter((x) => x.s > 0)
      .sort((a2, b2) => b2.s - a2.s)
      .slice(0, 15)
      .map((x) => x.e);
    return { encontrados: ranked.length, resultados: ranked };
  },
});

registerTool({
  name: 'wake.api.chamar',
  provider: 'wake',
  mode: 'read',
  description: 'Faz uma chamada GET arbitrária na API da Wake, para leituras que não têm ferramenta dedicada. Use docs.buscar antes para descobrir o caminho correto. Somente leitura — não é possível criar nem alterar dados por aqui.',
  schema: {
    type: 'object',
    properties: {
      caminho: {
        type: 'string',
        description: 'Caminho a partir da raiz da API, com query string. Ex.: "/produtos/123/categorias?tipoIdentificador=ProdutoId".',
      },
    },
    required: ['caminho'],
  },
  read: async (ctx: ToolCtx, a: { caminho: string }) => {
    const caminho = String(a.caminho ?? '').trim();
    if (!caminho.startsWith('/')) {
      throw Object.assign(new Error('O caminho precisa começar com "/".'), { status: 400 });
    }
    // Defence in depth: the tool is read-mode so it can never be executed as a
    // write, but reject absolute URLs too so nobody can point it off-host.
    if (/^\/\//.test(caminho) || caminho.includes('://')) {
      throw Object.assign(new Error('Informe apenas o caminho, não uma URL completa.'), { status: 400 });
    }
    const token = await ctx.wakeToken();
    return withLog(
      ctx.uid,
      { provider: 'wake', tool: 'wake.api.chamar', operacao: 'GET', alvo: caminho },
      () => fbitsFetch(token, 'GET', caminho),
    );
  },
});

// v2 has no GET/POST distinction — everything is a form POST — so read-only is
// enforced by endpoint name instead: only the query-style endpoints are allowed.
const TINY_READ_ONLY = /^(?:[a-z0-9_.]+\.(?:pesquisa|obter)\.php|lista\.[a-z0-9_.]+)$/i;

registerTool({
  name: 'tiny.api.chamar',
  provider: 'tiny',
  mode: 'read',
  description: 'Faz uma consulta arbitrária na API v2 do Tiny ERP, para leituras que não têm ferramenta dedicada. Apenas endpoints de consulta (*.pesquisa.php, *.obter.php, lista.*) são permitidos.',
  schema: {
    type: 'object',
    properties: {
      endpoint: { type: 'string', description: 'Ex.: "nota.fiscal.obter.php" ou "contas.pagar.pesquisa.php".' },
      parametros: { type: 'object', description: 'Parâmetros do endpoint, como pares chave/valor.' },
    },
    required: ['endpoint'],
  },
  read: async (ctx: ToolCtx, a: { endpoint: string; parametros?: Record<string, unknown> }) => {
    const endpoint = String(a.endpoint ?? '').trim();
    if (!TINY_READ_ONLY.test(endpoint)) {
      throw Object.assign(
        new Error(`"${endpoint}" não é um endpoint de consulta. Só é possível ler por aqui; alterações precisam de uma ferramenta dedicada, que passa pela sua aprovação.`),
        { status: 400 },
      );
    }
    const params: Record<string, string> = {};
    for (const [k, v] of Object.entries(a.parametros ?? {})) {
      if (v !== undefined && v !== null) params[k] = String(v);
    }
    const token = await ctx.tinyToken();
    return withLog(
      ctx.uid,
      { provider: 'tiny', tool: 'tiny.api.chamar', operacao: endpoint, alvo: endpoint, requisicao: params },
      () => tinyV2CallRaw(token, endpoint, params),
    );
  },
});
