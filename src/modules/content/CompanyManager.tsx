import React, { useState } from 'react';
import { X, Edit, Trash2, Save, Loader2, Building2 } from 'lucide-react';
import type { ContentProject } from './types';
import { renameProject, deleteProject } from '../../services/contentService';

interface Props {
  uid: string;
  projects: ContentProject[];
  onClose: () => void;
}

const CompanyManager: React.FC<Props> = ({ uid, projects, onClose }) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const startEdit = (p: ContentProject) => {
    setEditingId(p.id);
    setDraftName(p.config.nomeEmpresa);
    setConfirmingDeleteId(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraftName('');
  };

  const saveEdit = async (id: string) => {
    const name = draftName.trim();
    if (!name) return;
    setBusyId(id);
    try {
      await renameProject(uid, id, name);
      setEditingId(null);
    } finally {
      setBusyId(null);
    }
  };

  const confirmDelete = async (id: string) => {
    setBusyId(id);
    try {
      await deleteProject(uid, id);
      setConfirmingDeleteId(null);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-white flex flex-col animate-in fade-in duration-200">
      <header className="h-16 bg-white border-b border-slate-200 px-4 md:px-6 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <Building2 className="w-5 h-5 text-slate-400 shrink-0" />
          <h1 className="text-lg font-bold text-slate-900 truncate">Gerenciar empresas</h1>
        </div>
        <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500 transition-colors shrink-0">
          <X className="w-5 h-5" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-[#f7f9fb]">
        <div className="max-w-2xl mx-auto flex flex-col gap-2">
          {projects.map((p) => (
            <div key={p.id} className="bg-white border border-slate-200 rounded-xl p-4">
              {editingId === p.id ? (
                <div className="flex items-center gap-2">
                  <input
                    autoFocus
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#FF5B03]/30"
                  />
                  <button
                    onClick={() => saveEdit(p.id)}
                    disabled={busyId === p.id || !draftName.trim()}
                    className="p-2 rounded-lg bg-[#FF5B03] text-white hover:bg-[#E14E00] disabled:opacity-50 transition-colors"
                  >
                    {busyId === p.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  </button>
                  <button onClick={cancelEdit} className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 transition-colors">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : confirmingDeleteId === p.id ? (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm text-slate-700">
                    Excluir <strong>{p.config.nomeEmpresa}</strong> e todos os seus dados (clusters, artigos, calendário, blog)? Esta ação não pode ser desfeita.
                  </p>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => confirmDelete(p.id)}
                      disabled={busyId === p.id}
                      className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-700 disabled:opacity-50 transition-colors"
                    >
                      {busyId === p.id ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Excluir'}
                    </button>
                    <button
                      onClick={() => setConfirmingDeleteId(null)}
                      className="px-3 py-1.5 rounded-lg text-slate-600 text-xs font-medium hover:bg-slate-100 transition-colors"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-slate-900 truncate">{p.config.nomeEmpresa}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => startEdit(p)} className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 transition-colors" title="Renomear">
                      <Edit className="w-4 h-4" />
                    </button>
                    <button onClick={() => setConfirmingDeleteId(p.id)} className="p-2 rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-600 transition-colors" title="Excluir">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default CompanyManager;
