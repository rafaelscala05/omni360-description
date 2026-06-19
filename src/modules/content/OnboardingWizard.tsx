import React, { useState } from 'react';
import { Sparkles, ChevronRight, ChevronLeft, Check, RefreshCw } from 'lucide-react';
import type { ContentProject, ContentProjectConfig } from './types';
import { createProject, updateProjectConfig, saveWordpressSecret } from '../../services/contentService';

interface Props {
  uid: string;
  existing?: ContentProject | null;
  onSaved: (projectId: string) => void;
  onCancel?: () => void;
}

// Fase 1 — onboarding. Collects the project configuration described in
// alfred_agent_prompt.md and persists it (config + WordPress secret).
const OnboardingWizard: React.FC<Props> = ({ uid, existing, onSaved, onCancel }) => {
  const c = existing?.config;
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [nomeEmpresa, setNomeEmpresa] = useState(c?.nomeEmpresa ?? '');
  const [descricao, setDescricao] = useState(c?.descricao ?? '');
  const [produtoServico, setProdutoServico] = useState(c?.produtoServico ?? '');
  const [publicoAlvo, setPublicoAlvo] = useState(c?.publicoAlvo ?? '');
  const [tomDeVoz, setTomDeVoz] = useState(c?.tomDeVoz ?? '');
  const [objetivos, setObjetivos] = useState((c?.objetivos ?? []).join(', '));
  const [palavrasChave, setPalavrasChave] = useState((c?.palavrasChave ?? []).join(', '));
  const [referencias, setReferencias] = useState((c?.referencias ?? []).join(', '));
  const [frequenciaPostagens, setFrequenciaPostagens] = useState(c?.frequenciaPostagens ?? '2x por semana');
  const [wordpressUrl, setWordpressUrl] = useState(c?.wordpressUrl ?? '');
  const [wordpressUser, setWordpressUser] = useState(c?.wordpressUser ?? '');
  const [wordpressAppPassword, setWordpressAppPassword] = useState('');

  const steps = ['Sobre a empresa', 'Estratégia', 'Publicação'];

  const buildConfig = (): ContentProjectConfig => ({
    nomeEmpresa: nomeEmpresa.trim(),
    descricao: descricao.trim(),
    produtoServico: produtoServico.trim(),
    publicoAlvo: publicoAlvo.trim(),
    tomDeVoz: tomDeVoz.trim(),
    objetivos: objetivos.split(',').map((s) => s.trim()).filter(Boolean),
    palavrasChave: palavrasChave.split(',').map((s) => s.trim()).filter(Boolean),
    referencias: referencias.split(',').map((s) => s.trim()).filter(Boolean),
    frequenciaPostagens: frequenciaPostagens.trim(),
    wordpressUrl: wordpressUrl.trim(),
    wordpressUser: wordpressUser.trim(),
  });

  const canAdvance = step === 0 ? nomeEmpresa.trim() && produtoServico.trim() : true;

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const config = buildConfig();
      let projectId = existing?.id ?? '';
      if (existing) {
        await updateProjectConfig(uid, existing.id, config);
        projectId = existing.id;
      } else {
        projectId = await createProject(uid, config);
      }
      if (wordpressAppPassword.trim()) {
        await saveWordpressSecret(uid, projectId, wordpressAppPassword.trim());
      }
      onSaved(projectId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  const field = (label: string, value: string, set: (v: string) => void, opts: { textarea?: boolean; placeholder?: string; type?: string } = {}) => (
    <div className="mb-4">
      <label className="block text-sm font-medium text-slate-700 mb-1.5">{label}</label>
      {opts.textarea ? (
        <textarea
          value={value}
          onChange={(e) => set(e.target.value)}
          placeholder={opts.placeholder}
          rows={3}
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#004ac6] focus:border-[#004ac6]"
        />
      ) : (
        <input
          type={opts.type ?? 'text'}
          value={value}
          onChange={(e) => set(e.target.value)}
          placeholder={opts.placeholder}
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#004ac6] focus:border-[#004ac6]"
        />
      )}
    </div>
  );

  return (
    <div className="max-w-2xl mx-auto bg-white border border-slate-200 rounded-2xl shadow-sm p-8">
      <div className="flex items-center gap-3 mb-6">
        <div className="bg-[#004ac6] p-2 rounded-xl">
          <Sparkles className="w-5 h-5 text-white" />
        </div>
        <div>
          <h2 className="font-display text-xl font-bold text-slate-900">{existing ? 'Editar projeto' : 'Novo projeto de conteúdo'}</h2>
          <p className="text-sm text-slate-500">Configure a empresa para o Alfred trabalhar.</p>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-6">
        {steps.map((s, i) => (
          <div key={s} className={`flex-1 h-1.5 rounded-full ${i <= step ? 'bg-[#004ac6]' : 'bg-slate-200'}`} title={s} />
        ))}
      </div>

      {step === 0 && (
        <div className="animate-in fade-in">
          {field('Nome da empresa *', nomeEmpresa, setNomeEmpresa, { placeholder: 'Ex.: Loja Verde' })}
          {field('O que a empresa faz?', descricao, setDescricao, { textarea: true, placeholder: 'Breve descrição do negócio' })}
          {field('Principal produto ou serviço *', produtoServico, setProdutoServico, { placeholder: 'Ex.: Plantas e jardinagem' })}
          {field('Público-alvo', publicoAlvo, setPublicoAlvo, { textarea: true, placeholder: 'Idade, cargo, dores, desejos' })}
        </div>
      )}

      {step === 1 && (
        <div className="animate-in fade-in">
          {field('Tom de voz', tomDeVoz, setTomDeVoz, { placeholder: 'Ex.: técnico, descontraído, inspirador' })}
          {field('Objetivos (separados por vírgula)', objetivos, setObjetivos, { placeholder: 'gerar leads, educar o mercado' })}
          {field('Palavras-chave para dominar (vírgula)', palavrasChave, setPalavrasChave, { placeholder: 'jardim vertical, suculentas' })}
          {field('Referências/concorrentes (vírgula)', referencias, setReferencias, { placeholder: 'blog-x.com, marca-y' })}
          {field('Frequência de publicações', frequenciaPostagens, setFrequenciaPostagens, { placeholder: '2x por semana' })}
        </div>
      )}

      {step === 2 && (
        <div className="animate-in fade-in">
          {field('URL do blog WordPress', wordpressUrl, setWordpressUrl, { placeholder: 'https://blog.empresa.com' })}
          {field('Usuário do WordPress', wordpressUser, setWordpressUser, { placeholder: 'autor' })}
          {field('Application Password', wordpressAppPassword, setWordpressAppPassword, { type: 'password', placeholder: existing ? '•••• (deixe vazio para manter)' : 'xxxx xxxx xxxx xxxx' })}
          <p className="text-xs text-slate-500 mt-1">
            Use uma <strong>Application Password</strong> do WordPress. Ela é guardada com segurança e usada apenas pelo servidor para publicar.
          </p>
        </div>
      )}

      {error && <div className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

      <div className="flex items-center justify-between mt-8">
        <button
          onClick={() => (step === 0 ? onCancel?.() : setStep(step - 1))}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
        >
          <ChevronLeft className="w-4 h-4" /> {step === 0 ? 'Cancelar' : 'Voltar'}
        </button>
        {step < steps.length - 1 ? (
          <button
            disabled={!canAdvance}
            onClick={() => setStep(step + 1)}
            className="flex items-center gap-1.5 px-5 py-2 text-sm font-medium text-white bg-[#004ac6] hover:bg-[#003ea8] disabled:opacity-40 rounded-lg transition-colors"
          >
            Próximo <ChevronRight className="w-4 h-4" />
          </button>
        ) : (
          <button
            disabled={saving}
            onClick={handleSave}
            className="flex items-center gap-1.5 px-5 py-2 text-sm font-medium text-white bg-[#004ac6] hover:bg-[#003ea8] disabled:opacity-60 rounded-lg transition-colors"
          >
            {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {existing ? 'Salvar' : 'Criar projeto'}
          </button>
        )}
      </div>
    </div>
  );
};

export default OnboardingWizard;
