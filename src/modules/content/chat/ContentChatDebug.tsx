// Página temporária só para validar o round-trip de aprovação (Task 2). É
// removida/substituída na Task 13 pela integração real no ContentApp.
import { CopilotKit, CopilotChat, useInterrupt } from '@copilotkit/react-core/v2';
import '@copilotkit/react-core/v2/styles.css';

interface ToyInterruptPayload {
  resumo?: string;
  alvo?: string;
}

function ToyApproval() {
  useInterrupt({
    agentId: 'content_agent',
    render: ({ event, resolve }) => {
      const payload: ToyInterruptPayload = event?.value ? JSON.parse(event.value as string) : {};
      return (
        <div className="border rounded-lg p-3 space-y-2">
          <p>{payload.resumo ?? 'Aprovar ação?'}</p>
          <div className="flex gap-2">
            <button onClick={() => resolve({ aprovado: true })}>Aprovar</button>
            <button onClick={() => resolve({ aprovado: false })}>Rejeitar</button>
          </div>
        </div>
      );
    },
  });
  return null;
}

export default function ContentChatDebug({ authToken }: { authToken: string }) {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="content_agent" headers={{ Authorization: `Bearer ${authToken}` }}>
      <ToyApproval />
      <CopilotChat agentId="content_agent" />
    </CopilotKit>
  );
}
