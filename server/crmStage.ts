// Regra de negócio pura do CRM: estágio da jornada, health score e estagnação.
// SEM I/O — nenhum import de firebase ou express. Isso mantém toda a decisão de
// estágio num lugar só (em vez de espalhada por endpoint) e permite exercitar as
// regras com um script Node avulso (scripts/verify-crm-stage.mjs).

import {
  CRM_STAGES,
  STAGNATION_DAYS,
  type CrmStage,
  type CrmSummary,
  type HealthBand,
} from '../src/types/crm';

// Nome do evento → marco que ele comprova. Eventos fora deste mapa entram na
// timeline mas não movem o estágio.
export const EVENT_MILESTONE: Record<string, CrmStage> = {
  signed_up: 'signed_up',
  onboarding_completed: 'signed_up',
  spreadsheet_import: 'products_uploaded',
  erp_import: 'products_uploaded',
  description_generated: 'content_generated',
  image_generated: 'content_generated',
  video_generated: 'content_generated',
  attributes_generated: 'content_generated',
  spreadsheet_export: 'integrated_or_exported',
  erp_connected: 'integrated_or_exported',
  erp_push: 'integrated_or_exported',
};

// actionKeys de credit_logs que produzem texto e que produzem imagem. A união
// das duas listas é o que comprova o marco "Gerou Descrição ou Imagem", e cada
// lista alimenta o contador correspondente na reconciliação — senão a aba "Uso"
// mostraria estágio "Gerou Descrição" com 0 descrições, que parece bug.
export const TEXT_ACTION_KEYS = [
  'generate_seo_single',
  'generate_seo_mass',
  'regenerate_single',
  'content_article',
];

export const IMAGE_ACTION_KEYS = [
  'ambient_image',
  'regenerate_image',
  'content_image',
  'video_generation',
];

export const GENERATION_ACTION_KEYS = [...TEXT_ACTION_KEYS, ...IMAGE_ACTION_KEYS];

export function stageRank(stage: CrmStage): number {
  return CRM_STAGES.indexOf(stage);
}

// O estágio é sempre o marco mais alto já atingido e NUNCA regride.
// Inatividade não rebaixa o card — ela aparece no health score e na estagnação.
export function resolveStage(milestones: Partial<Record<CrmStage, string>>): CrmStage {
  let best: CrmStage = 'signed_up';
  for (const stage of CRM_STAGES) {
    if (milestones[stage]) best = stage;
  }
  return best;
}

// Semana ISO no formato '2026-W32'. Usada para contar semanas distintas de uso,
// que é o critério do estágio 'active'.
export function isoWeek(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (target.getUTCDay() + 6) % 7; // segunda = 0
  target.setUTCDate(target.getUTCDate() - dayNum + 3); // quinta da mesma semana
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 86400000));
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// Retorna NaN para data inválida (não Infinity): quem consome precisa poder
// distinguir "faz muito tempo" de "não sei", e Infinity vira null no JSON.
export function daysBetween(iso: string, now: Date): number {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return NaN;
  return Math.floor((now.getTime() - then) / 86400000);
}

export function emptySummary(now: string): CrmSummary {
  return {
    stage: 'signed_up',
    stageEnteredAt: now,
    firstSeenAt: now,
    lastSeenAt: now,
    milestones: { signed_up: now },
    counters: { products: 0, descriptions: 0, images: 0, exports: 0, erpSyncs: 0, aiOps30d: 0 },
    activeWeeks: [],
    healthScore: 0,
    healthBand: 'inativo',
    pipelineStatus: 'novo',
    pipelineUpdatedAt: null,
    pipelineUpdatedBy: null,
    tags: [],
    updatedAt: now,
  };
}

// Score transparente e determinístico. O admin precisa entender POR QUE um
// cliente está vermelho — nada de caixa-preta.
export function computeHealth(
  summary: CrmSummary,
  now: Date,
  opts: { credits: number; hasPurchased: boolean },
): { score: number; band: HealthBand } {
  const days = daysBetween(summary.lastSeenAt, now);
  const recency = days <= 1 ? 40 : days <= 7 ? 30 : days <= 14 ? 20 : days <= 30 ? 10 : 0;

  const depth = {
    signed_up: 0,
    products_uploaded: 8,
    content_generated: 16,
    integrated_or_exported: 24,
    active: 30,
  }[summary.stage];

  const ops = summary.counters.aiOps30d;
  const volume = ops === 0 ? 0 : ops < 5 ? 6 : ops < 20 ? 12 : ops < 50 ? 16 : 20;

  const investment = opts.hasPurchased ? 10 : opts.credits > 0 ? 5 : 0;

  const score = Math.max(0, Math.min(100, recency + depth + volume + investment));
  const band: HealthBand = score >= 70 ? 'ativo' : score >= 40 ? 'atencao' : score >= 15 ? 'risco' : 'inativo';
  return { score, band };
}

// Estagnado = parado no mesmo estágio além do limite daquele estágio. É o sinal
// que alimenta a fila de atenção e, no spec 2, o gatilho de WhatsApp.
// Falha para o lado seguro: data inválida NÃO marca como travado. Este sinal
// dispara mensagem de WhatsApp, então dado ruim jamais pode virar disparo.
export function isStagnant(summary: CrmSummary, now: Date): boolean {
  const days = daysBetween(summary.stageEnteredAt, now);
  if (!Number.isFinite(days)) return false;
  return days > STAGNATION_DAYS[summary.stage];
}

// Aplica um evento ao resumo, retornando um novo objeto. Puro: não muta a
// entrada e não toca o Firestore.
export function applyEventToSummary(summary: CrmSummary, name: string, ts: string): CrmSummary {
  const next: CrmSummary = {
    ...summary,
    milestones: { ...summary.milestones },
    counters: { ...summary.counters },
    activeWeeks: [...summary.activeWeeks],
    tags: [...summary.tags],
  };

  if (ts > next.lastSeenAt) next.lastSeenAt = ts;
  if (ts < next.firstSeenAt) next.firstSeenAt = ts;

  const week = isoWeek(ts);
  if (week && !next.activeWeeks.includes(week)) {
    next.activeWeeks.push(week);
    next.activeWeeks.sort();
  }

  if (name === 'description_generated') next.counters.descriptions += 1;
  if (name === 'image_generated') next.counters.images += 1;
  if (name === 'spreadsheet_export') next.counters.exports += 1;
  if (name === 'erp_push' || name === 'erp_import') next.counters.erpSyncs += 1;

  const milestone = EVENT_MILESTONE[name];
  if (milestone && !next.milestones[milestone]) {
    next.milestones[milestone] = ts;
  }

  // 'active' não vem de evento: é derivado de ≥2 semanas distintas de uso APÓS
  // o cliente já ter integrado ou exportado.
  const reachedIntegration = next.milestones.integrated_or_exported;
  if (reachedIntegration && !next.milestones.active) {
    const weeksAfter = next.activeWeeks.filter((w) => w >= isoWeek(reachedIntegration));
    if (weeksAfter.length >= 2) next.milestones.active = ts;
  }

  const resolved = resolveStage(next.milestones);
  if (resolved !== next.stage) {
    next.stage = resolved;
    next.stageEnteredAt = next.milestones[resolved] ?? ts;
  }

  next.updatedAt = ts;
  return next;
}
