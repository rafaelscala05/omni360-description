// Primitivas visuais do CRM admin. Ficam num arquivo só para as telas não
// reinventarem badge/card/formatação de data cada uma do seu jeito.

import type { ReactNode } from 'react';
import type { CrmStage, HealthBand, PipelineStatus } from '../../types/crm';
import { HEALTH_BAND_LABELS, PIPELINE_LABELS, STAGE_LABELS } from '../../types/crm';

const HEALTH_COLORS: Record<HealthBand, string> = {
  ativo: 'bg-emerald-500',
  atencao: 'bg-amber-500',
  risco: 'bg-orange-500',
  inativo: 'bg-slate-400',
};

export function HealthDot({ band, score }: { band: HealthBand; score: number }) {
  return (
    <span className="inline-flex items-center gap-1.5" title={`${HEALTH_BAND_LABELS[band]} — ${score}/100`}>
      <span className={`w-2 h-2 rounded-full shrink-0 ${HEALTH_COLORS[band]}`} />
      <span className="text-xs font-medium text-slate-600">{score}</span>
    </span>
  );
}

export function StageBadge({ stage }: { stage: CrmStage }) {
  return (
    <span className="inline-block px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 text-xs font-semibold">
      {STAGE_LABELS[stage]}
    </span>
  );
}

const PIPELINE_COLORS: Record<PipelineStatus, string> = {
  novo: 'bg-slate-100 text-slate-700',
  em_contato: 'bg-blue-50 text-blue-700',
  qualificado: 'bg-indigo-50 text-indigo-700',
  ganho: 'bg-emerald-50 text-emerald-700',
  perdido: 'bg-rose-50 text-rose-700',
};

export function PipelineBadge({ status }: { status: PipelineStatus }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${PIPELINE_COLORS[status]}`}>
      {PIPELINE_LABELS[status]}
    </span>
  );
}

export function StagnantChip({ days }: { days: number }) {
  return (
    <span className="inline-block px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 text-[11px] font-bold">
      parado há {days}d
    </span>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`bg-white border border-slate-200 rounded-xl ${className}`}>{children}</div>;
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="py-12 text-center">
      <p className="text-sm font-semibold text-slate-600">{title}</p>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

export function Spinner({ label = 'Carregando…' }: { label?: string }) {
  return (
    <div className="py-12 flex items-center justify-center gap-2 text-sm text-slate-500">
      <span className="w-4 h-4 border-2 border-slate-300 border-t-violet-600 rounded-full animate-spin" />
      {label}
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="px-4 py-3 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-700">{message}</div>
  );
}

export function formatDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function formatDateTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatRelative(iso?: string | null): string {
  if (!iso) return 'nunca';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (!Number.isFinite(days)) return 'nunca';
  if (days <= 0) return 'hoje';
  if (days === 1) return 'ontem';
  if (days < 30) return `há ${days} dias`;
  const months = Math.floor(days / 30);
  return months === 1 ? 'há 1 mês' : `há ${months} meses`;
}

export function initials(name: string, email: string): string {
  const base = name.trim() || email.split('@')[0] || '?';
  return base
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

// Link de WhatsApp a partir do número gravado no onboarding (que vem com
// máscara). Assume DDI 55 quando o número tem só DDD + telefone.
export function whatsappHref(raw: string): string | null {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (digits.length < 10) return null;
  const withCountry = digits.length <= 11 ? `55${digits}` : digits;
  return `https://wa.me/${withCountry}`;
}
