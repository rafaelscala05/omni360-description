import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import firebaseConfig from '../firebase-applet-config.json';

// Initialize Firebase
export const app = initializeApp(firebaseConfig);

// App Check — protege Firestore/Storage/AI Logic contra acesso de fora do app.
// A site key do reCAPTCHA v3 é pública (embutida no cliente), como a apiKey do
// Firebase. Em produção, registre o domínio no reCAPTCHA; em dev (localhost),
// gere um debug token no console e exporte como VITE_APPCHECK_DEBUG_TOKEN no .env.
const RECAPTCHA_V3_SITE_KEY = '6LcDQiYtAAAAAD36ttqPFHGLKQ1Q_s4JVTekmwaH';

if (import.meta.env.DEV && import.meta.env.VITE_APPCHECK_DEBUG_TOKEN) {
  (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: string }).FIREBASE_APPCHECK_DEBUG_TOKEN =
    import.meta.env.VITE_APPCHECK_DEBUG_TOKEN;
}

initializeAppCheck(app, {
  provider: new ReCaptchaV3Provider(RECAPTCHA_V3_SITE_KEY),
  isTokenAutoRefreshEnabled: true,
});

// Initialize Firebase services
export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const storage = getStorage(app);
