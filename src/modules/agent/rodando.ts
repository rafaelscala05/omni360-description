// O que está "Rodando" na aba Atividade: trabalho longo em segundo plano, com
// progresso real — hoje os vídeos de produto (clássico e UGC), que levam
// minutos e antes só apareciam dentro do modal do produto.
//
// Puro: recebe os jobs já lidos (users/{uid}/videoJobs e ugcVideoJobs) e os
// nomes dos produtos, devolve as linhas. Verificar com
// `npx tsx scripts/verify-rodando.mjs`.

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
  jobs: { classico: JobVideo[]; ugc: JobVideo[] },
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
  return linhas.sort((a, b) => Number(a.parado) - Number(b.parado) || String(b.desde).localeCompare(String(a.desde)));
}
