import React, { useState } from 'react';
import { Plus, Trash2, RefreshCw, Check, Copy, ShieldCheck, Clock, KeyRound } from 'lucide-react';
import type { BlogSettings } from './types';
import {
  addBlogDomain, verifyBlogDomain, removeBlogDomain, saveBlogSettings, getBlogDomain, rotateBlogDomainToken,
} from '../../../services/blogService';

interface Props {
  uid: string;
  projectId: string;
  settings: BlogSettings;
}

type Instructions =
  | { kind: 'cname'; domain: string; cnameTarget: string; detail?: string }
  | { kind: 'proxy'; domain: string; proxyToken: string };

const cloudflareWorkerSnippet = (token: string) => `export default {
  async fetch(request) {
    const url = new URL(request.url);
    url.hostname = 'alfreds.com.br';
    const headers = new Headers(request.headers);
    headers.set('Host', 'alfreds.com.br');
    headers.set('X-Blog-Domain-Token', '${token}');
    return fetch(new Request(url, { method: request.method, headers, body: request.body, redirect: 'manual' }));
  },
};`;

const reverseProxySnippet = (token: string) => `location /blog {
  proxy_pass https://alfreds.com.br;
  proxy_set_header Host alfreds.com.br;
  proxy_set_header X-Blog-Domain-Token "${token}";
}`;

