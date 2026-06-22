import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, ChevronRight, ChevronLeft, Check, RefreshCw, Globe, Wand2, Plus, Pencil } from 'lucide-react';
import type { ContentProject, ContentProjectConfig } from './types';
import { createProject, updateProjectConfig, scanWebsite } from '../../services/contentService';
import TagInput from './TagInput';
import ProfileSummary, { asList } from './ProfileSummary';

interface Props {
  uid: string;
  existing?: ContentProject | null;
  onSaved: (projectId: string) => void;
  onCancel?: () => void;
}

const PUBLICO_SUGGESTIONS = [
  'Consumidor final (B2C)', 'Empresas (B2B)', 'Jovens 18-25', 'Adultos 26-40',
  'Profissionais', 'Mães e pais', 'Iniciantes', 'Especialistas', 'Pequenos negócios', 'Classe A/B',
];
const TOM_SUGGESTIONS = [
  'Técnico', 'Descontraído', 'Inspirador', 'Autoritário', 'Amigável',
  'Profissional', 'Divertido', 'Sofisticado', 'Educativo', 'Empático',
];
const FREQUENCIAS = [
  'Diário', '1 vez na semana', '2 vezes na semana', '3 vezes na semana',
  '4 vezes na semana', '5 vezes na semana', '6 vezes na semana', '7 vezes na semana',
];

const STEPS = ['Identidade', 'Audiência & tom', 'Estratégia', 'Resumo'];

