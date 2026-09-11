// Régua de conexões — a resposta visual para "o que está conectado e o que o
// agente consegue fazer com isso".
//
// Três informações por plataforma, que antes estavam espalhadas entre a tela de
// Integrações e nenhum lugar: o estado real da conexão (vindo de
// /api/*/status), quantas ferramentas o agente ganha por estar conectado
// (/api/agent/tools) e quantas aprovações estão paradas esperando o usuário.
//
// A régua é a barra fechada; clicar numa plataforma abre o detalhe embaixo, no
// mesmo bloco de vidro, em vez de um popover flutuante — posicionamento de
// popover em barra com scroll horizontal é uma fonte infinita de bug e aqui
// não compra nada.

import React, { useState } from 'react';
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

interface Props {
  itens: ConnectionItem[];
  carregando: boolean;
  onConectar: () => void;
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

const Pilula: React.FC<{
  item: ConnectionItem;
  aberto: boolean;
  onClick: () => void;
}> = ({ item, aberto, onClick }) => {
  const estado = !item.conectado ? 'off' : item.atencao ? 'warn' : 'on';

  return (
    <button
      onClick={onClick}
      aria-expanded={aberto}
      title={item.conectado ? `${item.nome} — conectado` : `${item.nome} — não conectado`}
      className="group relative flex items-center gap-2 pl-1.5 pr-3 py-1.5 rounded-full border transition-all duration-200 shrink-0"
      style={{
        borderColor: aberto ? 'var(--ag-hairline-2)' : 'var(--ag-hairline)',
        background: aberto ? 'var(--ag-fill-2)' : 'var(--ag-fill)',
        opacity: item.conectado ? 1 : 0.72,
      }}
    >
      <span
        className="w-6 h-6 rounded-full grid place-items-center text-[10px] font-bold tracking-tight text-white shrink-0"
        style={{ background: item.cor, filter: item.conectado ? undefined : 'grayscale(1)' }}
      >
        {item.glifo}
      </span>
      <span className="text-[13px] font-medium text-[var(--ag-text)] whitespace-nowrap">{item.nome}</span>
      <Ponto estado={estado} />
      {!!item.pendentes && (
        <span
          className="ml-0.5 min-w-[18px] h-[18px] px-1 rounded-full grid place-items-center text-[10px] font-bold tabular-nums"
          style={{ background: 'var(--ag-accent)', color: 'var(--ag-accent-ink)' }}
        >
          {item.pendentes}
        </span>
      )}
    </button>
  );
};

const Detalhe: React.FC<{ item: ConnectionItem; onConectar: () => void }> = ({ item, onConectar }) => (
  <div className="ag-rise px-1 pt-3">
    <div
      className="rounded-2xl p-3.5 flex flex-wrap items-center gap-x-5 gap-y-2.5"
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

const ConnectionsBar: React.FC<Props> = ({ itens, carregando, onConectar }) => {
  const [abertoId, setAbertoId] = useState<string | null>(null);
  const conectadas = itens.filter((i) => i.conectado);
  const aberto = itens.find((i) => i.id === abertoId) ?? null;

  return (
    <div className="ag-glass ag-sheen rounded-[22px] px-2.5 py-2 shrink-0">
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 pl-1.5 pr-2 shrink-0">
          <Plug className="w-[15px] h-[15px] text-[var(--ag-text-3)]" />
          <span className="text-[12px] font-medium text-[var(--ag-text-2)] whitespace-nowrap tabular-nums">
            {carregando ? '…' : `${conectadas.length}/${itens.length}`}
            <span className="hidden sm:inline"> {carregando ? 'checando' : 'conectadas'}</span>
          </span>
        </div>

        <div className="w-px h-6 shrink-0" style={{ background: 'var(--ag-hairline)' }} />

        <div className="ag-scroll-x flex items-center gap-2 overflow-x-auto flex-1 min-w-0 py-0.5">
          {carregando && !itens.length
            ? [0, 1, 2].map((i) => <div key={i} className="ag-shimmer h-9 w-32 rounded-full shrink-0" />)
            : itens.map((item) => (
              <Pilula
                key={item.id}
                item={item}
                aberto={abertoId === item.id}
                onClick={() => setAbertoId((a) => (a === item.id ? null : item.id))}
              />
            ))}

          <button
            onClick={onConectar}
            title="Adicionar integração"
            className="w-8 h-8 rounded-full grid place-items-center shrink-0 transition-colors"
            style={{ border: '1px dashed var(--ag-hairline-2)', color: 'var(--ag-text-3)' }}
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        {aberto && (
          <button
            onClick={() => setAbertoId(null)}
            className="p-1.5 rounded-full shrink-0 text-[var(--ag-text-3)] hover:text-[var(--ag-text)] transition-colors"
            title="Fechar detalhe"
          >
            <ChevronDown className="w-4 h-4" />
          </button>
        )}
      </div>

      {aberto && <Detalhe item={aberto} onConectar={onConectar} />}
    </div>
  );
};

export default ConnectionsBar;
