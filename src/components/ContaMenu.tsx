// Menu da Conta — créditos, histórico, missões, integrações, empresa, indicação,
// tutorial, ajuda, configurações e sair. Um só para as duas formas em que ele
// aparece: o popover do avatar no trilho do desktop (`TrilhoDesktop`) e a folha
// que sobe do avatar no topo do telefone (`ContaSheet`), que substituiu a gaveta
// escura do menu antigo para quem tem agente.
//
// Tokens `--ag-*` apenas: quem monta abre o escopo `.alfreds` com o tema.

import React, { createContext, useContext, useEffect } from 'react';
import NumeroAnimado from './movimento/NumeroAnimado';
import { AnimatePresence, motion, useDragControls } from 'motion/react';
import {
  Building2, ChevronRight, Coins, Gift, GraduationCap, HelpCircle, LogOut, Moon, Plug, RefreshCw, Settings, Sun, Target, X,
} from 'lucide-react';
import { useAgentTheme } from '../modules/agent/theme';

export type ItemConta =
  | 'creditos' | 'historico' | 'missoes' | 'integracoes' | 'empresa'
  | 'indique' | 'tutorial' | 'ajuda' | 'configuracoes' | 'sair';

export interface DadosConta {
  credits: number;
  nome: string;
  email: string;
  foto: string | null;
  mostrarMissoes: boolean;
  /** Indique e Ganhe ainda não visto — o ponto no avatar e no item. */
  indiqueNovo: boolean;
}

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
    className="w-full min-h-[44px] md:min-h-[40px] px-3 flex items-center gap-2.5 text-left text-[14px] md:text-[13.5px] font-medium rounded-[12px] hover:bg-[var(--ag-fill)] transition-colors"
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

export const ContaMenuItens: React.FC<{ dados: DadosConta; onEscolher: (item: ItemConta) => void }> = ({ dados, onEscolher }) => (
  <>
    <LinhaMenu
      primeira
      icone={<Coins className="w-4 h-4" />}
      rotulo="Créditos"
      extra={<NumeroAnimado valor={dados.credits} className="text-[12.5px] font-semibold text-[var(--ag-text-2)]" />}
      onClick={() => onEscolher('creditos')}
    />
    <LinhaMenu icone={<RefreshCw className="w-4 h-4" />} rotulo="Histórico de uso" onClick={() => onEscolher('historico')} />
    {dados.mostrarMissoes && <LinhaMenu icone={<Target className="w-4 h-4" />} rotulo="Missões" onClick={() => onEscolher('missoes')} />}
    <LinhaMenu icone={<Plug className="w-4 h-4" />} rotulo="Integrações" onClick={() => onEscolher('integracoes')} />
    <LinhaMenu icone={<Building2 className="w-4 h-4" />} rotulo="Empresa" onClick={() => onEscolher('empresa')} />
    <LinhaMenu
      icone={<Gift className="w-4 h-4" />}
      rotulo="Indique e Ganhe"
      extra={dados.indiqueNovo
        ? <span className="w-2 h-2 rounded-full" style={{ background: 'var(--ag-accent)' }} />
        : <ChevronRight className="w-4 h-4 text-[var(--ag-text-3)]" />}
      onClick={() => onEscolher('indique')}
    />
    <LinhaMenu icone={<GraduationCap className="w-4 h-4" />} rotulo="Tutorial" onClick={() => onEscolher('tutorial')} />
    <LinhaMenu icone={<HelpCircle className="w-4 h-4" />} rotulo="Ajuda" onClick={() => onEscolher('ajuda')} />
    <LinhaMenu icone={<Settings className="w-4 h-4" />} rotulo="Configurações" onClick={() => onEscolher('configuracoes')} />
    <LinhaMenu icone={<LogOut className="w-4 h-4" />} rotulo="Sair da conta" perigo onClick={() => onEscolher('sair')} />
  </>
);

