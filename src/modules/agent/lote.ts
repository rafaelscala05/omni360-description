// Lote em job: o trabalho caro do agente (escrever 12 descrições) roda item a
// item fora do turno do chat, e o usuário revisa e aprova o que já ficou
// pronto enquanto o resto termina.
//
// Puro e sem I/O, usado dos dois lados: o servidor (server/agent/loteStore.ts
// e loteWorker.ts) aplica as transições dentro de transações do Firestore, e o
// cliente (chat/LoteCard.tsx, Atividade › Rodando) lê o mesmo documento.
// Verificar com `npx tsx scripts/verify-lote.mjs`.
//
// Documento: users/{uid}/agent_jobs/{id}.
//
// Por que fora do interrupt() do LangGraph: um interrupt é uma aprovação só,
// de uma vez. "Aprovar as 5 prontas e continuar gerando as outras 7" precisa
// de várias aprovações sobre o mesmo trabalho, e um preview() de minutos
// prenderia a conversa (e o SSE) até o fim. O invariante continua: a
// ferramenta só gera; gravar no catálogo só acontece pela rota de aprovação.

export type EstadoItem = 'fila' | 'gerando' | 'pronto' | 'falhou' | 'gravando' | 'gravado' | 'pulado' | 'descartado';
export type StatusLote = 'rodando' | 'pausado' | 'revisao' | 'concluido';

export interface ResultadoDescricao {
  descricao: string;
  tituloSeo: string;
  descricaoSeo: string;
  palavrasChave: string;
}

export interface ItemLote {
  id: string;
  docId: string;
  sku: string;
  nome: string;
  estado: EstadoItem;
  /** Descrição no catálogo quando o lote nasceu — o "antes" e a trava de concorrência. */
  descricaoAntes: string;
  resultado?: ResultadoDescricao;
  erro?: string;
}

export interface LoteJob {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  /** Chave da ferramenta + argumentos: pedir o mesmo lote de novo reencontra este. */
  chave: string;
  actionId: string;
  status: StatusLote;
  /** Aprovação automática ligada: cada item é gravado assim que fica pronto. */
  auto: boolean;
  itens: ItemLote[];
  avisos: string[];
  leaseId?: string | null;
  leaseUntil?: number | null;
  createdAt: string;
  updatedAt: string;
}

const ATIVOS: EstadoItem[] = ['fila', 'gerando'];
const TERMINAIS: EstadoItem[] = ['falhou', 'gravado', 'pulado', 'descartado'];

export interface ResumoLote {
  total: number;
  fila: number;
  gerando: number;
  prontos: number;
  gravando: number;
  gravados: number;
  pulados: number;
  falhas: number;
  descartados: number;
  /** Quantos já passaram pela geração (prontos, gravados, falhas…). */
  gerados: number;
  /** Nome do que está sendo escrito agora, para "agora: Luminária Pendente". */
  agora: string | null;
}

export function resumoLote(job: Pick<LoteJob, 'itens'>): ResumoLote {
  const c = (e: EstadoItem) => job.itens.filter((i) => i.estado === e).length;
  const r = {
    total: job.itens.length,
    fila: c('fila'),
    gerando: c('gerando'),
    prontos: c('pronto'),
    gravando: c('gravando'),
    gravados: c('gravado'),
    pulados: c('pulado'),
    falhas: c('falhou'),
    descartados: c('descartado'),
    gerados: 0,
    agora: job.itens.find((i) => i.estado === 'gerando')?.nome ?? null,
  };
  // Descartado antes de gerar não conta como gerado.
  r.gerados = job.itens.filter((i) => !ATIVOS.includes(i.estado) && !(i.estado === 'descartado' && !i.resultado)).length;
  return r;
}

/**
 * O status do lote sai dos itens, nunca é escrito à mão: assim pausar no meio
 * de uma gravação ou descartar o último item pendente não deixa o documento
 * dizendo uma coisa e os itens outra.
 */
export function statusDerivado(job: Pick<LoteJob, 'itens' | 'status'>): StatusLote {
  const temAtivo = job.itens.some((i) => ATIVOS.includes(i.estado));
  if (temAtivo) return job.status === 'pausado' ? 'pausado' : 'rodando';
  if (job.itens.some((i) => i.estado === 'pronto' || i.estado === 'gravando')) return 'revisao';
  return 'concluido';
}

