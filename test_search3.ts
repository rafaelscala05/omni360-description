import { GoogleGenAI, Type } from "@google/genai";

async function run() {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: "Busque na internet a imagem do produto 'iPhone 15 Pro Max Apple'. Encontre a URL de uma imagem real do produto nos resultados da busca. Retorne apenas a URL direta da imagem (.jpg ou .png).",
    config: {
      tools: [{ googleSearch: {} }],
    }
  });
  console.log(response.text);
}
run();
