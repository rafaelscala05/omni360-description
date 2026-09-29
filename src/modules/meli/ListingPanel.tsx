import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle, CheckCircle2, ChevronDown, CircleAlert, CircleDashed, ExternalLink, Image as ImageIcon, Loader2,
  MessageCircleQuestion, Pencil, Sparkles, TriangleAlert, Video, WandSparkles, X,
} from 'lucide-react';
import {
  createMeliProposal, createMeliRollbackProposal, editMeliProposalChange, generateMeliPicture, getLatestMeliAnalysis,
  getLatestMeliProposal, getMeliFacts, getMeliListingMedia, getMeliMutationRun, publishMeliProposal, saveMeliFacts, startMeliAnalysis,
  type MeliListingMedia,
  type MeliAnalysis, type MeliChecklistItem, type MeliConnection, type MeliFacts, type MeliGeneratedPictureKind,
  type MeliListing, type MeliMutationRun, type MeliPictureRole, type MeliProposalChange, type MeliProposalResult, type MeliQuestion,
} from '../../services/meliService';
import ProposalReview from './ProposalReview';
import MeliVideoStudio, { PublishClipHelp, type MeliCreditHelpers } from './MeliVideoStudio';

const terminalAnalyses = new Set(['completed', 'failed', 'stale']);
const activeRuns = new Set(['queued', 'running', 'verifying']);
const ROLE_LABEL: Record<MeliPictureRole, string> = {
  main_white_background: 'Fundo branco', lifestyle: 'Ambientada', detail: 'Detalhe', dimensions: 'Medidas',
  packaging: 'Embalagem', infographic: 'Infográfico', other: 'Outra',
};
const ANALYSIS_STEPS = [
  'Lendo anúncio, ficha técnica e regras da categoria',
  'Analisando cada foto',
  'Buscando perguntas dos compradores',
  'Escrevendo título e descrição',
  'Montando as melhorias para você aprovar',
];
const SEVERITY_LABEL = { blocked: 'Bloqueador', high: 'Alta', medium: 'Média', low: 'Baixa', info: 'Informação' } as const;

// Espera a proposta automática no máximo 2 min depois de a análise concluir;
// se o servidor caiu entre as duas gravações, a tela não fica presa.
function awaitingProposal(analysis: MeliAnalysis | null): boolean {
  if (!analysis?.proposalPending || !analysis.completedAt) return false;
  return Date.now() - new Date(analysis.completedAt).getTime() < 120_000;
}

function message(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

function ChecklistRow({ item }: { item: MeliChecklistItem }) {
  const icon = item.status === 'ok' ? <CheckCircle2 className="w-4 h-4 text-emerald-600" />
    : item.status === 'warning' ? <CircleAlert className="w-4 h-4 text-amber-500" /> : <CircleDashed className="w-4 h-4 text-red-500" />;
  return <div className="flex items-start gap-2.5 py-2"><span className="mt-0.5 shrink-0">{icon}</span><div className="min-w-0"><p className="text-sm font-semibold text-slate-800">{item.label}</p><p className="text-xs text-slate-500">{item.detail}</p></div></div>;
}

function AnalysisProgress() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setStep((current) => Math.min(ANALYSIS_STEPS.length - 1, current + 1)), 7000);
    return () => window.clearInterval(timer);
  }, []);
  return <div className="border border-blue-200 bg-blue-50/60 rounded-2xl p-5">
    <p className="text-sm font-bold text-blue-900 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Otimizando o anúncio…</p>
    <ol className="mt-3 space-y-1.5">{ANALYSIS_STEPS.map((label, index) => <li key={label} className={`text-xs flex items-center gap-2 ${index < step ? 'text-emerald-700' : index === step ? 'text-blue-800 font-semibold' : 'text-slate-400'}`}>{index < step ? <CheckCircle2 className="w-3.5 h-3.5" /> : index === step ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CircleDashed className="w-3.5 h-3.5" />}{label}</li>)}</ol>
    <p className="text-[11px] text-slate-500 mt-3">Leva cerca de um minuto. Pode fechar esta janela: a análise continua e o resultado fica salvo.</p>
  </div>;
}

