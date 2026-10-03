// Regras puras da adesão a módulos (sem I/O). A rota POST /api/onboarding/aderir
// em onboardingAgent.ts só faz a transação em volta disto.
//
// Adesão é livre: aceitou o objetivo, o módulo liga — uma vez. Cada objetivo
// paga o crédito de missão uma única vez — quem decide "uma vez" é o create() do doc
// users/{uid}/adesoes/{objetivo}; aqui só se calcula o que pagar.

import { OBJETIVOS, modulosDoObjetivo, type Objetivo } from '../src/modules/agent/capacidades';

export const BONUS_MISSAO_PADRAO: Record<Objetivo, number> = { produto: 10, meli: 20, conteudo: 15 };
const BONUS_MAXIMO = 200;

/** Texto gravado com o aceite — o mesmo mostrado na Tela 0 e no "Montar". */
export const TEXTO_ADESAO: Record<Objetivo, string> = {
  produto: 'Ativar o Agente de Produto para melhorar as descrições do meu catálogo.',
  meli: 'Ativar o Agente Mercado Livre para otimizar os meus anúncios.',
  conteudo: 'Ativar o Agente de Conteúdo para montar e escrever o meu blog.',
};

export function validarPedidoAdesao(body: unknown): { ok: true; objetivos: Objetivo[] } | { ok: false; erro: string } {
  const raw = (body as { objetivos?: unknown } | null)?.objetivos;
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, erro: 'Escolha ao menos um objetivo' };
  const objetivos: Objetivo[] = [];
  for (const o of raw) {
    if (!(OBJETIVOS as readonly unknown[]).includes(o)) return { ok: false, erro: `Objetivo desconhecido: ${String(o)}` };
    if (!objetivos.includes(o as Objetivo)) objetivos.push(o as Objetivo);
  }
  return { ok: true, objetivos };
}

/** config/credits.missao.{objetivo}, se for inteiro entre 0 e 200; senão o padrão. */
export function bonusDaMissao(config: unknown, o: Objetivo): number {
  const v = (config as { missao?: Record<string, unknown> } | undefined)?.missao?.[o];
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= BONUS_MAXIMO ? v : BONUS_MISSAO_PADRAO[o];
}

export function planejarAdesao(p: { pedidos: Objetivo[]; jaAderidos: Objetivo[]; config: unknown }): {
  novos: Objetivo[];
  creditos: number;
  campos: Record<string, true>;
} {
  const novos = p.pedidos.filter((o) => !p.jaAderidos.includes(o));
  const campos: Record<string, true> = {};
  // Só o objetivo novo liga módulo. Já aderido e com o módulo desligado quer
  // dizer que o admin desligou (abuso, suporte) — o cliente não religa sozinho.
  for (const o of novos) for (const m of modulosDoObjetivo(o)) campos[`modules.${m}`] = true;
  return { novos, creditos: novos.reduce((s, o) => s + bonusDaMissao(p.config, o), 0), campos };
}
