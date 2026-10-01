// O que está "Rodando" na aba Atividade: trabalho longo em segundo plano, com
// progresso real — os vídeos de produto (clássico e UGC), que levam minutos e
// antes só apareciam dentro do modal do produto, e os lotes do Alfred
// (agent_jobs, ver lote.ts).
//
// Puro: recebe os jobs já lidos (users/{uid}/videoJobs e ugcVideoJobs) e os
// nomes dos produtos, devolve as linhas. Verificar com
// `npx tsx scripts/verify-rodando.mjs`.

import { resumoLote, type LoteJob } from './lote';

export interface JobVideo {
  jobId: string;
  productId: string;
  status: string;
  updatedAt?: string;
  createdAt?: string;
  step?: string;
  shotsDone?: number;
  totalShots?: number;
  clipsDone?: number;
  totalClips?: number;
}

export interface ItemRodando {
  id: string;
  tipo: 'video' | 'lote';
  titulo: string;
  etapa: string;
  feito: number | null;
  total: number | null;
  /** Sem atualização há muito tempo — provavelmente o job morreu. */
  parado: boolean;
  desde: string | null;
}

/** Um job que não se mexe há mais que isso é mostrado como parado, não como rodando. */
export const PARADO_MS = 30 * 60_000;
/** Mais velho que isso some da lista: é lixo de um job que nunca terminou. */
export const ESQUECER_MS = 12 * 60 * 60_000;

const ETAPAS: Record<string, string> = {
  shot: 'gerando as cenas',
  post: 'montando o vídeo',
  uploading: 'salvando',
  clip: 'gerando as falas',
};

export function itensRodando(
  jobs: { classico: JobVideo[]; ugc: JobVideo[]; lotes?: LoteJob[] },
  nomeDoProduto: (productId: string) => string | undefined,
  agora = Date.now(),
): ItemRodando[] {
  const linhas: ItemRodando[] = [];
  const add = (j: JobVideo, tipo: 'Vídeo' | 'Vídeo UGC', feito?: number, total?: number) => {
    if (j.status !== 'queued' && j.status !== 'processing') return;
    const ts = Date.parse(j.updatedAt ?? j.createdAt ?? '');
    const idade = Number.isFinite(ts) ? agora - ts : 0;
    if (idade > ESQUECER_MS) return;
    const nome = nomeDoProduto(j.productId);
    linhas.push({
      id: `${tipo}-${j.jobId}`,
      tipo: 'video',
      titulo: `${tipo}${nome ? ` · ${nome}` : ''}`,
      etapa: j.status === 'queued' ? 'na fila' : ETAPAS[j.step ?? ''] ?? 'em produção',
      feito: typeof feito === 'number' ? feito : null,
      total: typeof total === 'number' && total > 0 ? total : null,
      parado: idade > PARADO_MS,
      desde: Number.isFinite(ts) ? new Date(ts).toISOString() : null,
    });
  };
  jobs.classico.forEach((j) => add(j, 'Vídeo', j.shotsDone, j.totalShots));
  jobs.ugc.forEach((j) => add(j, 'Vídeo UGC', j.clipsDone, j.totalClips));
  for (const l of jobs.lotes ?? []) {
    if (l.status !== 'rodando' && l.status !== 'pausado') continue;
    const ts = Date.parse(l.updatedAt ?? l.createdAt ?? '');
    const idade = Number.isFinite(ts) ? agora - ts : 0;
    if (idade > ESQUECER_MS) continue;
    const r = resumoLote(l);
    const total = r.total - l.itens.filter((i) => i.estado === 'descartado' && !i.resultado).length;
    linhas.push({
      id: `Lote-${l.id}`,
      tipo: 'lote',
      titulo: l.tool === 'produtos.descricoes.gerar' ? `Descrições · ${total === 1 ? '1 produto' : `${total} produtos`}` : `Lote · ${total} itens`,
      etapa: l.status === 'pausado'
        ? 'pausado'
        : r.agora ? `agora: ${r.agora}` : 'na fila',
      feito: r.gerados,
      total,
      // Pausado não está parado: está esperando o usuário.
      parado: l.status === 'rodando' && idade > PARADO_MS,
      desde: Number.isFinite(ts) ? new Date(ts).toISOString() : null,
    });
  }
  return linhas.sort((a, b) => Number(a.parado) - Number(b.parado) || String(b.desde).localeCompare(String(a.desde)));
}
