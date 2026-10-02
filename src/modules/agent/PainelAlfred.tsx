import React from 'react';
import ChatThread from './chat/ChatThread';
import Composer from './chat/Composer';
import LoteEmAndamento from './chat/LoteEmAndamento';
import type { ConversaAlfred } from './useConversaAlfred';

interface Props {
  uid: string;
  conversa: ConversaAlfred;
  rodape?: React.ReactNode;
  vazio?: React.ReactNode;
  onFoco?: (f: boolean) => void;
  recuoTeclado?: number;
  emFoco?: boolean;
  acimaDoComposer?: React.ReactNode;
}

/**
 * A conversa do Alfred em qualquer tela: a mesma thread (useConversaAlfred),
 * o mesmo pensamento ao vivo e os mesmos cards. `rodape` recebe cards locais
 * que não são mensagens persistidas (a confirmação da tela de Produtos).
 */
const PainelAlfred: React.FC<Props> = ({ uid, conversa, rodape, vazio, onFoco, recuoTeclado = 0, emFoco = false, acimaDoComposer }) => {
  const temConversa = conversa.mensagens.length > 0 || conversa.streaming || conversa.interagiu || !!rodape;
  return (
    <div className="h-full min-h-0 flex flex-col">
      {temConversa ? (
        <ChatThread
          uid={uid}
          mensagens={conversa.mensagens}
          acoes={conversa.acoes}
          parcial={conversa.parcial}
          leituras={conversa.leituras}
          streaming={conversa.streaming}
          erro={conversa.erro}
          onExecutar={conversa.executar}
          onRejeitar={conversa.rejeitar}
          onAjustar={conversa.comecarAjuste}
          rodape={rodape}
        />
      ) : (vazio ?? <div className="flex-1" />)}
      <Composer
        disabled={false}
        streaming={conversa.streaming}
        onEnviar={(t) => { void conversa.enviarDoComposer(t); }}
        ajustando={conversa.etiquetaAjuste}
        onParar={conversa.parar}
        onFoco={onFoco ?? (() => {})}
        recuoTeclado={recuoTeclado}
        emFoco={emFoco}
        acima={<>{acimaDoComposer}<LoteEmAndamento uid={uid} /></>}
      />
    </div>
  );
};

export default PainelAlfred;
