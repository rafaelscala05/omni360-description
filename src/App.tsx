import React, { useState, useRef, useMemo, useEffect } from 'react';
import { Upload, Download, Search, Filter, Play, Eye, Copy, RefreshCw, Save, Check, AlertCircle, X, Sparkles, FileSpreadsheet, Settings, Plus, Trash2, Image as ImageIcon, LogIn, LogOut, Coins, Layout, ChevronLeft, ChevronRight, DownloadCloud, Edit, Globe, FileText, Database } from 'lucide-react';
import * as XLSX from 'xlsx';
import { GoogleGenAI, Type } from '@google/genai';
import ImageSearchModal from './components/ImageSearchModal';
import LoginLanding from './components/LoginLanding';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';
import 'react-quill-new/dist/quill.bubble.css';
import { motion, AnimatePresence } from 'motion/react';
import { auth, db } from './firebase';
import { signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { collection, doc, writeBatch, getDocs, setDoc, getDoc, deleteDoc, getDocFromServer, runTransaction } from 'firebase/firestore';

// Initialize Gemini API
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Utility to merge classes
function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}

// Types
export interface Product {
  // Original 64 columns
  'ID'?: string;
  'Código (SKU)'?: string;
  'Descrição'?: string;
  'Unidade'?: string;
  'NCM (Classificação fiscal)'?: string;
  'Origem'?: string;
  'Preço'?: string | number;
  'Valor IPI fixo'?: string | number;
  'Observações'?: string;
  'Situação'?: string;
  'Estoque'?: string | number;
  'Preço de custo'?: string | number;
  'Cód do fornecedor'?: string;
  'Fornecedor'?: string;
  'Localização'?: string;
  'Estoque máximo'?: string | number;
  'Estoque mínimo'?: string | number;
  'Peso líquido (Kg)'?: string | number;
  'Peso bruto (Kg)'?: string | number;
  'GTIN/EAN'?: string;
  'GTIN/EAN tributável'?: string;
  'Descrição complementar'?: string;
  'CEST'?: string;
  'Código de Enquadramento IPI'?: string;
  'Formato embalagem'?: string;
  'Largura embalagem'?: string | number;
  'Altura Embalagem'?: string | number;
  'Comprimento embalagem'?: string | number;
  'Diâmetro embalagem'?: string | number;
  'Tipo do produto'?: string;
  'URL imagem 1'?: string;
  'URL imagem 2'?: string;
  'URL imagem 3'?: string;
  'URL imagem 4'?: string;
  'URL imagem 5'?: string;
  'URL imagem 6'?: string;
  'Categoria'?: string;
  'Código do pai'?: string;
  'Variações'?: string;
  'Marca'?: string;
  'Garantia'?: string;
  'Sob encomenda'?: string;
  'Preço promocional'?: string | number;
  'URL imagem externa 1'?: string;
  'URL imagem externa 2'?: string;
  'URL imagem externa 3'?: string;
  'URL imagem externa 4'?: string;
  'URL imagem externa 5'?: string;
  'URL imagem externa 6'?: string;
  'Link do vídeo'?: string;
  'Título SEO'?: string;
  'Descrição SEO'?: string;
  'Palavras chave SEO'?: string;
  'Slug'?: string;
  'Dias para preparação'?: string | number;
  'Controlar lotes'?: string;
  'Unidade por caixa'?: string | number;
  'URL imagem externa 7'?: string;
  'URL imagem externa 8'?: string;
  'URL imagem externa 9'?: string;
  'URL imagem externa 10'?: string;
  'Markup'?: string | number;
  'Permitir inclusão nas vendas'?: string;
  'EX TIPI'?: string;
  
  // Internal fields
  _id: string;
  _statusDescricao: 'Sem descrição' | 'Descrição original' | 'Gerado por IA';
  _statusSEO: 'Sem SEO' | 'Gerado por IA';
  _isGenerating?: boolean;
  _isEnriching?: boolean;
  _enrichmentLog?: string;
  _generationLog?: string;
  _tokenUsage?: {
    enrichment?: { promptTokens: number; completionTokens: number; totalTokens: number };
    generation?: { promptTokens: number; completionTokens: number; totalTokens: number };
    images?: { promptTokens: number; completionTokens: number; totalTokens: number };
  };
  _originalRow?: any; // Store original row to ensure all columns are exported
  _children?: Product[]; // For grouping variations
  _selectedImage?: string;
  _ambientImages?: string[];
  _isDirty?: boolean;
}

interface Template {
  id: string;
  name: string;
  prompt: string;
}

interface CreditLog {
  id: string;
  actionType: string;
  productName: string;
  sku: string;
  userName: string;
  creditsConsumed: number;
  timestamp: string;
}

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string;
    email?: string | null;
    emailVerified?: boolean;
    isAnonymous?: boolean;
    tenantId?: string | null;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

const defaultTemplate: Template = {
  id: 'default',
  name: 'Padrão (E-commerce SEO)',
  prompt: `Você é um especialista em SEO e copywriting para e-commerce.

Gere conteúdo altamente detalhado, persuasivo e otimizado para o produto abaixo. O objetivo é explicar muito bem o produto, seus benefícios, casos de uso e especificações, tirando todas as dúvidas do cliente.

**Dados do produto:**
- SKU: {Código (SKU)}
- Nome: {Descrição}
- Categoria: {Categoria}
- Marca: {Marca}
- Descrição atual: {Descrição complementar}
- Preço: R$ {Preço}
- Variações disponíveis: {Variações agrupadas das filhas}

**Análise Visual (IMPORTANTE):**
Se uma imagem for fornecida junto com este prompt, analise-a detalhadamente. Identifique e descreva:
- Cores exatas e predominantes
- Texturas e materiais aparentes
- Detalhes de design, acabamento e formato
Incorpore essas características visuais de forma natural e persuasiva na descrição.

**Retorne APENAS um JSON válido, sem markdown, sem explicações, no formato:**

{
  "descricao_html": "<div class='product-description'>...</div>",
  "titulo_seo": "Título de até 60 caracteres com palavra-chave principal",
  "descricao_seo": "Meta description de até 160 caracteres, atrativa e com CTA",
  "palavras_chave": "palavra1, palavra2, palavra3, palavra4, palavra5"
}

**REGRAS para descricao_html:**
- Estrutura Rica e Detalhada: 
  <h2> [Frase de efeito sobre o produto] </h2>
  <p> [Apresentação detalhada do produto, o que é, para que serve, qual problema resolve] </p>
  <h3>Principais Benefícios</h3> <ul> [Lista com os maiores benefícios e diferenciais] </ul>
  <h3>Detalhes e Especificações</h3> <ul> [Lista de características técnicas, material, medidas, etc] </ul>
  <h3>Dicas de Uso / Como Usar</h3> <p> [Explicação de como extrair o melhor do produto no dia a dia] </p>
  <p> [Fechamento persuasivo mencionando a marca e categoria] </p>
- Seja extremamente detalhista e explicativo. Não economize nas palavras se for para agregar valor.
- 300 a 600 palavras.
- Português do Brasil, tom profissional mas acessível.
- Inclua o nome do produto e categoria como palavras-chave naturais ao longo do texto.
- Se houver variações, mencione as opções disponíveis no texto.

**REGRAS para titulo_seo:**
- Máximo 60 caracteres
- Inclua o nome do produto e marca
- Formato: "[Nome do Produto] - [Marca] | [Benefício ou Categoria]"

**REGRAS para descricao_seo:**
- Máximo 160 caracteres
- Tom convidativo com CTA implícito
- Inclua o preço ou benefício principal

**REGRAS para palavras_chave:**
- 5 a 10 keywords separadas por vírgula
- Misture: nome exato, variações de busca, categoria, marca`
};

const TINY_ERP_HEADERS = [
  'ID', 'Código (SKU)', 'Descrição', 'Unidade', 'Classificação fiscal', 'Origem', 'Preço', 'Valor IPI fixo', 'Observações', 'Situação', 'Estoque', 'Preço de custo', 'Cód do Fornecedor', 'Fornecedor', 'Localização', 'Estoque máximo', 'Estoque mínimo', 'Peso líquido (Kg)', 'Peso bruto (Kg)', 'GTIN/EAN', 'GTIN/EAN tributável', 'Descrição complementar', 'CEST', 'Código de Enquadramento IPI', 'Formato embalagem', 'Largura embalagem', 'Altura embalagem', 'Comprimento embalagem', 'Diâmetro embalagem', 'Tipo do produto', 'URL imagem 1', 'URL imagem 2', 'URL imagem 3', 'URL imagem 4', 'URL imagem 5', 'URL imagem 6', 'Categoria', 'Código do pai', 'Variações', 'Marca', 'Garantia', 'Sob encomenda', 'Preço promocional', 'URL imagem externa 1', 'URL imagem externa 2', 'URL imagem externa 3', 'URL imagem externa 4', 'URL imagem externa 5', 'URL imagem externa 6', 'Link do vídeo', 'Título SEO', 'Descrição SEO', 'Palavras chave SEO', 'Slug', 'Dias para preparação', 'Controlar lotes', 'Unidade por caixa', 'URL imagem externa 7', 'URL imagem externa 8', 'URL imagem externa 9', 'URL imagem externa 10', 'Markup', 'Permitir inclusão nas vendas', 'EX TIPI'
];

const decodeHTMLEntities = (text: string | undefined | null) => {
  if (!text) return '';
  const textArea = document.createElement('textarea');
  textArea.innerHTML = text;
  return textArea.value;
};

