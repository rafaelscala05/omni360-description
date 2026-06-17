/**
 * One-time migration: converts legacy Firebase Storage signed URLs
 * (firebasestorage.googleapis.com?token=...) to public URLs
 * (storage.googleapis.com/BUCKET/PATH).
 *
 * Prerequisites:
 *   1. Bucket IAM: allUsers → Storage Object Viewer (already done)
 *   2. GOOGLE_APPLICATION_CREDENTIALS set (same ADC used by server.ts)
 *
 * Run:
 *   npx tsx scripts/migrate-storage-urls.ts
 *   npx tsx scripts/migrate-storage-urls.ts --dry-run   (preview only)
 */

import { initializeApp, getApps, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import firebaseAppletConfig from '../firebase-applet-config.json';

const { projectId, firestoreDatabaseId } = firebaseAppletConfig;

if (!getApps().length) {
  initializeApp({ credential: applicationDefault(), projectId });
}

const db = getFirestore(firestoreDatabaseId);
const dryRun = process.argv.includes('--dry-run');

const IMAGE_FIELDS = [
  'URL imagem 1', 'URL imagem 2', 'URL imagem 3',
  'URL imagem 4', 'URL imagem 5', 'URL imagem 6',
];

function convertUrl(url: string): string | null {
  if (!url || !url.includes('firebasestorage.googleapis.com')) return null;
  const match = url.match(/\/b\/([^/]+)\/o\/(.+?)(?:\?|$)/);
  if (!match) return null;
  const bucket = match[1];
  const filePath = decodeURIComponent(match[2]);
  return `https://storage.googleapis.com/${bucket}/${filePath}`;
}

async function migrate() {
  console.log(dryRun ? '[DRY RUN] Simulando migração...\n' : 'Iniciando migração...\n');

  const usersSnap = await db.collection('users').listDocuments();
  let totalProducts = 0;
  let totalUpdated = 0;

  for (const userRef of usersSnap) {
    const productsSnap = await userRef.collection('products').get();

    for (const doc of productsSnap.docs) {
      totalProducts++;
      const data = doc.data();
      const updates: Record<string, any> = {};

      for (const field of IMAGE_FIELDS) {
        const val = data[field];
        if (typeof val === 'string') {
          const converted = convertUrl(val);
          if (converted) updates[field] = converted;
        }
      }

      const ambientImages: string[] = data._ambientImages ?? [];
      const newAmbient = ambientImages.map(url => convertUrl(url) ?? url);
      if (newAmbient.some((url, i) => url !== ambientImages[i])) {
        updates['_ambientImages'] = newAmbient;
      }

      if (Object.keys(updates).length > 0) {
        totalUpdated++;
        console.log(`  ${userRef.id} / ${doc.id}: ${Object.keys(updates).join(', ')}`);
        if (!dryRun) {
          await doc.ref.update(updates);
        }
      }
    }
  }

  console.log(`\nTotal produtos verificados: ${totalProducts}`);
  console.log(`Total documentos ${dryRun ? 'que seriam ' : ''}atualizados: ${totalUpdated}`);
  if (dryRun) console.log('\nRode sem --dry-run para aplicar as mudanças.');
}

migrate().catch(err => {
  console.error('Erro na migração:', err);
  process.exit(1);
});
