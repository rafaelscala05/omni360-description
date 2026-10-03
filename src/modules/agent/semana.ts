// Monta o roadmap da semana do Alfred a partir do estado que o app já tem.
//
// Puro e sem I/O: recebe os sinais (produtos incompletos, ações do agente,
// calendário de conteúdo, propostas do Mercado Livre, integrações com alerta)
// e devolve as tarefas distribuídas de segunda a domingo. Verificar com
// `npx tsx scripts/verify-semana.mjs`.
//
// Duas regras que não são óbvias:
// - Tarefa só ganha `prompt` (o botão "Fazer com Alfred") quando existe
//   ferramenta no registry do agente para executá-la — `alfredFaz` diz quais
//   providers a conta enxerga (GET /api/agent/tools). Sem a ferramenta, a
//   tarefa leva à tela certa em vez de prometer uma execução que o chat não
//   faz. Foto de produto não tem ferramenta: continua levando à tela.
// - O que tem data (artigo agendado, ação executada) fica no próprio dia; o
//   resto é espalhado de hoje em diante, no máximo MAX_POR_DIA por dia, com o
//   que precisa do usuário na frente.

import type { AgentAction } from '../../types/agent';

export type OrigemTarefa = 'produto' | 'conteudo' | 'meli' | 'operacoes';
export type EstadoTarefa = 'aberta' | 'precisa' | 'feita';
export type DestinoTarefa = 'produtos' | 'conteudo' | 'meli' | 'integracoes' | 'atividade' | 'missao';

/** As missões de onboarding que viram tarefas da primeira semana (ver trilha.ts). */
export type MissaoSemana = 'produto' | 'conteudo' | 'meli' | 'catalogo' | 'erp' | 'publicar-blog' | 'empresa';

export interface TarefaSemana {
  id: string;
  origem: OrigemTarefa;
  titulo: string;
  detalhe?: string;
  /** 0 = segunda … 6 = domingo. */
  dia: number;
  estado: EstadoTarefa;
  /** Mensagem mandada ao chat em "Fazer com Alfred". Ausente = sem ferramenta. */
  prompt?: string;
  destino: DestinoTarefa;
  /** Quanto o "Fazer com Alfred" leva e custa, no tamanho do lote que o prompt pede. */
  estimativa?: { minutos: number; creditos: number };
  /** destino === 'missao': qual missão abrir. */
  missao?: MissaoSemana;
}

export interface ArtigoAgendado {
  id: string;
  titulo: string;
  scheduledDate: string;
  status: string;
}

export interface SinaisSemana {
  hoje: Date;
  produtosSemDescricao: number;
  produtosSemImagem: number;
  /** Pais com categoria que define atributo ainda vazio. Ausente = categorias não carregadas. */
  produtosSemAtributos?: number;
  /** Pais com foto e nenhuma imagem ambientada. */
  produtosSemAmbientada?: number;
  acoes: AgentAction[];
  artigos: ArtigoAgendado[];
  /** null = módulo desligado ou métrica indisponível. */
  meliPropostasAguardando: number | null;
  integracoesComAlerta: string[];
  /** Providers com ferramenta no registry para esta conta. Ausente = nenhum. */
  alfredFaz?: { produtos?: boolean; meli?: boolean; content?: boolean; tiny?: boolean; wake?: boolean };
  /** Créditos por item (config/credits) — para a estimativa de cada tarefa. */
  custos?: { descricao: number; ambientada: number; video: number };
  /** Achados da última auditoria SEO de cada projeto (erros antes de avisos). */
  seoAchados?: { projeto: string; titulo: string; severidade: 'error' | 'warning' | 'notice'; paginas: number }[];
  /** Pais sem vínculo com nenhum ERP, quando há ERP conectado. */
  produtosForaDoErp?: number;
  /** Primeiro produto pronto para vídeo (descrição, título SEO e referência) e ainda sem. */
  videoSugerido?: { sku: string; nome: string } | null;
  /** Coorte de onboarding: as missões ainda abertas viram as primeiras tarefas. */
  missoes?: { id: MissaoSemana; titulo: string; meta: string; estado: 'agora' | 'opcional' }[];
}

