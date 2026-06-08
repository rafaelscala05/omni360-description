import { GoogleGenAI } from '@google/genai';

async function run() {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const response = await ai.models.generateImages({
      model: 'imagen-3.0-generate-002',
      prompt: 'A beautiful sunset over the ocean',
      config: {
        numberOfImages: 1,
        outputMimeType: 'image/jpeg',
      }
    });
    console.log("Success:", response.generatedImages[0].image.imageBytes.substring(0, 50));
  } catch (e) {
    console.error("Error:", e);
  }
}
run();
