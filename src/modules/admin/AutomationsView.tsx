// Automações de WhatsApp: um Card por coluna do Kanban, cada um com sua
// própria lista de automações (spec 3). Continua espelhando o board — "o que
// mando quando o cliente chega/trava nesta etapa" — mas agora cada etapa pode
// ter N réguas independentes (ex.: "1h depois" e "10h depois"), não mais só
// uma.

import { useCallback, useEffect, useState } from 'react';
import {
  CRM_STAGES,
  STAGE_LABELS,
  STAGNATION_DAYS,
  TEMPLATE_TOKENS,
  TRIGGER_LABELS,
  defaultAutomation,
  type AutomationTrigger,
  type CrmAutomation,
  type CrmStage,
  type EmailStatus,
  type WhatsAppStatus,
  type WhatsAppTemplateInfo,
} from '../../types/crm';
import {
  createAutomation,
  deleteAutomation,
  getEmailStatus,
  getWhatsAppStatus,
  listAutomations,
  listTemplates,
  runAutomations,
  updateAutomation,
} from '../../services/adminService';
import { Card, ErrorBanner, Spinner } from './ui';

export default function AutomationsView() {
  const [status, setStatus] = useState<WhatsAppStatus | null>(null);
  const [emailStatus, setEmailStatus] = useState<EmailStatus | null>(null);
  const [templates, setTemplates] = useState<WhatsAppTemplateInfo[]>([]);
  const [templatesError, setTemplatesError] = useState('');
  const [automations, setAutomations] = useState<CrmAutomation[]>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [s, es, a] = await Promise.all([getWhatsAppStatus(), getEmailStatus(), listAutomations()]);
      setStatus(s);
      setEmailStatus(es);
      setAutomations(a.automations);

      // Templates só existem se o provider estiver configurado; a falha aqui não
      // pode impedir de ver/editar o resto da tela.
      if (s.configured) {
        try {
          setTemplates((await listTemplates()).templates);
          setTemplatesError('');
        } catch (err) {
          setTemplatesError((err as Error).message);
        }
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function addAutomation(stage: CrmStage) {
    if (!automations) return;
    setError('');
    try {
      const { automation } = await createAutomation(stage, defaultAutomation(stage));
      setAutomations([...automations, automation]);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function persist(id: string, patch: Partial<CrmAutomation>) {
    if (!automations) return;
    const previous = automations;
    const next = automations.map((a) => (a.id === id ? { ...a, ...patch } : a));
    setAutomations(next);
    setError('');
    try {
      const target = next.find((a) => a.id === id)!;
      await updateAutomation(id, target);
    } catch (err) {
      setAutomations(previous);
      setError((err as Error).message);
    }
  }

  async function remove(id: string) {
    if (!automations) return;
    const previous = automations;
    setAutomations(automations.filter((a) => a.id !== id));
    setError('');
    try {
      await deleteAutomation(id);
    } catch (err) {
      setAutomations(previous);
      setError((err as Error).message);
    }
  }

  async function run() {
    setRunning(true);
    setRunResult('');
    try {
      const r = await runAutomations();
      setRunResult(
        r.reason
          ? r.reason
          : `${r.evaluated} clientes avaliados · ${r.sent} enviados · ${r.failed} falhas · ${r.skipped} pulados${r.dryRun ? ' (simulação)' : ''}`,
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  }

  if (loading) return <Spinner />;
  if (!automations || !status || !emailStatus) return error ? <ErrorBanner message={error} /> : null;

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} />}

      {!status.configured && (
        <div className="px-4 py-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800">
          <p className="font-bold">WhatsApp Oficial não configurado</p>
          <p className="mt-1">
            Defina no ambiente:{' '}
            {status.missing.map((m) => (
              <code key={m} className="mx-0.5 px-1 py-0.5 rounded bg-amber-100 text-xs">
                {m}
              </code>
            ))}
            . Você pode configurar as automações agora — elas só começam a disparar quando as
            credenciais existirem.
          </p>
        </div>
      )}

      {status.dryRun && (
        <div className="px-4 py-3 rounded-lg bg-sky-50 border border-sky-200 text-sm text-sky-800">
          <strong>Modo simulação ligado</strong> (<code>WHATSAPP_DRY_RUN=true</code>). Os envios são
          registrados no histórico mas nenhuma mensagem sai de verdade. Use para validar a régua antes
          de apontar para clientes reais.
        </div>
      )}

      {emailStatus && !emailStatus.configured && (
        <div className="px-4 py-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800">
          <p className="font-bold">E-mail (SMTP) não configurado</p>
          <p className="mt-1">
            Defina no ambiente:{' '}
            {emailStatus.missing.map((m) => (
              <code key={m} className="mx-0.5 px-1 py-0.5 rounded bg-amber-100 text-xs">
                {m}
              </code>
            ))}
            . Você pode configurar as automações agora — o e-mail só começa a disparar quando as
            credenciais SMTP existirem.
          </p>
        </div>
      )}

      {emailStatus?.dryRun && (
        <div className="px-4 py-3 rounded-lg bg-sky-50 border border-sky-200 text-sm text-sky-800">
          <strong>Modo simulação de e-mail ligado</strong> (<code>EMAIL_DRY_RUN=true</code>). Os envios
          são registrados no histórico mas nenhum e-mail sai de verdade.
        </div>
      )}

      {templatesError && (
        <ErrorBanner message={`Não foi possível carregar os templates da Meta: ${templatesError}`} />
      )}

      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-slate-500">
          Cada coluna pode ter várias automações independentes. O envio respeita opt-out, horário
          comercial (9h–20h) e nunca repete a mesma automação para o mesmo cliente.
        </p>
        <button
          onClick={run}
          disabled={running}
          className="ml-auto px-3 py-1.5 rounded-lg border border-slate-300 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          {running ? 'Rodando…' : 'Rodar agora'}
        </button>
      </div>

      {runResult && (
        <div className="px-4 py-2.5 rounded-lg bg-slate-100 text-sm text-slate-700">{runResult}</div>
      )}

      <div className="space-y-3">
        {CRM_STAGES.map((stage) => (
          <StageCard
            key={stage}
            stage={stage}
            automations={automations.filter((a) => a.stage === stage)}
            templates={templates}
            onAdd={() => addAutomation(stage)}
            onChange={(id, patch) => persist(id, patch)}
            onRemove={(id) => remove(id)}
          />
        ))}
      </div>

      <Card className="p-5">
        <h2 className="text-sm font-bold text-slate-700">Variáveis disponíveis</h2>
        <p className="mt-1 text-xs text-slate-500">
          Use nos parâmetros do template. Qualquer outro texto é enviado literal.
        </p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {TEMPLATE_TOKENS.map((t) => (
            <li key={t.token} className="flex items-baseline gap-2">
              <code className="px-1.5 py-0.5 rounded bg-slate-100 text-xs font-bold text-violet-700">
                {t.token}
              </code>
              <span className="text-xs text-slate-500">{t.description}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function StageCard({
  stage,
  automations,
  templates,
  onAdd,
  onChange,
  onRemove,
}: {
  stage: CrmStage;
  automations: CrmAutomation[];
  templates: WhatsAppTemplateInfo[];
  onAdd: () => void;
  onChange: (id: string, patch: Partial<CrmAutomation>) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm text-slate-800">{STAGE_LABELS[stage]}</h3>
        <button
          onClick={onAdd}
          className="px-2.5 py-1 rounded-lg border border-slate-300 text-xs font-semibold text-slate-600 hover:bg-slate-50"
        >
          + Adicionar automação
        </button>
      </div>

      {automations.length === 0 ? (
        <p className="mt-2 text-xs text-slate-400">Nenhuma automação configurada nesta etapa.</p>
      ) : (
        <div className="mt-3 space-y-3">
          {automations.map((automation) => (
            <AutomationRow
              key={automation.id}
              stage={stage}
              automation={automation}
              templates={templates}
              onChange={(patch) => onChange(automation.id, patch)}
              onRemove={() => onRemove(automation.id)}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

function AutomationRow({
  stage,
  automation,
  templates,
  onChange,
  onRemove,
}: {
  stage: CrmStage;
  automation: CrmAutomation;
  templates: WhatsAppTemplateInfo[];
  onChange: (patch: Partial<CrmAutomation>) => void;
  onRemove: () => void;
}) {
  const selected = templates.find((t) => t.name === automation.templateName);
  const expected = selected?.bodyParamCount ?? automation.bodyParams.length;

  function setParam(i: number, value: string) {
    const next = [...automation.bodyParams];
    while (next.length < expected) next.push('');
    next[i] = value;
    onChange({ bodyParams: next.slice(0, expected) });
  }

  return (
    <div className={`p-3 rounded-lg border ${automation.active ? 'border-violet-300' : 'border-slate-200'}`}>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 cursor-pointer w-full sm:w-32 shrink-0">
          <input
            type="checkbox"
            checked={automation.active}
            onChange={(e) => onChange({ active: e.target.checked })}
            className="accent-violet-600 w-4 h-4 shrink-0"
          />
          <span className="text-sm text-slate-600">Ativa</span>
        </label>

        <select
          value={automation.trigger}
          onChange={(e) => onChange({ trigger: e.target.value as AutomationTrigger })}
          className="w-44 shrink-0 px-2.5 py-1.5 rounded-lg border border-slate-300 text-sm bg-white"
        >
          {(['entered', 'stagnant'] as AutomationTrigger[]).map((t) => (
            <option key={t} value={t}>
              {TRIGGER_LABELS[t]}
            </option>
          ))}
        </select>

        <label className="flex items-center gap-1.5 text-sm text-slate-500 shrink-0">
          após
          <input
            type="number"
            min={0}
            max={720}
            value={automation.delayHours}
            onChange={(e) => onChange({ delayHours: Number(e.target.value) || 0 })}
            className="w-20 px-2 py-1.5 rounded-lg border border-slate-300 text-sm"
          />
          h
        </label>

        <select
          value={automation.templateName}
          onChange={(e) => {
            const t = templates.find((x) => x.name === e.target.value);
            onChange({
              templateName: e.target.value,
              templateLanguage: t?.language ?? automation.templateLanguage,
              bodyParams: Array(t?.bodyParamCount ?? 0).fill(''),
            });
          }}
          className="flex-1 min-w-48 px-2.5 py-1.5 rounded-lg border border-slate-300 text-sm bg-white"
        >
          <option value="">
            {templates.length === 0 ? 'Nenhum template disponível' : 'Escolha um template…'}
          </option>
          {templates.map((t) => (
            <option key={`${t.name}-${t.language}`} value={t.name}>
              {t.name} ({t.language})
            </option>
          ))}
        </select>

        <button
          onClick={onRemove}
          className="shrink-0 px-2.5 py-1.5 rounded-lg border border-red-200 text-xs font-semibold text-red-600 hover:bg-red-50"
        >
          Remover
        </button>
      </div>

      <p className="mt-2 text-xs text-slate-400">
        {automation.trigger === 'stagnant'
          ? Number.isFinite(STAGNATION_DAYS[stage])
            ? `Dispara quando o cliente passa de ${STAGNATION_DAYS[stage]} dias nesta etapa.`
            : 'Esta etapa é final — não existe “travado” aqui, então este gatilho nunca dispara. Use “ao entrar”.'
          : 'Dispara assim que o cliente chega nesta etapa.'}
        {automation.delayHours > 0 && ` Espera mais ${automation.delayHours}h antes de enviar.`}
      </p>

      {selected && (
        <div className="mt-3 pt-3 border-t border-slate-100">
          <p className="text-xs text-slate-500 whitespace-pre-wrap bg-slate-50 rounded-lg p-2.5">
            {selected.bodyText}
          </p>
          {expected > 0 && (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {Array.from({ length: expected }, (_, i) => (
                <label key={i} className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-400 shrink-0">{`{{${i + 1}}}`}</span>
                  <input
                    value={automation.bodyParams[i] ?? ''}
                    onChange={(e) => setParam(i, e.target.value)}
                    placeholder="Ex.: {{nome}}"
                    className="flex-1 px-2 py-1.5 rounded-lg border border-slate-300 text-sm"
                  />
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mt-3 pt-3 border-t border-slate-100">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={automation.emailEnabled}
            onChange={(e) => onChange({ emailEnabled: e.target.checked })}
            className="accent-violet-600 w-4 h-4 shrink-0"
          />
          <span className="text-sm text-slate-600">Também enviar e-mail</span>
        </label>

        {automation.emailEnabled && (
          <div className="mt-2 space-y-2">
            <input
              value={automation.emailSubject}
              onChange={(e) => onChange({ emailSubject: e.target.value })}
              placeholder="Assunto do e-mail"
              className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-sm"
            />
            <textarea
              value={automation.emailBody}
              onChange={(e) => onChange({ emailBody: e.target.value })}
              placeholder="Corpo do e-mail (HTML). Use {{nome}}, {{empresa}} etc."
              rows={5}
              className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-sm font-mono"
            />
          </div>
        )}
      </div>
    </div>
  );
}