export const PROMPT_DESCRICOES = 'Complete as descrições dos produtos que estão sem, num lote de 5, e me mostre uma amostra antes de gravar.';
export const PROMPT_ATRIBUTOS = 'Preencha os atributos da categoria dos produtos que estão sem, num lote de 5, e me mostre antes de gravar.';
export const PROMPT_AMBIENTADAS = 'Crie imagens ambientadas para os produtos com foto que ainda não têm, num lote de 3, e me mostre antes de gravar.';
export const PROMPT_PEDIDOS_TINY = 'Liste os pedidos do Tiny parados há mais de 2 dias (em aberto ou aprovados sem faturar) e me diga o que fazer com cada um.';
export const PROMPT_BANNER = 'Quais banners estão ativos na home da loja? Proponha um banner para a campanha deste fim de semana.';
export const promptVideo = (sku: string) => `Produza o vídeo do produto de SKU ${sku}.`;
export const promptSeo = (projeto: string, titulo: string) => `Na última auditoria SEO do projeto ${projeto}, o achado "${titulo}" apareceu. Explique o que é, quais páginas têm e como corrigir.`;

/** Tamanho dos lotes que os prompts pedem — a estimativa usa o mesmo número. */
export const LOTE_SEMANA = { descricoes: 5, atributos: 5, ambientadas: 3 };
/** Segundos por item, medidos à mão: texto ~20s, atributos ~10s, 3 imagens ~45s, vídeo ~5 min. */
const SEG = { descricao: 20, atributo: 10, ambientada: 45, video: 300 };
const minutos = (seg: number) => Math.max(1, Math.round(seg / 60));

export const PROMPT_MELI = 'Quais anúncios do Mercado Livre têm proposta de melhoria esperando? Me mostre a de maior impacto.';

export const MAX_POR_DIA = 3;
export const DIAS_CURTOS = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB', 'DOM'];
const DIAS_LONGOS = ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'];

/** Meia-noite local da segunda-feira da semana de `d`. */
export function inicioDaSemana(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const deslocamento = (x.getDay() + 6) % 7; // getDay: 0 = domingo
  x.setDate(x.getDate() - deslocamento);
  return x;
}

/** Índice 0–6 do dia dentro da semana que começa em `inicio`, ou null se fora. */
export function diaNaSemana(inicio: Date, d: Date): number | null {
  const dia = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((dia.getTime() - inicio.getTime()) / 86_400_000);
  return diff >= 0 && diff <= 6 ? diff : null;
}

