// O que o recibo de uma ação diz sobre o resultado dela (Recibo.tsx). Puro — verificar com
// `npx tsx scripts/verify-plano.mjs`.

/** Uma linha do resultado da execução, quando a ferramenta devolve contagens conhecidas. */
export function resumoRecibo(result: unknown): string | null {
  const r = (result ?? {}) as Record<string, unknown>;
  const partes: string[] = [];
  if (typeof r.gravados === 'number') partes.push(`${r.gravados} ${r.gravados === 1 ? 'produto' : 'produtos'}`);
  if (typeof r.enviados === 'number') partes.push(`${r.enviados} ${r.enviados === 1 ? 'produto enviado' : 'produtos enviados'}`);
  if (Array.isArray(r.falhas) && r.falhas.length) partes.push(`${r.falhas.length} com falha`);
  if (Array.isArray(r.pulados) && r.pulados.length) partes.push(`${r.pulados.length} pulado(s)`);
  if (typeof r.mudancas === 'number' && typeof r.execucao === 'string') partes.push(`${r.mudancas} mudança(s) na fila de publicação`);
  return partes.length ? partes.join(' · ') : null;
}

/** O detalhe do que foi gravado: por produto, os campos que chegaram ao ERP; e cada falha. */
export function linhasDoRecibo(result: unknown): { texto: string; falha?: boolean }[] {
  const r = (result ?? {}) as Record<string, unknown>;
  const out: { texto: string; falha?: boolean }[] = [];
  if (Array.isArray(r.enviado)) {
    for (const e of r.enviado as { sku?: string; campos?: string[] }[]) {
      const campos = (e.campos ?? []).filter(Boolean);
      out.push({ texto: `${e.sku ?? 'Produto'}: ${campos.length ? campos.join(', ') : 'nada mudou'}` });
    }
  }
  if (Array.isArray(r.falhas)) {
    for (const f of r.falhas) out.push({ texto: String(f), falha: true });
  }
  if (Array.isArray(r.pulados)) {
    for (const p of r.pulados as unknown[]) {
      const x = p as { nome?: string; motivo?: string } | string;
      out.push({ texto: typeof x === 'string' ? `Pulado: ${x}` : `Pulado: ${x.nome ?? ''}${x.motivo ? ` (${x.motivo})` : ''}` });
    }
  }
  return out;
}
