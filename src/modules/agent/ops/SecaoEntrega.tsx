import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { ROTULO_SITUACAO } from './pedidos';
import type { Distribuicao, PainelEntrega } from './indicadores';
import { BotaoAlfred, LinhaItem, Secao, Tile, brl, int } from './pecas';

const dias = (n: number) => `${int(n)} ${n === 1 ? 'dia' : 'dias'}`;
const valorDist = (d: Distribuicao | null) => (d ? dias(d.mediana) : '—');
const subDist = (d: Distribuicao | null, vazio: string) =>
  d ? `90% em até ${dias(d.p90)} · ${int(d.amostra)} pedidos` : vazio;

/**
 * Entrega: quanto tempo o pedido leva para sair e para chegar, se chega no
 * prazo e o que está atrasado. Medianas e p90 (`painelEntrega`), não médias —
 * um pedido esquecido não pode puxar o número de todos.
 */
const SecaoEntrega: React.FC<{ entrega: PainelEntrega; nomeFonte: string; onPedirAlfred: (texto: string) => void }> = ({ entrega: e, nomeFonte, onPedirAlfred }) => {
  const pedirAtrasados = () => {
    const lista = e.atrasados.slice(0, 5).map((a) => `#${a.numero} (${ROTULO_SITUACAO[a.situacao].toLowerCase()}, ${a.diasAtraso} dias além da previsão)`).join(', ');
    onPedirAlfred(`Tenho ${e.totalAtrasados} pedidos atrasados no ${nomeFonte}. Os mais atrasados: ${lista}. Verifique a situação e o rastreio de cada um e proponha o próximo passo.`);
  };
  const semDatas = e.comDatas < 0.5;

  return (
    <Secao
      titulo="Entrega"
      nota={semDatas
        ? 'As datas de envio e entrega chegam com o detalhe de cada pedido — os números ainda estão se formando.'
        : 'Pedidos dos últimos 60 dias. Mediana, e o tempo em que 90% dos pedidos ficam.'}
      acao={e.totalAtrasados > 0 ? <BotaoAlfred onClick={pedirAtrasados}>Cobrar atrasados</BotaoAlfred> : undefined}
    >
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile rotulo="Do pedido ao envio" valor={valorDist(e.ateEnviar)}>
          <span className="text-[12px] text-[var(--ag-text-3)]">{subDist(e.ateEnviar, 'sem pedidos enviados')}</span>
        </Tile>
        <Tile rotulo="Transporte" valor={valorDist(e.transporte)}>
          <span className="text-[12px] text-[var(--ag-text-3)]">{subDist(e.transporte, 'sem entregas com data')}</span>
        </Tile>
        <Tile rotulo="Entregues no prazo" valor={e.noPrazo ? `${Math.round(e.noPrazo.fracao * 100)}%` : '—'} alerta={!!e.noPrazo && e.noPrazo.fracao < 0.9}>
          <span className="text-[12px] text-[var(--ag-text-3)]">{e.noPrazo ? `de ${int(e.noPrazo.amostra)} com previsão` : 'sem entregas com previsão'}</span>
        </Tile>
        <Tile rotulo="Atrasados" valor={int(e.totalAtrasados)} alerta={e.totalAtrasados > 0}>
          <span className="text-[12px] text-[var(--ag-text-3)]">
            {e.naoEntregues > 0 ? `+ ${int(e.naoEntregues)} não entregues` : 'previsão vencida, ainda a caminho'}
          </span>
        </Tile>
      </div>

      {e.totalAtrasados > 0 && (
        <div className="ag-glass rounded-[18px] overflow-hidden">
          <div className="px-4 pt-3 pb-1 text-[12.5px] font-medium flex items-center gap-1" style={{ color: 'var(--ag-warn)' }}>
            <AlertTriangle className="w-3.5 h-3.5" aria-hidden />
            Mais atrasados
          </div>
          <ul>
            {e.atrasados.slice(0, 5).map((a, i) => (
              <LinhaItem
                key={a.idExterno}
                primeira={i === 0}
                titulo={`Pedido #${a.numero}`}
                sub={`${ROTULO_SITUACAO[a.situacao]} · previsto para ${a.dataPrevista.slice(8, 10)}/${a.dataPrevista.slice(5, 7)} · ${brl(a.valor)}`}
                valor={`+${dias(a.diasAtraso)}`}
                tom="warn"
              />
            ))}
          </ul>
        </div>
      )}

      {e.porFormaEnvio.length > 1 && (
        <div className="ag-glass rounded-[18px] overflow-hidden">
          <div className="px-4 pt-3 pb-1 text-[12.5px] font-medium text-[var(--ag-text-2)]">Transporte por forma de envio</div>
          <ul>
            {e.porFormaEnvio.slice(0, 6).map((f, i) => (
              <LinhaItem
                key={f.forma}
                primeira={i === 0}
                titulo={f.forma}
                sub={`${int(f.entregues)} entregues${f.transporte ? ` · 90% em até ${dias(f.transporte.p90)}` : ''}`}
                valor={valorDist(f.transporte)}
              />
            ))}
          </ul>
        </div>
      )}
    </Secao>
  );
};

export default SecaoEntrega;
