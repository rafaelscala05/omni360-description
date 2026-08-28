import type { ReactNode } from 'react';
import { CopilotKit, CopilotSidebar, useAgentContext, useInterrupt } from '@copilotkit/react-core/v2';
import '@copilotkit/react-core/v2/styles.css';
import { ApprovalCard, type ApprovalPreview } from './ApprovalCard';
import { CredentialForm } from './CredentialForm';
import type { ContentProject } from '../types';

function ContentAgentBridge({
  uid, project, articleId, children,
}: { uid: string; project: ContentProject | null; articleId: string | null; children: ReactNode }) {
  useAgentContext({
    description: 'Projeto de conteúdo atualmente aberto no workspace',
    value: project ? { id: project.id, nomeEmpresa: project.config.nomeEmpresa } : null,
  });
  useAgentContext({ description: 'Artigo em foco no workspace, se houver', value: articleId });

  // Um único registro cobre qualquer ferramenta do grafo que pause — o
  // roteamento por nome já acontece dentro do grafo (ver
  // server/agent/registry.ts:toLangChainTools); o frontend só decide qual UI
  // renderizar olhando `preview.ferramenta`.
  //
  // content.credencial.conectar é uma ferramenta de SERVIDOR (não uma
  // ferramenta de frontend via useHumanInTheLoop) — testado lendo o
  // código-fonte de @ag-ui/langgraph: o adaptador desestrutura `tools` de
  // RunAgentInput mas nunca o repassa ao LangGraph, então ferramentas
  // registradas só no cliente nunca chegariam a aparecer pro modelo. Por
  // isso ela usa o mesmo interrupt() das outras, e o formulário lê
  // `provider`/`projectId` de `preview.args` (os argumentos originais da
  // chamada, ecoados pelo interrupt — ver registry.ts). A senha/token em si
  // nunca vira argumento de tool call: o formulário grava direto no
  // Firestore antes de resolver o interrupt.
  useInterrupt({
    agentId: 'content_agent',
    render: ({ event, resolve }) => {
      const preview: ApprovalPreview = event?.value ? JSON.parse(event.value as string) : {};
      if (preview.ferramenta === 'content.credencial.conectar') {
        const args = preview.args as { provider?: 'wordpress' | 'sanity'; projectId?: string } | undefined;
        if (args?.provider && args?.projectId) {
          return (
            <CredentialForm
              uid={uid}
              provider={args.provider}
              projectId={args.projectId}
              onDone={(ok) => resolve({ aprovado: ok })}
            />
          );
        }
      }
      return <ApprovalCard preview={preview} onDecide={(aprovado) => resolve({ aprovado })} />;
    },
  });

  // CopilotSidebar não é um wrapper de conteúdo — ele mesmo se renderiza como
  // um painel docado (seu `children` é pra customizar slots internos do chat,
  // não pra receber o app; confirmado pelo tipo real de CopilotSidebarProps,
  // que estende CopilotChatProps). Por isso ele entra como irmão do app, não
  // como pai.
  return (
    <>
      {children}
      <CopilotSidebar agentId="content_agent" />
    </>
  );
}

export function ContentCopilotProvider({
  uid, project, articleId, authToken, children,
}: {
  uid: string;
  project: ContentProject | null;
  articleId: string | null;
  authToken: string;
  children: ReactNode;
}) {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="content_agent" headers={{ Authorization: `Bearer ${authToken}` }}>
      <ContentAgentBridge uid={uid} project={project} articleId={articleId}>{children}</ContentAgentBridge>
    </CopilotKit>
  );
}
