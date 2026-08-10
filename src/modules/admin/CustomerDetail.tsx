// Ficha 360 do cliente: header com as ações e as abas de conteúdo.
// Cada aba pesada vive no seu próprio arquivo — só a de "Uso" fica aqui, porque
// é uma leitura direta do resumo já carregado.

import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  CRM_STAGES,
  PIPELINE_LABELS,
  PIPELINE_STATUSES,
  STAGE_LABELS,
  type CustomerDetailPayload,
  type PipelineStatus,
} from '../../types/crm';
import { getCustomer, reconcile, setPipeline } from '../../services/adminService';
import {
  Card,
  ErrorBanner,
  HealthDot,
  Spinner,
  StageBadge,
  StagnantChip,
  formatDate,
  formatRelative,
  initials,
  whatsappHref,
} from './ui';
import CustomerOverview from './CustomerOverview';
import CustomerTimeline from './CustomerTimeline';
import CustomerNotes from './CustomerNotes';
import CreditAdjustModal from './CreditAdjustModal';
import CustomerWhatsApp from './CustomerWhatsApp';

type Tab = 'visao' | 'timeline' | 'uso' | 'whatsapp' | 'notas';

const TABS: { key: Tab; label: string }[] = [
  { key: 'visao', label: 'Visão geral' },
  { key: 'timeline', label: 'Timeline' },
  { key: 'uso', label: 'Uso' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'notas', label: 'Notas & Tarefas' },
];

export default function CustomerDetail() {
  const { uid = '' } = useParams<{ uid: string }>();
  const [customer, setCustomer] = useState<CustomerDetailPayload | null>(null);
  const [tab, setTab] = useState<Tab>('visao');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreditModal, setShowCreditModal] = useState(false);
  const [reconciling, setReconciling] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setCustomer(await getCustomer(uid));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [uid]);

  useEffect(() => {
    void load();
  }, [load]);

  async function changePipeline(status: PipelineStatus) {
    if (!customer?.crm) return;
    const previous = customer;
    setCustomer({ ...customer, crm: { ...customer.crm, pipelineStatus: status } });
    try {
      await setPipeline(uid, status);
    } catch (err) {
      setCustomer(previous);
      setError((err as Error).message);
    }
  }

  async function runReconcile() {
    setReconciling(true);
    try {
      await reconcile(uid);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setReconciling(false);
    }
  }

  if (loading) return <Spinner />;
  if (error && !customer) return <ErrorBanner message={error} />;
  if (!customer) return null;

  const wa = whatsappHref(String(customer.onboarding?.contact?.whatsapp ?? ''));
  const companyName =
    (customer.company?.nomeFantasia as string) || (customer.company?.razaoSocial as string) || '';

  return (
    <div className="space-y-4">
      <Link to="/admin/clientes" className="inline-block text-sm font-semibold text-slate-500 hover:text-slate-800">
        ← Clientes
      </Link>

      {error && <ErrorBanner message={error} />}

      <Card className="p-5">
        <div className="flex flex-wrap items-start gap-4">
          <span className="w-12 h-12 shrink-0 rounded-full bg-violet-100 text-violet-700 font-bold flex items-center justify-center">
            {initials(customer.displayName, customer.email)}
          </span>

          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-bold text-slate-800">{customer.displayName || 'Sem nome'}</h1>
            <p className="text-sm text-slate-500">{customer.email}</p>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
              {companyName && <span>{companyName}</span>}
              {customer.company?.cnpj ? <span>CNPJ {String(customer.company.cnpj)}</span> : null}
              {wa && (
                <a
                  href={wa}
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold text-emerald-600 hover:text-emerald-800"
                >
                  WhatsApp →
                </a>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={customer.crm?.pipelineStatus ?? 'novo'}
              onChange={(e) => void changePipeline(e.target.value as PipelineStatus)}
              disabled={!customer.crm}
              className="px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white disabled:opacity-50"
            >
              {PIPELINE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {PIPELINE_LABELS[s]}
                </option>
              ))}
            </select>
            <button
              onClick={() => setShowCreditModal(true)}
              className="px-3 py-2 rounded-lg bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700"
            >
              Ajustar créditos
            </button>
            <button
              onClick={runReconcile}
              disabled={reconciling}
              className="px-3 py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              {reconciling ? 'Reconciliando…' : 'Reconciliar'}
            </button>
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-slate-100 flex flex-wrap items-center gap-x-6 gap-y-2">
          {customer.crm ? (
            <>
              <StageBadge stage={customer.crm.stage} />
              {customer.stagnant ? (
                <StagnantChip days={customer.daysInStage} />
              ) : (
                <span className="text-xs text-slate-400">{customer.daysInStage}d no estágio</span>
              )}
              <HealthDot band={customer.crm.healthBand} score={customer.crm.healthScore} />
              <span className="text-xs text-slate-500">
                Último uso <strong className="text-slate-700">{formatRelative(customer.crm.lastSeenAt)}</strong>
              </span>
            </>
          ) : (
            <span className="text-xs text-amber-700">
              Cliente ainda não reconciliado — clique em “Reconciliar” para derivar a jornada.
            </span>
          )}
          <span className="text-xs text-slate-500">
            <strong className="text-slate-700">{customer.credits}</strong> créditos
          </span>
          <span className="text-xs text-slate-500">
            <strong className="text-slate-700">{customer.productCount}</strong> produtos
          </span>
        </div>
      </Card>

      <div className="flex items-center gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
              tab === t.key
                ? 'border-violet-600 text-violet-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'visao' && <CustomerOverview customer={customer} />}
      {tab === 'timeline' && <CustomerTimeline uid={uid} />}
      {tab === 'uso' && <UsageTab customer={customer} />}
      {tab === 'whatsapp' && (
        <CustomerWhatsApp
          uid={uid}
          whatsapp={customer.whatsapp}
          optOut={customer.crm?.whatsappOptOut === true}
          consent={customer.whatsappConsent}
          consentAt={customer.whatsappConsentAt}
          onOptOutChange={(value) =>
            setCustomer((c) => (c && c.crm ? { ...c, crm: { ...c.crm, whatsappOptOut: value } } : c))
          }
        />
      )}
      {tab === 'notas' && <CustomerNotes uid={uid} customerName={customer.displayName || customer.email} />}

      {showCreditModal && (
        <CreditAdjustModal
          uid={uid}
          currentCredits={customer.credits}
          onClose={() => setShowCreditModal(false)}
          onDone={(credits) => setCustomer((c) => (c ? { ...c, credits } : c))}
        />
      )}
    </div>
  );
}

