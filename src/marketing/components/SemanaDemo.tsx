// A tela inicial do Alfred ("Sua semana"), em versão de demonstração: o
// visitante aperta "Fazer com Alfred", vê o agente ler e escrever, revisa o
// antes/depois e aprova — o mesmo ciclo do app, com dados de exemplo.

import { useEffect, useRef, useState } from 'react';
import { Check, RotateCcw, Sparkles } from 'lucide-react';
import AlfredLogo from '../../components/alfredLogo/AlfredLogo';

type Origem = 'produto' | 'meli' | 'conteudo';
type Estado = 'aberta' | 'pensando' | 'revisar' | 'feita';

const ORIGEM: Record<Origem, { rotulo: string; cor: string }> = {
  produto: { rotulo: 'Produto', cor: 'var(--ag-orig-produto)' },
  meli: { rotulo: 'Mercado Livre', cor: 'var(--ag-orig-meli)' },
  conteudo: { rotulo: 'Conteúdo', cor: 'var(--ag-orig-conteudo)' },
};

interface TarefaDemo {
  id: string;
  origem: Origem;
  titulo: string;
  detalhe: string;
  estimativa?: string;
  etapas: string[];
  amostra?: { item: string; antes: string; depois: string };
  gravado?: string;
  inicial: Estado;
}

const TAREFAS: TarefaDemo[] = [
  {
    id: 'descricoes',
    origem: 'produto',
    titulo: '12 produtos sem descrição',
    detalhe: 'Mochilas e malas que vieram do Tiny',
    estimativa: '~4 min com o Alfred',
    etapas: ['Lendo 12 produtos no catálogo', 'Conferindo os atributos da categoria', 'Escrevendo descrição e SEO de cada um'],
    amostra: {
      item: 'Mochila Urban 25L Preta',
      antes: 'Mochila preta 25 litros.',
      depois:
        'Do trabalho à academia sem trocar de mochila: compartimento acolchoado para notebook de até 15,6", tecido impermeável e saída USB na alça. Cabe no bagageiro de mão.',
    },
    gravado: '12 descrições gravadas no catálogo, prontas para enviar ao Tiny.',
    inicial: 'aberta',
  },
  {
    id: 'titulos',
    origem: 'meli',
    titulo: '5 anúncios com título fraco',
    detalhe: 'Sem marca, modelo nem capacidade',
    estimativa: '~2 min com o Alfred',
    etapas: ['Lendo 5 anúncios no Mercado Livre', 'Comparando com o que o comprador busca', 'Reescrevendo título e ficha técnica'],
    amostra: {
      item: 'Anúncio: Mochila Notebook',
      antes: 'Mochila Notebook Preta',
      depois: 'Mochila Notebook 15,6 Urban 25L Impermeável com USB Preta',
    },
    gravado: '5 propostas prontas. Publicar continua sendo decisão sua.',
    inicial: 'aberta',
  },
  {
    id: 'artigo',
    origem: 'conteudo',
    titulo: 'Artigo: como escolher a mochila de viagem',
    detalhe: 'Publicado no seu blog',
    etapas: [],
    inicial: 'feita',
  },
];

const DIAS = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB', 'DOM'];

function estadosIniciais(): Record<string, Estado> {
  return Object.fromEntries(TAREFAS.map((t) => [t.id, t.inicial]));
}

