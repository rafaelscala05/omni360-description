import type { ReactNode } from 'react';
import { CopilotKit, CopilotSidebar, useAgentContext, useInterrupt } from '@copilotkit/react-core/v2';
import '@copilotkit/react-core/v2/styles.css';
import { ApprovalCard, type ApprovalPreview } from './ApprovalCard';
import type { ContentProject } from '../types';

function ContentAgentBridge({
  project, articleId, children,
}: { project: ContentProject | null; articleId: string | null; children: ReactNode }) {
  useAgentContext({
    description: 'Projeto de conteúdo atualmente aberto no workspace',
    value: project ? { id: project.id, nomeEmpresa: project.config.nomeEmpresa } : null,
  });
  useAgentContext({ description: 'Artigo em foco no workspace, se houver', value: articleId });

  // Um único registro cobre qualquer ferramenta do grafo que pause — o
  // roteamento por nome já acontece dentro do grafo (ver
  // server/agent/registry.ts:toLangChainTools); o frontend só precisa saber
  // renderizar o preview genérico que veio no payload do interrupt().
  useInterrupt({
    agentId: 'content_agent',
    render: ({ event, resolve }) => {
      const preview: ApprovalPreview = event?.value ? JSON.parse(event.value as string) : {};
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
  project, articleId, authToken, children,
}: {
  project: ContentProject | null;
  articleId: string | null;
  authToken: string;
  children: ReactNode;
}) {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="content_agent" headers={{ Authorization: `Bearer ${authToken}` }}>
      <ContentAgentBridge project={project} articleId={articleId}>{children}</ContentAgentBridge>
    </CopilotKit>
  );
}