/** Status da agent_action do lote quando ele termina. */
export function statusDaAcao(job: Pick<LoteJob, 'itens'>): 'pending' | 'executed' | 'failed' | 'rejected' {
  if (!job.itens.every((i) => TERMINAIS.includes(i.estado))) return 'pending';
  const r = resumoLote(job);
  if (r.gravados > 0) return 'executed';
  if (r.falhas > 0 || r.pulados > 0) return 'failed';
  return 'rejected';
}

// ---------------------------------------------------------------------------
// Transições (todas devolvem um job novo; quem chama grava numa transação)
// ---------------------------------------------------------------------------

const comStatus = <T extends Pick<LoteJob, 'itens' | 'status'>>(job: T, agoraIso: string): T & { updatedAt: string } => {
  const novo = { ...job, updatedAt: agoraIso };
  novo.status = statusDerivado(novo);
  return novo;
};

/** Duração do lease de um worker. Cada item concluído o renova. */
export const LEASE_MS = 3 * 60_000;

/**
 * Um worker reivindica o lote. Falha (null) se outro worker tem um lease
 * válido ou se não há o que gerar. Itens que ficaram em "gerando" sob um lease
 * vencido voltam para a fila — o processo que os pegou morreu.
 */
export function reivindicar(job: LoteJob, leaseId: string, agora: number): LoteJob | null {
  if (job.status !== 'rodando') return null;
  if (job.leaseId && job.leaseId !== leaseId && (job.leaseUntil ?? 0) > agora) return null;
  const reaproveitado = job.leaseId === leaseId;
  const itens = job.itens.map((i) => (i.estado === 'gerando' && !reaproveitado ? { ...i, estado: 'fila' as const } : i));
  if (!itens.some((i) => ATIVOS.includes(i.estado))) return null;
  return { ...job, itens, leaseId, leaseUntil: agora + LEASE_MS, updatedAt: new Date(agora).toISOString() };
}

/** Pega o próximo item da fila para gerar. null = nada a fazer (ou lease perdido, ou pausado). */
export function pegarProximo(job: LoteJob, leaseId: string, agora: number): { job: LoteJob; item: ItemLote } | null {
  if (job.status !== 'rodando' || job.leaseId !== leaseId) return null;
  const idx = job.itens.findIndex((i) => i.estado === 'fila');
  if (idx === -1) return null;
  const itens = job.itens.slice();
  itens[idx] = { ...itens[idx], estado: 'gerando' };
  return { job: { ...job, itens, leaseUntil: agora + LEASE_MS, updatedAt: new Date(agora).toISOString() }, item: itens[idx] };
}

/** Registra o resultado da geração de um item. Ignora se o item já não está "gerando" (descartado no meio). */
export function concluirGeracao(
  job: LoteJob, itemId: string, saida: { resultado: ResultadoDescricao } | { erro: string }, agora: number,
): LoteJob {
  const itens = job.itens.map((i) => {
    if (i.id !== itemId || i.estado !== 'gerando') return i;
    return 'erro' in saida
      ? { ...i, estado: 'falhou' as const, erro: saida.erro }
      : { ...i, estado: 'pronto' as const, resultado: saida.resultado };
  });
  return { ...comStatus({ ...job, itens }, new Date(agora).toISOString()), leaseUntil: agora + LEASE_MS };
}

export function pausar(job: LoteJob, agoraIso: string): LoteJob {
  if (statusDerivado(job) !== 'rodando') return job;
  return comStatus({ ...job, status: 'pausado' }, agoraIso);
}

export function retomar(job: LoteJob, agoraIso: string): LoteJob {
  if (job.status !== 'pausado') return job;
  return comStatus({ ...job, status: 'rodando', leaseId: null, leaseUntil: null }, agoraIso);
}

/** "Parar": o que ainda não começou é descartado; o que está pronto continua para revisão. */
export function parar(job: LoteJob, agoraIso: string): LoteJob {
  const itens = job.itens.map((i) => (i.estado === 'fila' ? { ...i, estado: 'descartado' as const } : i));
  return comStatus({ ...job, itens }, agoraIso);
}

