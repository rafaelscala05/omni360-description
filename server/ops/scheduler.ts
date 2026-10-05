// Agendador único dos syncs do Centro de Operações: a cada minuto, varre os
// `ops_sync` vencidos (`proximaEm <= agora`) e despacha pelo tipo — pedidos
// (pedidosSync.ts, doc id = fonte) ou catálogo da loja (lojaSync.ts, doc
// `wake-catalogo`). Cada sync tem o próprio lease; aqui só se dispara.

import { deps, dispararCiclo } from './pedidosSync';
import { dispararCicloLoja, ID_SYNC_LOJA } from './lojaSync';
import type { PlataformaOps } from '../../src/modules/agent/ops/papeis';

let timer: NodeJS.Timeout | null = null;
let varrendo = false;

export async function varrerOpsSync(): Promise<void> {
  if (varrendo) return;
  varrendo = true;
  try {
    const snap = await deps.db.collectionGroup('ops_sync').where('proximaEm', '<=', Date.now()).limit(20).get();
    for (const doc of snap.docs) {
      const m = doc.ref.path.match(/^users\/([^/]+)\/ops_sync\/([^/]+)$/);
      if (!m) continue;
      if (m[2] === ID_SYNC_LOJA) dispararCicloLoja(m[1]);
      else dispararCiclo(m[1], m[2] as PlataformaOps);
    }
  } catch (e) {
    console.warn('[ops-sync] varredura falhou', e instanceof Error ? e.message : String(e));
  } finally {
    varrendo = false;
  }
}

export function startOpsSyncScheduler(): void {
  if (timer) return;
  void varrerOpsSync();
  timer = setInterval(() => void varrerOpsSync(), 60_000);
  timer.unref?.();
}
