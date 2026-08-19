// Aba "WhatsApp" da ficha: histórico de envios, envio manual e opt-out.
//
// O envio manual NÃO cria doc de idempotência com id de etapa, então não consome
// nem bloqueia a régua automática daquela etapa.

import { useCallback, useEffect, useState } from 'react';
import {
  STAGE_LABELS,
  TEMPLATE_TOKENS,
  type CrmMessage,
  type CrmStage,
  type WhatsAppStatus,
  type WhatsAppTemplateInfo,
} from '../../types/crm';
import {
  getWhatsAppStatus,
  listMessages,
  listTemplates,
  sendWhatsApp,
  setEmailOptOut,
  setOptOut,
} from '../../services/adminService';
import { Card, EmptyState, ErrorBanner, Spinner, formatDateTime, whatsappHref } from './ui';

export default function CustomerWhatsApp({
  uid,
  whatsapp,
  optOut,
  consent,
  consentAt,
  onOptOutChange,
  emailOptOut,
  onEmailOptOutChange,
}: {
  uid: string;
  whatsapp: string;
  optOut: boolean;
  consent: boolean;
  consentAt: string | null;
  onOptOutChange: (value: boolean) => void;
  emailOptOut: boolean;
  onEmailOptOutChange: (value: boolean) => void;
}) {
  const [status, setStatus] = useState<WhatsAppStatus | null>(null);
  const [templates, setTemplates] = useState<WhatsAppTemplateInfo[]>([]);
  const [messages, setMessages] = useState<CrmMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');

  const [templateName, setTemplateName] = useState('');
  const [params, setParams] = useState<string[]>([]);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, m] = await Promise.all([getWhatsAppStatus(), listMessages(uid)]);
      setStatus(s);
      setMessages(m.messages);
      if (s.configured) {
        try {
          setTemplates((await listTemplates()).templates);
        } catch {
          setTemplates([]);
        }
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [uid]);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = templates.find((t) => t.name === templateName);

  async function send() {
    if (!templateName) return;
    setSending(true);
    setError('');
    setOk('');
    try {
      const r = await sendWhatsApp(uid, {
        templateName,
        templateLanguage: selected?.language ?? 'pt_BR',
        bodyParams: params,
      });
      setOk(r.dryRun ? 'Envio simulado registrado (modo dry-run).' : 'Mensagem enviada.');
      setTemplateName('');
      setParams([]);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  async function flipOptOut() {
    const next = !optOut;
    onOptOutChange(next);
    try {
      await setOptOut(uid, next);
    } catch (err) {
      onOptOutChange(!next);
      setError((err as Error).message);
    }
  }

  async function flipEmailOptOut() {
    const next = !emailOptOut;
    onEmailOptOutChange(next);
    try {
      await setEmailOptOut(uid, next);
    } catch (err) {
      onEmailOptOutChange(!next);
      setError((err as Error).message);
    }
  }

  if (loading) return <Spinner />;

  const wa = whatsappHref(whatsapp);

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} />}
      {ok && (
        <div className="px-4 py-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-700">
          {ok}
        </div>
      )}

      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-slate-700">Contato</h2>
            <p className="mt-0.5 text-sm text-slate-600">
              {whatsapp || 'Não informado no onboarding'}
              {wa && (
                <a
                  href={wa}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-2 font-semibold text-emerald-600 hover:text-emerald-800"
                >
                  abrir conversa →
                </a>
              )}
            </p>
          </div>

          <div className="flex flex-col items-end gap-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={optOut} onChange={flipOptOut} className="accent-rose-600 w-4 h-4" />
              <span className="text-sm text-slate-600">
                Não enviar WhatsApp
                <span className="block text-xs text-slate-400">Bloqueia a régua de WhatsApp para este cliente</span>
              </span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={emailOptOut}
                onChange={flipEmailOptOut}
                className="accent-rose-600 w-4 h-4"
              />
              <span className="text-sm text-slate-600">
                Não enviar e-mail
                <span className="block text-xs text-slate-400">Bloqueia a régua de e-mail para este cliente</span>
              </span>
            </label>
          </div>
        </div>

        <div className="mt-4 pt-3 border-t border-slate-100">
          {consent ? (
            <p className="text-xs text-emerald-700">
              ✓ Autorizou contato por WhatsApp no onboarding
              {consentAt && <span className="text-slate-400"> · {formatDateTime(consentAt)}</span>}
            </p>
          ) : (
            <p className="text-xs text-amber-700">
              Sem autorização registrada — a régua automática <strong>não</strong> envia para este
              cliente. Contas criadas antes do texto de consentimento existir caem neste caso; use o
              envio manual só se tiver a autorização por outro meio.
            </p>
          )}
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="text-sm font-bold text-slate-700">Enviar template</h2>

        {!status?.configured ? (
          <p className="mt-2 text-sm text-amber-700">
            WhatsApp não configurado ({status?.missing.join(', ')}).
          </p>
        ) : !whatsapp.trim() ? (
          <p className="mt-2 text-sm text-slate-400">
            Este cliente não informou WhatsApp no onboarding, então não há para onde enviar.
          </p>
        ) : (
          <>
            <select
              value={templateName}
              onChange={(e) => {
                const t = templates.find((x) => x.name === e.target.value);
                setTemplateName(e.target.value);
                setParams(Array(t?.bodyParamCount ?? 0).fill(''));
              }}
              className="mt-3 w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
            >
              <option value="">
                {templates.length === 0 ? 'Nenhum template aprovado' : 'Escolha um template…'}
              </option>
              {templates.map((t) => (
                <option key={`${t.name}-${t.language}`} value={t.name}>
                  {t.name} ({t.language})
                </option>
              ))}
            </select>

            {selected && (
              <>
                <p className="mt-3 text-xs text-slate-500 whitespace-pre-wrap bg-slate-50 rounded-lg p-2.5">
                  {selected.bodyText}
                </p>
                {selected.bodyParamCount > 0 && (
                  <>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      {Array.from({ length: selected.bodyParamCount }, (_, i) => (
                        <label key={i} className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-400 shrink-0">{`{{${i + 1}}}`}</span>
                          <input
                            value={params[i] ?? ''}
                            onChange={(e) => {
                              const next = [...params];
                              next[i] = e.target.value;
                              setParams(next);
                            }}
                            placeholder="Ex.: {{nome}}"
                            className="flex-1 px-2 py-1.5 rounded-lg border border-slate-300 text-sm"
                          />
                        </label>
                      ))}
                    </div>
                    <p className="mt-1.5 text-xs text-slate-400">
                      Variáveis: {TEMPLATE_TOKENS.map((t) => t.token).join(' · ')}
                    </p>
                  </>
                )}
              </>
            )}

            <button
              onClick={send}
              disabled={sending || !templateName}
              className="mt-3 px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-40"
            >
              {sending ? 'Enviando…' : status.dryRun ? 'Enviar (simulação)' : 'Enviar'}
            </button>
          </>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="text-sm font-bold text-slate-700">Histórico de envios</h2>
        {messages.length === 0 ? (
          <EmptyState title="Nenhuma mensagem enviada" />
        ) : (
          <ul className="mt-3 divide-y divide-slate-100">
            {messages.map((m) => (
              <li key={m.id} className="py-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-xs font-bold text-slate-400 mr-1">
                  {m.channel === 'email' ? '✉️' : '💬'}
                </span>
                <span className="text-sm font-semibold text-slate-800">{m.template}</span>
                <span
                  className={`px-1.5 py-0.5 rounded text-[11px] font-bold ${
                    m.status === 'sent' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
                  }`}
                >
                  {m.status === 'sent' ? 'enviado' : 'falhou'}
                </span>
                {m.dryRun && (
                  <span className="px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 text-[11px] font-bold">
                    simulado
                  </span>
                )}
                <span className="text-xs text-slate-400">
                  {m.manual ? 'manual' : STAGE_LABELS[m.stage as CrmStage] ?? m.stage}
                </span>
                <span className="ml-auto text-xs text-slate-400">{formatDateTime(m.sentAt)}</span>
                {m.error && <p className="w-full text-xs text-rose-600">{m.error}</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
