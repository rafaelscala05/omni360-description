// src/components/modals/UgcVideoGenerationTab.tsx
import React, { useState, useEffect, useRef } from 'react';
import {
  Video, Sparkles, RefreshCw, CheckCircle2, AlertCircle, Loader2, Download, Play, ChevronRight, Users,
} from 'lucide-react';
import type { Product, Avatar } from '../../types/models';
import {
  generateUgcVideoScript, startUgcVideoJob, listenUgcVideoJob, computeUgcVideoProgress,
  type UgcVideoScript, type UgcVideoJob,
} from '../../services/ugcVideoService';
import { cn, PrereqItem } from './videoWizardShared';
import AvatarLibrary from './AvatarLibrary';
import type { CreditAction } from '../../credits';

export interface UgcVideoGenerationTabProps {
  product: Product;
  uid: string;
  getIdToken: () => Promise<string>;
  onUgcVideoGenerated: (productId: string, videoUrl: string, jobId: string) => void;
  onUgcVideoJobStarted?: (productId: string, jobId: string, avatarId: string) => void;
  onUgcVideoFailed?: (productId: string) => void;
  onNavigateToTab: (tab: 'imagem' | 'ia') => void;
  activeVideoProductId?: string;
  ensureCredits: (action: CreditAction) => boolean;
  consumeCredit: (action: CreditAction, productName?: string) => Promise<boolean>;
}

type Stage = 'prereqs' | 'select-avatar' | 'script' | 'generate';

const ROLE_LABELS: Record<UgcVideoScript['clipes'][number]['papel'], string> = {
  gancho: 'Gancho',
  demonstracao: 'Demonstração',
  cta: 'Fechamento (CTA)',
};

