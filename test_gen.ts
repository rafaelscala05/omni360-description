import { GoogleGenAI } from '@google/genai';

async function run() {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  try {
    const response = await ai.models.generateImages({
      model: 'imagen-4.0-generate-001',
      prompt: 'A beautiful sunny day at the beach',
      config: {
        numberOfImages: 1,
        outputMimeType: 'image/jpeg',
      }
    });
    console.log("Image length", response.generatedImages[0].image.imageBytes.length);
  } catch(e) {
    console.error(e);
  }
}
run();
