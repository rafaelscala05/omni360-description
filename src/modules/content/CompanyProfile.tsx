import React, { useState } from 'react';
import { Pencil, ArrowRight } from 'lucide-react';
import type { ContentProject } from './types';
import ProfileSummary from './ProfileSummary';
import OnboardingWizard from './OnboardingWizard';

interface Props {
  uid: string;
  project: ContentProject;
  onGoClusters: () => void;
}

// Settings landing: a read-only summary of the company profile with the option
// to edit (reopens the wizard) or advance to cluster creation.
const CompanyProfile: React.FC<Props> = ({ uid, project, onGoClusters }) => {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <OnboardingWizard
        uid={uid}
        existing={project}
        onSaved={() => setEditing(false)}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">Perfil da empresa</h1>
          <p className="text-sm text-slate-500 mt-0.5">Como o Alfred enxerga o seu negócio.</p>
        </div>
        <button
          onClick={() => setEditing(true)}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 shadow-sm hover:bg-slate-50 rounded-xl transition-colors"
        >
          <Pencil className="w-4 h-4" /> Editar
        </button>
      </div>

      <ProfileSummary config={project.config} />

      <div className="flex justify-end mt-6">
        <button
          onClick={onGoClusters}
          className="flex items-center gap-1.5 px-5 py-2.5 text-sm font-semibold text-white bg-[#FF5B03] hover:bg-[#E14E00] rounded-xl shadow-sm transition-colors"
        >
          Avançar para Clusters <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

export default CompanyProfile;