export default function UgcVideoGenerationTab({
  product, uid, getIdToken, onUgcVideoGenerated, onUgcVideoJobStarted, onUgcVideoFailed, onNavigateToTab,
  activeVideoProductId, ensureCredits, consumeCredit,
}: UgcVideoGenerationTabProps) {
  const hasDescription = !!product['Descrição complementar']?.trim();
  const hasSeoTitle = !!product['Título SEO']?.trim();
  const hasImages = (product._ambientImages?.length ?? 0) > 0;
  const prereqsMet = hasDescription && hasSeoTitle && hasImages;

  const [stage, setStage] = useState<Stage>('prereqs');
  const [avatar, setAvatar] = useState<Avatar | null>(null);
  const [script, setScript] = useState<UgcVideoScript | null>(null);
  const [scriptLoading, setScriptLoading] = useState(false);
  const [scriptError, setScriptError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(product._ugcVideoJobId ?? null);
  const [job, setJob] = useState<UgcVideoJob | null>(null);
  const [jobLoading, setJobLoading] = useState(false);
  const [jobError, setJobError] = useState<string | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!jobId) return;
    setStage('generate');
    unsubRef.current?.();
    unsubRef.current = listenUgcVideoJob(uid, jobId, (j) => {
      setJob(j);
      if (j.status === 'done' && j.videoUrl) {
        onUgcVideoGenerated(product._id, j.videoUrl, jobId);
      }
      if (j.status === 'error') {
        onUgcVideoFailed?.(product._id);
      }
    });
    return () => { unsubRef.current?.(); };
  }, [jobId]); // eslint-disable-line react-hooks/exhaustive-deps

  function collectAttributes(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, attr] of Object.entries(product.attributes ?? {})) {
      const raw = Array.isArray(attr?.value) ? attr.value.join(', ') : attr?.value;
      const val = (raw ?? '').toString().trim();
      if (val) out[key] = val;
    }
    return out;
  }

  // Review Focus: switching avatars after a script was already generated must
  // invalidate the stale script (it was built from the previous avatar's
  // description) instead of silently letting it be submitted.
  function handleSelectAvatar(a: Avatar) {
    setAvatar(a);
    setScript(null);
  }

  async function handleGenerateScript() {
    if (!avatar) return;
    const productImage = product._selectedImage ?? product._ambientImages?.[0] ?? null;
    if (!productImage) return;
    setScriptLoading(true);
    setScriptError(null);
    try {
      const token = await getIdToken();
      const result = await generateUgcVideoScript(token, {
        description: product['Descrição complementar'] ?? product['Descrição'] ?? '',
        brand: product['Marca'] ?? '',
        productImageUrl: productImage,
        avatarImageUrl: avatar.referenceImageUrl,
        avatarDescricao: avatar.descricao,
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
    if (!script || !avatar) return;
    const productImage = product._selectedImage ?? product._ambientImages?.[0] ?? null;
    if (!productImage) return;
    setJobLoading(true);
    setJobError(null);
    try {
      const token = await getIdToken();
      const id = await startUgcVideoJob(token, {
        productId: product._id,
        productName: product['Descrição'] ?? product._id,
        script,
        avatarImageUrl: avatar.referenceImageUrl,
        productImageUrl: productImage,
      });
      setJobId(id);
      onUgcVideoJobStarted?.(product._id, id, avatar.id);
      setStage('generate');
    } catch (err) {
      setJobError(err instanceof Error ? err.message : 'Erro ao iniciar geração');
      setJobLoading(false);
    }
  }

  const stageLabels: Record<Stage, string> = {
    'prereqs': 'Pré-requisitos',
    'select-avatar': 'Avatar',
    'script': 'Roteiro',
    'generate': 'Gerar Vídeo',
  };
  const stageOrder: Stage[] = ['prereqs', 'select-avatar', 'script', 'generate'];

  const anotherVideoActive = activeVideoProductId && activeVideoProductId !== product._id && !product._ugcVideoJobId;

  if (anotherVideoActive) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center gap-4 animate-in fade-in duration-300">
        <div className="w-14 h-14 bg-violet-100 rounded-2xl flex items-center justify-center">
          <Video className="w-7 h-7 text-violet-500" />
        </div>
        <div className="max-w-sm">
          <p className="font-bold text-slate-800 text-lg mb-2">Vídeo em produção</p>
          <p className="text-sm text-slate-500 leading-relaxed">
            Já estamos com um vídeo UGC em produção. Aguarde a conclusão para iniciar outro.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-300">
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

      {stage === 'prereqs' && (
        <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <h2 className="text-lg font-bold text-slate-900 mb-2 flex items-center gap-2">
            <Users className="w-5 h-5 text-violet-600" />
            Vídeo UGC com Avatar
            <span className="px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 text-xs font-bold uppercase tracking-wide">Beta</span>
          </h2>
          <p className="text-sm text-slate-500 mb-6 leading-relaxed">
            Um avatar seu (ou criado por você) fala para a câmera e interage com o produto. Precisa das mesmas informações do vídeo clássico.
          </p>

          <div className="space-y-3 mb-6">
            <PrereqItem ok={hasDescription} label="Descrição complementar gerada" onFix={() => onNavigateToTab('ia')} fixLabel="Ir para IA" />
            <PrereqItem ok={hasSeoTitle} label="Título SEO preenchido" onFix={() => onNavigateToTab('ia')} fixLabel="Ir para IA" />
            <PrereqItem ok={hasImages} label="Imagens ambientadas geradas (mínimo 1)" onFix={() => onNavigateToTab('imagem')} fixLabel="Ir para Imagens" />
          </div>

          <button
            onClick={() => setStage('select-avatar')}
            disabled={!prereqsMet}
            className="px-6 py-3 bg-gradient-to-r from-violet-600 to-purple-600 text-white rounded-xl text-sm font-bold transition-all shadow-md hover:shadow-lg hover:-translate-y-0.5 flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed active:scale-95"
          >
            <ChevronRight className="w-4 h-4" />
            Próximo: Escolher Avatar
          </button>
        </section>
      )}

      {stage === 'select-avatar' && (
        <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <h2 className="text-lg font-bold text-slate-900 mb-2 flex items-center gap-2">
            <Users className="w-5 h-5 text-violet-600" />
            Escolha o avatar
          </h2>
          <p className="text-sm text-slate-500 mb-6">Selecione um avatar salvo ou crie um novo. Ele reaparece nos próximos vídeos.</p>

          <AvatarLibrary uid={uid} selectedAvatarId={avatar?.id} onSelect={handleSelectAvatar} ensureCredits={ensureCredits} consumeCredit={consumeCredit} />

          <div className="flex gap-3 flex-wrap mt-6">
            <button type="button" onClick={() => setStage('prereqs')} className="px-4 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm font-bold hover:bg-slate-50">
              Voltar
            </button>
            <button
              type="button"
              onClick={handleGenerateScript}
              disabled={!avatar || scriptLoading}
              className="px-6 py-2.5 bg-gradient-to-r from-violet-600 to-purple-600 text-white rounded-xl text-sm font-bold shadow-md disabled:opacity-40 flex items-center gap-2"
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

      {stage === 'script' && script && (
        <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <h2 className="text-lg font-bold text-slate-900 mb-2 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-violet-600" />
            Roteiro UGC gerado pela IA
          </h2>
          <p className="text-sm text-slate-500 mb-6 leading-relaxed">
            Revise e edite as falas antes de gerar o vídeo. O avatar fala olhando para a câmera — o áudio vem embutido em cada clipe.
          </p>

          <div className="space-y-6 mb-6">
            <div className="space-y-1.5">
              <label className="text-sm font-bold text-slate-800">Cena / Contexto visual</label>
              <textarea
                value={script.cena}
                onChange={(e) => setScript({ ...script, cena: e.target.value })}
                rows={2}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-800 resize-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 outline-none"
              />
            </div>

            {script.clipes.map((clip, i) => (
              <div key={i} className="rounded-xl border border-slate-200 p-4 bg-slate-50/60">
                <div className="flex items-center gap-2 mb-3">
                  <span className="px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 text-[11px] font-bold uppercase tracking-wide">
                    {ROLE_LABELS[clip.papel]}
                  </span>
                </div>
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <label className="text-sm font-bold text-slate-800">Fala do avatar</label>
                    <textarea
                      value={clip.fala}
                      onChange={(e) => {
                        const clipes = [...script.clipes];
                        clipes[i] = { ...clip, fala: e.target.value };
                        setScript({ ...script, clipes });
                      }}
                      rows={2}
                      className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 resize-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 outline-none"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-bold text-slate-800">Ação visual</label>
                    <textarea
                      value={clip.acaoVisual}
                      onChange={(e) => {
                        const clipes = [...script.clipes];
                        clipes[i] = { ...clip, acaoVisual: e.target.value };
                        setScript({ ...script, clipes });
                      }}
                      rows={2}
                      className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 resize-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 outline-none"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex gap-3 flex-wrap">
            <button type="button" onClick={() => setStage('select-avatar')} className="px-4 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm font-bold hover:bg-slate-50">
              Voltar
            </button>
            <button type="button" onClick={handleGenerateScript} disabled={scriptLoading} className="px-4 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm font-bold hover:bg-slate-50 flex items-center gap-2 disabled:opacity-40">
              {scriptLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Regenerar Roteiro
            </button>
            <button type="button" onClick={handleStartJob} disabled={jobLoading} className="px-6 py-2.5 bg-gradient-to-r from-violet-600 to-purple-600 text-white rounded-xl text-sm font-bold shadow-md flex items-center gap-2 disabled:opacity-40">
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

      {stage === 'generate' && (
        <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <h2 className="text-lg font-bold text-slate-900 mb-6 flex items-center gap-2">
            <Video className="w-5 h-5 text-violet-600" />
            Geração de Vídeo UGC
          </h2>

          {(!job || job.status === 'queued' || job.status === 'processing') && (
            <UgcVideoProgressDisplay job={job ?? null} />
          )}

          {job?.status === 'done' && job.videoUrl && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-green-700 bg-green-50 px-4 py-3 rounded-xl text-sm font-bold border border-green-200">
                <CheckCircle2 className="w-4 h-4 shrink-0" /> Vídeo gerado com sucesso!
              </div>
              <div className="rounded-2xl overflow-hidden border border-slate-200 shadow-sm bg-black">
                <video src={job.videoUrl} controls className="w-full max-h-[480px] object-contain" />
              </div>
              <div className="flex gap-3 flex-wrap">
                <a href={job.videoUrl} download={`video_ugc_${product._id}.mp4`} target="_blank" rel="noopener noreferrer" className="px-5 py-2.5 border border-slate-200 text-slate-700 rounded-xl text-sm font-bold hover:bg-slate-50 flex items-center gap-2">
                  <Download className="w-4 h-4" /> Baixar Vídeo
                </a>
                <button
                  type="button"
                  onClick={() => { setStage('select-avatar'); setJob(null); setJobId(null); setScript(null); setJobLoading(false); }}
                  className="px-5 py-2.5 border border-violet-200 text-violet-700 rounded-xl text-sm font-bold hover:bg-violet-50 flex items-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" /> Gerar Novo Vídeo
                </button>
              </div>
            </div>
          )}

          {job?.status === 'error' && (
            <div className="space-y-4">
              <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-800">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <div><p className="font-bold mb-1">Falha na geração do vídeo</p><p>{job.error ?? 'Erro desconhecido'}</p></div>
              </div>
              <button type="button" onClick={() => { setStage('select-avatar'); setJob(null); setJobId(null); setJobLoading(false); }} className="px-5 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm font-bold hover:bg-slate-50 flex items-center gap-2">
                <RefreshCw className="w-4 h-4" /> Tentar Novamente
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function UgcVideoProgressDisplay({ job }: { job: UgcVideoJob | null }) {
  const { pct, label } = computeUgcVideoProgress(job);
  const total = job?.totalClips ?? 3;
  const done = job?.clipsDone ?? 0;
  const isClip = !job?.step || job?.step === 'clip';

  return (
    <div className="flex flex-col items-center py-10 gap-6 text-center">
      <div className="relative w-16 h-16">
        <div className="absolute inset-0 rounded-full border-4 border-violet-100" />
        <div className="absolute inset-0 rounded-full border-4 border-violet-600 border-t-transparent animate-spin" />
        <Video className="absolute inset-0 m-auto w-6 h-6 text-violet-600" />
      </div>
      <div className="w-full max-w-sm space-y-3">
        <p className="font-bold text-slate-800 text-lg">{job?.status === 'processing' ? 'Gerando seu vídeo UGC...' : 'Na fila de processamento...'}</p>
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-slate-500 font-medium">
            <span>{label}</span><span>{pct}%</span>
          </div>
          <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
            <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-purple-500 transition-all duration-700" style={{ width: `${pct}%` }} />
          </div>
        </div>
        {isClip && job?.status === 'processing' && (
          <div className="flex justify-center gap-2 pt-1">
            {Array.from({ length: total }).map((_, i) => (
              <div key={i} className={cn('w-2.5 h-2.5 rounded-full transition-all', i < done ? 'bg-violet-500' : 'bg-violet-300 animate-pulse')} />
            ))}
          </div>
        )}
        <p className="text-xs text-slate-400 leading-relaxed">
          O Veo 3.1 gera os clipes em paralelo, com o avatar falando. Esse processo geralmente leva de 2 a 4 minutos.
        </p>
      </div>
    </div>
  );
}
