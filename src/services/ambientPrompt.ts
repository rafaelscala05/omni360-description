// Pedido de texto que escreve as 3 instruções de imagem ambientada (cena real,
// pessoa usando, escala). Puro: usado pelo ImageSearchModal (cliente, Firebase
// AI Logic) e pelo Alfred (server/agent/produtosGeracao.ts, Vertex), para as
// duas portas produzirem a mesma ambientação.

export interface AmbientPromptContext {
  productName: string;
  brand?: string;
  category?: string;
  description?: string;
}

export interface CustomScenes {
  scene1?: string;
  scene2?: string;
  scene3?: string;
}

export function buildAmbientPromptRequest(ctx: AmbientPromptContext, temImagem: boolean, customScenes?: CustomScenes): string {
  const productContext = [ctx.productName, ctx.brand, ctx.category, ctx.description]
    .filter(Boolean)
    .join('. ');

  const scene1Override = customScenes?.scene1
    ? `The scene must show: ${customScenes.scene1}. Apply the same realism rules: natural lighting, soft contact shadow, shallow depth of field, shot on a 50mm lens at f/2.2, candid lifestyle photograph, photorealistic, no AI artifacts.`
    : null;

  const scene2Override = customScenes?.scene2
    ? `The scene must show: ${customScenes.scene2}. Apply the same realism rules: authentic candid look, real-looking person with natural skin texture and unposed body language, motivated natural lighting, shot on an 85mm lens at f/2.0, photorealistic, no AI artifacts.`
    : null;

  const scene3Override = customScenes?.scene3
    ? `The scene must show: ${customScenes.scene3}. Apply the same realism rules: realistic human hands with correct anatomy and natural skin texture, soft natural lighting with a grounded contact shadow, shot on a 50mm lens at f/2.8, photorealistic close-up, no AI artifacts, the product clearly showing its real size.`
    : null;

  const prompt = `You are a senior commercial photographer and art director for premium e-commerce brands. Your task is to write 3 image transformation instructions in ENGLISH for a generative AI model (gemini-2.5-flash-image). The model receives the product image directly, so you must NOT describe the product's appearance — focus entirely on what should change in the scene.

${temImagem ? 'Analyze the product image provided to understand exactly what this product is, who uses it, where it is realistically used, and what surfaces/objects/environments naturally surround it in real life.' : ''}
Product context: ${productContext}

CRITICAL REALISM RULES (apply to ALL instructions):
- The scene must be SPECIFIC to THIS product and its real-world use context — never generic. Reason from the product: a power tool belongs on a workbench with sawdust, not a marble countertop; a skincare serum belongs on a bathroom shelf with morning light, not a kitchen.
- The result must look like a REAL photograph taken by a professional, NOT an AI render. Demand photographic authenticity: natural and slightly uneven lighting, real soft shadows and contact shadows under the product, subtle surface imperfections (dust, fingerprints, wear, scratches, texture), shallow depth of field with realistic lens bokeh, true-to-life color and white balance, no plastic-perfect surfaces, no symmetrical CGI cleanliness.
- Specify a real camera look: e.g. shot on a 50mm or 85mm lens, f/2.0, natural window light or practical lighting, photojournalistic / lifestyle editorial style.
- Avoid clichés (marble countertop, generic golden hour, floating product, empty studio) unless they genuinely fit the product.

Generate 3 transformation instructions following this exact order and format:

${scene1Override
  ? `Instruction 0 — Realistic in-context scene: Keep the product exactly as-is (do NOT alter the product). ${scene1Override}`
  : `Instruction 0 — Realistic in-context scene: Keep the product exactly as-is (do NOT alter the product), and place it into a believable, lived-in environment where THIS specific product is actually used or displayed, chosen from the product description and category. Build a rich but natural scene: the right surface/material, contextually relevant props that a real owner would have nearby, realistic ambient lighting with direction and soft shadows, and a sense of depth (foreground/background). The product must sit naturally in the scene with a grounded contact shadow — not floating, not centered like a catalog cutout. Make it look like a candid photo from a real home/workspace/store, captured on a 50mm lens at f/2.2 with natural light. Example for a leather wallet: "Keep the product exactly as-is. Place it on a worn wooden café table next to a set of car keys, a folded newspaper and a half-finished espresso, warm morning window light from the left casting a soft natural shadow, shallow depth of field, blurred background of a cozy café interior, shot on 50mm f/2.2, candid lifestyle photograph, photorealistic with subtle surface texture and no AI artifacts."`}

${scene2Override
  ? `Instruction 1 — Authentic lifestyle scene with person: Keep the product visually identical to the input image. ${scene2Override}`
  : `Instruction 1 — Authentic lifestyle scene with person: Keep the product visually identical to the input image, and show a real-looking person who genuinely belongs to THIS product's target audience naturally using or interacting with it in the right real-world moment (derive the person, action and setting from the product description and category). Make the person look real and candid — natural skin texture and pores, realistic hands and fingers actually gripping/touching the product with correct scale, relaxed unposed body language, everyday authentic clothing that fits the context, no model-perfect stock-photo smile. Build a believable environment around the action with depth and contextual props, motivated natural lighting with soft directional shadows. Capture it as a documentary/lifestyle editorial frame on an 85mm lens at f/2.0, shallow depth of field, true-to-life colors, no AI artifacts. The product must look identical to the input image. Example for running shoes: "Keep the product identical to the input image. Show a man in his early 30s in casual athletic wear lacing up this shoe on his foot while sitting on a city park bench at golden hour, sweat on his skin, real hands with natural detail, blurred green park background, motivated warm side light with a soft shadow, shot on 85mm f/2.0, candid documentary lifestyle photograph, photorealistic, no AI artifacts."`}

${scene3Override
  ? `Instruction 2 — Realistic scale reference: Keep the product visually identical to the input image. ${scene3Override}`
  : `Instruction 2 — Realistic scale reference: Keep the product visually identical to the input image, and show a real person's hands (or the person next to it) holding or interacting with the product to communicate its true real-world size and proportions. Use a clean but NOT artificial setting — a simple real surface or softly blurred everyday background, never an empty CGI void. Demand realistic human hands with correct anatomy, natural skin texture and accurate scale relative to the product, soft natural lighting with a grounded contact shadow. Shoot it like a real close-up product photo on a 50mm lens at f/2.8, photorealistic, no AI artifacts. The product must look identical to the input image and its size must read clearly. Example: "Keep the product identical to the input image. Show a woman's hands with natural skin texture holding this product at chest height over a softly blurred light wooden desk, neutral daylight from a window, soft contact shadow, correct real-life scale, shot on 50mm f/2.8, photorealistic close-up, no AI artifacts, the product clearly showing its real size."`}

Return ONLY valid JSON with this exact structure, no markdown, no explanations:
{"prompts": ["instruction0", "instruction1", "instruction2"], "productDescription": "concise visual description of the product (colors, materials, key features)"}`;

  return prompt;
}
