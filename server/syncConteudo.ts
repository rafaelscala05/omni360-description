// Conteúdo de um payload de envio, no formato da regra de sincronização
// (src/modules/agent/sincronizacao.ts) — o mesmo conversor que o cliente usa
// para atualizar o selo em memória. Separado de syncStamp.ts para não puxar o
// Admin SDK: scripts/verify-sincronizacao.mjs importa daqui.

import { conteudoDoPayload, type ConteudoEnvio } from '../src/modules/agent/sincronizacao';
import type { TinyPushProduct } from './tinyAgent';
import type { WakePushProduct } from './wakeAgent';

export const conteudoDoPushTiny = (p: TinyPushProduct): ConteudoEnvio => conteudoDoPayload('tiny', p);
export const conteudoDoPushWake = (p: WakePushProduct): ConteudoEnvio => conteudoDoPayload('wake', p);
