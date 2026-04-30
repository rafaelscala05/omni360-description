import React, { useState, useEffect } from 'react';
import { X, Search, Image as ImageIcon, Loader2, Check, Download, ExternalLink } from 'lucide-react';
import { Product } from '../App';
import { GoogleGenAI, Type } from '@google/genai';
import { storage } from '../firebase';
import { ref, uploadString, getDownloadURL, getBlob } from 'firebase/storage';

interface ImageSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  product: Product | null;
  onSave: (productId: string, selectedImage: string, ambientImages: string[], tokenUsage?: { promptTokens: number; completionTokens: number; totalTokens: number }) => void;
  credits: number;
  consumeCredit: (actionType: string, productName?: string, sku?: string) => Promise<boolean>;
}

export default function ImageSearchModal({ isOpen, onClose, product, onSave, credits, consumeCredit }: ImageSearchModalProps) {
  const [step, setStep] = useState<'search' | 'ambient'>('search');
  const [selectedImageUrl, setSelectedImageUrl] = useState<string>('');
  
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [ambientImages, setAmbientImages] = useState<string[]>([]);
  const [tokenUsage, setTokenUsage] = useState({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
  
  const defaultPrompt = "Aprimore esta imagem e crie uma ambientação realista de e-commerce onde o produto está posicionado corretamente no mundo real. Mantenha o produto idêntico, apenas mude o fundo para um cenário de uso real e profissional.";
  const [ambientPrompt, setAmbientPrompt] = useState(defaultPrompt);

  useEffect(() => {
    if (isOpen && product && step === 'search') {
      setSelectedImageUrl(product._selectedImage || '');
      setAmbientImages(product._ambientImages || []);
      setTokenUsage({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
      setAmbientPrompt(defaultPrompt);
    }
  }, [isOpen, product]);

  const handleOpenGoogleImages = () => {
    if (!product) return;
    const query = `${product['Descrição']} ${product['Marca'] || ''}`.trim();
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&tbm=isch`;
    window.open(url, '_blank');
  };

  const handleGenerateAmbient = async () => {
    if (!selectedImageUrl || !product) return;
    if (!(await consumeCredit('Geração de Ambientação', product['Descrição'], product['Código (SKU)']))) return;
    
    setIsGenerating(true);
    setStep('ambient');
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalTokens = 0;
    
    try {
      let base64Data = '';
      let mimeType = '';

      if (selectedImageUrl.startsWith('data:')) {
        const matches = selectedImageUrl.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        if (matches && matches.length === 3) {
          mimeType = matches[1];
          base64Data = matches[2];
        } else {
          throw new Error("Formato de imagem base64 inválido.");
        }
      } else {
        // Fetch the image and convert to base64
        let imgResponse;
        let blob: Blob | null = null;

        // Special case: Firebase Storage URL
        if (selectedImageUrl.includes('firebasestorage.googleapis.com')) {
          try {
            console.log("Detectada URL do Firebase Storage, tentando buscar via SDK...");
            const decodedUrl = decodeURIComponent(selectedImageUrl);
            const pathMatch = decodedUrl.match(/\/o\/(.+?)\?/);
            if (pathMatch && pathMatch[1]) {
              const path = pathMatch[1];
              const storageRef = ref(storage, path);
              blob = await getBlob(storageRef);
              console.log("Blob do Firebase obtido com sucesso.");
            }
          } catch (fbError) {
            console.warn("Falha ao buscar blob do Firebase via SDK, tentando fetch normal:", fbError);
          }
        }

        if (!blob) {
          try {
            imgResponse = await fetch(selectedImageUrl);
            if (!imgResponse.ok) throw new Error(`Direct fetch failed with status ${imgResponse.status}`);
            blob = await imgResponse.blob();
          } catch (e) {
            console.warn("Direct fetch failed:", e);
            
            // Try proxies in a more optimized order
            const proxies = [
              { name: 'wsrv.nl', url: `https://wsrv.nl/?url=${encodeURIComponent(selectedImageUrl)}&output=jpeg` },
              { name: 'corsproxy.io', url: `https://corsproxy.io/?${encodeURIComponent(selectedImageUrl)}` },
              { name: 'codetabs', url: `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(selectedImageUrl)}` },
              { name: 'allorigins', url: `https://api.allorigins.win/raw?url=${encodeURIComponent(selectedImageUrl)}` }
            ];

            for (const proxy of proxies) {
              try {
                console.log(`Tentando proxy ${proxy.name}...`);
                const pResp = await fetch(proxy.url);
                if (pResp.ok) {
                  blob = await pResp.blob();
                  console.log(`Sucesso com proxy ${proxy.name}`);
                  break;
                }
              } catch (pErr) {
                console.warn(`Proxy ${proxy.name} falhou:`, pErr);
              }
            }
          }
        }
        
        if (!blob) {
          throw new Error("Não foi possível carregar a imagem da URL fornecida (CORS ou erro de rede).");
        }

        // Remove strict blob.type check because proxies sometimes return application/octet-stream
        // We will rely on the Image object in processImage to validate it
        
        const reader = new FileReader();
        const base64Promise = new Promise<string>((resolve) => {
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(blob!);
        });
        
        const base64DataUrl = await base64Promise;
        base64Data = base64DataUrl.split(',')[1];
        mimeType = blob.type || 'image/jpeg';
      }

      // Process image to ensure it's a valid JPEG and not too large for Gemini
      const processImage = (base64Str: string, mime: string): Promise<{ base64: string, mimeType: string }> => {
        return new Promise((resolve, reject) => {
          const img = new Image();
          img.crossOrigin = "Anonymous";
          img.onload = () => {
            const canvas = document.createElement('canvas');
            const MAX_DIM = 1024;
            let width = img.width;
            let height = img.height;
            
            if (width > MAX_DIM || height > MAX_DIM) {
              if (width > height) {
                height *= MAX_DIM / width;
                width = MAX_DIM;
              } else {
                width *= MAX_DIM / height;
                height = MAX_DIM;
              }
            }
            
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
              resolve({ base64: base64Str, mimeType: mime }); // fallback
              return;
            }
            
            // Fill white background for transparent images
            ctx.fillStyle = "white";
            ctx.fillRect(0, 0, width, height);
            ctx.drawImage(img, 0, 0, width, height);
            
            const newDataUrl = canvas.toDataURL('image/jpeg', 0.9);
            const newBase64 = newDataUrl.split(',')[1];
            resolve({ base64: newBase64, mimeType: 'image/jpeg' });
          };
          img.onerror = () => {
            reject(new Error("O arquivo carregado não é uma imagem válida ou está corrompido."));
          };
          img.src = `data:${mime};base64,${base64Str}`;
        });
      };

      const processed = await processImage(base64Data, mimeType);
      base64Data = processed.base64;
      mimeType = processed.mimeType;

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      // Helper for retrying with backoff
      const generateWithRetry = async (index: number, retries = 2): Promise<string | null> => {
        for (let attempt = 0; attempt <= retries; attempt++) {
          try {
            const res = await ai.models.generateContent({
              model: 'gemini-2.5-flash-image',
              contents: {
                parts: [
                  {
                    inlineData: {
                      data: base64Data,
                      mimeType: mimeType,
                    },
                  },
                  {
                    text: ambientPrompt,
                  },
                ],
              },
            });

            for (const part of res.candidates?.[0]?.content?.parts || []) {
              if (part.inlineData) {
                const usage = res.usageMetadata || { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 };
                totalPromptTokens += usage.promptTokenCount;
                totalCompletionTokens += usage.candidatesTokenCount;
                totalTokens += usage.totalTokenCount;
                return `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`;
              }
            }
            return null;
          } catch (error: any) {
            const isQuotaError = error.message?.includes("429") || 
                                error.status === 429 || 
                                error.message?.includes("RESOURCE_EXHAUSTED") || 
                                error.message?.includes("quota");
            
            if (isQuotaError && attempt < retries) {
              const delay = Math.pow(2, attempt) * 2000; // 2s, 4s
              console.warn(`Quota atingida na imagem ${index + 1}, tentativa ${attempt + 1}. Retentando em ${delay}ms...`);
              await new Promise(resolve => setTimeout(resolve, delay));
              continue;
            }
            throw error;
          }
        }
        return null;
      };

      // Generate 3 images sequentially to avoid rate limits (429)
      const validImages: string[] = [];
      for (let i = 0; i < 3; i++) {
        try {
          const imgData = await generateWithRetry(i);
          if (imgData) {
            validImages.push(imgData);
          }
          
          // Increase delay between requests to help with rate limits
          if (i < 2) await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (genError: any) {
          console.error(`Error generating image ${i + 1}:`, genError);
          
          const isQuotaError = genError.message?.includes("429") || 
                              genError.status === 429 || 
                              genError.message?.includes("RESOURCE_EXHAUSTED") || 
                              genError.message?.includes("quota");

          // If we hit a rate limit and already have some images, we can stop and show what we have
          if (isQuotaError && validImages.length > 0) {
            console.log("Rate limit hit, but we have some images. Stopping generation.");
            break;
          }
          // If it's the first image and we hit a rate limit, throw to show the error
          if (i === 0) throw genError;
        }
      }

      if (validImages.length === 0) {
        throw new Error("Não foi possível gerar nenhuma imagem.");
      }

      setAmbientImages(validImages);
      setTokenUsage({
        promptTokens: totalPromptTokens,
        completionTokens: totalCompletionTokens,
        totalTokens: totalTokens
      });

    } catch (error: any) {
      console.error("Erro ao gerar ambientações:", error);
      
      let errorMessage = "Erro ao processar a imagem. Verifique se a URL é válida e tente novamente.";
      
      if (error.message === "Não foi possível carregar a imagem da URL fornecida.") {
        errorMessage = "Não foi possível carregar a imagem da URL fornecida. O site de origem pode estar bloqueando o acesso.";
      } else if (error.message?.includes("429") || error.status === 429 || error.message?.includes("RESOURCE_EXHAUSTED") || error.message?.includes("quota")) {
        errorMessage = "O limite de uso da inteligência artificial foi atingido (Erro 429). Por favor, aguarde um momento e tente novamente.";
      } else if (error.message) {
        errorMessage = `Erro: ${error.message}`;
      }

      alert(errorMessage);
      setStep('search');
    } finally {
      setIsGenerating(false);
    }
  };

  const uploadImage = async (base64OrUrl: string, filename: string): Promise<string> => {
    // If it's already a Firebase Storage URL, return it directly
    if (base64OrUrl.includes('firebasestorage.googleapis.com')) return base64OrUrl;

    try {
      let base64Data = '';
      let mimeType = 'image/jpeg';
      let blob: Blob | null = null;

      if (base64OrUrl.startsWith('data:')) {
        base64Data = base64OrUrl;
      } else {
        // Special case: Firebase Storage URL
        if (base64OrUrl.includes('firebasestorage.googleapis.com')) {
          try {
            const decodedUrl = decodeURIComponent(base64OrUrl);
            const pathMatch = decodedUrl.match(/\/o\/(.+?)\?/);
            if (pathMatch && pathMatch[1]) {
              const path = pathMatch[1];
              const storageRef = ref(storage, path);
              blob = await getBlob(storageRef);
            }
          } catch (fbError) {
            console.warn("Falha ao buscar blob do Firebase no upload, tentando fetch:", fbError);
          }
        }

        if (!blob) {
          // Fetch external URL and convert to base64
          try {
            const imgResponse = await fetch(base64OrUrl);
            if (!imgResponse.ok) throw new Error(`Direct fetch failed with status ${imgResponse.status}`);
            blob = await imgResponse.blob();
          } catch (e) {
            console.warn("Direct fetch failed for upload:", e);
            
            const proxies = [
              { name: 'wsrv.nl', url: `https://wsrv.nl/?url=${encodeURIComponent(base64OrUrl)}&output=jpeg` },
              { name: 'corsproxy.io', url: `https://corsproxy.io/?${encodeURIComponent(base64OrUrl)}` },
              { name: 'codetabs', url: `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(base64OrUrl)}` },
              { name: 'allorigins', url: `https://api.allorigins.win/raw?url=${encodeURIComponent(base64OrUrl)}` }
            ];

            for (const proxy of proxies) {
              try {
                const pResp = await fetch(proxy.url);
                if (pResp.ok) {
                  blob = await pResp.blob();
                  break;
                }
              } catch (pErr) {
                console.warn(`Proxy ${proxy.name} falhou no upload:`, pErr);
              }
            }
          }
        }
        
        if (!blob) {
          throw new Error("Failed to fetch image for upload");
        }

        mimeType = blob.type || 'image/jpeg';
        
        const reader = new FileReader();
        const base64Promise = new Promise<string>((resolve) => {
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(blob!);
        });
        
        base64Data = await base64Promise;
      }

      // Generate a unique filename
      const safeFilename = filename.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      const uniqueFilename = `${safeFilename}_${Date.now()}`;
      const storageRef = ref(storage, `products/${uniqueFilename}`);

      // Upload to Firebase Storage
      await uploadString(storageRef, base64Data, 'data_url');
      
      // Get the public download URL
      const downloadURL = await getDownloadURL(storageRef);
      return downloadURL;

    } catch (error) {
      console.error('Error uploading image to Firebase:', error);
      // If Firebase upload fails (e.g., due to permissions), fallback to original
      // But alert the user if it was a base64 string that might break Excel
      if (base64OrUrl.startsWith('data:')) {
        alert("Erro ao salvar a imagem na nuvem. Verifique se você fez login no sistema.");
      }
      return base64OrUrl;
    }
  };

  const handleSave = async () => {
    if (product && selectedImageUrl) {
      setIsSaving(true);
      try {
        // Upload selected image if it's base64
        const finalSelectedImage = await uploadImage(selectedImageUrl, product['Código (SKU)'] || 'produto');
        
        // Upload ambient images
        const finalAmbientImages = await Promise.all(
          ambientImages.map((img, idx) => uploadImage(img, `${product['Código (SKU)'] || 'produto'}_ambientacao_${idx + 1}`))
        );

        onSave(product._id, finalSelectedImage, finalAmbientImages, tokenUsage.totalTokens > 0 ? tokenUsage : undefined);
        handleClose();
      } finally {
        setIsSaving(false);
      }
    }
  };

  const handleClose = () => {
    setStep('search');
    setSelectedImageUrl('');
    setAmbientImages([]);
    onClose();
  };

  if (!isOpen || !product) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:p-0">
        <div className="fixed inset-0 transition-opacity bg-gray-500 bg-opacity-75" onClick={handleClose} />

        <div className="relative inline-block w-full max-w-4xl p-6 overflow-hidden text-left align-middle transition-all transform bg-white shadow-xl rounded-2xl">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-medium leading-6 text-gray-900">
              {step === 'search' ? 'Imagem do Produto' : 'Ambientações Geradas'}
            </h3>
            <button
              onClick={handleClose}
              className="text-gray-400 hover:text-gray-500 focus:outline-none"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          <div className="mb-4">
            <p className="text-sm text-gray-500">
              <strong>Produto:</strong> {product['Descrição']} <br/>
              <strong>SKU:</strong> {product['Código (SKU)']} | <strong>Marca:</strong> {product['Marca']}
            </p>
          </div>

          {step === 'search' && (
            <div className="space-y-6">
              <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 flex items-start gap-3">
                <Search className="w-5 h-5 text-blue-600 mt-0.5" />
                <div>
                  <h4 className="text-sm font-medium text-blue-900">Como adicionar uma imagem:</h4>
                  <ol className="mt-1 text-sm text-blue-800 list-decimal list-inside space-y-1">
                    <li>Clique no botão abaixo para buscar o produto no Google Imagens.</li>
                    <li>Encontre a imagem desejada, clique com o botão direito e selecione <strong>"Copiar endereço da imagem"</strong>.</li>
                    <li>Cole a URL no campo abaixo.</li>
                  </ol>
                  <button
                    onClick={handleOpenGoogleImages}
                    className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-blue-700 bg-white border border-blue-200 rounded-md hover:bg-blue-50 transition-colors"
                  >
                    <ExternalLink className="w-4 h-4" />
                    Buscar no Google Imagens
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor="imageUrl" className="block text-sm font-medium text-gray-700 mb-1">
                  URL da Imagem
                </label>
                <input
                  type="url"
                  id="imageUrl"
                  value={selectedImageUrl}
                  onChange={(e) => setSelectedImageUrl(e.target.value)}
                  placeholder="https://exemplo.com/imagem.jpg"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                />
              </div>

              {selectedImageUrl && (
                <div className="mt-4">
                  <p className="text-sm font-medium text-gray-700 mb-2">Pré-visualização:</p>
                  <div className="relative w-48 h-48 rounded-lg overflow-hidden border border-gray-200 bg-gray-50">
                    <img 
                      src={selectedImageUrl} 
                      alt="Pré-visualização" 
                      className="w-full h-full object-contain"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = 'https://via.placeholder.com/200?text=Erro+ao+carregar';
                      }}
                    />
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
                <button
                  onClick={handleClose}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSave}
                  disabled={!selectedImageUrl || isSaving}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Salvando...
                    </>
                  ) : (
                    'Salvar Apenas Imagem'
                  )}
                </button>
                <button
                  onClick={handleGenerateAmbient}
                  disabled={!selectedImageUrl}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ImageIcon className="w-4 h-4" />
                  Gerar Ambientações
                </button>
              </div>
            </div>
          )}

          {step === 'ambient' && (
            <div className="space-y-6">
              {isGenerating ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 text-blue-600 animate-spin mb-4" />
                  <p className="text-gray-600">A IA está analisando a imagem e gerando 3 ambientações realistas...</p>
                  <p className="text-sm text-gray-400 mt-2">Isso pode levar alguns segundos.</p>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                    {ambientImages.map((imgBase64, idx) => (
                      <div key={idx} className="flex flex-col gap-2">
                        <div className="relative aspect-square rounded-lg overflow-hidden border border-gray-200 shadow-sm">
                          <img src={imgBase64} alt={`Ambientação ${idx + 1}`} className="w-full h-full object-cover" />
                        </div>
                        <a 
                          href={imgBase64} 
                          download={`${product['Código (SKU)'] || 'produto'}_ambientacao_${idx + 1}.png`}
                          className="inline-flex items-center justify-center gap-2 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                        >
                          <Download className="w-4 h-4" />
                          Baixar
                        </a>
                      </div>
                    ))}
                  </div>

                  <div className="mt-6 p-4 bg-gray-50 rounded-lg border border-gray-200 text-left">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Modificar Ambientação (Prompt)
                    </label>
                    <textarea
                      value={ambientPrompt}
                      onChange={(e) => setAmbientPrompt(e.target.value)}
                      rows={3}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                    />
                    <div className="mt-3 flex flex-wrap gap-2 items-center">
                      <span className="text-xs text-gray-500 font-medium">Ideias:</span>
                      <button onClick={() => setAmbientPrompt("Cenário de natureza, ao ar livre, luz do sol natural, realista, alta qualidade, produto em destaque.")} className="text-xs bg-white border border-gray-300 px-2 py-1 rounded hover:bg-gray-50 transition-colors">Natureza</button>
                      <button onClick={() => setAmbientPrompt("Estúdio fotográfico minimalista, fundo em tom pastel, iluminação suave, reflexo sutil, profissional.")} className="text-xs bg-white border border-gray-300 px-2 py-1 rounded hover:bg-gray-50 transition-colors">Estúdio Minimalista</button>
                      <button onClick={() => setAmbientPrompt("Cenário urbano moderno, textura de concreto, luzes da cidade ao fundo, estilo lifestyle.")} className="text-xs bg-white border border-gray-300 px-2 py-1 rounded hover:bg-gray-50 transition-colors">Urbano</button>
                      <button onClick={() => setAmbientPrompt("Ambiente caseiro aconchegante, mesa de madeira, luz quente de abajur, realista.")} className="text-xs bg-white border border-gray-300 px-2 py-1 rounded hover:bg-gray-50 transition-colors">Casa/Aconchegante</button>
                    </div>
                    <div className="mt-4 flex justify-end">
                      <button
                        onClick={handleGenerateAmbient}
                        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700"
                      >
                        <ImageIcon className="w-4 h-4" />
                        Regerar Imagens
                      </button>
                    </div>
                  </div>

                  <div className="flex justify-end gap-3 pt-6 border-t border-gray-200">
                    <button
                      onClick={() => setStep('search')}
                      disabled={isSaving}
                      className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
                    >
                      Voltar
                    </button>
                    <button
                      onClick={handleSave}
                      disabled={isSaving}
                      className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 disabled:opacity-50"
                    >
                      {isSaving ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Salvando...
                        </>
                      ) : (
                        'Salvar Imagens no Produto'
                      )}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