function QuestionField({ question, value, onChange }: {
  question: MeliQuestion;
  value: { value: string; valueId?: string | null };
  onChange: (next: { value: string; valueId?: string | null }) => void;
}) {
  const base = 'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-blue-400';
  if (question.options?.length) {
    return <select className={base} value={value.valueId || ''} onChange={(event) => {
      const option = question.options!.find((entry) => entry.id === event.target.value);
      onChange(option ? { value: option.name, valueId: option.id } : { value: '', valueId: null });
    }}><option value="">Selecione…</option>{question.options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select>;
  }
  if (question.units?.length) {
    const match = value.value.match(/^\s*([\d.,]*)\s*(.*)$/);
    const amount = match?.[1] || '';
    const unit = match?.[2] || question.units[0];
    return <div className="flex gap-2"><input inputMode="decimal" className={base} placeholder="Valor" value={amount} onChange={(event) => onChange({ value: event.target.value ? `${event.target.value} ${unit}` : '', valueId: null })} /><select className={`${base} w-28`} value={unit} onChange={(event) => onChange({ value: amount ? `${amount} ${event.target.value}` : '', valueId: null })}>{question.units.map((entry) => <option key={entry} value={entry}>{entry}</option>)}</select></div>;
  }
  if (question.fieldPath.startsWith('description')) {
    return <textarea rows={3} className={base} placeholder="Ex.: material, medidas, o que vem na caixa, como usar…" value={value.value} onChange={(event) => onChange({ value: event.target.value, valueId: null })} />;
  }
  return <input className={base} placeholder="Sua resposta" value={value.value} onChange={(event) => onChange({ value: event.target.value, valueId: null })} />;
}

function QuestionsForm({ analysis, facts, busy, onSubmit }: {
  analysis: MeliAnalysis;
  facts: MeliFacts | null;
  busy: boolean;
  onSubmit: (answers: Record<string, { value: string; valueId?: string | null }>, regenerate: boolean) => Promise<void>;
}) {
  // Uma pergunta por campo: a mesma lacuna pode vir das regras e da IA.
  const questions = useMemo(() => {
    const byField = new Map<string, MeliQuestion>();
    analysis.questions.forEach((question) => { if (!byField.has(question.fieldPath)) byField.set(question.fieldPath, question); });
    return [...byField.values()].filter((question) => /^(attributes|sale_terms|description)\./.test(question.fieldPath));
  }, [analysis.questions]);
  const initial = () => Object.fromEntries(questions.map((question) => [question.fieldPath, {
    value: facts?.answers[question.fieldPath]?.value || '', valueId: facts?.answers[question.fieldPath]?.valueId || null,
  }]));
  const [answers, setAnswers] = useState<Record<string, { value: string; valueId?: string | null }>>(initial);
  useEffect(() => { setAnswers(initial()); }, [analysis.id, facts?.updatedAt]);
  if (!questions.length) return null;
  const answeredAfterAnalysis = Boolean(facts?.updatedAt && facts.updatedAt > analysis.createdAt);
  const dirty = questions.some((question) => (answers[question.fieldPath]?.value || '') !== (facts?.answers[question.fieldPath]?.value || ''));
  const filled = questions.filter((question) => answers[question.fieldPath]?.value.trim()).length;
  return <section className="border border-violet-200 bg-violet-50/40 rounded-2xl p-4">
    <div className="flex items-start gap-2"><MessageCircleQuestion className="w-5 h-5 text-violet-600 shrink-0" /><div><h3 className="text-sm font-black text-slate-900">Complete o que só você sabe</h3><p className="text-xs text-slate-600 mt-0.5">A IA não inventa dados do produto. Com as suas respostas ela completa a ficha técnica e escreve título e descrição mais completos.</p></div></div>
    <div className="mt-3 space-y-3">{questions.map((question) => <div key={question.fieldPath}>
      <label className="text-xs font-semibold text-slate-700">{question.label && !question.fieldPath.startsWith('description') ? question.label : 'Informações para a descrição'}</label>
      <p className="text-[11px] text-slate-500 mb-1">{question.question}</p>
      <QuestionField question={question} value={answers[question.fieldPath] || { value: '' }} onChange={(next) => setAnswers((current) => ({ ...current, [question.fieldPath]: next }))} />
    </div>)}</div>
    {answeredAfterAnalysis && !dirty && <p className="text-[11px] text-violet-700 mt-3">Você respondeu depois da última otimização. Gere de novo para usar as respostas.</p>}
    <div className="mt-4 flex flex-wrap justify-end gap-2">
      {dirty && <button disabled={busy} onClick={() => void onSubmit(answers, false)} className="text-xs font-semibold text-slate-600 px-3 py-2 disabled:opacity-50">Só salvar</button>}
      <button disabled={busy || (!dirty && !answeredAfterAnalysis) || !filled} onClick={() => void onSubmit(answers, true)} className="inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-bold px-4 py-2 rounded-xl disabled:opacity-40">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} Salvar e gerar melhorias de novo</button>
    </div>
  </section>;
}

