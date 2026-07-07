// Conversão Markdown→HTML compartilhada entre client (prévia de artigos,
// editor do blog) e server (publicação no blog nativo e no WordPress).
// O conteúdo é sempre do próprio dono (pipeline de IA ou edição manual).
import { marked } from 'marked';

marked.use({ gfm: true, breaks: true });

// Detecta se um corpo salvo é HTML (novo formato) ou Markdown legado.
// Posts publicados antes da conversão no publish guardavam markdown cru.
export function looksLikeHtml(body: string): boolean {
  return /<([a-z][a-z0-9]*)(\s[^>]*)?>/i.test(body);
}

// Remove as linhas de metadados que o pipeline anexa ao final do artigo.
function stripPipelineMeta(md: string): string {
  return md.replace(/^SLUG:.*$/gim, '').replace(/^META:.*$/gim, '').trim();
}

export function markdownToHtml(md: string): string {
  return marked.parse(stripPipelineMeta(md), { async: false }) as string;
}

// Garante HTML: converte markdown legado, passa HTML adiante sem tocar.
export function ensureHtml(body: string): string {
  if (!body) return '';
  return looksLikeHtml(body) ? body : markdownToHtml(body);
}
