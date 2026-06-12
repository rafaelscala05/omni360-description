import React, { useState, useEffect } from 'react';
import { X, Search, Image as ImageIcon, Loader2, Download, ExternalLink, RefreshCw } from 'lucide-react';
import { Product } from '../types/models';
import { storage } from '../firebase';
import { ref, getBlob } from 'firebase/storage';

interface ImageSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  product: Product | null;
  onSave: (productId: string, selectedImage: string, ambientImages: string[], tokenUsage?: { promptTokens: number; completionTokens: number; totalTokens: number }) => void;
  credits: number;
  consumeCredit: (actionType: string, productName?: string, sku?: string) => Promise<boolean>;
}

const IMAGE_TITLES = ['Produto Ambientado', 'Produto em Uso', 'Escala e Tamanho'];

export default function ImageSearchModal({ isOpen, onClose, product, onSave, credits, consumeCredit }: ImageSearchModalProps) {
  const [step, setStep] = useState<'search' | 'ambient'>('search');
  const [selectedImageUrl, setSelectedImageUrl] = useState<string>('');

  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [ambientImages, setAmbientImages] = useState<string[]>([]);
  const [imagePrompts, setImagePrompts] = useState<string[]>(['', '', '']);
  const [imageRegenerating, setImageRegenerating] = useState<boolean[]>([false, false, false]);
  const [tokenUsage, setTokenUsage] = useState({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
  const [productDescription, setProductDescription] = useState('');

  useEffect(() => {
    if (isOpen && product && step === 'search') {
      setSelectedImageUrl(product._selectedImage || '');
      setAmbientImages(product._ambientImages || []);
      setImagePrompts(['', '', '']);
      setTokenUsage({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
      setProductDescription('');
    }
  }, [isOpen, product]);

  const handleOpenGoogleImages = () => {
    if (!product) return;
    const query = `${product['Descrição']} ${product['Marca'] || ''}`.trim();
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&tbm=isch`;
    window.open(url, '_blank');
  };

  const fetchAndProcessImage = async (imageUrl: string): Promise<{ base64Data: string; mimeType: string }> => {
    let base64Data = '';
    let mimeType = '';

    if (imageUrl.startsWith('data:')) {
      const matches = imageUrl.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
      if (matches && matches.length === 3) {
        mimeType = matches[1];
        base64Data = matches[2];
      } else {
        throw new Error("Formato de imagem base64 inválido.");
      }
    } else {
      let blob: Blob | null = null;

      if (imageUrl.includes('firebasestorage.googleapis.com')) {
        try {
          const decodedUrl = decodeURIComponent(imageUrl);
          const pathMatch = decodedUrl.match(/\/o\/(.+?)\?/);
          if (pathMatch && pathMatch[1]) {
            const storageRef = ref(storage, pathMatch[1]);
            blob = await getBlob(storageRef);
          }
        } catch (fbError) {
          console.warn("Falha ao buscar blob do Firebase via SDK:", fbError);
        }
      }

      if (!blob) {
        try {
          const imgResponse = await fetch(imageUrl);
          if (!imgResponse.ok) throw new Error(`Direct fetch failed with status ${imgResponse.status}`);
          blob = await imgResponse.blob();
        } catch (e) {
          const proxies = [
            { name: 'wsrv.nl', url: `https://wsrv.nl/?url=${encodeURIComponent(imageUrl)}&output=jpeg` },
            { name: 'corsproxy.io', url: `https://corsproxy.io/?${encodeURIComponent(imageUrl)}` },
            { name: 'codetabs', url: `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(imageUrl)}` },
            { name: 'allorigins', url: `https://api.allorigins.win/raw?url=${encodeURIComponent(imageUrl)}` }
          ];

          for (const proxy of proxies) {
            try {
              const pResp = await fetch(proxy.url);
              if (pResp.ok) {
                blob = await pResp.blob();
                break;
              }
            } catch (_) {}
          }
        }
      }

      if (!blob) {
        throw new Error("Não foi possível carregar a imagem da URL fornecida (CORS ou erro de rede).");
      }

      const reader = new FileReader();
      const base64DataUrl = await new Promise<string>((resolve) => {
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(blob!);
      });

      base64Data = base64DataUrl.split(',')[1];
      mimeType = blob.type || 'image/jpeg';
    }

    // Normalize to JPEG and cap at 1024px
    const processed = await new Promise<{ base64: string; mimeType: string }>((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "Anonymous";
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_DIM = 1024;
        let width = img.width;
        let height = img.height;
        if (width > MAX_DIM || height > MAX_DIM) {
          if (width > height) { height *= MAX_DIM / width; width = MAX_DIM; }
          else { width *= MAX_DIM / height; height = MAX_DIM; }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve({ base64: base64Data, mimeType }); return; }
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        const newDataUrl = canvas.toDataURL('image/jpeg', 0.9);
        resolve({ base64: newDataUrl.split(',')[1], mimeType: 'image/jpeg' });
      };
      img.onerror = () => reject(new Error("O arquivo carregado não é uma imagem válida ou está corrompido."));
      img.src = `data:${mimeType};base64,${base64Data}`;
    });

    return { base64Data: processed.base64, mimeType: processed.mimeType };
  };

  const callGenerateImage = async (base64Data: string, mimeType: string, prompt: string, imageIndex: number, retries = 2): Promise<string | null> => {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetch('/api/gemini/generate-ambient-images', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ base64Data, mimeType, ambientPrompt: prompt, imageIndex })
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `Erro de rede no servidor (Status ${res.status})`);
        }

        const data = await res.json();
        return data.image || null;
      } catch (error: any) {
        const isQuotaError = /429|RESOURCE_EXHAUSTED|quota|limite/.test(error.message || "");
        if (isQuotaError && attempt < retries) {
          await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 2000));
          continue;
        }
        throw error;
      }
    }
    return null;
  };

  const handleGenerateAmbient = async () => {
    if (!selectedImageUrl || !product) return;
    if (!(await consumeCredit('Geração de Ambientação', product['Descrição'], product['Código (SKU)']))) return;

    setIsGenerating(true);
    setStep('ambient');

    try {
      // 1. Process image first — needed by Gemini for visual analysis
      const { base64Data, mimeType } = await fetchAndProcessImage(selectedImageUrl);

      // 2. Generate prompts WITH the product image so Gemini can visually anchor them
      const promptsRes = await fetch('/api/gemini/generate-ambient-prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productName: product['Descrição'] || '',
          brand: product['Marca'] || '',
          category: product['Categoria'] || '',
          description: product['Descrição complementar'] || '',
          base64Data,
          mimeType
        })
      });

      if (!promptsRes.ok) {
        const err = await promptsRes.json().catch(() => ({}));
        throw new Error(err.error || 'Erro ao gerar prompts de ambientação.');
      }

      const { prompts, productDescription: desc } = await promptsRes.json();
      setImagePrompts(prompts);
      if (desc) setProductDescription(desc);

      // 3. Generate all 3 ambient images (retry/backoff handled inside callGenerateImage)
      const validImages: string[] = [];
      for (let i = 0; i < 3; i++) {
        try {
          const imgData = await callGenerateImage(base64Data, mimeType, prompts[i], i);
          validImages.push(imgData || '');
        } catch (genError: any) {
          const isQuota = /429|RESOURCE_EXHAUSTED|quota|limite/.test(genError.message || "");
          if (isQuota && validImages.length > 0) break;
          if (i === 0) throw genError;
          validImages.push('');
        }
      }

      if (validImages.every(img => !img)) throw new Error("Não foi possível gerar nenhuma imagem.");
      setAmbientImages(validImages);

    } catch (error: any) {
      console.error("Erro ao gerar ambientações:", error);
      const isQuota = /429|RESOURCE_EXHAUSTED|quota|limite/.test(error.message || "");
      alert(isQuota
        ? "O limite de uso da IA foi atingido (Erro 429). Aguarde um momento e tente novamente."
        : `Erro: ${error.message || "Erro ao processar a imagem."}`
      );
      setStep('search');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRegenerateImage = async (index: number) => {
    if (!selectedImageUrl || !product) return;
    if (!(await consumeCredit('Regeneração de Imagem', product['Descrição'], product['Código (SKU)']))) return;

    setImageRegenerating(prev => { const n = [...prev]; n[index] = true; return n; });

    try {
      const { base64Data, mimeType } = await fetchAndProcessImage(selectedImageUrl);
      const imgData = await callGenerateImage(base64Data, mimeType, imagePrompts[index], index);
      if (imgData) {
        setAmbientImages(prev => { const n = [...prev]; n[index] = imgData; return n; });
      }
    } catch (error: any) {
      const isQuota = /429|RESOURCE_EXHAUSTED|quota|limite/.test(error.message || "");
      alert(isQuota
        ? "Limite de uso da IA atingido. Aguarde e tente novamente."
        : `Erro ao regenerar imagem: ${error.message}`
      );
    } finally {
      setImageRegenerating(prev => { const n = [...prev]; n[index] = false; return n; });
    }
  };

  const uploadImage = async (base64OrUrl: string, filename: string): Promise<string> => {
    try {
      const payload: any = { filename };
      if (base64OrUrl.startsWith('data:')) payload.imageBase64 = base64OrUrl;
      else payload.imageUrl = base64OrUrl;

      const response = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) throw new Error('Falha ao enviar imagem para /api/upload');
      const data = await response.json();
      return data.url;
    } catch (error) {
      console.error('Error uploading image:', error);
      return base64OrUrl;
    }
  };

  const handleSave = async () => {
    if (product && selectedImageUrl) {
      setIsSaving(true);
      try {
        const finalSelectedImage = await uploadImage(selectedImageUrl, product['Código (SKU)'] || 'produto');
        const finalAmbientImages = await Promise.all(
          ambientImages.map((img, idx) =>
            img ? uploadImage(img, `${product['Código (SKU)'] || 'produto'}_ambientacao_${idx + 1}`) : Promise.resolve('')
          )
        );
        onSave(product._id, finalSelectedImage, finalAmbientImages.filter(Boolean), tokenUsage.totalTokens > 0 ? tokenUsage : undefined);
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
    setImagePrompts(['', '', '']);
    setImageRegenerating([false, false, false]);
    setProductDescription('');
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
            <button onClick={handleClose} className="text-gray-400 hover:text-gray-500 focus:outline-none">
              <X className="w-6 h-6" />
            </button>
          </div>

          <div className="mb-4">
            <p className="text-sm text-gray-500">
              <strong>Produto:</strong> {product['Descrição']} <br />
              <strong>SKU:</strong> {product['Código (SKU)']} | <strong>Marca:</strong> {product['Marca']}
            </p>
          </div>

          {step === 'search' && (
            <div className="space-y-6">
              <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 flex items-start gap-3">
                <Search className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
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
                      onError={(e) => { (e.target as HTMLImageElement).src = 'https://via.placeholder.com/200?text=Erro+ao+carregar'; }}
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
                  {isSaving ? <><Loader2 className="w-4 h-4 animate-spin" />Salvando...</> : 'Salvar Apenas Imagem'}
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
                  <p className="text-gray-600">A IA está analisando o produto e gerando 3 imagens personalizadas...</p>
                  <p className="text-sm text-gray-400 mt-2">Isso pode levar alguns segundos.</p>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                    {IMAGE_TITLES.map((title, idx) => (
                      <div key={idx} className="flex flex-col gap-3">
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{title}</p>

                        <div className="relative aspect-square rounded-lg overflow-hidden border border-gray-200 shadow-sm bg-gray-50">
                          {ambientImages[idx] ? (
                            <img src={ambientImages[idx]} alt={title} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-gray-300">
                              <ImageIcon className="w-10 h-10" />
                            </div>
                          )}
                          {imageRegenerating[idx] && (
                            <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
                              <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
                            </div>
                          )}
                        </div>

                        <textarea
                          value={imagePrompts[idx]}
                          onChange={(e) => setImagePrompts(prev => { const n = [...prev]; n[idx] = e.target.value; return n; })}
                          rows={3}
                          placeholder="Sugerir um novo prompt..."
                          className="w-full px-3 py-2 text-xs border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 resize-none"
                        />

                        <div className="flex gap-2">
                          <button
                            onClick={() => handleRegenerateImage(idx)}
                            disabled={imageRegenerating[idx] || imageRegenerating.some(r => r)}
                            className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <RefreshCw className="w-3 h-3" />
                            Gerar novamente
                          </button>
                          {ambientImages[idx] && (
                            <a
                              href={ambientImages[idx]}
                              download={`${product['Código (SKU)'] || 'produto'}_${title.toLowerCase().replace(/ /g, '_')}.png`}
                              className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                            >
                              <Download className="w-3 h-3" />
                              Baixar
                            </a>
                          )}
                        </div>
                      </div>
                    ))}
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
                      {isSaving ? <><Loader2 className="w-4 h-4 animate-spin" />Salvando...</> : 'Salvar Imagens no Produto'}
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
