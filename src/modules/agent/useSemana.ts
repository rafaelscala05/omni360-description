// Junta os sinais que alimentam a "Sua semana" (ver semana.ts) a partir do que
// o app já carrega: produtos em memória, ações do agente, calendário de
// conteúdo de todos os projetos e as propostas do otimizador do Mercado Livre.
//
// Ações e integrações vêm de fora quando o chamador já as escuta (a tela do
// Alfred escuta as duas para a régua e o chat), para não abrir um segundo
// listener no mesmo documento.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Category, Product } from '../../types/models';
import { getEffectiveAttributes } from '../../services/categoryService';
import type { AgentAction } from '../../types/agent';
import type { IntegrationSummary } from '../../services/integrationsStatusService';
import { listenCalendar, listenLatestSeoAudit, listenProjects } from '../../services/contentService';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { CREDIT_ACTIONS, resolveCreditCost } from '../../credits';
import { getMeliOperationalMetrics } from '../../services/meliService';
import { fetchTools, iniciarVideoDoAlfred, listenActions } from '../../services/agentChatService';
import { videosParaIniciar } from './videoAlfred';
import {
  chaveDaSemana, diaNaSemana, inicioDaSemana, mesmaSemana, montarSemana, semanaParaGuardar, semImagem,
  type ArtigoAgendado, type SemanaGuardada, type SinaisSemana, type TarefaSemana,
} from './semana';
import { noErp } from './produtosAgente';

export function useArtigosDaSemana(uid: string, ativo: boolean): ArtigoAgendado[] {
  const [artigos, setArtigos] = useState<ArtigoAgendado[]>([]);

  useEffect(() => {
    if (!ativo) {
      setArtigos([]);
      return;
    }
    const porProjeto = new Map<string, ArtigoAgendado[]>();
    const subs = new Map<string, () => void>();
    const emitir = () => setArtigos([...porProjeto.values()].flat());

    const offProjetos = listenProjects(uid, (projetos) => {
      const ids = new Set(projetos.map((p) => p.id));
      for (const [id, off] of subs) {
        if (ids.has(id)) continue;
        off();
        subs.delete(id);
        porProjeto.delete(id);
      }
      for (const p of projetos) {
        if (subs.has(p.id)) continue;
        subs.set(p.id, listenCalendar(uid, p.id, (lista) => {
          porProjeto.set(p.id, lista.map((a) => ({
            id: `${p.id}/${a.id}`,
            titulo: a.titulo,
            scheduledDate: a.scheduledDate,
            status: a.status,
          })));
          emitir();
        }));
      }
      emitir();
    });

    return () => {
      offProjetos();
      subs.forEach((off) => off());
    };
  }, [uid, ativo]);

  return artigos;
}

/** Propostas do otimizador esperando decisão. null = módulo desligado ou falha. */
export function useMeliPropostasAguardando(ativo: boolean): number | null {
  const [n, setN] = useState<number | null>(null);

  useEffect(() => {
    if (!ativo) {
      setN(null);
      return;
    }
    let vivo = true;
    getMeliOperationalMetrics()
      .then((m) => {
        if (!vivo) return;
        const s = m.proposals.byStatus;
        setN((s.awaiting_review ?? 0) + (s.partially_approved ?? 0));
      })
      .catch(() => { if (vivo) setN(null); });
    return () => { vivo = false; };
  }, [ativo]);

  return n;
}

interface Opcoes {
  uid: string;
  products: Product[];
  acoes: AgentAction[];
  integracoes: IntegrationSummary[];
  hasContentAgent: boolean;
  hasMeli: boolean;
  /** Providers com ferramenta no registry (ver useProvidersAlfred). */
  providers?: string[];
  extras?: ExtrasSemana;
}

/** O que só o App sabe e a semana usa — num objeto só, para não virar uma prop por fonte. */
export interface ExtrasSemana {
  /** Sem categorias carregadas, a tarefa de atributos não aparece (não dá para saber o que falta). */
  categories?: Category[];
  /** Módulo de vídeo ligado: só então a semana sugere um vídeo. */
  hasVideo?: boolean;
  /** Coorte de onboarding: as missões abertas (montarTrilha). */
  missoes?: SinaisSemana['missoes'];
  /** Coorte de onboarding: quantas missões da trilha já foram feitas ("2 de 5" em Ferramentas). */
  missoesResumo?: { feitas: number; total: number };
}

