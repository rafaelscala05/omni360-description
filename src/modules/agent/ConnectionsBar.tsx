// Régua de conexões — a resposta visual para "o que está conectado e o que o
// agente consegue fazer com isso".
//
// Três informações por plataforma, que antes estavam espalhadas entre a tela de
// Integrações e nenhum lugar: o estado real da conexão (vindo de
// /api/*/status), quantas ferramentas o agente ganha por estar conectado
// (/api/agent/tools) e quantas aprovações estão paradas esperando o usuário.
//
// Fechada, é um botão só ("2/5 conectadas" + os glifos de quem está ligado);
// ao passar o mouse ou clicar, abre uma coluna com uma linha por plataforma, e
// clicar numa linha mostra o detalhe dela ali mesmo. Clicar fixa a coluna
// aberta (o hover sozinho fecha ao sair); Esc ou clique fora fecham.

import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, Check, ChevronDown, Plug, Plus, Wrench,
} from 'lucide-react';

export interface ConnectionItem {
  id: string;
  nome: string;
  /** "ERP", "Loja", "Conteúdo" — o papel da plataforma. */
  papel: string;
  conectado: boolean;
  /** Conectado, mas com credencial não validada ou status não checado. */
  atencao?: boolean;
  /** Conta/CNPJ/versão — identifica *qual* conta está do outro lado. */
  detalhe?: string | null;
  /** Linha de rodapé do detalhe (ex.: "validada há 3 h"). */
  rodape?: string | null;
  ferramentas?: number;
  pendentes?: number;
  erro?: string;
  glifo: string;
  cor: string;
}

/** Identidade visual de cada plataforma — a régua e a tela de fontes usam a mesma. */
export const MARCA: Record<string, { glifo: string; cor: string }> = {
  wake: { glifo: 'W', cor: 'linear-gradient(135deg,#ff5b03,#ff9a52)' },
  tiny: { glifo: 'T', cor: 'linear-gradient(135deg,#3053ff,#7e94ff)' },
  bling: { glifo: 'B', cor: 'linear-gradient(135deg,#0f9d58,#4ade80)' },
  idworks: { glifo: 'ID', cor: 'linear-gradient(135deg,#828ed1,#b8c0ea)' },
  content: { glifo: 'C', cor: 'linear-gradient(135deg,#7c3aed,#c4b5fd)' },
  meli: { glifo: 'ML', cor: 'linear-gradient(135deg,#8a7600,#c9ad00)' },
  produtos: { glifo: 'Pr', cor: 'linear-gradient(135deg,#0f172a,#475569)' },
};

interface Props {
  itens: ConnectionItem[];
  carregando: boolean;
  /** "Gerenciar"/"Conectar" no detalhe de uma plataforma. */
  onConectar: () => void;
  /** O "+" da régua: a lista de fontes, com o que ainda dá para conectar. */
  onAdicionar?: () => void;
  /** Embutida num card (coluna de atividade): a linha expande a lista no
   *  lugar, por clique, em vez de abrir uma coluna flutuante. */
  embutida?: boolean;
}

const Ponto: React.FC<{ estado: 'on' | 'warn' | 'off' }> = ({ estado }) => {
  if (estado === 'off') {
    return <span className="w-[7px] h-[7px] rounded-full border border-[var(--ag-text-3)] shrink-0" />;
  }
  const cor = estado === 'on' ? 'var(--ag-ok)' : 'var(--ag-warn)';
  return (
    <span className="relative inline-flex shrink-0" style={{ color: cor }}>
      <span className="block w-[7px] h-[7px] rounded-full" style={{ background: cor }} />
      {estado === 'on' && <span className="ag-live absolute inset-0" />}
    </span>
  );
};

const Linha: React.FC<{
  item: ConnectionItem;
  aberto: boolean;
  onClick: () => void;
}> = ({ item, aberto, onClick }) => {
  const estado = !item.conectado ? 'off' : item.atencao ? 'warn' : 'on';

  return (
    <button
      onClick={onClick}
      aria-expanded={aberto}
      className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-[14px] text-left transition-colors hover:bg-[var(--ag-fill)]"
      style={{ background: aberto ? 'var(--ag-fill)' : undefined, opacity: item.conectado ? 1 : 0.72 }}
    >
      <span
        className="w-7 h-7 rounded-full grid place-items-center text-[10px] font-bold tracking-tight text-white shrink-0"
        style={{ background: item.cor, filter: item.conectado ? undefined : 'grayscale(1)' }}
      >
        {item.glifo}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-[13.5px] font-medium text-[var(--ag-text)] truncate">{item.nome}</span>
        <span className="block text-[11px] text-[var(--ag-text-3)] truncate">
          {item.conectado ? (item.atencao ? 'revalidar credencial' : item.papel) : 'não conectado'}
        </span>
      </span>
      {!!item.pendentes && (
        <span
          className="min-w-[18px] h-[18px] px-1 rounded-full grid place-items-center text-[10px] font-bold tabular-nums"
          style={{ background: 'var(--ag-accent)', color: 'var(--ag-accent-ink)' }}
        >
          {item.pendentes}
        </span>
      )}
      <Ponto estado={estado} />
    </button>
  );
};

