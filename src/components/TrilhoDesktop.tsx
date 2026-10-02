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

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Bell, Coins, Columns3, Moon, Sun } from 'lucide-react';
import { useAgentTheme } from '../modules/agent/theme';
import { AvatarConta, ContaMenuItens, type ItemConta } from './ContaMenu';
import AlfredLogo from './alfredLogo/AlfredLogo';

export type DestinoTrilho = 'home' | 'atividade' | 'ferramentas';
export type { ItemConta };

interface Props {
  /** A porta ativa — telas de ferramenta (Produtos, Categorias…) contam como Ferramentas. */
  atual: DestinoTrilho | null;
  /** Tema da folha de conteúdo em que a aba ativa encosta (pode diferir do
   *  trilho quando uma tela antiga força o claro). */
  temaFolha?: 'claro' | 'escuro';
  /** A folha é sólida (`--ag-bg-2`) em vez de translúcida (`--ag-folha`). */
  folhaSolida?: boolean;
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

const Orbe: React.FC = () => <AlfredLogo size={26} marca="frente" className="block -my-0.5" />;

// Raio dos cantos côncavos onde a aba encontra a folha.
const CURVA = 16;

const Porta: React.FC<{
  ativo: boolean;
  /** Tema da folha: a porta ativa está "dentro" da aba e lê as cores dela. */
  temaFolha: 'claro' | 'escuro';
  rotulo: string;
  icone: React.ReactNode;
  selo?: number;
  onClick: () => void;
  refBotao: (el: HTMLButtonElement | null) => void;
}> = ({ ativo, temaFolha, rotulo, icone, selo, onClick, refBotao }) => (
  <button
    ref={refBotao}
    onClick={onClick}
    aria-current={ativo ? 'page' : undefined}
    aria-label={selo ? `${rotulo}, ${selo} pendente(s)` : rotulo}
    // O fundo da porta ativa é a aba (`Aba`), que fica por baixo e escorrega
    // entre as portas; o botão só troca o peso e a cor do texto.
    className={`relative z-10 w-[72px] flex flex-col items-center gap-1 py-2.5 rounded-[16px] text-[11px] transition-colors hover:text-[var(--ag-text)] ${ativo ? 'alfreds' : ''}`}
    data-tema={ativo ? temaFolha : undefined}
    style={ativo
      ? { color: 'var(--ag-text)', fontWeight: 600 }
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

/**
 * A aba da porta ativa: mesma cor da folha de conteúdo, vai até a borda do
 * trilho (onde a folha começa) e tem cantos côncavos em cima e embaixo — a
 * folha parece sair da porta. É uma peça só que escorrega entre as portas.
 */
const Aba: React.FC<{ topo: number; altura: number; visivel: boolean; animar: boolean; tema: 'claro' | 'escuro'; solida: boolean }> = ({
  topo, altura, visivel, animar, tema, solida,
}) => {
  const cor = solida ? 'var(--ag-bg-2)' : 'var(--ag-folha)';
  const curva = (y: '0' | '100%'): React.CSSProperties => ({
    position: 'absolute',
    right: 0,
    width: CURVA,
    height: CURVA,
    [y === '0' ? 'bottom' : 'top']: '100%',
    background: `radial-gradient(circle at 0 ${y === '0' ? '0' : '100%'}, transparent ${CURVA - 0.5}px, ${cor} ${CURVA}px)`,
  });
  return (
    <div
      aria-hidden
      className="alfreds absolute left-0 -right-3 pointer-events-none"
      data-tema={tema}
      style={{
        top: topo,
        height: altura,
        background: cor,
        borderRadius: `${CURVA}px 0 0 ${CURVA}px`,
        opacity: visivel ? 1 : 0,
        transition: animar
          ? 'top 420ms cubic-bezier(0.32, 0.72, 0, 1), height 420ms cubic-bezier(0.32, 0.72, 0, 1), opacity 200ms ease'
          : 'opacity 200ms ease',
      }}
    >
      <span style={curva('0')} />
      <span style={curva('100%')} />
    </div>
  );
};

const TrilhoDesktop: React.FC<Props> = ({
  atual, temaFolha, folhaSolida = false, pendentes, credits, nome, email, foto, mostrarMissoes, indiqueNovo, logo, onNavegar, onConta,
}) => {
  const { tema, alternar } = useAgentTheme();
  const [aberto, setAberto] = useState(false);
  const caixaRef = useRef<HTMLDivElement>(null);
  const folha = temaFolha ?? tema;

  // Posição da aba = a do botão da porta ativa. Mede depois do layout; a
  // primeira medida não anima (senão a aba escorregaria do topo ao abrir).
  const botoes = useRef<Record<string, HTMLButtonElement | null>>({});
  const [aba, setAba] = useState<{ topo: number; altura: number } | null>(null);
  const [animar, setAnimar] = useState(false);
  useLayoutEffect(() => {
    const el = atual ? botoes.current[atual] : null;
    if (!el) return;
    setAba({ topo: el.offsetTop, altura: el.offsetHeight });
  }, [atual]);
  useEffect(() => {
    if (!aba || animar) return;
    const id = requestAnimationFrame(() => setAnimar(true));
    return () => cancelAnimationFrame(id);
  }, [aba, animar]);
  const refDe = (d: DestinoTrilho) => (el: HTMLButtonElement | null) => { botoes.current[d] = el; };

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
  const dados = { credits, nome, email, foto, mostrarMissoes, indiqueNovo };

  return (
    <nav
      className="alfreds hidden md:flex w-[96px] shrink-0 flex-col items-center gap-2 px-3 py-5 relative z-40"
      data-tema={tema}
      // Sem fundo nem borda: o trilho fica sobre a mesma aurora das telas
      // (camada `fundoAgente` do App), e o conteúdo começa sem emenda.
      aria-label="Navegação principal"
    >
      <img src={logo} alt="Alfreds" className="h-7 w-auto mb-4 object-contain" />

      <div className="relative w-full flex flex-col items-center gap-2">
        {aba && <Aba topo={aba.topo} altura={aba.altura} visivel={!!atual} animar={animar} tema={folha} solida={folhaSolida} />}
        <Porta ativo={atual === 'home'} temaFolha={folha} refBotao={refDe('home')} rotulo="Alfred" icone={<Orbe />} onClick={() => onNavegar('home')} />
        <Porta ativo={atual === 'atividade'} temaFolha={folha} refBotao={refDe('atividade')} rotulo="Atividade" icone={<Bell className="w-[22px] h-[22px]" />} selo={pendentes} onClick={() => onNavegar('atividade')} />
        <Porta ativo={atual === 'ferramentas'} temaFolha={folha} refBotao={refDe('ferramentas')} rotulo="Ferramentas" icone={<Columns3 className="w-[22px] h-[22px]" />} onClick={() => onNavegar('ferramentas')} />
      </div>

      <div ref={caixaRef} className="mt-auto relative flex flex-col items-center gap-2">
        {/* Saldo de créditos — saiu do cabeçalho do Alfred para valer em toda
            tela; abre a compra. */}
        <button
          onClick={() => escolher('creditos')}
          title="Créditos disponíveis — comprar mais"
          aria-label={`${credits} créditos`}
          className="h-8 px-2.5 rounded-full flex items-center gap-1.5 text-[12px] font-semibold text-[var(--ag-text-2)] hover:text-[var(--ag-text)] tabular-nums transition-colors"
          style={{ background: 'var(--ag-fill)' }}
        >
          <Coins className="w-3.5 h-3.5 text-[var(--ag-text-3)]" />
          {credits}
        </button>

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
          className="rounded-full"
        >
          <AvatarConta dados={dados} tamanho={44} />
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

            <ContaMenuItens dados={dados} onEscolher={escolher} />
          </div>
        )}
      </div>
    </nav>
  );
};

export default TrilhoDesktop;