/** `YYYY-MM-DD` como data local — `new Date('2026-09-30')` seria UTC. */
function dataLocal(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

export function montarSemana(s: SinaisSemana): TarefaSemana[] {
  const inicio = inicioDaSemana(s.hoje);
  const hoje = diaNaSemana(inicio, s.hoje) ?? 0;
  const fixas: TarefaSemana[] = [];
  const flexiveis: Omit<TarefaSemana, 'dia'>[] = [];

  // O que o agente já gravou nesta semana — é o "feito" com recibo.
  for (const a of s.acoes) {
    if (a.status !== 'executed' || !a.resolvedAt) continue;
    const dia = diaNaSemana(inicio, new Date(a.resolvedAt));
    if (dia === null) continue;
    fixas.push({
      id: `acao-${a.id}`,
      origem: origemDoProvider(a.provider),
      titulo: a.preview.resumo,
      detalhe: a.preview.alvo,
      dia,
      estado: 'feita',
      destino: 'atividade',
    });
  }

  for (const art of s.artigos) {
    const data = dataLocal(art.scheduledDate);
    const dia = data ? diaNaSemana(inicio, data) : null;
    if (dia === null) continue;
    const publicado = art.status === 'publicado';
    const revisao = art.status === 'revisao';
    fixas.push({
      id: `artigo-${art.id}`,
      origem: 'conteudo',
      titulo: publicado ? `Artigo publicado: ${art.titulo}` : revisao ? `Revisar o artigo "${art.titulo}"` : `Artigo "${art.titulo}"`,
      detalhe: publicado ? undefined : `Publicação ${dia === hoje ? 'hoje' : DIAS_LONGOS[dia]}`,
      dia,
      estado: publicado ? 'feita' : revisao ? 'precisa' : 'aberta',
      prompt: publicado ? undefined : `Qual o status do artigo "${art.titulo}" e o que falta para publicá-lo?`,
      destino: 'conteudo',
    });
  }

  const pendentes = s.acoes.filter((a) => a.status === 'pending');
  if (pendentes.length > 0) {
    flexiveis.push({
      id: 'aprovacoes',
      origem: pendentes.every((a) => a.provider === pendentes[0].provider) ? origemDoProvider(pendentes[0].provider) : 'operacoes',
      titulo: `Aprovar ${plural(pendentes.length, 'ação do Alfred', 'ações do Alfred')}`,
      detalhe: 'Nada é gravado sem a sua aprovação',
      estado: 'precisa',
      destino: 'atividade',
    });
  }

  for (const nome of s.integracoesComAlerta) {
    flexiveis.push({
      id: `integracao-${nome}`,
      origem: 'operacoes',
      titulo: `Verificar a conexão com ${nome}`,
      detalhe: 'A última checagem não confirmou a credencial',
      estado: 'precisa',
      destino: 'integracoes',
    });
  }

  if (s.meliPropostasAguardando) {
    flexiveis.push({
      id: 'meli-propostas',
      origem: 'meli',
      titulo: `Revisar ${plural(s.meliPropostasAguardando, 'proposta', 'propostas')} de melhoria no Mercado Livre`,
      estado: 'precisa',
      prompt: s.alfredFaz?.meli ? PROMPT_MELI : undefined,
      destino: 'meli',
    });
  }

  if (s.produtosSemDescricao > 0) {
    flexiveis.push({
      id: 'produtos-descricao',
      origem: 'produto',
      titulo: `Completar a descrição de ${plural(s.produtosSemDescricao, 'produto', 'produtos')}`,
      detalhe: 'Sem descrição o produto aparece mal na busca',
      estado: 'aberta',
      prompt: s.alfredFaz?.produtos ? PROMPT_DESCRICOES : undefined,
      destino: 'produtos',
      ...estimar(s, 'descricao', Math.min(LOTE_SEMANA.descricoes, s.produtosSemDescricao)),
    });
  }

  if (s.produtosSemImagem > 0) {
    flexiveis.push({
      id: 'produtos-imagem',
      origem: 'produto',
      titulo: `Adicionar foto a ${plural(s.produtosSemImagem, 'produto', 'produtos')}`,
      estado: 'aberta',
      destino: 'produtos',
    });
  }

  // Depois do que conta como incompleto (descrição, foto): atributos e
  // ambientada melhoram o produto, mas não o deixam quebrado — por isso vêm
  // no fim da fila do dia, nunca na frente.
  if (s.produtosSemAtributos) {
    flexiveis.push({
      id: 'produtos-atributos',
      origem: 'produto',
      titulo: `Preencher os atributos de ${plural(s.produtosSemAtributos, 'produto', 'produtos')}`,
      detalhe: 'Cor, material, medidas — viram filtro na loja',
      estado: 'aberta',
      prompt: s.alfredFaz?.produtos ? PROMPT_ATRIBUTOS : undefined,
      destino: 'produtos',
      ...estimar(s, 'atributo', Math.min(LOTE_SEMANA.atributos, s.produtosSemAtributos)),
    });
  }

  if (s.produtosSemAmbientada) {
    flexiveis.push({
      id: 'produtos-ambientada',
      origem: 'produto',
      titulo: `Criar imagens ambientadas de ${plural(s.produtosSemAmbientada, 'produto', 'produtos')}`,
      detalhe: 'O produto em uso, a partir da foto real',
      estado: 'aberta',
      prompt: s.alfredFaz?.produtos ? PROMPT_AMBIENTADAS : undefined,
      destino: 'produtos',
      ...estimar(s, 'ambientada', Math.min(LOTE_SEMANA.ambientadas, s.produtosSemAmbientada)),
    });
  }

  if (s.videoSugerido && s.alfredFaz?.produtos) {
    flexiveis.push({
      id: `video-${s.videoSugerido.sku}`,
      origem: 'produto',
      titulo: `Vídeo para ${s.videoSugerido.nome}`,
      detalhe: 'Já tem descrição, título SEO e a referência do produto',
      estado: 'aberta',
      prompt: promptVideo(s.videoSugerido.sku),
      destino: 'produtos',
      ...estimar(s, 'video', 1),
    });
  }

  if (s.produtosForaDoErp) {
    flexiveis.push({
      id: 'produtos-fora-erp',
      origem: 'operacoes',
      titulo: `${plural(s.produtosForaDoErp, 'produto está fora', 'produtos estão fora')} do ERP`,
      detalhe: 'Sem cadastro no ERP o Alfred não consegue enviar o que escreveu',
      estado: 'aberta',
      destino: 'produtos',
    });
  }

  // Auditoria SEO: uma tarefa por achado, os 3 mais graves.
  const graves = [...(s.seoAchados ?? [])]
    .sort((a, b) => ordemSeveridade(a.severidade) - ordemSeveridade(b.severidade) || b.paginas - a.paginas)
    .slice(0, 3);
  for (const [i, a] of graves.entries()) {
    flexiveis.push({
      id: `seo-${i}-${a.titulo}`,
      origem: 'conteudo',
      titulo: `Corrigir: ${a.titulo}`,
      detalhe: `${a.projeto} · ${plural(a.paginas, 'página', 'páginas')} na auditoria SEO`,
      estado: 'aberta',
      prompt: s.alfredFaz?.content ? promptSeo(a.projeto, a.titulo) : undefined,
      destino: 'conteudo',
    });
  }

  if (s.alfredFaz?.tiny) {
    flexiveis.push({
      id: 'tiny-pedidos',
      origem: 'operacoes',
      titulo: 'Conferir pedidos parados no Tiny',
      detalhe: 'Em aberto ou aprovados sem faturar há mais de 2 dias',
      estado: 'aberta',
      prompt: PROMPT_PEDIDOS_TINY,
      destino: 'integracoes',
      estimativa: { minutos: 1, creditos: 0 },
    });
  }

  // O banner do fim de semana tem data: entra na quinta (ou hoje, se já passou).
  // Fica até domingo — tarefa que some da lista conta como feita no histórico.
  if (s.alfredFaz?.wake) {
    fixas.push({
      id: 'wake-banner-fds',
      origem: 'operacoes',
      titulo: 'Banner da campanha de fim de semana',
      detalhe: 'O Alfred vê os banners ativos e propõe um novo',
      dia: Math.max(3, hoje),
      estado: 'aberta',
      prompt: PROMPT_BANNER,
      destino: 'integracoes',
      estimativa: { minutos: 2, creditos: 0 },
    });
  }

  // Coorte de onboarding: as missões abertas são a primeira semana, na frente
  // de tudo que não precisa do usuário (sem trilha paralela).
  const missoes = (s.missoes ?? []).map<Omit<TarefaSemana, 'dia'>>((m) => ({
    id: `missao-${m.id}`,
    origem: m.id === 'meli' ? 'meli'
      : m.id === 'conteudo' || m.id === 'publicar-blog' ? 'conteudo'
        : m.id === 'produto' || m.id === 'catalogo' ? 'produto' : 'operacoes',
    titulo: m.titulo,
    detalhe: m.meta,
    estado: 'aberta',
    destino: 'missao',
    missao: m.id,
  }));
  flexiveis.unshift(...missoes.filter((_, i) => (s.missoes ?? [])[i].estado === 'agora'));
  flexiveis.push(...missoes.filter((_, i) => (s.missoes ?? [])[i].estado === 'opcional'));

  // `precisa` na frente; dentro do mesmo estado, a ordem de inserção acima.
  flexiveis.sort((a, b) => Number(b.estado === 'precisa') - Number(a.estado === 'precisa'));

  const ocupacao = Array.from({ length: 7 }, (_, d) => fixas.filter((t) => t.dia === d && t.estado !== 'feita').length);
  const distribuidas: TarefaSemana[] = flexiveis.map((t) => {
    let dia = hoje;
    while (dia < 6 && ocupacao[dia] >= MAX_POR_DIA) dia++;
    ocupacao[dia]++;
    return { ...t, dia };
  });

  return [...fixas, ...distribuidas].sort(
    (a, b) => a.dia - b.dia || ordemEstado(a.estado) - ordemEstado(b.estado),
  );
}

function ordemSeveridade(s: 'error' | 'warning' | 'notice'): number {
  return s === 'error' ? 0 : s === 'warning' ? 1 : 2;
}

/** Estimativa de um "Fazer com Alfred" com `n` itens; sem custos carregados, só o tempo. */
function estimar(s: SinaisSemana, tipo: 'descricao' | 'atributo' | 'ambientada' | 'video', n: number): Pick<TarefaSemana, 'estimativa'> {
  if (n <= 0) return {};
  const porItem = tipo === 'descricao' ? s.custos?.descricao : tipo === 'ambientada' ? s.custos?.ambientada : tipo === 'video' ? s.custos?.video : 0;
  return { estimativa: { minutos: minutos(SEG[tipo] * n), creditos: (porItem ?? 0) * n } };
}

/** "~2 min · 15 créditos", "~1 min · grátis". */
export function textoEstimativa(e: { minutos: number; creditos: number }): string {
  return `~${e.minutos} min · ${e.creditos ? `${e.creditos} ${e.creditos === 1 ? 'crédito' : 'créditos'}` : 'grátis'}`;
}

/** Id do documento da semana em users/{uid}/semanas: a segunda-feira, `YYYY-MM-DD` local. */
export function chaveDaSemana(inicio: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${inicio.getFullYear()}-${p(inicio.getMonth() + 1)}-${p(inicio.getDate())}`;
}

export interface SemanaGuardada {
  inicio: string;
  total: number;
  feitas: number;
  tarefas: Pick<TarefaSemana, 'id' | 'titulo' | 'origem' | 'estado' | 'dia'>[];
}

/**
 * O que fica guardado da semana: o suficiente para o histórico ("semana
 * passada: 7 de 9") e para ver depois o que foi proposto, sem prompts nem
 * estimativas (que mudam de preço). Uma tarefa feita nunca volta a aberta no
 * histórico: a semana é recalculada a partir do estado atual, e o produto que
 * ganhou descrição some da lista — `anterior` preserva quem já foi riscado.
 */
export function semanaParaGuardar(inicio: Date, tarefas: TarefaSemana[], anterior?: SemanaGuardada | null): SemanaGuardada {
  const atuais = new Map(tarefas.map((t) => [t.id, { id: t.id, titulo: t.titulo, origem: t.origem, estado: t.estado, dia: t.dia }]));
  for (const t of anterior?.tarefas ?? []) {
    const agora = atuais.get(t.id);
    // Sumiu da lista porque foi resolvida, ou já estava feita: fica como feita.
    if (!agora) atuais.set(t.id, { ...t, estado: 'feita' });
    else if (t.estado === 'feita') atuais.set(t.id, { ...agora, estado: 'feita' });
  }
  const lista = [...atuais.values()].sort((a, b) => a.dia - b.dia);
  return {
    inicio: chaveDaSemana(inicio),
    total: lista.length,
    feitas: lista.filter((t) => t.estado === 'feita').length,
    tarefas: lista,
  };
}

/** Só grava quando algo mudou de fato. */
export function mesmaSemana(a: SemanaGuardada | null | undefined, b: SemanaGuardada): boolean {
  return !!a && a.total === b.total && a.feitas === b.feitas
    && a.tarefas.map((t) => `${t.id}:${t.estado}`).join('|') === b.tarefas.map((t) => `${t.id}:${t.estado}`).join('|');
}

/** De qual agente veio uma ação do Alfred, na legenda de cores da semana. */
export function origemDoProvider(provider: string): OrigemTarefa {
  if (provider === 'content') return 'conteudo';
  if (provider === 'produtos') return 'produto';
  if (provider === 'meli') return 'meli';
  return 'operacoes';
}

function ordemEstado(e: EstadoTarefa): number {
  return e === 'precisa' ? 0 : e === 'aberta' ? 1 : 2;
}

/** A ação mais valiosa agora: o que precisa do usuário hoje, senão a próxima aberta. */
export function proximoPasso(tarefas: TarefaSemana[], hoje: number): TarefaSemana | null {
  const pendentes = tarefas.filter((t) => t.estado !== 'feita' && t.dia >= hoje);
  return pendentes.find((t) => t.estado === 'precisa') ?? pendentes[0] ?? null;
}

/** Produto sem nenhuma URL de imagem (interna ou externa). */
export function semImagem(p: Record<string, unknown>): boolean {
  return !Object.keys(p).some((k) => /^URL imagem/i.test(k) && typeof p[k] === 'string' && (p[k] as string).trim() !== '');
}
