import React, { useEffect, useState } from 'react';
import { Pencil, ArrowRight } from 'lucide-react';
import type { ContentProject, SeoAudit } from './types';
import ProfileSummary from './ProfileSummary';
import OnboardingWizard from './OnboardingWizard';
import { listenLatestSeoAudit } from '../../services/contentService';

interface Props {
  uid: string;
  project: ContentProject;
  onGoClusters: () => void;
}

// Settings landing: a read-only summary of the company profile with the option
// to edit (reopens the wizard) or advance to cluster creation.
const CompanyProfile: React.FC<Props> = ({ uid, project, onGoClusters }) => {
  const [editing, setEditing] = useState(false);
  const [audit, setAudit] = useState<SeoAudit | null | undefined>(undefined);

  useEffect(() => listenLatestSeoAudit(uid, project.id, setAudit), [uid, project.id]);

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
    <div className="max-w-2xl">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3 mb-5">
        <div>
          <h1 className="font-display text-[30px] leading-tight font-semibold tracking-tight text-(--ag-text)">Perfil da empresa</h1>
          <p className="text-[13.5px] text-(--ag-text-2)">Como o Alfred enxerga o seu negócio.</p>
        </div>
        <button
          onClick={() => setEditing(true)}
          className="flex items-center gap-1.5 h-11 px-4 text-[13.5px] font-semibold text-(--ag-text) bg-(--ag-surface-solid) border border-(--ag-hairline) hover:bg-(--ag-fill) rounded-full transition-colors"
        >
          <Pencil className="w-4 h-4" /> Editar
        </button>
      </div>

      <ProfileSummary config={project.config} />

      {/* A Análise de Domínio roda dentro do cadastro (etapa "Análise de
          Domínio" do wizard, reaberto em "Editar") — aqui só o gate. */}
      <div className="flex flex-col items-end gap-1.5 mt-6">
        <button
          onClick={onGoClusters}
          disabled={audit?.domainStatus !== 'finished'}
          className="flex items-center gap-1.5 px-5 py-2.5 text-sm font-semibold text-(--ag-surface-solid) bg-(--ag-text) hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed rounded-full transition-colors"
        >
          Avançar para Clusters <ArrowRight className="w-4 h-4" />
        </button>
        {audit?.domainStatus !== 'finished' && (
          <p className="text-[11px] text-(--ag-text-3)">
            {audit === undefined
              ? 'Carregando status da análise…'
              : audit === null
                ? <>Nenhuma Análise de Domínio rodada ainda. Clique em "Editar" para rodá-la (etapa "Análise de Domínio").</>
                : audit.domainStatus === 'processing'
                  ? 'A Análise de Domínio ainda está em andamento…'
                  : 'A Análise de Domínio falhou. Clique em "Editar" para tentar novamente.'}
          </p>
        )}
      </div>
    </div>
  );
};

export default CompanyProfile;
