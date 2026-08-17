import React, { useState } from 'react';
import { Plug, RefreshCw, Check, Globe, ScrollText, Search } from 'lucide-react';
import type { ContentProject } from './types';
import {
  updateProjectConfig, saveWordpressSecret, saveSanitySecret,
  fetchSanitySchemaTypes, fetchSanitySchemaFields,
  type SanitySchemaType, type SanitySchemaField,
} from '../../services/contentService';
import PublishLogsPanel from './PublishLogsPanel';

// Escolhe o campo mais provável para um papel (corpo/categoria/nome) a partir
// da "natureza" inferida de cada campo amostrado — só usado para pré-preencher;
// o usuário sempre pode trocar pelo <select> antes de salvar.
function guessField(fields: SanitySchemaField[], kind: SanitySchemaField['kind'], preferNames: string[]): string | undefined {
  const candidatos = fields.filter((f) => f.kind === kind);
  const preferido = candidatos.find((f) => preferNames.includes(f.field.toLowerCase()));
  return (preferido ?? candidatos[0])?.field;
}

function guessType(types: SanitySchemaType[], patterns: RegExp): string | undefined {
  return types.find((t) => patterns.test(t.type))?.type;
}

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
  const [sanityDocType, setSanityDocType] = useState(project.config.sanityDocType ?? '');
  const [sanityBodyField, setSanityBodyField] = useState(project.config.sanityBodyField ?? '');
  const [sanityCategoryField, setSanityCategoryField] = useState(project.config.sanityCategoryField ?? '');
  const [sanityCategoryType, setSanityCategoryType] = useState(project.config.sanityCategoryType ?? '');
  const [sanityCategoryNameField, setSanityCategoryNameField] = useState(project.config.sanityCategoryNameField ?? '');
  const [showSanitySchema, setShowSanitySchema] = useState(false);
  const [sanityToken, setSanityToken] = useState('');
  const [savingSanity, setSavingSanity] = useState(false);
  const [savedSanity, setSavedSanity] = useState(false);
  const [errorSanity, setErrorSanity] = useState<string | null>(null);
  const [logsOpen, setLogsOpen] = useState(false);

  // Estado da checagem de schema: tipos/campos amostrados do dataset real,
  // usados só para popular os <datalist> e sugerir valores — nunca salvos
  // até o usuário clicar em "Salvar integração".
  const [schemaTypes, setSchemaTypes] = useState<SanitySchemaType[]>([]);
  const [docTypeFields, setDocTypeFields] = useState<SanitySchemaField[]>([]);
  const [categoryTypeFields, setCategoryTypeFields] = useState<SanitySchemaField[]>([]);
  const [checkingSchema, setCheckingSchema] = useState(false);
  const [schemaMsg, setSchemaMsg] = useState<string | null>(null);
  const [schemaMsgIsError, setSchemaMsgIsError] = useState(false);

  const checkSchema = async () => {
    setCheckingSchema(true);
    setSchemaMsg(null);
    setSchemaMsgIsError(false);
    setShowSanitySchema(true);
    try {
      const types = await fetchSanitySchemaTypes(project.id);
      setSchemaTypes(types);
      if (!types.length) {
        setSchemaMsgIsError(false);
        setSchemaMsg('Não encontramos documentos no dataset ainda — publique um artigo de teste e verifique de novo, ou configure os campos manualmente abaixo.');
        return;
      }

      const guessedDocType = sanityDocType.trim() || guessType(types, /post|article|blog|noticia|not[íi]cia/i) || types[0].type;
      const guessedCategoryType = sanityCategoryType.trim() || guessType(types, /categor|tag|topic|assunto/i);
      if (!sanityDocType.trim()) setSanityDocType(guessedDocType);
      if (!sanityCategoryType.trim() && guessedCategoryType) setSanityCategoryType(guessedCategoryType);

      const [docFields, catFields] = await Promise.all([
        fetchSanitySchemaFields(project.id, guessedDocType),
        guessedCategoryType ? fetchSanitySchemaFields(project.id, guessedCategoryType) : Promise.resolve([]),
      ]);
      setDocTypeFields(docFields);
      setCategoryTypeFields(catFields);

      if (!sanityBodyField.trim()) {
        const corpo = guessField(docFields, 'portableText', ['body', 'content', 'conteudo', 'conteúdo', 'texto']);
        if (corpo) setSanityBodyField(corpo);
      }
      if (!sanityCategoryField.trim()) {
        const cat = guessField(docFields, 'referenceArray', ['categories', 'category', 'categorias', 'tags']);
        if (cat) setSanityCategoryField(cat);
      }
      if (!sanityCategoryNameField.trim() && catFields.length) {
        const nome = guessField(catFields, 'string', ['title', 'name', 'nome', 'titulo', 'título']);
        if (nome) setSanityCategoryNameField(nome);
      }

      const partes = [`tipo de artigo "${guessedDocType}"`];
      if (guessedCategoryType) partes.push(`tipo de categoria "${guessedCategoryType}"`);
      setSchemaMsg(`Schema verificado: ${types.length} tipo(s) encontrado(s) no dataset, ${partes.join(', ')}. Confira os campos sugeridos abaixo antes de salvar.`);
    } catch (e) {
      setSchemaMsgIsError(true);
      setSchemaMsg(e instanceof Error ? e.message : 'Não consegui verificar o schema.');
    } finally {
      setCheckingSchema(false);
    }
  };

  // Troca manual de tipo (usuário editou o campo/select) também busca os
  // campos daquele tipo, pra manter os <datalist> de baixo em dia.
  const refreshDocTypeFields = async (type: string) => {
    if (!type.trim()) { setDocTypeFields([]); return; }
    try { setDocTypeFields(await fetchSanitySchemaFields(project.id, type.trim())); } catch { /* silencioso: só afeta sugestões */ }
  };
  const refreshCategoryTypeFields = async (type: string) => {
    if (!type.trim()) { setCategoryTypeFields([]); return; }
    try { setCategoryTypeFields(await fetchSanitySchemaFields(project.id, type.trim())); } catch { /* silencioso: só afeta sugestões */ }
  };

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
        sanityDocType: sanityDocType.trim(),
        sanityBodyField: sanityBodyField.trim(),
        sanityCategoryField: sanityCategoryField.trim(),
        sanityCategoryType: sanityCategoryType.trim(),
        sanityCategoryNameField: sanityCategoryNameField.trim(),
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
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setLogsOpen(true)}
              className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800 px-2.5 py-1 rounded-full hover:bg-slate-100"
              title="Ver o que foi enviado em cada publicação"
            >
              <ScrollText className="w-3.5 h-3.5" /> Logs de envio
            </button>
            <span className={`text-[11px] font-medium px-2.5 py-1 rounded-full ${sanityConnected ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
              {sanityConnected ? 'Conectado' : 'Não conectado'}
            </span>
          </div>
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

          <div className="border-t border-slate-100 pt-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <button
                type="button"
                onClick={() => setShowSanitySchema((v) => !v)}
                className="text-xs font-semibold text-slate-600 hover:text-slate-900"
              >
                {showSanitySchema ? '▾' : '▸'} Schema do projeto (avançado)
              </button>
              <button
                type="button"
                onClick={checkSchema}
                disabled={checkingSchema || !sanityProjectId.trim()}
                className="flex items-center gap-1.5 text-xs font-semibold text-[#FF5B03] hover:text-[#E14E00] disabled:opacity-50 disabled:cursor-not-allowed"
                title={sanityProjectId.trim() ? 'Amostra o dataset e sugere os campos abaixo' : 'Informe o Project ID primeiro'}
              >
                {checkingSchema ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />} Verificar schema
              </button>
            </div>
            <p className="text-xs text-slate-400 mt-1">Cada projeto Sanity define seus próprios nomes de tipo/campo — é isso que diz para onde cada artigo é enviado. "Verificar schema" olha os documentos já existentes no seu dataset e pré-preenche os campos abaixo; ajuste e clique em Salvar. Deixe em branco para usar os padrões do starter do Sanity.</p>
            {schemaMsg && (
              <p className={`text-xs mt-2 rounded-lg px-3 py-2 ${schemaMsgIsError ? 'text-red-600 bg-red-50 border border-red-200' : 'text-emerald-700 bg-emerald-50 border border-emerald-200'}`}>
                {schemaMsg}
              </p>
            )}

            {showSanitySchema && (
              <div className="mt-3 grid sm:grid-cols-2 gap-4">
                <datalist id="sanity-types">
                  {schemaTypes.map((t) => <option key={t.type} value={t.type}>{`${t.type} (${t.count} doc${t.count === 1 ? '' : 's'})`}</option>)}
                </datalist>
                <datalist id="sanity-doc-fields">
                  {docTypeFields.map((f) => <option key={f.field} value={f.field}>{f.kind}</option>)}
                </datalist>
                <datalist id="sanity-cat-fields">
                  {categoryTypeFields.map((f) => <option key={f.field} value={f.field}>{f.kind}</option>)}
                </datalist>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">Tipo do documento do artigo</label>
                  <input
                    value={sanityDocType}
                    onChange={(e) => setSanityDocType(e.target.value)}
                    onBlur={(e) => refreshDocTypeFields(e.target.value)}
                    list="sanity-types"
                    placeholder="post"
                    className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF5B03]/30 focus:border-[#FF5B03]"
                  />
                  <p className="text-xs text-slate-400 mt-1">O <code>_type</code> usado no schema do cliente para artigos (ex.: <code>post</code>, <code>article</code>, <code>blogPost</code>).</p>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">Campo de corpo/conteúdo</label>
                  <input
                    value={sanityBodyField}
                    onChange={(e) => setSanityBodyField(e.target.value)}
                    list="sanity-doc-fields"
                    placeholder="body"
                    className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF5B03]/30 focus:border-[#FF5B03]"
                  />
                  <p className="text-xs text-slate-400 mt-1">Campo de texto rico onde o artigo é escrito. Errado aqui = artigo publica "vazio" (o frontend do cliente lê outro campo).</p>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">Campo de categoria no artigo</label>
                  <input
                    value={sanityCategoryField}
                    onChange={(e) => setSanityCategoryField(e.target.value)}
                    list="sanity-doc-fields"
                    placeholder="categories"
                    className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF5B03]/30 focus:border-[#FF5B03]"
                  />
                  <p className="text-xs text-slate-400 mt-1">Nome do campo que guarda a referência à categoria. Vazio = publica sem vincular categoria.</p>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">Tipo do documento de categoria</label>
                  <input
                    value={sanityCategoryType}
                    onChange={(e) => setSanityCategoryType(e.target.value)}
                    onBlur={(e) => refreshCategoryTypeFields(e.target.value)}
                    list="sanity-types"
                    placeholder="category"
                    className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF5B03]/30 focus:border-[#FF5B03]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">Campo do nome na categoria</label>
                  <input
                    value={sanityCategoryNameField}
                    onChange={(e) => setSanityCategoryNameField(e.target.value)}
                    list="sanity-cat-fields"
                    placeholder="title"
                    className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF5B03]/30 focus:border-[#FF5B03]"
                  />
                </div>
                <p className="sm:col-span-2 text-xs text-slate-400">A categoria de cada artigo vem do cluster de SEO ao qual ele pertence (tela de Clusters). Publicar cria o documento de categoria no Sanity se ele ainda não existir (por nome) e referencia esse documento no artigo — sem sobrescrever categorias já editadas direto no Studio.</p>
              </div>
            )}
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

      <PublishLogsPanel projectId={project.id} aberto={logsOpen} onFechar={() => setLogsOpen(false)} />
    </div>
  );
};

export default IntegrationsView;