const Detalhe: React.FC<{ item: ConnectionItem; onConectar: () => void }> = ({ item, onConectar }) => (
  <div className="ag-rise px-1 pt-1 pb-2">
    <div
      className="rounded-2xl p-3 flex flex-wrap items-center gap-x-4 gap-y-2"
      style={{ background: 'var(--ag-fill)', border: '1px solid var(--ag-hairline)' }}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <span
          className="w-8 h-8 rounded-xl grid place-items-center text-[11px] font-bold text-white shrink-0"
          style={{ background: item.cor, filter: item.conectado ? undefined : 'grayscale(1)' }}
        >
          {item.glifo}
        </span>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-[var(--ag-text)] leading-tight">{item.nome}</div>
          <div className="text-[11px] text-[var(--ag-text-3)] leading-tight">
            {item.papel}
            {item.detalhe ? ` · ${item.detalhe}` : ''}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 text-[12px]">
        {item.erro ? (
          <span className="inline-flex items-center gap-1.5 text-[var(--ag-warn)]">
            <AlertTriangle className="w-3.5 h-3.5" /> {item.erro}
          </span>
        ) : item.conectado ? (
          <span
            className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full font-medium"
            style={{
              background: item.atencao ? 'var(--ag-warn-soft)' : 'var(--ag-ok-soft)',
              color: item.atencao ? 'var(--ag-warn)' : 'var(--ag-ok)',
            }}
          >
            {item.atencao ? <AlertTriangle className="w-3.5 h-3.5" /> : <Check className="w-3.5 h-3.5" />}
            {item.atencao ? 'Revalidar credencial' : 'Conectado'}
          </span>
        ) : (
          <span className="text-[var(--ag-text-3)]">Não conectado</span>
        )}
      </div>

      {!!item.ferramentas && (
        <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--ag-text-2)]">
          <Wrench className="w-3.5 h-3.5 text-[var(--ag-text-3)]" />
          {item.ferramentas} {item.ferramentas === 1 ? 'ferramenta liberada' : 'ferramentas liberadas'}
        </span>
      )}

      {!!item.pendentes && (
        <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--ag-accent)]">
          {item.pendentes} {item.pendentes === 1 ? 'aprovação pendente' : 'aprovações pendentes'}
        </span>
      )}

      {item.rodape && <span className="text-[11px] text-[var(--ag-text-3)]">{item.rodape}</span>}

      <button
        onClick={onConectar}
        className="ml-auto text-[12px] font-semibold px-3 py-1.5 rounded-full transition-colors"
        style={{ background: 'var(--ag-accent-soft)', color: 'var(--ag-accent)' }}
      >
        {item.conectado ? 'Gerenciar' : 'Conectar'}
      </button>
    </div>
  </div>
);

