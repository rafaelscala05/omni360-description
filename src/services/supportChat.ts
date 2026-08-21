// Chat de ajuda (Chatwoot). O SDK não é mais carregado no boot da página:
// ele só é injetado quando o usuário clica em "Ajuda" no menu, e sobe com a
// bolha flutuante desligada — a única forma de abrir o chat é pelo menu.
const BASE_URL = 'https://app.talk360.tech';
const WEBSITE_TOKEN = 'oqyzNyKtLeoXGSwoL9p4pvim';

let loadingPromise: Promise<void> | null = null;

function loadChatwoot(): Promise<void> {
  if (loadingPromise) return loadingPromise;

  loadingPromise = new Promise<void>((resolve, reject) => {
    (window as any).chatwootSettings = {
      hideMessageBubble: true,
      position: 'right',
      locale: 'pt_BR',
      type: 'standard',
    };

    const onReady = () => resolve();
    window.addEventListener('chatwoot:ready', onReady, { once: true });

    const script = document.createElement('script');
    script.src = `${BASE_URL}/packs/js/sdk.js`;
    script.async = true;
    script.onload = () => {
      (window as any).chatwootSDK?.run({ websiteToken: WEBSITE_TOKEN, baseUrl: BASE_URL });
    };
    script.onerror = () => {
      window.removeEventListener('chatwoot:ready', onReady);
      loadingPromise = null;
      script.remove();
      reject(new Error('Não foi possível carregar o chat de ajuda.'));
    };
    document.body.appendChild(script);
  });

  return loadingPromise;
}

export async function openSupportChat(): Promise<void> {
  if ((window as any).$chatwoot) {
    (window as any).$chatwoot.toggle('open');
    return;
  }
  await loadChatwoot();
  (window as any).$chatwoot?.toggle('open');
}