function PicturesSection({ listing, analysis, generating, onGenerate }: {
  listing: MeliListing;
  analysis: MeliAnalysis;
  generating: MeliGeneratedPictureKind | null;
  onGenerate: (kind: MeliGeneratedPictureKind, instructions: string) => Promise<void>;
}) {
  const [instructions, setInstructions] = useState('');
  const media = analysis.media;
  const diagnostics = new Map(analysis.imageDiagnostics.map((image) => [image.pictureId, image]));
  const needsLifestyle = !media || media.lifestyleCount === 0;
  const needsCover = !media || media.mainWhiteBackground !== true;
  const button = (kind: MeliGeneratedPictureKind, label: string, primary: boolean) => <button key={kind} disabled={Boolean(generating) || !listing.pictures?.length} onClick={() => void onGenerate(kind, instructions)} className={`inline-flex items-center gap-2 text-sm font-bold px-4 py-2 rounded-xl disabled:opacity-40 ${primary ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50'}`}>{generating === kind ? <Loader2 className="w-4 h-4 animate-spin" /> : <WandSparkles className="w-4 h-4" />}{label}</button>;
  return <section className="space-y-3">
    <div className="flex items-center justify-between"><h3 className="text-sm font-black text-slate-900 flex items-center gap-2"><ImageIcon className="w-4 h-4 text-blue-600" /> Fotos</h3><span className="text-xs text-slate-400">{listing.pictures?.length || 0} no anúncio</span></div>
    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">{(listing.pictures || []).map((picture, index) => {
      const diagnostic = diagnostics.get(String(picture.id));
      const lowRes = diagnostic?.width && diagnostic?.height && Math.min(diagnostic.width, diagnostic.height) < 1200;
      return <div key={String(picture.id || index)} className="border border-slate-200 rounded-xl overflow-hidden bg-white" title={[...(diagnostic?.issues || []), ...(diagnostic?.strengths || [])].join('\n')}>
        <div className="aspect-square bg-slate-50 relative"><img src={picture.secure_url || picture.url} alt="" className="w-full h-full object-contain" />{index === 0 && <span className="absolute top-1 left-1 text-[9px] font-bold bg-slate-900 text-white rounded px-1.5 py-0.5">CAPA</span>}</div>
        <div className="px-2 py-1.5 space-y-0.5">
          <p className="text-[10px] font-semibold text-slate-700 truncate">{diagnostic?.role ? ROLE_LABEL[diagnostic.role] : '—'}</p>
          {lowRes ? <p className="text-[10px] text-amber-600">Sem zoom (&lt;1200 px)</p> : null}
          {diagnostic?.hasTextOrWatermark ? <p className="text-[10px] text-amber-600">Tem texto/marca</p> : null}
          {Boolean(diagnostic?.issues.length) && <p className="text-[10px] text-red-600 truncate">{diagnostic!.issues[0]}</p>}
        </div>
      </div>;
    })}</div>
    <div className="border border-slate-200 rounded-2xl p-4 bg-slate-50/60">
      <p className="text-sm font-bold text-slate-900">Gerar fotos com IA</p>
      <p className="text-xs text-slate-500 mt-0.5">Usa a foto de capa como base, mantém o produto idêntico e entra nas melhorias para você aprovar. Cada foto consome créditos de Geração de Ambientação.</p>
      <input value={instructions} onChange={(event) => setInstructions(event.target.value)} maxLength={400} placeholder="Opcional: descreva o ambiente (ex.: cozinha clara, mesa de madeira)" className="mt-3 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white" />
      <div className="mt-3 flex flex-wrap gap-2">{button('lifestyle', needsLifestyle ? 'Gerar foto ambientada' : 'Gerar outra ambientada', needsLifestyle)}{button('white_background', 'Gerar capa em fundo branco', needsCover && !needsLifestyle)}</div>
      {generating && <p className="text-[11px] text-slate-500 mt-2">Gerando a foto… isso leva uns 20 segundos.</p>}
    </div>
  </section>;
}

