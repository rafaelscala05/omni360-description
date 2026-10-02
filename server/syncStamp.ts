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

/** Limite do operador `in` do Firestore. */
const MAX_IN = 30;
/** Limite de escritas de um WriteBatch. */
const MAX_BATCH = 500;

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
    // Por passo, não por item: um grupo que falhou (ex.: atributos na Wake)
    // não impede carimbar os que foram. Item que falhou inteiro tem erro em todo passo.
    const porId = new Map<string, ReturnType<typeof assinaturasDoEnvio>>();
    for (const it of itens) {
      if (!it.erpId) continue;
      const carimbo = assinaturasDoEnvio(integ, it.conteudo, it.steps);
      if (Object.keys(carimbo).length) porId.set(String(it.erpId), { ...porId.get(String(it.erpId)), ...carimbo });
    }
    if (!porId.size) return 0;

    // Uma consulta por 30 vínculos e um batch por 500 escritas, em vez de uma
    // consulta e uma escrita por produto — num envio de 50 itens isso era a
    // maior parte do tempo depois do push.
    const ids = [...porId.keys()];
    const consultas: Promise<FirebaseFirestore.QuerySnapshot>[] = [];
    for (let i = 0; i < ids.length; i += MAX_IN) {
      consultas.push(produtos(uid).where(campoVinculo, 'in', ids.slice(i, i + MAX_IN)).get());
    }
    const docs = (await Promise.all(consultas)).flatMap((s) => s.docs);
    for (let i = 0; i < docs.length; i += MAX_BATCH) {
      const batch = adminDb.batch();
      for (const d of docs.slice(i, i + MAX_BATCH)) {
        const carimbo = porId.get(String(d.get(campoVinculo)));
        if (!carimbo) continue;
        // merge: grupos não enviados agora mantêm o carimbo anterior.
        batch.set(d.ref, { [campoCarimbo]: carimbo }, { merge: true });
        n++;
      }
      await batch.commit();
    }
  } catch (e) {
    console.warn(`[sync] falha ao carimbar envio ${integ}:`, e instanceof Error ? e.message : String(e));
  }
  return n;
}
