import React from 'react';
import { Building2, Users, Megaphone, Target, KeyRound, LinkIcon, CalendarClock, ImageIcon } from 'lucide-react';
import type { ContentProjectConfig } from './types';

// Normalizes legacy string publicoAlvo into a list.
export const asList = (v: unknown): string[] =>
  Array.isArray(v) ? (v as string[]).filter(Boolean) : typeof v === 'string' && v.trim() ? [v.trim()] : [];

const Chips: React.FC<{ items: string[] }> = ({ items }) =>
  items.length ? (
    <div className="flex flex-wrap gap-1.5">
      {items.map((t) => (
        <span key={t} className="rounded-lg border border-(--ag-accent-line) bg-(--ag-accent-soft) px-2 py-0.5 text-xs font-medium text-(--ag-accent)">{t}</span>
      ))}
    </div>
  ) : (
    <span className="text-sm text-(--ag-text-3)">—</span>
  );

const Row: React.FC<{ icon: React.ReactNode; label: string; children: React.ReactNode }> = ({ icon, label, children }) => (
  <div className="flex gap-3 py-3 border-b border-(--ag-hairline) last:border-0">
    <div className="text-(--ag-text-3) mt-0.5 shrink-0">{icon}</div>
    <div className="min-w-0 flex-1">
      <div className="text-[11px] font-bold uppercase tracking-wider text-(--ag-text-3) mb-1">{label}</div>
      {children}
    </div>
  </div>
);

const ProfileSummary: React.FC<{ config: ContentProjectConfig }> = ({ config }) => (
  <div className="ag-glass rounded-[22px] [&>*+*]:border-t [&>*+*]:border-(--ag-hairline) px-5">
    <Row icon={<Building2 className="w-4 h-4" />} label="Empresa">
      <p className="text-sm font-semibold text-(--ag-text)">{config.nomeEmpresa || '—'}</p>
      {config.descricao && <p className="text-[13.5px] text-(--ag-text-2)">{config.descricao}</p>}
    </Row>
    <Row icon={<Megaphone className="w-4 h-4" />} label="Produto / serviço">
      <p className="text-sm text-(--ag-text)">{config.produtoServico || '—'}</p>
    </Row>
    <Row icon={<Users className="w-4 h-4" />} label="Público-alvo"><Chips items={asList(config.publicoAlvo)} /></Row>
    <Row icon={<Megaphone className="w-4 h-4" />} label="Tom de voz">
      {config.tomDeVoz ? <Chips items={[config.tomDeVoz]} /> : <span className="text-sm text-(--ag-text-3)">—</span>}
    </Row>
    <Row icon={<Target className="w-4 h-4" />} label="Objetivos"><Chips items={config.objetivos || []} /></Row>
    <Row icon={<KeyRound className="w-4 h-4" />} label="Palavras-chave"><Chips items={config.palavrasChave || []} /></Row>
    <Row icon={<LinkIcon className="w-4 h-4" />} label="Referências"><Chips items={config.referencias || []} /></Row>
    <Row icon={<CalendarClock className="w-4 h-4" />} label="Frequência de publicações">
      <p className="text-sm text-(--ag-text)">{config.frequenciaPostagens || '—'}</p>
    </Row>
    {config.estiloImagem && (
      <Row icon={<ImageIcon className="w-4 h-4" />} label="Estilo de imagem">
        <Chips items={[config.estiloImagem === 'Ilustracao' ? 'Ilustração' : config.estiloImagem]} />
      </Row>
    )}
  </div>
);

export default ProfileSummary;
