import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { alvos, custoDe, etapasPensando, type Confirmacao } from '../confirmacaoMassa';

interface Props {
  conf: Confirmacao;
  saldo: number;
  onConfirmar: (sobrescrever: boolean) => Promise<void>;
  onCancelar: () => void;
  onRecarregar: () => void;
}

/** Atraso entre as linhas do "pensando" — o bastante para ler, curto para não irritar. */
const PASSO_MS = 420;

/**
 * Card local (não persistido) no painel do Alfred: as etapas reais da
 * conferência entram uma a uma, depois o resumo e os botões. O padrão é
 * gerar só os que não têm.
 */
const CardConfirmacao: React.FC<Props> = ({ conf, saldo, onConfirmar, onCancelar, onRecarregar }) => {
  const etapas = etapasPensando(conf);
  const [visiveis, setVisiveis] = useState(0);
  const [enviando, setEnviando] = useState<boolean | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    setVisiveis(0);
    const timers = etapas.map((_, i) => setTimeout(() => setVisiveis(i + 1), (i + 1) * PASSO_MS));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conf]);

  const pronto = visiveis >= etapas.length;
  const nNovos = alvos(conf, false).length;
  const nTodos = alvos(conf, true).length;
  const imagem = conf.ferramenta === 'produtos.ambientadas.gerar';
  const faltaPara = (s: boolean) => Math.max(0, custoDe(conf, s) - saldo);

  const confirmar = async (sobrescrever: boolean) => {
    setEnviando(sobrescrever);
    setErro(null);
    try { await onConfirmar(sobrescrever); } catch (e) { setErro(e instanceof Error ? e.message : 'Falha ao começar.'); setEnviando(null); }
  };

  const principal = { background: 'var(--ag-accent)', color: 'var(--ag-accent-ink)' };
  const secundario = { background: 'var(--ag-fill-2)', color: 'var(--ag-text)' };
  const botao = 'min-h-[44px] px-4 rounded-full text-[13.5px] font-semibold flex items-center justify-center gap-2 disabled:opacity-50';

  return (
    <div className="ag-glass rounded-[20px] px-4 py-3 flex flex-col gap-2" style={{ boxShadow: 'var(--ag-shadow-sm)' }}>
      <ul className="flex flex-col gap-1 text-[13px] text-[var(--ag-text-2)]" aria-live="polite">
        {etapas.slice(0, visiveis).map((t) => <li key={t} className="animate-in fade-in">▸ {t}</li>)}
        {!pronto && <li className="flex items-center gap-2 text-[var(--ag-text-3)]"><Loader2 className="w-3.5 h-3.5 animate-spin" /> pensando…</li>}
      </ul>
      {pronto && (
        <>
          <p className="text-[14px] font-semibold text-[var(--ag-text)]">
            {nNovos
              ? `${nNovos} ${nNovos === 1 ? 'será gerado' : 'serão gerados'}.`
              : `Todos já têm ${imagem ? 'imagem ambientada' : 'descrição'}.`}
            {imagem && conf.jaTem.length > 0 && ' Sobrescrever acrescenta 3 imagens novas; as antigas ficam.'}
          </p>
          {erro && <p className="text-[13px]" style={{ color: 'var(--ag-danger)' }}>{erro}</p>}
          <div className="flex flex-wrap gap-2">
            {nNovos > 0 && (faltaPara(false) > 0
              ? <button className={botao} style={principal} onClick={onRecarregar}>Faltam {faltaPara(false)} créditos · Recarregar</button>
              : (
                <button className={botao} style={principal} disabled={enviando !== null} onClick={() => confirmar(false)}>
                  {enviando === false && <Loader2 className="w-4 h-4 animate-spin" />}
                  Gerar só os {nNovos} · {custoDe(conf, false)} créditos
                </button>
              ))}
            {conf.jaTem.length > 0 && (faltaPara(true) > 0 && nNovos === 0
              ? <button className={botao} style={principal} onClick={onRecarregar}>Faltam {faltaPara(true)} créditos · Recarregar</button>
              : (
                <button className={botao} style={nNovos ? secundario : principal} disabled={enviando !== null || faltaPara(true) > 0} onClick={() => confirmar(true)}>
                  {enviando === true && <Loader2 className="w-4 h-4 animate-spin" />}
                  Sobrescrever os {nTodos}
                </button>
              ))}
            <button className={botao} style={{ color: 'var(--ag-text-2)' }} disabled={enviando !== null} onClick={onCancelar}>Cancelar</button>
          </div>
        </>
      )}
    </div>
  );
};

export default CardConfirmacao;
