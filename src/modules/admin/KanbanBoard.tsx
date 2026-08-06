// Kanban de dois eixos.
//
// Board de ATIVAÇÃO: derivado dos eventos, read-only. Arrastar um card aqui
// significaria mentir sobre o que o cliente de fato fez — o estágio é um fato,
// não uma opinião.
//
// Board COMERCIAL: arrastável, é onde o trabalho de vendas é registrado.
//
// Drag-and-drop usa a API nativa do HTML5, sem dependência nova.

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CRM_STAGES,
  PIPELINE_LABELS,
  PIPELINE_STATUSES,
  STAGE_LABELS,
  type CustomerListItem,
  type PipelineStatus,
} from '../../types/crm';
import { listCustomers, reconcile, setPipeline } from '../../services/adminService';
import {
  Card,
  ErrorBanner,
  HealthDot,
  Spinner,
  StagnantChip,
  formatRelative,
  initials,
} from './ui';

type BoardKind = 'ativacao' | 'comercial';

export default function KanbanBoard() {
  const [customers, setCustomers] = useState<CustomerListItem[]>([]);
  const [board, setBoard] = useState<BoardKind>('ativacao');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reconciling, setReconciling] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<PipelineStatus | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { customers: list } = await listCustomers();
      setCustomers(list);
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

  // Atualização otimista: move o card na hora e reverte se o servidor recusar.
  async function movePipeline(uid: string, status: PipelineStatus) {
    const previous = customers;
    setCustomers((list) =>
      list.map((c) => (c.uid === uid && c.crm ? { ...c, crm: { ...c.crm, pipelineStatus: status } } : c)),
    );
    try {
      await setPipeline(uid, status);
    } catch (err) {
      setCustomers(previous);
      setError((err as Error).message);
    }
  }

  const notReconciled = customers.filter((c) => !c.crm);

  if (loading) return <Spinner />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex p-1 bg-slate-100 rounded-lg">
          {(
            [
              ['ativacao', 'Ativação'],
              ['comercial', 'Comercial'],
            ] as const
          ).map(([kind, label]) => (
            <button
              key={kind}
              onClick={() => setBoard(kind)}
              className={`px-3 py-1.5 rounded-md text-sm font-semibold transition-colors ${
                board === kind ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <p className="text-xs text-slate-400">
          {board === 'ativacao'
            ? 'Derivado dos eventos — os cards se movem sozinhos conforme o cliente avança.'
            : 'Arraste os cards para registrar o andamento comercial.'}
        </p>

        <button
          onClick={runReconcile}
          disabled={reconciling}
          className="ml-auto px-3 py-1.5 rounded-lg border border-slate-300 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          {reconciling ? 'Reconciliando…' : 'Reconciliar'}
        </button>
      </div>

      {error && <ErrorBanner message={error} />}

      {notReconciled.length > 0 && (
        <div className="px-4 py-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800">
          {notReconciled.length}{' '}
          {notReconciled.length === 1 ? 'cliente ainda não foi reconciliado' : 'clientes ainda não foram reconciliados'}{' '}
          e não aparecem nas colunas. Clique em “Reconciliar” para derivar a jornada deles a partir dos
          dados que já existem.
        </div>
      )}

      <div className="flex gap-3 overflow-x-auto pb-2">
        {board === 'ativacao'
          ? CRM_STAGES.map((stage) => {
              const items = customers.filter((c) => c.crm?.stage === stage);
              return (
                <Column key={stage} title={STAGE_LABELS[stage]} count={items.length}>
                  {items.map((c) => (
                    <KanbanCard key={c.uid} customer={c} />
                  ))}
                </Column>
              );
            })
          : PIPELINE_STATUSES.map((status) => {
              const items = customers.filter((c) => c.crm?.pipelineStatus === status);
              return (
                <Column
                  key={status}
                  title={PIPELINE_LABELS[status]}
                  count={items.length}
                  highlighted={dropTarget === status}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDropTarget(status);
                  }}
                  onDragLeave={() => setDropTarget((t) => (t === status ? null : t))}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDropTarget(null);
                    const uid = dragging ?? e.dataTransfer.getData('text/plain');
                    setDragging(null);
                    if (uid) void movePipeline(uid, status);
                  }}
                >
                  {items.map((c) => (
                    <KanbanCard
                      key={c.uid}
                      customer={c}
                      draggable
                      onDragStart={(e) => {
                        setDragging(c.uid);
                        e.dataTransfer.setData('text/plain', c.uid);
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      onDragEnd={() => {
                        setDragging(null);
                        setDropTarget(null);
                      }}
                    />
                  ))}
                </Column>
              );
            })}
      </div>
    </div>
  );
}

function Column({
  title,
  count,
  children,
  highlighted = false,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
  highlighted?: boolean;
  onDragOver?: React.DragEventHandler;
  onDragLeave?: React.DragEventHandler;
  onDrop?: React.DragEventHandler;
}) {
  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`shrink-0 w-64 rounded-xl border transition-colors ${
        highlighted ? 'border-violet-400 bg-violet-50/60' : 'border-slate-200 bg-slate-100/60'
      }`}
    >
      <div className="px-3 py-2.5 flex items-center justify-between border-b border-slate-200">
        <span className="text-xs font-bold text-slate-600 uppercase tracking-wide leading-tight">{title}</span>
        <span className="shrink-0 ml-2 px-1.5 py-0.5 rounded bg-white text-xs font-bold text-slate-500">
          {count}
        </span>
      </div>
      <div className="p-2 space-y-2 max-h-[calc(100vh-16rem)] overflow-y-auto">
        {count === 0 ? <p className="px-2 py-6 text-center text-xs text-slate-400">Vazio</p> : children}
      </div>
    </div>
  );
}

function KanbanCard({
  customer,
  draggable = false,
  onDragStart,
  onDragEnd,
}: {
  customer: CustomerListItem;
  draggable?: boolean;
  onDragStart?: React.DragEventHandler;
  onDragEnd?: React.DragEventHandler;
}) {
  const { crm } = customer;
  return (
    <Card
      className={`p-2.5 hover:border-violet-300 transition-colors ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
    >
      <div draggable={draggable} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <Link to={`/admin/clientes/${customer.uid}`} className="block">
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 shrink-0 rounded-full bg-violet-100 text-violet-700 text-[11px] font-bold flex items-center justify-center">
              {initials(customer.displayName, customer.email)}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-800 truncate">
                {customer.displayName || customer.email || 'Sem nome'}
              </p>
              {customer.companyName && (
                <p className="text-[11px] text-slate-400 truncate">{customer.companyName}</p>
              )}
            </div>
          </div>

          <div className="mt-2 flex items-center gap-2 flex-wrap">
            {crm && <HealthDot band={crm.healthBand} score={crm.healthScore} />}
            <span className="text-[11px] text-slate-400">{customer.credits} cr.</span>
            <span className="text-[11px] text-slate-400">{formatRelative(crm?.lastSeenAt)}</span>
          </div>

          {customer.stagnant && (
            <div className="mt-1.5">
              <StagnantChip days={customer.daysInStage} />
            </div>
          )}
        </Link>
      </div>
    </Card>
  );
}