/** O círculo do avatar (foto ou inicial) com o ponto de "Indique e Ganhe". */
export const AvatarConta: React.FC<{ dados: Pick<DadosConta, 'nome' | 'email' | 'foto' | 'indiqueNovo'>; tamanho: number }> = ({ dados, tamanho }) => {
  const inicial = (dados.nome || dados.email || '?').trim().charAt(0).toUpperCase();
  return (
    <span
      className="relative rounded-full grid place-items-center shrink-0 font-semibold"
      style={{
        width: tamanho, height: tamanho, fontSize: Math.round(tamanho * 0.36),
        background: 'var(--ag-surface-solid)', color: 'var(--ag-text)', boxShadow: '0 0 0 1px var(--ag-hairline-2)',
      }}
    >
      <span className="absolute inset-0 rounded-full overflow-hidden grid place-items-center">
        {dados.foto ? <img src={dados.foto} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" /> : inicial}
      </span>
      {dados.indiqueNovo && (
        <span className="absolute top-0 right-0 w-2.5 h-2.5 rounded-full" style={{ background: 'var(--ag-accent)', boxShadow: '0 0 0 2px var(--ag-bg)' }} />
      )}
    </span>
  );
};

// As telas do agente (Alfred, Atividade, Ferramentas…) põem o avatar no próprio
// cabeçalho no telefone. Pelo contexto elas não precisam receber foto, nome e o
// handler por prop — o App provê uma vez.
const ContaContext = createContext<{ dados: DadosConta; abrir: () => void } | null>(null);
export const ContaProvider = ContaContext.Provider;

/** Avatar da Conta para o cabeçalho das telas no telefone (some no desktop, onde o trilho já tem o seu). */
export const BotaoConta: React.FC<{ className?: string }> = ({ className = '' }) => {
  const conta = useContext(ContaContext);
  if (!conta) return null;
  return (
    <button onClick={conta.abrir} aria-label="Conta" title="Conta" className={`md:hidden shrink-0 rounded-full ${className}`}>
      <AvatarConta dados={conta.dados} tamanho={36} />
    </button>
  );
};

/** Folha da Conta no telefone: sobe da base, com o tema claro/escuro e o menu inteiro. */
export const ContaSheet: React.FC<{
  aberto: boolean;
  dados: DadosConta;
  onFechar: () => void;
  onEscolher: (item: ItemConta) => void;
}> = ({ aberto, dados, onFechar, onEscolher }) => {
  const { tema, alternar } = useAgentTheme();
  const arraste = useDragControls();

  useEffect(() => {
    if (!aberto) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [aberto, onFechar]);

  const escolher = (item: ItemConta) => { onFechar(); onEscolher(item); };

  return (
    <AnimatePresence>
    {aberto && (
    <div className="alfreds fixed inset-0 z-50 flex items-end md:items-center justify-center" data-tema={tema} role="dialog" aria-modal="true" aria-label="Conta">
      <motion.div
        className="absolute inset-0"
        style={{ background: 'var(--ag-scrim)' }}
        onClick={onFechar}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      />
      <motion.div
        className="relative w-full md:w-[360px] max-h-[88vh] overflow-y-auto rounded-t-[28px] md:rounded-[24px] px-3 pt-2 flex flex-col"
        // Sólido, não vidro: abre por cima do conteúdo e, translúcido, o texto
        // de trás atravessa as linhas no tema escuro.
        style={{
          background: 'var(--ag-surface-solid)', border: '1px solid var(--ag-hairline)', boxShadow: 'var(--ag-shadow-lg)',
          paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))',
        }}
        initial={{ y: '40%', opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: '45%', opacity: 0, transition: { duration: 0.2, ease: [0.4, 0, 1, 1] } }}
        transition={{ type: 'spring', stiffness: 420, damping: 38 }}
        // Arrasta só pelo puxador (dragControls), para não brigar com a rolagem
        // da lista; para baixo acompanha o dedo, para cima resiste.
        drag="y"
        dragControls={arraste}
        dragListener={false}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0.08, bottom: 0.9 }}
        onDragEnd={(_, info) => {
          if (info.offset.y > 110 || info.velocity.y > 550) onFechar();
        }}
      >
        <span
          className="md:hidden mx-auto -mt-1 mb-1 py-2 px-6 touch-none cursor-grab"
          onPointerDown={(e) => arraste.start(e)}
          aria-hidden
        >
          <span className="block w-9 h-1 rounded-full" style={{ background: 'var(--ag-fill-2)' }} />
        </span>
        <div className="px-2 pt-1 pb-3 flex items-center gap-3">
          <AvatarConta dados={dados} tamanho={44} />
          <div className="min-w-0 flex-1 flex flex-col">
            <span className="text-[15px] font-semibold text-[var(--ag-text)] truncate">{dados.nome || 'Sua conta'}</span>
            <span className="text-[12.5px] text-[var(--ag-text-2)] truncate">{dados.email}</span>
          </div>
          <button
            onClick={alternar}
            aria-label={tema === 'claro' ? 'Tema escuro' : 'Tema claro'}
            className="w-10 h-10 rounded-full grid place-items-center text-[var(--ag-text-2)] shrink-0"
            style={{ background: 'var(--ag-fill)' }}
          >
            {tema === 'claro' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
          </button>
          <button
            onClick={onFechar}
            aria-label="Fechar"
            className="w-10 h-10 rounded-full grid place-items-center text-[var(--ag-text-2)] shrink-0"
            style={{ background: 'var(--ag-fill)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <ContaMenuItens dados={dados} onEscolher={escolher} />
      </motion.div>
    </div>
    )}
    </AnimatePresence>
  );
};
