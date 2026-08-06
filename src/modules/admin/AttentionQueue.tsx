// Home do CRM: a tela que responde "o que eu faço agora".
// Números do topo, distribuição da jornada, quem está travado e o que vence hoje.

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CRM_STAGES,
  STAGE_LABELS,
  type AdminStats,
  type CrmTask,
  type CustomerListItem,
} from '../../types/crm';
import { getStats, listCustomers, listTasks, reconcile, toggleTask } from '../../services/adminService';
import {
  Card,
  EmptyState,
  ErrorBanner,
  HealthDot,
  Spinner,
  StageBadge,
  StagnantChip,
  formatDate,
  formatRelative,
  whatsappHref,
} from './ui';

const STAGE_COLORS = ['bg-slate-400', 'bg-sky-400', 'bg-violet-400', 'bg-indigo-500', 'bg-emerald-500'];

export default function AttentionQueue() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [stuck, setStuck] = useState<CustomerListItem[]>([]);
  const [tasks, setTasks] = useState<CrmTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reconciling, setReconciling] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [s, c, t] = await Promise.all([getStats(), listCustomers({ stagnant: true }), listTasks(true)]);
      setStats(s);
      setStuck([...c.customers].sort((a, b) => b.daysInStage - a.daysInStage));
      const today = new Date().toISOString().slice(0, 10);
      setTasks(t.tasks.filter((task) => task.dueDate <= today));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function runReconcile() {
    setReconciling(true);
    try {
      await reconcile();
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setReconciling(false);
    }
  }

  async function flipTask(task: CrmTask) {
    const previous = tasks;
    setTasks((list) => list.filter((t) => t.id !== task.id));
    try {
      await toggleTask(task.id, true);
    } catch (err) {
      setTasks(previous);
      setError((err as Error).message);
    }
  }

  if (loading) return <Spinner />;
  if (error && !stats) return <ErrorBanner message={error} />;
  if (!stats) return null;

  const totalStaged = CRM_STAGES.reduce((sum, s) => sum + stats.byStage[s], 0);

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} />}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Clientes" value={stats.total} />
        <StatCard label="Travados" value={stats.stagnant} tone={stats.stagnant > 0 ? 'amber' : 'neutral'} />
        <StatCard label="Em risco" value={stats.atRisk} tone={stats.atRisk > 0 ? 'rose' : 'neutral'} />
        {stats.notReconciled > 0 ? (
          <Card className="p-4 border-amber-200 bg-amber-50">
            <p className="text-2xl font-bold text-amber-700">{stats.notReconciled}</p>
            <p className="text-xs text-amber-700">não reconciliados</p>
            <button
              onClick={runReconcile}
              disabled={reconciling}
              className="mt-2 text-xs font-bold text-amber-800 underline hover:no-underline disabled:opacity-50"
            >
              {reconciling ? 'Reconciliando…' : 'Reconciliar agora'}
            </button>
          </Card>
        ) : (
          <StatCard label="Tarefas para hoje" value={tasks.length} />
        )}
      </div>

      <Card className="p-5">
        <h2 className="text-sm font-bold text-slate-700">Distribuição da jornada</h2>
        {totalStaged === 0 ? (
          <p className="mt-3 text-sm text-slate-400">
            Nenhum cliente reconciliado ainda. Rode a reconciliação para derivar a jornada da base atual.
          </p>
        ) : (
          <>
            <div className="mt-3 flex h-2.5 rounded-full overflow-hidden bg-slate-100">
              {CRM_STAGES.map((stage, i) => {
                const count = stats.byStage[stage];
                if (count === 0) return null;
                return (
                  <div
                    key={stage}
                    className={STAGE_COLORS[i]}
                    style={{ width: `${(count / totalStaged) * 100}%` }}
                    title={`${STAGE_LABELS[stage]}: ${count}`}
                  />
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
              {CRM_STAGES.map((stage, i) => (
                <Link
                  key={stage}
                  to={`/admin/clientes?stage=${stage}`}
                  className="flex items-center gap-1.5 group"
                >
                  <span className={`w-2 h-2 rounded-full ${STAGE_COLORS[i]}`} />
                  <span className="text-xs text-slate-500 group-hover:text-slate-800">{STAGE_LABELS[stage]}</span>
                  <span className="text-xs font-bold text-slate-700">{stats.byStage[stage]}</span>
                </Link>
              ))}
            </div>
          </>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-700">Travados na jornada</h2>
            <Link to="/admin/clientes?stagnant=true" className="text-xs font-semibold text-violet-600 hover:text-violet-800">
              Ver todos →
            </Link>
          </div>

          {stuck.length === 0 ? (
            <EmptyState title="Nenhum cliente travado hoje" hint="Toda a base avançou dentro do prazo esperado." />
          ) : (
            <ul className="mt-3 divide-y divide-slate-100">
              {stuck.slice(0, 12).map((c) => {
                const wa = whatsappHref(c.whatsapp);
                return (
                  <li key={c.uid} className="py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <Link
                      to={`/admin/clientes/${c.uid}`}
                      className="font-semibold text-sm text-slate-800 hover:text-violet-700 min-w-0 truncate"
                    >
                      {c.displayName || c.email || 'Sem nome'}
                    </Link>
                    {c.crm && <StageBadge stage={c.crm.stage} />}
                    <StagnantChip days={c.daysInStage} />
                    {c.crm && <HealthDot band={c.crm.healthBand} score={c.crm.healthScore} />}
                    <span className="text-xs text-slate-400">{formatRelative(c.crm?.lastSeenAt)}</span>
                    {wa && (
                      <a
                        href={wa}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-auto text-xs font-bold text-emerald-600 hover:text-emerald-800"
                      >
                        WhatsApp →
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-bold text-slate-700">Tarefas vencendo</h2>
          {tasks.length === 0 ? (
            <EmptyState title="Nada vencendo hoje" />
          ) : (
            <ul className="mt-3 space-y-2">
              {tasks.map((task) => {
                const overdue = task.dueDate < new Date().toISOString().slice(0, 10);
                return (
                  <li key={task.id} className="flex items-start gap-2.5">
                    <input
                      type="checkbox"
                      checked={false}
                      onChange={() => flipTask(task)}
                      className="accent-violet-600 w-4 h-4 mt-0.5 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-slate-700">{task.title}</p>
                      <p className="text-xs text-slate-400">
                        <Link to={`/admin/clientes/${task.uid}`} className="hover:text-violet-700">
                          {task.customerName || 'cliente'}
                        </Link>
                        {' · '}
                        <span className={overdue ? 'text-rose-600 font-bold' : ''}>{formatDate(task.dueDate)}</span>
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  tone?: 'neutral' | 'amber' | 'rose';
}) {
  const colors = {
    neutral: 'text-slate-800',
    amber: 'text-amber-600',
    rose: 'text-rose-600',
  }[tone];
  return (
    <Card className="p-4">
      <p className={`text-2xl font-bold ${colors}`}>{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </Card>
  );
}