function VideoSection({ listing, analysis, media, onOpenStudio }: {
  listing: MeliListing;
  analysis: MeliAnalysis | null;
  media: MeliListingMedia | null;
  onOpenStudio: () => void;
}) {
  const videoId = analysis?.media?.videoId ?? listing.videoId ?? null;
  return <section className="space-y-3">
    <h3 className="text-sm font-black text-slate-900 flex items-center gap-2"><Video className="w-4 h-4 text-violet-600" /> Vídeo</h3>
    <div className={`border rounded-2xl p-4 ${videoId ? 'border-emerald-200 bg-emerald-50/40' : 'border-slate-200 bg-white'}`}>
      <p className="text-sm font-bold text-slate-900">{videoId ? 'O anúncio tem vídeo cadastrado' : 'O anúncio não tem vídeo cadastrado'}</p>
      <p className="text-xs text-slate-500 mt-0.5">{videoId
        ? <>Vídeo <a className="text-blue-600 font-semibold" href={`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`} target="_blank" rel="noreferrer">{videoId}</a> vinculado ao anúncio.</>
        : 'Anúncios com vídeo passam mais confiança para quem compra. Clips enviados pelo painel do Mercado Livre podem não aparecer aqui.'}</p>
      {!media?.videoUrl && <button onClick={onOpenStudio} disabled={!listing.pictures?.length} className="mt-3 inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-bold px-4 py-2 rounded-xl disabled:opacity-40"><WandSparkles className="w-4 h-4" /> {media?.videoJobId || media?.productReference ? 'Continuar vídeo com IA' : 'Gerar vídeo com IA'}</button>}
    </div>
    {media?.videoUrl && <div className="grid sm:grid-cols-[180px_1fr] gap-3 items-start">
      <video src={media.videoUrl} controls playsInline className="w-full rounded-xl bg-black aspect-[9/16]" />
      <div className="space-y-2"><PublishClipHelp videoUrl={media.videoUrl} itemId={listing.itemId} /><button onClick={onOpenStudio} className="text-xs font-semibold text-violet-700">Gerar outro vídeo</button></div>
    </div>}
  </section>;
}

function TechnicalDetails({ analysis }: { analysis: MeliAnalysis }) {
  const order = { blocked: 5, high: 4, medium: 3, low: 2, info: 1 } as const;
  const findings = [...analysis.findings].sort((a, b) => order[b.severity] - order[a.severity]);
  return <details className="group border border-slate-200 rounded-2xl bg-white">
    <summary className="cursor-pointer list-none px-4 py-3 flex items-center justify-between text-sm font-semibold text-slate-700">Detalhes técnicos da análise ({findings.length}) <ChevronDown className="w-4 h-4 transition-transform group-open:rotate-180" /></summary>
    <div className="px-4 pb-4 space-y-3">
      {analysis.scoreComponents && <div className="grid grid-cols-5 gap-2 text-center">{([['Técnica', analysis.scoreComponents.technicalCompleteness], ['Consist.', analysis.scoreComponents.consistency], ['Título', analysis.scoreComponents.title], ['Descrição', analysis.scoreComponents.description], ['Imagens', analysis.scoreComponents.images]] as const).map(([label, value]) => <div key={label} className="border rounded-lg py-2"><p className="text-sm font-black">{Math.round(value)}</p><p className="text-[10px] text-slate-400">{label}</p></div>)}</div>}
      {analysis.aiStatus === 'failed' && <p className="text-xs text-amber-700">A IA não respondeu nesta análise; os achados abaixo são só das regras. {analysis.aiError}</p>}
      {findings.map((finding, index) => <div key={`${finding.code}-${finding.fieldPath}-${index}`} className="border-l-2 border-slate-200 pl-3"><p className="text-[10px] font-bold uppercase text-slate-400">{SEVERITY_LABEL[finding.severity]} · {finding.fieldPath}</p><p className="text-xs text-slate-700">{finding.message}</p></div>)}
      {Boolean(analysis.buyerQuestions?.length) && <div><p className="text-xs font-bold text-slate-700 mt-2">Perguntas recentes de compradores</p>{analysis.buyerQuestions!.slice(0, 8).map((question, index) => <p key={index} className="text-xs text-slate-600 mt-1">• {question.text}{question.answer ? '' : ' (sem resposta)'}</p>)}</div>}
    </div>
  </details>;
}

