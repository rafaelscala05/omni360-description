// Checkpointer do LangGraph.js sobre o Firestore. Não existe um checkpointer
// oficial do LangGraph.js para Firestore (só Postgres/SQLite/MongoDB/Redis) —
// sem persistência, uma aprovação pendente se perde se o servidor reiniciar
// entre a pergunta e a resposta do usuário (relevante em Cloud Run, que
// escala a zero). A lógica de leitura/escrita abaixo espelha a
// implementação de referência do próprio pacote (`MemorySaver`, em
// node_modules/@langchain/langgraph-checkpoint/dist/memory.js), só trocando
// os dois objetos em memória por documentos no Firestore.
//
// Estrutura: users/{uid}/agent_threads/{threadId}/checkpoints/{checkpointId},
// com uma subcoleção `writes/{taskId}__{writeIdx}` por checkpoint — mesmo
// prefixo `agent_threads` já usado pelo Operacional, para manter as
// conversas dos dois agentes num lugar previsível.
import {
  BaseCheckpointSaver,
  WRITES_IDX_MAP,
  copyCheckpoint,
  getCheckpointId,
  type Checkpoint,
  type CheckpointMetadata,
  type CheckpointTuple,
  type CheckpointListOptions,
  type PendingWrite,
} from '@langchain/langgraph-checkpoint';
import type { RunnableConfig } from '@langchain/core/runnables';
import { adminDb } from '../firebaseAdmin';

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

function fromBase64(str: string): Uint8Array {
  return new Uint8Array(Buffer.from(str, 'base64'));
}

function requireUid(config: RunnableConfig): string {
  const uid = config.configurable?.uid as string | undefined;
  if (!uid) throw new Error('FirestoreCheckpointSaver: uid ausente em config.configurable.');
  return uid;
}

function requireThreadId(config: RunnableConfig): string {
  const threadId = config.configurable?.thread_id as string | undefined;
  if (!threadId) throw new Error('FirestoreCheckpointSaver: thread_id ausente em config.configurable.');
  return threadId;
}

function checkpointsRef(uid: string, threadId: string) {
  return adminDb.collection('users').doc(uid).collection('agent_threads').doc(threadId).collection('checkpoints');
}

// Coleção raiz minúscula: threadId -> uid. Único propósito é permitir
// deleteThread(threadId) (que não recebe uid) sem precisar de uma
// collectionGroup query nem de um índice novo — ver o comentário em put().
function threadOwnerRef(threadId: string) {
  return adminDb.collection('agent_thread_owners').doc(threadId);
}

interface CheckpointDoc {
  ns: string;
  checkpoint: string;
  metadata: string;
  parentCheckpointId: string | null;
  createdAt: string;
}

export class FirestoreCheckpointSaver extends BaseCheckpointSaver {
  private async loadPendingWrites(
    ref: FirebaseFirestore.DocumentReference,
  ): Promise<[string, string, unknown][]> {
    const snap = await ref.collection('writes').get();
    return Promise.all(
      snap.docs.map(async (w) => {
        const data = w.data() as { taskId: string; channel: string; value: string };
        return [data.taskId, data.channel, await this.serde.loadsTyped('json', fromBase64(data.value))] as [
          string,
          string,
          unknown,
        ];
      }),
    );
  }

