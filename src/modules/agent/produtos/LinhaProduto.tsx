import React, { useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import type { Product } from '../../../types/models';
import { ASPECTO, ASPECTO_DO_ROTULO, type Aspecto } from '../aspectos';
import { integracoesDoProduto, nomeDe, pilulasDe, skuDe, type EstadoPilula } from '../produtosAgente';
import SeloIntegracao from './SeloIntegracao';
import { useMudou } from '../movimento';

/**
 * Pílula de um aspecto: o ícone diz qual (a cor dele, de `aspectos.tsx`), o
 * fundo diz o estado — feito (tingido na cor do aspecto, com ✓), falta e é
 * obrigatório (âmbar, "sem …"), opcional (só contorno) e gerando (azul).
 */
const Pilula: React.FC<{ rotulo: string; estado: EstadoPilula }> = ({ rotulo, estado }) => {
  const aspecto: Aspecto = ASPECTO_DO_ROTULO[rotulo] ?? 'descricao';
  const { Icone, cor } = ASPECTO[aspecto];
  const estilo: React.CSSProperties =
    estado === 'ok' ? { background: `color-mix(in srgb, ${cor} 11%, transparent)`, color: cor }
      : estado === 'alerta' ? { background: 'var(--ag-warn-soft)', color: 'var(--ag-warn)' }
        : estado === 'rodando' ? { background: 'var(--ag-blue-soft)', color: 'var(--ag-blue)' }
          : { color: 'var(--ag-text-3)', boxShadow: 'inset 0 0 0 1px var(--ag-hairline-2)' };
  const texto = estado === 'alerta' ? `sem ${rotulo}` : estado === 'rodando' ? `${rotulo} gerando` : rotulo;
  // Quando o estado muda com a linha na tela (ex.: "sem descrição" → feito), a
  // pílula vira no eixo X — o usuário vê o que acabou de mudar.
  const mudou = useMudou(estado);
  return (
    <span key={mudou} className={`inline-flex items-center gap-1 h-6 pl-1.5 pr-2 rounded-full text-[11.5px] font-medium whitespace-nowrap ${mudou ? 'ag-vira' : ''}`} style={estilo}>
      {estado === 'rodando' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Icone className="w-3 h-3" />}
      {texto}
      {estado === 'ok' && <Check className="w-3 h-3" strokeWidth={2.5} />}
    </span>
  );
};

const primeiraImagem = (p: Product): string | null => {
  if (p._selectedImage) return p._selectedImage;
  const rec = p as unknown as Record<string, unknown>;
  const chave = Object.keys(rec).filter((k) => /^URL imagem/i.test(k)).sort().find((k) => String(rec[k] ?? '').trim());
  return chave ? String(rec[chave]).trim() : null;
};

const Miniatura: React.FC<{ p: Product }> = ({ p }) => {
  const url = primeiraImagem(p);
  const [falhou, setFalhou] = useState(false);
  const [carregou, setCarregou] = useState(false);
  return (
    <span className="w-12 h-12 rounded-[12px] shrink-0 overflow-hidden grid place-items-center" style={{ background: 'var(--ag-fill)', boxShadow: 'inset 0 0 0 1px var(--ag-hairline)' }}>
      {url && !falhou ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          className={`w-full h-full object-cover ${carregou ? 'ag-revela' : 'opacity-0'}`}
          onLoad={() => setCarregou(true)}
          onError={() => setFalhou(true)}
        />
      ) : (
        <span className="text-[15px] font-semibold text-[var(--ag-text-3)]">{nomeDe(p).slice(0, 1).toUpperCase()}</span>
      )}
    </span>
  );
};

export const Caixa: React.FC<{ marcada: boolean; rotulo: string; onClick: () => void }> = ({ marcada, rotulo, onClick }) => {
  const mudou = useMudou(marcada);
  return (
  <button
    onClick={onClick}
    role="checkbox"
    aria-checked={marcada}
    aria-label={rotulo}
    className="w-11 h-11 -ml-0.5 grid place-items-center shrink-0"
  >
    <span
      className="w-[22px] h-[22px] rounded-[7px] grid place-items-center transition-colors"
      style={marcada
        ? { background: 'var(--ag-text)', color: 'var(--ag-bg-2)' }
        : { border: '1.5px solid var(--ag-hairline-2)', background: 'var(--ag-surface-solid)' }}
    >
      {marcada && <Check key={mudou} className={`w-3.5 h-3.5 ${mudou ? 'ag-bump' : ''}`} strokeWidth={3} />}
    </span>
  </button>
  );
};

interface Props {
  p: Product;
  marcado: boolean;
  onMarcar: () => void;
  onAbrir: () => void;
  /** Filtro "Sem vídeo" ativo: a pílula de vídeo entra na linha. */
  mostrarVideo: boolean;
}

/** Caixa no começo; o resto da linha abre o produto. Selos e pílulas descem no telefone. */
const LinhaProduto: React.FC<Props> = ({ p, marcado, onMarcar, onAbrir, mostrarVideo }) => {
  const integracoes = integracoesDoProduto(p);
  const pilulas = [...pilulasDe(p, 'catalogo'), ...(mostrarVideo ? pilulasDe(p, 'videos').slice(1) : [])];
  const gerando = !!p._isGenerating || pilulas.some((pl) => pl.estado === 'rodando');
  return (
    <div
      data-linha-produto
      className={`flex items-center gap-1 pl-1 pr-3 py-2.5 transition-colors hover:bg-[var(--ag-fill)] ${gerando ? 'ag-gerando' : ''}`}
      style={{ borderTop: '1px solid var(--ag-hairline)', background: marcado ? 'var(--ag-fill)' : undefined }}
    >
      <Caixa marcada={marcado} rotulo={`Selecionar ${nomeDe(p)}${skuDe(p) ? ` (${skuDe(p)})` : ''}`} onClick={onMarcar} />
      <button onClick={onAbrir} className="flex-1 min-w-0 flex flex-col lg:flex-row lg:items-center gap-1.5 lg:gap-3 text-left">
        <span className="flex-1 min-w-0 flex items-center gap-3">
          <Miniatura p={p} />
          <span className="min-w-0 flex flex-col">
            <span className="text-[14px] font-semibold text-[var(--ag-text)] truncate">{nomeDe(p)}</span>
            {skuDe(p) && <span className="text-[12px] font-mono text-[var(--ag-text-3)] truncate">{skuDe(p)}</span>}
          </span>
        </span>
        <span className="lg:w-[170px] flex gap-1 flex-wrap pl-[60px] lg:pl-0">
          {integracoes.length
            ? integracoes.map((i) => <SeloIntegracao key={i.integracao} integracao={i.integracao} estado={i.estado} />)
            : <SeloIntegracao />}
        </span>
        <span className="lg:w-[38%] flex gap-1 flex-wrap pl-[60px] lg:pl-0">
          {pilulas.map((pl) => <Pilula key={pl.rotulo} rotulo={pl.rotulo} estado={pl.estado} />)}
        </span>
      </button>
    </div>
  );
};

export default LinhaProduto;
