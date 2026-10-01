// Estado da conexão do Mercado Livre para a tela de fontes e o rodapé da
// semana. Fica fora de `fetchIntegrationsOverview` porque só existe com o
// módulo do otimizador ligado — sem ele não há rota de conexão a consultar.

import { useEffect, useState } from 'react';
import { meliConnection } from '../../services/meliService';
import type { EstadoMeli } from './conectores';

/** `null` enquanto não checou (ou sem módulo): a fonte não aparece em lugar nenhum. */
export function useEstadoMeli(ativo: boolean, recarga = 0): EstadoMeli | null {
  const [estado, setEstado] = useState<EstadoMeli | null>(null);

  useEffect(() => {
    if (!ativo) {
      setEstado(null);
      return;
    }
    let vivo = true;
    meliConnection()
      .then((c) => { if (vivo) setEstado({ conectado: !!c?.connected, status: c?.status ?? 'disconnected' }); })
      .catch((e: unknown) => {
        if (vivo) setEstado({ erro: (e as { message?: string })?.message ?? 'Não consegui checar agora.' });
      });
    return () => { vivo = false; };
  }, [ativo, recarga]);

  return estado;
}
