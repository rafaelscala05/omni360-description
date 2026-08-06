// Shell do CRM admin: verifica o claim, monta a navegação e as rotas internas.
// Vive fora de /app — é ferramenta interna, não parte do produto.

import { useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { accessCheck, checkAdmin, type AccessCheck } from '../../services/adminService';
import { Spinner } from './ui';
import AttentionQueue from './AttentionQueue';
import KanbanBoard from './KanbanBoard';
import CustomerList from './CustomerList';
import CustomerDetail from './CustomerDetail';
import AutomationsView from './AutomationsView';

const NAV = [
  { to: '/admin', label: 'Atenção hoje', exact: true },
  { to: '/admin/kanban', label: 'Kanban' },
  { to: '/admin/clientes', label: 'Clientes' },
  { to: '/admin/automacoes', label: 'Automações' },
];

export default function AdminApp() {
  const [state, setState] = useState<'checking' | 'allowed' | 'denied'>('checking');
  const [adminName, setAdminName] = useState('');
  const [diagnosis, setDiagnosis] = useState<AccessCheck | null>(null);
  const location = useLocation();

  useEffect(() => {
    checkAdmin()
      .then((r) => {
        setAdminName(r.name);
        setState('allowed');
      })
      .catch(() => {
        setState('denied');
        // Descobre POR QUE foi negado — sem isso a tela só diz "não pode" e a
        // pessoa fica adivinhando entre claim ausente, e-mail errado e env var.
        accessCheck()
          .then(setDiagnosis)
          .catch(() => setDiagnosis(null));
      });
  }, []);

  if (state === 'checking') {
    return (
      <div className="min-h-screen bg-slate-50">
        <Spinner label="Verificando acesso…" />
      </div>
    );
  }

  // Não redireciona em silêncio: mostra exatamente qual das condições falhou,
  // porque os três motivos possíveis (claim ausente, e-mail fora da allowlist,
  // env var não configurada) exigem ações completamente diferentes.
  if (state === 'denied') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-6">
        <div className="max-w-lg">
          <h1 className="text-xl font-bold text-slate-800 text-center">Acesso restrito</h1>
          <p className="mt-2 text-sm text-slate-500 text-center">
            Esta área é só para administradores.
          </p>

          {diagnosis && (
            <div className="mt-5 p-4 rounded-xl bg-white border border-slate-200 text-sm">
              <p className="text-slate-600">
                Você está logado como{' '}
                <strong className="text-slate-800">{diagnosis.email ?? 'e-mail desconhecido'}</strong>.
              </p>
              <ul className="mt-3 space-y-1.5 text-xs text-slate-500">
                <li>
                  {diagnosis.viaClaim ? '✓' : '✗'} Custom claim <code>admin</code> no token
                </li>
                <li>
                  {diagnosis.viaAllowlist ? '✓' : '✗'} E-mail na allowlist{' '}
                  <code>ADMIN_EMAILS</code>
                  {!diagnosis.allowlistConfigured && ' (não configurada)'}
                </li>
              </ul>

              {!diagnosis.allowlistConfigured && (
                <div className="mt-3 pt-3 border-t border-slate-100">
                  <p className="text-xs text-slate-600 font-semibold">Para liberar:</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Adicione ao <code>.env</code> e reinicie o servidor:
                  </p>
                  <code className="mt-1.5 block px-2 py-1.5 rounded bg-slate-900 text-slate-100 text-[11px] overflow-x-auto">
                    ADMIN_EMAILS={diagnosis.email ?? 'seu@email.com'}
                  </code>
                </div>
              )}

              {diagnosis.allowlistConfigured && !diagnosis.viaAllowlist && !diagnosis.viaClaim && (
                <p className="mt-3 pt-3 border-t border-slate-100 text-xs text-slate-500">
                  A allowlist existe mas não inclui este e-mail. Confira{' '}
                  <code>ADMIN_EMAILS</code> no ambiente do servidor, ou entre com a conta correta.
                </p>
              )}
            </div>
          )}

          <div className="mt-5 text-center">
            <Link to="/app" className="text-sm font-semibold text-violet-600 hover:text-violet-800">
              Voltar para o Alfred →
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20">
        <div className="max-w-[1400px] mx-auto px-6 h-14 flex items-center gap-6">
          <span className="font-bold text-slate-800">CRM</span>
          <nav className="flex items-center gap-1">
            {NAV.map((item) => {
              const active = item.exact
                ? location.pathname === item.to || location.pathname === `${item.to}/`
                : location.pathname.startsWith(item.to);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
                    active ? 'bg-violet-50 text-violet-700' : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-4">
            <span className="text-xs text-slate-400 hidden sm:inline">{adminName}</span>
            <Link to="/app" className="text-xs font-semibold text-slate-500 hover:text-slate-800">
              Voltar ao app →
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-6 py-6">
        <Routes>
          <Route index element={<AttentionQueue />} />
          <Route path="kanban" element={<KanbanBoard />} />
          <Route path="clientes" element={<CustomerList />} />
          <Route path="clientes/:uid" element={<CustomerDetail />} />
          <Route path="automacoes" element={<AutomationsView />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </main>
    </div>
  );
}
