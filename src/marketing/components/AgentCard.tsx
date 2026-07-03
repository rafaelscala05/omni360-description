import { Link } from 'react-router-dom';
import { ArrowRight, type LucideIcon } from 'lucide-react';
import { getTheme } from '../theme';

export type AgentVariant = 'product' | 'content' | 'sales' | 'ops';

interface AgentCardProps {
  variant: AgentVariant;
  title: string;
  description: string;
  /** Rota do agente. Ausente = agente em breve (card sem link). */
  to?: string;
  /** Ícone usado quando o agente ainda não tem logo (em breve). */
  Icon?: LucideIcon;
  comingSoon?: boolean;
}

interface VariantStyle {
  dark: boolean;
  accent: string;
  iconTile: string;
  border: string;
}

const styles: Record<AgentVariant, VariantStyle> = {
  product: { dark: false, accent: 'text-orange', iconTile: 'bg-orange/10 text-orange', border: 'border-orange/30' },
  content: { dark: true, accent: 'text-orange', iconTile: 'bg-white/10 text-porcelain', border: 'border-ink' },
  sales: { dark: false, accent: 'text-blue', iconTile: 'bg-blue/10 text-blue', border: 'border-blue/25' },
  ops: { dark: false, accent: 'text-periwinkle', iconTile: 'bg-periwinkle/15 text-periwinkle', border: 'border-periwinkle/40' },
};

export default function AgentCard({ variant, title, description, to, Icon, comingSoon }: AgentCardProps) {
  const s = styles[variant];
  const logo = variant === 'product' || variant === 'content' ? getTheme(variant).logo : undefined;

  const cardBg = s.dark ? 'bg-ink text-porcelain' : 'bg-white text-ink';
  const borderCls = comingSoon ? `border-dashed ${s.border}` : s.border;
  const interactive = !comingSoon ? 'hover:-translate-y-1 hover:shadow-xl' : '';

  const content = (
    <>
      {comingSoon && (
        <span className={`absolute top-6 right-6 text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full ${s.dark ? 'bg-white/10 text-porcelain/70' : 'bg-ink/5 text-ink/45'}`}>
          Em breve
        </span>
      )}
      {logo ? (
        <img src={logo} alt={title} className="h-8 w-auto mb-6" />
      ) : Icon ? (
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-6 ${s.iconTile}`}>
          <Icon className="w-6 h-6" strokeWidth={1.75} />
        </div>
      ) : null}
      <h3 className="font-display text-2xl font-extrabold mb-2">{title}</h3>
      <p className={`${s.dark ? 'text-porcelain/70' : 'text-ink/60'} mb-6 leading-relaxed`}>{description}</p>
      {!comingSoon && to ? (
        <span className={`inline-flex items-center gap-1.5 font-bold ${s.accent}`}>
          Conhecer o agente <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition" />
        </span>
      ) : (
        <span className={`inline-flex items-center gap-1.5 font-semibold text-sm ${s.dark ? 'text-porcelain/50' : 'text-ink/40'}`}>
          Em desenvolvimento
        </span>
      )}
    </>
  );

  const className = `group relative block rounded-3xl p-8 border transition ${cardBg} ${borderCls} ${interactive}`;

  return !comingSoon && to ? (
    <Link to={to} className={className}>{content}</Link>
  ) : (
    <div className={className}>{content}</div>
  );
}