const BlogDomains: React.FC<Props> = ({ uid, projectId, settings }) => {
  const [domain, setDomain] = useState('');
  const [method, setMethod] = useState<'cname' | 'proxy'>('cname');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [instructions, setInstructions] = useState<Instructions | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [verifyDetail, setVerifyDetail] = useState<Record<string, string>>({});
  const [removingDomain, setRemovingDomain] = useState<string | null>(null);
  const [loadingToken, setLoadingToken] = useState<string | null>(null);

  const verifiedDomains = settings.verifiedDomains ?? [];
  const proxyDomains = settings.proxyDomains ?? [];

  const handleAdd = async () => {
    const trimmed = domain.trim().toLowerCase();
    if (!trimmed) return;
    setAdding(true);
    setError(null);
    try {
      const result = await addBlogDomain(projectId, trimmed, method);
      await saveBlogSettings(uid, projectId, {
        // Evita duplicar o domínio (e a key do React) ao readicionar um domínio já existente.
        customDomains: Array.from(new Set([...settings.customDomains, trimmed])),
        ...(result.method === 'proxy'
          ? { proxyDomains: Array.from(new Set([...proxyDomains, trimmed])) }
          : {}),
      });
      setInstructions(
        result.method === 'proxy'
          ? { kind: 'proxy', domain: result.domain, proxyToken: result.proxyToken }
          : { kind: 'cname', domain: result.domain, cnameTarget: result.cnameTarget, detail: result.detail },
      );
      setDomain('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao adicionar domínio');
    } finally {
      setAdding(false);
    }
  };

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  };

  const handleVerify = async (d: string) => {
    setVerifying(d);
    setVerifyDetail((prev) => ({ ...prev, [d]: '' }));
    try {
      const result = await verifyBlogDomain(projectId, d);
      if (result.verified) {
        await saveBlogSettings(uid, projectId, { verifiedDomains: Array.from(new Set([...verifiedDomains, d])) });
      } else {
        // `verified` espelha o estado atual (Cloudflare ou sondagem), então
        // pode voltar a ser falso — tira da lista para a UI não continuar
        // mostrando "Verificado" num domínio que parou de servir.
        if (verifiedDomains.includes(d)) {
          await saveBlogSettings(uid, projectId, { verifiedDomains: verifiedDomains.filter((x) => x !== d) });
        }
        setVerifyDetail((prev) => ({ ...prev, [d]: result.detail || 'Verificação pendente. Confira a configuração e tente novamente.' }));
      }
    } catch (e) {
      setVerifyDetail((prev) => ({ ...prev, [d]: e instanceof Error ? e.message : 'Erro ao verificar' }));
    } finally {
      setVerifying(null);
    }
  };

  const handleRemove = async (d: string) => {
    if (!window.confirm(`Remover o domínio "${d}"?`)) return;
    setRemovingDomain(d);
    try {
      await removeBlogDomain(projectId, d);
      await saveBlogSettings(uid, projectId, {
        customDomains: settings.customDomains.filter((x) => x !== d),
        verifiedDomains: verifiedDomains.filter((x) => x !== d),
        proxyDomains: proxyDomains.filter((x) => x !== d),
      });
      if (instructions?.domain === d) setInstructions(null);
    } finally {
      setRemovingDomain(null);
    }
  };

  const handleShowToken = async (d: string) => {
    setLoadingToken(d);
    try {
      const result = await getBlogDomain(projectId, d);
      if (result.method === 'proxy') {
        setInstructions({ kind: 'proxy', domain: d, proxyToken: result.proxyToken });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao buscar token');
    } finally {
      setLoadingToken(null);
    }
  };

  const handleRotateToken = async (d: string) => {
    if (!window.confirm(`Gerar um novo token para "${d}"? O token atual para de funcionar e o domínio volta a ficar pendente.`)) return;
    setLoadingToken(d);
    try {
      const result = await rotateBlogDomainToken(projectId, d);
      setInstructions({ kind: 'proxy', domain: d, proxyToken: result.proxyToken });
      if (verifiedDomains.includes(d)) {
        await saveBlogSettings(uid, projectId, { verifiedDomains: verifiedDomains.filter((x) => x !== d) });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao gerar novo token');
    } finally {
      setLoadingToken(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
        <h3 className="font-semibold text-slate-900 mb-4">Adicionar domínio</h3>
        {error && <div className="mb-3 text-sm text-red-400 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

        <div className="flex gap-2 mb-3.5">
          <button
            onClick={() => setMethod('cname')}
            className={`flex-1 text-sm font-medium px-3.5 py-2 rounded-xl border transition-colors ${
              method === 'cname' ? 'border-[#FF5B03] bg-[#FF5B03]/5 text-[#FF5B03]' : 'border-slate-200 text-slate-500 hover:bg-slate-50'
            }`}
          >
            Domínio ou subdomínio dedicado
          </button>
          <button
            onClick={() => setMethod('proxy')}
            className={`flex-1 text-sm font-medium px-3.5 py-2 rounded-xl border transition-colors ${
              method === 'proxy' ? 'border-[#FF5B03] bg-[#FF5B03]/5 text-[#FF5B03]' : 'border-slate-200 text-slate-500 hover:bg-slate-50'
            }`}
          >
            Caminho /blog no meu site atual
          </button>
        </div>
        <p className="text-xs text-slate-500 mb-3.5">
          {method === 'cname'
            ? 'O domínio (ou subdomínio) informado passa a servir o blog inteiro na raiz.'
            : 'Só o caminho /blog do domínio informado é encaminhado para cá — o resto do site continua onde está.'}
        </p>

        <div className="flex items-center gap-3">
          <input
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder={method === 'cname' ? 'blog.suaempresa.com.br' : 'suaempresa.com.br'}
            className="flex-1 border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF5B03]/30 focus:border-[#FF5B03]"
          />
          <button
            onClick={handleAdd}
            disabled={adding || !domain.trim()}
            className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold text-white bg-[#FF5B03] hover:bg-[#E14E00] disabled:opacity-60 rounded-xl shadow-sm transition-colors shrink-0"
          >
            {adding ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Adicionar
          </button>
        </div>
      </div>

      {instructions?.kind === 'cname' && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
          <h3 className="font-semibold text-slate-900 mb-1">Configuração de DNS para {instructions.domain}</h3>
          <p className="text-sm text-slate-500 mb-4">
            Crie o registro abaixo no seu provedor de DNS e depois clique em "Verificar". É o único
            registro necessário.
          </p>

          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5">
            <p className="text-xs font-semibold text-slate-500 mb-2">Registro CNAME</p>
            <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1.5 text-sm">
              <span className="text-xs text-slate-400">Nome</span>
              <code className="text-slate-800 break-all">{instructions.domain}</code>
              <span />
              <span className="text-xs text-slate-400">Valor</span>
              <code className="text-slate-800 break-all">{instructions.cnameTarget}</code>
              <button
                onClick={() => handleCopy(instructions.cnameTarget, 'cname')}
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-md shrink-0"
                title="Copiar"
              >
                {copied === 'cname' ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <p className="text-xs text-slate-500 mt-3">
            O certificado HTTPS é emitido automaticamente, mas só depois que o CNAME estiver no ar —
            costuma levar alguns minutos. Se já existir um registro A ou CNAME com esse mesmo nome,
            remova antes, senão a emissão fica travada.
          </p>
        </div>
      )}

      {instructions?.kind === 'proxy' && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 space-y-4">
          <div>
            <h3 className="font-semibold text-slate-900 mb-1">Configuração do caminho /blog para {instructions.domain}</h3>
            <p className="text-sm text-slate-500">
              Esse token autentica só este domínio — não reaproveite em outro lugar. Configure o
              encaminhamento de <code>/blog</code> usando um dos exemplos abaixo e depois clique em
              "Verificar" na lista.
            </p>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-500 mb-1">Token do domínio</p>
                <code className="text-slate-800 break-all text-sm">{instructions.proxyToken}</code>
              </div>
              <button
                onClick={() => handleCopy(instructions.proxyToken, 'token')}
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-md shrink-0"
                title="Copiar"
              >
                {copied === 'token' ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-xs font-semibold text-slate-500">Cloudflare Worker Route (se o domínio estiver na Cloudflare)</p>
              <button
                onClick={() => handleCopy(cloudflareWorkerSnippet(instructions.proxyToken), 'worker')}
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-md shrink-0"
                title="Copiar"
              >
                {copied === 'worker' ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
            <pre className="bg-slate-900 text-slate-100 text-xs rounded-xl p-3.5 overflow-x-auto"><code>{cloudflareWorkerSnippet(instructions.proxyToken)}</code></pre>
            <p className="text-xs text-slate-500 mt-1.5">Crie uma Worker Route escopada a {instructions.domain}/blog* — não use o wildcard da zona inteira.</p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-xs font-semibold text-slate-500">Reverse proxy genérico (Nginx, Apache/cPanel, API Gateway)</p>
              <button
                onClick={() => handleCopy(reverseProxySnippet(instructions.proxyToken), 'proxy')}
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-md shrink-0"
                title="Copiar"
              >
                {copied === 'proxy' ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
            <pre className="bg-slate-900 text-slate-100 text-xs rounded-xl p-3.5 overflow-x-auto"><code>{reverseProxySnippet(instructions.proxyToken)}</code></pre>
            <p className="text-xs text-slate-500 mt-1.5">Sintaxe de exemplo em Nginx — adapte pro seu gateway mantendo os dois headers.</p>
          </div>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
        <h3 className="font-semibold text-slate-900 mb-4">Domínios configurados</h3>
        {settings.customDomains.length === 0 ? (
          <p className="text-sm text-slate-400">Nenhum domínio adicionado ainda.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {settings.customDomains.map((d) => {
              const isVerified = verifiedDomains.includes(d);
              const isProxy = proxyDomains.includes(d);
              return (
                <div key={d} className="py-3.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-medium text-slate-900 truncate">{d}</span>
                      <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 shrink-0">
                        {isProxy ? '/blog' : 'domínio'}
                      </span>
                      {isVerified ? (
                        <span className="flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 shrink-0">
                          <ShieldCheck className="w-3 h-3" /> Verificado
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 shrink-0">
                          <Clock className="w-3 h-3" /> Pendente
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {isProxy && (
                        <button
                          onClick={() => handleShowToken(d)}
                          disabled={loadingToken === d}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 shadow-sm hover:bg-slate-50 disabled:opacity-60 rounded-lg transition-colors"
                          title="Ver token e instruções"
                        >
                          {loadingToken === d ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
                          Token
                        </button>
                      )}
                      <button
                        onClick={() => handleVerify(d)}
                        disabled={verifying === d}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 shadow-sm hover:bg-slate-50 disabled:opacity-60 rounded-lg transition-colors"
                      >
                        {verifying === d ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                        Verificar
                      </button>
                      <button
                        onClick={() => handleRemove(d)}
                        disabled={removingDomain === d}
                        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-60 rounded-lg transition-colors"
                        title="Remover"
                      >
                        {removingDomain === d ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                  {verifyDetail[d] && (
                    <p className="text-xs text-red-400 mt-1.5">{verifyDetail[d]}</p>
                  )}
                  {isProxy && (
                    <button
                      onClick={() => handleRotateToken(d)}
                      disabled={loadingToken === d}
                      className="text-xs text-slate-400 hover:text-slate-700 mt-1.5 underline disabled:opacity-60"
                    >
                      Gerar novo token
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default BlogDomains;