// Fase 1 — onboarding redesenhado: importação por IA, campos de tag, seleção de
// tom e frequência, e um resumo final antes de seguir para os clusters.
const OnboardingWizard: React.FC<Props> = ({ uid, existing, onSaved, onCancel }) => {
  const c = existing?.config;
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Site scan
  const [siteUrl, setSiteUrl] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanDone, setScanDone] = useState(false);

  const [nomeEmpresa, setNomeEmpresa] = useState(c?.nomeEmpresa ?? '');
  const [descricao, setDescricao] = useState(c?.descricao ?? '');
  const [produtoServico, setProdutoServico] = useState(c?.produtoServico ?? '');
  const [publicoAlvo, setPublicoAlvo] = useState<string[]>(asList(c?.publicoAlvo));
  const [tomDeVoz, setTomDeVoz] = useState(c?.tomDeVoz ?? '');
  const [tomCustom, setTomCustom] = useState('');
  const [objetivos, setObjetivos] = useState<string[]>(c?.objetivos ?? []);
  const [palavrasChave, setPalavrasChave] = useState<string[]>(c?.palavrasChave ?? []);
  const [referencias, setReferencias] = useState<string[]>(c?.referencias ?? []);
  const [frequenciaPostagens, setFrequenciaPostagens] = useState(c?.frequenciaPostagens || '2 vezes na semana');

  const tomOptions = Array.from(new Set([...TOM_SUGGESTIONS, ...(tomDeVoz ? [tomDeVoz] : [])]));

  const buildConfig = (): ContentProjectConfig => ({
    nomeEmpresa: nomeEmpresa.trim(),
    descricao: descricao.trim(),
    produtoServico: produtoServico.trim(),
    publicoAlvo,
    tomDeVoz: tomDeVoz.trim(),
    objetivos,
    palavrasChave,
    referencias,
    frequenciaPostagens,
    // WordPress e Sanity vivem em Integrações; preserva o que já existir.
    wordpressUrl: c?.wordpressUrl ?? '',
    wordpressUser: c?.wordpressUser ?? '',
    sanityProjectId: c?.sanityProjectId ?? '',
    sanityDataset: c?.sanityDataset ?? 'production',
  });

  const handleScan = async () => {
    if (!siteUrl.trim()) return;
    setScanning(true);
    setError(null);
    try {
      const url = /^https?:\/\//i.test(siteUrl) ? siteUrl : `https://${siteUrl}`;
      const { config } = await scanWebsite(url);
      if (config.nomeEmpresa) setNomeEmpresa(config.nomeEmpresa);
      if (config.descricao) setDescricao(config.descricao);
      if (config.produtoServico) setProdutoServico(config.produtoServico);
      if (config.publicoAlvo?.length) setPublicoAlvo(config.publicoAlvo);
      if (config.tomDeVoz) setTomDeVoz(config.tomDeVoz);
      if (config.objetivos?.length) setObjetivos(config.objetivos);
      if (config.palavrasChave?.length) setPalavrasChave(config.palavrasChave);
      setScanDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível analisar o site');
    } finally {
      setScanning(false);
    }
  };

  const go = (next: number) => { setDir(next > step ? 1 : -1); setStep(next); };
  const canAdvance = step === 0 ? !!(nomeEmpresa.trim() && produtoServico.trim()) : true;

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const config = buildConfig();
      const projectId = existing ? (await updateProjectConfig(uid, existing.id, config), existing.id) : await createProject(uid, config);
      onSaved(projectId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  const input = (val: string, set: (v: string) => void, ph?: string) => (
    <input
      value={val}
      onChange={(e) => set(e.target.value)}
      placeholder={ph}
      className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#004ac6]/30 focus:border-[#004ac6] transition-all"
    />
  );

  return (
    <div className="max-w-2xl mx-auto">
      {/* Header */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#0f172a] to-[#1e3a8a] p-6 mb-6 text-white shadow-lg">
        <div className="absolute -right-8 -top-8 w-40 h-40 rounded-full bg-[#004ac6]/30 blur-2xl" />
        <div className="relative flex items-center gap-3">
          <div className="bg-white/10 backdrop-blur p-2.5 rounded-2xl ring-1 ring-white/20">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-display text-xl font-bold tracking-tight">{existing ? 'Editar projeto' : 'Configurar a Agência de Conteúdo'}</h2>
            <p className="text-sm text-white/70">Conte sobre a empresa para o Alfred trabalhar por você.</p>
          </div>
        </div>
        {/* Stepper */}
        <div className="relative flex items-center gap-2 mt-5">
          {STEPS.map((s, i) => (
            <div key={s} className="flex-1">
              <div className={`h-1.5 rounded-full transition-colors ${i <= step ? 'bg-white' : 'bg-white/20'}`} />
              <span className={`mt-1.5 block text-[10px] font-medium ${i <= step ? 'text-white' : 'text-white/40'}`}>{s}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 md:p-8 overflow-hidden">
        <AnimatePresence mode="wait" custom={dir}>
          <motion.div
            key={step}
            custom={dir}
            initial={{ opacity: 0, x: dir * 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: dir * -24 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
          >
            {step === 0 && (
              <div className="space-y-5">
                {/* AI site import */}
                <div className="rounded-2xl border border-[#cdddff] bg-gradient-to-br from-[#eef3ff] to-white p-4">
                  <div className="flex items-center gap-2 mb-2 text-[#004ac6]">
                    <Wand2 className="w-4 h-4" />
                    <span className="text-sm font-bold">Preencher com IA a partir do site</span>
                  </div>
                  <p className="text-xs text-slate-500 mb-3">Cole o site da empresa e o Alfred entende o negócio e preenche os campos pra você.</p>
                  <div className="flex gap-2">
                    <div className="flex-1 relative">
                      <Globe className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        value={siteUrl}
                        onChange={(e) => setSiteUrl(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleScan()}
                        placeholder="suaempresa.com.br"
                        className="w-full border border-slate-300 rounded-xl pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#004ac6]/30 focus:border-[#004ac6]"
                      />
                    </div>
                    <button
                      onClick={handleScan}
                      disabled={scanning || !siteUrl.trim()}
                      className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold text-white bg-[#004ac6] hover:bg-[#003ea8] disabled:opacity-50 rounded-xl shadow-sm transition-colors whitespace-nowrap"
                    >
                      {scanning ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                      {scanning ? 'Analisando…' : 'Analisar'}
                    </button>
                  </div>
                  {scanDone && !scanning && (
                    <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-1.5 text-xs text-emerald-600 mt-2 font-medium">
                      <Check className="w-3.5 h-3.5" /> Campos preenchidos! Revise abaixo.
                    </motion.p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">Nome da empresa *</label>
                  {input(nomeEmpresa, setNomeEmpresa, 'Ex.: Loja Verde')}
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">O que a empresa faz?</label>
                  <textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} rows={3} placeholder="Breve descrição do negócio"
                    className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#004ac6]/30 focus:border-[#004ac6]" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">Principal produto ou serviço *</label>
                  {input(produtoServico, setProdutoServico, 'Ex.: Plantas e jardinagem')}
                </div>
              </div>
            )}

            {step === 1 && (
              <div className="space-y-6">
                <TagInput
                  label="Público-alvo"
                  hint="Escolha sugestões ou digite e pressione Enter."
                  value={publicoAlvo}
                  onChange={setPublicoAlvo}
                  suggestions={PUBLICO_SUGGESTIONS}
                  placeholder="Adicionar persona…"
                />
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Tom de voz</label>
                  <div className="flex flex-wrap gap-2">
                    {tomOptions.map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setTomDeVoz(t)}
                        className={`rounded-xl border px-3 py-1.5 text-sm font-medium transition-all ${tomDeVoz === t ? 'border-[#004ac6] bg-[#004ac6] text-white shadow-sm' : 'border-slate-300 bg-white text-slate-600 hover:border-[#004ac6] hover:text-[#004ac6]'}`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2 mt-2">
                    <input
                      value={tomCustom}
                      onChange={(e) => setTomCustom(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && tomCustom.trim()) { e.preventDefault(); setTomDeVoz(tomCustom.trim()); setTomCustom(''); } }}
                      placeholder="Ou crie um tom personalizado…"
                      className="flex-1 border border-slate-300 rounded-xl px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#004ac6]/30 focus:border-[#004ac6]"
                    />
                    <button
                      type="button"
                      onClick={() => { if (tomCustom.trim()) { setTomDeVoz(tomCustom.trim()); setTomCustom(''); } }}
                      className="flex items-center gap-1 px-3 py-2 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
                    >
                      <Plus className="w-4 h-4" /> Adicionar
                    </button>
                  </div>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-6">
                <TagInput label="Objetivos de conteúdo" hint="Ex.: gerar leads, educar o mercado." value={objetivos} onChange={setObjetivos} placeholder="Adicionar objetivo…" />
                <TagInput label="Palavras-chave para dominar" value={palavrasChave} onChange={setPalavrasChave} placeholder="Adicionar palavra-chave…" />
                <TagInput label="Referências / concorrentes" value={referencias} onChange={setReferencias} placeholder="Adicionar referência…" />
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">Frequência de publicações</label>
                  <select
                    value={frequenciaPostagens}
                    onChange={(e) => setFrequenciaPostagens(e.target.value)}
                    className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#004ac6]/30 focus:border-[#004ac6]"
                  >
                    {FREQUENCIAS.map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-slate-900">
                  <Check className="w-5 h-5 text-emerald-500" />
                  <h3 className="font-display text-lg font-bold">Tudo pronto. Confira o resumo</h3>
                </div>
                <ProfileSummary config={buildConfig()} />
                <p className="text-xs text-slate-400">Você pode editar qualquer etapa antes de avançar. O WordPress é configurado depois, em Integrações.</p>
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        {error && <div className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</div>}

        {/* Footer */}
        <div className="flex items-center justify-between mt-8">
          <button
            onClick={() => (step === 0 ? onCancel?.() : go(step - 1))}
            className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
          >
            <ChevronLeft className="w-4 h-4" /> {step === 0 ? 'Cancelar' : 'Voltar'}
          </button>
          {step < STEPS.length - 1 ? (
            <button
              disabled={!canAdvance}
              onClick={() => go(step + 1)}
              className="flex items-center gap-1.5 px-5 py-2.5 text-sm font-semibold text-white bg-[#004ac6] hover:bg-[#003ea8] disabled:opacity-40 rounded-xl shadow-sm transition-colors"
            >
              Próximo <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button onClick={() => go(0)} className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors">
                <Pencil className="w-4 h-4" /> Editar
              </button>
              <button
                disabled={saving}
                onClick={handleSave}
                className="flex items-center gap-1.5 px-5 py-2.5 text-sm font-semibold text-white bg-[#004ac6] hover:bg-[#003ea8] disabled:opacity-60 rounded-xl shadow-sm transition-colors"
              >
                {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ChevronRight className="w-4 h-4" />}
                {existing ? 'Salvar alterações' : 'Salvar e criar clusters'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default OnboardingWizard;