function UsageTab({ customer }: { customer: CustomerDetailPayload }) {
  const crm = customer.crm;
  const counters: [string, number][] = [
    ['Produtos', crm?.counters.products ?? customer.productCount],
    ['Descrições', crm?.counters.descriptions ?? 0],
    ['Imagens', crm?.counters.images ?? 0],
    ['Exportações', crm?.counters.exports ?? 0],
    ['Syncs de ERP', crm?.counters.erpSyncs ?? 0],
    ['Operações (30d)', crm?.counters.aiOps30d ?? 0],
  ];

  const integrations: [string, boolean][] = [
    ['Tiny', customer.integrations.tiny],
    ['Bling', customer.integrations.bling],
    ['Wake', customer.integrations.wake],
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card className="p-5">
        <h2 className="text-sm font-bold text-slate-700">Uso da ferramenta</h2>
        <div className="mt-3 grid grid-cols-3 gap-3">
          {counters.map(([label, value]) => (
            <div key={label} className="p-3 rounded-lg bg-slate-50">
              <p className="text-xl font-bold text-slate-800">{value}</p>
              <p className="text-[11px] text-slate-500 leading-tight">{label}</p>
            </div>
          ))}
        </div>

        <h3 className="mt-5 text-xs font-bold text-slate-500 uppercase tracking-wide">Integrações</h3>
        <div className="mt-2 flex flex-wrap gap-2">
          {integrations.map(([name, on]) => (
            <span
              key={name}
              className={`px-2 py-1 rounded-lg text-xs font-semibold ${
                on ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-400'
              }`}
            >
              {name} {on ? '· conectado' : '· não conectado'}
            </span>
          ))}
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="text-sm font-bold text-slate-700">Marcos da jornada</h2>
        <ol className="mt-3 space-y-2">
          {CRM_STAGES.map((stage) => {
            const at = crm?.milestones[stage];
            return (
              <li key={stage} className="flex items-center gap-3">
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${at ? 'bg-violet-500' : 'bg-slate-200'}`}
                />
                <span className={`text-sm flex-1 ${at ? 'text-slate-700 font-medium' : 'text-slate-400'}`}>
                  {STAGE_LABELS[stage]}
                </span>
                <span className="text-xs text-slate-400">{at ? formatDate(at) : 'não atingido'}</span>
              </li>
            );
          })}
        </ol>
      </Card>
    </div>
  );
}