  private async toTuple(
    uid: string,
    threadId: string,
    checkpointId: string,
    data: CheckpointDoc,
    ref: FirebaseFirestore.DocumentReference,
  ): Promise<CheckpointTuple> {
    const checkpoint = (await this.serde.loadsTyped('json', fromBase64(data.checkpoint))) as Checkpoint;
    const metadata = (await this.serde.loadsTyped('json', fromBase64(data.metadata))) as CheckpointMetadata;
    const pendingWrites = await this.loadPendingWrites(ref);

    const tuple: CheckpointTuple = {
      config: { configurable: { uid, thread_id: threadId, checkpoint_ns: data.ns, checkpoint_id: checkpointId } },
      checkpoint,
      metadata,
      pendingWrites,
    };
    if (data.parentCheckpointId) {
      tuple.parentConfig = {
        configurable: { uid, thread_id: threadId, checkpoint_ns: data.ns, checkpoint_id: data.parentCheckpointId },
      };
    }
    return tuple;
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const uid = requireUid(config);
    const threadId = requireThreadId(config);
    const checkpointNs = (config.configurable?.checkpoint_ns as string) ?? '';
    const checkpointId = getCheckpointId(config);
    const collection = checkpointsRef(uid, threadId);

    if (checkpointId) {
      const snap = await collection.doc(checkpointId).get();
      if (!snap.exists) return undefined;
      return this.toTuple(uid, threadId, checkpointId, snap.data() as CheckpointDoc, snap.ref);
    }

    // Busca a coleção inteira sem `orderBy`/`where` e ordena em memória.
    // Testado ao vivo: até um `orderBy(FieldPath.documentId())` sozinho (sem
    // nenhum `where`) foi recusado pelo Firestore deste projeto com
    // FAILED_PRECONDITION pedindo um índice — este banco não tem indexação
    // automática de campo único habilitada para coleções novas. Criar esse
    // índice é uma mudança de infra de produção (`firebase deploy
    // --only firestore:indexes`) que não faz sentido rodar por baixo dos
    // panos aqui; como o volume de checkpoints por thread é pequeno (uma
    // conversa inteira, não uma coleção enorme), buscar tudo e ordenar em
    // JS é uma troca aceitável e não depende de nenhum índice.
    const snap = await collection.get();
    const doc = snap.docs
      .filter((d) => ((d.data() as CheckpointDoc).ns ?? '') === checkpointNs)
      .sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))[0];
    if (!doc) return undefined;
    return this.toTuple(uid, threadId, doc.id, doc.data() as CheckpointDoc, doc.ref);
  }

  async *list(config: RunnableConfig, options?: CheckpointListOptions): AsyncGenerator<CheckpointTuple> {
    const uid = requireUid(config);
    const threadId = requireThreadId(config);
    const checkpointNs = config.configurable?.checkpoint_ns as string | undefined;
    const beforeId = options?.before?.configurable?.checkpoint_id as string | undefined;

    // Mesmo motivo do getTuple(): sem orderBy/where no Firestore, tudo em JS.
    const snap = await checkpointsRef(uid, threadId).get();
    let docs = snap.docs.slice().sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
    if (checkpointNs !== undefined) docs = docs.filter((d) => ((d.data() as CheckpointDoc).ns ?? '') === checkpointNs);
    if (beforeId) docs = docs.filter((d) => d.id < beforeId);

    let count = 0;
    for (const doc of docs) {
      if (options?.limit !== undefined && count >= options.limit) break;
      const data = doc.data() as CheckpointDoc;
      const metadata = (await this.serde.loadsTyped('json', fromBase64(data.metadata))) as CheckpointMetadata;
      if (options?.filter && !Object.entries(options.filter).every(([k, v]) => (metadata as Record<string, unknown>)[k] === v)) {
        continue;
      }
      count += 1;
      yield this.toTuple(uid, threadId, doc.id, data, doc.ref);
    }
  }

  async put(config: RunnableConfig, checkpoint: Checkpoint, metadata: CheckpointMetadata): Promise<RunnableConfig> {
    const uid = requireUid(config);
    const threadId = requireThreadId(config);
    const checkpointNs = (config.configurable?.checkpoint_ns as string) ?? '';
    const prepared = copyCheckpoint(checkpoint);

    const [[, checkpointBytes], [, metadataBytes]] = await Promise.all([
      this.serde.dumpsTyped(prepared),
      this.serde.dumpsTyped(metadata),
    ]);

    const doc: CheckpointDoc = {
      ns: checkpointNs,
      checkpoint: toBase64(checkpointBytes),
      metadata: toBase64(metadataBytes),
      parentCheckpointId: (config.configurable?.checkpoint_id as string) ?? null,
      createdAt: new Date().toISOString(),
    };
    await Promise.all([
      checkpointsRef(uid, threadId).doc(checkpoint.id).set(doc),
      // Índice mínimo pra deleteThread(threadId) achar o dono sem precisar de
      // uma collectionGroup query — testado ao vivo: uma collectionGroup
      // filtrando por FieldPath.documentId() exige o valor como caminho
      // completo (não dá pra montar sem já saber o uid, que é exatamente o
      // que falta), e qualquer outra collectionGroup query neste projeto
      // precisaria de um índice novo (fora do escopo de criar aqui). Um doc
      // de 1 campo é bem mais barato que resolver isso com índice.
      threadOwnerRef(threadId).set({ uid }, { merge: true }),
    ]);

    return { configurable: { uid, thread_id: threadId, checkpoint_ns: checkpointNs, checkpoint_id: checkpoint.id } };
  }

  async putWrites(config: RunnableConfig, writes: PendingWrite[], taskId: string): Promise<void> {
    const uid = requireUid(config);
    const threadId = requireThreadId(config);
    const checkpointId = config.configurable?.checkpoint_id as string | undefined;
    if (!checkpointId) throw new Error('FirestoreCheckpointSaver.putWrites: checkpoint_id ausente em config.configurable.');

    const writesRef = checkpointsRef(uid, threadId).doc(checkpointId).collection('writes');
    await Promise.all(
      writes.map(async ([channel, value], idx) => {
        const writeIdx = WRITES_IDX_MAP[channel] ?? idx;
        const docId = `${taskId}__${writeIdx}`;
        // Espelha o MemorySaver: índices "especiais" (negativos, ex. erros)
        // nunca são sobrescritos por uma escrita concorrente do mesmo slot.
        if (writeIdx >= 0) {
          const existing = await writesRef.doc(docId).get();
          if (existing.exists) return;
        }
        const [, bytes] = await this.serde.dumpsTyped(value);
        await writesRef.doc(docId).set({ taskId, channel, value: toBase64(bytes) });
      }),
    );
  }

  // A assinatura da base class só recebe threadId (sem uid). Resolve o dono
  // via agent_thread_owners (ver put()) em vez de uma collectionGroup query —
  // testado ao vivo: filtrar collectionGroup por FieldPath.documentId() exige
  // o caminho completo (que exigiria já saber o uid, o problema original), e
  // qualquer outro filtro de collectionGroup neste banco pediu um índice novo
  // que não faz sentido criar por baixo dos panos aqui. Threads não são
  // deletadas por nenhum fluxo do Agente de Conteúdo hoje (só criadas/lidas/
  // escritas) — implementado para satisfazer o contrato abstrato.
  async deleteThread(threadId: string): Promise<void> {
    const ownerSnap = await threadOwnerRef(threadId).get();
    if (!ownerSnap.exists) return;
    const { uid } = ownerSnap.data() as { uid: string };

    const checkpointsSnap = await checkpointsRef(uid, threadId).get();
    for (const checkpointDoc of checkpointsSnap.docs) {
      const writesSnap = await checkpointDoc.ref.collection('writes').get();
      await Promise.all(writesSnap.docs.map((w) => w.ref.delete()));
      await checkpointDoc.ref.delete();
    }
    await threadOwnerRef(threadId).delete();
  }
}
