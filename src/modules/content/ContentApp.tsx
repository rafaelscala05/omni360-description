import type { PedidoAlfred } from '../../types/agent';
import React, { useEffect, useState } from 'react';
import {
  LayoutDashboard, Layers, CalendarDays, Settings, Plus, Coins,
  LogOut, Menu, X, ChevronDown, Boxes, RefreshCw, Plug, FileText, Newspaper,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import logoAlfreds from '../../assets/brand/logo-alfreds-produtos.png';
import type { ContentProject, ContentCluster } from './types';
import { listenProjects, listenClusters } from '../../services/contentService';
import OnboardingWizard from './OnboardingWizard';
import ClustersView from './ClustersView';
import CalendarView from './CalendarView';
import ArticlesProductionView from './ArticlesProductionView';
import DashboardPanel from './DashboardPanel';
import CompanyProfile from './CompanyProfile';
import CompanyManager from './CompanyManager';
import IntegrationsView from './IntegrationsView';
import BlogView from './blog/BlogView';
import { useAgentTheme } from '../agent/theme';
import { BotaoConta } from '../../components/ContaMenu';

interface Props {
  user: User;
  credits: number;
  hasBlogModule: boolean;
  onSwitchToProduct: () => void;
  onBuyCredits: () => void;
  onLogout: () => void;
  /** "Abrir o artigo no Conteúdo" vindo do Alfred. */
  abrirArtigo?: { projectId: string; articleId: string } | null;
  onArtigoAberto?: () => void;
  /** Com agente: "Pedir ao Alfred" da barra de seleção leva ao Alfred com os artigos marcados. */
  onPedirAlfred?: (pedido: PedidoAlfred) => void;
  /** Conta com módulo de agente: o App monta o trilho (desktop), a tab bar e o
   *  avatar da Conta em volta, então aqui saem o "Ir para Agente de Produto",
   *  o avatar e o sair do cabeçalho. */
  agente?: boolean;
}

type ContentView = 'dashboard' | 'clusters' | 'producao' | 'calendar' | 'integrations' | 'settings' | 'blog';

const ContentApp: React.FC<Props> = ({ user, credits, hasBlogModule, onSwitchToProduct, onBuyCredits, onLogout, abrirArtigo, onArtigoAberto, onPedirAlfred, agente = false }) => {
  const uid = user.uid;
  // O shell (seções, projeto, barra de topo) segue o tema do Alfred; as telas
  // internas ainda têm cores literais e abrem um escopo claro próprio.
  const { tema: temaAgente } = useAgentTheme();
  const tema = agente ? temaAgente : 'claro';
  const [projects, setProjects] = useState<ContentProject[]>([]);
  const [ready, setReady] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<ContentView>('dashboard');
  const [creatingProject, setCreatingProject] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [managingCompanies, setManagingCompanies] = useState(false);
  const [pendingClusterId, setPendingClusterId] = useState<string | null>(null);
  const [clusters, setClusters] = useState<ContentCluster[]>([]);
  const [openArticleId, setOpenArticleId] = useState<string | null>(null);

  useEffect(() =>
    listenProjects(uid, (list) => {
      setProjects(list);
      setReady(true);
      setSelectedId((prev) => (prev && list.some((p) => p.id === prev)) ? prev : (list[0]?.id ?? null));
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

  useEffect(() => {
    if (!abrirArtigo || !ready) return;
    if (projects.some((p) => p.id === abrirArtigo.projectId)) {
      setSelectedId(abrirArtigo.projectId);
      goToArticle(abrirArtigo.articleId);
    }
    onArtigoAberto?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abrirArtigo, ready]);

  const navItem = (key: ContentView, label: string, Icon: React.ElementType) => (
    <button
      onClick={() => {
        setView(key);
        setIsSidebarOpen(false);
        if (key !== 'producao') setOpenArticleId(null);
      }}
      aria-current={view === key ? 'page' : undefined}
      className="w-full flex items-center gap-3 px-3 min-h-[40px] rounded-[12px] text-[13.5px] transition-colors hover:bg-[var(--ag-fill)]"
      style={view === key
        ? { background: 'var(--ag-surface-solid)', color: 'var(--ag-text)', fontWeight: 600, boxShadow: '0 0 0 1px var(--ag-hairline)' }
        : { color: 'var(--ag-text-2)', fontWeight: 500 }}
    >
      <Icon className="w-4 h-4" /> {label}
    </button>
  );

  return (
    <div className="alfreds h-screen flex font-sans overflow-hidden" data-tema={tema} style={{ background: 'var(--ag-bg)' }}>
      {isSidebarOpen && (
        <div onClick={() => setIsSidebarOpen(false)} className="fixed inset-0 z-30 md:hidden" style={{ background: 'rgba(5, 7, 12, 0.45)' }} />
      )}

      {/* Seções do módulo — no desktop uma coluna de vidro ao lado do trilho;
          no telefone, gaveta. */}
      <aside
        className={`fixed inset-y-0 left-0 w-[260px] md:w-[232px] flex-shrink-0 flex flex-col z-40 pt-4 transition-transform duration-300 md:static md:translate-x-0 ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}
        style={{ background: 'var(--ag-bg-2)', borderRight: '1px solid var(--ag-hairline)' }}
      >
        <div className="px-4 pb-4 mb-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--ag-hairline)' }}>
          <div className="flex items-center gap-2.5 min-w-0">
            {agente ? (
              <span className="font-display text-[20px] font-semibold tracking-tight text-[var(--ag-text)]">Conteúdo</span>
            ) : (
              <>
                <img src={logoAlfreds} alt="Alfreds" className="h-8 w-auto" />
                <span className="text-[10px] text-[var(--ag-text-3)] font-semibold pl-2.5 leading-tight" style={{ borderLeft: '1px solid var(--ag-hairline-2)' }}>Agente de<br />Conteúdo</span>
              </>
            )}
          </div>
          <button onClick={() => setIsSidebarOpen(false)} aria-label="Fechar" className="md:hidden w-9 h-9 grid place-items-center rounded-full text-[var(--ag-text-2)]" style={{ background: 'var(--ag-fill)' }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Troca de workspace — com agente quem leva de volta é o trilho / a tab bar. */}
        {!agente && (
          <div className="px-3 mb-3">
            <button
              onClick={onSwitchToProduct}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-[12px] text-xs font-medium text-[var(--ag-text-2)] hover:text-[var(--ag-text)] transition-colors"
              style={{ background: 'var(--ag-fill)' }}
              title="Trocar para o Agente de Produto"
            >
              <Boxes className="w-4 h-4" /> Ir para Agente de Produto
            </button>
          </div>
        )}

        {/* Project selector */}
        <div className="px-3 mb-2 relative">
          <button
            onClick={() => setProjectMenuOpen((o) => !o)}
            className="w-full flex items-center justify-between gap-2 px-3 min-h-[40px] rounded-[12px] text-[13.5px] font-medium text-[var(--ag-text)] transition-colors"
            style={{ background: 'var(--ag-surface-solid)', boxShadow: '0 0 0 1px var(--ag-hairline)' }}
          >
            <span className="truncate">{selected?.config.nomeEmpresa ?? 'Selecionar projeto'}</span>
            <ChevronDown className="w-4 h-4 shrink-0 text-[var(--ag-text-3)]" />
          </button>
          {projectMenuOpen && (
            <div
              className="ag-rise absolute left-3 right-3 mt-1 rounded-[16px] p-1.5 z-10 overflow-hidden"
              style={{ background: 'var(--ag-surface-solid)', border: '1px solid var(--ag-hairline)', boxShadow: 'var(--ag-shadow)' }}
            >
              {projects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => { setSelectedId(p.id); setProjectMenuOpen(false); }}
                  className="w-full text-left px-3 py-2 rounded-[10px] text-[13.5px] truncate hover:bg-[var(--ag-fill)]"
                  style={{ color: p.id === selectedId ? 'var(--ag-text)' : 'var(--ag-text-2)', fontWeight: p.id === selectedId ? 600 : 500 }}
                >
                  {p.config.nomeEmpresa}
                </button>
              ))}
              <button
                onClick={() => { setManagingCompanies(true); setProjectMenuOpen(false); }}
                className="w-full text-left px-3 py-2 text-[13.5px] text-[var(--ag-text-2)] hover:bg-[var(--ag-fill)]"
                style={{ borderTop: '1px solid var(--ag-hairline)' }}
              >
                Gerenciar empresas
              </button>
              <button
                onClick={() => { setCreatingProject(true); setProjectMenuOpen(false); }}
                className="w-full text-left px-3 py-2 rounded-[10px] text-[13.5px] font-medium text-[var(--ag-accent)] hover:bg-[var(--ag-fill)] flex items-center gap-2"
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
          {hasBlogModule && navItem('blog', 'Blog', Newspaper)}
          <div className="my-2 mx-3" style={{ borderTop: '1px solid var(--ag-hairline)' }} />
          {navItem('integrations', 'Integrações', Plug)}
          {navItem('settings', 'Configurações', Settings)}
        </nav>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        <header
          className="h-16 px-4 md:px-6 flex items-center justify-between flex-shrink-0 z-10 sticky top-0 gap-3"
          style={{ background: 'var(--ag-bg)', borderBottom: '1px solid var(--ag-hairline)' }}
        >
          <button
            onClick={() => setIsSidebarOpen(true)}
            className="md:hidden h-9 px-3 rounded-full flex items-center gap-2 text-[13px] font-medium text-[var(--ag-text-2)]"
            style={{ background: 'var(--ag-fill)' }}
            aria-label="Seções do Conteúdo"
          >
            <Menu className="w-4 h-4" /> {agente ? 'Conteúdo' : 'Menu'}
          </button>
          <div className="flex-1" />
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={onBuyCredits}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12.5px] font-medium text-[var(--ag-text-2)] hover:text-[var(--ag-text)] tabular-nums transition-colors"
              style={{ background: 'var(--ag-fill)' }}
              title="Comprar créditos"
            >
              <Coins className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Créditos:</span>
              <span className="font-semibold text-[var(--ag-text)]">{credits}</span>
            </button>
            {agente ? (
              <BotaoConta />
            ) : (
              <div className="flex items-center gap-2">
                <img src={user.photoURL || `https://ui-avatars.com/api/?name=${user.email}`} alt="" className="w-7 h-7 rounded-full" style={{ boxShadow: '0 0 0 1px var(--ag-hairline-2)' }} />
                <button onClick={onLogout} title="Sair" className="p-1.5 rounded-lg text-[var(--ag-text-3)] hover:text-[var(--ag-danger)] hover:bg-[var(--ag-danger-soft)] transition-colors">
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </header>

        <main className={`flex-1 overflow-y-auto w-full p-3 sm:p-4 ${agente ? 'pb-28 md:pb-6' : ''}`}>
          {/* As telas internas ainda têm cores literais: ficam numa moldura
              clara, como Integrações, até serem convertidas para os tokens. */}
          <div
            className="alfreds min-h-full rounded-[24px] p-3 sm:p-6"
            data-tema="claro"
            style={{ background: 'var(--ag-bg-2)', border: '1px solid var(--ag-hairline)', boxShadow: 'var(--ag-shadow)' }}
          >
          {!ready ? (
            <div className="h-full flex items-center justify-center text-[var(--ag-text-3)]"><RefreshCw className="w-6 h-6 animate-spin" /></div>
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
              blogEnabled={hasBlogModule}
              onPedirAlfred={onPedirAlfred}
            />
          ) : view === 'calendar' ? (
            <CalendarView uid={uid} projectId={selected.id} onOpenArticle={goToArticle} />
          ) : view === 'blog' ? (
            <BlogView uid={uid} projectId={selected.id} />
          ) : view === 'integrations' ? (
            <IntegrationsView uid={uid} project={selected} />
          ) : (
            <CompanyProfile uid={uid} project={selected} onGoClusters={() => setView('clusters')} />
          )}
          </div>
        </main>
      </div>

      {managingCompanies && (
        <CompanyManager uid={uid} projects={projects} onClose={() => setManagingCompanies(false)} />
      )}
    </div>
  );
};

export default ContentApp;
