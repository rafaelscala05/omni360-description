// Tela 0 da coorte missao-v2: o cliente marca um ou mais objetivos, na ordem
// que quiser; o primeiro vira a missão desta sessão. PURO — verificar com
// `npx tsx scripts/verify-objetivos.mjs`.

import type { Objetivo } from '../../agent/capacidades';
import type { MissionId } from './missionTypes';

export const OBJETIVO_INFO: Record<Objetivo, { titulo: string; sub: string; agente: string; curto: string }> = {
  produto: { titulo: 'Melhorar a descrição dos produtos', sub: 'cole o link de um produto ou suba a planilha', agente: 'Agente de Produto', curto: 'pelas descrições' },
  meli: { titulo: 'Otimizar meu Mercado Livre', sub: 'títulos, fichas e fotos dos seus anúncios', agente: 'Agente Mercado Livre', curto: 'pelo Mercado Livre' },
  conteudo: { titulo: 'Gerar conteúdo para o meu blog', sub: 'montamos o blog a partir do seu site', agente: 'Agente de Conteúdo', curto: 'pelo blog' },
};

export function alternarObjetivo(sel: Objetivo[], o: Objetivo): Objetivo[] {
  return sel.includes(o) ? sel.filter((x) => x !== o) : [...sel, o];
}

export function rotuloComecar(sel: Objetivo[]): string {
  return sel.length ? `Começar ${OBJETIVO_INFO[sel[0]].curto}` : 'Escolha um para começar';
}

/** Missão de tela cheia do objetivo. ML ainda não tem (fase 4): abre a tela do otimizador. */
export function missaoDoObjetivo(o: Objetivo): MissionId | null {
  return o === 'meli' ? null : o;
}