/** Custos por item de config/credits, lidos uma vez por sessão. */
let custosCache: Promise<Record<string, number>> | null = null;
function useCustos(): SinaisSemana['custos'] {
  const [costs, setCosts] = useState<Record<string, number> | null>(null);
  useEffect(() => {
    let vivo = true;
    custosCache ??= getDoc(doc(db, 'config', 'credits'))
      .then((s) => (s.data()?.costs as Record<string, number>) ?? {})
      .catch(() => { custosCache = null; return {}; });
    custosCache.then((c) => { if (vivo) setCosts(c); });
    return () => { vivo = false; };
  }, []);
  return useMemo(() => costs && ({
    descricao: resolveCreditCost(costs, CREDIT_ACTIONS.generateSeoMass.key),
    ambientada: resolveCreditCost(costs, CREDIT_ACTIONS.ambientImage.key),
    video: resolveCreditCost(costs, CREDIT_ACTIONS.videoGeneration.key),
  }) || undefined, [costs]);
}

/** Achados (erro/aviso) da última auditoria SEO de cada projeto de conteúdo. */
export function useAchadosSeo(uid: string, ativo: boolean): NonNullable<SinaisSemana['seoAchados']> {
  const [achados, setAchados] = useState<NonNullable<SinaisSemana['seoAchados']>>([]);
  useEffect(() => {
    if (!ativo) { setAchados([]); return; }
    const porProjeto = new Map<string, NonNullable<SinaisSemana['seoAchados']>>();
    const subs = new Map<string, () => void>();
    const emitir = () => setAchados([...porProjeto.values()].flat());
    const off = listenProjects(uid, (projetos) => {
      for (const p of projetos) {
        if (subs.has(p.id)) continue;
        const nome = p.config?.nomeEmpresa || 'projeto';
        subs.set(p.id, listenLatestSeoAudit(uid, p.id, (audit) => {
          porProjeto.set(p.id, (audit?.topIssues ?? [])
            .filter((i) => i.severity !== 'notice' && i.count > 0)
            .map((i) => ({ projeto: nome, titulo: i.title, severidade: i.severity, paginas: i.count })));
          emitir();
        }));
      }
    });
    return () => { off(); subs.forEach((f) => f()); };
  }, [uid, ativo]);
  return achados;
}

/**
 * Guarda a semana em users/{uid}/semanas/{segunda} e devolve o resumo da
 * anterior. A semana é recalculada a cada render a partir do estado atual;
 * o doc é o que sobra dela — inclusive o que foi resolvido e saiu da lista.
 * Grava só quando algo mudou, e no máximo uma vez por minuto.
 */
