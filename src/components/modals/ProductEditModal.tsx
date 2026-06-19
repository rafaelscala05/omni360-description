import React, { useState, useEffect, useRef } from 'react';
import { Product, Category, AttributeDefinition, ProductModalTab, getProductStatusFlags } from '../../types/models';
import { getEffectiveAttributes } from '../../services/categoryService';
import { generateAttributesFromImage, generateProductAttributes, generateDescriptionText, defaultTemplate, type Template } from '../../services/productService';
import { trackAttributesGenerated } from '../../analytics';
import { listReusableArticles } from '../../services/contentService';
import { 
  Sparkles, 
  Save, 
  X, 
  Image as ImageIcon, 
  Loader2, 
  Wand2, 
  Database,
  Layout,
  Tag,
  Settings,
  Cpu,
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  Bold,
  Italic,
  Underline,
  List,
  ListOrdered,
  Eye,
  Code
} from 'lucide-react';

const cn = (...classes: (string | boolean | undefined)[]) => classes.filter(Boolean).join(' ');

interface WYSIWYGEditorProps {
  value: string;
  onChange: (val: string) => void;
}

function WYSIWYGEditor({ value, onChange }: WYSIWYGEditorProps) {
  const [editorMode, setEditorMode] = useState<'visual' | 'code'>('visual');
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = value || '<p><br></p>';
    }
  }, [value, editorMode]);

  const executeCommand = (command: string, arg?: string) => {
    document.execCommand(command, false, arg);
    if (editorRef.current) {
      editorRef.current.focus();
      onChange(editorRef.current.innerHTML);
    }
  };

  const handleInput = () => {
    if (editorRef.current) {
      onChange(editorRef.current.innerHTML);
    }
  };

  return (
    <div className="border border-slate-200 rounded-2xl overflow-hidden focus-within:ring-2 focus-within:ring-blue-500/20 focus-within:border-blue-500 transition-all bg-white">
      <style>{`
        .visual-wysiwyg ul { list-style-type: disc !important; padding-left: 1.5rem !important; margin-top: 0.5rem !important; margin-bottom: 0.5rem !important; }
        .visual-wysiwyg ol { list-style-type: decimal !important; padding-left: 1.5rem !important; margin-top: 0.5rem !important; margin-bottom: 0.5rem !important; }
        .visual-wysiwyg h2 { font-size: 1.25rem !important; font-weight: 700 !important; margin-top: 1rem !important; margin-bottom: 0.5rem !important; color: #0f172a !important; }
        .visual-wysiwyg h3 { font-size: 1.1rem !important; font-weight: 700 !important; margin-top: 0.75rem !important; margin-bottom: 0.5rem !important; color: #1e293b !important; }
        .visual-wysiwyg p { margin-bottom: 0.75rem !important; }
        .visual-wysiwyg strong, .visual-wysiwyg b { font-weight: bold !important; }
        .visual-wysiwyg em, .visual-wysiwyg i { font-style: italic !important; }
        .visual-wysiwyg u { text-decoration: underline !important; }
      `}</style>
      
      {/* WYSIWYG Toolbar & Tabs */}
      <div className="flex flex-wrap items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2 gap-2 select-none">
        <div className="flex items-center gap-1">
          {/* Format Buttons - only active in visual mode */}
          {editorMode === 'visual' ? (
            <>
              <button
                type="button"
                onClick={() => executeCommand('bold')}
                className="p-1.5 hover:bg-slate-200 rounded text-slate-700 transition-colors"
                title="Negrito"
              >
                <Bold className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => executeCommand('italic')}
                className="p-1.5 hover:bg-slate-200 rounded text-slate-700 transition-colors"
                title="Itálico"
              >
                <Italic className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => executeCommand('underline')}
                className="p-1.5 hover:bg-slate-200 rounded text-slate-700 transition-colors"
                title="Sublinhado"
              >
                <Underline className="w-4 h-4" />
              </button>
              <div className="w-px h-4 bg-slate-300 mx-1"></div>
              
              <button
                type="button"
                onClick={() => executeCommand('formatBlock', 'h2')}
                className="px-2 py-1 hover:bg-slate-200 rounded text-xs font-extrabold text-slate-700 transition-colors"
                title="Título Principal"
              >
                H2
              </button>
              <button
                type="button"
                onClick={() => executeCommand('formatBlock', 'h3')}
                className="px-2 py-1 hover:bg-slate-200 rounded text-xs font-extrabold text-slate-700 transition-colors"
                title="Subtítulo"
              >
                H3
              </button>
              <button
                type="button"
                onClick={() => executeCommand('formatBlock', 'p')}
                className="px-2 py-1 hover:bg-slate-200 rounded text-xs font-bold text-slate-700 transition-colors"
                title="Parágrafo"
              >
                Parágrafo
              </button>
              
              <div className="w-px h-4 bg-slate-300 mx-1"></div>
              
              <button
                type="button"
                onClick={() => executeCommand('insertUnorderedList')}
                className="p-1.5 hover:bg-slate-200 rounded text-slate-700 transition-colors"
                title="Lista com Marcadores"
              >
                <List className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => executeCommand('insertOrderedList')}
                className="p-1.5 hover:bg-slate-200 rounded text-slate-700 transition-colors"
                title="Lista Numerada"
              >
                <ListOrdered className="w-4 h-4" />
              </button>
            </>
          ) : (
            <span className="text-xs font-bold text-slate-400 px-2 py-1">Modo de Edição HTML Direto</span>
          )}
        </div>

        {/* View Mode Switcher tabs */}
        <div className="flex bg-slate-200 p-0.5 rounded-lg">
          <button
            type="button"
            onClick={() => setEditorMode('visual')}
            className={cn(
              "px-3 py-1 text-xs font-bold rounded-md flex items-center gap-1.5 transition-all-custom",
              editorMode === 'visual' ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-900"
            )}
          >
            <Eye className="w-3 h-3" />
            Visual
          </button>
          <button
            type="button"
            onClick={() => setEditorMode('code')}
            className={cn(
              "px-3 py-1 text-xs font-bold rounded-md flex items-center gap-1.5 transition-all-custom",
              editorMode === 'code' ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-900"
            )}
          >
            <Code className="w-3 h-3" />
            Código HTML
          </button>
        </div>
      </div>

      {/* Editor Content Box */}
      <div className="relative">
        {editorMode === 'visual' ? (
          <div
            ref={editorRef}
            contentEditable
            onInput={handleInput}
            onBlur={handleInput}
            className="w-full min-h-[300px] max-h-[500px] overflow-y-auto px-6 py-5 outline-none visual-wysiwyg text-slate-800 focus:bg-white transition-colors"
            style={{
              fontFamily: 'Inter, system-ui, sans-serif',
              fontSize: '14px',
              lineHeight: '1.6'
            }}
          />
        ) : (
          <textarea
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
            className="w-full h-[300px] px-6 py-5 font-mono text-sm leading-relaxed border-none focus:ring-0 outline-none bg-slate-900 text-slate-100 placeholder-slate-700 resize-y"
            placeholder="Insira sua descrição em formato HTML..."
          />
        )}
      </div>
    </div>
  );
}

