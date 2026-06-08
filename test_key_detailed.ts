import { GoogleGenAI, Type } from "@google/genai";

async function testMode() {
  try {
      console.log("Raw env in CLI:", process.env.GEMINI_API_KEY);
      const apiKey = process.env.GEMINI_API_KEY!.trim().replace(/^["']|["']$/g, '');
      const ai = new GoogleGenAI({ apiKey });
      const parts = [{ text: "Teste" }];
      const response = await ai.models.generateContent({
        model: 'gemini-3.5-flash',
        contents: { parts },
        config: { 
          temperature: 0.7,
          maxOutputTokens: 8192,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              descricao_html: { type: Type.STRING },
              titulo_seo: { type: Type.STRING },
              descricao_seo: { type: Type.STRING },
              palavras_chave: { type: Type.STRING },
            },
            required: ["descricao_html", "titulo_seo", "descricao_seo", "palavras_chave"]
          }
        }
      });
      console.log("SUCCESS:", response.text);
  } catch (error: any) {
      console.log("ERROR TYPE:", error.constructor?.name);
      console.log("ERROR MSG:", error.message);
  }
}

testMode();
