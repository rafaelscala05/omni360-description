// Junta os sinais que alimentam a "Sua semana" (ver semana.ts) a partir do que
// o app já carrega: produtos em memória, ações do agente, calendário de
// conteúdo de todos os projetos e as propostas do otimizador do Mercado Livre.
//
// Ações e integrações vêm de fora quando o chamador já as escuta (a tela do
// Alfred escuta as duas para a régua e o chat), para não abrir um segundo
// listener no mesmo documento.

import { useEffect, useMemo, useState } from 'react';
import type { Product } from '../../types/models';
import type { AgentAction } from '../../types/agent';
import type { IntegrationSummary } from '../../services/integrationsStatusService';
import { listenCalendar, listenProjects } from '../../services/contentService';
import { getMeliOperationalMetrics } from '../../services/meliService';
import { listenActions } from '../../services/agentChatService';
import { diaNaSemana, inicioDaSemana, montarSemana, semImagem, type ArtigoAgendado, type TarefaSemana } from './semana';

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
}

export function useSemana({ uid, products, acoes, integracoes, hasContentAgent, hasMeli }: Opcoes): {
  tarefas: TarefaSemana[];
  hoje: number;
  artigos: ArtigoAgendado[];
  meliPropostasAguardando: number | null;
} {
  const artigos = useArtigosDaSemana(uid, hasContentAgent);
  const meliPropostasAguardando = useMeliPropostasAguardando(hasMeli);

  // Variação herda descrição e foto do pai na vitrine — contar as filhas
  // multiplicaria a mesma pendência pelo número de grades.
  const { semDescricao, semFoto } = useMemo(() => {
    const pais = products.filter((p) => !String(p['Código do pai'] ?? '').trim());
    return {
      semDescricao: pais.filter((p) => !String(p['Descrição complementar'] ?? '').trim()).length,
      semFoto: pais.filter((p) => semImagem(p as unknown as Record<string, unknown>)).length,
    };
  }, [products]);

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
        acoes,
        artigos,
        meliPropostasAguardando,
        integracoesComAlerta,
      }),
      hoje: diaNaSemana(inicioDaSemana(agora), agora) ?? 0,
      artigos,
      meliPropostasAguardando,
    };
  }, [semDescricao, semFoto, acoes, artigos, meliPropostasAguardando, integracoesComAlerta]);
}

/** Aprovações do Alfred esperando o usuário — o selo da aba Atividade. */
export function usePendentesAlfred(ativo: boolean): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!ativo) {
      setN(0);
      return;
    }
    return listenActions((lista) => setN(lista.filter((a) => a.status === 'pending').length));
  }, [ativo]);
  return n;
}
