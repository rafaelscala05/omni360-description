import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';

export interface LeadInput {
  nome: string;
  email: string;
  mensagem: string;
}

/** Grava um lead de contato no Firestore (coleção `leads`). */
export async function saveLead(data: LeadInput): Promise<void> {
  await addDoc(collection(db, 'leads'), { ...data, createdAt: serverTimestamp() });
}
