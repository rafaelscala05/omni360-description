// Conteúdo de um payload de envio, no formato da regra de sincronização
// (src/modules/agent/sincronizacao.ts). Separado de syncStamp.ts para não
// puxar o Admin SDK: scripts/verify-sincronizacao.mjs importa daqui.

import type { ConteudoEnvio } from '../src/modules/agent/sincronizacao';
import type { TinyPushProduct } from './tinyAgent';
import type { WakePushProduct } from './wakeAgent';

export const conteudoDoPushTiny = (p: TinyPushProduct): ConteudoEnvio => ({
  titulo: p.nome,
  descricaoHtml: p.descricaoHtml,
  seoTitle: p.seoTitle,
  seoDescription: p.seoDescription,
  seoKeywords: p.seoKeywords,
  imagens: p.imagens ?? (p.urlImagem ? [p.urlImagem] : undefined),
});

export const conteudoDoPushWake = (p: WakePushProduct): ConteudoEnvio => ({
  descricaoHtml: p.descricaoHtml,
  seoTitle: p.seoTitle,
  seoDescription: p.seoDescription,
  seoKeywords: p.seoKeywords,
  imagens: p.imagensUrls,
});
