import React, { useState, useEffect, useRef } from 'react';
import {
  Video, Image as ImageIcon, Sparkles, RefreshCw, CheckCircle2,
  AlertCircle, Loader2, Download, Play, ChevronRight, Info,
} from 'lucide-react';
import type { Product } from '../../types/models';
import {
  generateVideoScript, startVideoJob, listenVideoJob,
  type VideoScript, type VideoJob,
} from '../../services/videoService';

export interface VideoGenerationTabProps {
  product: Product;
  uid: string;
  getIdToken: () => Promise<string>;
  onVideoGenerated: (productId: string, videoUrl: string, jobId: string) => void;
  onVideoJobStarted?: (productId: string, jobId: string) => void;
  onNavigateToTab: (tab: 'imagem' | 'ia') => void;
  activeVideoProductId?: string;
}

type Stage = 'prereqs' | 'select-image' | 'script' | 'generate';

// Shot keys of VideoScript that carry an { acao, narracao } pair, in screen order.
type ShotKey = 'inicio' | 'meioDemonstracao' | 'meioBeneficios' | 'fim';

const SHOT_FIELDS: Array<{
  key: ShotKey; title: string; badge: string; acaoHint: string; narracaoHint: string;
}> = [
  {
    key: 'inicio', title: 'Início — Hook (0–8s)', badge: 'Início',
    acaoHint: 'Gancho que prende a atenção + apresentação do produto',
    narracaoHint: 'Frase de abertura comercial citando um atributo',
  },
  {
    key: 'meioDemonstracao', title: 'Meio — Demonstração (8–16s)', badge: 'Meio',
    acaoHint: 'Produto em uso real / funcionamento, manipulação rica',
    narracaoHint: 'Explica o que o produto faz / como se usa',
  },
  {
    key: 'meioBeneficios', title: 'Meio — Benefícios (16–24s)', badge: 'Meio',
    acaoHint: 'Close-ups destacando 2–3 atributos e benefícios',
    narracaoHint: 'Reforça atributos/benefícios reais do produto',
  },
  {
    key: 'fim', title: 'Fim — Fechamento (24–30s)', badge: 'Fim',
    acaoHint: 'Plano de fechamento do produto / embalagem',
    narracaoHint: 'Chamada para ação curta (ex.: "Garanta o seu agora")',
  },
];

const cn = (...classes: (string | boolean | undefined)[]) => classes.filter(Boolean).join(' ');

