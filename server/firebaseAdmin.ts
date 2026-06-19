// Shared Firebase Admin SDK initialization.
//
// Both server.ts (HTTP layer) and server/contentAgent.ts (content pipeline) import
// adminDb/adminAuth from here. Keeping init in a leaf module avoids a circular
// import: server.ts runs startServer() at module load, so importing it from
// contentAgent.ts would re-trigger the server bootstrap.
import { initializeApp, getApps, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import firebaseAppletConfig from '../firebase-applet-config.json';

// Pin the Admin SDK to the SAME Firebase project the client uses to mint ID
// tokens, so verifyIdToken's expected "aud" always matches the token issuer.
const { projectId: firebaseProjectId, firestoreDatabaseId } = firebaseAppletConfig;

if (!getApps().length) {
  initializeApp({
    credential: applicationDefault(),
    projectId: firebaseProjectId,
  });
}

// The client uses a NAMED Firestore database (firestoreDatabaseId), not the
// "(default)" one. The Admin SDK must target the same named database or writes
// fail with "5 NOT_FOUND".
export const adminDb = getFirestore(firestoreDatabaseId);
export const adminAuth = getAuth();
export { FieldValue };
