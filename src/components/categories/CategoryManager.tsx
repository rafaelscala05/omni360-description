import React, { useState, useEffect } from 'react';
import { avisar } from '../../services/avisos';
import { Category, AttributeDefinition } from '../../types/models';
import { fetchCategories, saveCategory, getEffectiveAttributes, getEffectiveImagePrompts } from '../../services/categoryService';
import { Plus, Edit, Trash2, Tag, Save, ArrowLeft, Loader2, Sparkles, Folder, Image } from 'lucide-react';
import { auth } from '../../firebase';

export default function CategoryManager({ onClose, semVoltar = false }: {
  onClose: () => void;
  /** Com agente a tela tem migalhas acima, que já levam de volta. */
  semVoltar?: boolean;
}) {
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
      avisar('Erro ao salvar categoria. Verifique o console para mais detalhes.');
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
          className={`flex items-center gap-2 p-2 rounded hover:bg-(--ag-fill-2) cursor-pointer ${selectedCategory?.id === cat.id ? 'bg-(--ag-accent-soft) text-(--ag-accent)' : ''}`}
          style={{ paddingLeft: `${indent * 20 + 8}px` }}
          onClick={() => handleSelect(cat)}
        >
          <Folder className="w-4 h-4 text-(--ag-text-3)" />
          <span className="font-medium text-sm">{cat.name}</span>
          {cat.attributes && cat.attributes.length > 0 && (
            <Tag className="w-3 h-3 text-(--ag-ok) ml-auto" />
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
    <div className="flex flex-col h-full">
      <header className="px-4 md:px-6 py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between border-b border-(--ag-hairline) gap-3 shrink-0">
        <div className="flex items-center gap-3">
          {!semVoltar && (
            <button onClick={onClose} className="p-1.5 hover:bg-(--ag-fill-2) rounded-lg text-(--ag-text-2) transition-colors shrink-0">
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}
          <div className="min-w-0">
            <h1 className="font-display text-[22px] md:text-[26px] font-semibold tracking-tight text-[var(--ag-text)] truncate">Categorias e atributos</h1>
            <p className="text-xs md:text-sm text-(--ag-text-2) mt-0.5 truncate">Organize sua hierarquia de categorias e atributos padrão</p>
          </div>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <button className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-3 py-2 bg-(--ag-violet-soft) text-(--ag-violet) border border-(--ag-violet-line) rounded-lg text-xs font-medium hover:bg-(--ag-violet-soft) transition-colors shadow-sm">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Sugestão IA</span>
          </button>
          <button onClick={handleCreate} className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-3 py-2 bg-(--ag-accent) text-white rounded-lg text-xs font-semibold hover:brightness-95 transition-colors shadow-sm whitespace-nowrap">
            <Plus className="w-4 h-4" />
            <span>Nova Categoria</span>
          </button>
        </div>
      </header>

      <div className="flex flex-col lg:flex-row flex-1 overflow-hidden min-h-0">
        {/* Sidebar Tree */}
        <div className="w-full lg:w-[300px] bg-(--ag-fill) border-b lg:border-b-0 lg:border-r border-(--ag-hairline) overflow-y-auto p-4 shrink-0 max-h-[180px] lg:max-h-none">
          <h2 className="text-xs font-bold text-(--ag-text-3) uppercase tracking-wider mb-4">Hierarquia</h2>
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-6 h-6 animate-spin text-(--ag-text-3)" />
            </div>
          ) : rootCategories.length === 0 ? (
            <div className="text-center py-10 text-sm text-(--ag-text-2)">
              Nenhuma categoria criada.
            </div>
          ) : (
            <div className="space-y-1">
              {renderTree(rootCategories)}
            </div>
          )}
        </div>

        {/* Main Panel */}
        <div className="flex-1 p-4 md:p-6 overflow-y-auto bg-(--ag-fill)">
          {(isEditing || selectedCategory) ? (
            <div className="flex flex-col xl:flex-row gap-4 items-start">

              {/* ── Category card ── */}
              <div className="w-full xl:flex-1 border border-(--ag-hairline) rounded-xl bg-(--ag-surface-solid) shadow-sm overflow-hidden">
                <div className="p-6 border-b border-(--ag-hairline) flex justify-between items-center bg-(--ag-fill)">
                  <h3 className="text-lg font-bold text-(--ag-text)">
                    {isEditing ? (editForm.id ? 'Editar Categoria' : 'Nova Categoria') : selectedCategory?.name}
                  </h3>
                  {!isEditing && (
                    <button
                      onClick={() => {
                        setEditForm(selectedCategory || {});
                        setIsEditing(true);
                      }}
                      className="flex items-center gap-2 px-3 py-1.5 text-(--ag-accent) bg-(--ag-accent-soft) border border-(--ag-accent-line) rounded-lg hover:bg-(--ag-accent-soft)"
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
                        <label className="block text-sm font-medium text-(--ag-text) mb-1">Nome da Categoria</label>
                        <input
                          type="text"
                          value={editForm.name || ''}
                          onChange={(e) => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                          className="w-full px-3 py-2 border border-(--ag-hairline-2) rounded-md shadow-sm focus:ring-(--ag-accent) focus:border-(--ag-accent)"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-(--ag-text) mb-1">Categoria Pai</label>
                        <select
                          value={editForm.parentId || ''}
                          onChange={(e) => setEditForm(prev => ({ ...prev, parentId: e.target.value || null }))}
                          className="w-full px-3 py-2 border border-(--ag-hairline-2) rounded-md shadow-sm focus:ring-(--ag-accent) focus:border-(--ag-accent)"
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
                          className="rounded border-(--ag-hairline-2) text-(--ag-accent) focus:ring-(--ag-accent)"
                        />
                        <label htmlFor="inherit" className="text-sm text-(--ag-text)">
                          Herdar atributos da categoria pai
                        </label>
                      </div>

                      <div className="pt-4 border-t border-(--ag-hairline) mt-6">
                        <div className="flex items-center justify-between mb-4">
                          <h4 className="text-sm font-bold text-(--ag-text)">Atributos da Categoria</h4>
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
                            className="flex items-center gap-1 text-xs font-bold text-(--ag-accent) hover:text-(--ag-accent)"
                          >
                            <Plus className="w-3 h-3" />
                            Adicionar Atributo
                          </button>
                        </div>

                        <div className="space-y-3">
                          {editForm.attributes?.map((attr, idx) => (
                            <div key={attr.id} className="p-4 bg-(--ag-fill) border border-(--ag-hairline) rounded-lg space-y-3">
                              <div className="flex gap-3">
                                <div className="flex-1">
                                  <label className="block text-xs font-medium text-(--ag-text-2) mb-1">Nome/Chave</label>
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
                                    className="w-full px-2 py-1.5 text-sm border border-(--ag-hairline-2) rounded shadow-sm"
                                  />
                                </div>
                                <div className="w-32">
                                  <label className="block text-xs font-medium text-(--ag-text-2) mb-1">Tipo</label>
                                  <select
                                    value={attr.type}
                                    onChange={(e) => {
                                      const newAttrs = [...(editForm.attributes || [])];
                                      newAttrs[idx].type = e.target.value as any;
                                      setEditForm(prev => ({ ...prev, attributes: newAttrs }));
                                    }}
                                    className="w-full px-2 py-1.5 text-sm border border-(--ag-hairline-2) rounded shadow-sm"
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
                                    className="p-1.5 text-(--ag-danger) hover:bg-(--ag-danger-soft) rounded"
                                    title="Remover atributo"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              </div>

                              {(attr.type === 'select' || attr.type === 'multiselect' || attr.type === 'checkbox') && (
                                <div>
                                  <label className="block text-xs font-medium text-(--ag-text-2) mb-1">Opções (separadas por vírgula)</label>
                                  <input
                                    type="text"
                                    value={attr.options.join(', ')}
                                    placeholder="Ex: Azul, Verde, Vermelho"
                                    onChange={(e) => {
                                      const newAttrs = [...(editForm.attributes || [])];
                                      newAttrs[idx].options = e.target.value.split(',').map(o => o.trim()).filter(Boolean);
                                      setEditForm(prev => ({ ...prev, attributes: newAttrs }));
                                    }}
                                    className="w-full px-2 py-1.5 text-sm border border-(--ag-hairline-2) rounded shadow-sm"
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
                                  className="rounded border-(--ag-hairline-2)"
                                />
                                <span className="text-xs text-(--ag-text) font-medium">Requerido</span>
                              </label>
                            </div>
                          ))}
                          {(!editForm.attributes || editForm.attributes.length === 0) && (
                            <div className="text-center p-4 border border-dashed rounded-lg text-sm text-(--ag-text-2)">
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
                          className="px-4 py-2 text-(--ag-text) bg-(--ag-fill-2) hover:bg-(--ag-fill-2) rounded-lg font-medium"
                        >
                          Cancelar
                        </button>
                        <button
                          onClick={handleSave}
                          className="flex items-center gap-2 px-4 py-2 text-white bg-(--ag-accent) hover:brightness-95 rounded-lg font-bold"
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
                          <span className="block text-xs font-bold text-(--ag-text-2) uppercase">Slug</span>
                          <span className="text-sm text-(--ag-text)">{selectedCategory?.slug}</span>
                        </div>
                        <div>
                          <span className="block text-xs font-bold text-(--ag-text-2) uppercase">Caminho</span>
                          <span className="text-sm text-(--ag-text)">{selectedCategory?.path.join(' > ')}</span>
                        </div>
                      </div>

                      <div className="pt-4 border-t border-(--ag-hairline)">
                        <h4 className="text-sm font-bold text-(--ag-text) mb-4 flex items-center justify-between">
                          Atributos Efetivos
                          <span className="text-xs font-normal text-(--ag-text-2)">(Incluindo herdados)</span>
                        </h4>
                        {selectedCategory && (
                          <div className="space-y-2">
                            {getEffectiveAttributes(selectedCategory.id, categories).map((attr, idx) => (
                              <div key={idx} className="flex items-center justify-between p-3 bg-(--ag-fill) rounded-lg border border-(--ag-hairline)">
                                <div>
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium text-sm text-(--ag-text)">{attr.label}</span>
                                    {attr.inherited && (
                                      <span className="px-1.5 py-0.5 rounded text-[10px] uppercase font-bold bg-(--ag-violet-soft) text-(--ag-violet)">
                                        Herdado
                                      </span>
                                    )}
                                  </div>
                                  <span className="text-xs text-(--ag-text-2)">
                                    Tipo: {attr.type} {attr.required ? '(Obrigatório)' : ''}
                                    {attr.options && attr.options.length > 0 && ` • Opções: ${attr.options.join(', ')}`}
                                  </span>
                                </div>
                              </div>
                            ))}
                            {getEffectiveAttributes(selectedCategory.id, categories).length === 0 && (
                              <div className="text-sm text-(--ag-text-2) p-4 text-center border border-dashed rounded-lg">
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
                <div className="w-full xl:w-80 shrink-0 border border-(--ag-violet-line) rounded-xl bg-(--ag-surface-solid) shadow-sm overflow-hidden">
                  <div className="px-5 py-4 border-b border-(--ag-violet-line) bg-(--ag-violet-soft) flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Image className="w-4 h-4 text-(--ag-violet)" />
                      <h4 className="text-sm font-bold text-(--ag-text)">Prompts de Imagens</h4>
                    </div>
                    {!isEditingPrompts && (
                      <button
                        onClick={() => setIsEditingPrompts(true)}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 text-(--ag-violet) bg-(--ag-violet-soft) border border-(--ag-violet-line) rounded-lg hover:bg-(--ag-violet-soft) text-xs font-bold"
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
                          className="rounded border-(--ag-hairline-2) text-(--ag-violet) focus:ring-(--ag-violet) disabled:opacity-60"
                        />
                        <label htmlFor="promptInherit" className="text-xs text-(--ag-text)">
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
                          <label className="block text-xs font-medium text-(--ag-text-2) mb-1">{label}</label>
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
                                ? 'border-(--ag-violet-line) focus:ring-(--ag-violet) focus:border-(--ag-violet) bg-(--ag-surface-solid)'
                                : 'border-(--ag-hairline) bg-(--ag-fill) text-(--ag-text-2)'
                            }`}
                          />
                        </div>
                      ));
                    })()}

                    {isEditingPrompts && (
                      <>
                        {!(hasParent && promptForm.inheritImagePrompts) && (
                          <p className="text-xs text-(--ag-warn) bg-(--ag-warn-soft) border border-(--ag-warn-line) rounded-lg p-2.5">
                            ⚠️ Descreva apenas a cena. Iluminação, câmera e qualidade fotográfica são aplicados automaticamente.
                          </p>
                        )}
                        <div className="flex gap-2 pt-1">
                          <button
                            onClick={() => {
                              syncPromptForm(selectedCategory);
                            }}
                            disabled={isSavingPrompts}
                            className="flex-1 px-3 py-2 text-xs font-medium text-(--ag-text) bg-(--ag-fill-2) hover:bg-(--ag-fill-2) rounded-lg disabled:opacity-50"
                          >
                            Cancelar
                          </button>
                          <button
                            onClick={handleSavePrompts}
                            disabled={isSavingPrompts}
                            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-bold text-white bg-(--ag-violet) hover:brightness-95 rounded-lg disabled:opacity-50"
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
            <div className="h-full flex flex-col items-center justify-center text-(--ag-text-3)">
              <Folder className="w-16 h-16 mb-4 text-(--ag-text-3)" />
              <p className="text-lg font-medium text-(--ag-text-2)">Selecione uma categoria para visualizar ou editar</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
