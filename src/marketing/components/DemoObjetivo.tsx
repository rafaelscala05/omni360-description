// O "antes e depois" de cada página de objetivo, montado com a mesma
// linguagem das telas do app (vidro, pílulas, cores de aspecto). Dados de
// exemplo; as fotos ambientadas são saídas reais do gerador.

import React from 'react';
import { Check, Globe, Minus, Video } from 'lucide-react';
import type { Objetivo } from '../../modules/agent/capacidades';
import fotoOriginal from '../../assets/marketing/demo-tenis-original.jpg';
import ambiente1 from '../../assets/marketing/demo-tenis-ambiente-1.jpg';
import ambiente2 from '../../assets/marketing/demo-tenis-ambiente-2.jpg';

export default function DemoObjetivo({ objetivo }: { objetivo: Objetivo }) {
  if (objetivo === 'meli') return <DemoMeli />;
  if (objetivo === 'conteudo') return <DemoConteudo />;
  return <DemoProduto />;
}

function Coluna({ tipo, children }: { tipo: 'antes' | 'depois'; children: React.ReactNode }) {
  const depois = tipo === 'depois';
  return (
    <div
      className={`${depois ? 'ag-glass-strong ag-sheen' : ''} rounded-[26px] p-5 sm:p-6 flex flex-col gap-5 min-w-0`}
      style={depois ? { borderColor: 'var(--ag-accent-line)' } : { background: 'var(--ag-fill)', border: '1px solid var(--ag-hairline)' }}
    >
      <span
        className="self-start rounded-full px-3 py-1 text-[12.5px] font-semibold"
        style={depois ? { background: 'var(--ag-accent)', color: '#fff' } : { background: 'var(--ag-fill-2)', color: 'var(--ag-text-2)' }}
      >
        {depois ? 'Depois do Alfred' : 'Antes'}
      </span>
      {children}
    </div>
  );
}

function Campo({ rotulo, children, vazio }: { rotulo: string; children?: React.ReactNode; vazio?: boolean }) {
  return (
    <div>
      <p className="text-[12px] font-medium text-[var(--ag-text-3)] mb-1">{rotulo}</p>
      {vazio ? <p className="text-[14px] italic text-[var(--ag-text-3)]">Vazio</p> : <div className="text-[14.5px] leading-relaxed text-[var(--ag-text)]">{children}</div>}
    </div>
  );
}

