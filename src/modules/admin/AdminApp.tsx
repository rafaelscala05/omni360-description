// Shell do CRM admin: verifica o claim, monta a navegação e as rotas internas.
// Vive fora de /app — é ferramenta interna, não parte do produto.

import { useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { checkAdmin } from '../../services/adminService';
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
  const location = useLocation();

  useEffect(() => {
    checkAdmin()
      .then((r) => {
        setAdminName(r.name);
        setState('allowed');
      })
      .catch(() => setState('denied'));
  }, []);

  if (state === 'checking') {
    return (
      <div className="min-h-screen bg-slate-50">
        <Spinner label="Verificando acesso…" />
      </div>
    );
  }

  // Não redireciona em silêncio: o admin precisa saber que o claim não está no
  // token, porque o motivo mais comum é o token ser anterior à concessão.
  if (state === 'denied') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-6">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-bold text-slate-800">Acesso restrito</h1>
          <p className="mt-2 text-sm text-slate-500">
            Esta área é só para administradores. Se você acabou de receber o acesso, saia e entre de
            novo para o token ser renovado.
          </p>
          <Link
            to="/app"
            className="inline-block mt-6 text-sm font-semibold text-violet-600 hover:text-violet-800"
          >
            Voltar para o Alfred →
          </Link>
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
