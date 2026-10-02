// Carimbo de sincronização: grava, no doc do produto, o hash do que o ERP
// passou a ter depois de um envio (ver src/modules/agent/sincronizacao.ts).
//
// Chamado logo depois do push, com o próprio payload que saiu — nunca relendo
// o produto, que pode ter mudado no meio — e só para os grupos que o push
// confirmou ("ok" ou "sem alteração"). Melhor-esforço: falhar aqui nunca
// derruba o envio, só deixa o selo em "não enviada" até o próximo.

import { adminDb } from './firebaseAdmin';
import {
  assinaturasDoEnvio, CAMPO_CARIMBO, CAMPO_VINCULO, type ConteudoEnvio,
} from '../src/modules/agent/sincronizacao';

export { conteudoDoPushTiny, conteudoDoPushWake } from './syncConteudo';

const produtos = (uid: string) => adminDb.collection('users').doc(uid).collection('products');

export async function carimbarEnvio(
  uid: string,
  // Bling e IdWorks ficam de fora: o navegador grava a assinatura legada deles (App.tsx).
  integ: 'tiny' | 'wake',
  itens: { erpId: string; ok: boolean; conteudo: ConteudoEnvio; steps: Record<string, string | undefined> }[],
): Promise<number> {
  let n = 0;
  try {
    const campoVinculo = CAMPO_VINCULO[integ];
    const campoCarimbo = CAMPO_CARIMBO[integ];
    for (const it of itens) {
      // Por passo, não por item: um grupo que falhou (ex.: atributos na Wake)
      // não impede carimbar os que foram. Item que falhou inteiro tem erro em todo passo.
      if (!it.erpId) continue;
      const carimbo = assinaturasDoEnvio(integ, it.conteudo, it.steps);
      if (!Object.keys(carimbo).length) continue;
      const snap = await produtos(uid).where(campoVinculo, '==', String(it.erpId)).get();
      for (const d of snap.docs) {
        // merge: grupos não enviados agora mantêm o carimbo anterior.
        await d.ref.set({ [campoCarimbo]: carimbo }, { merge: true });
        n++;
      }
    }
  } catch (e) {
    console.warn(`[sync] falha ao carimbar envio ${integ}:`, e instanceof Error ? e.message : String(e));
  }
  return n;
}
