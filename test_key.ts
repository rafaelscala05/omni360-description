import { GoogleGenAI } from "@google/genai";

async function test() {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: 'Olá, responda "ok" se estiver funcionando.',
    });
    console.log("Success:", response.text);
  } catch (error: any) {
    console.log("Error type:", error.constructor?.name);
    console.log("Error details:", JSON.stringify(error));
  }
}

test();
