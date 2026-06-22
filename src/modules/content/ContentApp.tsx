import React, { useEffect, useState } from 'react';
import {
  Sparkles, LayoutDashboard, Layers, CalendarDays, Settings, Plus, Coins,
  LogOut, Menu, X, ChevronDown, Boxes, RefreshCw, Plug, FileText,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import type { ContentProject, ContentCluster } from './types';
import { listenProjects, listenClusters } from '../../services/contentService';
import OnboardingWizard from './OnboardingWizard';
import ClustersView from './ClustersView';
import CalendarView from './CalendarView';
import ArticlesProductionView from './ArticlesProductionView';
import DashboardPanel from './DashboardPanel';
import CompanyProfile from './CompanyProfile';
import IntegrationsView from './IntegrationsView';

interface Props {
  user: User;
  credits: number;
  onSwitchToProduct: () => void;
  onBuyCredits: () => void;
  onLogout: () => void;
}

type ContentView = 'dashboard' | 'clusters' | 'producao' | 'calendar' | 'integrations' | 'settings';

const ContentApp: React.FC<Props> = ({ user, credits, onSwitchToProduct, onBuyCredits, onLogout }) => {
  const uid = user.uid;
  const [projects, setProjects] = useState<ContentProject[]>([]);
  const [ready, setReady] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<ContentView>('dashboard');
  const [creatingProject, setCreatingProject] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [pendingClusterId, setPendingClusterId] = useState<string | null>(null);
  const [clusters, setClusters] = useState<ContentCluster[]>([]);
  const [openArticleId, setOpenArticleId] = useState<string | null>(null);

  useEffect(() =>
    listenProjects(uid, (list) => {
      setProjects(list);
      setReady(true);
      setSelectedId((prev) => prev ?? list[0]?.id ?? null);
    }),
  [uid]);

  useEffect(() => {
    if (!selectedId) return;
    return listenClusters(uid, selectedId, setClusters);
  }, [uid, selectedId]);

  const selected = projects.find((p) => p.id === selectedId) ?? null;

  const goToArticle = (articleId: string) => {
    setOpenArticleId(articleId);
    setView('producao');
  };

  const navItem = (key: ContentView, label: string, Icon: React.ElementType) => (
    <button
      onClick={() => {
        setView(key);
        setIsSidebarOpen(false);
        if (key !== 'producao') setOpenArticleId(null);
      }}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-200 ${view === key ? 'bg-[#1e293b] text-white font-medium' : 'text-slate-400 font-medium hover:text-white hover:bg-white/5'}`}
    >
      <Icon className="w-4 h-4" /> {label}
    </button>
  );

  return (
    <div className="h-screen bg-[#f7f9fb] flex font-sans overflow-hidden">
      {isSidebarOpen && (
        <div onClick={() => setIsSidebarOpen(false)} className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-30 md:hidden" />
      )}

      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 w-[260px] bg-[#0f172a] text-white flex-shrink-0 flex flex-col z-40 shadow-[4px_0_24px_rgba(0,0,0,0.05)] pt-4 transition-transform duration-300 md:static md:translate-x-0 ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="px-5 flex items-center justify-between border-b border-white/5 mx-3 mb-4 pb-4">
          <div className="flex items-center gap-3">
            <div className="bg-[#004ac6] p-1.5 rounded-lg shadow-sm">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div className="flex flex-col">
              <span className="font-display text-base font-extrabold text-white tracking-tight leading-tight">Alfreds</span>
              <span className="text-[10px] text-slate-400">Agência de Conteúdo</span>
            </div>
          </div>
          <button onClick={() => setIsSidebarOpen(false)} className="md:hidden p-1 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Workspace switcher */}
        <div className="px-3 mb-3">
          <button
            onClick={onSwitchToProduct}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-slate-300 bg-white/5 hover:bg-white/10 transition-colors"
            title="Trocar para o Agente de Produto"
          >
            <Boxes className="w-4 h-4" /> Ir para Agente de Produto
          </button>
        </div>

        {/* Project selector */}
        <div className="px-3 mb-2 relative">
          <button
            onClick={() => setProjectMenuOpen((o) => !o)}
            className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm text-white bg-white/5 hover:bg-white/10 transition-colors"
          >
            <span className="truncate">{selected?.config.nomeEmpresa ?? 'Selecionar projeto'}</span>
            <ChevronDown className="w-4 h-4 shrink-0" />
          </button>
          {projectMenuOpen && (
            <div className="absolute left-3 right-3 mt-1 bg-[#1e293b] rounded-lg shadow-lg z-10 overflow-hidden">
              {projects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => { setSelectedId(p.id); setProjectMenuOpen(false); }}
                  className="w-full text-left px-3 py-2 text-sm text-slate-300 hover:bg-white/10 truncate"
                >
                  {p.config.nomeEmpresa}
                </button>
              ))}
              <button
                onClick={() => { setCreatingProject(true); setProjectMenuOpen(false); }}
                className="w-full text-left px-3 py-2 text-sm text-[#7aa2ff] hover:bg-white/10 flex items-center gap-2"
              >
                <Plus className="w-4 h-4" /> Novo projeto
              </button>
            </div>
          )}
        </div>

        <nav className="mt-2 px-3 flex flex-col gap-1 flex-1">
          {navItem('dashboard', 'Painel', LayoutDashboard)}
          {navItem('clusters', 'Clusters', Layers)}
          {navItem('producao', 'Produção de Artigos', FileText)}
          {navItem('calendar', 'Calendário', CalendarDays)}
          <div className="my-2 border-t border-white/5 mx-4" />
          {navItem('integrations', 'Integrações', Plug)}
          {navItem('settings', 'Configurações', Settings)}
        </nav>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#f7f9fb] h-screen overflow-hidden">
        <header className="h-16 bg-white border-b border-slate-200 px-4 md:px-6 flex items-center justify-between flex-shrink-0 z-10 sticky top-0 shadow-sm gap-3">
          <button onClick={() => setIsSidebarOpen(true)} className="md:hidden p-2 text-slate-600 hover:bg-slate-100 rounded-lg">
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex-1" />
          <div className="flex items-center gap-3 md:gap-5 shrink-0">
            <button
              onClick={onBuyCredits}
              className="flex items-center gap-1.5 text-xs md:text-sm font-semibold text-slate-600 bg-slate-50 border border-slate-200 px-2.5 md:px-3 py-1 rounded-full shadow-sm hover:bg-amber-50 hover:border-amber-200 transition-colors"
              title="Comprar créditos"
            >
              <Coins className="w-4 h-4 text-amber-500 shrink-0" />
              <span className="hidden sm:inline">Créditos:</span>
              <span className="text-slate-900 font-bold">{credits}</span>
            </button>
            <div className="h-6 w-px bg-slate-200" />
            <div className="flex items-center gap-2">
              <img src={user.photoURL || `https://ui-avatars.com/api/?name=${user.email}`} alt="" className="w-7 h-7 rounded-full border border-slate-200" />
              <button onClick={onLogout} title="Sair" className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto w-full p-6">
          {!ready ? (
            <div className="h-full flex items-center justify-center text-slate-400"><RefreshCw className="w-6 h-6 animate-spin" /></div>
          ) : creatingProject || !projects.length ? (
            <OnboardingWizard
              uid={uid}
              onSaved={(id) => { setSelectedId(id); setCreatingProject(false); setView('clusters'); }}
              onCancel={projects.length ? () => setCreatingProject(false) : undefined}
            />
          ) : !selected ? (
            <div className="text-center text-slate-400 py-16">Selecione um projeto.</div>
          ) : view === 'dashboard' ? (
            <DashboardPanel
              uid={uid}
              projectId={selected.id}
              empresa={selected.config.nomeEmpresa}
              clusters={clusters}
              onSelectCluster={(clusterId) => {
                setPendingClusterId(clusterId);
                setView('clusters');
              }}
            />
          ) : view === 'clusters' ? (
            <ClustersView
              uid={uid}
              projectId={selected.id}
              onGoArticle={goToArticle}
              initialSelectedId={pendingClusterId}
              onInitialClusterHandled={() => setPendingClusterId(null)}
            />
          ) : view === 'producao' ? (
            <ArticlesProductionView
              uid={uid}
              projectId={selected.id}
              clusters={clusters}
              initialOpenId={openArticleId ?? undefined}
              onGoCluster={() => setView('clusters')}
            />
          ) : view === 'calendar' ? (
            <CalendarView uid={uid} projectId={selected.id} onOpenArticle={goToArticle} />
          ) : view === 'integrations' ? (
            <IntegrationsView uid={uid} project={selected} />
          ) : (
            <CompanyProfile uid={uid} project={selected} onGoClusters={() => setView('clusters')} />
          )}
        </main>
      </div>
    </div>
  );
};

export default ContentApp;