export default function SemanaDemo() {
  const [estados, setEstados] = useState<Record<string, Estado>>(estadosIniciais);
  const [etapa, setEtapa] = useState(0);
  const [etapas, setEtapas] = useState<string[]>([]);
  const [aviso, setAviso] = useState<string | null>(null);
  const timers = useRef<number[]>([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const reduzido = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const passo = reduzido ? 200 : 750;
  const ocupado = Object.values(estados).some((e) => e === 'pensando' || e === 'revisar');

  /** `ajuste`: refaz a tarefa que já está em revisão (o "Ajustar" do card). */
  const fazer = (t: TarefaDemo, ajuste = false) => {
    if (ocupado && !ajuste) return;
    setAviso(null);
    setEtapa(0);
    setEtapas(t.etapas);
    setEstados((s) => ({ ...s, [t.id]: 'pensando' }));
    t.etapas.forEach((_, i) => {
      timers.current.push(window.setTimeout(() => setEtapa(i + 1), passo * (i + 1)));
    });
    timers.current.push(window.setTimeout(() => setEstados((s) => ({ ...s, [t.id]: 'revisar' })), passo * (t.etapas.length + 1)));
  };

  const aprovar = (t: TarefaDemo) => {
    setEstados((s) => ({ ...s, [t.id]: 'feita' }));
    setAviso(t.gravado ?? null);
  };

  const recomecar = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setEstados(estadosIniciais());
    setAviso(null);
  };

  const feitas = TAREFAS.filter((t) => estados[t.id] === 'feita').length;
  const pensando = Object.values(estados).includes('pensando');
  const hoje = (new Date().getDay() + 6) % 7;
  const segunda = new Date();
  segunda.setDate(segunda.getDate() - hoje);

  return (
    <div className="ag-glass-strong ag-sheen rounded-[30px] p-4 sm:p-5 text-left" aria-label="Demonstração da tela Sua semana">
      <div className="flex items-center gap-3">
        <AlfredLogo size={38} ativo={pensando} interativo={false} />
        <div className="flex-1 min-w-0">
          <p className="font-display text-[22px] font-semibold tracking-tight text-[var(--ag-text)] leading-none">Sua semana</p>
          <p className="mt-1 text-[12.5px] text-[var(--ag-text-3)]">Montada pelo Alfred a partir das suas fontes</p>
        </div>
        <span className="text-[13px] tabular-nums text-[var(--ag-text-2)]">{feitas} de {TAREFAS.length} feitas</span>
      </div>

      <div className="mt-4 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--ag-fill-2)' }}>
        <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${(feitas / TAREFAS.length) * 100}%`, background: 'var(--ag-text)' }} />
      </div>

      <div className="mt-4 grid grid-cols-7 gap-1" aria-hidden>
        {DIAS.map((d, i) => {
          const data = new Date(segunda);
          data.setDate(segunda.getDate() + i);
          const ativo = i === hoje;
          return (
            <div
              key={d}
              className="flex flex-col items-center py-1.5 rounded-[12px]"
              style={ativo ? { background: 'var(--ag-text)', color: 'var(--ag-bg-2)' } : { color: 'var(--ag-text-3)' }}
            >
              <span className="text-[10px] font-medium">{ativo ? 'HOJE' : d}</span>
              <span className="text-[14px] font-semibold tabular-nums" style={ativo ? undefined : { color: 'var(--ag-text-2)' }}>{data.getDate()}</span>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex flex-col gap-2.5" aria-live="polite">
        {TAREFAS.map((t) => (
          <Tarefa
            key={t.id}
            t={t}
            estado={estados[t.id]}
            etapa={etapa}
            etapas={etapas}
            bloqueado={ocupado}
            onFazer={() => fazer(t)}
            onAprovar={() => aprovar(t)}
            onAjustar={() => fazer({ ...t, etapas: ['Refazendo com o seu ajuste'] }, true)}
          />
        ))}
      </div>

      {aviso && (
        <div className="ag-rise mt-3 flex items-start gap-2.5 rounded-[16px] px-3.5 py-3 text-[13.5px]" style={{ background: 'var(--ag-ok-soft)', color: 'var(--ag-text)' }}>
          <Check className="w-4 h-4 mt-0.5 shrink-0" style={{ color: 'var(--ag-ok)' }} />
          {aviso}
        </div>
      )}

      {feitas === TAREFAS.length && (
        <button
          type="button"
          onClick={recomecar}
          className="mt-3 inline-flex items-center gap-1.5 rounded-full px-3.5 min-h-[36px] text-[13px] font-medium text-[var(--ag-text-2)] hover:bg-[var(--ag-fill)]"
        >
          <RotateCcw className="w-3.5 h-3.5" /> Ver de novo
        </button>
      )}
    </div>
  );
}

interface TarefaProps {
  t: TarefaDemo;
  estado: Estado;
  etapa: number;
  etapas: string[];
  bloqueado: boolean;
  onFazer: () => void;
  onAprovar: () => void;
  onAjustar: () => void;
}

function Tarefa({ t, estado, etapa, etapas, bloqueado, onFazer, onAprovar, onAjustar }: TarefaProps) {
  if (estado === 'feita') {
    return (
      <div className="flex items-center gap-3 px-4 py-3 rounded-[18px]" style={{ background: 'var(--ag-fill)' }}>
        <span className="w-6 h-6 rounded-full grid place-items-center shrink-0" style={{ background: 'var(--ag-ok-soft)', color: 'var(--ag-ok)' }}>
          <Check className="w-3.5 h-3.5" />
        </span>
        <div className="min-w-0">
          <p className="text-[14px] text-[var(--ag-text-2)] line-through truncate" style={{ textDecorationColor: 'var(--ag-hairline-2)' }}>{t.titulo}</p>
          <p className="text-[12px] text-[var(--ag-text-3)] truncate">{t.origem === 'conteudo' ? t.detalhe : 'Aprovado por você agora'}</p>
        </div>
      </div>
    );
  }

  const origem = ORIGEM[t.origem];
  return (
    <div
      className="ag-glass rounded-[22px] p-4 flex flex-col gap-2.5"
      style={estado === 'aberta' ? { borderColor: 'var(--ag-accent-line)' } : undefined}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.05em] text-[var(--ag-text-2)]">
          <span className="w-2 h-2 rounded-full" style={{ background: origem.cor }} />
          {origem.rotulo}
        </span>
        {estado === 'aberta' && (
          <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold" style={{ background: 'var(--ag-accent-soft)', color: 'var(--ag-accent)' }}>
            precisa de você
          </span>
        )}
      </div>
      <p className="text-[15.5px] font-semibold leading-snug text-[var(--ag-text)]">{t.titulo}</p>

      {estado === 'aberta' && (
        <>
          <p className="text-[13px] text-[var(--ag-text-2)] -mt-1">{t.detalhe}</p>
          {t.estimativa && <p className="text-[12px] text-[var(--ag-text-3)] -mt-1">{t.estimativa}</p>}
          <button
            type="button"
            onClick={onFazer}
            disabled={bloqueado}
            className="mt-0.5 min-h-[44px] px-4 rounded-full flex items-center justify-center gap-1.5 text-[14px] font-semibold transition-[transform,opacity] active:scale-[.98] disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ag-accent)]"
            style={{ background: 'var(--ag-text)', color: 'var(--ag-bg-2)' }}
          >
            <Sparkles className="w-4 h-4" />
            Fazer com Alfred
          </button>
        </>
      )}

      {estado === 'pensando' && (
        <ul className="flex flex-col gap-1.5 pt-0.5">
          {etapas.map((e, i) => {
            const pronta = i < etapa;
            const atual = i === etapa;
            if (!pronta && !atual) return null;
            return (
              <li key={e} className="ag-rise flex items-center gap-2 text-[13px]" style={{ color: pronta ? 'var(--ag-text-2)' : 'var(--ag-text)' }}>
                {pronta ? (
                  <Check className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--ag-ok)' }} />
                ) : (
                  <span className="w-3.5 flex justify-center gap-[2px] shrink-0" aria-hidden>
                    <span className="ag-dot w-[3px] h-[3px] rounded-full bg-current" />
                    <span className="ag-dot w-[3px] h-[3px] rounded-full bg-current" />
                    <span className="ag-dot w-[3px] h-[3px] rounded-full bg-current" />
                  </span>
                )}
                {e}
              </li>
            );
          })}
        </ul>
      )}

      {estado === 'revisar' && t.amostra && (
        <div className="ag-rise flex flex-col gap-2">
          <p className="text-[12px] text-[var(--ag-text-3)]">Você revisa: {t.amostra.item}</p>
          <div className="rounded-[14px] px-3 py-2.5 text-[13px] leading-snug" style={{ background: 'var(--ag-fill)', color: 'var(--ag-text-2)' }}>
            <span className="block text-[11px] font-semibold mb-0.5 text-[var(--ag-text-3)]">Antes</span>
            {t.amostra.antes}
          </div>
          <div className="rounded-[14px] px-3 py-2.5 text-[13px] leading-snug" style={{ background: 'var(--ag-accent-tint)', border: '1px solid var(--ag-accent-line)', color: 'var(--ag-text)' }}>
            <span className="block text-[11px] font-semibold mb-0.5" style={{ color: 'var(--ag-accent)' }}>Depois</span>
            {t.amostra.depois}
          </div>
          <div className="flex gap-2 pt-0.5">
            <button
              type="button"
              onClick={onAprovar}
              className="flex-1 min-h-[44px] rounded-full text-[14px] font-semibold text-white active:scale-[.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ag-accent)]"
              style={{ background: 'var(--ag-accent)' }}
            >
              Aprovar e gravar
            </button>
            <button
              type="button"
              onClick={onAjustar}
              className="min-h-[44px] px-4 rounded-full text-[14px] font-semibold active:scale-[.98]"
              style={{ background: 'var(--ag-fill-2)', color: 'var(--ag-text)' }}
            >
              Ajustar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
