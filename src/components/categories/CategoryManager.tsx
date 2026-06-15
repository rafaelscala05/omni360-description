import React, { useState, useEffect } from 'react';
import { Category, AttributeDefinition } from '../../types/models';
import { fetchCategories, saveCategory, getEffectiveAttributes, getEffectiveImagePrompts } from '../../services/categoryService';
import { Plus, Edit, Trash2, Tag, Save, ArrowLeft, Loader2, Sparkles, Folder, Image } from 'lucide-react';
import { auth } from '../../firebase';

export default function CategoryManager({ onClose }: { onClose: () => void }) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Category>>({});

  // Image prompts card state (independent from main edit form)
  const [isEditingPrompts, setIsEditingPrompts] = useState(false);
  const [isSavingPrompts, setIsSavingPrompts] = useState(false);
  const [promptForm, setPromptForm] = useState<{
    inheritImagePrompts: boolean;
    imagePrompts: { scene1?: string; scene2?: string; scene3?: string };
  }>({ inheritImagePrompts: true, imagePrompts: {} });

  const imagePromptsEnabled = localStorage.getItem('enableCategoryImagePrompts') === 'true';

  useEffect(() => {
    loadCategories();
  }, []);

  const syncPromptForm = (cat: Category | null) => {
    if (!cat) return;
    setPromptForm({
      inheritImagePrompts: cat.inheritImagePrompts ?? true,
      imagePrompts: cat.imagePrompts ?? {},
    });
    setIsEditingPrompts(false);
  };

  const loadCategories = async () => {
    if (!auth.currentUser) return;
    setLoading(true);
    try {
      const cats = await fetchCategories(auth.currentUser.uid);
      setCategories(cats);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = (category: Category) => {
    setSelectedCategory(category);
    setIsEditing(false);
    setEditForm({});
    syncPromptForm(category);
  };

  const handleCreate = () => {
    setSelectedCategory(null);
    setIsEditing(true);
    setEditForm({
      name: '',
      slug: '',
      parentId: null,
      attributes: [],
      inheritParentAttributes: true,
      inheritImagePrompts: true,
      level: 0,
      path: [],
      pathIds: [],
    });
    setIsEditingPrompts(false);
  };

  const handleSave = async () => {
    if (!auth.currentUser || !editForm.name) return;
    setLoading(true);
    try {
      const parent = editForm.parentId ? categories.find(c => c.id === editForm.parentId) : null;
      let path = [editForm.name || ''];
      let pathIds: string[] = [];
      let level = 0;

      if (parent) {
        path = [...parent.path, editForm.name || ''];
        pathIds = parent.pathIds ? [...parent.pathIds] : [];
        if (parent.id && !pathIds.includes(parent.id)) {
          pathIds.push(parent.id);
        }
        level = parent.level + 1;
      }

      await saveCategory(auth.currentUser.uid, {
        name: editForm.name || '',
        slug: editForm.slug || editForm.name?.toLowerCase().replace(/[^a-z0-9]+/g, '-') || '',
        parentId: editForm.parentId || null,
        level,
        path,
        pathIds,
        attributes: editForm.attributes || [],
        inheritParentAttributes: editForm.inheritParentAttributes ?? true,
        inheritImagePrompts: editForm.inheritImagePrompts ?? true,
        imagePrompts: editForm.imagePrompts,
        productCount: 0,
        aiGenerated: false,
      }, editForm.id);

      const cats = await fetchCategories(auth.currentUser.uid);
      setCategories(cats);

      if (editForm.id) {
        const updated = cats.find(c => c.id === editForm.id);
        if (updated) {
          setSelectedCategory(updated);
          syncPromptForm(updated);
        }
      }

      setIsEditing(false);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleSavePrompts = async () => {
    if (!auth.currentUser || !selectedCategory) return;
    setIsSavingPrompts(true);
    try {
      await saveCategory(auth.currentUser.uid, {
        ...selectedCategory,
        inheritImagePrompts: promptForm.inheritImagePrompts,
        imagePrompts: promptForm.imagePrompts,
      }, selectedCategory.id);

      const cats = await fetchCategories(auth.currentUser.uid);
      setCategories(cats);
      const updated = cats.find(c => c.id === selectedCategory.id);
      if (updated) setSelectedCategory(updated);
      setIsEditingPrompts(false);
    } catch (e) {
      console.error(e);
    } finally {
      setIsSavingPrompts(false);
    }
  };

  const rootCategories = categories.filter(c => !c.parentId);

  const renderTree = (cats: Category[], indent = 0) => {
    return cats.map(cat => (
      <div key={cat.id} className="flex flex-col">
        <div
          className={`flex items-center gap-2 p-2 rounded hover:bg-gray-100 cursor-pointer ${selectedCategory?.id === cat.id ? 'bg-blue-50 text-blue-600' : ''}`}
          style={{ paddingLeft: `${indent * 20 + 8}px` }}
          onClick={() => handleSelect(cat)}
        >
          <Folder className="w-4 h-4 text-gray-400" />
          <span className="font-medium text-sm">{cat.name}</span>
          {cat.attributes && cat.attributes.length > 0 && (
            <Tag className="w-3 h-3 text-emerald-500 ml-auto" />
          )}
        </div>
        {renderTree(categories.filter(c => c.parentId === cat.id), indent + 1)}
      </div>
    ));
  };

  const hasParent = selectedCategory?.parentId != null;
  const inheritedPrompts = selectedCategory?.parentId
    ? getEffectiveImagePrompts(selectedCategory.parentId, categories)
    : null;

  const SCENE_SLOTS = [
    { key: 'scene1' as const, label: 'Cena 1 — Produto Ambientado', placeholder: 'Ex: produto em escritório moderno com luz natural, mesa de madeira ao fundo', defaultText: 'produto em cenário realista e contextual para a categoria' },
    { key: 'scene2' as const, label: 'Cena 2 — Produto em Uso', placeholder: 'Ex: pessoa do público-alvo usando o produto em ambiente de trabalho', defaultText: 'pessoa do público-alvo usando o produto em situação cotidiana' },
    { key: 'scene3' as const, label: 'Cena 3 — Escala e Tamanho', placeholder: 'Ex: mãos segurando o produto para mostrar tamanho real, fundo neutro', defaultText: 'mãos segurando o produto para referência de tamanho real' },
  ];

  return (
    <div className="flex flex-col h-full bg-white">
      <header className="px-4 md:px-6 py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between border-b border-slate-200 gap-3 shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500 transition-colors shrink-0">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="min-w-0">
            <h1 className="text-lg md:text-xl font-bold text-slate-900 tracking-tight truncate">Categoria & Atributos</h1>
            <p className="text-xs md:text-sm text-slate-500 mt-0.5 truncate">Organize sua hierarquia de categorias e atributos padrão</p>
          </div>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <button className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-3 py-2 bg-purple-50 text-purple-700 border border-purple-200 rounded-lg text-xs font-medium hover:bg-purple-100 transition-colors shadow-sm">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Sugestão IA</span>
          </button>
          <button onClick={handleCreate} className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-3 py-2 bg-[#004ac6] text-white rounded-lg text-xs font-semibold hover:bg-[#003ea8] transition-colors shadow-sm whitespace-nowrap">
            <Plus className="w-4 h-4" />
            <span>Nova Categoria</span>
          </button>
        </div>
      </header>

      <div className="flex flex-col lg:flex-row flex-1 overflow-hidden min-h-0">
        {/* Sidebar Tree */}
        <div className="w-full lg:w-[300px] bg-slate-50 border-b lg:border-b-0 lg:border-r border-slate-200 overflow-y-auto p-4 shrink-0 max-h-[180px] lg:max-h-none">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">Hierarquia</h2>
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : rootCategories.length === 0 ? (
            <div className="text-center py-10 text-sm text-gray-500">
              Nenhuma categoria criada.
            </div>
          ) : (
            <div className="space-y-1">
              {renderTree(rootCategories)}
            </div>
          )}
        </div>

        {/* Main Panel */}
        <div className="flex-1 p-4 md:p-6 overflow-y-auto bg-gray-50">
          {(isEditing || selectedCategory) ? (
            <div className="flex flex-col xl:flex-row gap-4 items-start">

              {/* ── Category card ── */}
              <div className="w-full xl:flex-1 border border-gray-200 rounded-xl bg-white shadow-sm overflow-hidden">
                <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                  <h3 className="text-lg font-bold text-gray-900">
                    {isEditing ? (editForm.id ? 'Editar Categoria' : 'Nova Categoria') : selectedCategory?.name}
                  </h3>
                  {!isEditing && (
                    <button
                      onClick={() => {
                        setEditForm(selectedCategory || {});
                        setIsEditing(true);
                      }}
                      className="flex items-center gap-2 px-3 py-1.5 text-blue-600 bg-blue-50 border border-blue-100 rounded-lg hover:bg-blue-100"
                    >
                      <Edit className="w-4 h-4" />
                      <span className="text-sm font-bold">Editar</span>
                    </button>
                  )}
                </div>

                <div className="p-6 space-y-6">
                  {isEditing ? (
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Nome da Categoria</label>
                        <input
                          type="text"
                          value={editForm.name || ''}
                          onChange={(e) => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Categoria Pai</label>
                        <select
                          value={editForm.parentId || ''}
                          onChange={(e) => setEditForm(prev => ({ ...prev, parentId: e.target.value || null }))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                        >
                          <option value="">-- Nenhuma (Raiz) --</option>
                          {categories.filter(c => c.id !== editForm.id).map(c => (
                            <option key={c.id} value={c.id}>{c.path.join(' > ')}</option>
                          ))}
                        </select>
                      </div>

                      <div className="flex items-center gap-2 mt-4">
                        <input
                          type="checkbox"
                          id="inherit"
                          checked={editForm.inheritParentAttributes ?? true}
                          onChange={(e) => setEditForm(prev => ({ ...prev, inheritParentAttributes: e.target.checked }))}
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <label htmlFor="inherit" className="text-sm text-gray-700">
                          Herdar atributos da categoria pai
                        </label>
                      </div>

                      <div className="pt-4 border-t border-gray-200 mt-6">
                        <div className="flex items-center justify-between mb-4">
                          <h4 className="text-sm font-bold text-gray-900">Atributos da Categoria</h4>
                          <button
                            onClick={() => {
                              const newAttr: AttributeDefinition = {
                                id: `attr_${Date.now()}`,
                                key: '',
                                label: '',
                                type: 'text',
                                options: [],
                                required: false,
                                order: (editForm.attributes?.length || 0) + 1,
                                aiSuggested: false,
                                createdAt: new Date().toISOString()
                              };
                              setEditForm(prev => ({ ...prev, attributes: [...(prev.attributes || []), newAttr] }));
                            }}
                            className="flex items-center gap-1 text-xs font-bold text-blue-600 hover:text-blue-700"
                          >
                            <Plus className="w-3 h-3" />
                            Adicionar Atributo
                          </button>
                        </div>

                        <div className="space-y-3">
                          {editForm.attributes?.map((attr, idx) => (
                            <div key={attr.id} className="p-4 bg-gray-50 border border-gray-200 rounded-lg space-y-3">
                              <div className="flex gap-3">
                                <div className="flex-1">
                                  <label className="block text-xs font-medium text-gray-500 mb-1">Nome/Chave</label>
                                  <input
                                    type="text"
                                    value={attr.key}
                                    placeholder="Ex: Cor"
                                    onChange={(e) => {
                                      const newAttrs = [...(editForm.attributes || [])];
                                      newAttrs[idx].key = e.target.value;
                                      newAttrs[idx].label = e.target.value;
                                      setEditForm(prev => ({ ...prev, attributes: newAttrs }));
                                    }}
                                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded shadow-sm"
                                  />
                                </div>
                                <div className="w-32">
                                  <label className="block text-xs font-medium text-gray-500 mb-1">Tipo</label>
                                  <select
                                    value={attr.type}
                                    onChange={(e) => {
                                      const newAttrs = [...(editForm.attributes || [])];
                                      newAttrs[idx].type = e.target.value as any;
                                      setEditForm(prev => ({ ...prev, attributes: newAttrs }));
                                    }}
                                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded shadow-sm"
                                  >
                                    <option value="text">Texto</option>
                                    <option value="select">Lista (1)</option>
                                    <option value="multiselect">Múltipla</option>
                                    <option value="checkbox">Checkbox</option>
                                    <option value="number">Número</option>
                                    <option value="boolean">Sim/Não</option>
                                  </select>
                                </div>
                                <div className="flex items-end pb-1">
                                  <button
                                    onClick={() => {
                                      const newAttrs = editForm.attributes?.filter(a => a.id !== attr.id);
                                      setEditForm(prev => ({ ...prev, attributes: newAttrs }));
                                    }}
                                    className="p-1.5 text-red-500 hover:bg-red-50 rounded"
                                    title="Remover atributo"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              </div>

                              {(attr.type === 'select' || attr.type === 'multiselect' || attr.type === 'checkbox') && (
                                <div>
                                  <label className="block text-xs font-medium text-gray-500 mb-1">Opções (separadas por vírgula)</label>
                                  <input
                                    type="text"
                                    value={attr.options.join(', ')}
                                    placeholder="Ex: Azul, Verde, Vermelho"
                                    onChange={(e) => {
                                      const newAttrs = [...(editForm.attributes || [])];
                                      newAttrs[idx].options = e.target.value.split(',').map(o => o.trim()).filter(Boolean);
                                      setEditForm(prev => ({ ...prev, attributes: newAttrs }));
                                    }}
                                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded shadow-sm"
                                  />
                                </div>
                              )}

                              <label className="flex items-center gap-2 mt-2">
                                <input
                                  type="checkbox"
                                  checked={attr.required}
                                  onChange={(e) => {
                                    const newAttrs = [...(editForm.attributes || [])];
                                    newAttrs[idx].required = e.target.checked;
                                    setEditForm(prev => ({ ...prev, attributes: newAttrs }));
                                  }}
                                  className="rounded border-gray-300"
                                />
                                <span className="text-xs text-gray-700 font-medium">Requerido</span>
                              </label>
                            </div>
                          ))}
                          {(!editForm.attributes || editForm.attributes.length === 0) && (
                            <div className="text-center p-4 border border-dashed rounded-lg text-sm text-gray-500">
                              Nenhum atributo próprio definido.
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="pt-6 flex justify-end gap-3">
                        <button
                          onClick={() => {
                            setIsEditing(false);
                            if (!selectedCategory) setEditForm({});
                          }}
                          className="px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg font-medium"
                        >
                          Cancelar
                        </button>
                        <button
                          onClick={handleSave}
                          className="flex items-center gap-2 px-4 py-2 text-white bg-blue-600 hover:bg-blue-700 rounded-lg font-bold"
                        >
                          <Save className="w-4 h-4" />
                          Salvar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-6">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <span className="block text-xs font-bold text-gray-500 uppercase">Slug</span>
                          <span className="text-sm text-gray-900">{selectedCategory?.slug}</span>
                        </div>
                        <div>
                          <span className="block text-xs font-bold text-gray-500 uppercase">Caminho</span>
                          <span className="text-sm text-gray-900">{selectedCategory?.path.join(' > ')}</span>
                        </div>
                      </div>

                      <div className="pt-4 border-t border-gray-100">
                        <h4 className="text-sm font-bold text-gray-900 mb-4 flex items-center justify-between">
                          Atributos Efetivos
                          <span className="text-xs font-normal text-gray-500">(Incluindo herdados)</span>
                        </h4>
                        {selectedCategory && (
                          <div className="space-y-2">
                            {getEffectiveAttributes(selectedCategory.id, categories).map((attr, idx) => (
                              <div key={idx} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200">
                                <div>
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium text-sm text-gray-900">{attr.label}</span>
                                    {attr.inherited && (
                                      <span className="px-1.5 py-0.5 rounded text-[10px] uppercase font-bold bg-purple-100 text-purple-700">
                                        Herdado
                                      </span>
                                    )}
                                  </div>
                                  <span className="text-xs text-gray-500">
                                    Tipo: {attr.type} {attr.required ? '(Obrigatório)' : ''}
                                    {attr.options && attr.options.length > 0 && ` • Opções: ${attr.options.join(', ')}`}
                                  </span>
                                </div>
                              </div>
                            ))}
                            {getEffectiveAttributes(selectedCategory.id, categories).length === 0 && (
                              <div className="text-sm text-gray-500 p-4 text-center border border-dashed rounded-lg">
                                Nenhum atributo definido.
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* ── Image Prompts card (right column, only when feature enabled and category selected) ── */}
              {imagePromptsEnabled && selectedCategory && (
                <div className="w-full xl:w-80 shrink-0 border border-purple-100 rounded-xl bg-white shadow-sm overflow-hidden">
                  <div className="px-5 py-4 border-b border-purple-100 bg-purple-50/40 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Image className="w-4 h-4 text-purple-500" />
                      <h4 className="text-sm font-bold text-gray-900">Prompts de Imagens</h4>
                    </div>
                    {!isEditingPrompts && (
                      <button
                        onClick={() => setIsEditingPrompts(true)}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 text-purple-600 bg-purple-50 border border-purple-200 rounded-lg hover:bg-purple-100 text-xs font-bold"
                      >
                        <Edit className="w-3.5 h-3.5" />
                        Editar
                      </button>
                    )}
                  </div>

                  <div className="p-5 space-y-4">
                    {/* Inherit toggle — only for child categories */}
                    {hasParent && (
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          id="promptInherit"
                          disabled={!isEditingPrompts}
                          checked={isEditingPrompts ? promptForm.inheritImagePrompts : (selectedCategory.inheritImagePrompts ?? true)}
                          onChange={(e) => setPromptForm(prev => ({ ...prev, inheritImagePrompts: e.target.checked }))}
                          className="rounded border-gray-300 text-purple-600 focus:ring-purple-500 disabled:opacity-60"
                        />
                        <label htmlFor="promptInherit" className="text-xs text-gray-700">
                          Herdar prompts de{' '}
                          <span className="font-semibold">
                            {categories.find(c => c.id === selectedCategory.parentId)?.name || 'categoria pai'}
                          </span>
                        </label>
                      </div>
                    )}

                    {/* Scene fields */}
                    {(() => {
                      const isInheriting = hasParent && (isEditingPrompts ? promptForm.inheritImagePrompts : (selectedCategory.inheritImagePrompts ?? true));
                      const displayPrompts = isInheriting ? inheritedPrompts : (isEditingPrompts ? promptForm.imagePrompts : selectedCategory.imagePrompts);

                      return SCENE_SLOTS.map(({ key, label, placeholder, defaultText }) => (
                        <div key={key}>
                          <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
                          <textarea
                            rows={2}
                            disabled={!isEditingPrompts || isInheriting}
                            value={isEditingPrompts && !isInheriting ? (promptForm.imagePrompts[key] || '') : (displayPrompts?.[key] || '')}
                            onChange={(e) => setPromptForm(prev => ({
                              ...prev,
                              imagePrompts: { ...prev.imagePrompts, [key]: e.target.value },
                            }))}
                            placeholder={isInheriting ? `Automático: ${defaultText}` : placeholder}
                            className={`w-full px-2.5 py-2 text-xs border rounded-lg resize-none transition-colors ${
                              isEditingPrompts && !isInheriting
                                ? 'border-purple-300 focus:ring-purple-500 focus:border-purple-500 bg-white'
                                : 'border-gray-200 bg-gray-50 text-gray-500'
                            }`}
                          />
                        </div>
                      ));
                    })()}

                    {isEditingPrompts && (
                      <>
                        {!(hasParent && promptForm.inheritImagePrompts) && (
                          <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                            ⚠️ Descreva apenas a cena. Iluminação, câmera e qualidade fotográfica são aplicados automaticamente.
                          </p>
                        )}
                        <div className="flex gap-2 pt-1">
                          <button
                            onClick={() => {
                              syncPromptForm(selectedCategory);
                            }}
                            disabled={isSavingPrompts}
                            className="flex-1 px-3 py-2 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg disabled:opacity-50"
                          >
                            Cancelar
                          </button>
                          <button
                            onClick={handleSavePrompts}
                            disabled={isSavingPrompts}
                            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 rounded-lg disabled:opacity-50"
                          >
                            {isSavingPrompts ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                            Salvar
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}

            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-gray-400">
              <Folder className="w-16 h-16 mb-4 text-gray-200" />
              <p className="text-lg font-medium text-gray-500">Selecione uma categoria para visualizar ou editar</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
