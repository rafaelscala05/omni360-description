// Os números da porta Ferramentas (F1 no celular, D2 no desktop). Puro:
// recebe o que o app já tem — verificar com `npx tsx scripts/verify-produtos-agente.mjs`.

import type { Product } from '../../types/models';
import { diaNaSemana, inicioDaSemana, type TarefaSemana } from './semana';
import { ehPai, incompleto, noErp, semDescricao, temAmbientada, temFoto } from './produtosAgente';
import type { ArtigoAgendado } from './semana';

export function resumoProdutos(products: Product[]) {
  const pais = products.filter((p) => ehPai(p) && !p._blingDeleted && !p._idworksDeleted);
  return {
    total: pais.length,
    incompletos: pais.filter(incompleto).length,
    semDescricao: pais.filter(semDescricao).length,
    semFoto: pais.filter((p) => !temFoto(p)).length,
    semAmbientada: pais.filter((p) => temFoto(p) && !temAmbientada(p)).length,
    foraDoErp: pais.filter((p) => !noErp(p)).length,
  };
}

const dataLocal = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
};

export function resumoConteudo(artigos: ArtigoAgendado[], hoje = new Date()) {
  const inicio = inicioDaSemana(hoje);
  const daSemana = artigos.filter((a) => {
    const d = dataLocal(a.scheduledDate);
    return d && diaNaSemana(inicio, d) !== null;
  });
  return {
    semana: daSemana.length,
    revisao: daSemana.filter((a) => a.status === 'revisao').length,
    publicadosMes: artigos.filter((a) => {
      const d = dataLocal(a.scheduledDate);
      return a.status === 'publicado' && d && d.getFullYear() === hoje.getFullYear() && d.getMonth() === hoje.getMonth();
    }).length,
  };
}

/**
 * "Alfred sugere" (D2): pedidos prontos, tirados da semana — os que o chat
 * resolve sozinho (têm prompt), menos o próximo passo, que já está no topo.
 * Sempre termina com "montar a semana", que vale para qualquer conta.
 */
export const PROMPT_MONTAR_SEMANA = 'Olhe as pendências desta semana e me diga, em ordem, o que fazer primeiro e por quê.';

export function sugestoesAlfred(tarefas: TarefaSemana[], passo: TarefaSemana | null, max = 3): { titulo: string; prompt: string }[] {
  const vistas = new Set<string>([passo?.prompt ?? '']);
  const out: { titulo: string; prompt: string }[] = [];
  for (const t of tarefas) {
    if (!t.prompt || t.estado === 'feita' || vistas.has(t.prompt)) continue;
    vistas.add(t.prompt);
    out.push({ titulo: t.titulo, prompt: t.prompt });
    if (out.length === max - 1) break;
  }
  out.push({ titulo: 'Montar a semana com estas pendências', prompt: PROMPT_MONTAR_SEMANA });
  return out;
}
