// Trilho de vidro do desktop (D1/D2): as três portas do produto — Alfred,
// Atividade, Ferramentas — e, embaixo, o avatar da Conta, que abre o resto
// (créditos, integrações, empresa, missões, indicação, ajuda, sair).
//
// Substitui o menu lateral escuro só para quem tem módulo de agente: sem
// agente não há Alfred nem Atividade, e o menu antigo continua valendo. No
// telefone quem navega é a `AppTabBar`; o trilho é `md:flex` e nada mais.
//
// Mesmo design system da tela do agente (tokens `--ag-*`, escopo `.alfreds`),
// seguindo o tema claro/escuro escolhido no Alfred — cor nenhuma literal.

import React, { useEffect, useRef, useState } from 'react';
import {
  Bell, Building2, ChevronRight, Coins, Columns3, Gift, GraduationCap, HelpCircle, LogOut, Moon, Plug, RefreshCw, Settings, Sun, Target,
} from 'lucide-react';
import { useAgentTheme } from '../modules/agent/theme';

export type DestinoTrilho = 'home' | 'atividade' | 'ferramentas';

export type ItemConta =
  | 'creditos' | 'historico' | 'missoes' | 'integracoes' | 'empresa'
  | 'indique' | 'tutorial' | 'ajuda' | 'configuracoes' | 'sair';

interface Props {
  /** A porta ativa — telas de ferramenta (Produtos, Categorias…) contam como Ferramentas. */
  atual: DestinoTrilho | null;
  pendentes: number;
  credits: number;
  nome: string;
  email: string;
  foto: string | null;
  mostrarMissoes: boolean;
  /** Indique e Ganhe ainda não visto — o ponto no avatar e no item. */
  indiqueNovo: boolean;
  logo: string;
  onNavegar: (destino: DestinoTrilho) => void;
  onConta: (item: ItemConta) => void;
}

const Orbe: React.FC = () => (
  <span
    className="block w-[22px] h-[22px] rounded-full"
    style={{ background: 'var(--ag-accent)', boxShadow: 'inset 0 0 0 4px color-mix(in srgb, var(--ag-accent) 45%, var(--ag-bg-2))' }}
  />
);

const Porta: React.FC<{
  ativo: boolean;
  rotulo: string;
  icone: React.ReactNode;
  selo?: number;
  onClick: () => void;
}> = ({ ativo, rotulo, icone, selo, onClick }) => (
  <button
    onClick={onClick}
    aria-current={ativo ? 'page' : undefined}
    aria-label={selo ? `${rotulo}, ${selo} pendente(s)` : rotulo}
    className="relative w-[72px] flex flex-col items-center gap-1 py-2.5 rounded-[16px] text-[11px] transition-colors"
    style={ativo
      ? { background: 'var(--ag-surface-solid)', color: 'var(--ag-text)', fontWeight: 600, boxShadow: '0 0 0 1px var(--ag-hairline)' }
      : { color: 'var(--ag-text-2)', fontWeight: 500 }}
  >
    <span className="relative">
      {icone}
      {!!selo && (
        <span
          className="absolute -top-1.5 -right-2.5 min-w-[17px] h-[17px] px-1 rounded-full text-[10px] font-semibold leading-[17px] text-center"
          style={{ background: 'var(--ag-accent)', color: 'var(--ag-accent-ink)' }}
        >
          {selo > 99 ? '99+' : selo}
        </span>
      )}
    </span>
    {rotulo}
  </button>
);

const LinhaMenu: React.FC<{
  icone: React.ReactNode;
  rotulo: string;
  extra?: React.ReactNode;
  perigo?: boolean;
  primeira?: boolean;
  onClick: () => void;
}> = ({ icone, rotulo, extra, perigo, primeira, onClick }) => (
  <button
    onClick={onClick}
    className="w-full min-h-[40px] px-3 flex items-center gap-2.5 text-left text-[13.5px] font-medium rounded-[12px] hover:bg-[var(--ag-fill)] transition-colors"
    style={{
      color: perigo ? 'var(--ag-danger)' : 'var(--ag-text)',
      ...(primeira ? {} : { borderTop: '1px solid var(--ag-hairline)', borderRadius: 0 }),
    }}
  >
    <span className="w-4 h-4 shrink-0 grid place-items-center" style={{ color: perigo ? 'var(--ag-danger)' : 'var(--ag-text-3)' }}>{icone}</span>
    <span className="flex-1">{rotulo}</span>
    {extra}
  </button>
);

