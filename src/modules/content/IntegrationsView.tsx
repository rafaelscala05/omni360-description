import React, { useState } from 'react';
import { Plug, RefreshCw, Check, Globe } from 'lucide-react';
import type { ContentProject } from './types';
import { updateProjectConfig, saveWordpressSecret, saveSanitySecret } from '../../services/contentService';

interface Props {
  uid: string;
  project: ContentProject;
}

// Integrations panel — WordPress publishing credentials live here (moved out of
// the initial onboarding). The Application Password is stored as a secret the
// client can write but never read back.
const IntegrationsView: React.FC<Props> = ({ uid, project }) => {
  const [wordpressUrl, setWordpressUrl] = useState(project.config.wordpressUrl ?? '');
  const [wordpressUser, setWordpressUser] = useState(project.config.wordpressUser ?? '');
  const [appPassword, setAppPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [sanityProjectId, setSanityProjectId] = useState(project.config.sanityProjectId ?? '');
  const [sanityDataset, setSanityDataset] = useState(project.config.sanityDataset ?? 'production');
  const [sanityBlogUrl, setSanityBlogUrl] = useState(project.config.sanityBlogUrl ?? '');
  const [sanityToken, setSanityToken] = useState('');
  const [savingSanity, setSavingSanity] = useState(false);
  const [savedSanity, setSavedSanity] = useState(false);
  const [errorSanity, setErrorSanity] = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await updateProjectConfig(uid, project.id, {
        ...project.config,
        wordpressUrl: wordpressUrl.trim(),
        wordpressUser: wordpressUser.trim(),
      });
      if (appPassword.trim()) {
        await saveWordpressSecret(uid, project.id, appPassword.trim());
        setAppPassword('');
      }
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveSanity = async () => {
    setSavingSanity(true);
    setErrorSanity(null);
    setSavedSanity(false);
    try {
      await updateProjectConfig(uid, project.id, {
        ...project.config,
        sanityProjectId: sanityProjectId.trim(),
        sanityDataset: sanityDataset.trim() || 'production',
        sanityBlogUrl: sanityBlogUrl.trim(),
      });
      if (sanityToken.trim()) {
        await saveSanitySecret(uid, project.id, sanityToken.trim());
        setSanityToken('');
      }
      setSavedSanity(true);
    } catch (e) {
      setErrorSanity(e instanceof Error ? e.message : 'Erro ao salvar');
    } finally {
      setSavingSanity(false);
    }
  };

  const sanityConnected = !!project.config.sanityProjectId;
  const connected = !!project.config.wordpressUrl;

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-5">
        <h1 className="font-display text-2xl font-bold text-slate-900">Integrações</h1>
        <p className="text-sm text-slate-500 mt-0.5">Conecte canais de publicação ao seu projeto.</p>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="bg-slate-100 p-2.5 rounded-xl">
              <Plug className="w-5 h-5 text-slate-600" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-900">WordPress</h3>
              <p className="text-xs text-slate-500">Publica os artigos aprovados via REST API.</p>
            </div>
          </div>
          <span className={`text-[11px] font-medium px-2.5 py-1 rounded-full ${connected ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
            {connected ? 'Conectado' : 'Não conectado'}
          </span>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">URL do blog</label>
            <div className="relative">
              <Globe className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input value={wordpressUrl} onChange={(e) => setWordpressUrl(e.target.value)} placeholder="https://blog.empresa.com"
                className="w-full border border-slate-300 rounded-xl pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF5B03]/30 focus:border-[#FF5B03]" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Usuário</label>
            <input value={wordpressUser} onChange={(e) => setWordpressUser(e.target.value)} placeholder="autor"
              className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF5B03]/30 focus:border-[#FF5B03]" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Application Password</label>
            <input type="password" value={appPassword} onChange={(e) => setAppPassword(e.target.value)}
              placeholder={connected ? '•••• (deixe vazio para manter)' : 'xxxx xxxx xxxx xxxx'}
              className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF5B03]/30 focus:border-[#FF5B03]" />
            <p className="text-xs text-slate-400 mt-1">Gere em <strong>WordPress → Usuários → Application Passwords</strong>. Guardada com segurança; usada apenas pelo servidor.</p>
          </div>
        </div>

        {error && <div className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</div>}

        <div className="flex items-center justify-end gap-3 mt-6">
          {saved && <span className="flex items-center gap-1 text-sm text-emerald-600 font-medium"><Check className="w-4 h-4" /> Salvo</span>}
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-1.5 px-5 py-2.5 text-sm font-semibold text-white bg-[#FF5B03] hover:bg-[#E14E00] disabled:opacity-60 rounded-xl shadow-sm transition-colors">
            {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Salvar integração
          </button>
        </div>
      </div>
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 mt-4">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="bg-slate-100 p-2.5 rounded-xl">
              <Plug className="w-5 h-5 text-slate-600" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-900">Sanity</h3>
              <p className="text-xs text-slate-500">Publica os artigos aprovados como documentos no Sanity Studio.</p>
            </div>
          </div>
          <span className={`text-[11px] font-medium px-2.5 py-1 rounded-full ${sanityConnected ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
            {sanityConnected ? 'Conectado' : 'Não conectado'}
          </span>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Project ID</label>
            <input
              value={sanityProjectId}
              onChange={(e) => setSanityProjectId(e.target.value)}
              placeholder="abc123xy"
              className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF5B03]/30 focus:border-[#FF5B03]"
            />
            <p className="text-xs text-slate-400 mt-1">Encontre em <strong>sanity.io/manage → Project → Settings</strong>.</p>
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Dataset</label>
            <input
              value={sanityDataset}
              onChange={(e) => setSanityDataset(e.target.value)}
              placeholder="production"
              className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF5B03]/30 focus:border-[#FF5B03]"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">API Token</label>
            <input
              type="password"
              value={sanityToken}
              onChange={(e) => setSanityToken(e.target.value)}
              placeholder={sanityConnected ? '•••• (deixe vazio para manter)' : 'skTokenAbc...'}
              className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF5B03]/30 focus:border-[#FF5B03]"
            />
            <p className="text-xs text-slate-400 mt-1">Gere em <strong>sanity.io/manage → API → Tokens</strong> com permissão <strong>Editor</strong>. Guardado com segurança; usado apenas pelo servidor.</p>
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">URL do blog</label>
            <input
              value={sanityBlogUrl}
              onChange={(e) => setSanityBlogUrl(e.target.value)}
              placeholder="https://blog.empresa.com"
              className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF5B03]/30 focus:border-[#FF5B03]"
            />
            <p className="text-xs text-slate-400 mt-1">O Sanity é headless — quem publica o artigo em uma URL é o frontend do cliente, não o Sanity. Informe onde ele renderiza os posts para gerarmos o link "Ver publicado" ({'{URL do blog}'}/{'{slug}'}). Deixe em branco para linkar o painel de gestão do projeto no Sanity.</p>
          </div>
        </div>

        {errorSanity && (
          <div className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{errorSanity}</div>
        )}

        <div className="flex items-center justify-end gap-3 mt-6">
          {savedSanity && (
            <span className="flex items-center gap-1 text-sm text-emerald-600 font-medium">
              <Check className="w-4 h-4" /> Salvo
            </span>
          )}
          <button
            onClick={handleSaveSanity}
            disabled={savingSanity}
            className="flex items-center gap-1.5 px-5 py-2.5 text-sm font-semibold text-white bg-[#FF5B03] hover:bg-[#E14E00] disabled:opacity-60 rounded-xl shadow-sm transition-colors"
          >
            {savingSanity ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Salvar integração
          </button>
        </div>
      </div>
    </div>
  );
};

export default IntegrationsView;
