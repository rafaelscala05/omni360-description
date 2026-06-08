import React, { useState } from 'react';
import { Category } from '../../types/models';
import { Sparkles, Check, ChevronRight, Loader2, X } from 'lucide-react';

interface CategoryImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  foundCategories: string[];
  existingCategories: Category[];
  onConfirm: (selectedNewCategories: string[], aiEnrichmentEnabled: boolean) => Promise<void>;
  isProcessing: boolean;
}

export default function CategoryImportModal({
  isOpen,
  onClose,
  foundCategories,
  existingCategories,
  onConfirm,
  isProcessing
}: CategoryImportModalProps) {
  
  const existingNames = existingCategories.map(c => c.name.toLowerCase());
  
  const newCategories = foundCategories.filter(c => !existingNames.includes(c.toLowerCase()));
  const existingFound = foundCategories.filter(c => existingNames.includes(c.toLowerCase()));

  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set(newCategories));
  const [aiEnrichmentEnabled, setAiEnrichmentEnabled] = useState(false);

  const toggleCategory = (cat: string) => {
    const next = new Set(selectedCategories);
    if (next.has(cat)) next.delete(cat);
    else next.add(cat);
    setSelectedCategories(next);
  };

  const handleConfirm = () => {
    onConfirm(Array.from(selectedCategories), aiEnrichmentEnabled);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full flex flex-col max-h-[90vh]">
        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50 rounded-t-2xl">
          <h2 className="text-xl font-bold text-gray-900">Revisão de Categorias</h2>
          {!isProcessing && (
            <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-full text-gray-500">
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        <div className="p-6 flex-1 overflow-y-auto space-y-6">
          <p className="text-sm text-gray-600">
            Foram encontradas <span className="font-bold">{foundCategories.length}</span> categorias únicas na planilha.
          </p>

          <div className="space-y-4">
            <h3 className="text-sm font-bold text-gray-900 border-b pb-2 flex items-center justify-between">
              Novas categorias detectadas ({newCategories.length})
              <span className="text-xs font-normal text-gray-500">Crie ou ignore</span>
            </h3>
            
            {newCategories.length === 0 ? (
              <div className="text-sm text-gray-500 italic p-3 bg-gray-50 rounded-lg">
                Nenhuma categoria nova encontrada na planilha.
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto p-2 border border-blue-50 bg-blue-50/30 rounded-xl">
                {newCategories.map(cat => (
                  <label key={cat} className="flex items-center gap-2 p-2 hover:bg-blue-50 cursor-pointer rounded-lg border border-transparent hover:border-blue-100 transition-colors">
                    <input 
                      type="checkbox" 
                      checked={selectedCategories.has(cat)} 
                      onChange={() => toggleCategory(cat)}
                      disabled={isProcessing}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm font-medium text-gray-800 truncate" title={cat}>{cat}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-bold text-gray-900 border-b pb-2">
              Categorias já cadastradas ({existingFound.length})
            </h3>
            
            {existingFound.length === 0 ? (
              <div className="text-sm text-gray-500 italic p-3 bg-gray-50 rounded-lg">
                Nenhuma categoria existente referenciada.
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {existingFound.map(cat => (
                  <span key={cat} className="px-2.5 py-1 bg-green-50 text-green-700 text-xs font-bold rounded-lg border border-green-200 flex items-center gap-1">
                    <Check className="w-3 h-3" />
                    {cat}
                  </span>
                ))}
              </div>
            )}
          </div>

          {newCategories.length > 0 && (
            <div className="bg-purple-50 border border-purple-100 rounded-xl p-4 flex items-start gap-3">
              <Sparkles className="w-5 h-5 text-purple-600 shrink-0 mt-0.5" />
              <div>
                <h4 className="text-sm font-bold text-purple-900">Gerar hierarquia com IA</h4>
                <p className="text-xs text-purple-700 mt-1 mb-3 text-balance">
                  Deseja que a IA analise as novas categorias e organize-as em uma estrutura pai/filho lógica? 
                  (Custo de 1 crédito a cada lote concluído)
                </p>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={aiEnrichmentEnabled} 
                    onChange={e => setAiEnrichmentEnabled(e.target.checked)}
                    disabled={isProcessing}
                    className="rounded border-purple-300 text-purple-600 focus:ring-purple-500"
                  />
                  <span className="text-sm font-bold text-purple-800">Sim, organizar automaticamente com IA</span>
                </label>
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 rounded-b-2xl flex justify-end gap-3">
          <button 
            onClick={onClose}
            disabled={isProcessing}
            className="px-4 py-2 text-gray-700 font-bold bg-white border border-gray-300 rounded-lg shadow-sm hover:bg-gray-50 disabled:opacity-50"
          >
            Cancelar Importação
          </button>
          <button 
            onClick={handleConfirm}
            disabled={isProcessing}
            className="flex items-center gap-2 px-5 py-2 text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-md font-bold disabled:opacity-50 transition-colors"
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Processando...
              </>
            ) : (
              <>
                Confirmar Importação
                <ChevronRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
