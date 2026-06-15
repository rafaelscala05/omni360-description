import { collection, doc, writeBatch, getDocs, getDoc, setDoc, query, where, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { Category, AttributeDefinition } from '../types/models';
import { generateJson } from './aiService';

export const getCategoriesPath = (uid: string) => `users/${uid}/categories`;

export const fetchCategories = async (uid: string): Promise<Category[]> => {
  if (!uid) return [];
  const q = collection(db, getCategoriesPath(uid));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Category));
};

export const saveCategory = async (uid: string, category: Omit<Category, 'id' | 'createdAt' | 'updatedAt'>, id?: string) => {
  const categoryRef = id ? doc(db, getCategoriesPath(uid), id) : doc(collection(db, getCategoriesPath(uid)));
  
  const now = new Date().toISOString();
  const dataToSave = {
    ...category,
    id: categoryRef.id,
    pathIds: category.pathIds.includes(categoryRef.id) ? category.pathIds : [...category.pathIds, categoryRef.id],
    updatedAt: now,
  };

  if (!id) {
    (dataToSave as any).createdAt = now;
  }

  await setDoc(categoryRef, dataToSave, { merge: true });
  return dataToSave as Category;
};

export const addAttributeToCategory = async (uid: string, categoryId: string, allCategories: Category[], newAttribute: AttributeDefinition) => {
  const category = allCategories.find(c => c.id === categoryId);
  if (!category) throw new Error("Category not found");

  const updatedAttributes = [...(category.attributes || []), newAttribute];
  return await saveCategory(uid, { ...category, attributes: updatedAttributes }, categoryId);
};

// ... keep existing code here
// Modulo 0.5 - Herança de Atributos
export const getEffectiveAttributes = (categoryId: string, allCategories: Category[]): AttributeDefinition[] => {
  const category = allCategories.find(c => c.id === categoryId);
  if (!category) return [];

  const pathIds = Array.isArray(category.pathIds) ? category.pathIds : [];
  
  // Ensure we have a unique list of IDs to check, including the category itself
  const allRelevantIds = [...new Set([...pathIds, category.id])];
  
  const relevantCategories = allRelevantIds
    .map(id => allCategories.find(c => c.id === id))
    .filter(Boolean) as Category[];
  
  const attributesMap = new Map<string, AttributeDefinition>();

  relevantCategories.forEach(cat => {
    (cat.attributes || []).forEach(attr => {
      // Child attribute overwrites parent attribute with same key
      attributesMap.set(attr.key, {
        ...attr,
        inherited: cat.id !== category.id,
        inheritedFrom: cat.id !== category.id ? cat.id : null,
      });
    });
  });

  // Retornar array ordenado: herdados primeiro, próprios por último, depois por order
  const effectiveAttributes = Array.from(attributesMap.values());
  effectiveAttributes.sort((a, b) => {
    if (a.inherited !== b.inherited) return a.inherited ? -1 : 1;
    return (a.order || 0) - (b.order || 0);
  });

  return effectiveAttributes;
};

export const getEffectiveImagePrompts = (
  categoryId: string,
  allCategories: Category[]
): { scene1?: string; scene2?: string; scene3?: string } | null => {
  let current: Category | undefined = allCategories.find(c => c.id === categoryId);

  while (current) {
    // If this category owns its prompts (not inheriting) OR has no parent, use own imagePrompts
    if (!current.inheritImagePrompts || !current.parentId) {
      const p = current.imagePrompts;
      return (p && (p.scene1 || p.scene2 || p.scene3)) ? p : null;
    }
    // Walk up to parent
    current = allCategories.find(c => c.id === current!.parentId);
  }

  return null;
};

// Modulo 0.3 — Geração de Hierarquia via IA (Gemini)
export const generateCategoryHierarchy = async (categories: string[], segment?: string) => {
  try {
    const prompt = `
Você é um especialista em arquitetura de dados e e-commerce.
Os usuários importaram a seguinte lista plana de categorias extraídas de uma planilha:
[${categories.join(', ')}]

${segment ? `O segmento do negócio é: ${segment}` : ''}

Sua tarefa é organizar e enriquecer essas categorias em uma estrutura lógica (pai/filho).

Diretrizes:
1. Agrupe categorias semelhantes hierarquicamente.
2. Sugira subcategorias adicionais relevantes se fizer sentido.
3. Tente reaproveitar os nomes exatos passados, organizando na propriedade "hierarchy".
4. Mantenha os níveis rasos (máximo de 3 níveis).

Retorne os dados em formato JSON estrito, conformando-se ao seguinte modelo (Retorne SOMENTE o JSON, sem markdown):

{
  "hierarchy": [
    {
      "name": "Calçados",
      "slug": "calcados",
      "children": [
        {
          "name": "Calçados Masculinos",
          "slug": "calcados-masculinos",
          "children": []
        }
      ]
    }
  ],
  "suggestedNewCategories": [
    { "name": "Acessórios", "reason": "Complementar ao segmento de moda" }
  ]
}
`;

    return await generateJson(prompt, { temperature: 0.2 });
  } catch (error) {
    console.error("Erro ao gerar hierarquia de categorias:", error);
    throw error;
  }
};

export const flattenHierarchy = (
  nodes: any[],
  parentId: string | null = null,
  level: number = 0,
  parentPath: string[] = [],
  parentPathIds: string[] = []
): Partial<Category>[] => {
  let flatList: Partial<Category>[] = [];
  
  nodes.forEach(node => {
    // Generate a temporary ID that can be used or replaced by Firestore
    const catId = `cat_${node.slug || Date.now() + '_' + Math.random()}`;
    const path = [...parentPath, node.name];
    const pathIds = [...parentPathIds, catId];

    const category: Partial<Category> = {
      id: catId,
      name: node.name,
      slug: node.slug || node.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      parentId,
      level,
      path,
      pathIds,
      attributes: [],
      inheritParentAttributes: true,
      productCount: 0,
      aiGenerated: true
    };

    flatList.push(category);

    if (node.children && node.children.length > 0) {
      const childrenFlatList = flattenHierarchy(
        node.children,
        catId,
        level + 1,
        path,
        pathIds
      );
      flatList = flatList.concat(childrenFlatList);
    }
  });

  return flatList;
};

