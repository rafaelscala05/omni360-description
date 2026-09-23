// scripts/spike-ugc-veo.mjs
//
// Spike: valida se o Veo 3.1 aceita 2 reference images (ASSET) simultâneas —
// uma pessoa (avatar) + um produto — e se `generateAudio: true` produz fala
// sincronizada em pt-BR. Gera UM clipe de ~8s e salva localmente para
// inspeção manual. NÃO é um teste automatizado — é um gate manual: o humano
// assiste o vídeo e decide se o design da spec se sustenta.
//
// Uso: npx tsx scripts/spike-ugc-veo.mjs <foto-pessoa.jpg> <foto-produto.jpg>
// Requer: `gcloud auth application-default login` já configurado (mesmas
// credenciais que o pipeline de vídeo clássico usa) e um
// firebase-applet-config.json com projectId válido.

import { GoogleGenAI, VideoGenerationReferenceType } from '@google/genai';
import { promises as fs } from 'node:fs';
import firebaseAppletConfig from '../firebase-applet-config.json';

const [, , avatarPath, productPath] = process.argv;
if (!avatarPath || !productPath) {
  console.error('Uso: npx tsx scripts/spike-ugc-veo.mjs <foto-pessoa> <foto-produto>');
  process.exit(1);
}

async function toBase64(filePath) {
  const buf = await fs.readFile(filePath);
  const mimeType = filePath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
  return { base64: buf.toString('base64'), mimeType };
}

async function main() {
  const [avatarImage, productImage] = await Promise.all([toBase64(avatarPath), toBase64(productPath)]);

  const ai = new GoogleGenAI({
    vertexai: true,
    project: firebaseAppletConfig.projectId,
    location: 'us-central1',
  });

  console.log('Chamando ai.models.generateVideos com 2 reference images (ASSET) + generateAudio: true...');
  let operation = await ai.models.generateVideos({
    model: 'veo-3.1-fast-generate-001',
    prompt: [
      'Cena: cozinha iluminada por luz natural.',
      'A pessoa da imagem de referência olha diretamente para a câmera e diz, em português do Brasil, com sincronia labial:',
      '"Gente, olha que produto incrível eu encontrei!"',
      'Formato vertical 9:16, estilo UGC autêntico (câmera na mão), iluminação natural.',
      'FIDELIDADE OBRIGATÓRIA: a pessoa deve ser idêntica à imagem de referência de pessoa; o produto deve ser idêntico à imagem de referência de produto.',
    ].join('\n'),
    config: {
      numberOfVideos: 1,
      durationSeconds: 8,
      aspectRatio: '9:16',
      personGeneration: 'allow_adult',
      generateAudio: true,
      referenceImages: [
        { image: { imageBytes: avatarImage.base64, mimeType: avatarImage.mimeType }, referenceType: VideoGenerationReferenceType.ASSET },
        { image: { imageBytes: productImage.base64, mimeType: productImage.mimeType }, referenceType: VideoGenerationReferenceType.ASSET },
      ],
    },
  });

  console.log('Operação iniciada, aguardando conclusão (2-5 min)...');
  while (!operation.done) {
    await new Promise((r) => setTimeout(r, 15000));
    operation = await ai.operations.getVideosOperation({ operation });
    console.log('  ainda processando...');
  }

  if (operation.error) {
    console.error('FALHA — Veo retornou erro:', operation.error);
    process.exit(1);
  }

  const videoBytes = operation.response?.generatedVideos?.[0]?.video?.videoBytes;
  if (!videoBytes) {
    console.error('FALHA — Veo não retornou bytes de vídeo. Resposta completa:', JSON.stringify(operation.response, null, 2));
    process.exit(1);
  }

  const outPath = 'scripts/.spike-ugc-output.mp4';
  await fs.writeFile(outPath, Buffer.from(videoBytes, 'base64'));
  console.log(`\nOK — vídeo salvo em ${outPath}.`);
  console.log('Assista o arquivo e responda manualmente:');
  console.log('  1. O avatar (pessoa) está reconhecível/fiel à foto de referência?');
  console.log('  2. O produto está reconhecível/fiel à foto de referência?');
  console.log('  3. Há áudio no vídeo?');
  console.log('  4. A fala está em português e os lábios acompanham o áudio (lip sync)?');
}

main().catch((err) => {
  console.error('FALHA —', err);
  process.exit(1);
});