interface ProductEditModalProps {
  product: Product;
  categories: Category[];
  initialTab?: ProductModalTab;
  onClose: () => void;
  onSave: (updatedProduct: Product) => void;
  onCategoryUpdate?: (categoryId: string, newAttr: AttributeDefinition) => Promise<void>;
  onOpenImageModal?: () => void;
  templates?: Template[];
  selectedTemplateId?: string;
}

export default function ProductEditModal({ product, categories, initialTab = 'geral', onClose, onSave, onCategoryUpdate, onOpenImageModal, templates = [], selectedTemplateId }: ProductEditModalProps) {
  // Template escolhido para (re)gerar a descrição. Inicia no template padrão da
  // aplicação e pode ser trocado pelo usuário antes de gerar novamente.
  const [chosenTemplateId, setChosenTemplateId] = useState<string>(selectedTemplateId || defaultTemplate.id);
  const [editedProduct, setEditedProduct] = useState<Product>({ ...product });
  const [initialProduct, setInitialProduct] = useState<Product>({ ...product });
  const [activeTab, setActiveTab] = useState<ProductModalTab>(initialTab);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isGeneratingIA, setIsGeneratingIA] = useState(false);
  const [suggestedAttributes, setSuggestedAttributes] = useState<any[]>([]);
  const [isSavingCategoryAttr, setIsSavingCategoryAttr] = useState<string | null>(null);
  const [showConfirmClose, setShowConfirmClose] = useState(false);
  // Cross-module reuse: artigos aprovados/publicados pela Agência de Conteúdo.
  const [reusableArticles, setReusableArticles] = useState<Array<{ id: string; titulo: string; articleFinal: string }>>([]);

  useEffect(() => {
    listReusableArticles()
      .then((r) => setReusableArticles(r.articles))
      .catch(() => setReusableArticles([]));
  }, []);

  // Minimal Markdown → HTML for inserting an article body into the description.
  const articleToHtml = (md: string): string =>
    md
      .replace(/^SLUG:.*$/gim, '')
      .replace(/^META:.*$/gim, '')
      .replace(/^### (.*)$/gim, '<h3>$1</h3>')
      .replace(/^## (.*)$/gim, '<h2>$1</h2>')
      .replace(/^# (.*)$/gim, '<h2>$1</h2>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .split(/\n{2,}/)
      .map((b) => (/^<h[23]>/.test(b.trim()) ? b.trim() : b.trim() ? `<p>${b.trim().replace(/\n/g, '<br>')}</p>` : ''))
      .filter(Boolean)
      .join('\n');

  const insertArticle = (articleId: string) => {
    const art = reusableArticles.find((a) => a.id === articleId);
    if (!art) return;
    const html = articleToHtml(art.articleFinal);
    setEditedProduct((prev) => ({
      ...prev,
      'Descrição complementar': `${prev['Descrição complementar'] || ''}\n${html}`.trim(),
    }));
  };

  const hasGeneratedContent = product?._statusDescricao === 'Gerado por IA' || editedProduct?._statusDescricao === 'Gerado por IA';

  useEffect(() => {
    if (!editedProduct.attributes) {
      setEditedProduct(prev => ({ ...prev, attributes: {} }));
    }
    // Prevent body scroll when full screen is open
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = 'auto';
    };
  }, []);

  const handleAttributeChange = (key: string, value: any) => {
    setEditedProduct(prev => ({
      ...prev,
      attributes: {
        ...(prev.attributes || {}),
        [key]: { value, confirmed: true, aiSuggested: false, source: 'manual' }
      }
    }));
  };

  const handleGenerateIA = async () => {
    setIsGeneratingIA(true);
    try {
      const template = templates.find(t => t.id === chosenTemplateId) || defaultTemplate;
      const result = await generateDescriptionText(editedProduct, categories, template);
      
      let newAttrs = { ...(editedProduct.attributes || {}) };
      if (result.extracted_attributes) {
        Object.keys(result.extracted_attributes).forEach(key => {
          newAttrs[key] = {
            value: result.extracted_attributes[key].value,
            confirmed: false,
            aiSuggested: true,
            source: 'text_ai'
          };
        });
      }

      if (result.suggested_attributes) {
        setSuggestedAttributes(prev => {
            const next = [...prev];
            result.suggested_attributes.forEach((s: any) => {
                if (!next.find(n => n.key === s.key)) next.push(s);
            });
            return next;
        });
      }

      const finalProduct = {
        ...editedProduct,
        // O título otimizado também passa a ser o nome do produto (campo 'Descrição').
        'Descrição': result.titulo_seo || editedProduct['Descrição'],
        'Descrição complementar': result.descricao_html,
        'Título SEO': result.titulo_seo,
        'Descrição SEO': result.descricao_seo,
        'Palavras chave SEO': result.palavras_chave,
        attributes: newAttrs,
        _statusDescricao: 'Gerado por IA',
        _statusSEO: 'Gerado por IA',
        _generationError: undefined
      };

      setEditedProduct(finalProduct as Product);
      setInitialProduct(finalProduct as Product);
      
      // Auto-save the product when premium content is generated
      onSave(finalProduct as Product);
    } catch (error) {
      console.error("Erro ao gerar conteúdo IA:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      alert(`Erro ao gerar conteúdo IA: ${errorMessage}`);
      setEditedProduct(prev => ({
        ...prev,
        _generationError: errorMessage
      }));
    } finally {
      setIsGeneratingIA(false);
    }
  };

  const handleSave = () => {
    setInitialProduct(editedProduct);
    onSave(editedProduct);
  };

  const hasUnsavedChanges = JSON.stringify(editedProduct) !== JSON.stringify(initialProduct);

  const handleCloseAttempt = () => {
    if (hasUnsavedChanges) {
      setShowConfirmClose(true);
    } else {
      onClose();
    }
  };

  const handleSyncToCategory = async (attr: { key: string, label: string, type: string, options?: string[] }) => {
    if (!editedProduct.categoryId || !onCategoryUpdate) return;
    
    setIsSavingCategoryAttr(attr.key);
    try {
      const newAttr: AttributeDefinition = {
        id: `attr_${Date.now()}`,
        key: attr.key,
        label: attr.label,
        type: attr.type as any,
        options: attr.options || [],
        required: false,
        order: 99,
        aiSuggested: true,
        createdAt: new Date().toISOString()
      };
      
      await onCategoryUpdate(editedProduct.categoryId, newAttr);
      alert("Atributo salvo na categoria com sucesso!");
    } catch (error) {
      console.error("Erro ao salvar atributo na categoria:", error);
      alert("Erro ao salvar na categoria.");
    } finally {
      setIsSavingCategoryAttr(null);
    }
  };

  const effectiveAttributes = editedProduct.categoryId 
    ? getEffectiveAttributes(editedProduct.categoryId, categories)
    : [];

  const extraAttributeKeys = Object.keys(editedProduct.attributes || {}).filter(
    key => !effectiveAttributes.find(attr => attr.key === key)
  );

  const handleAnalyze = async () => {
    setIsAnalyzing(true);
    setSuggestedAttributes([]);
    let newAttrs = { ...(editedProduct.attributes || {}) };
    let allSuggested: any[] = [];
    let hasUpdates = false;

    try {
      const textResult = await generateProductAttributes(editedProduct, effectiveAttributes);
      if (textResult.attributes) {
        Object.keys(textResult.attributes).forEach(key => {
          newAttrs[key] = {
            value: textResult.attributes[key].value,
            confirmed: false,
            aiSuggested: true,
            source: 'text_ai'
          };
          hasUpdates = true;
        });
      }
      if (textResult.suggestedNewAttributes) {
        allSuggested = [...allSuggested, ...textResult.suggestedNewAttributes];
      }
    } catch (e) {
      console.error("Erro na análise de texto:", e);
    }

    const imageUrl = editedProduct._selectedImage || editedProduct['URL imagem 1'];
    if (imageUrl) {
      try {
        let base64 = imageUrl;
        if (!base64.startsWith('data:')) {
          const response = await fetch(imageUrl);
          if (response.ok) {
              const blob = await response.blob();
              base64 = await new Promise<string>((resolve, reject) => {
                  const reader = new FileReader();
                  reader.onloadend = () => resolve(reader.result as string);
                  reader.onerror = reject;
                  reader.readAsDataURL(blob);
              });
          }
        }
        
        if (base64.startsWith('data:')) {
            const imageResult = await generateAttributesFromImage(base64, effectiveAttributes, editedProduct);
            if (imageResult.attributes) {
                Object.keys(imageResult.attributes).forEach(key => {
                    newAttrs[key] = {
                        value: imageResult.attributes[key].value,
                        confirmed: false,
                        aiSuggested: true,
                        source: 'image_ai'
                    };
                    hasUpdates = true;
                });
            }
            if (imageResult.suggestedNewAttributes) {
              allSuggested = [...allSuggested, ...imageResult.suggestedNewAttributes];
            }
        }
      } catch (e) {
        console.error("Erro na análise de imagem:", e);
      }
    }

    const uniqueSuggested = allSuggested.reduce((acc: any[], curr: any) => {
      if (!acc.find(a => a.key === curr.key)) acc.push(curr);
      return acc;
    }, []);

    setSuggestedAttributes(uniqueSuggested);

    if (hasUpdates) {
        setEditedProduct(prev => ({ ...prev, attributes: newAttrs }));
        const hasImage = !!(editedProduct._selectedImage || editedProduct['URL imagem 1']);
        trackAttributesGenerated({ source: hasImage ? 'image' : 'text', sku: editedProduct['Código (SKU)'] as string });
    } else if (uniqueSuggested.length === 0) {
        alert("A IA não encontrou novos atributos.");
    }
    setIsAnalyzing(false);
  };

  const statusFlags = getProductStatusFlags(editedProduct);

  const tabs = [
    { id: 'geral', label: 'Geral', icon: Layout, done: false },
    { id: 'atributos', label: 'Atributos', icon: Tag, done: statusFlags.atributosGerados },
    // { id: 'tecnico', label: 'Técnico', icon: Cpu, done: statusFlags.enriquecido }, // Aba técnica desativada temporariamente
    { id: 'ia', label: 'Conteúdo', icon: Sparkles, done: statusFlags.descricaoGerada },
    { id: 'imagem', label: 'Imagens', icon: ImageIcon, done: statusFlags.imagensGeradas },
    { id: 'simular', label: 'Simular Produto', icon: Eye, done: false },
  ] as const;

  return (
    <div className="fixed inset-0 z-[100] bg-slate-50 flex flex-col animate-in fade-in duration-300">
      {/* Header Bar */}
      <header className="h-16 bg-white border-b border-slate-200 px-3 md:px-6 flex items-center justify-between sticky top-0 z-20 gap-2">
        <div className="flex items-center gap-2 md:gap-4 min-w-0">
          <button 
            onClick={handleCloseAttempt}
            className="p-1.5 md:p-2 hover:bg-slate-100 rounded-lg text-slate-500 transition-colors shrink-0"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="h-8 w-px bg-slate-200 shrink-0"></div>
          <div className="flex items-center gap-2 md:gap-3 min-w-0">
             {editedProduct['URL imagem 1'] || editedProduct._selectedImage ? (
                <img src={editedProduct._selectedImage || editedProduct['URL imagem 1']} alt="" className="h-8 w-8 md:h-10 md:w-10 rounded-md object-cover border border-slate-200 shrink-0" referrerPolicy="no-referrer" />
              ) : (
                <div className="h-8 w-8 md:h-10 md:w-10 rounded-md bg-slate-100 flex items-center justify-center border border-slate-200 shrink-0">
                  <ImageIcon className="w-4 h-4 md:w-5 md:h-5 text-slate-400" />
                </div>
              )}
              <div className="min-w-0">
                <h1 className="text-sm md:text-base font-bold text-slate-900 truncate max-w-[120px] sm:max-w-[260px] md:max-w-[400px]">
                    {editedProduct['Descrição'] || 'Produto Sem Nome'}
                </h1>
                <p className="text-[10px] text-slate-500 font-mono">SKU: {editedProduct['Código (SKU)'] || 'N/A'}</p>
              </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 md:gap-3 shrink-0">
          <button 
            onClick={handleCloseAttempt}
            className="px-2.5 py-2 text-xs md:text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors whitespace-nowrap"
          >
            Cancelar
          </button>
          <button 
            onClick={() => { handleSave(); onClose(); }}
            className="px-3 md:px-6 py-2 bg-[#004ac6] text-white text-xs md:text-sm font-bold rounded-xl shadow-lg shadow-blue-200 hover:bg-blue-700 transition-all flex items-center gap-1.5 shrink-0 whitespace-nowrap"
          >
            <Save className="w-4 h-4" />
            <span className="hidden xs:inline">Salvar e Fechar</span>
            <span className="xs:hidden">Salvar</span>
          </button>
        </div>
      </header>

      <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
        {/* Sidebar Navigation */}
        <aside className="w-full md:w-64 bg-white border-b md:border-b-0 md:border-r border-slate-200 flex flex-row md:flex-col p-2 md:p-4 gap-1.5 md:gap-2 shrink-0 overflow-x-auto scrollbar-none whitespace-nowrap z-10">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex items-center gap-2 md:gap-3 px-3 py-2 md:px-4 md:py-3 rounded-lg md:rounded-xl text-xs md:text-sm font-bold transition-all shrink-0",
                  isActive 
                    ? "bg-blue-50 text-[#004ac6] shadow-sm" 
                    : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                )}
              >
                <Icon className={cn("w-5 h-5", isActive ? "text-[#004ac6]" : "text-slate-400")} />
                {tab.label}
                {tab.id === 'atributos' && effectiveAttributes.length > 0 && (
                   <span className="ml-1 px-1.5 py-0.5 rounded-full bg-blue-100 text-[#004ac6] text-[10px]">
                      {effectiveAttributes.length}
                   </span>
                )}
                {tab.done && (
                   <CheckCircle2 className="w-4 h-4 text-emerald-500 ml-auto shrink-0" />
                )}
              </button>
            );
          })}
          
          <div className="hidden md:block mt-auto p-4 bg-slate-50 rounded-2xl border border-slate-100">
             <div className="flex items-center gap-2 mb-2">
                <Sparkles className="w-3.5 h-3.5 text-purple-600" />
                <span className="text-[10px] font-bold text-slate-900 uppercase tracking-wider">Dica de IA</span>
             </div>
             <p className="text-[11px] text-slate-500 leading-relaxed">
                Use a aba de Atributos para preencher detalhes técnicos automaticamente usando o Gemini 2.0.
             </p>
          </div>
        </aside>

        {/* Content Area */}
        <main className="flex-1 overflow-y-auto p-8">
           <div className="max-w-4xl mx-auto">
              
              {editedProduct._generationError && (
                <div id="ai-generation-error-banner" className="mb-6 p-5 bg-red-50 border border-red-200 rounded-2xl flex items-start gap-4 shadow-sm animate-in fade-in slide-in-from-top-2 duration-300">
                  <div className="p-1.5 bg-red-100 text-red-600 rounded-xl shrink-0">
                    <AlertCircle className="w-5 h-5 animate-pulse" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-4 mb-2">
                      <h4 className="text-[10px] font-black text-red-900 uppercase tracking-widest">Falha na Geração de Conteúdo por IA</h4>
                      <button 
                        onClick={() => setEditedProduct(prev => ({ ...prev, _generationError: undefined }))}
                        className="text-[10px] font-bold text-red-500 hover:text-red-700 transition-colors uppercase tracking-wider cursor-pointer"
                      >
                        Descartar Aviso
                      </button>
                    </div>
                    <p className="text-xs text-red-700 leading-relaxed font-semibold mb-3">
                      Ocorreu um erro ao preencher dados técnicos ou gerar textos para o produto. Detalhes do registro de erro:
                    </p>
                    <div className="p-3 bg-white border border-red-100 rounded-xl font-mono text-[11px] text-red-600 max-h-36 overflow-y-auto leading-relaxed shadow-inner">
                      {editedProduct._generationError}
                    </div>
                    <div className="mt-3.5 flex items-center gap-2">
                      <button
                        onClick={handleGenerateIA}
                        disabled={isGeneratingIA}
                        className="px-4 py-2 bg-red-650 hover:bg-red-700 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-md active:scale-95 disabled:opacity-50"
                      >
                        {isGeneratingIA ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            Gerando...
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-3.5 h-3.5" />
                            Tentar Gerar Novamente
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              )}
              
              {activeTab === 'geral' && (
                <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-300">
                  <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                    <h2 className="text-lg font-bold text-slate-900 mb-6 flex items-center gap-2">
                       <Layout className="w-5 h-5 text-blue-600" />
                       Informações Básicas
                    </h2>

                    <div className="grid grid-cols-1 gap-6">
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-slate-500 uppercase ml-1">Título do Produto</label>
                        <input 
                          type="text" 
                          value={editedProduct['Descrição'] || ''} 
                          onChange={(e) => setEditedProduct({...editedProduct, 'Descrição': e.target.value})} 
                          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all" 
                          placeholder="Ex: Tênis Esportivo Pro"
                        />
                      </div>
                      
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-slate-500 uppercase ml-1">Categoria</label>
                        <select 
                          value={editedProduct.categoryId || ''} 
                          onChange={(e) => {
                            const cid = e.target.value;
                            const cat = categories.find(c => c.id === cid);
                            setEditedProduct({...editedProduct, categoryId: cid, categoryPath: cat?.path, 'Categoria': cat?.path.join(' > ')});
                          }} 
                          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all appearance-none cursor-pointer"
                        >
                          <option value="">Selecione uma categoria...</option>
                          {categories.map(c => (
                            <option key={c.id} value={c.id}>{c.path.join(' > ')}</option>
                          ))}
                        </select>
                      </div>

                      <div className="grid grid-cols-2 gap-6">
                        <div className="space-y-1.5">
                          <label className="text-xs font-bold text-slate-500 uppercase ml-1">Marca</label>
                          <input 
                            type="text" 
                            value={editedProduct['Marca'] || ''} 
                            onChange={(e) => setEditedProduct({...editedProduct, 'Marca': e.target.value})} 
                            className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all" 
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-bold text-slate-500 uppercase ml-1">Preço (R$)</label>
                          <input 
                            type="number" 
                            step="0.01" 
                            value={editedProduct['Preço'] as string || ''} 
                            onChange={(e) => setEditedProduct({...editedProduct, 'Preço': e.target.value})} 
                            className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all font-mono" 
                          />
                        </div>
                      </div>
                    </div>
                  </section>
                </div>
              )}

              {activeTab === 'atributos' && (
                <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-300">
                   {!editedProduct.categoryId ? (
                    <div className="flex flex-col items-center justify-center py-20 bg-white rounded-3xl border border-dashed border-slate-300">
                      <AlertCircle className="w-12 h-12 text-slate-300 mb-4" />
                      <p className="text-slate-500 font-medium">Selecione uma categoria na aba "Geral" para habilitar os atributos.</p>
                    </div>
                  ) : (
                    <>
                      {/* AI Header Dashboard */}
                      <header className="bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-600 p-8 rounded-3xl shadow-xl shadow-purple-100 flex items-center justify-between gap-8 mb-10 overflow-hidden relative">
                         <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full -mr-20 -mt-20 blur-3xl"></div>
                         <div className="relative z-10 flex-1">
                            <div className="flex items-center gap-3 mb-2">
                               <div className="p-2 bg-white/20 backdrop-blur-md rounded-xl">
                                  <Sparkles className="w-6 h-6 text-white" />
                               </div>
                               <h2 className="text-2xl font-bold text-white tracking-tight">Atributos Inteligentes</h2>
                            </div>
                            <p className="text-purple-100 text-sm max-w-lg leading-relaxed">
                               O Gemini 2.0 analisará as imagens e descrições do seu produto para detectar automaticamente materiais, cores, tamanhos e proporções técnicas.
                            </p>
                         </div>
                         <button 
                          onClick={handleAnalyze}
                          disabled={isAnalyzing}
                          className="relative z-10 flex items-center gap-3 px-8 py-4 bg-white text-purple-700 rounded-2xl font-bold transition-all shadow-xl hover:scale-105 active:scale-95 disabled:opacity-50 whitespace-nowrap group"
                         >
                          {isAnalyzing ? (
                            <Loader2 className="w-6 h-6 animate-spin" />
                          ) : (
                            <Wand2 className="w-6 h-6 group-hover:rotate-12 transition-transform" />
                          )}
                          {isAnalyzing ? 'Analisando...' : 'Preencher com IA'}
                         </button>
                      </header>

                      {/* Main Attributes Grid */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {effectiveAttributes.length === 0 && extraAttributeKeys.length === 0 && (
                           <div className="col-span-full py-20 text-center bg-white rounded-3xl border border-dashed border-slate-200">
                              <Tag className="w-10 h-10 text-slate-200 mx-auto mb-3" />
                              <p className="text-slate-400 text-sm">Nenhum atributo definido para esta categoria.</p>
                           </div>
                        )}

                        {effectiveAttributes.map((attr) => {
                          const valObj = editedProduct.attributes?.[attr.key];
                          const value = valObj?.value || '';
                          const isAI = valObj?.aiSuggested && !valObj?.confirmed;

                          return (
                            <div 
                              key={attr.key} 
                              className={cn(
                                "group p-6 rounded-2xl border transition-all relative overflow-hidden",
                                isAI 
                                  ? "bg-purple-50/50 border-purple-200 shadow-sm" 
                                  : "bg-white border-slate-200 hover:border-blue-300"
                              )}
                            >
                               {attr.inherited && (
                                <div className="absolute top-4 right-4 px-2 py-0.5 bg-blue-50 text-[#004ac6] text-[90%] font-bold rounded-lg border border-blue-100">Herdado</div>
                              )}
                              
                              <div className="flex items-center gap-2 mb-4">
                                 <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest">{attr.label}</label>
                                 {isAI && <span className="inline-flex items-center gap-1 text-[10px] font-bold text-purple-600 bg-purple-100 px-2 py-0.5 rounded-full"><Sparkles className="w-2.5 h-2.5" /> SUGESTÃO</span>}
                              </div>

                              <input 
                                type="text" 
                                value={value as string} 
                                onChange={(e) => handleAttributeChange(attr.key, e.target.value)}
                                className={cn(
                                  "w-full px-4 py-2.5 rounded-xl border outline-none transition-all text-slate-900 font-medium",
                                  isAI 
                                    ? "bg-white border-purple-200 focus:ring-2 focus:ring-purple-400" 
                                    : "bg-slate-50 border-slate-200 focus:bg-white focus:ring-2 focus:ring-blue-500"
                                )}
                                placeholder={`Definir ${attr.label.toLowerCase()}...`}
                              />

                              {isAI && (
                                <div className="mt-4 flex items-center justify-between pt-4 border-t border-purple-100">
                                  <button onClick={() => handleAttributeChange(attr.key, '')} className="text-xs font-bold text-slate-400 hover:text-red-500 transition-colors uppercase">Rejeitar</button>
                                  <button 
                                    onClick={() => setEditedProduct(p => ({...p, attributes: {...p.attributes, [attr.key]: {...valObj, confirmed: true}}}))} 
                                    className="flex items-center gap-1.5 text-xs font-bold text-purple-600 bg-white px-3 py-1.5 rounded-lg border border-purple-200 shadow-sm hover:bg-purple-600 hover:text-white transition-all"
                                  >
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                    Confirmar
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })}

                        {/* Extra (Custom) Attributes */}
                        {extraAttributeKeys.map(key => {
                          const valObj = editedProduct.attributes![key];
                          return (
                            <div key={key} className="p-6 bg-blue-50/30 border border-blue-200 rounded-2xl relative group">
                               <div className="absolute top-4 right-4">
                                  <div className="px-2 py-0.5 bg-blue-600 text-white text-[9px] font-black rounded-lg shadow-sm uppercase tracking-tighter">EXTRA</div>
                               </div>
                               
                               <div className="mb-4">
                                  <label className="text-[11px] font-black text-blue-400 uppercase tracking-widest">{key.replace(/_/g, ' ')}</label>
                               </div>

                               <input 
                                type="text" 
                                value={valObj.value as string} 
                                onChange={(e) => handleAttributeChange(key, e.target.value)}
                                className="w-full px-4 py-2.5 bg-white border border-blue-100 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 font-medium"
                              />

                               <div className="mt-4 flex items-center justify-between pt-4 border-t border-blue-100">
                                  <button 
                                    onClick={() => {
                                      const next = { ...editedProduct.attributes };
                                      delete next[key];
                                      setEditedProduct(p => ({ ...p, attributes: next }));
                                    }} 
                                    className="text-xs font-bold text-red-400 hover:text-red-600 transition-colors uppercase"
                                  >
                                    Remover
                                  </button>
                                  {onCategoryUpdate && (
                                    <button 
                                      onClick={() => handleSyncToCategory({ key, label: key.replace(/_/g, ' '), type: 'text' })} 
                                      disabled={isSavingCategoryAttr === key}
                                      className="flex items-center gap-1.5 text-xs font-bold text-[#004ac6] hover:underline"
                                    >
                                      {isSavingCategoryAttr === key ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                                      Criar na Categoria
                                    </button>
                                  )}
                               </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* AI Suggestions Section */}
                      {suggestedAttributes.length > 0 && (
                        <section className="mt-12">
                           <div className="flex items-center gap-3 mb-6">
                              <h3 className="text-base font-bold text-slate-900">Novas Sugestões Detectadas</h3>
                              <div className="h-px flex-1 bg-slate-200"></div>
                           </div>
                           <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                              {suggestedAttributes.map((suggestion) => (
                                <div key={suggestion.key} className="p-6 bg-white border border-purple-200 rounded-3xl shadow-sm hover:shadow-md transition-all group flex items-center justify-between gap-6">
                                  <div className="flex-1">
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-purple-50 text-purple-600 text-[9px] font-black rounded-lg border border-purple-100 uppercase tracking-widest mb-2 shadow-sm">
                                       <Sparkles className="w-3 h-3" /> NOVO CAMPO
                                    </span>
                                    <h4 className="text-sm font-bold text-slate-900 mb-1">{suggestion.label}</h4>
                                    <p className="text-xs text-slate-500">Sugestão: <span className="text-slate-900 font-bold">{suggestion.value}</span></p>
                                  </div>
                                  
                                  <div className="flex flex-col gap-2">
                                     <button 
                                        onClick={() => {
                                          handleAttributeChange(suggestion.key, suggestion.value);
                                          setSuggestedAttributes(prev => prev.filter(s => s.key !== suggestion.key));
                                        }} 
                                        className="px-4 py-2 bg-purple-600 text-white text-xs font-bold rounded-xl hover:bg-purple-700 shadow-lg shadow-purple-100 transition-all active:scale-95"
                                      >
                                        Adicionar ao Produto
                                      </button>
                                      {onCategoryUpdate && (
                                        <button 
                                          onClick={async () => {
                                            await handleSyncToCategory(suggestion);
                                            handleAttributeChange(suggestion.key, suggestion.value);
                                            setSuggestedAttributes(prev => prev.filter(s => s.key !== suggestion.key));
                                          }} 
                                          disabled={isSavingCategoryAttr === suggestion.key}
                                          className="flex items-center justify-center gap-1 text-[10px] font-bold text-slate-400 hover:text-blue-600 transition-colors uppercase"
                                        >
                                          {isSavingCategoryAttr === suggestion.key ? <Loader2 className="w-3 h-3 animate-spin" /> : <Database className="w-3 h-3" />}
                                          Criar na Categoria
                                        </button>
                                      )}
                                  </div>
                                </div>
                              ))}
                           </div>
                        </section>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* Aba Técnico — desativada temporariamente
              {activeTab === 'tecnico' && (
                <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-300">
                   <section className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm">
                      <h2 className="text-lg font-bold text-slate-900 mb-8 flex items-center gap-2">
                        <Cpu className="w-5 h-5 text-blue-600" />
                        Logística e Identificação
                      </h2>
                      <div className="grid grid-cols-2 gap-8">
                        <div className="space-y-1.5">
                          <label className="text-xs font-bold text-slate-500 uppercase ml-1 tracking-wider">GTIN / EAN</label>
                          <input
                            type="text"
                            value={editedProduct['GTIN/EAN'] || ''}
                            onChange={(e) => setEditedProduct({...editedProduct, 'GTIN/EAN': e.target.value})}
                            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none font-mono"
                            placeholder="789..."
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-bold text-slate-500 uppercase ml-1 tracking-wider">NCM (Classificação fiscal)</label>
                          <input
                            type="text"
                            value={editedProduct['NCM (Classificação fiscal)'] || ''}
                            onChange={(e) => setEditedProduct({...editedProduct, 'NCM (Classificação fiscal)': e.target.value})}
                            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none font-mono text-sm"
                            placeholder="0000.00.00"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-bold text-slate-500 uppercase ml-1 tracking-wider">Peso Bruto (Kg)</label>
                          <input
                            type="number"
                            step="0.001"
                            value={editedProduct['Peso bruto (Kg)'] as string || ''}
                            onChange={(e) => setEditedProduct({...editedProduct, 'Peso bruto (Kg)': e.target.value})}
                            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none font-mono"
                          />
                        </div>
                      </div>
                   </section>
                </div>
              )}
              */}

              {activeTab === 'imagem' && (
                <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-300">
                  <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                    <h2 className="text-lg font-bold text-slate-900 mb-6 flex items-center gap-2">
                       <ImageIcon className="w-5 h-5 text-blue-600" />
                       Imagens & Ambientação (IA)
                    </h2>
                    
                    <div className="flex flex-col md:flex-row items-center md:items-start gap-6">
                      <div className="relative w-48 h-48 rounded-2xl overflow-hidden border border-slate-200 bg-slate-50 shrink-0 shadow-sm">
                         {editedProduct['URL imagem 1'] || editedProduct._selectedImage ? (
                            <img src={editedProduct._selectedImage || editedProduct['URL imagem 1']} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                          ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center text-slate-400">
                              <ImageIcon className="w-12 h-12 mb-2" />
                              <span className="text-xs font-bold uppercase tracking-wider">Sem Imagem</span>
                            </div>
                          )}
                      </div>
                      <div className="flex-1 space-y-4">
                        <div className="space-y-2">
                          <h3 className="text-base font-bold text-slate-800">Visual Mídia & Geração de Cenários</h3>
                          <p className="text-sm text-slate-500 leading-relaxed">
                            Utilize o Gemini 2.5 Flash para gerar 3 variações realistas a partir da imagem original:
                          </p>
                          <ul className="text-sm text-slate-600 list-disc list-inside ml-2 space-y-1">
                            <li>Produto ambientado num cenário real de e-commerce.</li>
                            <li>Pessoa utilizando o produto de forma natural.</li>
                            <li>Pessoa segurando o produto, dando noção de escala.</li>
                          </ul>
                        </div>
                        
                        {onOpenImageModal && (
                            <div className="pt-4">
                              <button 
                                type="button"
                                onClick={onOpenImageModal}
                                className="px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl text-sm font-bold transition-all shadow-md hover:shadow-lg hover:-translate-y-0.5 flex items-center gap-2 active:scale-95"
                              >
                                <Sparkles className="w-4 h-4" />
                                Gerar Imagens com IA
                              </button>
                            </div>
                        )}
                      </div>
                    </div>
                  </section>

                  {editedProduct._ambientImages && editedProduct._ambientImages.length > 0 && (
                    <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                      <h3 className="text-lg font-bold text-slate-900 mb-6 flex items-center gap-2">
                        <Sparkles className="w-5 h-5 text-purple-600" />
                        Ambientações Geradas
                      </h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
                        {editedProduct._ambientImages.map((img, idx) => (
                          <div key={idx} className="flex flex-col gap-3 group">
                            <div className="relative aspect-square rounded-xl overflow-hidden border border-slate-200 shadow-sm group-hover:shadow-md transition-shadow">
                              <img 
                                src={img} 
                                alt={`Ambientação ${idx + 1}`} 
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" 
                                referrerPolicy="no-referrer"
                              />
                              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center">
                                <a 
                                  href={img} 
                                  download={`ambientacao_${idx + 1}.jpg`} 
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="px-4 py-2 bg-white text-slate-900 font-bold text-xs rounded-xl shadow-lg transform translate-y-2 group-hover:translate-y-0 transition-all duration-300 flex items-center gap-2"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  Baixar Imagem
                                </a>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}
                </div>
              )}

              {activeTab === 'ia' && (
                <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-300 pb-20">
                   <header className="bg-slate-900 p-8 rounded-3xl shadow-xl flex items-center justify-between gap-8 mb-10">
                      <div className="flex-1">
                         <div className="flex items-center gap-3 mb-2">
                            <div className="p-2 bg-blue-500 rounded-xl">
                               <Wand2 className="w-5 h-5 text-white" />
                            </div>
                            <h2 className="text-xl font-bold text-white tracking-tight">Escritor Criativo IA</h2>
                         </div>
                         <p className="text-slate-400 text-sm max-w-lg leading-relaxed">
                            Gere descrições ricas, otimizadas para conversão e SEO (Search Engine Optimization) com um clique.
                         </p>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        {templates.length > 1 && (
                          <div className="flex flex-col items-end gap-1">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Template</label>
                            <select
                              value={chosenTemplateId}
                              onChange={(e) => setChosenTemplateId(e.target.value)}
                              disabled={isGeneratingIA}
                              className="bg-slate-800 text-slate-200 text-xs font-medium rounded-lg px-3 py-2 border border-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                            >
                              {templates.map(t => (
                                <option key={t.id} value={t.id}>{t.name}</option>
                              ))}
                            </select>
                          </div>
                        )}
                        <button
                          onClick={handleGenerateIA}
                          disabled={isGeneratingIA}
                          className={cn(
                            hasGeneratedContent
                              ? "px-4 py-2 bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-300 rounded-xl shadow-md"
                              : "px-8 py-4 bg-blue-600 text-white rounded-2xl font-bold hover:bg-blue-700 shadow-lg shadow-blue-900/20 text-sm",
                            "transition-all flex items-center gap-2 active:scale-95 disabled:opacity-50"
                          )}
                        >
                          {isGeneratingIA ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                          {hasGeneratedContent ? "Gerar Conteúdo novamente" : "Gerar Conteúdo Premium"}
                        </button>
                      </div>
                   </header>

                   <div className="grid grid-cols-1 gap-10">
                      <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm">
                        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
                          <label className="text-sm font-black text-slate-900 uppercase tracking-widest flex items-center gap-2">
                             <Layout className="w-4 h-4 text-blue-600" />
                             Descrição Comercial (HTML)
                          </label>
                          {reusableArticles.length > 0 && (
                            <select
                              defaultValue=""
                              onChange={(e) => { if (e.target.value) { insertArticle(e.target.value); e.target.value = ''; } }}
                              className="text-xs font-medium text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
                              title="Inserir um artigo da Agência de Conteúdo"
                            >
                              <option value="">+ Inserir artigo do Alfred…</option>
                              {reusableArticles.map((a) => (
                                <option key={a.id} value={a.id}>{a.titulo}</option>
                              ))}
                            </select>
                          )}
                        </div>
                        <WYSIWYGEditor
                          value={editedProduct['Descrição complementar'] || ''} 
                          onChange={(val) => setEditedProduct({...editedProduct, 'Descrição complementar': val})} 
                        />
                      </div>

                      <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm space-y-8">
                         <h3 className="text-base font-bold text-slate-900 border-b border-slate-100 pb-4 flex items-center gap-2">
                            <Settings className="w-5 h-5 text-slate-400" />
                            Configurações de SEO
                         </h3>
                         
                         <div className="grid grid-cols-1 gap-6">
                            <div className="space-y-1.5">
                              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Meta Title</label>
                              <input 
                                type="text" 
                                value={editedProduct['Título SEO'] || ''} 
                                onChange={(e) => setEditedProduct({...editedProduct, 'Título SEO': e.target.value})} 
                                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none" 
                              />
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Meta Description</label>
                              <textarea 
                                rows={3}
                                value={editedProduct['Descrição SEO'] || ''} 
                                onChange={(e) => setEditedProduct({...editedProduct, 'Descrição SEO': e.target.value})} 
                                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none resize-none" 
                              />
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Palavras-chave (separadas por vírgula)</label>
                              <input 
                                type="text" 
                                value={editedProduct['Palavras chave SEO'] || ''} 
                                onChange={(e) => setEditedProduct({...editedProduct, 'Palavras chave SEO': e.target.value})} 
                                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none" 
                              />
                            </div>
                         </div>
                      </div>
                   </div>
                </div>
              )}

              {activeTab === 'simular' && (() => {
                const galleryImages = [
                  editedProduct._selectedImage,
                  editedProduct['URL imagem 1'],
                  editedProduct['URL imagem 2'],
                  editedProduct['URL imagem 3'],
                  editedProduct['URL imagem 4'],
                  editedProduct['URL imagem 5'],
                  editedProduct['URL imagem 6'],
                  ...(editedProduct._ambientImages || []),
                ].filter((v, i, arr) => v && arr.indexOf(v) === i) as string[];

                const priceNumber = Number(String(editedProduct['Preço'] ?? '').toString().replace(',', '.'));
                const priceLabel = isFinite(priceNumber) && priceNumber > 0
                  ? priceNumber.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
                  : (editedProduct['Preço'] ? `R$ ${editedProduct['Preço']}` : '—');

                const filledAttributes = effectiveAttributes
                  .map(attr => {
                    const raw = editedProduct.attributes?.[attr.key]?.value;
                    const value = Array.isArray(raw) ? raw.join(', ') : (raw || '');
                    return { label: attr.label, value };
                  })
                  .filter(a => a.value);

                return (
                <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-300 pb-20">
                  <style>{`
                    .sim-desc h2 { font-size: 1.25rem; font-weight: 700; margin: 1rem 0 0.5rem 0; color: #0f172a; }
                    .sim-desc h3 { font-size: 1.1rem; font-weight: 700; margin: 0.75rem 0 0.5rem 0; color: #1e293b; }
                    .sim-desc p { margin-bottom: 0.75rem; line-height: 1.7; color: #334155; }
                    .sim-desc ul { list-style-type: disc; padding-left: 1.5rem; margin: 0.5rem 0; }
                    .sim-desc ol { list-style-type: decimal; padding-left: 1.5rem; margin: 0.5rem 0; }
                    .sim-desc li { margin-bottom: 0.25rem; color: #334155; }
                    .sim-desc strong, .sim-desc b { font-weight: 700; }
                    .sim-desc em, .sim-desc i { font-style: italic; }
                    .sim-desc u { text-decoration: underline; }
                  `}</style>

                  <div className="flex items-center gap-2 text-[11px] font-bold text-slate-400 uppercase tracking-widest">
                    <Eye className="w-4 h-4" />
                    Pré-visualização (somente leitura) — como aparece em um e-commerce
                  </div>

                  <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 p-6 md:p-10">
                      {/* Galeria */}
                      <div>
                        <div className="aspect-square w-full rounded-2xl border border-slate-100 bg-slate-50 overflow-hidden flex items-center justify-center">
                          {galleryImages[0] ? (
                            <img src={galleryImages[0]} alt={editedProduct['Descrição'] || ''} className="w-full h-full object-contain" referrerPolicy="no-referrer" />
                          ) : (
                            <ImageIcon className="w-16 h-16 text-slate-300" />
                          )}
                        </div>
                        {galleryImages.length > 1 && (
                          <div className="flex gap-2 mt-3 flex-wrap">
                            {galleryImages.slice(0, 6).map((img, idx) => (
                              <div key={idx} className="w-16 h-16 rounded-lg border border-slate-200 bg-white overflow-hidden shrink-0">
                                <img src={img} alt="" className="w-full h-full object-contain" referrerPolicy="no-referrer" />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Info */}
                      <div className="flex flex-col">
                        {editedProduct['Marca'] && (
                          <span className="text-xs font-bold text-blue-600 uppercase tracking-widest mb-2">{editedProduct['Marca']}</span>
                        )}
                        <h1 className="font-display text-2xl md:text-3xl font-bold text-slate-900 leading-tight">
                          {editedProduct['Descrição'] || 'Produto Sem Nome'}
                        </h1>
                        {editedProduct['Categoria'] && (
                          <p className="text-xs text-slate-400 mt-1">{editedProduct['Categoria']}</p>
                        )}
                        <div className="mt-5 text-3xl font-black text-slate-900">{priceLabel}</div>

                        {filledAttributes.length > 0 && (
                          <div className="mt-6 border-t border-slate-100 pt-5">
                            <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Especificações</h3>
                            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
                              {filledAttributes.map(a => (
                                <div key={a.label} className="flex justify-between gap-3 text-sm border-b border-dashed border-slate-100 py-1">
                                  <dt className="text-slate-500">{a.label}</dt>
                                  <dd className="font-semibold text-slate-800 text-right">{a.value}</dd>
                                </div>
                              ))}
                            </dl>
                          </div>
                        )}

                        <button
                          disabled
                          className="mt-8 w-full sm:w-auto px-8 py-3.5 bg-[#004ac6] text-white font-bold rounded-xl shadow-lg shadow-blue-200 opacity-90 cursor-default flex items-center justify-center gap-2"
                        >
                          Comprar agora
                        </button>
                      </div>
                    </div>

                    {/* Descrição */}
                    <div className="border-t border-slate-100 p-6 md:p-10">
                      <h3 className="text-base font-bold text-slate-900 mb-4">Descrição do Produto</h3>
                      {editedProduct['Descrição complementar'] ? (
                        <div
                          className="sim-desc max-w-none"
                          dangerouslySetInnerHTML={{ __html: editedProduct['Descrição complementar'] }}
                        />
                      ) : (
                        <p className="text-sm text-slate-400 italic">Nenhuma descrição gerada ainda. Gere o conteúdo na aba "Conteúdo".</p>
                      )}
                    </div>

                    {/* SEO Preview */}
                    {(editedProduct['Título SEO'] || editedProduct['Descrição SEO']) && (
                      <div className="border-t border-slate-100 p-6 md:p-10 bg-slate-50/50">
                        <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Pré-visualização na Busca</h3>
                        <div className="max-w-xl">
                          <div className="text-[#1a0dab] text-lg leading-tight truncate">{editedProduct['Título SEO'] || editedProduct['Descrição']}</div>
                          <div className="text-[#006621] text-xs mt-0.5">www.sualoja.com.br › {editedProduct['Slug'] || (editedProduct['Descrição'] || '').toLowerCase().replace(/\s+/g, '-').slice(0, 40)}</div>
                          <div className="text-sm text-slate-600 mt-1 line-clamp-2">{editedProduct['Descrição SEO']}</div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                );
              })()}

           </div>
        </main>
      </div>

      {showConfirmClose && (
        <div className="fixed inset-0 z-[200] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 min-h-screen">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0">
                <AlertCircle className="w-5 h-5 text-red-600" />
              </div>
              <h3 className="text-lg font-bold text-slate-900">Descartar alterações?</h3>
            </div>
            <p className="text-sm text-slate-500 mb-6 leading-relaxed">
              Você tem modificações não salvas neste produto. Se você sair agora, todas as alterações serão perdidas e não poderão ser recuperadas.
            </p>
            <div className="flex justify-end gap-3">
              <button 
                onClick={() => setShowConfirmClose(false)}
                className="px-4 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
              >
                Cancelar
              </button>
              <button 
                onClick={onClose}
                className="px-4 py-2.5 bg-red-600 text-white text-sm font-bold rounded-xl shadow-md hover:bg-red-700 transition-colors"
              >
                Descartar e Sair
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