/**
 * Descarta itens prontos (ou, sem ids, tudo o que ainda não foi gravado —
 * o "Recusar" do lote inteiro). Um item em "gerando" também pode ser
 * descartado: o resultado que chegar depois é ignorado por concluirGeracao.
 */
export function descartar(job: LoteJob, ids: string[] | null, agoraIso: string): LoteJob {
  const alvo = ids ? new Set(ids) : null;
  const itens = job.itens.map((i) => {
    if (alvo && !alvo.has(i.id)) return i;
    return ['fila', 'gerando', 'pronto'].includes(i.estado) ? { ...i, estado: 'descartado' as const } : i;
  });
  return comStatus({ ...job, itens }, agoraIso);
}

/**
 * Reserva os itens prontos para gravar (sem ids: todos os prontos). O estado
 * "gravando" impede que duas aprovações simultâneas (duplo clique, duas abas)
 * gravem e debitem o mesmo item duas vezes.
 */
export function reservarParaGravar(job: LoteJob, ids: string[] | null, agoraIso: string): { job: LoteJob; reservados: ItemLote[] } {
  const alvo = ids ? new Set(ids) : null;
  const reservados: ItemLote[] = [];
  const itens = job.itens.map((i) => {
    if (i.estado !== 'pronto' || !i.resultado || (alvo && !alvo.has(i.id))) return i;
    const r = { ...i, estado: 'gravando' as const };
    reservados.push(r);
    return r;
  });
  return { job: comStatus({ ...job, itens }, agoraIso), reservados };
}

/** Depois da gravação: cada item reservado vira gravado/pulado; uma falha geral devolve todos para "pronto". */
export function concluirGravacao(
  job: LoteJob,
  saida: { gravados: string[]; pulados: { id: string; motivo: string }[] } | { erro: string; ids: string[] },
  agoraIso: string,
): LoteJob {
  const itens = job.itens.map((i) => {
    if (i.estado !== 'gravando') return i;
    if ('erro' in saida) return saida.ids.includes(i.id) ? { ...i, estado: 'pronto' as const } : i;
    if (saida.gravados.includes(i.id)) return { ...i, estado: 'gravado' as const };
    const pulado = saida.pulados.find((p) => p.id === i.id);
    return pulado ? { ...i, estado: 'pulado' as const, erro: pulado.motivo } : i;
  });
  return comStatus({ ...job, itens }, agoraIso);
}

// ---------------------------------------------------------------------------
// Apresentação
// ---------------------------------------------------------------------------

/** "7 de 12 · agora: Luminária Pendente" — a linha de progresso do card e da Atividade. */
export function linhaProgresso(job: Pick<LoteJob, 'itens' | 'status'>): string {
  const r = resumoLote(job);
  // O que foi descartado antes de ser escrito sai da conta: "7 de 12" vira "7 de 9" ao parar.
  const util = r.total - job.itens.filter((i) => i.estado === 'descartado' && !i.resultado).length;
  const base = `${r.gerados} de ${util}`;
  if (job.status === 'pausado') return `${base} · pausado`;
  if (r.agora) return `${base} · agora: ${r.agora}`;
  if (job.status === 'rodando') return `${base} · na fila`;
  return base;
}

const textoPuro = (html: string) =>
  html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const trecho = (s: string, n: number) => (s.length > n ? `${s.slice(0, n).trimEnd()}…` : s);

/** Antes/depois de um item pronto, no formato da amostra da aprovação. */
export function camposDoItem(item: ItemLote): { campo: string; antes: unknown; depois: unknown; mudou: boolean }[] {
  const r = item.resultado;
  if (!r) return [];
  return [
    { campo: 'Descrição', antes: trecho(textoPuro(item.descricaoAntes), 280) || null, depois: trecho(textoPuro(r.descricao), 600), mudou: true },
    { campo: 'Título SEO', antes: null, depois: r.tituloSeo, mudou: !!r.tituloSeo },
    { campo: 'Descrição SEO', antes: null, depois: r.descricaoSeo, mudou: !!r.descricaoSeo },
  ];
}
