import { GoogleGenAI, Type } from "@google/genai";

async function run() {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const response = await ai.models.generateContent({
    model: 'gemini-3.1-flash-preview',
    contents: "Busque na internet imagens reais do produto: \"iPhone 15 Pro Max Apple\". Retorne um JSON com 4 URLs de imagens públicas deste produto. Formato: { \"images\": [\"url1\", \"url2\", \"url3\", \"url4\"] }",
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
