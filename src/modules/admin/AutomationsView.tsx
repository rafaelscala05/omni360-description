// Automações de WhatsApp: uma linha por coluna do Kanban, na ordem da jornada.
// É assim que a pessoa pensa sobre o problema — "o que mando quando o cliente
// chega/trava nesta etapa" — então a UI espelha o board em vez de virar um editor
// de regras genérico.

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
  type WhatsAppStatus,
  type WhatsAppTemplateInfo,
} from '../../types/crm';
import {
  getWhatsAppStatus,
  listAutomations,
  listTemplates,
  runAutomations,
  saveAutomation,
} from '../../services/adminService';
import { Card, ErrorBanner, Spinner } from './ui';

export default function AutomationsView() {
  const [status, setStatus] = useState<WhatsAppStatus | null>(null);
  const [templates, setTemplates] = useState<WhatsAppTemplateInfo[]>([]);
  const [templatesError, setTemplatesError] = useState('');
  const [automations, setAutomations] = useState<Record<CrmStage, CrmAutomation>>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [s, a] = await Promise.all([getWhatsAppStatus(), listAutomations()]);
      setStatus(s);
      const map = {} as Record<CrmStage, CrmAutomation>;
      for (const stage of CRM_STAGES) {
        map[stage] = a.automations.find((x) => x.stage === stage) ?? defaultAutomation(stage);
      }
      setAutomations(map);

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

  async function persist(stage: CrmStage, patch: Partial<CrmAutomation>) {
    if (!automations) return;
    const previous = automations;
    const next = { ...automations[stage], ...patch };
    setAutomations({ ...automations, [stage]: next });
    setError('');
    try {
      await saveAutomation(stage, next);
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
  if (!automations || !status) return error ? <ErrorBanner message={error} /> : null;

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

      {templatesError && (
        <ErrorBanner message={`Não foi possível carregar os templates da Meta: ${templatesError}`} />
      )}

      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-slate-500">
          Uma automação por coluna do Kanban. O envio respeita opt-out, horário comercial (9h–20h) e
          nunca repete a mesma etapa para o mesmo cliente.
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
          <AutomationRow
            key={stage}
            stage={stage}
            automation={automations[stage]}
            templates={templates}
            onChange={(patch) => persist(stage, patch)}
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

function AutomationRow({
  stage,
  automation,
  templates,
  onChange,
}: {
  stage: CrmStage;
  automation: CrmAutomation;
  templates: WhatsAppTemplateInfo[];
  onChange: (patch: Partial<CrmAutomation>) => void;
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
    <Card className={`p-4 ${automation.active ? 'border-violet-300' : ''}`}>
      {/* Largura fixa no rótulo para os controles alinharem entre as linhas —
          sem isso cada etapa empurra os selects para uma posição diferente. */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 cursor-pointer w-full sm:w-56 shrink-0">
          <input
            type="checkbox"
            checked={automation.active}
            onChange={(e) => onChange({ active: e.target.checked })}
            className="accent-violet-600 w-4 h-4 shrink-0"
          />
          <span className="font-semibold text-sm text-slate-800">{STAGE_LABELS[stage]}</span>
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
      </div>

      <p className="mt-2 sm:ml-56 text-xs text-slate-400">
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
    </Card>
  );
}
