import { GoogleGenAI } from "@google/genai";

async function run() {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-image',
    contents: {
      parts: [
        {
          text: 'Product photo of iPhone 15 Pro Max Apple on a white background.',
        },
      ],
    },
  });
  console.log(response.candidates[0].content.parts[0].inlineData.data.substring(0, 50));
}
run();