const TrilhoDesktop: React.FC<Props> = ({
  atual, pendentes, credits, nome, email, foto, mostrarMissoes, indiqueNovo, logo, onNavegar, onConta,
}) => {
  const { tema, alternar } = useAgentTheme();
  const [aberto, setAberto] = useState(false);
  const caixaRef = useRef<HTMLDivElement>(null);

  // Fecha ao clicar fora ou com Esc — o menu é um popover, não uma tela.
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      if (caixaRef.current && !caixaRef.current.contains(e.target as Node)) setAberto(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false); };
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', fora);
      document.removeEventListener('keydown', esc);
    };
  }, [aberto]);

  const escolher = (item: ItemConta) => { setAberto(false); onConta(item); };
  const inicial = (nome || email || '?').trim().charAt(0).toUpperCase();

  return (
    <nav
      className="alfreds hidden md:flex w-[96px] shrink-0 flex-col items-center gap-2 px-3 py-5 relative z-40"
      data-tema={tema}
      style={{ background: 'var(--ag-bg)', borderRight: '1px solid var(--ag-hairline)' }}
      aria-label="Navegação principal"
    >
      <img src={logo} alt="Alfreds" className="h-7 w-auto mb-4 object-contain" />

      <Porta ativo={atual === 'home'} rotulo="Alfred" icone={<Orbe />} onClick={() => onNavegar('home')} />
      <Porta ativo={atual === 'atividade'} rotulo="Atividade" icone={<Bell className="w-[22px] h-[22px]" />} selo={pendentes} onClick={() => onNavegar('atividade')} />
      <Porta ativo={atual === 'ferramentas'} rotulo="Ferramentas" icone={<Columns3 className="w-[22px] h-[22px]" />} onClick={() => onNavegar('ferramentas')} />

      <div ref={caixaRef} className="mt-auto relative flex flex-col items-center gap-2">
        <button
          onClick={alternar}
          title={tema === 'claro' ? 'Tema escuro' : 'Tema claro'}
          className="w-10 h-10 rounded-full grid place-items-center text-[var(--ag-text-2)] hover:text-[var(--ag-text)] transition-colors"
          style={{ background: 'var(--ag-fill)' }}
        >
          {tema === 'claro' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
        </button>

        <button
          onClick={() => setAberto((v) => !v)}
          aria-label="Conta"
          aria-expanded={aberto}
          className="relative w-11 h-11 rounded-full grid place-items-center overflow-hidden text-[15px] font-semibold"
          style={{ background: 'var(--ag-surface-solid)', color: 'var(--ag-text)', boxShadow: '0 0 0 1px var(--ag-hairline-2)' }}
        >
          {foto ? <img src={foto} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" /> : inicial}
          {indiqueNovo && (
            <span className="absolute top-0.5 right-0.5 w-2.5 h-2.5 rounded-full" style={{ background: 'var(--ag-accent)', boxShadow: '0 0 0 2px var(--ag-bg)' }} />
          )}
        </button>

        {aberto && (
          <div
            role="menu"
            className="ag-rise absolute left-[calc(100%+12px)] bottom-0 w-[268px] rounded-[20px] p-2 flex flex-col"
            // Sólido, não vidro: o menu abre por cima do conteúdo e, translúcido,
            // o texto de trás atravessa as linhas no tema escuro.
            style={{ background: 'var(--ag-surface-solid)', border: '1px solid var(--ag-hairline)', boxShadow: 'var(--ag-shadow)' }}
          >
            <div className="px-3 pt-2 pb-3 flex flex-col">
              <span className="text-[14px] font-semibold text-[var(--ag-text)] truncate">{nome || 'Sua conta'}</span>
              <span className="text-[12px] text-[var(--ag-text-2)] truncate">{email}</span>
            </div>

            <LinhaMenu
              primeira
              icone={<Coins className="w-4 h-4" />}
              rotulo="Créditos"
              extra={<span className="tabular-nums text-[12.5px] font-semibold text-[var(--ag-text-2)]">{credits}</span>}
              onClick={() => escolher('creditos')}
            />
            <LinhaMenu icone={<RefreshCw className="w-4 h-4" />} rotulo="Histórico de uso" onClick={() => escolher('historico')} />
            {mostrarMissoes && <LinhaMenu icone={<Target className="w-4 h-4" />} rotulo="Missões" onClick={() => escolher('missoes')} />}
            <LinhaMenu icone={<Plug className="w-4 h-4" />} rotulo="Integrações" onClick={() => escolher('integracoes')} />
            <LinhaMenu icone={<Building2 className="w-4 h-4" />} rotulo="Empresa" onClick={() => escolher('empresa')} />
            <LinhaMenu
              icone={<Gift className="w-4 h-4" />}
              rotulo="Indique e Ganhe"
              extra={indiqueNovo
                ? <span className="w-2 h-2 rounded-full" style={{ background: 'var(--ag-accent)' }} />
                : <ChevronRight className="w-4 h-4 text-[var(--ag-text-3)]" />}
              onClick={() => escolher('indique')}
            />
            <LinhaMenu icone={<GraduationCap className="w-4 h-4" />} rotulo="Tutorial" onClick={() => escolher('tutorial')} />
            <LinhaMenu icone={<HelpCircle className="w-4 h-4" />} rotulo="Ajuda" onClick={() => escolher('ajuda')} />
            <LinhaMenu icone={<Settings className="w-4 h-4" />} rotulo="Configurações" onClick={() => escolher('configuracoes')} />
            <LinhaMenu icone={<LogOut className="w-4 h-4" />} rotulo="Sair da conta" perigo onClick={() => escolher('sair')} />
          </div>
        )}
      </div>
    </nav>
  );
};

export default TrilhoDesktop;
