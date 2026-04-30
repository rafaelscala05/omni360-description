import { GoogleGenAI, Type } from "@google/genai";
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function run() {
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: "Busque na internet imagens do produto 'iPhone 15 Pro Max Apple'. Retorne um JSON com 4 URLs de imagens do produto. Formato: { \"images\": [\"url1\", \"url2\", \"url3\", \"url4\"] }",
    config: {
      tools: [{ googleSearch: {} }],
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          images: {
            type: Type.ARRAY,
            items: { type: Type.STRING }
          }
        }
      }
    }
  });
  console.log(response.text);
}
run();
