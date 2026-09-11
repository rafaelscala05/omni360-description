// Visão unificada de "o que está conectado", agregando os quatro endpoints de
// status que já existem (Wake, Tiny, Bling, IdWorks) num formato só.
//
// Cada integração tem o seu próprio formato de status (versão, CNPJ, nome da
// conta, webhook…), e a tela do agente precisa dos quatro lado a lado. Em vez
// de espalhar quatro `useEffect` + quatro shapes diferentes pela UI, a
// normalização mora aqui.
//
// Uma integração que falha ao responder não derruba as outras: `allSettled` +
// `erro` no item, porque "não consegui checar" é uma informação diferente de
// "não está conectado" e o usuário precisa ver a diferença.

import { wakeStatus } from './wakeService';
import { tinyStatus } from './tinyService';
import { blingStatus } from './blingService';
import { idworksStatus } from './idworksService';

export type IntegrationKey = 'wake' | 'tiny' | 'bling' | 'idworks';

export interface IntegrationSummary {
  chave: IntegrationKey;
  nome: string;
  /** Uma palavra sobre o papel da plataforma, para quem não reconhece o nome. */
  papel: string;
  conectado: boolean;
  validado: boolean;
  /** Conta/versão/CNPJ — o que identifica *qual* conta está conectada. */
  detalhe: string | null;
  ultimaValidacao: string | null;
  /** Preenchido quando a checagem em si falhou (rede, 500, sessão expirada). */
  erro?: string;
}

const VAZIO: Record<IntegrationKey, Omit<IntegrationSummary, 'erro'>> = {
  wake: {
    chave: 'wake', nome: 'Wake Commerce', papel: 'Loja',
    conectado: false, validado: false, detalhe: null, ultimaValidacao: null,
  },
  tiny: {
    chave: 'tiny', nome: 'Tiny', papel: 'ERP',
    conectado: false, validado: false, detalhe: null, ultimaValidacao: null,
  },
  bling: {
    chave: 'bling', nome: 'Bling', papel: 'ERP',
    conectado: false, validado: false, detalhe: null, ultimaValidacao: null,
  },
  idworks: {
    chave: 'idworks', nome: 'IdWorks', papel: 'ERP',
    conectado: false, validado: false, detalhe: null, ultimaValidacao: null,
  },
};

function mensagem(e: unknown): string {
  return (e as { message?: string })?.message ?? 'Não consegui checar agora.';
}

export async function fetchIntegrationsOverview(): Promise<IntegrationSummary[]> {
  const [wake, tiny, bling, idworks] = await Promise.allSettled([
    wakeStatus(), tinyStatus(), blingStatus(), idworksStatus(),
  ]);

  const resultado: IntegrationSummary[] = [];

  resultado.push(wake.status === 'fulfilled'
    ? {
      ...VAZIO.wake,
      conectado: wake.value.connected,
      validado: wake.value.validated,
      ultimaValidacao: wake.value.lastValidatedAt,
    }
    : { ...VAZIO.wake, erro: mensagem(wake.reason) });

  resultado.push(tiny.status === 'fulfilled'
    ? {
      ...VAZIO.tiny,
      conectado: tiny.value.connected,
      validado: tiny.value.validated,
      detalhe: tiny.value.cnpj ?? (tiny.value.version ? tiny.value.version.toUpperCase() : null),
      ultimaValidacao: tiny.value.lastValidatedAt,
    }
    : { ...VAZIO.tiny, erro: mensagem(tiny.reason) });

  resultado.push(bling.status === 'fulfilled'
    ? {
      ...VAZIO.bling,
      conectado: bling.value.connected,
      validado: bling.value.validated,
      detalhe: bling.value.companyId ?? null,
      ultimaValidacao: bling.value.lastValidatedAt,
    }
    : { ...VAZIO.bling, erro: mensagem(bling.reason) });

  resultado.push(idworks.status === 'fulfilled'
    ? {
      ...VAZIO.idworks,
      conectado: idworks.value.connected,
      validado: idworks.value.validated,
      detalhe: idworks.value.accountName,
      ultimaValidacao: idworks.value.lastValidatedAt,
    }
    : { ...VAZIO.idworks, erro: mensagem(idworks.reason) });

  return resultado;
}

/** "há 3 min" / "ontem" — relativo curto, no estilo das listas do iOS. */
export function desde(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return null;
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'ontem';
  if (d < 30) return `há ${d} dias`;
  return new Date(iso).toLocaleDateString('pt-BR');
}