export default function VideoGenerationTab({
  product, uid, getIdToken, onVideoGenerated, onVideoJobStarted, onNavigateToTab, activeVideoProductId,
}: VideoGenerationTabProps) {
  const hasDescription = !!product['Descrição complementar']?.trim();
  const hasSeoTitle = !!product['Título SEO']?.trim();
  const hasImages = (product._ambientImages?.length ?? 0) > 0;
  const prereqsMet = hasDescription && hasSeoTitle && hasImages;

  const allImages = [
    ...(product._selectedImage ? [{ url: product._selectedImage, label: 'Imagem Original' }] : []),
    ...(product._ambientImages ?? []).map((url, i) => ({
      url,
      label: ['Produto Ambientado', 'Produto em Uso', 'Escala e Tamanho'][i] ?? `Ambientação ${i + 1}`,
    })),
  ];

  const [stage, setStage] = useState<Stage>('prereqs');
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [script, setScript] = useState<VideoScript | null>(null);
  const [scriptLoading, setScriptLoading] = useState(false);
  const [scriptError, setScriptError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(product._videoJobId ?? null);
  const [job, setJob] = useState<VideoJob | null>(null);
  const [jobLoading, setJobLoading] = useState(false);
  const [jobError, setJobError] = useState<string | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);

  // If the product already has an active job, resume listening immediately
  useEffect(() => {
    if (!jobId) return;
    setStage('generate');
    unsubRef.current?.();
    unsubRef.current = listenVideoJob(uid, jobId, (j) => {
      setJob(j);
      if (j.status === 'done' && j.videoUrl) {
        onVideoGenerated(product._id, j.videoUrl, jobId);
      }
    });
    return () => { unsubRef.current?.(); };
  }, [jobId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Coleta atributos do produto (categoria + campos relevantes) para o roteiro.
  // O servidor seleciona os 2–3 mais relevantes para citar no vídeo.
  function collectAttributes(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, attr] of Object.entries(product.attributes ?? {})) {
      const raw = Array.isArray(attr?.value) ? attr.value.join(', ') : attr?.value;
      const val = (raw ?? '').toString().trim();
      if (val) out[key] = val;
    }
    // Campos da planilha que ajudam a descrever o produto no vídeo
    const extras: Array<[string, unknown]> = [
      ['Tipo do produto', product['Tipo do produto']],
      ['Garantia', product['Garantia']],
    ];
    for (const [label, value] of extras) {
      const val = (value ?? '').toString().trim();
      if (val && !(label in out)) out[label] = val;
    }
    return out;
  }

  async function handleGenerateScript() {
    if (!selectedImage) return;
    setScriptLoading(true);
    setScriptError(null);
    try {
      const token = await getIdToken();
      const result = await generateVideoScript(token, {
        description: product['Descrição complementar'] ?? product['Descrição'] ?? '',
        brand: product['Marca'] ?? '',
        imageUrl: selectedImage,
        productName: product['Título SEO'] ?? product['Descrição'] ?? '',
        category: product['Categoria'] ?? (product.categoryPath?.join(' > ') ?? ''),
        attributes: collectAttributes(),
      });
      setScript(result);
      setStage('script');
    } catch (err) {
      setScriptError(err instanceof Error ? err.message : 'Erro ao gerar roteiro');
    } finally {
      setScriptLoading(false);
    }
  }

  async function handleStartJob() {
    if (!script || !selectedImage) return;
    setJobLoading(true);
    setJobError(null);
    try {
      const token = await getIdToken();
      const id = await startVideoJob(token, {
        productId: product._id,
        productName: product['Descrição'] ?? product._id,
        script,
        imageUrl: selectedImage,
      });
      setJobId(id);
      onVideoJobStarted?.(product._id, id);
      setStage('generate');
    } catch (err) {
      setJobError(err instanceof Error ? err.message : 'Erro ao iniciar geração');
      setJobLoading(false);
    }
  }

  const stageLabels: Record<Stage, string> = {
    'prereqs': 'Pré-requisitos',
    'select-image': 'Imagem',
    'script': 'Roteiro',
    'generate': 'Gerar Vídeo',
  };
  const stageOrder: Stage[] = ['prereqs', 'select-image', 'script', 'generate'];

  const anotherVideoActive = activeVideoProductId && activeVideoProductId !== product._id && !product._videoJobId;

  if (anotherVideoActive) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center gap-4 animate-in fade-in duration-300">
        <div className="w-14 h-14 bg-violet-100 rounded-2xl flex items-center justify-center">
          <Video className="w-7 h-7 text-violet-500" />
        </div>
        <div className="max-w-sm">
          <p className="font-bold text-slate-800 text-lg mb-2">Vídeo em produção</p>
          <p className="text-sm text-slate-500 leading-relaxed">
            Já estamos com um vídeo em produção. Aguarde a conclusão para iniciar a produção de outro vídeo.
          </p>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 bg-violet-50 rounded-xl text-sm text-violet-700 font-medium">
          <div className="w-2 h-2 rounded-full bg-violet-500 animate-pulse" />
          Processando no servidor
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-300">

      {/* Stage progress indicator */}
      <div className="flex items-center gap-2 text-sm flex-wrap">
        {stageOrder.map((s, i) => {
          const active = stage === s;
          const done = stageOrder.indexOf(stage) > i;
          return (
            <React.Fragment key={s}>
              <span className={cn(
                'px-3 py-1 rounded-full text-xs font-bold transition-all',
                active && 'bg-violet-600 text-white',
                done && 'bg-green-100 text-green-700',
                !active && !done && 'bg-slate-100 text-slate-400',
              )}>
                {done ? '✓ ' : `${i + 1}. `}{stageLabels[s]}
              </span>
              {i < stageOrder.length - 1 && <ChevronRight className="w-3 h-3 text-slate-300 shrink-0" />}
            </React.Fragment>
          );
        })}
      </div>

      {/* Stage 1: Prerequisites */}
      {stage === 'prereqs' && (
        <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <h2 className="text-lg font-bold text-slate-900 mb-2 flex items-center gap-2">
            <Video className="w-5 h-5 text-violet-600" />
            Gerar Vídeo com IA
            <span className="px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 text-xs font-bold uppercase tracking-wide">
              Beta
            </span>
          </h2>
          <p className="text-sm text-slate-500 mb-6 leading-relaxed">
            Para gerar um vídeo de qualidade com interação humana e roteiro cinematográfico,
            o produto precisa ter as informações abaixo preenchidas.
          </p>

          <div className="space-y-3 mb-6">
            <PrereqItem
              ok={hasDescription}
              label="Descrição complementar gerada"
              onFix={() => onNavigateToTab('ia')}
              fixLabel="Ir para IA"
            />
            <PrereqItem
              ok={hasSeoTitle}
              label="Título SEO preenchido"
              onFix={() => onNavigateToTab('ia')}
              fixLabel="Ir para IA"
            />
            <PrereqItem
              ok={hasImages}
              label="Imagens ambientadas geradas (mínimo 1)"
              onFix={() => onNavigateToTab('imagem')}
              fixLabel="Ir para Imagens"
            />
          </div>

          {!prereqsMet && (
            <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800 mb-6">
              <Info className="w-4 h-4 mt-0.5 shrink-0" />
              <span>Preencha os itens marcados acima para desbloquear a geração de vídeo. Quanto mais completo o produto, melhor será o vídeo gerado.</span>
            </div>
          )}

          <button
            onClick={() => setStage('select-image')}
            disabled={!prereqsMet}
            className="px-6 py-3 bg-gradient-to-r from-violet-600 to-purple-600 text-white rounded-xl text-sm font-bold transition-all shadow-md hover:shadow-lg hover:-translate-y-0.5 flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-md active:scale-95"
          >
            <ChevronRight className="w-4 h-4" />
            Próximo: Escolher Imagem
          </button>
        </section>
      )}

      {/* Stage 2: Image selection */}
      {stage === 'select-image' && (
        <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <h2 className="text-lg font-bold text-slate-900 mb-2 flex items-center gap-2">
            <ImageIcon className="w-5 h-5 text-violet-600" />
            Escolha a imagem base do vídeo
          </h2>
          <p className="text-sm text-slate-500 mb-6">
            Esta imagem será o ponto de partida do vídeo. Ela será automaticamente recortada no formato vertical (9:16)
            para corresponder ao vídeo gerado. Imagens ambientadas tendem a produzir vídeos mais naturais.
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            {allImages.map(({ url, label }) => (
              <button
                key={url}
                type="button"
                onClick={() => setSelectedImage(url)}
                className={cn(
                  'relative aspect-square rounded-xl overflow-hidden border-2 transition-all group text-left',
                  selectedImage === url
                    ? 'border-violet-500 ring-2 ring-violet-300 scale-[1.02]'
                    : 'border-slate-200 hover:border-violet-300',
                )}
              >
                <img src={url} alt={label} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                <div className={cn(
                  'absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent py-2 px-2 transition-opacity',
                  selectedImage === url ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                )}>
                  <span className="text-white text-xs font-bold leading-tight block">{label}</span>
                </div>
                {selectedImage === url && (
                  <div className="absolute top-2 right-2 w-5 h-5 bg-violet-600 rounded-full flex items-center justify-center shadow">
                    <CheckCircle2 className="w-3 h-3 text-white" />
                  </div>
                )}
              </button>
            ))}
          </div>

          <div className="flex gap-3 flex-wrap">
            <button
              type="button"
              onClick={() => setStage('prereqs')}
              className="px-4 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm font-bold hover:bg-slate-50 transition-all"
            >
              Voltar
            </button>
            <button
              type="button"
              onClick={handleGenerateScript}
              disabled={!selectedImage || scriptLoading}
              className="px-6 py-2.5 bg-gradient-to-r from-violet-600 to-purple-600 text-white rounded-xl text-sm font-bold transition-all shadow-md hover:shadow-lg hover:-translate-y-0.5 flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed active:scale-95"
            >
              {scriptLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {scriptLoading ? 'Gerando roteiro...' : 'Gerar Roteiro com IA'}
            </button>
          </div>
          {scriptError && (
            <p className="mt-3 text-sm text-red-600 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" /> {scriptError}
            </p>
          )}
        </section>
      )}

      {/* Stage 3: Script review */}
      {stage === 'script' && script && (
        <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <h2 className="text-lg font-bold text-slate-900 mb-2 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-violet-600" />
            Roteiro gerado pela IA
          </h2>
          <p className="text-sm text-slate-500 mb-6 leading-relaxed">
            Revise e edite o roteiro antes de gerar o vídeo vertical (9:16) de ~30 segundos,
            com estrutura <strong>Início → Meio → Fim</strong>. A narração é uma locução em off
            (voz por cima) com música de fundo — não há ninguém falando na tela.
          </p>

          <div className="space-y-6 mb-6">
            <div className="grid sm:grid-cols-2 gap-4">
              <ScriptField
                label="Cena / Contexto visual"
                hint="Ambientação vertical comum a todos os trechos"
                value={script.cena}
                onChange={(v) => setScript({ ...script, cena: v })}
              />
              <ScriptField
                label="Trilha sonora (mood)"
                hint="Clima da música de fundo (ex.: moderna, leve)"
                value={script.trilha}
                onChange={(v) => setScript({ ...script, trilha: v })}
              />
            </div>

            {SHOT_FIELDS.map(({ key, title, badge, acaoHint, narracaoHint }) => (
              <div key={key} className="rounded-xl border border-slate-200 p-4 bg-slate-50/60">
                <div className="flex items-center gap-2 mb-3">
                  <span className="px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 text-[11px] font-bold uppercase tracking-wide">
                    {badge}
                  </span>
                  <h3 className="text-sm font-bold text-slate-800">{title}</h3>
                </div>
                <div className="space-y-3">
                  <ScriptField
                    label="Ação / Imagem"
                    hint={acaoHint}
                    value={script[key].acao}
                    onChange={(v) => setScript({ ...script, [key]: { ...script[key], acao: v } })}
                  />
                  <ScriptField
                    label="Narração (voz em off)"
                    hint={narracaoHint}
                    value={script[key].narracao}
                    onChange={(v) => setScript({ ...script, [key]: { ...script[key], narracao: v } })}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="flex gap-3 flex-wrap">
            <button
              type="button"
              onClick={handleGenerateScript}
              disabled={scriptLoading}
              className="px-4 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm font-bold hover:bg-slate-50 transition-all flex items-center gap-2 disabled:opacity-40"
            >
              {scriptLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Regenerar Roteiro
            </button>
            <button
              type="button"
              onClick={handleStartJob}
              disabled={jobLoading}
              className="px-6 py-2.5 bg-gradient-to-r from-violet-600 to-purple-600 text-white rounded-xl text-sm font-bold transition-all shadow-md hover:shadow-lg hover:-translate-y-0.5 flex items-center gap-2 disabled:opacity-40 active:scale-95"
            >
              {jobLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              {jobLoading ? 'Iniciando...' : 'Aprovar e Gerar Vídeo'}
            </button>
          </div>
          {jobError && (
            <p className="mt-3 text-sm text-red-600 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" /> {jobError}
            </p>
          )}
        </section>
      )}

      {/* Stage 4: Generation status + player */}
      {stage === 'generate' && (
        <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <h2 className="text-lg font-bold text-slate-900 mb-6 flex items-center gap-2">
            <Video className="w-5 h-5 text-violet-600" />
            Geração de Vídeo
          </h2>

          {(!job || job.status === 'queued' || job.status === 'processing') && (
            <div className="flex flex-col items-center py-12 gap-6 text-center">
              <div className="relative w-16 h-16">
                <div className="absolute inset-0 rounded-full border-4 border-violet-100" />
                <div className="absolute inset-0 rounded-full border-4 border-violet-600 border-t-transparent animate-spin" />
                <Video className="absolute inset-0 m-auto w-6 h-6 text-violet-600" />
              </div>
              <div>
                <p className="font-bold text-slate-800 text-lg mb-1">
                  {job?.status === 'processing' ? 'Gerando seu vídeo...' : 'Na fila de processamento...'}
                </p>
                <p className="text-sm text-slate-500 max-w-sm mx-auto leading-relaxed">
                  O Veo 3.1 está gerando o vídeo vertical de ~30s em 4 trechos (Início, Meio e Fim) e montando a narração + música. Esse processo pode levar de 10 a 20 minutos.
                  Você pode fechar essa janela — o vídeo ficará disponível aqui quando pronto.
                </p>
              </div>
              <div className="flex items-center gap-2 px-4 py-2 bg-violet-50 rounded-xl text-sm text-violet-700 font-medium">
                <div className="w-2 h-2 rounded-full bg-violet-500 animate-pulse" />
                {job?.status === 'processing' ? 'Processando no servidor' : 'Aguardando processamento'}
              </div>
            </div>
          )}

          {job?.status === 'done' && job.videoUrl && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-green-700 bg-green-50 px-4 py-3 rounded-xl text-sm font-bold border border-green-200">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                Vídeo gerado com sucesso!
              </div>
              <div className="rounded-2xl overflow-hidden border border-slate-200 shadow-sm bg-black">
                <video
                  src={job.videoUrl}
                  controls
                  className="w-full max-h-[480px] object-contain"
                  poster={selectedImage ?? undefined}
                />
              </div>
              <div className="flex gap-3 flex-wrap">
                <a
                  href={job.videoUrl}
                  download={`video_produto_${product._id}.mp4`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-5 py-2.5 border border-slate-200 text-slate-700 rounded-xl text-sm font-bold hover:bg-slate-50 transition-all flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  Baixar Vídeo
                </a>
                <button
                  type="button"
                  onClick={() => {
                    setStage('select-image');
                    setJob(null);
                    setJobId(null);
                    setScript(null);
                    setSelectedImage(null);
                    setJobLoading(false);
                  }}
                  className="px-5 py-2.5 border border-violet-200 text-violet-700 rounded-xl text-sm font-bold hover:bg-violet-50 transition-all flex items-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" />
                  Gerar Novo Vídeo
                </button>
              </div>
            </div>
          )}

          {job?.status === 'error' && (
            <div className="space-y-4">
              <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-800">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <div>
                  <p className="font-bold mb-1">Falha na geração do vídeo</p>
                  <p>{job.error ?? 'Erro desconhecido'}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setStage('select-image');
                  setJob(null);
                  setJobId(null);
                  setJobLoading(false);
                }}
                className="px-5 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm font-bold hover:bg-slate-50 transition-all flex items-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                Tentar Novamente
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function PrereqItem({ ok, label, onFix, fixLabel }: {
  ok: boolean; label: string; onFix: () => void; fixLabel: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 p-3 bg-slate-50 rounded-xl border border-slate-100">
      <div className="flex items-center gap-3">
        {ok
          ? <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
          : <AlertCircle className="w-5 h-5 text-amber-500 shrink-0" />}
        <span className={cn('text-sm font-medium', ok ? 'text-slate-700' : 'text-slate-600')}>
          {label}
        </span>
      </div>
      {!ok && (
        <button
          type="button"
          onClick={onFix}
          className="shrink-0 text-xs font-bold text-violet-600 hover:text-violet-800 underline underline-offset-2 transition-colors"
        >
          {fixLabel}
        </button>
      )}
    </div>
  );
}

function ScriptField({ label, hint, value, onChange }: {
  label: string; hint: string; value: string; onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div>
        <label className="text-sm font-bold text-slate-800">{label}</label>
        <p className="text-xs text-slate-400">{hint}</p>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-800 resize-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 outline-none transition-all"
      />
    </div>
  );
}
