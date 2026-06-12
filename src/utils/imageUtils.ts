import { storage } from '../firebase';
import { ref, getBlob } from 'firebase/storage';

// Loads an image from a URL (data URL, Firebase Storage, direct fetch, or via CORS proxies),
// normalizes it to JPEG capped at 1024px, and returns base64 + mimeType.
export async function fetchAndProcessImage(imageUrl: string): Promise<{ base64Data: string; mimeType: string }> {
  let base64Data = '';
  let mimeType = '';

  if (imageUrl.startsWith('data:')) {
    const matches = imageUrl.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (matches && matches.length === 3) {
      mimeType = matches[1];
      base64Data = matches[2];
    } else {
      throw new Error('Formato de imagem base64 inválido.');
    }
  } else {
    let blob: Blob | null = null;

    if (imageUrl.includes('firebasestorage.googleapis.com')) {
      try {
        const decodedUrl = decodeURIComponent(imageUrl);
        const pathMatch = decodedUrl.match(/\/o\/(.+?)\?/);
        if (pathMatch && pathMatch[1]) {
          const storageRef = ref(storage, pathMatch[1]);
          blob = await getBlob(storageRef);
        }
      } catch (fbError) {
        console.warn('Falha ao buscar blob do Firebase via SDK:', fbError);
      }
    }

    if (!blob) {
      try {
        const imgResponse = await fetch(imageUrl);
        if (!imgResponse.ok) throw new Error(`Direct fetch failed with status ${imgResponse.status}`);
        blob = await imgResponse.blob();
      } catch (e) {
        const proxies = [
          { name: 'wsrv.nl', url: `https://wsrv.nl/?url=${encodeURIComponent(imageUrl)}&output=jpeg` },
          { name: 'corsproxy.io', url: `https://corsproxy.io/?${encodeURIComponent(imageUrl)}` },
          { name: 'codetabs', url: `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(imageUrl)}` },
          { name: 'allorigins', url: `https://api.allorigins.win/raw?url=${encodeURIComponent(imageUrl)}` },
        ];

        for (const proxy of proxies) {
          try {
            const pResp = await fetch(proxy.url);
            if (pResp.ok) {
              blob = await pResp.blob();
              break;
            }
          } catch (_) {}
        }
      }
    }

    if (!blob) {
      throw new Error('Não foi possível carregar a imagem da URL fornecida (CORS ou erro de rede).');
    }

    const reader = new FileReader();
    const base64DataUrl = await new Promise<string>((resolve) => {
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(blob!);
    });

    base64Data = base64DataUrl.split(',')[1];
    mimeType = blob.type || 'image/jpeg';
  }

  // Normalize to JPEG and cap at 1024px
  const processed = await new Promise<{ base64: string; mimeType: string }>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const MAX_DIM = 1024;
      let width = img.width;
      let height = img.height;
      if (width > MAX_DIM || height > MAX_DIM) {
        if (width > height) {
          height *= MAX_DIM / width;
          width = MAX_DIM;
        } else {
          width *= MAX_DIM / height;
          height = MAX_DIM;
        }
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve({ base64: base64Data, mimeType });
        return;
      }
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      const newDataUrl = canvas.toDataURL('image/jpeg', 0.9);
      resolve({ base64: newDataUrl.split(',')[1], mimeType: 'image/jpeg' });
    };
    img.onerror = () => reject(new Error('O arquivo carregado não é uma imagem válida ou está corrompido.'));
    img.src = `data:${mimeType};base64,${base64Data}`;
  });

  return { base64Data: processed.base64, mimeType: processed.mimeType };
}