const ConnectionsBar: React.FC<Props> = ({ itens, carregando, onConectar, onAdicionar, embutida = false }) => {
  const [hover, setHover] = useState(false);
  const [fixo, setFixo] = useState(false);
  const [abertoId, setAbertoId] = useState<string | null>(null);
  const caixaRef = useRef<HTMLDivElement>(null);
  const fecharRef = useRef<number | null>(null);
  const visivel = hover || fixo;

  // Conectadas primeiro: é o que a coluna existe para mostrar.
  const ordenados = [...itens].sort((a, b) => Number(b.conectado) - Number(a.conectado));
  const conectadas = itens.filter((i) => i.conectado);
  const pendentes = itens.reduce((n, i) => n + (i.pendentes ?? 0), 0);
  const aberto = itens.find((i) => i.id === abertoId) ?? null;

  useEffect(() => {
    // Embutida, a lista faz parte do card: só fecha pelo próprio botão.
    if (!fixo || embutida) return;
    const fora = (e: MouseEvent) => {
      if (caixaRef.current && !caixaRef.current.contains(e.target as Node)) { setFixo(false); setHover(false); }
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setFixo(false); setHover(false); } };
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', fora);
      document.removeEventListener('keydown', esc);
    };
  }, [fixo, embutida]);
  useEffect(() => () => { if (fecharRef.current) window.clearTimeout(fecharRef.current); }, []);

  // Hover só no mouse de verdade; no toque o clique é que abre e fixa. A
  // folga de 160 ms evita fechar no caminho entre o botão e a coluna.
  const entrar = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    if (fecharRef.current) window.clearTimeout(fecharRef.current);
    setHover(true);
  };
  const sair = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    fecharRef.current = window.setTimeout(() => setHover(false), 160);
  };

  const glifos = !carregando && conectadas.length > 0 && (
    <span className="flex items-center -space-x-1.5">
      {conectadas.slice(0, 4).map((i) => (
        <span
          key={i.id}
          className="w-5 h-5 rounded-full grid place-items-center text-[8px] font-bold text-white"
          style={{ background: i.cor, boxShadow: '0 0 0 2px var(--ag-surface-solid)' }}
        >
          {i.glifo}
        </span>
      ))}
    </span>
  );

  const lista = (
    <>
      {carregando && !itens.length
        ? [0, 1, 2].map((i) => <div key={i} className="ag-shimmer h-11 mx-1 my-0.5 rounded-[14px]" />)
        : ordenados.map((item) => (
          <React.Fragment key={item.id}>
            <Linha item={item} aberto={abertoId === item.id} onClick={() => setAbertoId((a) => (a === item.id ? null : item.id))} />
            {aberto?.id === item.id && <Detalhe item={item} onConectar={onConectar} />}
          </React.Fragment>
        ))}
      <button
        onClick={onAdicionar ?? onConectar}
        className="flex items-center gap-2.5 px-2.5 py-2 rounded-[14px] text-[13px] font-medium text-[var(--ag-text-2)] hover:text-[var(--ag-text)] hover:bg-[var(--ag-fill)] transition-colors"
      >
        <span className="w-7 h-7 rounded-full grid place-items-center shrink-0" style={{ border: '1px dashed var(--ag-hairline-2)' }}>
          <Plus className="w-4 h-4" />
        </span>
        Fontes e conectores
      </button>
    </>
  );

  if (embutida) {
    return (
      <div className="flex flex-col">
        <button
          onClick={() => setFixo((f) => !f)}
          aria-expanded={fixo}
          className="min-h-[40px] flex items-center gap-2.5 px-2.5 rounded-[14px] text-left text-[13.5px] text-[var(--ag-text)] hover:bg-[var(--ag-fill)] transition-colors"
        >
          <Plug className="w-4 h-4 shrink-0 text-[var(--ag-text-3)]" />
          <span className="flex-1 min-w-0 tabular-nums">
            {carregando ? 'Checando conexões…' : `${conectadas.length}/${itens.length} conectadas`}
          </span>
          {glifos}
          {pendentes > 0 && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: 'var(--ag-accent)' }} aria-label={`${pendentes} pendente(s)`} />}
          <ChevronDown className={`w-4 h-4 shrink-0 text-[var(--ag-text-3)] transition-transform duration-200 ${fixo ? 'rotate-180' : ''}`} />
        </button>
        {fixo && <div className="ag-rise flex flex-col pt-1">{lista}</div>}
      </div>
    );
  }

  return (
    <div ref={caixaRef} className="relative shrink-0" onPointerEnter={entrar} onPointerLeave={sair}>
      <button
        onClick={() => setFixo((f) => !f)}
        aria-expanded={visivel}
        aria-haspopup="true"
        className="h-9 pl-3 pr-2.5 rounded-full flex items-center gap-2 transition-colors"
        style={{ background: visivel ? 'var(--ag-fill-2)' : 'var(--ag-fill)' }}
      >
        <Plug className="w-[15px] h-[15px] text-[var(--ag-text-3)]" />
        <span className="text-[12.5px] font-medium text-[var(--ag-text-2)] whitespace-nowrap tabular-nums">
          {carregando ? 'checando…' : `${conectadas.length}/${itens.length} conectadas`}
        </span>
        {glifos && <span className="hidden sm:flex">{glifos}</span>}
        {pendentes > 0 && <span className="w-2 h-2 rounded-full" style={{ background: 'var(--ag-accent)' }} aria-label={`${pendentes} pendente(s)`} />}
        <ChevronDown className={`w-3.5 h-3.5 text-[var(--ag-text-3)] transition-transform duration-200 ${visivel ? 'rotate-180' : ''}`} />
      </button>

      {visivel && (
        // Sólida, não vidro: abre por cima da semana e do chat.
        <div
          className="ag-rise absolute left-0 top-full mt-2 z-30 w-[320px] max-w-[calc(100vw-24px)] rounded-[20px] p-1.5 flex flex-col"
          style={{ background: 'var(--ag-surface-solid)', border: '1px solid var(--ag-hairline)', boxShadow: 'var(--ag-shadow-lg)' }}
        >
          <div className="px-2.5 pt-1.5 pb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--ag-text-3)]">Conexões</div>
          {lista}
        </div>
      )}
    </div>
  );
};

export default ConnectionsBar;
