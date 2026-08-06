// Lista de clientes: tabela densa com busca e filtros. É a visão para procurar
// alguém específico ou fatiar a base; o kanban é para ver a distribuição.

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  CRM_STAGES,
  HEALTH_BAND_LABELS,
  PIPELINE_LABELS,
  PIPELINE_STATUSES,
  STAGE_LABELS,
  type CustomerListItem,
  type HealthBand,
} from '../../types/crm';
import { listCustomers } from '../../services/adminService';
import {
  Card,
  EmptyState,
  ErrorBanner,
  HealthDot,
  PipelineBadge,
  Spinner,
  StageBadge,
  StagnantChip,
  formatRelative,
} from './ui';

const HEALTH_BANDS: HealthBand[] = ['ativo', 'atencao', 'risco', 'inativo'];

export default function CustomerList() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // O estágio vem da URL para os links do kanban e da fila de atenção
  // funcionarem como filtro pré-aplicado.
  const stage = searchParams.get('stage') ?? '';
  const stagnant = searchParams.get('stagnant') === 'true';

  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [health, setHealth] = useState('');
  const [pipeline, setPipeline] = useState('');
  const [customers, setCustomers] = useState<CustomerListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    listCustomers({ stage, health, pipeline, q: debouncedQ, stagnant })
      .then(({ customers: list }) => {
        if (!cancelled) setCustomers(list);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [stage, health, pipeline, debouncedQ, stagnant]);

  const hasFilters = Boolean(stage || health || pipeline || debouncedQ || stagnant);

  function updateParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  }

  function clearFilters() {
    setQ('');
    setHealth('');
    setPipeline('');
    setSearchParams(new URLSearchParams(), { replace: true });
  }

  const countLabel = useMemo(
    () => `${customers.length} ${customers.length === 1 ? 'cliente' : 'clientes'}`,
    [customers.length],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por nome, e-mail ou empresa…"
          className="flex-1 min-w-56 px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200 focus:border-violet-400"
        />

        <select
          value={stage}
          onChange={(e) => updateParam('stage', e.target.value)}
          className="px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
        >
          <option value="">Todos os estágios</option>
          {CRM_STAGES.map((s) => (
            <option key={s} value={s}>
              {STAGE_LABELS[s]}
            </option>
          ))}
        </select>

        <select
          value={health}
          onChange={(e) => setHealth(e.target.value)}
          className="px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
        >
          <option value="">Todos os healths</option>
          {HEALTH_BANDS.map((b) => (
            <option key={b} value={b}>
              {HEALTH_BAND_LABELS[b]}
            </option>
          ))}
        </select>

        <select
          value={pipeline}
          onChange={(e) => setPipeline(e.target.value)}
          className="px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
        >
          <option value="">Todo o comercial</option>
          {PIPELINE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {PIPELINE_LABELS[s]}
            </option>
          ))}
        </select>

        <label className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white cursor-pointer">
          <input
            type="checkbox"
            checked={stagnant}
            onChange={(e) => updateParam('stagnant', e.target.checked ? 'true' : '')}
            className="accent-violet-600"
          />
          Só travados
        </label>
      </div>

      <div className="flex items-center gap-3">
        <span className="text-xs font-semibold text-slate-500">{countLabel}</span>
        {hasFilters && (
          <button onClick={clearFilters} className="text-xs font-semibold text-violet-600 hover:text-violet-800">
            Limpar filtros
          </button>
        )}
      </div>

      {error && <ErrorBanner message={error} />}

      <Card className="overflow-hidden">
        {loading ? (
          <Spinner />
        ) : customers.length === 0 ? (
          <EmptyState
            title="Nenhum cliente encontrado"
            hint={hasFilters ? 'Tente limpar os filtros.' : 'Rode a reconciliação no Kanban para popular o CRM.'}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left">
                  {['Cliente', 'Empresa', 'Estágio', 'No estágio', 'Health', 'Comercial', 'Créditos', 'Último uso'].map(
                    (h) => (
                      <th key={h} className="px-3 py-2.5 text-xs font-bold text-slate-500 uppercase tracking-wide whitespace-nowrap">
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {customers.map((c) => (
                  <tr
                    key={c.uid}
                    onClick={() => navigate(`/admin/clientes/${c.uid}`)}
                    className="border-b border-slate-100 last:border-0 hover:bg-slate-50 cursor-pointer"
                  >
                    <td className="px-3 py-2.5">
                      <p className="font-semibold text-slate-800">{c.displayName || 'Sem nome'}</p>
                      <p className="text-xs text-slate-400">{c.email}</p>
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">{c.companyName || '—'}</td>
                    <td className="px-3 py-2.5">{c.crm ? <StageBadge stage={c.crm.stage} /> : '—'}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {c.crm ? (
                        c.stagnant ? (
                          <StagnantChip days={c.daysInStage} />
                        ) : (
                          <span className="text-slate-500">{c.daysInStage}d</span>
                        )
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      {c.crm ? <HealthDot band={c.crm.healthBand} score={c.crm.healthScore} /> : '—'}
                    </td>
                    <td className="px-3 py-2.5">{c.crm ? <PipelineBadge status={c.crm.pipelineStatus} /> : '—'}</td>
                    <td className="px-3 py-2.5 text-slate-600">{c.credits}</td>
                    <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">
                      {formatRelative(c.crm?.lastSeenAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
