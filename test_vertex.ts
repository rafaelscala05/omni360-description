import { GoogleGenAI } from '@google/genai';

async function run() {
  try {
    const ai = new GoogleGenAI({
      vertexai: true,
      project: 'gen-lang-client-0219402931',
      location: 'us-central1',
    });

    const response = await ai.models.generateImages({
      model: 'imagen-3.0-generate-001',
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