export function useHistoricoSemana(uid: string, tarefas: TarefaSemana[], ativo: boolean): { feitas: number; total: number } | null {
  const [passada, setPassada] = useState<{ feitas: number; total: number } | null>(null);
  const guardadaRef = useRef<SemanaGuardada | null | undefined>(undefined);
  const ultimaGravacaoRef = useRef(0);
  const [lido, setLido] = useState(0);
  const inicio = inicioDaSemana(new Date());
  const chave = chaveDaSemana(inicio);

  useEffect(() => {
    if (!ativo || !uid) return;
    let vivo = true;
    const anterior = new Date(inicio);
    anterior.setDate(anterior.getDate() - 7);
    guardadaRef.current = undefined;
    Promise.all([
      getDoc(doc(db, 'users', uid, 'semanas', chave)).catch(() => null),
      getDoc(doc(db, 'users', uid, 'semanas', chaveDaSemana(anterior))).catch(() => null),
    ]).then(([atual, ant]) => {
      if (!vivo) return;
      guardadaRef.current = (atual?.data() as SemanaGuardada | undefined) ?? null;
      const a = ant?.data() as SemanaGuardada | undefined;
      setPassada(a && a.total ? { feitas: a.feitas, total: a.total } : null);
      setLido((n) => n + 1);
    });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, ativo, chave]);

  useEffect(() => {
    // undefined = o doc desta semana ainda não foi lido; gravar antes apagaria o histórico.
    if (!ativo || !uid || guardadaRef.current === undefined || !tarefas.length) return;
    const nova = semanaParaGuardar(inicio, tarefas, guardadaRef.current);
    if (mesmaSemana(guardadaRef.current, nova)) return;
    if (Date.now() - ultimaGravacaoRef.current < 60_000) return;
    ultimaGravacaoRef.current = Date.now();
    guardadaRef.current = nova;
    setDoc(doc(db, 'users', uid, 'semanas', chave), { ...nova, atualizadaEm: new Date().toISOString() }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, ativo, chave, tarefas, lido]);

  return passada;
}

/** O primeiro produto pronto para vídeo (descrição, título SEO e referência) que ainda não tem. */
export function sugerirVideo(pais: Product[]): { sku: string; nome: string } | null {
  const ok = (v: unknown) => !!String(v ?? '').trim();
  const p = pais.find((x) => ok(x['Descrição complementar']) && ok(x['Título SEO'])
    && ok((x as { _productReference?: { imageUrl?: string } })._productReference?.imageUrl)
    && !ok(x._videoUrl) && !ok(x._ugcVideoUrl) && !x._videoJobId && !x._ugcVideoJobId && ok(x['Código (SKU)']));
  return p ? { sku: String(p['Código (SKU)']).trim(), nome: String(p['Descrição'] ?? p['Código (SKU)']) } : null;
}

const vazio = (v: unknown) => (Array.isArray(v) ? v.length === 0 : !String(v ?? '').trim());

/**
 * Pais cuja categoria define atributo ainda vazio — a mesma conta de
 * selecionarParaAtributos (server/agent/produtosRules.ts), para "Fazer com
 * Alfred" nunca abrir um lote vazio.
 */
export function contarSemAtributos(pais: Product[], categories: Category[]): number {
  return pais.filter((p) => {
    if (!p.categoryId) return false;
    const defs = getEffectiveAttributes(p.categoryId, categories);
    return defs.some((d) => vazio(p.attributes?.[d.key]?.value));
  }).length;
}

/** Quais providers o Alfred consegue operar nesta conta — liga o "Fazer com Alfred". */
export function useProvidersAlfred(uid: string, ativo: boolean): string[] {
  const [providers, setProviders] = useState<string[]>([]);
  useEffect(() => {
    if (!ativo) { setProviders([]); return; }
    let vivo = true;
    fetchTools().then((r) => { if (vivo) setProviders(r.providers ?? []); }).catch(() => {});
    return () => { vivo = false; };
  }, [uid, ativo]);
  return providers;
}

export function useSemana({ uid, products, acoes, integracoes, hasContentAgent, hasMeli, providers = [], extras = {} }: Opcoes): {
  tarefas: TarefaSemana[];
  hoje: number;
  artigos: ArtigoAgendado[];
  meliPropostasAguardando: number | null;
} {
  const artigos = useArtigosDaSemana(uid, hasContentAgent);
  const custos = useCustos();
  const seoAchados = useAchadosSeo(uid, hasContentAgent);
  const { categories, hasVideo, missoes } = extras;
  const meliPropostasAguardando = useMeliPropostasAguardando(hasMeli);

  // Variação herda descrição e foto do pai na vitrine — contar as filhas
  // multiplicaria a mesma pendência pelo número de grades.
  const { semDescricao, semFoto, semAmbientada } = useMemo(() => {
    const pais = products.filter((p) => !String(p['Código do pai'] ?? '').trim() && !p._blingDeleted && !p._idworksDeleted);
    const comFoto = (p: Product) => !semImagem(p as unknown as Record<string, unknown>);
    return {
      semDescricao: pais.filter((p) => !String(p['Descrição complementar'] ?? '').trim()).length,
      semFoto: pais.filter((p) => !comFoto(p)).length,
      semAmbientada: pais.filter((p) => comFoto(p) && !(p._ambientImages?.length)).length,
    };
  }, [products]);

  const semAtributos = useMemo(() => {
    if (!categories?.length) return 0;
    return contarSemAtributos(products.filter((p) => !String(p['Código do pai'] ?? '').trim()), categories);
  }, [products, categories]);

  const erpConectado = integracoes.some((i) => i.chave !== 'wake' && i.conectado);
  const { foraDoErp, videoSugerido } = useMemo(() => {
    const pais = products.filter((p) => !String(p['Código do pai'] ?? '').trim() && !p._blingDeleted && !p._idworksDeleted);
    return {
      foraDoErp: erpConectado ? pais.filter((p) => !noErp(p)).length : 0,
      videoSugerido: hasVideo ? sugerirVideo(pais) : null,
    };
  }, [products, erpConectado, hasVideo]);

  const integracoesComAlerta = useMemo(
    () => integracoes.filter((i) => i.conectado && !i.validado).map((i) => i.nome),
    [integracoes],
  );

  return useMemo(() => {
    const agora = new Date();
    return {
      tarefas: montarSemana({
        hoje: agora,
        produtosSemDescricao: semDescricao,
        produtosSemImagem: semFoto,
        produtosSemAtributos: semAtributos,
        produtosSemAmbientada: semAmbientada,
        acoes,
        artigos,
        meliPropostasAguardando,
        integracoesComAlerta,
        alfredFaz: {
          produtos: providers.includes('produtos'), meli: providers.includes('meli'), content: providers.includes('content'),
          tiny: providers.includes('tiny'), wake: providers.includes('wake'),
        },
        custos,
        seoAchados,
        produtosForaDoErp: foraDoErp,
        videoSugerido,
        missoes,
      }),
      hoje: diaNaSemana(inicioDaSemana(agora), agora) ?? 0,
      artigos,
      meliPropostasAguardando,
    };
  }, [semDescricao, semFoto, semAtributos, semAmbientada, custos, seoAchados, foraDoErp, videoSugerido, missoes, acoes, artigos, meliPropostasAguardando, integracoesComAlerta, providers]);
}

/**
 * Aprovações do Alfred esperando o usuário — o selo da aba Atividade.
 *
 * `onCatalogoAlterado` dispara quando uma ação de produto passa a executada
 * depois que o app abriu: o catálogo mora em memória no App e só é relido por
 * loadFromCloud, então sem isso as descrições que o Alfred gravou só
 * apareceriam no próximo login.
 */
export function usePendentesAlfred(ativo: boolean, onCatalogoAlterado?: () => void): number {
  const [n, setN] = useState(0);
  const cbRef = useRef(onCatalogoAlterado);
  cbRef.current = onCatalogoAlterado;
  useEffect(() => {
    if (!ativo) {
      setN(0);
      return;
    }
    let vistas: Set<string> | null = null;
    return listenActions((lista) => {
      setN(lista.filter((a) => a.status === 'pending').length);
      // Um lote grava aos poucos (aprovar as prontas antes do fim): a chave
      // inclui quantos já foram gravados, para reler a cada leva, não só no fim.
      const executadas = lista
        .filter((a) => a.provider === 'produtos' && (a.status === 'executed' || ((a.result as { gravados?: number } | undefined)?.gravados ?? 0) > 0))
        .map((a) => `${a.id}:${(a.result as { gravados?: number } | undefined)?.gravados ?? ''}`);
      if (vistas && executadas.some((id) => !vistas!.has(id))) cbRef.current?.();
      vistas = new Set(executadas);
    });
  }, [ativo]);
  return n;
}

/**
 * Começa os vídeos aprovados no chat (videoAlfred.ts). Cada ação é tentada uma
 * vez por sessão; o servidor reivindica numa transação, então outra aba
 * aberta não gera um segundo vídeo.
 */
export function useVideosDoAlfred(ativo: boolean): void {
  useEffect(() => {
    if (!ativo) return;
    const tentados = new Set<string>();
    return listenActions((lista) => {
      for (const id of videosParaIniciar(lista)) {
        if (tentados.has(id)) continue;
        tentados.add(id);
        iniciarVideoDoAlfred(id).catch((e) => console.warn('[alfred] vídeo não iniciou', e?.message));
      }
    });
  }, [ativo]);
}