function Atributos({ itens }: { itens: [string, string | null][] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13.5px]">
      {itens.map(([k, v]) => (
        <div key={k} className="flex flex-col">
          <dt className="text-[var(--ag-text-3)] text-[12px]">{k}</dt>
          <dd className="flex items-center gap-1" style={{ color: v ? 'var(--ag-text)' : 'var(--ag-text-3)' }}>
            {v ?? <Minus className="w-3.5 h-3.5" aria-label="vazio" />}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Foto({ src, rotulo }: { src: string; rotulo: string }) {
  return (
    <figure className="flex flex-col gap-1.5">
      <img src={src} alt={rotulo} loading="lazy" className="w-full aspect-square object-cover rounded-[14px]" style={{ border: '1px solid var(--ag-hairline)' }} />
      <figcaption className="text-[11.5px] text-[var(--ag-text-3)]">{rotulo}</figcaption>
    </figure>
  );
}

function DemoProduto() {
  return (
    <div className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
      <Coluna tipo="antes">
        <Campo rotulo="Título">TENIS CANO ALTO LONA PT 39</Campo>
        <Campo rotulo="Descrição" vazio />
        <Campo rotulo="Dados do fornecedor">
          <span className="text-[var(--ag-text-2)]">lona de algodão, solado de borracha, cano alto</span>
        </Campo>
        <Atributos itens={[['Material', null], ['Cor', 'Preto'], ['Cano', null], ['Solado', null]]} />
        <div className="grid grid-cols-3 gap-2">
          <Foto src={fotoOriginal} rotulo="Foto do fornecedor" />
        </div>
      </Coluna>
      <Coluna tipo="depois">
        <Campo rotulo="Título">Tênis Cano Alto de Lona Preto com Solado de Borracha</Campo>
        <Campo rotulo="Descrição">
          O clássico de cano alto que vai da bermuda ao jeans sem esforço. Cabedal em lona de algodão, solado de borracha e cano que
          firma o tornozelo. Preto, para combinar com tudo o que já está no seu armário.
        </Campo>
        <Campo rotulo="Meta description (Google)">
          <span className="text-[var(--ag-text-2)]">Tênis cano alto de lona preto com solado de borracha. Clássico para o dia a dia, combina com jeans e bermuda.</span>
        </Campo>
        <Atributos itens={[['Material', 'Lona de algodão'], ['Cor', 'Preto'], ['Cano', 'Alto'], ['Solado', 'Borracha']]} />
        <div className="grid grid-cols-3 gap-2">
          <Foto src={fotoOriginal} rotulo="Original" />
          <Foto src={ambiente1} rotulo="Ambientada" />
          <Foto src={ambiente2} rotulo="Em uso" />
        </div>
      </Coluna>
    </div>
  );
}

function Medidor({ valor, total, rotulo }: { valor: number; total: number; rotulo: string }) {
  const pct = Math.round((valor / total) * 100);
  const cor = pct >= 80 ? 'var(--ag-ok)' : pct >= 50 ? 'var(--ag-warn)' : 'var(--ag-danger)';
  return (
    <div>
      <div className="flex justify-between text-[12.5px] mb-1.5">
        <span className="text-[var(--ag-text-3)]">{rotulo}</span>
        <span className="tabular-nums font-semibold" style={{ color: cor }}>{valor} de {total}</span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--ag-fill-2)' }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: cor }} />
      </div>
    </div>
  );
}

function Nota({ valor }: { valor: number }) {
  const cor = valor >= 80 ? 'var(--ag-ok)' : valor >= 60 ? 'var(--ag-warn)' : 'var(--ag-danger)';
  return (
    <div className="flex items-baseline gap-2">
      <span className="font-display text-[40px] font-semibold leading-none tabular-nums" style={{ color: cor }}>{valor}</span>
      <span className="text-[12.5px] text-[var(--ag-text-3)]">nota do anúncio</span>
    </div>
  );
}

function DemoMeli() {
  const antes = 'Mochila Notebook Preta';
  const depois = 'Mochila Notebook 15,6 Urban 25L Impermeável com USB Preta';
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Coluna tipo="antes">
        <Nota valor={54} />
        <Campo rotulo={`Título · ${antes.length} de 60 caracteres`}>{antes}</Campo>
        <Medidor valor={7} total={18} rotulo="Ficha técnica" />
        <Medidor valor={1} total={6} rotulo="Fotos" />
        <p className="flex items-center gap-2 text-[13.5px] text-[var(--ag-text-3)]"><Video className="w-4 h-4" /> Sem vídeo</p>
      </Coluna>
      <Coluna tipo="depois">
        <Nota valor={91} />
        <Campo rotulo={`Título · ${depois.length} de 60 caracteres`}>{depois}</Campo>
        <Medidor valor={18} total={18} rotulo="Ficha técnica" />
        <Medidor valor={5} total={6} rotulo="Fotos (capa + 4 ambientadas)" />
        <p className="flex items-center gap-2 text-[13.5px] text-[var(--ag-text)]"><Video className="w-4 h-4" style={{ color: 'var(--ag-asp-video)' }} /> Vídeo vinculado ao anúncio</p>
      </Coluna>
    </div>
  );
}

type StatusArtigo = 'publicado' | 'producao' | 'calendario';

const STATUS: Record<StatusArtigo, { rotulo: string; estilo: React.CSSProperties }> = {
  publicado: { rotulo: 'Publicado', estilo: { background: 'var(--ag-ok-soft)', color: 'var(--ag-ok)' } },
  producao: { rotulo: 'Em produção', estilo: { background: 'var(--ag-violet-soft)', color: 'var(--ag-violet)' } },
  calendario: { rotulo: 'No calendário', estilo: { background: 'var(--ag-fill-2)', color: 'var(--ag-text-2)' } },
};

const CLUSTERS: { tema: string; artigos: { titulo: string; data: string; status: StatusArtigo; principal?: boolean }[] }[] = [
  {
    tema: 'Mochilas para viagem',
    artigos: [
      { titulo: 'Como escolher a mochila de viagem certa', data: 'ter 7', status: 'publicado', principal: true },
      { titulo: 'Mochila ou mala de mão: qual levar no avião', data: 'qui 9', status: 'producao' },
      { titulo: 'O que cabe numa mochila de 25 litros', data: 'ter 14', status: 'calendario' },
    ],
  },
  {
    tema: 'Trabalho e notebook',
    artigos: [
      { titulo: 'Guia da mochila para notebook: tamanho, proteção e conforto', data: 'qui 16', status: 'calendario', principal: true },
      { titulo: 'Mochila impermeável vale a pena?', data: 'ter 21', status: 'calendario' },
    ],
  },
];

function DemoConteudo() {
  return (
    <div className="grid gap-4 lg:grid-cols-[0.75fr_1.25fr]">
      <div className="rounded-[26px] p-5 sm:p-6 flex flex-col gap-5" style={{ background: 'var(--ag-fill)', border: '1px solid var(--ag-hairline)' }}>
        <span className="self-start rounded-full px-3 py-1 text-[12.5px] font-semibold" style={{ background: 'var(--ag-fill-2)', color: 'var(--ag-text-2)' }}>
          O que o Alfred leu
        </span>
        <p className="flex items-center gap-2 text-[14.5px] font-semibold text-[var(--ag-text)]"><Globe className="w-4 h-4 text-[var(--ag-text-3)]" /> sualoja.com.br</p>
        <Campo rotulo="O que vende">Mochilas, malas de bordo e acessórios de viagem</Campo>
        <Campo rotulo="Para quem">Quem viaja a trabalho e quer levar pouco</Campo>
        <Campo rotulo="Tom de voz">Direto, prático, sem exagero</Campo>
        <Campo rotulo="Blog hoje"><span className="text-[var(--ag-text-2)]">Último artigo há 2 anos</span></Campo>
      </div>
      <div className="ag-glass-strong ag-sheen rounded-[26px] p-5 sm:p-6 flex flex-col gap-5" style={{ borderColor: 'var(--ag-violet-line)' }}>
        <span className="self-start rounded-full px-3 py-1 text-[12.5px] font-semibold text-white" style={{ background: 'var(--ag-violet)' }}>
          Plano do Alfred
        </span>
        {CLUSTERS.map((c) => (
          <div key={c.tema}>
            <p className="font-display text-[18px] font-semibold text-[var(--ag-text)] mb-2">{c.tema}</p>
            <ul className="flex flex-col">
              {c.artigos.map((a, i) => (
                <li
                  key={a.titulo}
                  className="flex items-center gap-3 py-2.5"
                  style={i ? { borderTop: '1px solid var(--ag-hairline)' } : undefined}
                >
                  <span className="w-12 shrink-0 text-[12px] tabular-nums text-[var(--ag-text-3)]">{a.data}</span>
                  <span className={`flex-1 min-w-0 text-[14px] leading-snug text-[var(--ag-text)] ${a.principal ? 'font-semibold' : ''}`}>{a.titulo}</span>
                  <span className="hidden sm:inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] font-semibold" style={STATUS[a.status].estilo}>
                    {a.status === 'publicado' && <Check className="w-3 h-3" />}
                    {STATUS[a.status].rotulo}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Peça curta para o hero de cada página de objetivo: o resultado, não o processo. */
export function HeroObjetivo({ objetivo }: { objetivo: Objetivo }) {
  if (objetivo === 'meli') {
    return (
      <div className="ag-glass-strong ag-sheen rounded-[30px] p-5 sm:p-6 flex flex-col gap-4 max-w-[480px] lg:ml-auto">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-medium text-[var(--ag-text-2)]">Proposta para o seu anúncio</span>
          <span className="flex items-baseline gap-1.5 tabular-nums">
            <span className="text-[15px] font-semibold" style={{ color: 'var(--ag-danger)' }}>54</span>
            <span className="text-[var(--ag-text-3)]">→</span>
            <span className="font-display text-[28px] font-semibold leading-none" style={{ color: 'var(--ag-ok)' }}>91</span>
          </span>
        </div>
        <p className="text-[14px] text-[var(--ag-text-3)] line-through">Mochila Notebook Preta</p>
        <p className="text-[17px] font-semibold leading-snug text-[var(--ag-text)]">Mochila Notebook 15,6 Urban 25L Impermeável com USB Preta</p>
        <Medidor valor={18} total={18} rotulo="Ficha técnica" />
        <Medidor valor={5} total={6} rotulo="Fotos" />
        <p className="flex items-center gap-2 text-[13.5px] text-[var(--ag-text)]"><Video className="w-4 h-4" style={{ color: 'var(--ag-asp-video)' }} /> Vídeo vinculado ao anúncio</p>
        <span className="min-h-[44px] rounded-full grid place-items-center text-[14px] font-semibold text-white" style={{ background: 'var(--ag-accent)' }} aria-hidden>
          Aprovar e publicar
        </span>
      </div>
    );
  }
  if (objetivo === 'conteudo') {
    const artigos = CLUSTERS.flatMap((c) => c.artigos).slice(0, 4);
    return (
      <div className="ag-glass-strong ag-sheen rounded-[30px] p-5 sm:p-6 max-w-[480px] lg:ml-auto">
        <p className="text-[13px] font-medium text-[var(--ag-text-2)]">Calendário do blog</p>
        <ul className="mt-3 flex flex-col">
          {artigos.map((a, i) => (
            <li key={a.titulo} className="flex items-center gap-3 py-3" style={i ? { borderTop: '1px solid var(--ag-hairline)' } : undefined}>
              <span className="w-12 shrink-0 text-[12px] tabular-nums text-[var(--ag-text-3)]">{a.data}</span>
              <span className="flex-1 min-w-0 text-[14.5px] leading-snug text-[var(--ag-text)]">{a.titulo}</span>
              <span className="shrink-0 w-2.5 h-2.5 rounded-full" title={STATUS[a.status].rotulo} style={{ background: STATUS[a.status].estilo.color as string }} />
            </li>
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap gap-3 text-[12px] text-[var(--ag-text-2)]">
          {(Object.keys(STATUS) as StatusArtigo[]).map((s) => (
            <span key={s} className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ background: STATUS[s].estilo.color as string }} />
              {STATUS[s].rotulo}
            </span>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="relative max-w-[480px] lg:ml-auto">
      <img src={ambiente2} alt="Tênis preto de cano alto em uso, foto ambientada gerada pelo Alfred" className="w-full aspect-[4/5] object-cover rounded-[30px]" style={{ boxShadow: 'var(--ag-shadow-lg)' }} />
      <div className="ag-glass-strong ag-sheen absolute left-4 right-4 bottom-4 rounded-[22px] p-4">
        <p className="text-[12px] font-medium" style={{ color: 'var(--ag-accent)' }}>Descrição gerada</p>
        <p className="mt-1 text-[15px] font-semibold text-[var(--ag-text)]">Tênis Cano Alto de Lona Preto com Solado de Borracha</p>
        <p className="mt-1 text-[13.5px] leading-snug text-[var(--ag-text-2)]">O clássico de cano alto que vai da bermuda ao jeans sem esforço…</p>
      </div>
    </div>
  );
}