export default function App() {
  // State
  const [products, setProducts] = useState<Product[]>([]);
  const [originalHeaders, setOriginalHeaders] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<'all' | 'processed'>('all');
  const [exportModel, setExportModel] = useState<'standard' | 'tinyerp'>('standard');
  
  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMarca, setFilterMarca] = useState('');
  const [filterCategoria, setFilterCategoria] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  
  // Generation State
  const [isGeneratingMass, setIsGeneratingMass] = useState(false);
  const [generationProgress, setGenerationProgress] = useState({ current: 0, total: 0 });
  const [generationLog, setGenerationLog] = useState<string>('');
  const [isEnrichingMass, setIsEnrichingMass] = useState(false);
  
  // Preview Modal State
  const [previewProduct, setPreviewProduct] = useState<Product | null>(null);
  const [editedDescription, setEditedDescription] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [isEditingSEO, setIsEditingSEO] = useState(false);
  const [isEditingInfo, setIsEditingInfo] = useState(false);
  const [editedSEO, setEditedSEO] = useState({ title: '', description: '', keywords: '' });
  const [editedInfo, setEditedInfo] = useState<Partial<Product>>({});
  const [copySuccess, setCopySuccess] = useState(false);

  // Image Search Modal State
  const [isImageSearchModalOpen, setIsImageSearchModalOpen] = useState(false);
  const [currentImageSearchProduct, setCurrentImageSearchProduct] = useState<Product | null>(null);

  // Auth State
  const [user, setUser] = useState<User | null>(null);
  const [credits, setCredits] = useState<number>(0);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isCreditHistoryOpen, setIsCreditHistoryOpen] = useState(false);
  const [creditLogs, setCreditLogs] = useState<CreditLog[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [isFirebaseUnavailable, setIsFirebaseUnavailable] = useState(false);
  
  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  
  // Column Visibility State
  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>({
    'Img': true,
    'SKU': true,
    'Descrição': true,
    'Categoria': true,
    'Marca': true,
    'Estoque': true,
    'GTIN/EAN': true,
    'Preço': true,
    'Situação': true,
    'Tipo': true,
    'Variações': true,
    'SEO': true,
    'Status Desc.': true
  });
  const [isColumnConfigOpen, setIsColumnConfigOpen] = useState(false);

  // Cloud Sync State
  const [isSavingToCloud, setIsSavingToCloud] = useState(false);
  const [isLoadingFromCloud, setIsLoadingFromCloud] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showMassActionConfirm, setShowMassActionConfirm] = useState<{
    isOpen: boolean;
    type: 'generate' | 'enrich';
    count: number;
    creditsNeeded: number;
  } | null>(null);
  const skipNextChangeTrack = useRef(false);

  // Auto-load from cloud when user is ready
  useEffect(() => {
    async function testConnection() {
      try {
        // Try to fetch a dummy doc from server to verify connectivity
        await getDocFromServer(doc(db, '_internal_', 'connectivity-test'));
        setIsFirebaseUnavailable(false);
      } catch (error) {
        if (error instanceof Error && (error.message.includes('unavailable') || error.message.includes('offline'))) {
          console.error("Firebase connection unavailable:", error);
          setIsFirebaseUnavailable(true);
        }
      }
    }
    testConnection();
  }, [isAuthReady, user]);

  // Track changes for auto-save
  useEffect(() => {
    if (skipNextChangeTrack.current) {
      skipNextChangeTrack.current = false;
      return;
    }
    if (products.length > 0) {
      setHasUnsavedChanges(true);
    }
  }, [products, originalHeaders]);

  // Debounced auto-save
  useEffect(() => {
    if (!hasUnsavedChanges || !user || isSavingToCloud || isLoadingFromCloud) return;

    const timer = setTimeout(() => {
      saveToCloud(true);
    }, 5000); // Auto-save after 5 seconds of inactivity

    return () => clearTimeout(timer);
  }, [hasUnsavedChanges, user, products, originalHeaders]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        // Fetch credits
        const userRef = doc(db, `users/${currentUser.uid}`);
        try {
          const userSnap = await getDoc(userRef);
          if (userSnap.exists()) {
            setCredits(userSnap.data().credits ?? 0);
          } else {
            // New user, give some starter credits
            const initialCredits = 10;
            await setDoc(userRef, { 
              email: currentUser.email, 
              credits: initialCredits,
              lastSync: new Date().toISOString(),
              displayName: currentUser.displayName 
            });
            setCredits(initialCredits);
          }
        } catch (error) {
          console.error("Error fetching user credits:", error);
        }
      } else {
        setCredits(0);
      }
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  const consumeCredit = async (actionType: string, productName: string = 'N/A', sku: string = 'N/A') => {
    if (!user) return false;
    
    try {
      const userPath = `users/${user.uid}`;
      const userRef = doc(db, userPath);
      
      const updatedValue = await runTransaction(db, async (transaction) => {
        const userSnap = await transaction.get(userRef);
        if (!userSnap.exists()) {
          throw new Error("Usuário não encontrado.");
        }
        
        const currentCredits = userSnap.data().credits ?? 0;
        if (currentCredits <= 0) {
          throw new Error("INSUFFICIENT_CREDITS");
        }
        
        const nextCredits = currentCredits - 1;
        transaction.update(userRef, { credits: nextCredits });
        
        // Log consumption
        const logRef = doc(collection(db, `${userPath}/credit_logs`));
        const logData: Omit<CreditLog, 'id'> = {
          actionType,
          productName,
          sku,
          userName: user.displayName || user.email || 'Usuário',
          creditsConsumed: 1,
          timestamp: new Date().toISOString()
        };
        transaction.set(logRef, logData);
        
        return nextCredits;
      });
      
      setCredits(updatedValue);
      
      if (isCreditHistoryOpen) {
        fetchCreditLogs();
      }
      
      return true;
    } catch (error: any) {
      if (error.message === "INSUFFICIENT_CREDITS") {
        alert("Você não possui créditos suficientes. Por favor, adicione mais créditos.");
      } else {
        handleFirestoreError(error, OperationType.WRITE, `users/${user?.uid}`);
      }
      return false;
    }
  };

  const fetchCreditLogs = async () => {
    if (!user) return;
    setIsLoadingLogs(true);
    try {
      const logsRef = collection(db, `users/${user.uid}/credit_logs`);
      const querySnapshot = await getDocs(logsRef);
      const logs: CreditLog[] = [];
      querySnapshot.forEach((doc) => {
        logs.push({ id: doc.id, ...doc.data() } as CreditLog);
      });
      // Sort by timestamp descending
      logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setCreditLogs(logs);
    } catch (error) {
      console.error("Error fetching credit logs:", error);
    } finally {
      setIsLoadingLogs(false);
    }
  };

  useEffect(() => {
    if (isCreditHistoryOpen && user) {
      fetchCreditLogs();
    }
  }, [isCreditHistoryOpen, user]);

  const handleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Login error:", error);
      alert("Erro ao fazer login com o Google.");
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  const saveToCloud = async (silent = false) => {
    if (!user) {
      if (!silent) alert("Faça login para salvar na nuvem.");
      return;
    }
    if (products.length === 0) {
      if (!silent) alert("Não há produtos para salvar.");
      return;
    }

    setIsSavingToCloud(true);
    try {
      // 0. Create/Update the user document to make it visible in console
      const userPath = `users/${user.uid}`;
      const userRef = doc(db, userPath);
      try {
        await setDoc(userRef, { 
          email: user.email, 
          lastSync: new Date().toISOString(),
          displayName: user.displayName,
          credits: credits
        }, { merge: true });
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, userPath);
      }

      // 1. Save original headers
      const settingsPath = `users/${user.uid}/settings/excel`;
      const settingsRef = doc(db, settingsPath);
      try {
        await setDoc(settingsRef, { originalHeaders, updatedAt: new Date().toISOString() });
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, settingsPath);
      }

      // 2. Identify products to Delete, Create, or Update
      const productsPath = `users/${user.uid}/products`;
      const productsRef = collection(db, productsPath);
      let existingSnap;
      try {
        existingSnap = await getDocs(productsRef);
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, productsPath);
        throw error;
      }

      const firestoreIds = new Set<string>(existingSnap.docs.map(doc => doc.id));
      const localIds = new Set<string>(products.map(p => p._id));

      // 2a. Delete products that are in Firestore but no longer in local state
      let batch = writeBatch(db);
      let opCount = 0;
      for (const docId of Array.from(firestoreIds)) {
        if (!localIds.has(docId)) {
          batch.delete(doc(productsRef, docId));
          opCount++;
          if (opCount === 500) {
            await batch.commit();
            batch = writeBatch(db);
            opCount = 0;
          }
        }
      }
      if (opCount > 0) {
        await batch.commit();
        batch = writeBatch(db);
        opCount = 0;
      }

      // 3. Save only DIRTY products (or all if we don't have dirty tracking yet, but we just added it)
      const dirtyProducts = products.filter(p => p._isDirty);
      
      if (dirtyProducts.length > 0) {
        for (const product of dirtyProducts) {
          const docId = product._id;
          const docRef = doc(productsRef, docId);
          
          // Prepare data (remove undefined values and internal flags)
          const dataToSave = { 
            ...product, 
            ownerId: user.uid, 
            updatedAt: new Date().toISOString() 
          };
          
          // Remove UI-only and internal flags we don't want to persist dirty
          delete dataToSave._isDirty;
          delete dataToSave._isGenerating;
          delete dataToSave._isEnriching;

          Object.keys(dataToSave).forEach(key => {
            if (dataToSave[key as keyof typeof dataToSave] === undefined) {
              delete dataToSave[key as keyof typeof dataToSave];
            }
          });

          batch.set(docRef, dataToSave, { merge: true });
          opCount++;
          
          if (opCount === 500) {
            await batch.commit();
            batch = writeBatch(db);
            opCount = 0;
          }
        }
        if (opCount > 0) {
          await batch.commit();
        }

        // 4. Update local state to clear _isDirty flags
        setProducts(prev => prev.map(p => p._isDirty ? { ...p, _isDirty: false } : p));
      }

      setLastSaved(new Date());
      setHasUnsavedChanges(false);
      if (!silent) alert("Projeto salvo na nuvem com sucesso!");
    } catch (error) {
      console.error("Error saving to cloud:", error);
      if (!silent) alert("Erro ao salvar na nuvem. Verifique o console para mais detalhes.");
    } finally {
      setIsSavingToCloud(false);
    }
  };

  const loadFromCloud = async (silent = false) => {
    if (!user) {
      if (!silent) alert("Faça login para carregar da nuvem.");
      return;
    }

    setIsLoadingFromCloud(true);
    try {
      // 1. Load original headers
      const settingsPath = `users/${user.uid}/settings/excel`;
      const settingsRef = doc(db, settingsPath);
      let settingsSnap;
      try {
        settingsSnap = await getDoc(settingsRef);
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, settingsPath);
      }
      
      if (settingsSnap?.exists() && settingsSnap.data().originalHeaders) {
        setOriginalHeaders(settingsSnap.data().originalHeaders);
      }

      // 2. Load products
      const productsPath = `users/${user.uid}/products`;
      const productsRef = collection(db, productsPath);
      let productsSnap;
      try {
        productsSnap = await getDocs(productsRef);
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, productsPath);
      }
      
      const loadedProducts: Product[] = [];
      productsSnap?.forEach(doc => {
        const data = doc.data() as Product;
        // Ensure _id exists, if not use doc.id
        if (!data._id) {
          data._id = doc.id;
        }
        loadedProducts.push(data);
      });

      if (loadedProducts.length > 0) {
        // Sort by _id to maintain some order, or keep as is
        loadedProducts.sort((a, b) => (a._id || '').localeCompare(b._id || ''));
        skipNextChangeTrack.current = true;
        setProducts(loadedProducts);
        setLastSaved(new Date());
        setHasUnsavedChanges(false);
        if (!silent) alert(`${loadedProducts.length} produtos carregados com sucesso!`);
      } else {
        if (!silent) alert("Nenhum produto encontrado na nuvem.");
      }
    } catch (error) {
      console.error("Error loading from cloud:", error);
      if (!silent) alert("Erro ao carregar da nuvem. Verifique o console para mais detalhes.");
    } finally {
      setIsLoadingFromCloud(false);
    }
  };

  // Template State
  const [templates, setTemplates] = useState<Template[]>(() => {
    const saved = localStorage.getItem('ai_description_templates');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error("Failed to parse templates from local storage", e);
      }
    }
    return [defaultTemplate];
  });
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(defaultTemplate.id);
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);

  // Save templates to local storage whenever they change
  useEffect(() => {
    localStorage.setItem('ai_description_templates', JSON.stringify(templates));
  }, [templates]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Derived Data
  const marcas = useMemo(() => Array.from(new Set(products.map(p => p['Marca']).filter(Boolean) as string[])).sort(), [products]);
  const categorias = useMemo(() => Array.from(new Set(products.map(p => p['Categoria']).filter(Boolean) as string[])).sort(), [products]);

  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      // Only show parent or simple products in the main list
      if (p['Código do pai']) return false;

      // Tab filter
      if (activeTab === 'processed') {
        const isProcessed = p._statusDescricao === 'Gerado por IA' || p._statusSEO === 'Gerado por IA' || p._enrichmentLog;
        if (!isProcessed) return false;
      }

      const matchesSearch = (p['Descrição']?.toLowerCase() || '').includes(searchQuery.toLowerCase()) || 
                            (p['Código (SKU)']?.toLowerCase() || '').includes(searchQuery.toLowerCase());
      const matchesMarca = filterMarca ? p['Marca'] === filterMarca : true;
      const matchesCategoria = filterCategoria ? p['Categoria'] === filterCategoria : true;
      const matchesStatus = filterStatus ? p._statusDescricao === filterStatus : true;
      
      return matchesSearch && matchesMarca && matchesCategoria && matchesStatus;
    });
  }, [products, searchQuery, filterMarca, filterCategoria, filterStatus, activeTab]);

  const paginatedProducts = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredProducts.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredProducts, currentPage, itemsPerPage]);

  const totalPages = Math.ceil(filteredProducts.length / itemsPerPage);

  // Handlers
  const downloadTemplate = () => {
    const headers = [
      'Código (SKU)', 'Descrição', 'Unidade', 'NCM (Classificação fiscal)', 'Origem', 'Preço', 'Observações', 'Situação', 'Estoque', 'Preço de custo', 'Fornecedor', 'Marca', 'Categoria', 'Peso bruto (Kg)', 'GTIN/EAN', 'URL imagem 1', 'Descrição complementar', 'Título SEO', 'Descrição SEO', 'Palavras chave SEO'
    ];
    
    const testProduct = {
      'Código (SKU)': 'TEST-001',
      'Descrição': 'Produto de Teste Omni360',
      'Unidade': 'UN',
      'NCM (Classificação fiscal)': '85171300',
      'Origem': '0',
      'Preço': 2999.90,
      'Observações': 'Produto para teste de importação',
      'Situação': 'Ativo',
      'Estoque': 10,
      'Preço de custo': 1500.00,
      'Fornecedor': 'Fornecedor Teste',
      'Marca': 'Omni360',
      'Categoria': 'Eletrônicos',
      'Peso bruto (Kg)': 0.5,
      'GTIN/EAN': '7891234567890',
      'URL imagem 1': 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&q=80&w=200',
      'Descrição complementar': 'Uma breve descrição de teste.',
      'Título SEO': '',
      'Descrição SEO': '',
      'Palavras chave SEO': ''
    };

    const ws = XLSX.utils.json_to_sheet([testProduct], { header: headers });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Produtos");
    
    XLSX.writeFile(wb, "template_omni360_teste.xlsx");
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        
        // Capture headers
        const headerRow = XLSX.utils.sheet_to_json(ws, { header: 1 })[0] as string[];
        if (headerRow) {
          setOriginalHeaders(headerRow);
        }

        // Use defval to ensure empty cells are preserved in the JSON
        const data = XLSX.utils.sheet_to_json(ws, { defval: "" }) as any[];

        // Check if it's the new format
        if (data.length > 0 && !('Código (SKU)' in data[0])) {
          alert("Formato de planilha não reconhecido. Certifique-se de usar o novo formato com a coluna 'Código (SKU)'.");
          return;
        }

        const allProducts: Product[] = data.map((row, index) => {
          const desc = row['Descrição complementar'];
          let statusDesc: Product['_statusDescricao'] = 'Sem descrição';
          if (desc && typeof desc === 'string' && desc.trim().length > 0) {
            statusDesc = 'Descrição original';
          }

          const tituloSeo = row['Título SEO'];
          let statusSEO: Product['_statusSEO'] = 'Sem SEO';
          if (tituloSeo && typeof tituloSeo === 'string' && tituloSeo.trim().length > 0) {
            statusSEO = 'Gerado por IA';
          }

          // Try to find image URL in common columns
          const imgUrl = row['URL imagem 1'] || 
                         row['URL imagem interna 1'] || 
                         row['URL imagem externa 1'] || 
                         row['Imagem'] || 
                         row['Link da imagem'];

          return {
            ...row,
            _id: `prod_${index}_${Date.now()}`,
            _statusDescricao: statusDesc,
            _statusSEO: statusSEO,
            _originalRow: row,
            _isDirty: true,
            _selectedImage: imgUrl || ''
          };
        });

        // Group variations under parents
        const parents: Product[] = [];
        const childrenMap = new Map<string, Product[]>();

        allProducts.forEach(p => {
          const parentCode = p['Código do pai'];
          if (parentCode) {
            if (!childrenMap.has(parentCode)) {
              childrenMap.set(parentCode, []);
            }
            childrenMap.get(parentCode)!.push(p);
          } else {
            parents.push(p);
          }
        });

        // Attach children to parents
        const finalProducts = parents.map(parent => {
          const sku = parent['Código (SKU)'];
          if (sku && childrenMap.has(sku)) {
            return { ...parent, _children: childrenMap.get(sku) };
          }
          return parent;
        });

        // We store ALL products in state so we can export them later, but we only render parents.
        // Actually, it's better to store all products flat, and just compute the children for rendering.
        // Let's store all products flat, but link them.
        
        setProducts(allProducts);
        setSelectedIds(new Set());
        // Reset file input
        if (fileInputRef.current) fileInputRef.current.value = '';
      } catch (error) {
        console.error("Error parsing Excel file:", error);
        alert("Erro ao ler o arquivo. Certifique-se de que é um arquivo .xlsx válido.");
      }
    };
    reader.readAsBinaryString(file);
  };

  const handleExport = () => {
    if (products.length === 0) return;

    const exportData = products.flatMap(p => {
      const rowsToExport = [];
      
      const prepareRow = (prod: Product) => {
        if (exportModel === 'tinyerp') {
          const row: any = {};
          TINY_ERP_HEADERS.forEach(header => {
            // Default to empty string
            row[header] = '';
            
            // Map common fields
            if (header === 'ID') row[header] = prod['ID'] || '';
            if (header === 'Código (SKU)') row[header] = prod['Código (SKU)'] || '';
            if (header === 'Descrição') row[header] = prod['Descrição'] || '';
            if (header === 'Unidade') row[header] = prod['Unidade'] || '';
            if (header === 'Classificação fiscal') row[header] = prod['Classificação fiscal'] || prod['NCM (Classificação fiscal)'] || '';
            if (header === 'Origem') row[header] = prod['Origem'] || '0';
            if (header === 'Preço') row[header] = prod['Preço'] || '';
            if (header === 'Valor IPI fixo') row[header] = prod['Valor IPI fixo'] || '';
            if (header === 'Observações') row[header] = prod['Observações'] || '';
            if (header === 'Situação') row[header] = prod['Situação'] || 'Ativo';
            if (header === 'Estoque') row[header] = prod['Estoque'] || '0';
            if (header === 'Preço de custo') row[header] = prod['Preço de custo'] || '';
            if (header === 'Cód do Fornecedor') row[header] = prod['Cód do Fornecedor'] || '';
            if (header === 'Fornecedor') row[header] = prod['Fornecedor'] || '';
            if (header === 'Localização') row[header] = prod['Localização'] || '';
            if (header === 'Estoque máximo') row[header] = prod['Estoque máximo'] || '';
            if (header === 'Estoque mínimo') row[header] = prod['Estoque mínimo'] || '';
            if (header === 'Peso líquido (Kg)') row[header] = prod['Peso líquido (Kg)'] || '';
            if (header === 'Peso bruto (Kg)') row[header] = prod['Peso bruto (Kg)'] || '';
            if (header === 'GTIN/EAN') row[header] = prod['GTIN/EAN'] || '';
            if (header === 'GTIN/EAN tributável') row[header] = prod['GTIN/EAN tributável'] || '';
            if (header === 'Descrição complementar') row[header] = prod['Descrição complementar'] || '';
            if (header === 'CEST') row[header] = prod['CEST'] || '';
            if (header === 'Código de Enquadramento IPI') row[header] = prod['Código de Enquadramento IPI'] || '';
            if (header === 'Formato embalagem') row[header] = prod['Formato embalagem'] || '';
            if (header === 'Largura embalagem') row[header] = prod['Largura embalagem'] || '';
            if (header === 'Altura embalagem') row[header] = prod['Altura embalagem'] || prod['Altura Embalagem'] || '';
            if (header === 'Comprimento embalagem') row[header] = prod['Comprimento embalagem'] || '';
            if (header === 'Diâmetro embalagem') row[header] = prod['Diâmetro embalagem'] || '';
            if (header === 'Tipo do produto') row[header] = prod['Tipo do produto'] || 'P';
            if (header === 'Categoria') row[header] = prod['Categoria'] || '';
            if (header === 'Código do pai') row[header] = prod['Código do pai'] || '';
            if (header === 'Variações') row[header] = prod['Variações'] || '';
            if (header === 'Marca') row[header] = prod['Marca'] || '';
            if (header === 'Garantia') row[header] = prod['Garantia'] || '';
            if (header === 'Sob encomenda') row[header] = prod['Sob encomenda'] || 'N';
            if (header === 'Preço promocional') row[header] = prod['Preço promocional'] || '';
            if (header === 'Link do vídeo') row[header] = prod['Link do vídeo'] || '';
            if (header === 'Título SEO') row[header] = prod['Título SEO'] || '';
            if (header === 'Descrição SEO') row[header] = prod['Descrição SEO'] || '';
            if (header === 'Palavras chave SEO') row[header] = prod['Palavras chave SEO'] || '';
            if (header === 'Slug') row[header] = prod['Slug'] || '';
            if (header === 'Dias para preparação') row[header] = prod['Dias para preparação'] || '';
            if (header === 'Controlar lotes') row[header] = prod['Controlar lotes'] || 'N';
            if (header === 'Unidade por caixa') row[header] = prod['Unidade por caixa'] || '';
            if (header === 'Markup') row[header] = prod['Markup'] || '';
            if (header === 'Permitir inclusão nas vendas') row[header] = prod['Permitir inclusão nas vendas'] || 'S';
            if (header === 'EX TIPI') row[header] = prod['EX TIPI'] || '';
            
            // Map Images
            if (header === 'URL imagem 1') {
              row[header] = prod._selectedImage?.startsWith('data:') ? '[Imagem Base64]' : (prod._selectedImage || prod['URL imagem 1'] || '');
            }
            for (let i = 2; i <= 6; i++) {
              if (header === `URL imagem ${i}`) {
                const ambientImg = prod._ambientImages?.[i - 2];
                row[header] = ambientImg?.startsWith('data:') ? '[Imagem Base64]' : (ambientImg || prod[`URL imagem ${i}`] || '');
              }
            }
            for (let i = 1; i <= 10; i++) {
              if (header === `URL imagem externa ${i}`) {
                row[header] = prod[`URL imagem externa ${i}`] || '';
              }
            }
          });
          return row;
        } else {
          // Standard System Model
          const row = { ...prod._originalRow };
          // Update with generated fields
          row['Descrição complementar'] = prod['Descrição complementar'] || row['Descrição complementar'];
          row['Título SEO'] = prod['Título SEO'] || row['Título SEO'];
          row['Descrição SEO'] = prod['Descrição SEO'] || row['Descrição SEO'];
          row['Palavras chave SEO'] = prod['Palavras chave SEO'] || row['Palavras chave SEO'];
          
          // Update with enriched fields
          row['GTIN/EAN'] = prod['GTIN/EAN'] || row['GTIN/EAN'];
          row['NCM (Classificação fiscal)'] = prod['NCM (Classificação fiscal)'] || row['NCM (Classificação fiscal)'];
          row['Peso bruto (Kg)'] = prod['Peso bruto (Kg)'] || row['Peso bruto (Kg)'];
          row['Largura embalagem'] = prod['Largura embalagem'] || row['Largura embalagem'];
          row['Altura Embalagem'] = prod['Altura Embalagem'] || row['Altura Embalagem'];
          row['Comprimento embalagem'] = prod['Comprimento embalagem'] || row['Comprimento embalagem'];
          
          // Update with images
          if (prod._selectedImage) {
            row['URL imagem 1'] = prod._selectedImage.startsWith('data:') ? '[Imagem Base64]' : prod._selectedImage;
          }
          if (prod._ambientImages && prod._ambientImages.length > 0) {
            prod._ambientImages.forEach((img, idx) => {
              const colName = `URL imagem ${idx + 2}`;
              if (idx + 2 <= 5) {
                row[colName] = img.startsWith('data:') ? '[Imagem Base64]' : img;
              }
            });
          }
          return row;
        }
      };

      rowsToExport.push(prepareRow(p));

      // Children rows
      if (p._children && p._children.length > 0) {
        p._children.forEach(child => {
          rowsToExport.push(prepareRow(child));
        });
      }

      return rowsToExport;
    });

    // Determine the headers to use
    let headersToUse = exportModel === 'tinyerp' ? TINY_ERP_HEADERS : (originalHeaders.length > 0 ? [...originalHeaders] : undefined);
    
    // Ensure new columns are added to standard model if they weren't in the original file
    if (exportModel === 'standard' && headersToUse) {
      const newColumns = ['Título SEO', 'Descrição SEO', 'Palavras chave SEO', 'URL imagem 1', 'URL imagem 2', 'URL imagem 3', 'URL imagem 4', 'URL imagem 5'];
      newColumns.forEach(col => {
        if (!headersToUse!.includes(col)) {
          headersToUse!.push(col);
        }
      });
    }

    const ws = XLSX.utils.json_to_sheet(exportData, headersToUse ? { header: headersToUse } : undefined);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Planilha 1');

    const date = new Date().toISOString().split('T')[0];
    const modelName = exportModel === 'tinyerp' ? 'TinyERP' : 'Padrao';
    XLSX.writeFile(wb, `produtos_exportacao_${modelName}_${date}.xlsx`);
  };

  const toggleSelection = (id: string) => {
    const newSelection = new Set(selectedIds);
    if (newSelection.has(id)) {
      newSelection.delete(id);
    } else {
      newSelection.add(id);
    }
    setSelectedIds(newSelection);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredProducts.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredProducts.map(p => p._id)));
    }
  };

  const generateDescriptionText = async (product: Product, templateId: string): Promise<any> => {
    const template = templates.find(t => t.id === templateId) || defaultTemplate;
    
    // Format variations for the prompt
    let variacoesText = 'Nenhuma';
    if (product._children && product._children.length > 0) {
      const allVariations = product._children.map(c => c['Variações']).filter(Boolean);
      variacoesText = allVariations.join(' | ');
    }

    const visualEnhancementRules = `
ESPECIFICAÇÕES VISUAIS DA DESCRIÇÃO (OBRIGATÓRIO):
1. Use HTML semântico e profissional.
2. Adicione espaçamento extra (margem superior/inferior ou quebras de linha duplas) entre parágrafos, subtítulos e PRINCIPALMENTE entre itens de lista (<li>) para melhorar drasticamente a leitura.
3. Utilize tags <h2> e <h3> para criar seções lógicas e organizadas.
4. Transforme blocos de texto denso em listas bulleted (<ul> e <li>) para facilitar a escaneabilidade.
5. O resultado deve ser visualmente limpo, com ar de e-commerce premium.`;

    let prompt = template.prompt.replace(/{([^{}\n]+)}/g, (match, p1) => {
      let key = p1.trim();
      
      if (key.toLowerCase() === 'variações agrupadas das filhas') {
        return variacoesText;
      }
      
      // Common aliases to make it easier for the user
      if (key.toLowerCase() === 'nome') key = 'Descrição';
      if (key.toLowerCase() === 'sku') key = 'Código (SKU)';
      
      // Try exact match first
      let val = (product as any)[key];
      
      // Try case-insensitive match if not found
      if (val === undefined) {
        const foundKey = Object.keys(product).find(k => k.toLowerCase() === key.toLowerCase());
        if (foundKey) {
          val = (product as any)[foundKey];
        }
      }
      
      // If the value exists, return it.
      // If it doesn't exist (e.g., empty cell in Excel, or invalid column), return an empty string
      // to avoid sending the literal placeholder (like "{Marca}") to the AI.
      return val != null ? String(val) : '';
    });

    const productDataForLog = { ...product };
    Object.keys(productDataForLog).forEach(key => {
      if (key.startsWith('_')) {
        delete (productDataForLog as any)[key];
      }
    });

    const promptLog = `=== PARÂMETROS DA PLANILHA ===\n${JSON.stringify(productDataForLog, null, 2)}\n\n=== PROMPT ENVIADO ===\n${prompt}\n\n=== REGRAS VISUAIS ===\n${visualEnhancementRules}`;

    const parts: any[] = [{ text: prompt + "\n\n" + visualEnhancementRules }];

    const imageUrl = product['URL imagem 1'] || product['URL imagem externa 1'];
    if (imageUrl) {
      try {
        const response = await fetch(imageUrl);
        if (response.ok) {
          const blob = await response.blob();
          const base64data = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
          
          const matches = base64data.match(/^data:(.+);base64,(.+)$/);
          if (matches && matches.length === 3) {
            parts.unshift({
              inlineData: {
                mimeType: matches[1],
                data: matches[2]
              }
            });
          }
        }
      } catch (error) {
        console.warn("Aviso: Não foi possível carregar a imagem para análise da IA (possível bloqueio de CORS). Gerando descrição apenas com os dados em texto.", error);
      }
    }

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: { parts },
        config: { 
          temperature: 0.7,
          maxOutputTokens: 4096,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              descricao_html: {
                type: Type.STRING,
                description: "A descrição do produto em formato HTML."
              },
              titulo_seo: {
                type: Type.STRING,
                description: "O título SEO otimizado."
              },
              descricao_seo: {
                type: Type.STRING,
                description: "A meta description SEO."
              },
              palavras_chave: {
                type: Type.STRING,
                description: "As palavras-chave separadas por vírgula."
              }
            },
            required: ["descricao_html", "titulo_seo", "descricao_seo", "palavras_chave"]
          }
        }
      });
      
      let text = response.text || '';
      // Clean up markdown blocks if present
      text = text.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
      
      try {
        const parsed = JSON.parse(text);
        const usage = response.usageMetadata || { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 };
        return { 
          ...parsed, 
          _promptLog: promptLog,
          _usage: {
            promptTokens: usage.promptTokenCount,
            completionTokens: usage.candidatesTokenCount,
            totalTokens: usage.totalTokenCount
          }
        };
      } catch (e) {
        console.error("Failed to parse JSON from AI response", text);
        throw new Error("A IA não retornou um JSON válido.");
      }
    } catch (error) {
      console.error("Error generating description:", error);
      throw error;
    }
  };

  const applyGenerationToProductAndChildren = (productId: string, generatedData: any) => {
    setProducts(prev => {
      const updated = [...prev];
      const parentIdx = updated.findIndex(p => p._id === productId);
      if (parentIdx === -1) return updated;

      const parent = updated[parentIdx];
      const parentSku = parent['Código (SKU)'];

      // Update parent
      updated[parentIdx] = {
        ...parent,
        'Descrição complementar': decodeHTMLEntities(generatedData.descricao_html),
        'Título SEO': decodeHTMLEntities(generatedData.titulo_seo),
        'Descrição SEO': decodeHTMLEntities(generatedData.descricao_seo),
        'Palavras chave SEO': decodeHTMLEntities(generatedData.palavras_chave),
        _statusDescricao: 'Gerado por IA',
        _statusSEO: 'Gerado por IA',
        _generationLog: generatedData._promptLog,
        _tokenUsage: {
          ...parent._tokenUsage,
          generation: generatedData._usage
        },
        _isGenerating: false,
        _isDirty: true
      };

      // Update children
      if (parentSku) {
        for (let i = 0; i < updated.length; i++) {
          if (updated[i]['Código do pai'] === parentSku) {
            updated[i] = {
              ...updated[i],
              'Descrição complementar': decodeHTMLEntities(generatedData.descricao_html),
              // SEO fields are NOT copied to children according to prompt instructions
              _statusDescricao: 'Gerado por IA',
              _isDirty: true
            };
          }
        }
      }

      return updated;
    });
  };

  const handleSaveImages = (productId: string, selectedImage: string, ambientImages: string[], tokenUsage?: { promptTokens: number; completionTokens: number; totalTokens: number }) => {
    setProducts(prev => {
      const updated = [...prev];
      const idx = updated.findIndex(p => p._id === productId);
      if (idx === -1) return updated;

      const updateProduct = (p: Product) => ({
        ...p,
        _selectedImage: selectedImage,
        _ambientImages: ambientImages,
        _tokenUsage: tokenUsage ? {
          ...p._tokenUsage,
          images: tokenUsage
        } : p._tokenUsage,
        _isDirty: true
      });

      updated[idx] = updateProduct(updated[idx]);

      // Also update children if any
      const parentSku = updated[idx]['Código (SKU)'];
      if (parentSku) {
        for (let i = 0; i < updated.length; i++) {
          if (updated[i]['Código do pai'] === parentSku) {
            updated[i] = updateProduct(updated[i]);
          }
        }
      }

      return updated;
    });
  };

  const enrichProductData = async (product: Product): Promise<any> => {
    const prompt = `Você é um assistente de cadastro de e-commerce.
Busque na internet as especificações técnicas do seguinte produto:
Nome/Descrição: ${product['Descrição']}
Marca: ${product['Marca']}
Categoria: ${product['Categoria']}

Tente encontrar os seguintes dados (se não encontrar, deixe vazio ou null):
- GTIN/EAN (código de barras)
- NCM (Classificação fiscal)
- Peso bruto (Kg)
- Largura embalagem (cm)
- Altura Embalagem (cm)
- Comprimento embalagem (cm)

Retorne APENAS um JSON válido no seguinte formato:
{
  "GTIN/EAN": "...",
  "NCM (Classificação fiscal)": "...",
  "Peso bruto (Kg)": 1.5,
  "Largura embalagem": 20,
  "Altura Embalagem": 15,
  "Comprimento embalagem": 10,
  "log_fontes": "Resumo muito conciso (máx 150 caracteres) das fontes utilizadas."
}`;

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: { 
          temperature: 0.2,
          maxOutputTokens: 2048,
          systemInstruction: "Você é um assistente de e-commerce. Seja extremamente conciso. Nunca gere textos longos ou repetitivos. O campo log_fontes deve ter no máximo 150 caracteres. RESPONDA APENAS COM O JSON PURO.",
          tools: [{ googleSearch: {} }]
        }
      });
      
      let text = response.text || '';
      text = text.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
      
      try {
        const parsed = JSON.parse(text);
        const usage = response.usageMetadata || { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 };
        return {
          ...parsed,
          _usage: {
            promptTokens: usage.promptTokenCount,
            completionTokens: usage.candidatesTokenCount,
            totalTokens: usage.totalTokenCount
          }
        };
      } catch (e) {
        console.error("Failed to parse JSON from AI response", text);
        throw new Error("A IA não retornou um JSON válido.");
      }
    } catch (error) {
      console.error("Error enriching data:", error);
      throw error;
    }
  };

  const applyEnrichmentToProductAndChildren = (productId: string, enrichedData: any) => {
    setProducts(prev => {
      const updated = [...prev];
      const parentIdx = updated.findIndex(p => p._id === productId);
      if (parentIdx === -1) return updated;

      const parent = updated[parentIdx];
      const parentSku = parent['Código (SKU)'];

      const updateFields = (p: Product) => ({
        ...p,
        'GTIN/EAN': enrichedData['GTIN/EAN'] || p['GTIN/EAN'],
        'NCM (Classificação fiscal)': enrichedData['NCM (Classificação fiscal)'] || p['NCM (Classificação fiscal)'],
        'Peso bruto (Kg)': enrichedData['Peso bruto (Kg)'] || p['Peso bruto (Kg)'],
        'Largura embalagem': enrichedData['Largura embalagem'] || p['Largura embalagem'],
        'Altura Embalagem': enrichedData['Altura Embalagem'] || p['Altura Embalagem'],
        'Comprimento embalagem': enrichedData['Comprimento embalagem'] || p['Comprimento embalagem'],
        _enrichmentLog: enrichedData['log_fontes'] || p._enrichmentLog,
        _tokenUsage: {
          ...p._tokenUsage,
          enrichment: enrichedData._usage
        },
        _isEnriching: false,
        _isDirty: true
      });

      // Update parent
      updated[parentIdx] = updateFields(parent);

      // Update children
      if (parentSku) {
        for (let i = 0; i < updated.length; i++) {
          if (updated[i]['Código do pai'] === parentSku) {
            updated[i] = updateFields(updated[i]);
          }
        }
      }

      return updated;
    });
  };

  const handleEnrichSingle = async (id: string) => {
    const productIndex = products.findIndex(p => p._id === id);
    if (productIndex === -1) return;
    const product = products[productIndex];

    if (!(await consumeCredit('Enriquecimento Individual', product['Descrição'], product['Código (SKU)']))) return;
    
    // Set enriching state
    const newProducts = [...products];
    newProducts[productIndex] = { ...product, _isEnriching: true };
    setProducts(newProducts);

    try {
      const enrichedData = await enrichProductData(product);
      applyEnrichmentToProductAndChildren(id, enrichedData);
    } catch (error) {
      alert(`Erro ao enriquecer dados para ${product['Descrição']}`);
      setProducts(prev => {
        const updated = [...prev];
        const idx = updated.findIndex(p => p._id === id);
        if (idx !== -1) {
          updated[idx] = { ...updated[idx], _isEnriching: false };
        }
        return updated;
      });
    }
  };

  const handleGenerateSingle = async (id: string) => {
    const productIndex = products.findIndex(p => p._id === id);
    if (productIndex === -1) return;
    const product = products[productIndex];

    if (!(await consumeCredit('Geração SEO Individual', product['Descrição'], product['Código (SKU)']))) return;
    
    // Set generating state
    const newProducts = [...products];
    newProducts[productIndex] = { ...product, _isGenerating: true };
    setProducts(newProducts);

    try {
      const generatedData = await generateDescriptionText(product, selectedTemplateId);
      applyGenerationToProductAndChildren(id, generatedData);
    } catch (error) {
      alert(`Erro ao gerar descrição para ${product['Descrição']}`);
      setProducts(prev => {
        const updated = [...prev];
        const idx = updated.findIndex(p => p._id === id);
        if (idx !== -1) {
          updated[idx] = { ...updated[idx], _isGenerating: false };
        }
        return updated;
      });
    }
  };

  const handleGenerateMass = async () => {
    if (selectedIds.size === 0) return;
    
    // Total cost check
    const count = selectedIds.size;
    if (credits < count) {
      alert(`Você não possui créditos suficientes. Necessário: ${count}, Disponível: ${credits}`);
      return;
    }

    if (count > 1) {
      setShowMassActionConfirm({
        isOpen: true,
        type: 'generate',
        count: count,
        creditsNeeded: count
      });
      return;
    }

    startGenerateMass();
  };

  const startGenerateMass = async () => {
    setShowMassActionConfirm(null);
    setIsGeneratingMass(true);
    setGenerationProgress({ current: 0, total: selectedIds.size });
    
    const idsToProcess: string[] = Array.from(selectedIds);
    let successCount = 0;

    for (let i = 0; i < idsToProcess.length; i++) {
      const id = idsToProcess[i];
      const productIndex = products.findIndex(p => p._id === id);
      if (productIndex === -1) continue;
      
      const product = products[productIndex];
      if (!(await consumeCredit('Geração SEO em Massa', product['Descrição'], product['Código (SKU)']))) break;
      setGenerationLog(`Gerando descrição para: ${product['Descrição'] || product['Código (SKU)']}...`);
      
      // Update UI to show this specific item is generating
      setProducts(prev => {
        const updated = [...prev];
        const idx = updated.findIndex(p => p._id === id);
        if (idx !== -1) updated[idx] = { ...updated[idx], _isGenerating: true };
        return updated;
      });

      try {
        const generatedData = await generateDescriptionText(product, selectedTemplateId);
        applyGenerationToProductAndChildren(id, generatedData);
        successCount++;
      } catch (error) {
        console.error(`Failed for ${id}`, error);
        setProducts(prev => {
          const updated = [...prev];
          const idx = updated.findIndex(p => p._id === id);
          if (idx !== -1) updated[idx] = { ...updated[idx], _isGenerating: false };
          return updated;
        });
      }
      
      setGenerationProgress({ current: i + 1, total: selectedIds.size });
      // Small delay to prevent UI freezing and respect rate limits
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    setGenerationLog(`✅ ${successCount} produtos gerados com sucesso!`);
    setTimeout(() => {
      setIsGeneratingMass(false);
      setGenerationLog('');
      setSelectedIds(new Set()); // Clear selection after mass generation
    }, 3000);
  };

  const handleEnrichMass = async () => {
    if (selectedIds.size === 0) return;

    // Total cost check
    const count = selectedIds.size;
    if (credits < count) {
      alert(`Você não possui créditos suficientes. Necessário: ${count}, Disponível: ${credits}`);
      return;
    }

    if (count > 1) {
      setShowMassActionConfirm({
        isOpen: true,
        type: 'enrich',
        count: count,
        creditsNeeded: count
      });
      return;
    }

    startEnrichMass();
  };

  const startEnrichMass = async () => {
    setShowMassActionConfirm(null);
    setIsEnrichingMass(true);
    setGenerationProgress({ current: 0, total: selectedIds.size });
    
    const idsToProcess: string[] = Array.from(selectedIds);
    let successCount = 0;

    for (let i = 0; i < idsToProcess.length; i++) {
      const id = idsToProcess[i];
      const productIndex = products.findIndex(p => p._id === id);
      if (productIndex === -1) continue;
      
      const product = products[productIndex];
      if (!(await consumeCredit('Enriquecimento em Massa', product['Descrição'], product['Código (SKU)']))) break;
      setGenerationLog(`Buscando dados para: ${product['Descrição'] || product['Código (SKU)']}...`);
      
      setProducts(prev => {
        const updated = [...prev];
        const idx = updated.findIndex(p => p._id === id);
        if (idx !== -1) updated[idx] = { ...updated[idx], _isEnriching: true };
        return updated;
      });

      try {
        const enrichedData = await enrichProductData(product);
        applyEnrichmentToProductAndChildren(id, enrichedData);
        successCount++;
      } catch (error) {
        console.error(`Failed enriching ${id}`, error);
        setProducts(prev => {
          const updated = [...prev];
          const idx = updated.findIndex(p => p._id === id);
          if (idx !== -1) updated[idx] = { ...updated[idx], _isEnriching: false };
          return updated;
        });
      }
      
      setGenerationProgress({ current: i + 1, total: selectedIds.size });
      await new Promise(resolve => setTimeout(resolve, 1000)); // Slightly longer delay for search API
    }

    setGenerationLog(`✅ ${successCount} produtos enriquecidos com sucesso!`);
    setTimeout(() => {
      setIsEnrichingMass(false);
      setGenerationLog('');
      setSelectedIds(new Set());
    }, 3000);
  };

  const openPreview = (product: Product) => {
    setPreviewProduct(product);
    setEditedDescription(product['Descrição complementar'] || '');
    setEditedSEO({
      title: product['Título SEO'] || '',
      description: product['Descrição SEO'] || '',
      keywords: product['Palavras chave SEO'] || ''
    });
    setEditedInfo({ ...product }); // Copy everything
    setIsEditing(false);
    setIsEditingSEO(false);
    setIsEditingInfo(false);
    setCopySuccess(false);
  };

  const saveEditedDescription = () => {
    if (!previewProduct) return;
    
    setProducts(prev => {
      const updated = [...prev];
      const idx = updated.findIndex(p => p._id === previewProduct._id);
      if (idx !== -1) {
        updated[idx] = {
          ...updated[idx],
          'Descrição complementar': editedDescription,
          _statusDescricao: updated[idx]._statusDescricao === 'Sem descrição' ? 'Descrição original' : updated[idx]._statusDescricao,
          _isDirty: true
        };
      }
      return updated;
    });
    
    setPreviewProduct(prev => prev ? { ...prev, 'Descrição complementar': editedDescription, _isDirty: true } : null);
    setIsEditing(false);
  };

  const saveEditedSEO = () => {
    if (!previewProduct) return;
    
    setProducts(prev => {
      const updated = [...prev];
      const idx = updated.findIndex(p => p._id === previewProduct._id);
      if (idx !== -1) {
        updated[idx] = {
          ...updated[idx],
          'Título SEO': editedSEO.title,
          'Descrição SEO': editedSEO.description,
          'Palavras chave SEO': editedSEO.keywords,
          _statusSEO: 'Gerado por IA', // Mark as optimized if manual edit happened
          _isDirty: true
        };
      }
      return updated;
    });
    
    setPreviewProduct(prev => prev ? { 
      ...prev, 
      'Título SEO': editedSEO.title, 
      'Descrição SEO': editedSEO.description, 
      'Palavras chave SEO': editedSEO.keywords,
      _statusSEO: 'Gerado por IA',
      _isDirty: true 
    } : null);
    setIsEditingSEO(false);
  };

  const saveEditedInfo = () => {
    if (!previewProduct) return;
    
    setProducts(prev => {
      const updated = [...prev];
      const idx = updated.findIndex(p => p._id === previewProduct._id);
      if (idx !== -1) {
        updated[idx] = {
          ...updated[idx],
          ...editedInfo,
          _isDirty: true
        };
      }
      return updated;
    });
    
    setPreviewProduct(prev => prev ? { ...prev, ...editedInfo, _isDirty: true } : null);
    setIsEditingInfo(false);
  };

  const handleCopyHtml = () => {
    if (previewProduct?.['Descrição complementar']) {
      navigator.clipboard.writeText(previewProduct['Descrição complementar']);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    }
  };

  const handleRegeneratePreview = async () => {
    if (!previewProduct) return;
    if (!(await consumeCredit('Regeneração Individual', previewProduct['Descrição'], previewProduct['Código (SKU)']))) return;
    
    setPreviewProduct(prev => prev ? { ...prev, _isGenerating: true } : null);
    try {
      const generatedData = await generateDescriptionText(previewProduct, selectedTemplateId);
      setEditedDescription(generatedData.descricao_html);
      setPreviewProduct(prev => prev ? { 
        ...prev, 
        'Descrição complementar': generatedData.descricao_html,
        'Título SEO': generatedData.titulo_seo,
        'Descrição SEO': generatedData.descricao_seo,
        'Palavras chave SEO': generatedData.palavras_chave,
        _isGenerating: false 
      } : null);
      
      applyGenerationToProductAndChildren(previewProduct._id, generatedData);
    } catch (error) {
      alert("Erro ao regenerar descrição.");
      setPreviewProduct(prev => prev ? { ...prev, _isGenerating: false } : null);
    }
  };

  // UI Helpers
  const getStatusBadge = (status: Product['_statusDescricao']) => {
    switch (status) {
      case 'Gerado por IA':
        return (
          <div className="flex items-center justify-center w-5 h-5 rounded-md bg-green-100 text-green-700 border border-green-200" title="Sucesso: Descrição profissional gerada por Inteligência Artificial">
            <Check className="w-3 h-3" />
          </div>
        );
      case 'Descrição original':
        return (
          <div className="flex items-center justify-center w-5 h-5 rounded-md bg-blue-100 text-blue-700 border border-blue-200" title="Informação: Utilizando descrição original da planilha importada">
            <Search className="w-3 h-3" />
          </div>
        );
      case 'Sem descrição':
        return (
          <div className="flex items-center justify-center w-5 h-5 rounded-md bg-red-50 text-red-500 border border-red-100" title="Atenção: Este produto não possui descrição cadastrada">
            <X className="w-3 h-3" />
          </div>
        );
      default:
        return null;
    }
  };

  const getSeoBadge = (status: Product['_statusSEO']) => {
    switch (status) {
      case 'Gerado por IA':
        return (
          <div className="flex items-center justify-center w-5 h-5 rounded-md bg-emerald-100 text-emerald-700 border border-emerald-200" title="Sucesso: Títulos e meta-tags SEO gerados por Inteligência Artificial">
            <Globe className="w-3 h-3" />
          </div>
        );
      case 'Sem SEO':
        return (
          <div className="flex items-center justify-center w-5 h-5 rounded-md bg-red-50 text-red-500 border border-red-100" title="Atenção: Este produto não possui otimização SEO cadastrada">
            <X className="w-3 h-3" />
          </div>
        );
      default:
        return null;
    }
  };

  const formatPrice = (price: any) => {
    if (!price) return '-';
    const num = typeof price === 'string' ? parseFloat(price) : price;
    if (isNaN(num)) return price;
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(num);
  };

  const renderVariations = (product: Product) => {
    if (!product._children || product._children.length === 0) return null;
    
    // Extract unique attributes
    const allAttributes = new Set<string>();
    product._children.forEach(child => {
      const vars = child['Variações'];
      if (vars) {
        vars.split('||').forEach(v => allAttributes.add(v.trim()));
      }
    });

    return (
      <div className="flex flex-wrap gap-1 mt-1">
        {Array.from(allAttributes).map((attr, i) => (
          <span key={i} className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-800 border border-gray-200">
            {attr}
          </span>
        ))}
      </div>
    );
  };

  if (!isAuthReady) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6 text-center">
        <div className="bg-blue-600 p-4 rounded-2xl shadow-2xl animate-pulse mb-6">
          <Sparkles className="w-10 h-10 text-white" />
        </div>
        <div className="flex flex-col items-center gap-4">
            <div className="flex items-center gap-2">
                <RefreshCw className="w-4 h-4 text-blue-600 animate-spin" />
                <span className="text-gray-600 font-bold tracking-tight">Carregando Omni360...</span>
            </div>
            {isFirebaseUnavailable && (
                <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-xl max-w-sm">
                    <p className="text-xs text-red-800 font-medium">
                        Não foi possível conectar ao banco de dados Firestore. 
                        Verifique sua conexão ou as cotas do projeto Firebase.
                    </p>
                </div>
            )}
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginLanding onLogin={handleLogin} />;
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans">
      {isFirebaseUnavailable && (
        <div className="bg-red-600 text-white px-4 py-2 text-center text-sm font-medium flex items-center justify-center gap-2 sticky top-0 z-50">
          <AlertCircle className="w-4 h-4" />
          Serviços em nuvem indisponíveis no momento (Verifique cotas ou conexão).
        </div>
      )}
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-blue-600 p-2 rounded-lg">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">Gerador de Descrição - Omni360</h1>
          </div>
          
          <div>
            <input 
              type="file" 
              accept=".xlsx, .xls" 
              className="hidden" 
              ref={fileInputRef}
              onChange={handleFileUpload}
            />
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-3 mr-4 border-r border-gray-200 pr-4">
                <button
                  onClick={() => loadFromCloud()}
                  disabled={isLoadingFromCloud}
                  className="inline-flex items-center gap-2 px-3 py-1.5 bg-white border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                  title="Carregar projeto salvo na nuvem"
                >
                  <RefreshCw className={`w-4 h-4 ${isLoadingFromCloud ? 'animate-spin' : ''}`} />
                  Carregar Nuvem
                </button>
                <button
                  onClick={() => saveToCloud()}
                  disabled={isSavingToCloud || products.length === 0}
                  className={`inline-flex items-center gap-2 px-3 py-1.5 border rounded-md shadow-sm text-sm font-medium transition-colors ${
                    hasUnsavedChanges 
                      ? 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100' 
                      : 'bg-green-50 border-green-200 text-green-700 hover:bg-green-100'
                  } disabled:opacity-50`}
                  title={hasUnsavedChanges ? "Existem alterações não salvas" : "Tudo salvo na nuvem"}
                >
                  {isSavingToCloud ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : hasUnsavedChanges ? (
                    <Save className="w-4 h-4" />
                  ) : (
                    <Check className="w-4 h-4" />
                  )}
                  {isSavingToCloud ? 'Salvando...' : hasUnsavedChanges ? 'Salvar Nuvem' : 'Salvo'}
                </button>
                <button 
                  onClick={() => setIsCreditHistoryOpen(true)}
                  className="flex items-center gap-2 px-3 py-1 bg-amber-50 border border-amber-200 rounded-full text-amber-700 hover:bg-amber-100 transition-colors" 
                  title="Ver histórico de créditos"
                >
                  <Coins className="w-4 h-4" />
                  <span className="text-xs font-bold">{credits}</span>
                </button>
                <div className="w-px h-6 bg-gray-200 mx-1"></div>
                <img src={user.photoURL || ''} alt="User" className="w-8 h-8 rounded-full" />
                <button 
                  onClick={handleLogout}
                  className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1"
                  title="Sair"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full flex flex-col gap-6">
        
        {/* Tabs - Always Visible */}
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex space-x-8" aria-label="Tabs">
            <button
              onClick={() => setActiveTab('all')}
              className={`
                whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-all duration-200
                ${activeTab === 'all'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-400 hover:text-gray-700 hover:border-gray-300'
                }
              `}
              id="tab-importar-produtos"
            >
              <div className="flex items-center gap-2">
                <Upload className="w-4 h-4" />
                Importar Produtos
              </div>
            </button>
            <button
              onClick={() => {
                setActiveTab('processed');
                loadFromCloud(false);
              }}
              className={`
                whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-all duration-200
                ${activeTab === 'processed'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-400 hover:text-gray-700 hover:border-gray-300'
                }
              `}
            >
              Gerados / Aprimorados
            </button>
          </nav>
        </div>

        {activeTab === 'all' && products.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center border-2 border-dashed border-gray-300 rounded-xl bg-white p-12 text-center shadow-sm">
            <div className="bg-blue-50 p-4 rounded-full mb-4">
              <Upload className="w-12 h-12 text-blue-600" />
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-2 tracking-tight">Sua vitrine está vazia</h3>
            <p className="text-gray-500 mb-8 max-w-md">Importe uma planilha Excel (.xlsx) contendo as colunas necessárias para começar a gerar descrições profissionais com IA.</p>
            <div className="flex items-center gap-3">
              <button 
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-3 px-6 py-3 bg-blue-600 border border-transparent rounded-lg shadow-md text-sm font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-all transform hover:scale-[1.02]"
              >
                <FileSpreadsheet className="w-5 h-5" />
                Selecionar Planilha
              </button>
              <button
                onClick={downloadTemplate}
                className="inline-flex items-center gap-2 px-6 py-3 bg-white border border-gray-200 rounded-lg shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-50 transition-all"
              >
                <DownloadCloud className="w-5 h-5 text-blue-500" />
                Baixar Modelo
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Toolbar */}

            {/* Toolbar */}
            <div className="flex flex-col gap-4 mb-2">
              {/* Filter Row (Superior) */}
              <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 flex flex-wrap items-center gap-4">
                <div className="relative max-w-xs w-full">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Search className="h-4 w-4 text-gray-400" />
                  </div>
                  <input
                    type="text"
                    placeholder="Buscar por nome ou código..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  />
                </div>
                
                <div className="flex items-center gap-2">
                  <Filter className="h-4 w-4 text-gray-400" />
                  <select 
                    value={filterMarca} 
                    onChange={(e) => setFilterMarca(e.target.value)}
                    className="block w-full pl-3 pr-10 py-2 text-sm border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 rounded-md bg-white border"
                  >
                    <option value="">Todas as Marcas</option>
                    {marcas.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  <select 
                    value={filterCategoria} 
                    onChange={(e) => setFilterCategoria(e.target.value)}
                    className="block w-full pl-3 pr-10 py-2 text-sm border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 rounded-md bg-white border"
                  >
                    <option value="">Todas as Categorias</option>
                    {categorias.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  <select 
                    value={filterStatus} 
                    onChange={(e) => setFilterStatus(e.target.value)}
                    className="block w-full pl-3 pr-10 py-2 text-sm border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 rounded-md bg-white border"
                  >
                    <option value="">Todos os Status</option>
                    <option value="Sem descrição">Sem descrição</option>
                    <option value="Descrição original">Descrição original</option>
                    <option value="Gerado por IA">Gerado por IA</option>
                  </select>
                </div>
              </div>

              {/* Action Row */}
              <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
                <div className="flex items-center gap-4">
                  <span className="text-sm text-gray-500 font-medium whitespace-nowrap">
                    {selectedIds.size} selecionados
                  </span>
                  <div className="flex items-center gap-2 border-l border-gray-200 pl-4">
                    <select
                      value={selectedTemplateId}
                      onChange={(e) => setSelectedTemplateId(e.target.value)}
                      className="block w-48 pl-3 pr-8 py-2 text-sm border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 rounded-md bg-white border"
                    >
                      {templates.map(t => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => setIsTemplateModalOpen(true)}
                      className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                      title="Gerenciar Templates"
                    >
                      <Settings className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setIsColumnConfigOpen(!isColumnConfigOpen)}
                      className={`p-2 rounded-md transition-colors ${isColumnConfigOpen ? 'bg-blue-100 text-blue-600' : 'text-gray-500 hover:text-blue-600 hover:bg-blue-50'}`}
                      title="Configurar Colunas"
                    >
                      <Layout className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={handleEnrichMass}
                    disabled={selectedIds.size === 0 || isGeneratingMass || isEnrichingMass}
                    className={`inline-flex items-center gap-2 px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white transition-colors
                      ${selectedIds.size === 0 || isGeneratingMass || isEnrichingMass ? 'bg-purple-400 cursor-not-allowed' : 'bg-purple-600 hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500'}`}
                  >
                    {isEnrichingMass ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <Search className="w-4 h-4" />
                    )}
                    🔍 Enriquecer
                  </button>
                  <button
                    onClick={handleGenerateMass}
                    disabled={selectedIds.size === 0 || isGeneratingMass || isEnrichingMass}
                    className={`inline-flex items-center gap-2 px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white transition-colors
                      ${selectedIds.size === 0 || isGeneratingMass || isEnrichingMass ? 'bg-blue-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500'}`}
                  >
                    {isGeneratingMass ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <Play className="w-4 h-4" />
                    )}
                    🚀 Gerar Descrição
                  </button>
                </div>
              </div>
            </div>

            {/* Column Configuration Overlay */}
            {isColumnConfigOpen && (
              <div className="bg-white p-4 rounded-xl shadow-md border border-gray-200 grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3 animate-in fade-in slide-in-from-top-1 duration-200 mb-4">
                {Object.keys(visibleColumns).map(col => (
                  <label key={col} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-1 rounded transition-colors">
                    <input
                      type="checkbox"
                      checked={visibleColumns[col]}
                      onChange={() => setVisibleColumns(prev => ({ ...prev, [col]: !prev[col] }))}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <span className="text-sm text-gray-700">{col}</span>
                  </label>
                ))}
              </div>
            )}

            {/* Mass Generation Progress */}
            {(isGeneratingMass || isEnrichingMass) && (
              <div className="bg-white p-4 rounded-xl shadow-sm border border-blue-200 flex flex-col gap-2 mb-4">
                <div className="flex justify-between text-sm font-medium text-gray-700">
                  <span>{isEnrichingMass ? 'Progresso do Enriquecimento' : 'Progresso da Geração'}</span>
                  <span>{generationProgress.current} / {generationProgress.total}</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2.5">
                  <div 
                    className={`${isEnrichingMass ? 'bg-purple-600' : 'bg-blue-600'} h-2.5 rounded-full transition-all duration-300`} 
                    style={{ width: `${(generationProgress.current / generationProgress.total) * 100}%` }}
                  ></div>
                </div>
                <p className="text-sm text-gray-500 animate-pulse">{generationLog}</p>
              </div>
            )}

            {/* Table */}
            <div className="bg-white shadow-sm border border-gray-200 rounded-xl overflow-hidden flex-1 flex flex-col">
              <div className="overflow-x-auto relative">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-12 bg-gray-50">
                        <input
                          type="checkbox"
                          className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded cursor-pointer"
                          checked={selectedIds.size === filteredProducts.length && filteredProducts.length > 0}
                          onChange={toggleSelectAll}
                        />
                      </th>
                      {visibleColumns['Img'] && <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-16 bg-gray-50">Img</th>}
                      {visibleColumns['SKU'] && <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50">SKU</th>}
                      {visibleColumns['Descrição'] && <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50">Descrição</th>}
                      {visibleColumns['Categoria'] && <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50">Categoria</th>}
                      {visibleColumns['Marca'] && <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50">Marca</th>}
                      {visibleColumns['Estoque'] && <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50">Estoque</th>}
                      {visibleColumns['GTIN/EAN'] && <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50">GTIN/EAN</th>}
                      {visibleColumns['Preço'] && <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50">Preço</th>}
                      {visibleColumns['Situação'] && <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50">Situação</th>}
                      {visibleColumns['Tipo'] && <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50">Tipo</th>}
                      {visibleColumns['Variações'] && <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50">Variações</th>}
                      <th 
                        scope="col" 
                        className="sticky right-0 px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50 shadow-[-10px_0_15px_-3px_rgba(0,0,0,0.1)] z-30 font-bold border-l border-gray-200 min-w-[200px]"
                      >
                        <div className="flex items-center justify-end gap-4">
                          <div className="flex items-center gap-2">
                             {visibleColumns['SEO'] && <Globe className="w-3 h-3 text-gray-400" title="SEO" />}
                             {visibleColumns['Status Desc.'] && <FileText className="w-3 h-3 text-gray-400" title="Status Desc." />}
                          </div>
                          <span>Ações</span>
                        </div>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {paginatedProducts.map((product) => {
                      const imageUrl = product['URL imagem 1'] || product['URL imagem externa 1'];
                      return (
                      <tr key={product._id} className={`hover:bg-gray-50 transition-colors ${selectedIds.has(product._id) ? 'bg-blue-50/50' : ''}`}>
                        <td className="px-6 py-4 whitespace-nowrap bg-white/50">
                          <input
                            type="checkbox"
                            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded cursor-pointer"
                            checked={selectedIds.has(product._id)}
                            onChange={() => toggleSelection(product._id)}
                          />
                        </td>
                        {visibleColumns['Img'] && (
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div 
                              className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity"
                              onClick={() => {
                                setCurrentImageSearchProduct(product);
                                setIsImageSearchModalOpen(true);
                              }}
                              title="Clique para gerenciar imagem"
                            >
                              {product._selectedImage ? (
                                <img src={product._selectedImage} alt="" className="h-10 w-10 rounded object-cover border border-gray-200 shadow-sm" referrerPolicy="no-referrer" />
                              ) : imageUrl ? (
                                <img src={imageUrl} alt="" className="h-10 w-10 rounded object-cover border border-gray-200 shadow-sm" referrerPolicy="no-referrer" />
                              ) : (
                                <div className="h-10 w-10 rounded bg-gray-50 flex items-center justify-center border border-gray-200 border-dashed">
                                  <ImageIcon className="w-4 h-4 text-gray-400" />
                                </div>
                              )}
                            </div>
                          </td>
                        )}
                        {visibleColumns['SKU'] && (
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 font-mono">
                            {product['Código (SKU)']}
                          </td>
                        )}
                        {visibleColumns['Descrição'] && (
                          <td className="px-6 py-4 text-sm font-medium text-gray-900 max-w-xs truncate" title={product['Descrição']}>
                            {product['Descrição']}
                          </td>
                        )}
                        {visibleColumns['Categoria'] && (
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 max-w-[150px] truncate" title={product['Categoria']}>
                            {product['Categoria']}
                          </td>
                        )}
                        {visibleColumns['Marca'] && (
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {product['Marca']}
                          </td>
                        )}
                        {visibleColumns['Estoque'] && (
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {product['Estoque'] || '-'}
                          </td>
                        )}
                        {visibleColumns['GTIN/EAN'] && (
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 font-mono">
                            {product['GTIN/EAN'] || '-'}
                          </td>
                        )}
                        {visibleColumns['Preço'] && (
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-medium">
                            {formatPrice(product['Preço'])}
                          </td>
                        )}
                        {visibleColumns['Situação'] && (
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${product['Situação'] === 'Ativo' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`}>
                              {product['Situação'] || 'Inativo'}
                            </span>
                          </td>
                        )}
                        {visibleColumns['Tipo'] && (
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-700">
                              {product['Tipo do produto'] === 'K' ? 'Kit' : product['Tipo do produto'] === 'V' ? 'Variação' : 'Simples'}
                            </span>
                          </td>
                        )}
                        {visibleColumns['Variações'] && (
                          <td className="px-6 py-4 max-w-[200px]">
                            {renderVariations(product)}
                          </td>
                        )}
                        <td 
                          className="sticky right-0 px-6 py-4 whitespace-nowrap text-right text-sm font-medium border-l border-gray-200 bg-white shadow-[-10px_0_15px_-3px_rgba(0,0,0,0.1)] z-10 transition-colors group-hover:bg-gray-50 min-w-[200px]"
                        >
                          <div className="flex items-center justify-end gap-3">
                            <div className="flex items-center gap-1.5 mr-2">
                               {visibleColumns['SEO'] && getSeoBadge(product._statusSEO)}
                               {visibleColumns['Status Desc.'] && getStatusBadge(product._statusDescricao)}
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => handleEnrichSingle(product._id)}
                                disabled={product._isEnriching || isGeneratingMass || isEnrichingMass}
                                className="text-purple-600 hover:text-purple-900 bg-purple-50 hover:bg-purple-100 p-1.5 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                title="Enriquecer"
                              >
                                <Search className={`w-4 h-4 ${product._isEnriching ? 'animate-spin' : ''}`} />
                              </button>
                              <button
                                onClick={() => handleGenerateSingle(product._id)}
                                disabled={product._isGenerating || isGeneratingMass || isEnrichingMass}
                                className="text-blue-600 hover:text-blue-900 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 text-xs"
                                title="Gerar Descrição"
                              >
                                <Play className={`w-4 h-4 ${product._isGenerating ? 'animate-spin' : ''}`} />
                                Gerar Descrição
                              </button>
                              <button
                                onClick={() => openPreview(product)}
                                className="text-gray-600 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 p-1.5 rounded-md transition-colors"
                                title="Visualizar"
                              >
                                <Eye className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                      </td>
                    </tr>
                    )})}
                    {filteredProducts.length === 0 && (
                      <tr>
                        <td colSpan={20} className="px-6 py-12 text-center text-gray-500">
                          Nenhum produto encontrado com os filtros atuais.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Pagination Controls */}
            <div className="bg-white px-6 py-4 border-t border-gray-200 flex flex-col sm:flex-row items-center justify-between gap-4 rounded-b-xl shadow-sm">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-600">Produtos por página:</span>
                    <select
                      value={itemsPerPage}
                      onChange={(e) => {
                        setItemsPerPage(Number(e.target.value));
                        setCurrentPage(1);
                      }}
                      className="text-sm border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 py-1"
                    >
                      <option value={10}>10</option>
                      <option value={25}>25</option>
                      <option value={50}>50</option>
                    </select>
                  </div>
                  <span className="text-sm text-gray-500">
                    Mostrando <span className="font-medium">{Math.min(filteredProducts.length, (currentPage - 1) * itemsPerPage + 1)}</span> a <span className="font-medium">{Math.min(filteredProducts.length, currentPage * itemsPerPage)}</span> de <span className="font-medium">{filteredProducts.length}</span> produtos
                  </span>
                </div>
                
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                    disabled={currentPage === 1}
                    className="p-2 border border-gray-300 rounded-md text-gray-500 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <div className="flex gap-1">
                    {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                      let pageNum;
                      if (totalPages <= 5) pageNum = i + 1;
                      else if (currentPage <= 3) pageNum = i + 1;
                      else if (currentPage >= totalPages - 2) pageNum = totalPages - 4 + i;
                      else pageNum = currentPage - 2 + i;
                      
                      return (
                        <button
                          key={pageNum}
                          onClick={() => setCurrentPage(pageNum)}
                          className={`w-8 h-8 rounded-md text-sm font-medium transition-colors ${
                            currentPage === pageNum 
                              ? 'bg-blue-600 text-white' 
                              : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                          }`}
                        >
                          {pageNum}
                        </button>
                      );
                    })}
                  </div>
                  <button
                    onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                    disabled={currentPage === totalPages || totalPages === 0}
                    className="p-2 border border-gray-300 rounded-md text-gray-500 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
            </div>
          </>
        )}
      </main>

      {/* Footer */}
      {products.length > 0 && (
        <footer className="bg-white border-t border-gray-200 py-4 mt-auto">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between">
            <div className="text-sm text-gray-500">
              <span className="font-medium text-gray-900">{products.length}</span> produtos carregados
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400 font-medium whitespace-nowrap">Modelo:</span>
                <select
                  value={exportModel}
                  onChange={(e) => setExportModel(e.target.value as any)}
                  className="block w-40 pl-2 pr-6 py-1.5 text-xs border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 rounded-md bg-white border"
                >
                  <option value="standard">Padrão Sistema</option>
                  <option value="tinyerp">Tiny ERP</option>
                </select>
              </div>
              <button
                onClick={handleExport}
                className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
              >
              <Download className="w-4 h-4" />
              📥 Exportar para Excel (.xlsx)
            </button>
          </div>
        </div>
      </footer>
      )}

      {/* Preview Modal */}
      {previewProduct && (
        <div className="fixed inset-0 z-50 overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
          <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 bg-gray-900/50 transition-opacity" aria-hidden="true" onClick={() => setPreviewProduct(null)}></div>
            <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
            <div className="relative z-10 inline-block align-bottom bg-white rounded-xl text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-4xl w-full">
              
              <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                <div className="flex justify-between items-start mb-5 pb-4 border-b border-gray-100">
                  <div className="flex items-center gap-4">
                    {previewProduct['URL imagem 1'] || previewProduct['URL imagem externa 1'] ? (
                      <img src={previewProduct['URL imagem 1'] || previewProduct['URL imagem externa 1']} alt="" className="h-16 w-16 rounded-lg object-cover border border-gray-200 shadow-sm" referrerPolicy="no-referrer" />
                    ) : (
                      <div className="h-16 w-16 rounded-lg bg-gray-100 flex items-center justify-center border border-gray-200">
                        <span className="text-xs text-gray-400">Sem img</span>
                      </div>
                    )}
                    <div>
                      <h3 className="text-lg leading-6 font-bold text-gray-900" id="modal-title">
                        {previewProduct['Descrição']}
                      </h3>
                      <div className="mt-1 flex items-center gap-3 text-sm text-gray-500">
                        <span className="font-mono bg-gray-100 px-2 py-0.5 rounded">{previewProduct['Código (SKU)']}</span>
                        <span>•</span>
                        <span>{previewProduct['Marca']}</span>
                        <span>•</span>
                        <span>{previewProduct['Categoria']}</span>
                        <span>•</span>
                        <span className={previewProduct['Situação'] === 'Ativo' ? 'text-green-600 font-medium' : ''}>{previewProduct['Situação']}</span>
                      </div>
                    </div>
                  </div>
                  <button onClick={() => setPreviewProduct(null)} className="text-gray-400 hover:text-gray-500 bg-gray-50 hover:bg-gray-100 rounded-full p-1 transition-colors">
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                  {/* Info Block */}
                  <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                    <div className="flex justify-between items-center mb-3">
                      <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Informações</h4>
                      <button 
                        onClick={() => setIsEditingInfo(!isEditingInfo)}
                        className="text-[10px] text-blue-600 hover:bg-blue-50 px-1.5 py-0.5 rounded"
                      >
                        {isEditingInfo ? 'Cancelar' : 'Editar'}
                      </button>
                    </div>
                    {isEditingInfo ? (
                      <div className="space-y-2">
                        <div>
                          <label className="text-[10px] text-gray-400 block">GTIN/EAN</label>
                          <input 
                            type="text" 
                            value={editedInfo['GTIN/EAN'] || ''} 
                            onChange={(e) => setEditedInfo(prev => ({ ...prev, 'GTIN/EAN': e.target.value }))}
                            className="w-full text-xs p-1 border rounded"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-gray-400 block">Preço</label>
                          <input 
                            type="number" 
                            step="0.01"
                            value={editedInfo['Preço'] || 0} 
                            onChange={(e) => setEditedInfo(prev => ({ ...prev, 'Preço': Number(e.target.value) }))}
                            className="w-full text-xs p-1 border rounded"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-gray-400 block">Estoque</label>
                          <input 
                            type="number" 
                            value={editedInfo['Estoque'] || 0} 
                            onChange={(e) => setEditedInfo(prev => ({ ...prev, 'Estoque': Number(e.target.value) }))}
                            className="w-full text-xs p-1 border rounded"
                          />
                        </div>
                        <button 
                          onClick={saveEditedInfo}
                          className="w-full bg-blue-600 text-white text-[10px] py-1 rounded mt-2 hover:bg-blue-700"
                        >
                          Salvar Infos
                        </button>
                      </div>
                    ) : (
                      <dl className="space-y-2 text-sm">
                        <div className="flex justify-between"><dt className="text-gray-500">GTIN/EAN:</dt><dd className="font-medium text-gray-900 font-mono text-xs">{previewProduct['GTIN/EAN'] || '-'}</dd></div>
                        <div className="flex justify-between"><dt className="text-gray-500">NCM:</dt><dd className="font-medium text-gray-900 font-mono text-[10px]">{previewProduct['NCM (Classificação fiscal)'] || '-'}</dd></div>
                        <div className="flex justify-between"><dt className="text-gray-500">Preço:</dt><dd className="font-medium text-gray-900">{formatPrice(previewProduct['Preço'])}</dd></div>
                        {previewProduct['Preço promocional'] && <div className="flex justify-between"><dt className="text-gray-500">Preço Promo:</dt><dd className="font-medium text-green-600">{formatPrice(previewProduct['Preço promocional'])}</dd></div>}
                        <div className="flex justify-between"><dt className="text-gray-500">Estoque:</dt><dd className="font-medium text-gray-900">{previewProduct['Estoque']}</dd></div>
                        <div className="flex justify-between"><dt className="text-gray-500">Peso:</dt><dd className="font-medium text-gray-900">{previewProduct['Peso bruto (Kg)']} kg</dd></div>
                      </dl>
                    )}
                  </div>

                  {/* Variations Block */}
                  <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                    <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Variações ({previewProduct._children?.length || 0})</h4>
                    {previewProduct._children && previewProduct._children.length > 0 ? (
                      <div className="space-y-2 max-h-40 overflow-y-auto">
                        {previewProduct._children.map(child => (
                          <div key={child._id} className="text-sm bg-white p-2 rounded border border-gray-100 flex flex-col gap-1">
                            <span className="font-mono text-xs text-gray-500">{child['Código (SKU)']}</span>
                            <div className="flex flex-wrap gap-1">
                              {child['Variações']?.split('||').map((v, i) => (
                                <span key={i} className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-700 border border-blue-100">
                                  {v.trim()}
                                </span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-500 italic">Produto simples, sem variações.</p>
                    )}
                  </div>

                  {/* SEO Block */}
                  <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                    <div className="flex justify-between items-center mb-3">
                      <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-2">
                        SEO Gerado
                        {getSeoBadge(previewProduct._statusSEO)}
                      </h4>
                      <button 
                        onClick={() => setIsEditingSEO(!isEditingSEO)}
                        className="text-[10px] text-blue-600 hover:bg-blue-50 px-1.5 py-0.5 rounded"
                      >
                        {isEditingSEO ? 'Cancelar' : 'Editar'}
                      </button>
                    </div>
                    {isEditingSEO ? (
                      <div className="space-y-3">
                        <div>
                          <label className="text-[10px] text-gray-400 block mb-1">Título SEO</label>
                          <input 
                            type="text" 
                            value={editedSEO.title} 
                            onChange={(e) => setEditedSEO(prev => ({ ...prev, title: e.target.value }))}
                            className="w-full text-xs p-1 border rounded"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-gray-400 block mb-1">Descrição SEO</label>
                          <textarea 
                            value={editedSEO.description} 
                            onChange={(e) => setEditedSEO(prev => ({ ...prev, description: e.target.value }))}
                            className="w-full text-xs p-1 border rounded h-16"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-gray-400 block mb-1">Keywords</label>
                          <input 
                            type="text" 
                            value={editedSEO.keywords} 
                            onChange={(e) => setEditedSEO(prev => ({ ...prev, keywords: e.target.value }))}
                            className="w-full text-xs p-1 border rounded"
                          />
                        </div>
                        <button 
                          onClick={saveEditedSEO}
                          className="w-full bg-blue-600 text-white text-[10px] py-1 rounded mt-2 hover:bg-blue-700"
                        >
                          Salvar SEO
                        </button>
                      </div>
                    ) : (
                      <dl className="space-y-3 text-sm">
                        <div>
                          <dt className="text-gray-500 mb-1 flex justify-between">
                            <span>Título SEO</span>
                            <span className={`text-[10px] ${previewProduct['Título SEO']?.length > 60 ? 'text-red-500' : 'text-gray-400'}`}>
                              {previewProduct['Título SEO']?.length || 0}/60
                            </span>
                          </dt>
                          <dd className="font-medium text-gray-900 bg-white p-2 rounded border border-gray-100 text-xs truncate" title={previewProduct['Título SEO']}>{previewProduct['Título SEO'] || '-'}</dd>
                        </div>
                        <div>
                          <dt className="text-gray-500 mb-1 flex justify-between">
                            <span>Descrição SEO</span>
                            <span className={`text-[10px] ${previewProduct['Descrição SEO']?.length > 160 ? 'text-red-500' : 'text-gray-400'}`}>
                              {previewProduct['Descrição SEO']?.length || 0}/160
                            </span>
                          </dt>
                          <dd className="font-medium text-gray-900 bg-white p-2 rounded border border-gray-100 text-[10px] line-clamp-2">{previewProduct['Descrição SEO'] || '-'}</dd>
                        </div>
                        <div>
                          <dt className="text-gray-500 mb-1">Palavras-chave</dt>
                          <dd className="font-medium text-gray-900 bg-white p-2 rounded border border-gray-100 text-[10px] line-clamp-2">{previewProduct['Palavras chave SEO'] || '-'}</dd>
                        </div>
                      </dl>
                    )}
                  </div>
                </div>

                <div className="mt-2">
                  {/* Token Usage Block */}
                  {previewProduct._tokenUsage && (
                    <div className="bg-green-50 p-4 rounded-lg border border-green-200 mb-6">
                      <h4 className="text-xs font-semibold text-green-800 uppercase tracking-wider mb-3 flex items-center gap-2">
                        <RefreshCw className="w-4 h-4" />
                        Consumo de Tokens (Gemini API)
                      </h4>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        {previewProduct._tokenUsage.enrichment && (
                          <div className="bg-white p-2 rounded border border-green-100">
                            <p className="text-[10px] text-green-600 font-bold uppercase mb-1">Enriquecimento</p>
                            <div className="flex justify-between text-xs"><span className="text-gray-500">Prompt:</span><span className="font-mono">{previewProduct._tokenUsage.enrichment.promptTokens}</span></div>
                            <div className="flex justify-between text-xs"><span className="text-gray-500">Resposta:</span><span className="font-mono">{previewProduct._tokenUsage.enrichment.completionTokens}</span></div>
                            <div className="flex justify-between text-xs font-bold border-t border-green-50 mt-1 pt-1"><span>Total:</span><span className="font-mono">{previewProduct._tokenUsage.enrichment.totalTokens}</span></div>
                          </div>
                        )}
                        {previewProduct._tokenUsage.generation && (
                          <div className="bg-white p-2 rounded border border-green-100">
                            <p className="text-[10px] text-green-600 font-bold uppercase mb-1">Geração SEO</p>
                            <div className="flex justify-between text-xs"><span className="text-gray-500">Prompt:</span><span className="font-mono">{previewProduct._tokenUsage.generation.promptTokens}</span></div>
                            <div className="flex justify-between text-xs"><span className="text-gray-500">Resposta:</span><span className="font-mono">{previewProduct._tokenUsage.generation.completionTokens}</span></div>
                            <div className="flex justify-between text-xs font-bold border-t border-green-50 mt-1 pt-1"><span>Total:</span><span className="font-mono">{previewProduct._tokenUsage.generation.totalTokens}</span></div>
                          </div>
                        )}
                        {previewProduct._tokenUsage.images && (
                          <div className="bg-white p-2 rounded border border-green-100">
                            <p className="text-[10px] text-green-600 font-bold uppercase mb-1">Ambientações</p>
                            <div className="flex justify-between text-xs"><span className="text-gray-500">Prompt:</span><span className="font-mono">{previewProduct._tokenUsage.images.promptTokens}</span></div>
                            <div className="flex justify-between text-xs"><span className="text-gray-500">Resposta:</span><span className="font-mono">{previewProduct._tokenUsage.images.completionTokens}</span></div>
                            <div className="flex justify-between text-xs font-bold border-t border-green-50 mt-1 pt-1"><span>Total:</span><span className="font-mono">{previewProduct._tokenUsage.images.totalTokens}</span></div>
                          </div>
                        )}
                      </div>
                      <div className="mt-3 pt-2 border-t border-green-100 flex flex-col gap-1">
                        <div className="flex justify-between items-center">
                          <span className="text-xs text-green-700 font-medium">Total Consumido no Produto:</span>
                          <span className="text-sm font-bold text-green-800 font-mono">
                            {(previewProduct._tokenUsage.enrichment?.totalTokens || 0) + 
                             (previewProduct._tokenUsage.generation?.totalTokens || 0) + 
                             (previewProduct._tokenUsage.images?.totalTokens || 0)} tokens
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Enrichment Log Block */}
                  {previewProduct._enrichmentLog && (
                    <div className="bg-purple-50 p-4 rounded-lg border border-purple-200 mb-6">
                      <h4 className="text-xs font-semibold text-purple-800 uppercase tracking-wider mb-2 flex items-center gap-2">
                        <Search className="w-4 h-4" />
                        Log de Enriquecimento (Fontes)
                      </h4>
                      <p className="text-sm text-purple-900 whitespace-pre-wrap">{previewProduct._enrichmentLog}</p>
                    </div>
                  )}

                  {/* Generation Log Block */}
                  {previewProduct._generationLog && (
                    <div className="bg-blue-50 p-4 rounded-lg border border-blue-200 mb-6">
                      <h4 className="text-xs font-semibold text-blue-800 uppercase tracking-wider mb-2 flex items-center gap-2">
                        <Sparkles className="w-4 h-4" />
                        Prompt Enviado para a IA (Log de Geração)
                      </h4>
                      <div className="text-xs text-blue-900 whitespace-pre-wrap font-mono max-h-40 overflow-y-auto bg-white p-3 rounded border border-blue-100">
                        {previewProduct._generationLog}
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-between mb-3 border-b border-gray-100 pb-2">
                    <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wider flex items-center gap-2">
                      Descrição Complementar
                      {getStatusBadge(previewProduct._statusDescricao)}
                    </h4>
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => {
                          if (isEditing) {
                            // If canceling, reset edited description to current product description
                            setEditedDescription(previewProduct['Descrição complementar'] || '');
                          }
                          setIsEditing(!isEditing);
                        }}
                        className="text-xs text-blue-600 hover:text-blue-800 font-medium px-2 py-1 rounded hover:bg-blue-50 transition-colors flex items-center gap-1"
                      >
                        {isEditing ? 'Cancelar Edição' : <><Edit className="w-3 h-3" /> Editar Descrição</>}
                      </button>
                    </div>
                  </div>

                  <div className={cn("space-y-4", !isEditing && "quill-view-mode")}>
                    <div className={cn("quill-editor-wrapper transition-all duration-200", isEditing ? "h-80" : "max-h-[50vh] overflow-y-auto rounded-lg border border-gray-200 bg-gray-50")}>
                      <ReactQuill
                        theme="snow"
                        value={isEditing ? editedDescription : (previewProduct['Descrição complementar'] || '')}
                        onChange={isEditing ? setEditedDescription : undefined}
                        readOnly={!isEditing}
                        placeholder="Este produto ainda não possui uma descrição."
                        className={cn(isEditing ? "h-64" : "quill-readonly-view")}
                        modules={{
                          toolbar: isEditing ? [
                            [{ 'header': [1, 2, 3, false] }],
                            ['bold', 'italic', 'underline', 'strike'],
                            [{ 'list': 'ordered' }, { 'list': 'bullet' }],
                            ['clean']
                          ] : false,
                        }}
                      />
                    </div>
                    
                    {isEditing && (
                      <div className="flex justify-end pt-4">
                        <button
                          onClick={saveEditedDescription}
                          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 border border-transparent rounded-md shadow-sm text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                        >
                          <Save className="w-4 h-4" />
                          Salvar Descrição
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              
              <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse border-t border-gray-200">
                <button
                  type="button"
                  onClick={handleRegeneratePreview}
                  disabled={previewProduct._isGenerating}
                  className="w-full inline-flex justify-center items-center gap-2 rounded-md border border-transparent shadow-sm px-4 py-2 bg-blue-600 text-base font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:ml-3 sm:w-auto sm:text-sm disabled:opacity-50"
                >
                  {previewProduct._isGenerating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  Regenerar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Template Management Modal */}
      {isTemplateModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto" aria-labelledby="template-modal-title" role="dialog" aria-modal="true">
          <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 bg-gray-900/50 transition-opacity" aria-hidden="true" onClick={() => setIsTemplateModalOpen(false)}></div>
            <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
            <div className="relative z-10 inline-block align-bottom bg-white rounded-xl text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-5xl w-full">
              
              <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                <div className="flex justify-between items-start mb-5 pb-4 border-b border-gray-100">
                  <h3 className="text-lg leading-6 font-bold text-gray-900" id="template-modal-title">
                    Gerenciar Templates
                  </h3>
                  <button onClick={() => setIsTemplateModalOpen(false)} className="text-gray-400 hover:text-gray-500 bg-gray-50 hover:bg-gray-100 rounded-full p-1 transition-colors">
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="flex flex-col md:flex-row gap-6">
                  {/* Template List */}
                  <div className="w-full md:w-1/3 border-r border-gray-200 pr-4">
                    <div className="flex justify-between items-center mb-4">
                      <h4 className="font-medium text-gray-900">Seus Templates</h4>
                      <button 
                        onClick={() => setEditingTemplate({ id: `temp_${Date.now()}`, name: 'Novo Template', prompt: '' })}
                        className="p-1 text-blue-600 hover:bg-blue-50 rounded"
                        title="Novo Template"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                    <ul className="space-y-2 max-h-[60vh] overflow-y-auto">
                      {templates.map(t => (
                        <li key={t.id} className="flex items-center justify-between group">
                          <button
                            onClick={() => setEditingTemplate(t)}
                            className={`flex-1 text-left px-3 py-2 rounded-md text-sm truncate ${editingTemplate?.id === t.id ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700 hover:bg-gray-50'}`}
                          >
                            {t.name}
                          </button>
                          {t.id !== 'default' && (
                            <button
                              onClick={() => {
                                const newTemplates = templates.filter(temp => temp.id !== t.id);
                                setTemplates(newTemplates);
                                if (selectedTemplateId === t.id) setSelectedTemplateId('default');
                                if (editingTemplate?.id === t.id) setEditingTemplate(null);
                              }}
                              className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                              title="Excluir Template"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Template Editor */}
                  <div className="w-full md:w-2/3 pl-2">
                    {editingTemplate ? (
                      <div className="space-y-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Nome do Template</label>
                          <input
                            type="text"
                            value={editingTemplate.name}
                            onChange={(e) => setEditingTemplate({...editingTemplate, name: e.target.value})}
                            disabled={editingTemplate.id === 'default'}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 sm:text-sm disabled:bg-gray-100"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Prompt e Estrutura HTML
                            <span className="ml-2 text-xs text-gray-500 font-normal">
                              Variáveis: {'{NOME}'}, {'{MARCA}'}, {'{CATEGORIAS}'}, {'{CATEGORIA_SUPERIOR}'}
                            </span>
                          </label>
                          <textarea
                            value={editingTemplate.prompt}
                            onChange={(e) => setEditingTemplate({...editingTemplate, prompt: e.target.value})}
                            disabled={editingTemplate.id === 'default'}
                            className="w-full h-96 p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 font-mono text-sm disabled:bg-gray-100"
                            placeholder="Escreva o prompt para a IA aqui..."
                          />
                        </div>
                        {editingTemplate.id !== 'default' && (
                          <div className="flex justify-end">
                            <button
                              onClick={() => {
                                const exists = templates.find(t => t.id === editingTemplate.id);
                                if (exists) {
                                  setTemplates(templates.map(t => t.id === editingTemplate.id ? editingTemplate : t));
                                } else {
                                  setTemplates([...templates, editingTemplate]);
                                  setSelectedTemplateId(editingTemplate.id);
                                }
                                setEditingTemplate(null);
                              }}
                              disabled={!editingTemplate.name.trim() || !editingTemplate.prompt.trim()}
                              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 border border-transparent rounded-md shadow-sm text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <Save className="w-4 h-4" />
                              Salvar Template
                            </button>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center text-gray-500 py-12">
                        <Settings className="w-12 h-12 text-gray-300 mb-4" />
                        <p>Selecione um template para editar ou crie um novo.</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Credit History Modal */}
      {isCreditHistoryOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:p-0">
            <div className="fixed inset-0 transition-opacity bg-gray-500 bg-opacity-75" onClick={() => setIsCreditHistoryOpen(false)} />
            <div className="relative inline-block w-full max-w-2xl p-6 overflow-hidden text-left align-middle transition-all transform bg-white shadow-xl rounded-2xl">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <Coins className="w-6 h-6 text-amber-500" />
                  <h3 className="text-lg font-medium leading-6 text-gray-900">Histórico de Créditos</h3>
                </div>
                <button onClick={() => setIsCreditHistoryOpen(false)} className="text-gray-400 hover:text-gray-500">
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="mb-6 p-4 bg-amber-50 rounded-lg border border-amber-100 flex items-center justify-between">
                <div>
                  <p className="text-sm text-amber-800 font-medium">Saldo Atual</p>
                  <p className="text-2xl font-bold text-amber-900">{credits} créditos</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-amber-600">Para recarregar, entre em contato</p>
                  <p className="text-xs text-amber-600">com o administrador do sistema.</p>
                </div>
              </div>

              <div className="max-h-[400px] overflow-y-auto">
                {isLoadingLogs ? (
                  <div className="flex flex-col items-center justify-center py-12">
                    <RefreshCw className="w-8 h-8 text-blue-600 animate-spin mb-4" />
                    <p className="text-gray-500">Carregando histórico...</p>
                  </div>
                ) : creditLogs.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <AlertCircle className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                    <p>Nenhum consumo registrado ainda.</p>
                  </div>
                ) : (
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-2 text-left text-[10px] font-bold text-gray-500 uppercase">Data/Hora</th>
                        <th className="px-4 py-2 text-left text-[10px] font-bold text-gray-500 uppercase">Ação</th>
                        <th className="px-4 py-2 text-left text-[10px] font-bold text-gray-500 uppercase">Produto/SKU</th>
                        <th className="px-4 py-2 text-right text-[10px] font-bold text-gray-500 uppercase">Custo</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {creditLogs.map((log) => (
                        <tr key={log.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-3 whitespace-nowrap text-xs text-gray-500">
                            {new Date(log.timestamp).toLocaleString('pt-BR')}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className="text-xs font-medium text-gray-900">{log.actionType}</span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="text-xs text-gray-900 truncate max-w-[200px]" title={log.productName}>
                              {log.productName}
                            </div>
                            <div className="text-[10px] text-gray-500 font-mono">{log.sku}</div>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-right text-xs font-bold text-amber-600">
                            -{log.creditsConsumed}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Mass Action Confirmation Modal */}
      <AnimatePresence>
        {showMassActionConfirm && showMassActionConfirm.isOpen && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-md p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden border border-gray-100"
            >
              <div className="p-6">
                <div className="flex items-center gap-4 mb-6">
                  <div className={`p-3 rounded-xl ${showMassActionConfirm.type === 'generate' ? 'bg-blue-50 text-blue-600' : 'bg-purple-50 text-purple-600'}`}>
                    {showMassActionConfirm.type === 'generate' ? <Sparkles className="w-8 h-8" /> : <Search className="w-8 h-8" />}
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-gray-900">Confirmar Ação em Massa</h3>
                    <p className="text-sm text-gray-500">Esta ação processará múltiplos produtos.</p>
                  </div>
                </div>

                <div className="bg-gray-50 rounded-xl p-4 mb-6 space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Produtos selecionados:</span>
                    <span className="font-bold text-gray-900">{showMassActionConfirm.count}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Ação:</span>
                    <span className="font-medium text-gray-900 uppercase">
                      {showMassActionConfirm.type === 'generate' ? 'Geração de Descrição IA' : 'Enriquecimento de Dados'}
                    </span>
                  </div>
                  <div className="border-t border-gray-200 pt-3 flex justify-between items-center">
                    <span className="text-gray-900 font-medium">Custo total previsto:</span>
                    <div className="flex items-center gap-1.5 px-3 py-1 bg-amber-100 text-amber-700 rounded-full text-sm font-bold">
                      <Database className="w-4 h-4" />
                      {showMassActionConfirm.creditsNeeded} créditos
                    </div>
                  </div>
                </div>

                <p className="text-xs text-gray-400 mb-6 italic text-center text-balance px-4">
                  Os créditos serão descontados unitariamente para cada produto processado com sucesso.
                </p>

                <div className="flex gap-3">
                  <button
                    onClick={() => setShowMassActionConfirm(null)}
                    className="flex-1 px-4 py-3 bg-gray-100 text-gray-700 rounded-xl font-bold hover:bg-gray-200 transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={() => {
                      if (showMassActionConfirm.type === 'generate') {
                        startGenerateMass();
                      } else {
                        startEnrichMass();
                      }
                    }}
                    className={`flex-1 px-4 py-3 text-white rounded-xl font-bold shadow-lg shadow-opacity-20 transition-all transform hover:scale-[1.02] active:scale-[0.98]
                      ${showMassActionConfirm.type === 'generate' ? 'bg-blue-600 hover:bg-blue-700 shadow-blue-500' : 'bg-purple-600 hover:bg-purple-700 shadow-purple-500'}
                    `}
                  >
                    Confirmar e Iniciar
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Image Search Modal */}
      <ImageSearchModal
        isOpen={isImageSearchModalOpen}
        onClose={() => setIsImageSearchModalOpen(false)}
        product={currentImageSearchProduct}
        onSave={handleSaveImages}
        credits={credits}
        consumeCredit={consumeCredit}
      />

    </div>
  );
}
