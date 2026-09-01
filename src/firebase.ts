import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { getAuth } from 'firebase/auth';
import { initializeFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import firebaseConfig from '../firebase-applet-config.json';

// Initialize Firebase
export const app = initializeApp(firebaseConfig);

// App Check — protege Firestore/Storage/AI Logic contra acesso de fora do app.
// Usa reCAPTCHA Enterprise: o provedor no Firebase App Check (app Web) precisa
// estar registrado como "reCAPTCHA Enterprise" com esta MESMA chave. A site key
// é pública (embutida no cliente), como a apiKey do Firebase. Em dev (localhost),
// gere um debug token no console e exporte como VITE_APPCHECK_DEBUG_TOKEN no .env.
const RECAPTCHA_ENTERPRISE_SITE_KEY = '6LcDQiYtAAAAAD36ttqPFHGLKQ1Q_s4JVTekmwaH';

if (import.meta.env.DEV && import.meta.env.VITE_APPCHECK_DEBUG_TOKEN) {
  const debugEnv = import.meta.env.VITE_APPCHECK_DEBUG_TOKEN;
  // VITE_APPCHECK_DEBUG_TOKEN=true → o Firebase GERA um token e o imprime no
  // console (use uma vez para obter o UUID e registrá-lo no Firebase Console).
  // Qualquer outro valor é usado como o token já registrado.
  (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: string | boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN =
    debugEnv === 'true' ? true : debugEnv;
}

initializeAppCheck(app, {
  provider: new ReCaptchaEnterpriseProvider(RECAPTCHA_ENTERPRISE_SITE_KEY),
  isTokenAutoRefreshEnabled: true,
});

// Initialize Firebase services
export const auth = getAuth(app);
// getFirestore() usa WebChannel puro, cujo streaming fetch alguns navegadores
// (Safari com "Prevent Cross-Site Tracking", bloqueadores de anúncio, proxies
// corporativos) recusam com "Fetch API cannot load ... due to access control
// checks" — o listener nunca entrega snapshot algum. auto-detect faz o SDK
// cair pro long-polling comum assim que percebe que o streaming falhou.
export const db = initializeFirestore(app, { experimentalAutoDetectLongPolling: true }, firebaseConfig.firestoreDatabaseId);
export const storage = getStorage(app);