export default function ListingPanel({ listing, connection, credits, onClose, onChanged }: {
  listing: MeliListing;
  connection: MeliConnection | null;
  credits: MeliCreditHelpers;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [analysis, setAnalysis] = useState<MeliAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [proposalResult, setProposalResult] = useState<MeliProposalResult | null>(null);
  const [mutationRun, setMutationRun] = useState<MeliMutationRun | null>(null);
  const [facts, setFacts] = useState<MeliFacts | null>(null);
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState<MeliGeneratedPictureKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [media, setMedia] = useState<MeliListingMedia | null>(null);
  const [studioOpen, setStudioOpen] = useState(false);
  const itemId = listing.itemId;

  const loadProposal = async () => {
    const result = await getLatestMeliProposal(itemId);
    setProposalResult(result);
    if (result?.proposal.lastMutationRunId) setMutationRun(await getMeliMutationRun(result.proposal.lastMutationRunId).catch(() => null));
    else setMutationRun(null);
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setAnalysis(null); setProposalResult(null); setMutationRun(null); setError(null);
    setMedia(null); setStudioOpen(false);
    Promise.all([getLatestMeliAnalysis(itemId), getMeliFacts(itemId).catch(() => null), getMeliListingMedia(itemId).catch(() => null), loadProposal()])
      .then(([latest, currentFacts, currentMedia]) => { if (!cancelled) { setAnalysis(latest); setFacts(currentFacts); setMedia(currentMedia); } })
      .catch((reason) => { if (!cancelled) setError(message(reason, 'Falha ao abrir o anúncio.')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [itemId]);

  // A proposta nasce no servidor ao fim da análise: quando ela termina,
  // recarrega a proposta junto.
  useEffect(() => {
    if (!analysis || (terminalAnalyses.has(analysis.status) && !awaitingProposal(analysis))) return;
    const timer = window.setInterval(async () => {
      const next = await getLatestMeliAnalysis(itemId).catch(() => null);
      if (!next || next.id !== analysis.id) return;
      if (terminalAnalyses.has(next.status) && !awaitingProposal(next)) { await loadProposal().catch(() => undefined); onChanged(); }
      setAnalysis(next);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [analysis?.id, analysis?.status, analysis?.proposalPending]);

  useEffect(() => {
    if (!mutationRun || !activeRuns.has(mutationRun.status)) return;
    const timer = window.setInterval(async () => {
      const next = await getMeliMutationRun(mutationRun.id).catch(() => null);
      if (!next) return;
      setMutationRun(next);
      if (!activeRuns.has(next.status)) {
        const proposal = await getLatestMeliProposal(itemId).catch(() => null);
        if (proposal) setProposalResult(proposal);
        onChanged();
      }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [mutationRun?.id, mutationRun?.status]);

  const run = async (task: () => Promise<void>, fallback: string) => {
    setBusy(true); setError(null);
    try { await task(); } catch (reason) { setError(message(reason, fallback)); } finally { setBusy(false); }
  };
  const optimize = async () => {
    setStarting(true); setError(null);
    try { setAnalysis(await startMeliAnalysis(itemId)); setProposalResult(null); setMutationRun(null); onChanged(); }
    catch (reason) { setError(message(reason, 'Falha ao iniciar a otimização.')); }
    finally { setStarting(false); }
  };
  const submitAnswers = (answers: Record<string, { value: string; valueId?: string | null }>, regenerate: boolean) => run(async () => {
    setFacts(await saveMeliFacts(itemId, answers));
    if (regenerate) await optimize();
  }, 'Falha ao salvar as respostas.');
  const generatePicture = async (kind: MeliGeneratedPictureKind, instructions: string) => {
    setGenerating(kind); setError(null);
    try {
      const result = await generateMeliPicture(itemId, { kind, instructions: instructions.trim() || null });
      setProposalResult({ proposal: result.proposal, changes: result.changes });
      setMutationRun(null);
      onChanged();
    } catch (reason) { setError(message(reason, 'Falha ao gerar a foto.')); }
    finally { setGenerating(null); }
  };
  const editChange = (change: MeliProposalChange, value: unknown) => run(async () => {
    if (!proposalResult) return;
    setProposalResult(await editMeliProposalChange(proposalResult.proposal.id, change.id, value));
  }, 'Falha ao editar a melhoria.');
  const publish = (changeIds: string[]) => run(async () => {
    if (!proposalResult) return;
    const result = await publishMeliProposal(proposalResult.proposal.id, changeIds);
    setProposalResult({ proposal: { ...result.proposal, status: 'applying', lastMutationRunId: result.mutationRun.id }, changes: result.changes });
    setMutationRun(result.mutationRun);
    onChanged();
  }, 'Falha ao publicar.');
  const rollback = () => run(async () => {
    if (!proposalResult) return;
    setProposalResult(await createMeliRollbackProposal(proposalResult.proposal.id));
    setMutationRun(null);
    onChanged();
  }, 'Falha ao preparar a reversão.');
  const writeManually = () => run(async () => {
    if (!analysis) return;
    setProposalResult(await createMeliProposal(itemId, analysis.id, true));
    onChanged();
  }, 'Falha ao abrir a escrita manual.');

  const analysisRunning = Boolean(analysis && (!terminalAnalyses.has(analysis.status) || awaitingProposal(analysis)));
  const completed = analysis?.status === 'completed' ? analysis : null;
  const checklist = completed?.checklist || [];
  const pending = checklist.filter((item) => item.status !== 'ok').length;
  const showProposal = proposalResult && !(proposalResult.proposal.status === 'stale' && analysisRunning);
  // Insumos do vídeo: fotos reais (tudo que não é ambientada), cenas
  // ambientadas (do anúncio + geradas agora) e a melhor descrição disponível.
  const lifestyleIds = new Set((completed?.imageDiagnostics || []).filter((image) => image.role === 'lifestyle').map((image) => image.pictureId));
  const pictureUrl = (picture: { secure_url?: string; url?: string }) => picture.secure_url || picture.url || '';
  const realPhotos = (listing.pictures || []).filter((picture) => !lifestyleIds.has(String(picture.id))).map(pictureUrl).filter(Boolean);
  const generatedScenes = (proposalResult?.changes || [])
    .map((change) => change.newValue as Record<string, unknown> | null)
    .filter((value) => value?.action === 'create' && typeof value.source === 'string')
    .map((value) => String(value!.source));
  const ambientPhotos = [...(listing.pictures || []).filter((picture) => lifestyleIds.has(String(picture.id))).map(pictureUrl), ...generatedScenes].filter(Boolean);
  const proposedDescription = proposalResult?.changes.find((change) => change.fieldPath === 'description.plain_text' && typeof change.newValue === 'string')?.newValue as string | undefined;

  return <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/35" onMouseDown={onClose}>
    <aside className="w-full max-w-3xl h-full bg-white shadow-2xl overflow-y-auto" onMouseDown={(event) => event.stopPropagation()}>
      <div className="sticky top-0 bg-white/95 backdrop-blur border-b border-slate-200 px-5 py-3 flex items-center gap-3 z-10">
        <div className="w-11 h-11 rounded-lg bg-slate-100 overflow-hidden shrink-0">{listing.thumbnail && <img src={listing.thumbnail} alt="" className="w-full h-full object-contain" />}</div>
        <div className="min-w-0 flex-1"><p className="text-[10px] font-bold text-slate-400">{listing.itemId}</p><h2 className="font-bold text-slate-900 line-clamp-1">{listing.title}</h2></div>
        {listing.permalink && <a href={listing.permalink} target="_blank" rel="noreferrer" className="p-2 text-slate-500 hover:text-blue-600" title="Abrir no Mercado Livre"><ExternalLink className="w-4 h-4" /></a>}
        <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full" aria-label="Fechar"><X className="w-4 h-4" /></button>
      </div>
      <div className="p-5 space-y-5">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {([
            ['Nota do Mercado Livre', listing.performance?.score ?? '—'],
            ['Nota Alfreds', completed?.alfredsScore ?? listing.analysisSummary?.alfredsScore ?? '—'],
            ['Visitas (30 dias)', listing.visits30d ?? '—'],
            ['Fotos', listing.pictures?.length || 0],
            ['Vídeo', (completed?.media?.hasVideo ?? Boolean(listing.videoId)) ? 'Sim' : 'Não'],
          ] as const).map(([label, value]) => <div key={label} className="border rounded-xl p-2.5"><p className="text-[10px] text-slate-400">{label}</p><p className="text-lg font-black text-slate-900">{value}</p></div>)}
        </div>
        {(listing.userProductId || listing.catalogProductId) && <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-3 text-xs flex gap-2"><TriangleAlert className="w-4 h-4 shrink-0" /><span>Este anúncio está ligado a {listing.userProductId ? 'um User Product' : 'um produto de catálogo'}: algumas mudanças podem afetar outros anúncios ou ser controladas pelo Mercado Livre.</span></div>}
        {error && <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3"><AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /><span>{error}</span></div>}

        {loading ? <div className="py-10 flex justify-center text-sm text-slate-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Carregando…</div>
          : analysisRunning ? <AnalysisProgress />
            : !completed ? <section className="border border-slate-200 rounded-2xl p-6 text-center">
              <div className="w-12 h-12 mx-auto rounded-2xl bg-[#FFE600] flex items-center justify-center"><Sparkles className="w-6 h-6 text-slate-900" /></div>
              <h3 className="text-lg font-black text-slate-900 mt-3">{analysis?.status === 'stale' ? 'O anúncio mudou' : analysis?.status === 'failed' ? 'A última otimização falhou' : 'Otimize este anúncio com IA'}</h3>
              <p className="text-sm text-slate-600 mt-1 max-w-md mx-auto">O agente confere ficha técnica, título, descrição, fotos e vídeo, escreve as melhorias e deixa tudo pronto para você só aprovar.</p>
              {analysis?.status === 'failed' && analysis.aiError && <p className="text-xs text-red-600 mt-2">{analysis.aiError}</p>}
              <button onClick={() => void optimize()} disabled={starting} className="mt-5 inline-flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white text-sm font-bold px-5 py-3 rounded-xl disabled:opacity-50">{starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} {analysis ? 'Otimizar de novo' : 'Otimizar anúncio'}</button>
            </section>
              : <>
                <section className="border border-slate-200 rounded-2xl p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div><h3 className="text-sm font-black text-slate-900">{pending ? `${pending} ponto(s) para o anúncio ganhar relevância` : 'O anúncio cumpre todos os pontos de relevância'}</h3><p className="text-xs text-slate-500 mt-0.5">{completed.summary}</p></div>
                    <button onClick={() => void optimize()} disabled={starting} className="shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 border border-slate-200 rounded-lg px-3 py-1.5 hover:bg-slate-50 disabled:opacity-50">{starting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} Otimizar de novo</button>
                  </div>
                  {checklist.length > 0 && <div className="mt-2 grid sm:grid-cols-2 gap-x-6" style={{ borderTop: '1px solid rgb(241 245 249)' }}>{checklist.map((item) => <ChecklistRow key={item.id} item={item} />)}</div>}
                </section>
                <QuestionsForm analysis={completed} facts={facts} busy={busy || starting} onSubmit={submitAnswers} />
                {showProposal ? <ProposalReview result={proposalResult!} pictures={listing.pictures || []} busy={busy} writeEnabled={connection?.mode === 'assisted_write'} mutationRun={mutationRun} onEdit={editChange} onPublish={publish} onRollback={rollback} />
                  : <section className="border border-amber-200 bg-amber-50/60 rounded-2xl p-4 flex items-center justify-between gap-3">
                    <div><p className="text-sm font-bold text-slate-900">Nenhuma melhoria automática para publicar</p><p className="text-xs text-slate-600 mt-0.5">{completed.questions.length ? 'Responda às perguntas acima para a IA conseguir completar ficha e textos.' : 'O texto e a ficha já estão em ordem. Você ainda pode gerar fotos abaixo.'}</p></div>
                    <button onClick={writeManually} disabled={busy} className="shrink-0 inline-flex items-center gap-2 border border-slate-300 bg-white text-slate-800 text-sm font-bold px-4 py-2 rounded-xl disabled:opacity-50"><Pencil className="w-4 h-4" /> Escrever manualmente</button>
                  </section>}
                <PicturesSection listing={listing} analysis={completed} generating={generating} onGenerate={generatePicture} />
                <VideoSection listing={listing} analysis={completed} media={media} onOpenStudio={() => setStudioOpen(true)} />
                <TechnicalDetails analysis={completed} />
              </>}
      </div>
    </aside>
    {studioOpen && <MeliVideoStudio
      listing={listing}
      description={proposedDescription || listing.descriptionPlainText}
      realPhotos={realPhotos}
      ambientPhotos={ambientPhotos}
      credits={credits}
      onClose={() => { setStudioOpen(false); getMeliListingMedia(itemId).then(setMedia).catch(() => undefined); }}
      onVideoReady={(videoUrl) => setMedia((current) => current ? { ...current, videoUrl } : current)}
    />}
  </div>;
}
