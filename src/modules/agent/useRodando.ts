// Escuta os vídeos em produção (clássico e UGC) para a aba "Rodando" da
// Atividade. As duas coleções são legíveis pelo dono (firestore.rules) e só o
// servidor escreve nelas.

import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../../firebase';
import { itensRodando, type ItemRodando, type JobVideo } from './rodando';

function useJobsAtivos(uid: string, colecao: 'videoJobs' | 'ugcVideoJobs'): JobVideo[] {
  const [jobs, setJobs] = useState<JobVideo[]>([]);
  useEffect(() => {
    if (!uid) return;
    const q = query(collection(db, 'users', uid, colecao), where('status', 'in', ['queued', 'processing']));
    return onSnapshot(
      q,
      (snap) => setJobs(snap.docs.map((d) => ({ jobId: d.id, ...(d.data() as Omit<JobVideo, 'jobId'>) }))),
      () => setJobs([]),
    );
  }, [uid, colecao]);
  return jobs;
}

export function useRodando(uid: string, nomes: Map<string, string>): ItemRodando[] {
  const classico = useJobsAtivos(uid, 'videoJobs');
  const ugc = useJobsAtivos(uid, 'ugcVideoJobs');
  // Recalcula a cada minuto para "parado" aparecer sem precisar de snapshot novo.
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  return useMemo(() => itensRodando({ classico, ugc }, (id) => nomes.get(id), agora), [classico, ugc, nomes, agora]);
}
