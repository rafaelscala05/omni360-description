import React, { useState, useRef, useMemo, useEffect, lazy, Suspense } from 'react';
import { Upload, Download, Search, Filter, Play, Eye, Copy, RefreshCw, Save, Check, AlertCircle, X, Sparkles, Link as LinkIcon, Settings, Plus, Trash2, Image as ImageIcon, LogIn, LogOut, Coins, Layout, ChevronLeft, ChevronRight, ChevronDown, DownloadCloud, Edit, Globe, FileText, Database, Folder, Bell, HelpCircle, Menu, Cloud, CloudUpload, Tag, Columns3, Plug, GraduationCap, Gift, Building2, Zap } from 'lucide-react';
import * as XLSX from 'xlsx';
import logoAlfreds from './assets/brand/logo-alfreds-produtos.png';
import { Routes, Route, Navigate } from 'react-router-dom';
import MarketingLayout from './marketing/MarketingLayout';
import HomePage from './marketing/pages/HomePage';
import ProductAgentPage from './marketing/pages/ProductAgentPage';
import ContentAgentPage from './marketing/pages/ContentAgentPage';
import PricingPage from './marketing/pages/PricingPage';
import CasesPage from './marketing/pages/CasesPage';
import ContactPage from './marketing/pages/ContactPage';
import TermsPage from './marketing/pages/TermsPage';
import PrivacyPage from './marketing/pages/PrivacyPage';
import AuthPage from './marketing/pages/AuthPage';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';
import 'react-quill-new/dist/quill.bubble.css';
import { motion, AnimatePresence } from 'motion/react';
import { auth, db } from './firebase';
import { signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, User } from 'firebase/auth';
import { collection, doc, writeBatch, getDocs, setDoc, getDoc, deleteDoc, getDocFromServer, runTransaction, onSnapshot, updateDoc } from 'firebase/firestore';
const ImageSearchModal = lazy(() => import('./components/ImageSearchModal'));
const ProductUrlImportModal = lazy(() => import('./components/onboarding/ProductUrlImportModal'));
const CategoryManager = lazy(() => import('./components/categories/CategoryManager'));
const CategoryImportModal = lazy(() => import('./components/modals/CategoryImportModal'));
const ProductEditModal = lazy(() => import('./components/modals/ProductEditModal'));
const ContentApp = lazy(() => import('./modules/content/ContentApp'));
const OperationsApp = lazy(() => import('./modules/operations/OperationsApp'));
import CreditPurchaseModal from './components/modals/CreditPurchaseModal';
import { Category, Product, AttributeValue, getProductStatusFlags, ProductModalTab } from './types/models';
import { generateAttributesFromImage, generateProductAttributes, generateDescriptionText, defaultTemplate, suggestProductAttributes } from './services/productService';
import { fetchCategories, generateCategoryHierarchy, flattenHierarchy, getEffectiveAttributes, addAttributeToCategory, saveCategory } from './services/categoryService';
import IntegrationsView from './components/integrations/IntegrationsView';
import TutorialView from './components/tutorial/TutorialView';
import type { WakePushFields } from './components/integrations/WakeConnector';
import type { WakeNormalizedProduct, WakePushProduct } from './services/wakeService';
import type { TinyPushProduct } from './services/tinyService';
import { type BlingPushFields } from './components/integrations/BlingConnector';
import type { BlingPushProduct, BlingPushResult } from './services/blingService';
import { fetchAndProcessImage } from './utils/imageUtils';
import { generateGrounded, parseJsonResponse } from './services/aiService';
import { CREDIT_ACTIONS, resolveCreditCost, type CreditAction } from './credits';
import { listenVideoJob, type VideoJob } from './services/videoService';
import {
  analyticsSetUser,
  metaSetProfile,
  trackLogin,
  trackSignUp,
  trackSpreadsheetImport,
  trackDescriptionGenerated,
  trackSpreadsheetExport,
  trackCreditPurchaseOpen,
  trackTemplateSaved,
  trackProductEnriched,
  trackCategoryHierarchyGenerated,
  trackTemplateDownloaded,
  trackAttributesGenerated,
} from './analytics';
import type { CompanyData } from './types/onboarding';
import { registerReferralSignup } from './services/referralService';
const OnboardingWizard = lazy(() => import('./modules/onboarding/OnboardingWizard'));
const CompanyProfile = lazy(() => import('./modules/onboarding/CompanyProfile'));
const ReferralPage = lazy(() => import('./modules/referral/ReferralPage'));
// CRM interno: só o admin abre, então não deve pesar no bundle de todo usuário.
const AdminApp = lazy(() => import('./modules/admin/AdminApp'));

// Build version injected at build time by Vite (git short hash + UTC date)
declare const __BUILD_VERSION__: string;
const BUILD_VERSION = typeof __BUILD_VERSION__ !== 'undefined' ? __BUILD_VERSION__ : 'dev';

// Utility to merge classes
function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}

// Products type now imported

interface Template {
  id: string;
  name: string;
  prompt: string;
}

interface CreditLog {
  id: string;
  type?: 'purchase' | 'bonus';
  actionType: string;
  actionKey?: string;
  productName: string;
  sku: string;
  userName: string;
  creditsConsumed: number;
  creditsAdded?: number;
  amount?: number;
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

// defaultTemplate moved to productService

const TINY_ERP_HEADERS = [
  'ID', 'Código (SKU)', 'Descrição', 'Unidade', 'Classificação fiscal', 'Origem', 'Preço', 'Valor IPI fixo', 'Observações', 'Situação', 'Estoque', 'Preço de custo', 'Cód do Fornecedor', 'Fornecedor', 'Localização', 'Estoque máximo', 'Estoque mínimo', 'Peso líquido (Kg)', 'Peso bruto (Kg)', 'GTIN/EAN', 'GTIN/EAN tributável', 'Descrição complementar', 'CEST', 'Código de Enquadramento IPI', 'Formato embalagem', 'Largura embalagem', 'Altura embalagem', 'Comprimento embalagem', 'Diâmetro embalagem', 'Tipo do produto', 'URL imagem 1', 'URL imagem 2', 'URL imagem 3', 'URL imagem 4', 'URL imagem 5', 'URL imagem 6', 'Categoria', 'Código do pai', 'Variações', 'Marca', 'Garantia', 'Sob encomenda', 'Preço promocional', 'URL imagem externa 1', 'URL imagem externa 2', 'URL imagem externa 3', 'URL imagem externa 4', 'URL imagem externa 5', 'URL imagem externa 6', 'Link do vídeo', 'Título SEO', 'Descrição SEO', 'Palavras chave SEO', 'Slug', 'Dias para preparação', 'Controlar lotes', 'Unidade por caixa', 'URL imagem externa 7', 'URL imagem externa 8', 'URL imagem externa 9', 'URL imagem externa 10', 'Markup', 'Permitir inclusão nas vendas', 'EX TIPI'
];

const decodeHTMLEntities = (text: string | undefined | null) => {
  if (!text) return '';
  const textArea = document.createElement('textarea');
  textArea.innerHTML = text;
  return textArea.value;
};

const truncateHtml = (html: string | undefined | null, maxChars = 2500): string => {
  if (!html || html.length <= maxChars) return html ?? '';
  const cut = html.lastIndexOf('</', maxChars);
  if (cut === -1) return html.slice(0, maxChars);
  const closeEnd = html.indexOf('>', cut);
  return closeEnd === -1 ? html.slice(0, maxChars) : html.slice(0, closeEnd + 1);
};

export default function App() {
  // State
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  // Mirror of products for deterministic merges during multi-page Wake imports.
  const productsRef = useRef<Product[]>([]);
  useEffect(() => { productsRef.current = products; }, [products]);
  const [originalHeaders, setOriginalHeaders] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [mainView, setMainView] = useState<'products' | 'categories' | 'history' | 'integrations' | 'tutorial' | 'referral' | 'company'>('products');
  // Top-level workspace: the Product agent (this App) or the Content agency module.
  const [workspace, setWorkspace] = useState<'product' | 'content' | 'operations'>('product');
  const [exportModel, setExportModel] = useState<'standard' | 'tinyerp'>('standard');
  const [existingCategories, setExistingCategories] = useState<Category[]>([]);
  const [showCategoryImport, setShowCategoryImport] = useState(false);
  const [foundCategoriesFile, setFoundCategoriesFile] = useState<string[]>([]);
  const [pendingProducts, setPendingProducts] = useState<Product[]>([]);
  const [isProcessingCategories, setIsProcessingCategories] = useState(false);
  
  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMarca, setFilterMarca] = useState('');
  const [filterCategoria, setFilterCategoria] = useState('');
  const [statusFilters, setStatusFilters] = useState({
    descricao: false,
    enriquecido: false,
    imagens: false,
    atributos: false,
  });
  const [statusFilterMode, setStatusFilterMode] = useState<'esconder' | 'mostrar'>('esconder');
  const [isFilterDropdownOpen, setIsFilterDropdownOpen] = useState(false);
  const [expandedParentIds, setExpandedParentIds] = useState<Set<string>>(new Set());
  
  // Generation State
  const [isGeneratingMass, setIsGeneratingMass] = useState(false);
  const [generationProgress, setGenerationProgress] = useState({ current: 0, total: 0 });
  const [generationLog, setGenerationLog] = useState<string>('');
  const [isEnrichingMass, setIsEnrichingMass] = useState(false);
  
  // Preview Modal State
  const [previewProduct, setPreviewProduct] = useState<Product | null>(null);
  const [previewInitialTab, setPreviewInitialTab] = useState<ProductModalTab>('geral');
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
  const [hasContentAgent, setHasContentAgent] = useState<boolean>(false);
  const [hasOperationsAgent, setHasOperationsAgent] = useState<boolean>(false);
  const [hasVideoModule, setHasVideoModule] = useState<boolean>(false);
  const [hasBlogModule, setHasBlogModule] = useState<boolean>(false);
  const [onboardingCompleted, setOnboardingCompleted] = useState<boolean>(false);
  const [productOnboardingPromptShown, setProductOnboardingPromptShown] = useState<boolean>(false);
  const [companyData, setCompanyData] = useState<CompanyData | null>(null);
  const [isOnboardingWizardOpen, setIsOnboardingWizardOpen] = useState(false);
  const [isProductUrlImportOpen, setIsProductUrlImportOpen] = useState(false);
  const [productUrlImportResumeStep, setProductUrlImportResumeStep] = useState<'done' | null>(null);
  const [productUrlImportProductId, setProductUrlImportProductId] = useState<string | null>(null);
  const [onboardingBannerDismissed, setOnboardingBannerDismissed] = useState(
    () => typeof window !== 'undefined' && localStorage.getItem('onboardingBannerDismissed') === '1',
  );
  // Nudges the user to try Indique e Ganhe at least once; hidden for good after their first visit.
  const [referralNavSeen, setReferralNavSeen] = useState(
    () => typeof window !== 'undefined' && localStorage.getItem('referralNavSeen') === '1',
  );
  const [videoReadyNotification, setVideoReadyNotification] = useState<{
    productId: string;
    productName: string;
    videoUrl: string;
  } | null>(null);
  const [activeVideoJob, setActiveVideoJob] = useState<VideoJob | null>(null);
  const activeVideoJobUnsubRef = useRef<(() => void) | null>(null);
  const pendingPhoneRef = useRef<string | null>(null);
  // Per-action credit costs loaded from the read-only Firestore doc `config/credits`.
  const [creditCosts, setCreditCosts] = useState<Record<string, number>>({});
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isCreditHistoryOpen, setIsCreditHistoryOpen] = useState(false);
  const [isCreditPurchaseOpen, setIsCreditPurchaseOpen] = useState(false);
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
    'Status': true
  });
  const [isColumnConfigOpen, setIsColumnConfigOpen] = useState(false);
  const [isExportDropdownOpen, setIsExportDropdownOpen] = useState(false);
  const [isProfileDropdownOpen, setIsProfileDropdownOpen] = useState(false);

  // Cloud Sync State
  const [isSavingToCloud, setIsSavingToCloud] = useState(false);
  const [isLoadingFromCloud, setIsLoadingFromCloud] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<{
    isOpen: boolean;
    type: 'selected' | 'all';
  } | null>(null);
  const [showMassActionConfirm, setShowMassActionConfirm] = useState<{
    isOpen: boolean;
    type: 'generate' | 'enrich';
    count: number;
    creditsNeeded: number;
    targetId?: string;
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

  // Auto-abre o wizard de onboarding de primeiro produto uma única vez,
  // quando o dashboard carrega vazio.
  useEffect(() => {
    if (!isAuthReady || !user || productOnboardingPromptShown || products.length !== 0) return;
    setIsProductUrlImportOpen(true);
    setProductOnboardingPromptShown(true);
    updateDoc(doc(db, `users/${user.uid}`), { productOnboarding: { promptShown: true } }).catch((err) =>
      console.error('Erro ao marcar productOnboarding.promptShown:', err),
    );
  }, [isAuthReady, user, productOnboardingPromptShown, products.length]);

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

  // Indique e Ganhe: capture ?ref=CODE from the referral link on first mount and
  // stash it until the (possibly not-yet-created) account exists. Both the Google
  // popup and the email/password form stay on /entrar, so this survives either path.
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('ref');
    if (code && !localStorage.getItem('pendingReferralCode')) {
      localStorage.setItem('pendingReferralCode', code);
    }
  }, []);

  useEffect(() => {
    let unsubscribeCredits: (() => void) | null = null;

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        analyticsSetUser(currentUser.uid, currentUser.email, currentUser.displayName);
        // Fetch credits
        const userRef = doc(db, `users/${currentUser.uid}`);
        try {
          const userSnap = await getDoc(userRef);
          if (!userSnap.exists()) {
            // New user, give some starter credits
            const initialCredits = 10;
            const phone = pendingPhoneRef.current;
            pendingPhoneRef.current = null;
            await setDoc(userRef, {
              email: currentUser.email,
              credits: initialCredits,
              lastSync: new Date().toISOString(),
              displayName: currentUser.displayName,
              ...(phone ? { phone } : {}),
            });
            setCredits(initialCredits);
            trackSignUp('google');

            // Indique e Ganhe: if this signup came from a referral link, associate
            // it server-side (grants the referrer's +30 idempotently). Fire-and-forget
            // — never block auth on this, and always clear the pending code.
            const pendingCode = localStorage.getItem('pendingReferralCode');
            if (pendingCode) {
              registerReferralSignup(pendingCode).catch((e) => console.error('Referral signup registration failed:', e));
              localStorage.removeItem('pendingReferralCode');
            }
          }
          // Listener em tempo real para manter o saldo sempre atualizado
          unsubscribeCredits?.();
          unsubscribeCredits = onSnapshot(userRef, (snap) => {
            if (snap.exists()) {
              setCredits(snap.data().credits ?? 0);
              setHasContentAgent(snap.data().modules?.contentAgent === true);
              setHasOperationsAgent(snap.data().modules?.operationsAgent === true);
              setHasVideoModule(snap.data().modules?.video === true);
              setHasBlogModule(snap.data().modules?.blog === true);
              setOnboardingCompleted(snap.data().onboarding?.completed === true);
              setProductOnboardingPromptShown(snap.data().productOnboarding?.promptShown === true);
              const company = snap.data().company ?? null;
              setCompanyData(company);
              metaSetProfile({ phone: company?.telefone, city: company?.endereco?.cidade });
            }
          });

          // Load admin-controlled per-action credit costs (read-only config doc)
          try {
            const costSnap = await getDoc(doc(db, 'config/credits'));
            if (costSnap.exists()) {
              const data = costSnap.data();
              setCreditCosts({
                ...(data.costs ?? {}),
                ...(data.defaultCost != null ? { _default: data.defaultCost } : {}),
              });
            }
          } catch (costError) {
            console.error("Error loading credit costs config:", costError);
          }

          // Load categories on startup
          const cats = await fetchCategories(currentUser.uid);
          setExistingCategories(cats);

          await loadFromCloud(true, currentUser.uid);
        } catch (error) {
          console.error("Error fetching user data/categories:", error);
        }
      } else {
        unsubscribeCredits?.();
        unsubscribeCredits = null;
        setCredits(0);
        setExistingCategories([]);
      }
      setIsAuthReady(true);
    });
    return () => {
      unsubscribe();
      unsubscribeCredits?.();
    };
  }, []);

  // Cost of a given action, resolved against the loaded config (fallbacks inside).
  const getCreditCost = (key: string) => resolveCreditCost(creditCosts, key);

  // Pre-flight balance guard used before launching an AI call. Returns false (and
  // alerts) when the in-memory balance is insufficient. The authoritative check
  // still happens transactionally inside consumeCredit after the call succeeds.
  const ensureCredits = (action: CreditAction, multiplier: number = 1): boolean => {
    const needed = getCreditCost(action.key) * multiplier;
    if (credits < needed) {
      alert(`Você não possui créditos suficientes. Necessário: ${needed}, Disponível: ${credits}`);
      return false;
    }
    return true;
  };

  // Debits the cost of `action` transactionally and writes an immutable log.
  // Call this only AFTER the paid operation (AI call) has succeeded, so a failed
  // generation never costs the user credits.
  const consumeCredit = async (action: CreditAction, productName: string = 'N/A', sku: string = 'N/A') => {
    if (!user) return false;

    const cost = getCreditCost(action.key);

    try {
      const userPath = `users/${user.uid}`;
      const userRef = doc(db, userPath);

      const updatedValue = await runTransaction(db, async (transaction) => {
        const userSnap = await transaction.get(userRef);
        if (!userSnap.exists()) {
          throw new Error("Usuário não encontrado.");
        }

        const currentCredits = userSnap.data().credits ?? 0;
        if (currentCredits < cost) {
          throw new Error("INSUFFICIENT_CREDITS");
        }

        const nextCredits = currentCredits - cost;
        transaction.update(userRef, { credits: nextCredits });

        // Log consumption
        const logRef = doc(collection(db, `${userPath}/credit_logs`));
        const logData: Omit<CreditLog, 'id'> = {
          actionType: action.label,
          actionKey: action.key,
          productName,
          sku,
          userName: user.displayName || user.email || 'Usuário',
          creditsConsumed: cost,
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
      trackLogin('google');
    } catch (error) {
      console.error("Login error:", error);
      alert("Erro ao fazer login com o Google.");
    }
  };

  const handleEmailLogin = async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
    trackLogin('email');
  };

  const handleEmailRegister = async (email: string, password: string, phone: string) => {
    pendingPhoneRef.current = phone;
    await createUserWithEmailAndPassword(auth, email, password);
    trackLogin('email_register');
  };

  const handlePasswordReset = async (email: string) => {
    await sendPasswordResetEmail(auth, email);
  };

  const handleVideoJobStarted = async (productId: string, jobId: string) => {
    setProducts((prev) =>
      prev.map((p) =>
        p._id === productId
          ? { ...p, _videoJobId: jobId, _videoStatus: 'queued' as const }
          : p,
      ),
    );
    if (user) {
      try {
        const productRef = doc(db, `users/${user.uid}/products/${productId}`);
        await updateDoc(productRef, { _videoJobId: jobId, _videoStatus: 'queued' });
      } catch (err) {
        console.error('Erro ao persistir jobId do vídeo:', err);
      }
      // Start global listener so sidebar widget always shows progress
      activeVideoJobUnsubRef.current?.();
      activeVideoJobUnsubRef.current = listenVideoJob(user.uid, jobId, (j) => {
        setActiveVideoJob(j);
        if (j.status === 'done' || j.status === 'error') {
          activeVideoJobUnsubRef.current?.();
          activeVideoJobUnsubRef.current = null;
          if (j.status === 'done') {
            // Keep widget visible briefly so user sees "Concluído!", then clear after 8s
            setTimeout(() => setActiveVideoJob(null), 8000);
          } else {
            setActiveVideoJob(null);
          }
        }
      });
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
        // NOTE: `credits` is intentionally NOT written here. The balance is only
        // ever mutated by consumeCredit's transaction (and, in the future,
        // server-side top-ups). Re-asserting a stale in-memory value here risks
        // overwriting concurrent debits and is rejected by the hardened rules.
        await setDoc(userRef, {
          email: user.email,
          lastSync: new Date().toISOString(),
          displayName: user.displayName
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
          if (opCount >= 20) {
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
      
      const removeUndefinedRecursively = (obj: any): any => {
        if (obj === null || obj === undefined) {
          return null;
        }
        if (Array.isArray(obj)) {
          return obj.map(item => removeUndefinedRecursively(item));
        }
        if (typeof obj === 'object') {
          // If it's a Firestore-compatible object (excluding special types like Date)
          const cleanObj: any = {};
          Object.keys(obj).forEach(key => {
            const val = obj[key];
            if (val !== undefined) {
              cleanObj[key] = removeUndefinedRecursively(val);
            }
          });
          return cleanObj;
        }
        return obj;
      };

      if (dirtyProducts.length > 0) {
        for (const product of dirtyProducts) {
          const docId = product._id;
          const docRef = doc(productsRef, docId);
          
          // Prepare data (remove undefined values and internal flags)
          const dataToSave = { 
            ...product, 
            ownerId: user.uid, 
            createdAt: product.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString() 
          };
          
          // Remove UI-only and internal flags we don't want to persist dirty
          delete dataToSave._isDirty;
          delete dataToSave._isGenerating;
          delete dataToSave._isEnriching;

          const cleanDataToSave = removeUndefinedRecursively(dataToSave);

          batch.set(docRef, cleanDataToSave, { merge: true });
          opCount++;
          
          if (opCount >= 20) {
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

  const loadFromCloud = async (silent = false, userId?: string) => {
    const targetUid = userId || user?.uid;
    if (!targetUid) {
      if (!silent) alert("Faça login para carregar da nuvem.");
      return;
    }

    setIsLoadingFromCloud(true);
    try {
      // 1. Load original headers
      const settingsPath = `users/${targetUid}/settings/excel`;
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
      const productsPath = `users/${targetUid}/products`;
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

        // Resume sidebar video job listener if an active job survived a page refresh.
        // Only start if we don't already have an active listener (avoids double-sub).
        if (!activeVideoJobUnsubRef.current) {
          const activeProduct = loadedProducts.find(
            p => (p._videoStatus === 'queued' || p._videoStatus === 'processing') && p._videoJobId,
          );
          if (activeProduct?._videoJobId) {
            activeVideoJobUnsubRef.current = listenVideoJob(targetUid, activeProduct._videoJobId, (j) => {
              setActiveVideoJob(j);
              if (j.status === 'done' || j.status === 'error') {
                activeVideoJobUnsubRef.current?.();
                activeVideoJobUnsubRef.current = null;
                if (j.status === 'done') {
                  setTimeout(() => setActiveVideoJob(null), 8000);
                } else {
                  setActiveVideoJob(null);
                }
              }
            });
          }
        }
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
  const [settingsTab, setSettingsTab] = useState<'templates' | 'images'>('templates');
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [enableCategoryImagePrompts, setEnableCategoryImagePrompts] = useState<boolean>(
    () => localStorage.getItem('enableCategoryImagePrompts') === 'true'
  );
  const [defaultAspectRatio, setDefaultAspectRatio] = useState<string>(
    () => localStorage.getItem('defaultAspectRatio') ?? '1:1'
  );

  // Save templates to local storage whenever they change
  useEffect(() => {
    localStorage.setItem('ai_description_templates', JSON.stringify(templates));
  }, [templates]);

  useEffect(() => {
    localStorage.setItem('enableCategoryImagePrompts', String(enableCategoryImagePrompts));
  }, [enableCategoryImagePrompts]);

  useEffect(() => {
    localStorage.setItem('defaultAspectRatio', defaultAspectRatio);
  }, [defaultAspectRatio]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Derived Data
  const marcas = useMemo(() => Array.from(new Set(products.map(p => p['Marca']).filter(Boolean) as string[])).sort(), [products]);
  const categorias = useMemo(() => Array.from(new Set(products.map(p => p['Categoria']).filter(Boolean) as string[])).sort(), [products]);

  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      // Only show parent or simple products in the main list
      if (p['Código do pai']) return false;

      const flags = getProductStatusFlags(p);

      const matchesSearch = (p['Descrição']?.toLowerCase() || '').includes(searchQuery.toLowerCase()) ||
                            (p['Código (SKU)']?.toLowerCase() || '').includes(searchQuery.toLowerCase());
      const matchesMarca = filterMarca ? p['Marca'] === filterMarca : true;
      const matchesCategoria = filterCategoria ? p['Categoria'] === filterCategoria : true;

      // Status filters (AND): modo "esconder" oculta produtos que JÁ têm aquele dado gerado;
      // modo "mostrar" inverte e só mantém os que têm aquele dado gerado
      if (statusFilterMode === 'esconder') {
        if (statusFilters.descricao && flags.descricaoGerada) return false;
        if (statusFilters.enriquecido && flags.enriquecido) return false;
        if (statusFilters.imagens && flags.imagensGeradas) return false;
        if (statusFilters.atributos && flags.atributosGerados) return false;
      } else {
        if (statusFilters.descricao && !flags.descricaoGerada) return false;
        if (statusFilters.enriquecido && !flags.enriquecido) return false;
        if (statusFilters.imagens && !flags.imagensGeradas) return false;
        if (statusFilters.atributos && !flags.atributosGerados) return false;
      }

      return matchesSearch && matchesMarca && matchesCategoria;
    });
  }, [products, searchQuery, filterMarca, filterCategoria, statusFilters, statusFilterMode]);

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
      'Descrição': 'Produto de Teste Alfreds',
      'Unidade': 'UN',
      'NCM (Classificação fiscal)': '85171300',
      'Origem': '0',
      'Preço': 2999.90,
      'Observações': 'Produto para teste de importação',
      'Situação': 'Ativo',
      'Estoque': 10,
      'Preço de custo': 1500.00,
      'Fornecedor': 'Fornecedor Teste',
      'Marca': 'Alfreds',
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

  const downloadBlankTemplate = () => {
    const headers = [
      'Código (SKU)', 'Descrição', 'Unidade', 'NCM (Classificação fiscal)', 'Origem', 'Preço', 'Observações', 'Situação', 'Estoque', 'Preço de custo', 'Fornecedor', 'Marca', 'Categoria', 'Peso bruto (Kg)', 'GTIN/EAN', 'URL imagem 1', 'Descrição complementar', 'Título SEO', 'Descrição SEO', 'Palavras chave SEO'
    ];
    const emptyRow = Object.fromEntries(headers.map(h => [h, '']));
    const ws = XLSX.utils.json_to_sheet([emptyRow], { header: headers });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Produtos");
    XLSX.writeFile(wb, "template-planilha-alfreds.xlsx");
    trackTemplateDownloaded();
  };

  // Merges freshly imported products into the current catalog by SKU instead of
  // replacing the whole array — importing an updated spreadsheet must not wipe
  // out products that were already saved and aren't present in the new file.
  const mergeImportedProducts = (existing: Product[], imported: Product[]): Product[] => {
    const result = [...existing];
    const indexBySku = new Map<string, number>();
    result.forEach((p, i) => {
      const sku = p['Código (SKU)'];
      if (sku) indexBySku.set(sku, i);
    });

    imported.forEach(newProd => {
      const sku = newProd['Código (SKU)'];
      const existingIndex = sku ? indexBySku.get(sku) : undefined;
      if (existingIndex !== undefined) {
        // Same SKU already in the catalog: update it in place, keeping its
        // original _id so cloud sync treats this as an update, not a delete+create.
        result[existingIndex] = { ...newProd, _id: result[existingIndex]._id, _isDirty: true };
      } else {
        result.push(newProd);
        if (sku) indexBySku.set(sku, result.length - 1);
      }
    });

    return result;
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
        
        // Extract unique categories
        const uniqueCategories = Array.from(new Set(allProducts.map(p => p['Categoria']?.toString().trim()).filter(Boolean))) as string[];
        
        if (uniqueCategories.length > 0) {
          // If we have auth, load current categories and show modal
          if (auth.currentUser) {
            fetchCategories(auth.currentUser.uid).then(cats => {
              setExistingCategories(cats);
              setFoundCategoriesFile(uniqueCategories);
              setPendingProducts(finalProducts);
              setShowCategoryImport(true);
            }).catch(e => {
              // fallback if network fails
              setProducts(prev => mergeImportedProducts(prev, finalProducts));
            });
          } else {
            setProducts(prev => mergeImportedProducts(prev, finalProducts));
          }
        } else {
          setProducts(prev => mergeImportedProducts(prev, finalProducts));
        }

        setSelectedIds(new Set());
        trackSpreadsheetImport({ product_count: finalProducts.length, category_count: uniqueCategories.length });
        // Reset file input
        if (fileInputRef.current) fileInputRef.current.value = '';
      } catch (error) {
        console.error("Error parsing Excel file:", error);
        alert("Erro ao ler o arquivo. Certifique-se de que é um arquivo .xlsx válido.");
      }
    };
    reader.readAsBinaryString(file);
  };

  const processCategoryImport = async (selectedNewCategories: string[], aiEnrichmentEnabled: boolean) => {
    if (!auth.currentUser) return;
    setIsProcessingCategories(true);
    let catsToCreate: Partial<Category>[] = selectedNewCategories.map(catName => ({
      name: catName,
      slug: catName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      parentId: null,
      level: 0,
      path: [catName],
      attributes: [],
      inheritParentAttributes: true,
      productCount: 0,
      aiGenerated: false
    }));
    
    try {
      if (aiEnrichmentEnabled && selectedNewCategories.length > 0) {
        const hierarchyCost = getCreditCost(CREDIT_ACTIONS.generateHierarchy.key);
        if (credits < hierarchyCost) {
          alert(`Você precisa de no mínimo ${hierarchyCost} crédito(s) para IA. A geração de hierarquia será ignorada.`);
        } else {
          try {
             const aiResult = await generateCategoryHierarchy(selectedNewCategories);
             console.log("AI Categories Result:", aiResult);
             if (aiResult.hierarchy) {
               catsToCreate = flattenHierarchy(aiResult.hierarchy);
             }
             // Debit only after the AI call succeeded.
             await consumeCredit(CREDIT_ACTIONS.generateHierarchy);
             trackCategoryHierarchyGenerated({ category_count: selectedNewCategories.length });
          } catch(e) {
             console.error(e);
             alert("Erro na IA, criando categorias planas...");
          }
        }
      }

      const batch = writeBatch(db);
      const userRef = doc(db, `users/${auth.currentUser.uid}`);
      
      const newCreatedCats: Category[] = [];
      const timestamp = new Date().toISOString();

      catsToCreate.forEach(catData => {
        const catRef = doc(collection(userRef, 'categories'));
        // If it was flattened by AI it might have an id like cat_something. 
        // We redefine it with a clean Firestore ID.
        // Also we must update pathIds if it is a child.
        // This mapping of pathIds requires updating the tree. For simplicity, if we use the AI structure, it has temporary IDs.
        // It's better to preserve the generated IDs to keep parent/child references intact.
        
        const safeId = catData.id || catRef.id;
        const actualRef = doc(collection(userRef, 'categories'), safeId);
        
        const newCat: Category = {
          id: safeId,
          name: catData.name || '',
          slug: catData.slug || '',
          parentId: catData.parentId || null,
          level: catData.level || 0,
          path: catData.path || [],
          pathIds: catData.pathIds || [safeId],
          attributes: catData.attributes || [],
          inheritParentAttributes: catData.inheritParentAttributes ?? true,
          inheritImagePrompts: catData.inheritImagePrompts ?? true,
          productCount: 0,
          aiGenerated: catData.aiGenerated || false,
          createdAt: timestamp,
          updatedAt: timestamp
        };
        batch.set(actualRef, newCat);
        newCreatedCats.push(newCat);
      });

      if (newCreatedCats.length > 0) {
        await batch.commit();
      }

      // Map pending products to category IDs if they match
      const allRuntimeCats = [...existingCategories, ...newCreatedCats];
      const updatedProducts = pendingProducts.map(prod => {
        const catName = prod['Categoria']?.toString().trim();
        const matched = allRuntimeCats.find(c => c.name.toLowerCase() === catName?.toLowerCase());
        if (matched) {
          prod.categoryId = matched.id;
          prod.categoryPath = matched.path;
        }
        return prod;
      });

      setProducts(prev => mergeImportedProducts(prev, updatedProducts));
      setShowCategoryImport(false);

    } catch (e) {
      console.error(e);
      alert('Erro ao processar categorias.');
    } finally {
      setIsProcessingCategories(false);
    }
  };

  const serializeCheckbox = (arr: string[]): string => {
    if (!Array.isArray(arr)) return '';
    return arr.join(';');
  };

  const sanitizeExportRow = (row: any, nullableFields: string[]) => {
    const sanitized = { ...row };
    nullableFields.forEach(field => {
      if (sanitized[field] === null || sanitized[field] === undefined || sanitized[field] === '') {
        sanitized[field] = '';
      }
    });
    return sanitized;
  };

  const handleExport = (modelToUse: 'standard' | 'tinyerp' = 'standard') => {
    if (products.length === 0) return;

    const productsToExport = selectedIds.size > 0
      ? products.filter(p => selectedIds.has(p._id))
      : products;

    if (productsToExport.length === 0) return;

    // Determine dynamic columns from all products
    const dynamicAttrs = new Set<string>();
    productsToExport.forEach(p => {
      if (p.attributes) {
        Object.keys(p.attributes).forEach(k => dynamicAttrs.add(k));
      }
      if (p._children) {
        p._children.forEach(c => {
          if (c.attributes) {
            Object.keys(c.attributes).forEach(k => dynamicAttrs.add(k));
          }
        });
      }
    });

    const exportData = productsToExport.flatMap(p => {
      const rowsToExport = [];
      
      const prepareRow = (prod: Product) => {
        let row: any = {};
        if (modelToUse === 'tinyerp') {
          TINY_ERP_HEADERS.forEach(header => {
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
                row[header] = ambientImg?.startsWith('data:') ? '[Imagem Base64]' : (ambientImg || prod[`URL imagem ${i}` as keyof Product] || '');
              }
            }
            for (let i = 1; i <= 10; i++) {
              if (header === `URL imagem externa ${i}`) {
                row[header] = prod[`URL imagem externa ${i}` as keyof Product] || '';
              }
            }
          });
        } else {
          // Standard System Model
          row = { ...prod._originalRow };
          // Código (SKU) precisa vir do produto atual: produtos sem _originalRow
          // (ex.: importados da Wake) não têm essa chave e o export ficava sem a coluna.
          row['Código (SKU)'] = prod['Código (SKU)'] || row['Código (SKU)'] || '';
          // Update with generated fields
          row['Descrição complementar'] = prod['Descrição complementar'] || row['Descrição complementar'] || '';
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
        }

        // Apply modulo 4.3 - Atributos Dinâmicos na Exportação
        // O modelo TinyERP possui um schema de colunas fixo: atributos dinâmicos
        // adicionados aqui quebram a importação no Tiny, então são omitidos.
        if (modelToUse !== 'tinyerp' && prod.attributes) {
          Object.entries(prod.attributes).forEach(([key, attr]) => {
            if (Array.isArray(attr.value)) {
              row[key] = serializeCheckbox(attr.value);
            } else {
              row[key] = attr.value;
            }
          });
        }

        return sanitizeExportRow(row, ['ID']);
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
    let headersToUse = modelToUse === 'tinyerp' ? [...TINY_ERP_HEADERS] : (originalHeaders.length > 0 ? [...originalHeaders] : undefined);
    
    // Ensure new columns are added to standard model if they weren't in the original file
    if (modelToUse === 'standard' && headersToUse) {
      if (!headersToUse.includes('Código (SKU)')) {
        headersToUse.unshift('Código (SKU)');
      }
      const newColumns = ['Título SEO', 'Descrição SEO', 'Palavras chave SEO', 'URL imagem 1', 'URL imagem 2', 'URL imagem 3', 'URL imagem 4', 'URL imagem 5'];
      newColumns.forEach(col => {
        if (!headersToUse!.includes(col)) {
          headersToUse!.push(col);
        }
      });
    }

    // Append dynamic columns (nunca no modelo TinyERP, cujo schema é fixo)
    if (headersToUse && modelToUse !== 'tinyerp') {
      Array.from(dynamicAttrs).forEach(dynamicCol => {
        if (!headersToUse!.includes(dynamicCol)) {
          headersToUse!.push(dynamicCol);
        }
      });
    }

    const ws = XLSX.utils.json_to_sheet(exportData, headersToUse ? { header: headersToUse } : undefined);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Planilha 1');

    const date = new Date().toISOString().split('T')[0];
    const modelName = modelToUse === 'tinyerp' ? 'TinyERP' : 'Padrao';
    XLSX.writeFile(wb, `produtos_exportacao_${modelName}_${date}.xlsx`);
    trackSpreadsheetExport({ model: modelToUse, product_count: productsToExport.length });
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

  // generateDescriptionText moved to productService

  // Pure patch builders shared by the single-product apply functions below and by the
  // mass-generation loops (startGenerateMass/startEnrichMass), which need to compute these
  // patches without going through setProducts on every single processed item.
  const buildGeneratedParentPatch = (parent: Product, generatedData: any) => {
    const newAttributes = { ...(parent.attributes || {}) };
    if (generatedData.extracted_attributes) {
      Object.keys(generatedData.extracted_attributes).forEach(key => {
        newAttributes[key] = {
          value: generatedData.extracted_attributes[key].value,
          confirmed: false,
          aiSuggested: true,
          source: 'text_ai'
        };
      });
    }
    const tituloOtimizado = decodeHTMLEntities(generatedData.titulo_seo);
    return {
      // O título otimizado também passa a ser o nome do produto (campo 'Descrição').
      'Descrição': tituloOtimizado || parent['Descrição'],
      'Descrição complementar': truncateHtml(decodeHTMLEntities(generatedData.descricao_html)),
      'Título SEO': tituloOtimizado,
      'Descrição SEO': decodeHTMLEntities(generatedData.descricao_seo),
      'Palavras chave SEO': decodeHTMLEntities(generatedData.palavras_chave),
      attributes: newAttributes,
      _statusDescricao: 'Gerado por IA' as const,
      _statusSEO: 'Gerado por IA' as const,
      _generationLog: generatedData._promptLog,
      _generationError: undefined,
      _tokenUsage: {
        ...parent._tokenUsage,
        generation: generatedData._usage
      },
      _isGenerating: false,
      _isDirty: true
    };
  };

  // SEO fields are NOT copied to children according to prompt instructions
  const buildGeneratedChildPatch = (generatedData: any) => ({
    'Descrição complementar': decodeHTMLEntities(generatedData.descricao_html),
    _statusDescricao: 'Gerado por IA' as const,
    _generationError: undefined,
    _isDirty: true
  });

  const applyGenerationToProductAndChildren = (productId: string, generatedData: any) => {
    setProducts(prev => {
      const updated = [...prev];
      const parentIdx = updated.findIndex(p => p._id === productId);
      if (parentIdx === -1) return updated;

      const parent = updated[parentIdx];
      const parentSku = parent['Código (SKU)'];

      updated[parentIdx] = { ...parent, ...buildGeneratedParentPatch(parent, generatedData) };

      // Update children
      if (parentSku) {
        for (let i = 0; i < updated.length; i++) {
          if (updated[i]['Código do pai'] === parentSku) {
            updated[i] = { ...updated[i], ...buildGeneratedChildPatch(generatedData) };
          }
        }
      }

      return updated;
    });
  };

  // --- Wake Commerce integration ---------------------------------------------

  // Removes undefined values recursively so the payload is Firestore-safe.
  const stripUndefined = (obj: any): any => {
    if (obj === null || obj === undefined) return null;
    if (Array.isArray(obj)) return obj.map(stripUndefined);
    if (typeof obj === 'object') {
      const out: any = {};
      Object.keys(obj).forEach((k) => { if (obj[k] !== undefined) out[k] = stripUndefined(obj[k]); });
      return out;
    }
    return obj;
  };

  // Imports a batch of Wake products: merges by produtoId, maps fields, and saves
  // a raw snapshot to users/{uid}/products/{id}/wake_versions before any enrichment.
  const handleWakeImport = async (incoming: WakeNormalizedProduct[]) => {
    if (!user) { alert('Faça login para importar produtos da Wake.'); return; }
    const uid = user.uid;
    const next = [...productsRef.current];
    const backups: { id: string; raw: unknown }[] = [];

    // Auto-create any category Wake reports that doesn't exist yet locally.
    // Mirrors the spreadsheet-import behavior, but flat/no-AI since this import
    // path has no modal to let the user review/enrich categories.
    const uniqueCategories = Array.from(
      new Set(incoming.map((w) => w.categorias[0]?.trim()).filter(Boolean)),
    ) as string[];
    if (uniqueCategories.length > 0) {
      try {
        const existingCats = await fetchCategories(uid);
        const existingNames = new Set(existingCats.map((c) => c.name.trim().toLowerCase()));
        for (const name of uniqueCategories) {
          if (existingNames.has(name.toLowerCase())) continue;
          existingNames.add(name.toLowerCase());
          await saveCategory(uid, {
            name,
            slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
            parentId: null,
            level: 0,
            path: [name],
            pathIds: [] as string[],
            attributes: [] as Category['attributes'],
            inheritParentAttributes: true,
            inheritImagePrompts: true,
            productCount: 0,
            aiGenerated: false,
          });
        }
      } catch (e) {
        console.warn('Falha ao criar categorias da Wake:', e);
      }
    }

    for (const w of incoming) {
      const mapped: Partial<Product> = stripUndefined({
        'Código (SKU)': w.sku || undefined,
        'Descrição': w.nome || undefined,
        'Descrição complementar': w.descricaoHtml || undefined,
        'Título SEO': w.seoTitle || undefined,
        'Descrição SEO': w.seoDescription || undefined,
        'Palavras chave SEO': w.seoKeywords || undefined,
        'Categoria': w.categorias[0] || undefined,
        'Preço': w.precoPor,
        'Preço promocional': w.precoDe,
        'GTIN/EAN': w.ean || undefined,
        _wakeProductId: w.produtoId,
        _wakeInformacaoId: w.informacaoId,
        attributes: w.atributos.length
          ? w.atributos.reduce((acc, a) => {
              acc[a.nome] = { value: a.valor, aiSuggested: false, confirmed: true, source: 'imported' };
              return acc;
            }, {} as Record<string, AttributeValue>)
          : undefined,
      });
      w.imagens.slice(0, 6).forEach((url, i) => { (mapped as any)[`URL imagem ${i + 1}`] = url; });

      const idx = next.findIndex((p) => p._wakeProductId === w.produtoId);
      if (idx >= 0) {
        next[idx] = { ...next[idx], ...mapped, _isDirty: true };
        backups.push({ id: next[idx]._id, raw: w.raw });
      } else {
        const newId = `wake_${w.produtoId}_${Date.now()}`;
        next.push({
          _id: newId,
          _statusDescricao: w.descricaoHtml ? 'Descrição original' : 'Sem descrição',
          _statusSEO: w.seoTitle ? 'Gerado por IA' : 'Sem SEO',
          _isDirty: true,
          _selectedImage: w.imagens[0] || '',
          ...mapped,
        } as Product);
        backups.push({ id: newId, raw: w.raw });
      }
    }

    productsRef.current = next;
    setProducts(next);
    setHasUnsavedChanges(true);

    // Backup/versioning snapshots (append-only history).
    for (const b of backups) {
      try {
        const versionRef = doc(collection(db, `users/${uid}/products/${b.id}/wake_versions`));
        await setDoc(versionRef, {
          source: 'wake-import',
          raw: stripUndefined(b.raw),
          importedAt: new Date().toISOString(),
        });
      } catch (e) {
        console.warn('Falha ao salvar backup da versão Wake:', e);
      }
    }
  };

  // Builds the push payload from selected products that originated from Wake.
  const buildWakePushPayload = async (campos: WakePushFields): Promise<WakePushProduct[]> => {
    const fromWake = productsRef.current.filter((p) => p._wakeProductId);
    const selected = selectedIds.size > 0 ? fromWake.filter((p) => selectedIds.has(p._id)) : fromWake;
    const out: WakePushProduct[] = [];

    for (const p of selected) {
      let imagensBase64: WakePushProduct['imagensBase64'];
      if (campos.imagens && p._ambientImages?.length) {
        imagensBase64 = [];
        for (const url of p._ambientImages) {
          try {
            const { base64Data, mimeType } = await fetchAndProcessImage(url);
            const b64 = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
            imagensBase64.push({ base64: b64, formato: mimeType.toLowerCase().includes('png') ? 'PNG' : 'JPG' });
          } catch (e) {
            console.warn('Falha ao converter imagem para envio Wake:', e);
          }
        }
      }

      const atributos = Object.entries(p.attributes ?? {})
        .map(([nome, rawAv]) => {
          const av = rawAv as AttributeValue;
          return {
            nome,
            valor: Array.isArray(av?.value) ? av.value.join(', ') : String(av?.value ?? ''),
          };
        })
        .filter((a) => a.valor.trim());

      out.push({
        produtoId: p._wakeProductId!,
        sku: p['Código (SKU)'],
        nome: p['Título SEO'] || undefined,
        informacaoId: p._wakeInformacaoId,
        descricaoHtml: p['Descrição complementar'],
        seoTitle: p['Título SEO'],
        seoDescription: p['Descrição SEO'],
        seoKeywords: p['Palavras chave SEO'],
        atributos: campos.atributos ? atributos : undefined,
        imagensBase64,
        campos,
      });
    }
    return out;
  };

  // --- Tiny ERP integration -------------------------------------------------
  // Import runs server-side (server/tinyImportWorker.ts) and writes products
  // straight to Firestore; the UI reloads via loadFromCloud when a run finishes.

  // --- Tiny push: send every locally-known value; the server decides what to
  // write by diffing against Tiny's live current data (server/tinyProvider.ts,
  // server/tinyV2.ts, server/tinyAgent.ts). No local "already sent" cache needed.

  const tinyToNum = (v: unknown): number | undefined => {
    if (v === undefined || v === null || v === '') return undefined;
    const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
    return Number.isFinite(n) ? n : undefined;
  };
  // Public image URLs to send as anexos: generated ambient images + imported
  // "URL imagem N" fields. Only http(s) URLs (Tiny downloads them).
  const collectTinyImages = (p: Product): string[] => {
    const urls: string[] = [...(p._ambientImages ?? [])];
    for (let i = 1; i <= 6; i++) {
      const u = (p as any)[`URL imagem ${i}`];
      if (typeof u === 'string' && u) urls.push(u);
    }
    return Array.from(new Set(urls.filter((u) => /^https?:\/\//i.test(u))));
  };
  const tinySelectedProducts = (source: Product[]): Product[] => {
    const fromTiny = source.filter((p) => p._tinyProductId);
    return selectedIds.size > 0 ? fromTiny.filter((p) => selectedIds.has(p._id)) : fromTiny;
  };

  // Builds the push payload for every selected Tiny-linked product. No field
  // filtering here — the server compares each value against Tiny's live data and
  // only writes what actually differs.
  const buildTinyPushPayload = async (): Promise<TinyPushProduct[]> => {
    return tinySelectedProducts(productsRef.current).map((p) => ({
      tinyId: p._tinyProductId!,
      sku: p['Código (SKU)'],
      descricaoHtml: p['Descrição complementar'],
      seoTitle: p['Título SEO'],
      seoDescription: p['Descrição SEO'],
      seoKeywords: p['Palavras chave SEO'],
      ncm: p['NCM (Classificação fiscal)'],
      gtin: p['GTIN/EAN'],
      pesoLiquido: tinyToNum(p['Peso líquido (Kg)']),
      pesoBruto: tinyToNum(p['Peso bruto (Kg)']),
      largura: tinyToNum(p['Largura embalagem']),
      altura: tinyToNum(p['Altura Embalagem']),
      comprimento: tinyToNum(p['Comprimento embalagem']),
      imagens: collectTinyImages(p),
    }));
  };

  // djb2/tinyGroup/tinyGenerated are no longer needed for Tiny (the server now
  // diffs against Tiny's live data). Kept only because the Bling push flow below
  // (unchanged, out of scope here) still relies on this stale-flag-based
  // "what changed" prediction for its own field-selection UI.
  const djb2 = (s: string): string => {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  };
  // Per-group signature + whether the group actually has content to send.
  const tinyGroup = {
    descricao: (p: Product) => ({ has: !!p['Descrição complementar'], sig: djb2(String(p['Descrição complementar'] ?? '')) }),
    seo: (p: Product) => {
      const parts = [p['Título SEO'], p['Descrição SEO'], p['Palavras chave SEO']];
      return { has: parts.some((x) => !!x), sig: djb2(parts.map((x) => String(x ?? '')).join('')) };
    },
    fiscal: (p: Product) => {
      const parts = [p['NCM (Classificação fiscal)'], p['GTIN/EAN'], p['Peso líquido (Kg)'], p['Peso bruto (Kg)'], p['Largura embalagem'], p['Altura Embalagem'], p['Comprimento embalagem']];
      return { has: parts.some((x) => x !== undefined && x !== null && x !== ''), sig: djb2(parts.map((x) => String(x ?? '')).join('')) };
    },
    imagens: (p: Product) => { const imgs = collectTinyImages(p); return { has: imgs.length > 0, sig: djb2(imgs.join('')) }; },
  } as const;
  type TinyGroupKey = keyof typeof tinyGroup;
  // Whether each group was generated/modified in the app — the SAME signal the
  // Catálogo uses (getProductStatusFlags), so imported/original data doesn't count.
  const tinyGenerated = (p: Product): Record<TinyGroupKey, boolean> => {
    const f = getProductStatusFlags(p);
    return {
      descricao: f.descricaoGerada,          // _statusDescricao === 'Gerado por IA'
      seo: p._statusSEO === 'Gerado por IA',
      fiscal: f.enriquecido,                 // !!_enrichmentLog
      imagens: f.imagensGeradas,             // possui imagens ambientadas
    };
  };

  // --- Bling push (mirrors the Tiny helpers; same group-signature logic) ------
  const blingSelectedProducts = (source: Product[]): Product[] => {
    const fromBling = source.filter((p) => p._blingProductId);
    return selectedIds.size > 0 ? fromBling.filter((p) => selectedIds.has(p._id)) : fromBling;
  };

  const changedBlingGroups = (p: Product, campos: BlingPushFields): Record<TinyGroupKey, boolean> => {
    const gen = tinyGenerated(p);
    const out = { descricao: false, seo: false, fiscal: false, imagens: false };
    (['descricao', 'seo', 'fiscal', 'imagens'] as const).forEach((g) => {
      if (!campos[g] || !gen[g]) return;
      const { sig } = tinyGroup[g](p);
      out[g] = sig !== p._blingPushed?.[g];
    });
    return out;
  };

  const getBlingPushCandidates = (campos: BlingPushFields) => {
    const out: { id: string; sku: string; nome: string; changed: Record<TinyGroupKey, boolean> }[] = [];
    for (const p of blingSelectedProducts(products)) {
      const ch = changedBlingGroups(p, campos);
      if (ch.descricao || ch.seo || ch.fiscal || ch.imagens) {
        out.push({ id: p._blingProductId!, sku: p['Código (SKU)'] || '', nome: p['Descrição'] || p['Título SEO'] || '', changed: ch });
      }
    }
    return out;
  };

  const buildBlingPushPayload = async (campos: BlingPushFields): Promise<BlingPushProduct[]> => {
    const out: BlingPushProduct[] = [];
    for (const p of blingSelectedProducts(productsRef.current)) {
      const ch = changedBlingGroups(p, campos);
      if (!(ch.descricao || ch.seo || ch.fiscal || ch.imagens)) continue;
      out.push({
        blingId: p._blingProductId!,
        sku: p['Código (SKU)'],
        descricaoHtml: p['Descrição complementar'],
        seoTitle: p['Título SEO'],
        seoDescription: p['Descrição SEO'],
        seoKeywords: p['Palavras chave SEO'],
        ncm: p['NCM (Classificação fiscal)'],
        gtin: p['GTIN/EAN'],
        cest: p['CEST'],
        pesoLiquido: tinyToNum(p['Peso líquido (Kg)']),
        pesoBruto: tinyToNum(p['Peso bruto (Kg)']),
        largura: tinyToNum(p['Largura embalagem']),
        altura: tinyToNum(p['Altura Embalagem']),
        comprimento: tinyToNum(p['Comprimento embalagem']),
        imagens: ch.imagens ? collectTinyImages(p) : undefined,
        campos: ch,
      });
    }
    return out;
  };

  const handleBlingPushed = async (results: BlingPushResult[]) => {
    if (!user) return;
    const byId = new Map(results.map((r) => [r.blingId, r]));
    const touched: Product[] = [];
    const next = productsRef.current.map((p) => {
      const r = p._blingProductId ? byId.get(p._blingProductId) : undefined;
      if (!r) return p;
      const pushed = { ...(p._blingPushed ?? {}) };
      let upd = false;
      (['descricao', 'seo', 'fiscal', 'imagens'] as const).forEach((g) => {
        if (r.steps[g] === 'ok') { pushed[g] = tinyGroup[g](p).sig; upd = true; }
      });
      if (!upd) return p;
      const np = { ...p, _blingPushed: pushed };
      touched.push(np);
      return np;
    });
    if (!touched.length) return;
    productsRef.current = next;
    setProducts(next);
    // Persist just the _blingPushed field for the affected products.
    let batch = writeBatch(db);
    let n = 0;
    for (const p of touched) {
      batch.set(doc(db, `users/${user.uid}/products/${p._id}`), { _blingPushed: p._blingPushed }, { merge: true });
      if (++n >= 400) { await batch.commit(); batch = writeBatch(db); n = 0; }
    }
    if (n > 0) await batch.commit().catch((e) => console.warn('Falha ao salvar _blingPushed:', e));
  };

  const handleSaveImages =(productId: string, selectedImage: string, ambientImages: string[], tokenUsage?: { promptTokens: number; completionTokens: number; totalTokens: number }) => {
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
    try {
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

      const { text, usage } = await generateGrounded(prompt, {
        temperature: 0.2,
        maxOutputTokens: 2048,
        systemInstruction: "Você é um assistente de e-commerce. Seja extremamente conciso. Nunca gere textos longos ou repetitivos. O campo log_fontes deve ter no máximo 150 caracteres. RESPONDA APENAS COM O JSON PURO.",
      });

      const parsed = parseJsonResponse(text);
      return { ...parsed, _usage: usage };
    } catch (error) {
      console.error("Error enriching data:", error);
      throw error;
    }
  };

  // Pure patch builder — same shape applies to both the parent and its children.
  const buildEnrichedPatch = (p: Product, enrichedData: any) => ({
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

  const applyEnrichmentToProductAndChildren = (productId: string, enrichedData: any) => {
    setProducts(prev => {
      const updated = [...prev];
      const parentIdx = updated.findIndex(p => p._id === productId);
      if (parentIdx === -1) return updated;

      const parent = updated[parentIdx];
      const parentSku = parent['Código (SKU)'];

      // Update parent
      updated[parentIdx] = { ...parent, ...buildEnrichedPatch(parent, enrichedData) };

      // Update children
      if (parentSku) {
        for (let i = 0; i < updated.length; i++) {
          if (updated[i]['Código do pai'] === parentSku) {
            updated[i] = { ...updated[i], ...buildEnrichedPatch(updated[i], enrichedData) };
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

    if (!ensureCredits(CREDIT_ACTIONS.enrichSingle)) return;

    // Set enriching state
    const newProducts = [...products];
    newProducts[productIndex] = { ...product, _isEnriching: true };
    setProducts(newProducts);

    try {
      const enrichedData = await enrichProductData(product);
      applyEnrichmentToProductAndChildren(id, enrichedData);
      await consumeCredit(CREDIT_ACTIONS.enrichSingle, product['Descrição'], product['Código (SKU)']);
      trackProductEnriched({ mode: 'single' });
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

    if (templates.length > 1) {
      setShowMassActionConfirm({
        isOpen: true,
        type: 'generate',
        count: 1,
        creditsNeeded: getCreditCost(CREDIT_ACTIONS.generateSeoSingle.key),
        targetId: id
      });
      return;
    }

    startGenerateSingle(id);
  };

  const startGenerateSingle = async (id: string) => {
    setShowMassActionConfirm(null);
    const productIndex = products.findIndex(p => p._id === id);
    if (productIndex === -1) return;
    const product = products[productIndex];

    if (!ensureCredits(CREDIT_ACTIONS.generateSeoSingle)) return;

    // Set generating state
    const newProducts = [...products];
    newProducts[productIndex] = { ...product, _isGenerating: true };
    setProducts(newProducts);

    try {
      const template = templates.find(t => t.id === selectedTemplateId) || defaultTemplate;
      const generatedData = await generateDescriptionText(product, existingCategories, template);
      applyGenerationToProductAndChildren(id, generatedData);
      await consumeCredit(CREDIT_ACTIONS.generateSeoSingle, product['Descrição'], product['Código (SKU)']);
      trackDescriptionGenerated({ mode: 'single', sku: product['Código (SKU)'] as string });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      alert(`Erro ao gerar descrição para ${product['Descrição']}: ${errorMessage}`);
      setProducts(prev => {
        const updated = [...prev];
        const idx = updated.findIndex(p => p._id === id);
        if (idx !== -1) {
          updated[idx] = { 
            ...updated[idx], 
            _isGenerating: false,
            _generationError: errorMessage,
            _statusDescricao: 'Erro',
            _statusSEO: 'Erro',
            _isDirty: true
          };
        }
        return updated;
      });
    }
  };

  const handleProductCreatedFromOnboarding = (product: Product) => {
    setProducts((prev) => [...prev, product]);
    setProductUrlImportProductId(product._id);
  };

  // Reusa exatamente o mesmo caminho de geração de descrição por crédito que
  // a tabela de produtos já usa (startGenerateSingle) — sem duplicar
  // ensureCredits/consumeCredit/tracking.
  const handleGenerateDescriptionForOnboarding = async (id: string) => {
    await startGenerateSingle(id);
  };

  // Sugestão de atributos é grátis hoje (não passa por ensureCredits/consumeCredit) —
  // mesma função extraída em productService.ts que ProductEditModal usa.
  const handleSuggestAttributesForOnboarding = async (id: string): Promise<boolean> => {
    const product = products.find((p) => p._id === id);
    if (!product) return false;
    const effectiveAttributes = product.categoryId ? getEffectiveAttributes(product.categoryId, existingCategories) : [];
    const result = await suggestProductAttributes(product, effectiveAttributes);
    const hasUpdates = Object.keys(result.attributes).length > 0;
    if (hasUpdates) {
      setProducts((prev) =>
        prev.map((p) => (p._id === id ? { ...p, attributes: { ...(p.attributes || {}), ...result.attributes }, _isDirty: true } : p)),
      );
      const hasImage = !!(product._selectedImage || product['URL imagem 1']);
      trackAttributesGenerated({ source: hasImage ? 'image' : 'text', sku: product['Código (SKU)'] as string });
    }
    return hasUpdates;
  };

  // Abre o ImageSearchModal já existente para o produto do wizard e lembra de
  // reabrir o wizard (no passo "done") quando ele for fechado.
  const handleOpenImageSearchFromOnboarding = (id: string) => {
    const product = products.find((p) => p._id === id);
    if (!product) return;
    setCurrentImageSearchProduct(product);
    setIsImageSearchModalOpen(true);
    setProductUrlImportResumeStep('done');
    setIsProductUrlImportOpen(false);
  };

  // Cria uma categoria de topo (sem pai) a partir do wizard de onboarding,
  // mesmo formato usado por CategoryManager.handleSave para uma categoria raiz.
  const handleCreateCategoryForOnboarding = async (name: string): Promise<string | null> => {
    if (!user) return null;
    try {
      const saved = await saveCategory(user.uid, {
        name,
        slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        parentId: null,
        level: 0,
        path: [name],
        pathIds: [],
        attributes: [],
        inheritParentAttributes: true,
        inheritImagePrompts: true,
        productCount: 0,
        aiGenerated: false,
      });
      setExistingCategories((prev) => [...prev, saved]);
      return saved.id;
    } catch (e) {
      console.error('Erro ao criar categoria do onboarding:', e);
      return null;
    }
  };

  const handleGenerateMass = async () => {
    if (selectedIds.size === 0) return;
    
    // Total cost check
    const count = selectedIds.size;
    const generateNeeded = count * getCreditCost(CREDIT_ACTIONS.generateSeoMass.key);
    if (credits < generateNeeded) {
      alert(`Você não possui créditos suficientes. Necessário: ${generateNeeded}, Disponível: ${credits}`);
      return;
    }

    if (count > 1 || templates.length > 1) {
      setShowMassActionConfirm({
        isOpen: true,
        type: 'generate',
        count: count,
        creditsNeeded: generateNeeded
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

    // Work against a local copy + index maps instead of calling setProducts([...prev]) twice
    // per item: that pattern clones the ENTIRE catalog array on every single processed
    // product (O(selected × catalog)), which gets very slow on large catalogs. Here each
    // per-item update is O(1) against `working`, and we only commit a new array reference
    // to React state (which is what actually triggers the full-array clone) periodically.
    let working = productsRef.current.slice();
    const indexById = new Map(working.map((p, i) => [p._id, i] as const));
    const childIndicesByParentSku = new Map<string, number[]>();
    working.forEach((p, i) => {
      const parentSku = p['Código do pai'];
      if (parentSku) {
        const list = childIndicesByParentSku.get(parentSku) || [];
        list.push(i);
        childIndicesByParentSku.set(parentSku, list);
      }
    });
    const FLUSH_EVERY = 5;
    const flush = () => {
      working = working.slice();
      productsRef.current = working;
      setProducts(working);
    };

    for (let i = 0; i < idsToProcess.length; i++) {
      const id = idsToProcess[i];
      const idx = indexById.get(id);
      if (idx === undefined) continue;

      const product = working[idx];
      setGenerationLog(`Gerando descrição para: ${product['Descrição'] || product['Código (SKU)']}...`);

      // Mark this specific item as generating
      working[idx] = { ...product, _isGenerating: true };

      try {
        const template = templates.find(t => t.id === selectedTemplateId) || defaultTemplate;
        const generatedData = await generateDescriptionText(product, existingCategories, template);

        const parent = working[idx];
        const parentSku = parent['Código (SKU)'];
        working[idx] = { ...parent, ...buildGeneratedParentPatch(parent, generatedData) };
        if (parentSku) {
          (childIndicesByParentSku.get(parentSku) || []).forEach(childIdx => {
            working[childIdx] = { ...working[childIdx], ...buildGeneratedChildPatch(generatedData) };
          });
        }

        // Debit only after success; stop the batch if the balance ran out.
        if (!(await consumeCredit(CREDIT_ACTIONS.generateSeoMass, product['Descrição'], product['Código (SKU)']))) { flush(); break; }
        successCount++;
      } catch (error) {
        console.error(`Failed for ${id}`, error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        working[idx] = {
          ...working[idx],
          _isGenerating: false,
          _generationError: errorMessage,
          _statusDescricao: 'Erro',
          _statusSEO: 'Erro',
          _isDirty: true
        };
      }

      if (i % FLUSH_EVERY === 0 || i === idsToProcess.length - 1) flush();

      setGenerationProgress({ current: i + 1, total: selectedIds.size });
      // Small delay to prevent UI freezing and respect rate limits
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    setGenerationLog(`✅ ${successCount} produtos gerados com sucesso!`);
    if (successCount > 0) trackDescriptionGenerated({ mode: 'mass', product_count: successCount });
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
    const enrichNeeded = count * getCreditCost(CREDIT_ACTIONS.enrichMass.key);
    if (credits < enrichNeeded) {
      alert(`Você não possui créditos suficientes. Necessário: ${enrichNeeded}, Disponível: ${credits}`);
      return;
    }

    if (count > 1) {
      setShowMassActionConfirm({
        isOpen: true,
        type: 'enrich',
        count: count,
        creditsNeeded: enrichNeeded
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

    // Same batching approach as startGenerateMass: mutate a local working copy by index
    // (O(1) per item) and only commit to React state periodically, instead of cloning the
    // whole catalog array twice per processed item.
    let working = productsRef.current.slice();
    const indexById = new Map(working.map((p, i) => [p._id, i] as const));
    const childIndicesByParentSku = new Map<string, number[]>();
    working.forEach((p, i) => {
      const parentSku = p['Código do pai'];
      if (parentSku) {
        const list = childIndicesByParentSku.get(parentSku) || [];
        list.push(i);
        childIndicesByParentSku.set(parentSku, list);
      }
    });
    const FLUSH_EVERY = 5;
    const flush = () => {
      working = working.slice();
      productsRef.current = working;
      setProducts(working);
    };

    for (let i = 0; i < idsToProcess.length; i++) {
      const id = idsToProcess[i];
      const idx = indexById.get(id);
      if (idx === undefined) continue;

      const product = working[idx];
      setGenerationLog(`Buscando dados para: ${product['Descrição'] || product['Código (SKU)']}...`);

      working[idx] = { ...product, _isEnriching: true };

      try {
        const enrichedData = await enrichProductData(product);

        const parent = working[idx];
        const parentSku = parent['Código (SKU)'];
        working[idx] = { ...parent, ...buildEnrichedPatch(parent, enrichedData) };
        if (parentSku) {
          (childIndicesByParentSku.get(parentSku) || []).forEach(childIdx => {
            working[childIdx] = { ...working[childIdx], ...buildEnrichedPatch(working[childIdx], enrichedData) };
          });
        }

        // Debit only after success; stop the batch if the balance ran out.
        if (!(await consumeCredit(CREDIT_ACTIONS.enrichMass, product['Descrição'], product['Código (SKU)']))) { flush(); break; }
        successCount++;
      } catch (error) {
        console.error(`Failed enriching ${id}`, error);
        working[idx] = { ...working[idx], _isEnriching: false };
      }

      if (i % FLUSH_EVERY === 0 || i === idsToProcess.length - 1) flush();

      setGenerationProgress({ current: i + 1, total: selectedIds.size });
      await new Promise(resolve => setTimeout(resolve, 1000)); // Slightly longer delay for search API
    }

    setGenerationLog(`✅ ${successCount} produtos enriquecidos com sucesso!`);
    if (successCount > 0) trackProductEnriched({ mode: 'mass', product_count: successCount });
    setTimeout(() => {
      setIsEnrichingMass(false);
      setGenerationLog('');
      setSelectedIds(new Set());
    }, 3000);
  };

  const handleDeleteSelected = () => {
    if (selectedIds.size === 0) return;
    setShowDeleteConfirm({ isOpen: true, type: 'selected' });
  };

  const processDelete = () => {
    if (!showDeleteConfirm) return;
    
    if (showDeleteConfirm.type === 'selected') {
      setProducts(prev => {
        const next = prev.filter(p => !selectedIds.has(p._id));
        skipNextChangeTrack.current = true;
        return next;
      });
      setSelectedIds(new Set());
    } else if (showDeleteConfirm.type === 'all') {
      const idsToRemove = new Set(filteredProducts.map(p => p._id));
      setProducts(prev => {
        const next = prev.filter(p => !idsToRemove.has(p._id));
        skipNextChangeTrack.current = true;
        return next;
      });
      setSelectedIds(new Set());
    }
    
    setHasUnsavedChanges(true);
    setShowDeleteConfirm(null);
  };

  const openPreview = (product: Product, initialTab: ProductModalTab = 'geral') => {
    setPreviewInitialTab(initialTab);
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
    if (!ensureCredits(CREDIT_ACTIONS.regenerateSingle)) return;

    setPreviewProduct(prev => prev ? { ...prev, _isGenerating: true } : null);
    try {
      const template = templates.find(t => t.id === selectedTemplateId) || defaultTemplate;
      const generatedData = await generateDescriptionText(previewProduct, existingCategories, template);
      await consumeCredit(CREDIT_ACTIONS.regenerateSingle, previewProduct['Descrição'], previewProduct['Código (SKU)']);
      trackDescriptionGenerated({ mode: 'single', sku: previewProduct['Código (SKU)'] as string });
      const truncatedHtml = truncateHtml(generatedData.descricao_html);
      setEditedDescription(truncatedHtml);
      setPreviewProduct(prev => prev ? {
        ...prev,
        'Descrição complementar': truncatedHtml,
        'Título SEO': generatedData.titulo_seo,
        'Descrição SEO': generatedData.descricao_seo,
        'Palavras chave SEO': generatedData.palavras_chave,
        _isGenerating: false,
        _generationError: undefined
      } : null);
      
      applyGenerationToProductAndChildren(previewProduct._id, generatedData);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      alert(`Erro ao regenerar descrição: ${errorMessage}`);
      setPreviewProduct(prev => prev ? { 
        ...prev, 
        _isGenerating: false,
        _statusDescricao: 'Erro',
        _statusSEO: 'Erro',
        _generationError: errorMessage 
      } : null);
      setProducts(prev => {
        const updated = [...prev];
        const idx = updated.findIndex(p => p._id === previewProduct._id);
        if (idx !== -1) {
          updated[idx] = { 
            ...updated[idx], 
            _isGenerating: false,
            _generationError: errorMessage,
            _statusDescricao: 'Erro',
            _statusSEO: 'Erro',
            _isDirty: true 
          };
        }
        return updated;
      });
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
          <div className="flex items-center justify-center w-5 h-5 rounded-md bg-orange-100 text-orange-700 border border-orange-200" title="Informação: Utilizando descrição original da planilha importada">
            <Search className="w-3 h-3" />
          </div>
        );
      case 'Sem descrição':
        return (
          <div className="flex items-center justify-center w-5 h-5 rounded-md bg-red-50 text-red-500 border border-red-100" title="Atenção: Este produto não possui descrição cadastrada">
            <X className="w-3 h-3" />
          </div>
        );
      case 'Erro':
        return (
          <div className="flex items-center justify-center w-5 h-5 rounded-md bg-red-100 text-red-700 border border-red-200" title="Erro na geração da descrição">
            <AlertCircle className="w-3 h-3" />
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
      case 'Erro':
        return (
          <div className="flex items-center justify-center w-5 h-5 rounded-md bg-red-100 text-red-700 border border-red-200" title="Erro na geração de SEO">
            <AlertCircle className="w-3 h-3" />
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
        <img src={logoAlfreds} alt="Alfreds" className="h-10 w-auto animate-pulse mb-6" />
        <div className="flex flex-col items-center gap-4">
            <div className="flex items-center gap-2">
                <RefreshCw className="w-4 h-4 text-orange-600 animate-spin" />
                <span className="text-gray-600 font-bold tracking-tight">Carregando Alfreds...</span>
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

  // Purchases and bonuses (onboarding/referral) both add credits; everything
  // else (action debits) subtracts. Distinguishes which column/sign to render.
  const isCreditGrant = (log: CreditLog) => log.type === 'purchase' || log.type === 'bonus';

  const renderHistoryView = () => (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 mx-auto w-full">
      <div className="flex justify-between items-end mb-6">
         <div>
           <h1 className="text-[28px] font-bold text-slate-900 tracking-tight leading-tight">Histórico de Créditos</h1>
           <p className="text-sm text-slate-500 mt-1">Revise suas transações recentes e uso de créditos.</p>
         </div>
         <button className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-white border border-slate-200 shadow-sm rounded-lg hover:bg-slate-50 text-slate-700 transition-colors">
           <Download className="w-4 h-4" /> Exportar CSV
         </button>
      </div>
  
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
           <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Saldo Disponível</div>
           <div className="flex items-baseline gap-2 mb-4">
              <span className="text-5xl font-bold text-slate-900 tracking-tight">{credits}</span>
              <span className="text-base text-slate-500">créditos</span>
           </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex items-center justify-between">
           <div className="flex gap-12">
              <div>
                 <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Usado Este Mês</div>
                 <div className="flex items-baseline gap-2">
                   <span className="text-2xl font-bold text-slate-900">
                     {creditLogs
                       .filter((l) => !isCreditGrant(l) && new Date(l.timestamp).getMonth() === new Date().getMonth() && new Date(l.timestamp).getFullYear() === new Date().getFullYear())
                       .reduce((acc, log) => acc + (log.creditsConsumed || 0), 0)}
                   </span>
                   <span className="text-sm text-slate-500">créditos</span>
                 </div>
              </div>
              <div>
                 <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Mais Usado</div>
                 <div className="text-sm font-medium text-slate-900 mt-1">Geração IA</div>
              </div>
           </div>
           <button className="flex items-center gap-2 px-4 py-2 font-medium text-sm text-white bg-[#FF5B03] hover:bg-[#E14E00] transition-colors rounded-lg shadow-sm">
              <Plus className="w-4 h-4" /> Comprar Créditos
           </button>
        </div>
      </div>
  
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
         <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center">
            <h2 className="text-base font-bold text-slate-900 tracking-tight">Transações Recentes</h2>
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-500">Filtrar por:</span>
              <select className="text-sm border border-slate-200 rounded-md bg-white pr-8 pl-3 py-1.5 outline-none focus:border-[#FF5B03]">
                 <option>Todos os Tipos</option>
              </select>
            </div>
         </div>
         <table className="w-full text-left text-sm whitespace-nowrap">
           <thead className="bg-[#f7f9fb] border-b border-slate-200">
             <tr>
               <th className="px-6 py-3 font-semibold text-slate-500 text-xs tracking-wider uppercase">Data e Hora</th>
               <th className="px-6 py-3 font-semibold text-slate-500 text-xs tracking-wider uppercase">Ação</th>
               <th className="px-6 py-3 font-semibold text-slate-500 text-xs tracking-wider uppercase">Produto / Detalhes</th>
               <th className="px-6 py-3 text-right font-semibold text-slate-500 text-xs tracking-wider uppercase">Créditos</th>
             </tr>
           </thead>
           <tbody className="divide-y divide-slate-100">
             {creditLogs.length === 0 ? (
               <tr><td colSpan={4} className="px-6 py-8 text-center text-slate-500">Nenhuma transação registrada.</td></tr>
             ) : (
               creditLogs.map((log) => (
                 <tr key={log.id} className="hover:bg-slate-50/50 transition-colors">
                   <td className="px-6 py-4 text-slate-600">{new Date(log.timestamp).toLocaleString('pt-BR')}</td>
                   <td className="px-6 py-4">
                     <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-100 text-slate-600 text-xs font-medium">
                       <RefreshCw className="w-3 h-3" /> {log.actionType}
                     </span>
                   </td>
                   <td className="px-6 py-4 text-slate-900 max-w-xs xl:max-w-md truncate" title={log.productName}>
                     {log.type === 'purchase' ? (
                       <>
                         Compra de {log.creditsAdded ?? 0} créditos
                         {log.amount != null && (
                           <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                             R$ {log.amount.toFixed(2).replace('.', ',')}
                           </div>
                         )}
                       </>
                     ) : log.type === 'bonus' ? (
                       <span className="text-slate-600">{log.actionType}</span>
                     ) : (
                       <>
                         {log.productName}
                         <div className="text-[10px] text-slate-400 font-mono mt-0.5">{log.sku}</div>
                       </>
                     )}
                   </td>
                   <td className="px-6 py-4 text-right font-medium">
                     {isCreditGrant(log) ? (
                       <span className="text-green-600">+{log.creditsAdded ?? 0}</span>
                     ) : (
                       <span className="text-red-500">-{log.creditsConsumed || 0}</span>
                     )}
                   </td>
                 </tr>
               ))
             )}
           </tbody>
         </table>
         <div className="px-6 py-3 border-t border-slate-200 bg-white flex justify-between items-center text-sm text-slate-500">
            <span>Mostrando transações</span>
            <div className="flex gap-2">
              <button disabled className="p-1 text-slate-300"><ChevronLeft className="w-4 h-4"/></button>
              <button disabled className="p-1 text-slate-300"><ChevronRight className="w-4 h-4"/></button>
            </div>
         </div>
      </div>
    </div>
  );

  if (user && workspace === 'operations') {
    return (
      <Suspense fallback={<div className="h-screen flex items-center justify-center bg-[#f7f9fb] text-slate-400"><RefreshCw className="w-6 h-6 animate-spin" /></div>}>
        <OperationsApp
          user={user}
          credits={credits}
          onSwitchToProduct={() => setWorkspace('product')}
          onBuyCredits={() => setIsCreditPurchaseOpen(true)}
          onLogout={handleLogout}
        />
      </Suspense>
    );
  }

  if (user && workspace === 'content') {
    return (
      <Suspense fallback={<div className="h-screen flex items-center justify-center bg-[#f7f9fb] text-slate-400"><RefreshCw className="w-6 h-6 animate-spin" /></div>}>
        <ContentApp
          user={user}
          credits={credits}
          hasBlogModule={hasBlogModule}
          onSwitchToProduct={() => setWorkspace('product')}
          onBuyCredits={() => setIsCreditPurchaseOpen(true)}
          onLogout={handleLogout}
        />
      </Suspense>
    );
  }

  const renderApp = () => (
    <div className="h-screen bg-[#f7f9fb] flex font-sans overflow-hidden">
      <input type="file" accept=".xlsx, .xls" className="hidden" ref={fileInputRef} onChange={handleFileUpload} />
      {isFirebaseUnavailable && (
        <div className="absolute top-0 inset-x-0 bg-red-600 text-white px-4 py-2 text-center text-sm font-medium flex items-center justify-center gap-2 z-50">
          <AlertCircle className="w-4 h-4" />
          Serviços em nuvem indisponíveis no momento (Verifique cotas ou conexão).
        </div>
      )}
      
      {/* Sidebar Overlay for Mobile */}
      {isSidebarOpen && (
        <div 
          onClick={() => setIsSidebarOpen(false)} 
          className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-30 md:hidden transition-opacity duration-300" 
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 w-[260px] bg-[#141311] text-white flex-shrink-0 flex flex-col z-40 
        shadow-[4px_0_24px_rgba(0,0,0,0.05)] pt-4 transition-transform duration-300 md:static md:translate-x-0
        ${isSidebarOpen ? "translate-x-0" : "-translate-x-full"}
      `}>
        <div className="h-16 px-5 flex items-center justify-between border-b border-white/5 mx-3 mb-4 pb-4">
          <div className="flex items-center gap-2 min-w-0">
            <img src={logoAlfreds} alt="Alfreds — Agente de Produto" className="h-9 w-auto" />
          </div>
          {/* Close Sidebar button on mobile */}
          <button 
            onClick={() => setIsSidebarOpen(false)} 
            className="md:hidden p-1 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-all"
            title="Fechar Menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Workspace switcher — only when Content Agent module is enabled */}
        {hasContentAgent && (
          <div className="px-3 mb-3">
            <button
              onClick={() => { setWorkspace('content'); setIsSidebarOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-slate-300 bg-white/5 hover:bg-white/10 transition-colors"
              title="Trocar para a Agente de Conteúdo"
            >
              <FileText className="w-4 h-4" /> Ir para Agente de Conteúdo
            </button>
          </div>
        )}

        {/* Agente Operacional — opera Wake/Tiny por conversa, com aprovação por ação */}
        {hasOperationsAgent && (
          <div className="px-3 mb-3">
            <button
              onClick={() => { setWorkspace('operations'); setIsSidebarOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-slate-300 bg-white/5 hover:bg-white/10 transition-colors"
              title="Trocar para o Agente Operacional"
            >
              <Zap className="w-4 h-4" /> Ir para Agente Operacional
            </button>
          </div>
        )}

        <nav className="mt-2 px-3 flex flex-col gap-1 flex-1">
          <button
            onClick={() => { setMainView('products'); setIsSidebarOpen(false); }}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-200 ${mainView === 'products' ? 'bg-[#1e293b] text-white font-medium before:absolute before:left-0 before:h-6 before:w-1 before:bg-[#FF5B03] before:rounded-r-full relative' : 'text-slate-400 font-medium hover:text-white hover:bg-white/5'}`}
          >
            <Layout className="w-4 h-4" /> Produtos
          </button>
          <button 
            onClick={() => { setMainView('categories'); setIsSidebarOpen(false); }} 
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-200 ${mainView === 'categories' ? 'bg-[#1e293b] text-white font-medium before:absolute before:left-0 before:h-6 before:w-1 before:bg-[#FF5B03] before:rounded-r-full relative' : 'text-slate-400 font-medium hover:text-white hover:bg-white/5'}`}
          >
            <Folder className="w-4 h-4" /> Categorias
          </button>
          <div className="my-2 border-t border-white/5 mx-4"></div>
          <button 
            onClick={() => { setMainView('history'); fetchCreditLogs(); setIsSidebarOpen(false); setIsCreditHistoryOpen(false); }} 
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-200 ${mainView === 'history' ? 'bg-[#1e293b] text-white font-medium before:absolute before:left-0 before:h-6 before:w-1 before:bg-[#FF5B03] before:rounded-r-full relative' : 'text-slate-400 font-medium hover:text-white hover:bg-white/5'}`}
          >
            <RefreshCw className="w-4 h-4" /> Histórico
          </button>
          <button
            onClick={() => {
              setMainView('referral');
              setIsSidebarOpen(false);
              if (!referralNavSeen) { setReferralNavSeen(true); localStorage.setItem('referralNavSeen', '1'); }
            }}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-200 ${mainView === 'referral' ? 'bg-[#1e293b] text-white font-medium before:absolute before:left-0 before:h-6 before:w-1 before:bg-[#FF5B03] before:rounded-r-full relative' : 'text-slate-400 font-medium hover:text-white hover:bg-white/5'}`}
          >
            <Gift className="w-4 h-4" /> Indique e Ganhe
            {!referralNavSeen && (
              <span className="ml-auto relative flex h-2 w-2 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#FF5B03] opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-[#FF5B03]" />
              </span>
            )}
          </button>
        </nav>

        {/* Production queue widget — visible whenever a video job is active */}
        {activeVideoJob && (() => {
          const step = activeVideoJob.step;
          const total = activeVideoJob.totalShots ?? 4;
          const done = activeVideoJob.shotsDone ?? 0;
          const isShot = !step || step === 'shot';
          let pct = 2;
          let stepLabel = 'Aguardando na fila...';
          if (activeVideoJob.status === 'done') {
            pct = 100; stepLabel = 'Concluído!';
          } else if (step === 'post') {
            pct = 88; stepLabel = 'Montando vídeo, narração e música...';
          } else if (step === 'uploading') {
            pct = 96; stepLabel = 'Enviando vídeo...';
          } else if (activeVideoJob.status === 'processing') {
            pct = Math.min(5 + Math.round((done / total) * 80), 85);
            stepLabel = `${done} de ${total} trechos prontos (~2 a 5 min)`;
          }
          const productName = products.find(p => p._id === activeVideoJob.productId)?.['Descrição'] ?? 'Produto';
          return (
            <div className="mx-3 mb-3 p-3 rounded-xl bg-[#1e293b] border border-white/10">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-2 h-2 rounded-full bg-violet-400 animate-pulse shrink-0" />
                <span className="text-[11px] font-bold text-violet-300 uppercase tracking-wide">Fila de Produção</span>
              </div>
              <p className="text-xs text-slate-300 font-medium truncate mb-2" title={productName}>{productName}</p>
              <div className="space-y-1">
                <div className="flex justify-between text-[10px] text-slate-400">
                  <span>{stepLabel}</span>
                  <span>{pct}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-slate-700 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-violet-500 to-purple-500 transition-all duration-700"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                {isShot && activeVideoJob.status === 'processing' && (
                  <div className="flex gap-1 pt-1">
                    {Array.from({ length: total }).map((_, i) => (
                      <div
                        key={i}
                        className={`flex-1 h-1 rounded-full transition-all ${i < done ? 'bg-violet-500' : 'bg-violet-400 animate-pulse'}`}
                      />
                    ))}
                  </div>
                )}
              </div>
              {activeVideoJob.status === 'done' && (
                <p className="text-[10px] text-green-400 font-bold mt-1.5">✓ Vídeo pronto!</p>
              )}
            </div>
          );
        })()}

        <div className="p-4 mt-auto mb-2 border-t border-white/5 mx-3 flex flex-col gap-1">
          <button
            onClick={() => { setMainView('tutorial'); setIsSidebarOpen(false); }}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${mainView === 'tutorial' ? 'bg-[#1e293b] text-white' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}
          >
            <GraduationCap className="w-4 h-4" /> Tutorial
          </button>
          <button
            onClick={() => { setMainView('integrations'); setIsSidebarOpen(false); }}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${mainView === 'integrations' ? 'bg-[#1e293b] text-white' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}
          >
            <Plug className="w-4 h-4" /> Integrações
          </button>
          <button
            onClick={() => { setMainView('company'); setIsSidebarOpen(false); }}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${mainView === 'company' ? 'bg-[#1e293b] text-white' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}
          >
            <Building2 className="w-4 h-4" /> Empresa
          </button>
          <button
            onClick={() => { setIsTemplateModalOpen(true); setIsSidebarOpen(false); }}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-400 font-medium hover:text-white hover:bg-white/5 transition-colors"
          >
            <Settings className="w-4 h-4" /> Configurações
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#f7f9fb] h-screen overflow-hidden">
        {/* Top Bar */}
        <header className="h-16 bg-white border-b border-slate-200 px-4 md:px-6 flex items-center justify-between flex-shrink-0 z-10 sticky top-0 shadow-sm gap-3">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <button 
              onClick={() => setIsSidebarOpen(true)} 
              className="md:hidden p-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors shrink-0"
              title="Abrir Menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="w-full md:w-[360px] relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input 
                type="text" 
                placeholder="Buscar produtos..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-full pl-9 pr-4 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#FF5B03] focus:border-[#FF5B03] focus:bg-white transition-all text-slate-700 placeholder-slate-400" 
              />
            </div>
          </div>

          <div className="flex items-center gap-3 md:gap-5 shrink-0">
            {!onboardingCompleted && (
              <button
                onClick={() => setIsOnboardingWizardOpen(true)}
                className="hidden sm:flex items-center gap-1.5 text-xs md:text-sm font-semibold text-[#FF5B03] bg-gradient-to-r from-orange-50 to-amber-50 border border-orange-200 px-2.5 md:px-3 py-1 rounded-full shadow-sm hover:border-orange-300 transition-colors animate-in fade-in"
                title="Complete seu cadastro e ganhe créditos"
              >
                <Gift className="w-4 h-4 shrink-0" />
                Ganhe 30 créditos
              </button>
            )}
            <button
              onClick={() => { setIsCreditPurchaseOpen(true); trackCreditPurchaseOpen(); }}
              className="flex items-center gap-1.5 text-xs md:text-sm font-semibold text-slate-600 bg-slate-50 border border-slate-200 px-2.5 md:px-3 py-1 rounded-full shadow-sm hover:bg-amber-50 hover:border-amber-200 transition-colors"
              title="Comprar créditos"
            >
              <Coins className="w-4 h-4 text-amber-500 shrink-0" />
              <span className="hidden sm:inline">Créditos:</span>
              <span className="text-slate-900 font-bold">{credits}</span>
            </button>
            <div className="h-6 w-px bg-slate-200"></div>
            <div className="relative">
              <button onClick={() => setIsProfileDropdownOpen(!isProfileDropdownOpen)} className="flex items-center gap-2 group p-1 hover:bg-slate-50 border border-transparent hover:border-slate-200 rounded-full transition-colors focus:outline-none" title="Opções da conta">
                 <img src={user.photoURL || `https://ui-avatars.com/api/?name=${user.email}`} alt="User Avatar" className="w-7 h-7 rounded-full border border-slate-200 group-hover:border-[#FF5B03] transition-colors" />
                 <span className="text-xs font-medium text-slate-700 hidden lg:block truncate max-w-[100px]">{user.displayName || user.email?.split('@')[0]}</span>
              </button>
              
              {isProfileDropdownOpen && (
                <>
                  <div 
                    className="fixed inset-0 z-40" 
                    onClick={() => setIsProfileDropdownOpen(false)}
                  />
                  <div className="absolute right-0 mt-2 w-48 bg-white border border-slate-200 flex flex-col rounded-xl shadow-lg z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50">
                      <p className="text-sm font-medium text-slate-900 truncate">{user.displayName || 'Usuário'}</p>
                      <p className="text-xs text-slate-500 truncate mt-0.5">{user.email}</p>
                    </div>
                    <div className="p-2">
                      <button 
                        onClick={() => {
                          setIsProfileDropdownOpen(false);
                          handleLogout();
                        }}
                        className="w-full text-left px-3 py-2 text-sm text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors flex items-center gap-2 font-medium"
                      >
                        <LogOut className="w-4 h-4" />
                        Sair da conta
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        {/* Dynamic View Content */}
        <main className="flex-1 overflow-y-auto w-full p-6 bg-[#f7f9fb]">
          {mainView === 'categories' ? (
            <div className="animate-in fade-in h-full bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
              <Suspense fallback={<div className="h-full flex items-center justify-center text-slate-400"><RefreshCw className="w-6 h-6 animate-spin" /></div>}>
                <CategoryManager onClose={async () => {
                  setMainView('products');
                  if (user) {
                    const cats = await fetchCategories(user.uid);
                    setExistingCategories(cats);
                  }
                }} />
              </Suspense>
            </div>
          ) : mainView === 'history' ? (
            renderHistoryView()
          ) : mainView === 'integrations' ? (
            <IntegrationsView onImport={handleWakeImport} getPushPayload={buildWakePushPayload} onTinyImported={() => { if (!hasUnsavedChanges) loadFromCloud(true); }} getTinyPushPayload={buildTinyPushPayload} tinyPushCandidateCount={tinySelectedProducts(products).length} onBlingImported={() => { if (!hasUnsavedChanges) loadFromCloud(true); }} getBlingPushPayload={buildBlingPushPayload} getBlingPushCandidates={getBlingPushCandidates} onBlingPushed={handleBlingPushed} />
          ) : mainView === 'tutorial' ? (
            <TutorialView onFinish={() => setMainView('products')} />
          ) : mainView === 'referral' ? (
            <Suspense fallback={<div className="h-full flex items-center justify-center text-slate-400"><RefreshCw className="w-6 h-6 animate-spin" /></div>}>
              <ReferralPage user={user} />
            </Suspense>
          ) : mainView === 'company' ? (
            <Suspense fallback={<div className="h-full flex items-center justify-center text-slate-400"><RefreshCw className="w-6 h-6 animate-spin" /></div>}>
              <CompanyProfile company={companyData} onSaved={setCompanyData} />
            </Suspense>
          ) : (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 h-full flex flex-col max-w-[1600px] mx-auto">
               {!onboardingCompleted && !onboardingBannerDismissed && (
                 <div className="relative mb-4 shrink-0 overflow-hidden rounded-2xl bg-gradient-to-br from-[#141311] to-[#1e3a8a] shadow-lg shadow-slate-900/10">
                   <div className="pointer-events-none absolute -right-6 -top-10 h-32 w-32 rounded-full bg-orange-500/30 blur-3xl" />
                   <button
                     onClick={() => { setOnboardingBannerDismissed(true); localStorage.setItem('onboardingBannerDismissed', '1'); }}
                     className="absolute right-3 top-3 z-10 p-1.5 text-white/70 hover:text-white bg-white/10 hover:bg-white/20 rounded-full transition-colors"
                     title="Dispensar"
                   >
                     <X className="w-4 h-4" />
                   </button>
                   <div className="relative flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-4 pr-12 sm:py-3.5 sm:pr-4">
                     <div className="flex items-center gap-2.5 min-w-0">
                       <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-white/10 shrink-0">
                         <Gift className="w-5 h-5 text-orange-300" />
                       </span>
                       <p className="text-sm text-white/85 leading-snug">
                         <span className="font-display font-bold text-white">Complete seu cadastro</span>
                         <span className="block sm:inline sm:ml-1">e ganhe 30 créditos — leva menos de 2 minutos.</span>
                       </p>
                     </div>
                     <button
                       onClick={() => setIsOnboardingWizardOpen(true)}
                       className="w-full sm:w-auto sm:ml-auto shrink-0 px-4 py-2.5 sm:py-1.5 text-sm font-bold text-[#141311] bg-white hover:bg-orange-50 rounded-xl shadow-sm transition-colors active:scale-95"
                     >
                       Completar agora
                     </button>
                   </div>
                 </div>
               )}
               {products.length === 0 && (
                 <button
                   onClick={() => setIsProductUrlImportOpen(true)}
                   className="sm:hidden mb-4 w-full shrink-0 flex items-center justify-center gap-2 px-4 py-3 bg-[#FF5B03] text-white rounded-xl shadow-md shadow-orange-200 font-bold text-sm hover:bg-[#E14E00] transition-all active:scale-95"
                 >
                   <LinkIcon className="w-4 h-4" /> Criar meu primeiro produto
                 </button>
               )}
               <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center mb-5 gap-4 flex-shrink-0">
                 <div>
                   <h1 className="font-display text-xl md:text-2xl font-bold text-slate-900 tracking-tight">Catálogo de Produtos</h1>
                   <p className="text-xs md:text-sm text-slate-500 mt-0.5">Gerencie e enriqueça seu inventário de produtos.</p>
                 </div>

                 {/* Legenda de Status */}
                 <div className="hidden xl:flex items-center gap-3 px-4 py-2 bg-white/80 border border-slate-200 rounded-xl shadow-sm">
                   <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Legenda</span>
                   <div className="h-4 w-px bg-slate-200" />
                   <div className="flex items-center gap-3.5">
                     {([
                       { Icon: Sparkles, label: 'Descrição', color: 'text-orange-600 bg-orange-50' },
                       { Icon: Tag, label: 'Atributos', color: 'text-amber-600 bg-amber-50' },
                       // { Icon: Search, label: 'Enriquecido', color: 'text-purple-600 bg-purple-50' }, // desativado temporariamente
                       { Icon: ImageIcon, label: 'Imagens', color: 'text-orange-600 bg-orange-50' },
                     ] as const).map(({ Icon, label, color }) => (
                       <div key={label} className="flex items-center gap-1.5">
                         <span className={cn("flex items-center justify-center w-5 h-5 rounded-md border border-slate-200/60", color)}>
                           <Icon className="w-3 h-3" />
                         </span>
                         <span className="text-[11px] font-medium text-slate-600">{label}</span>
                       </div>
                     ))}
                   </div>
                 </div>

                 <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full lg:w-auto">
                   {isLoadingFromCloud && (
                     <div className="flex items-center gap-1.5 text-xs text-slate-500 font-medium">
                       <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                       <span>Sincronizando...</span>
                     </div>
                   )}

                   <div className="flex items-center gap-2 w-full sm:w-auto">
                     <button
                       onClick={() => saveToCloud()}
                       disabled={isSavingToCloud || !hasUnsavedChanges || products.length === 0}
                       className={cn(
                         "flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 px-3 py-2 border rounded-lg shadow-sm text-xs md:text-sm font-semibold transition-all h-9 whitespace-nowrap",
                         hasUnsavedChanges 
                           ? 'bg-orange-50 border-orange-200 text-[#FF5B03] hover:bg-orange-100' 
                           : 'bg-slate-50 border-slate-200 text-slate-400 opacity-50'
                       )}
                     >
                       {isSavingToCloud ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className={cn("w-4 h-4", hasUnsavedChanges ? "text-[#FF5B03]" : "text-slate-400")} />}
                       <span>{isSavingToCloud ? 'Salvando...' : 'Salvar'}</span>
                     </button>
                     <button 
                       onClick={() => fileInputRef.current?.click()} 
                       className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 px-3 py-2 font-bold text-xs md:text-sm text-white bg-[#FF5B03] hover:bg-[#E14E00] transition-all rounded-lg shadow-md h-9 whitespace-nowrap"
                     >
                       <Upload className="w-4 h-4" /> 
                       <span>Importar</span>
                     </button>
                   </div>
                 </div>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col flex-1 min-h-0 relative">
                  
                  {/* Toolbar */}
                  <div className="px-5 py-3.5 flex flex-wrap items-center justify-between border-b border-slate-200 bg-white gap-3 rounded-t-xl shrink-0 relative z-30">
                      <div className="flex items-center gap-2 flex-wrap">
                        <select 
                          className="px-2.5 py-1.5 text-sm rounded-lg border border-slate-200 text-slate-700 font-medium focus:ring-[#FF5B03] outline-none focus:border-[#FF5B03] bg-slate-50 hover:bg-slate-100 transition-colors cursor-pointer"
                          value={filterMarca}
                          onChange={(e) => setFilterMarca(e.target.value)}
                        >
                          <option value="">Todas as Marcas</option>
                          {marcas.map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                        <select 
                          className="px-2.5 py-1.5 text-sm rounded-lg border border-slate-200 text-slate-700 font-medium focus:ring-[#FF5B03] outline-none focus:border-[#FF5B03] bg-slate-50 hover:bg-slate-100 transition-colors cursor-pointer"
                          value={filterCategoria}
                          onChange={(e) => setFilterCategoria(e.target.value)}
                        >
                          <option value="">Todas as Categorias</option>
                          {categorias.map(m => <option key={m} value={m}>{m}</option>)}
                        </select>

                        {(() => {
                          const activeStatusCount = Object.values(statusFilters).filter(Boolean).length;
                          const statusFilterItems: { key: keyof typeof statusFilters; label: string }[] = [
                            { key: 'descricao', label: 'Descrição Gerada' },
                            // { key: 'enriquecido', label: 'Enriquecido' }, // desativado temporariamente
                            { key: 'imagens', label: 'Imagens Geradas' },
                            { key: 'atributos', label: 'Atributos Gerados' },
                          ];
                          return (
                          <div className="relative inline-block text-left z-30">
                            <button
                              type="button"
                              onClick={() => {
                                setIsFilterDropdownOpen(!isFilterDropdownOpen);
                                setIsColumnConfigOpen(false);
                                setIsExportDropdownOpen(false);
                              }}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-slate-200 text-slate-700 font-medium focus:ring-[#FF5B03] focus:border-[#FF5B03] outline-none bg-slate-50 hover:bg-slate-100 transition-colors cursor-pointer select-none"
                            >
                              <Filter className="w-4 h-4 text-slate-500" />
                              <span>Filtrar por Status</span>
                              {activeStatusCount > 0 ? (
                                <span className="inline-flex items-center justify-center bg-[#FF5B03] text-white rounded-md px-1.5 py-0.5 text-[10px] font-bold leading-none ml-1">
                                  {activeStatusCount}
                                </span>
                              ) : (
                                <span className="text-slate-400 text-xs ml-1 font-normal">Nenhum</span>
                              )}
                              <ChevronDown className="w-3.5 h-3.5 text-slate-400 ml-0.5" />
                            </button>

                            {isFilterDropdownOpen && (
                              <>
                                <div
                                  className="fixed inset-0 z-30"
                                  onClick={() => setIsFilterDropdownOpen(false)}
                                />
                                <div className="absolute left-0 mt-1.5 w-64 bg-white border border-slate-200 rounded-lg shadow-lg z-40 py-2 animate-in fade-in slide-in-from-top-1">
                                  <div className="flex items-center justify-between px-3.5 py-1.5">
                                    <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider">
                                      <button
                                        type="button"
                                        onClick={() => setStatusFilterMode('esconder')}
                                        className={`px-1.5 py-0.5 rounded transition-colors ${statusFilterMode === 'esconder' ? 'bg-[#FF5B03] text-white' : 'text-slate-400 hover:text-slate-600'}`}
                                      >
                                        Esconder
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setStatusFilterMode('mostrar')}
                                        className={`px-1.5 py-0.5 rounded transition-colors ${statusFilterMode === 'mostrar' ? 'bg-[#FF5B03] text-white' : 'text-slate-400 hover:text-slate-600'}`}
                                      >
                                        Mostrar
                                      </button>
                                      <span className="text-slate-400 font-bold normal-case ml-0.5">produtos com</span>
                                    </div>
                                    {activeStatusCount > 0 && (
                                      <button
                                        onClick={() => {
                                          setStatusFilters({ descricao: false, enriquecido: false, imagens: false, atributos: false });
                                          setStatusFilterMode('esconder');
                                        }}
                                        className="text-[10px] font-bold text-[#FF5B03] hover:underline"
                                      >
                                        Limpar
                                      </button>
                                    )}
                                  </div>
                                  <hr className="border-slate-100 my-1" />
                                  {statusFilterItems.map(item => (
                                    <label key={item.key} className="flex items-center gap-2.5 px-3.5 py-2 cursor-pointer hover:bg-slate-50 transition-colors text-xs font-semibold text-slate-600 select-none">
                                      <input
                                        type="checkbox"
                                        checked={statusFilters[item.key]}
                                        onChange={(e) => setStatusFilters(prev => ({ ...prev, [item.key]: e.target.checked }))}
                                        className="rounded border-slate-300 text-[#FF5B03] focus:ring-[#FF5B03] w-4 h-4 cursor-pointer"
                                      />
                                      <span>{item.label}</span>
                                    </label>
                                  ))}
                                </div>
                              </>
                            )}
                          </div>
                          );
                        })()}

                        <div className="w-px h-5 bg-slate-200 mx-1 sm:mx-2"></div>
                        <div className="text-xs text-slate-500 font-medium">{paginatedProducts.length} itens</div>
                      </div>
                     <div className="flex items-center gap-2 ml-auto relative">
                        {generationLog && (
                          <div className="mr-3 flex items-center gap-2 text-xs font-medium text-[#FF5B03] bg-orange-50 px-3 py-1.5 rounded-full border border-orange-100 shadow-sm animate-in fade-in slide-in-from-right-4">
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            {generationProgress.current} / {generationProgress.total} 
                            <span className="opacity-0 sm:opacity-100 overflow-hidden truncate max-w-[150px]">- {generationLog}</span>
                          </div>
                        )}
                        {/* Botão Enriquecer em massa — desativado temporariamente
                        <button
                          onClick={handleEnrichMass}
                          disabled={selectedIds.size === 0 || isEnrichingMass || isGeneratingMass}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-white text-purple-700 border border-purple-200 rounded-lg text-sm font-medium hover:bg-purple-50 hover:border-purple-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                        >
                          {isEnrichingMass ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                          <span className="hidden sm:inline">Enriquecer ({selectedIds.size})</span>
                        </button>
                        */}
                        <button
                          onClick={handleGenerateMass}
                          disabled={selectedIds.size === 0 || isGeneratingMass || isEnrichingMass}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-white text-[#FF5B03] border border-orange-200 rounded-lg text-sm font-medium hover:bg-orange-50 hover:border-[#FF5B03] transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                        >
                          {isGeneratingMass ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                          <span className="hidden sm:inline">Gerar ({selectedIds.size})</span>
                        </button>
                        
                        <button
                          onClick={handleDeleteSelected}
                          disabled={selectedIds.size === 0}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-white text-red-600 border border-red-200 rounded-lg text-sm font-medium hover:bg-red-50 hover:border-red-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                          title="Excluir Selecionados"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">Excluir ({selectedIds.size})</span>
                        </button>

                        <div className="w-px h-5 bg-slate-200 mx-1 sm:mx-2"></div>

                        <button
                          onClick={() => {
                            setIsColumnConfigOpen(!isColumnConfigOpen);
                            setIsExportDropdownOpen(false);
                          }}
                          className={cn(
                            "p-1.5 border rounded-lg transition-colors shadow-sm",
                            isColumnConfigOpen
                              ? "border-[#FF5B03]/30 bg-orange-50 text-[#FF5B03]"
                              : "border-slate-200 bg-white text-slate-500 hover:text-slate-700 hover:bg-slate-50"
                          )}
                          title="Colunas Visíveis"
                        >
                          <Columns3 className="w-4 h-4" />
                        </button>
                        
                        <div className="relative">
                          <button
                            onClick={() => {
                              setIsExportDropdownOpen(!isExportDropdownOpen);
                              setIsColumnConfigOpen(false);
                            }}
                            className="p-1.5 border border-slate-200 bg-white rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-50 transition-all shadow-sm flex items-center justify-center gap-1 hover:border-slate-300"
                            title="Opções de Exportação"
                            id="export-dropdown-btn"
                          >
                            <Download className="w-4 h-4 text-slate-500" />
                          </button>
                          
                          {isExportDropdownOpen && (
                            <div className="absolute right-0 top-12 w-64 bg-white border border-slate-200 rounded-xl shadow-xl p-2 z-30 animate-in fade-in slide-in-from-top-2 origin-top-right">
                              <div className="flex justify-between items-center px-2 py-1.5 mb-1 border-b border-slate-100">
                                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Exportar Planilha</h4>
                                <button onClick={() => setIsExportDropdownOpen(false)} className="text-slate-400 hover:text-slate-600"><X className="w-3.5 h-3.5"/></button>
                              </div>
                              <div className="flex flex-col gap-1">
                                <button
                                  onClick={() => {
                                    handleExport('standard');
                                    setIsExportDropdownOpen(false);
                                  }}
                                  className="w-full text-left px-3 py-2 hover:bg-slate-50 rounded-lg flex items-start gap-2.5 transition-colors group"
                                >
                                  <div className="p-1.5 bg-orange-50 text-orange-600 rounded-md group-hover:bg-orange-600 group-hover:text-white transition-colors">
                                    <Layout className="w-3.5 h-3.5" />
                                  </div>
                                  <div className="flex flex-col">
                                    <span className="text-xs font-bold text-slate-700 group-hover:text-slate-900 leading-tight">Modelo Padrão</span>
                                    <span className="text-[10px] text-slate-400 leading-normal">Formato original com novos atributos</span>
                                  </div>
                                </button>
                                
                                <button
                                  onClick={() => {
                                    handleExport('tinyerp');
                                    setIsExportDropdownOpen(false);
                                  }}
                                  className="w-full text-left px-3 py-2 hover:bg-slate-50 rounded-lg flex items-start gap-2.5 transition-colors group"
                                >
                                  <div className="p-1.5 bg-orange-50 text-orange-600 rounded-md group-hover:bg-orange-600 group-hover:text-white transition-colors">
                                    <Download className="w-3.5 h-3.5" />
                                  </div>
                                  <div className="flex flex-col">
                                    <span className="text-xs font-bold text-slate-700 group-hover:text-slate-900 leading-tight">Modelo Tiny ERP</span>
                                    <span className="text-[10px] text-slate-400 leading-normal">Formatado para o importador Tiny ERP</span>
                                  </div>
                                </button>
                              </div>
                            </div>
                          )}
                        </div>

                        {isColumnConfigOpen && (
                            <div className="absolute right-0 top-12 w-56 bg-white border border-slate-200 rounded-xl shadow-xl p-3 z-30 animate-in fade-in slide-in-from-top-2 origin-top-right">
                              <div className="flex justify-between items-center mb-2 pb-2 border-b border-slate-100">
                                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Colunas</h4>
                                <button onClick={() => setIsColumnConfigOpen(false)} className="text-slate-400 hover:text-slate-600"><X className="w-3.5 h-3.5"/></button>
                              </div>
                              <div className="space-y-1 max-h-60 overflow-y-auto pr-1">
                                {Object.keys(visibleColumns).map(col => (
                                  <label key={col} className="flex items-center gap-2 cursor-pointer py-1.5 px-2 hover:bg-slate-50 rounded-md transition-colors group">
                                    <input type="checkbox" checked={visibleColumns[col]} onChange={(e) => setVisibleColumns(prev => ({ ...prev, [col]: e.target.checked }))} className="rounded border-slate-300 text-[#FF5B03] focus:ring-[#FF5B03] opacity-70 group-hover:opacity-100 transition-opacity" />
                                    <span className="text-sm text-slate-700 group-hover:text-slate-900 font-medium">{col === 'Descrição' ? 'Título' : col}</span>
                                  </label>
                                ))}
                              </div>
                            </div>
                        )}
                     </div>
                 </div>

                 {/* Products Table Core */}
                 <div className="flex-1 overflow-auto relative rounded-b-xl">
                     <table className="min-w-full text-left text-sm whitespace-nowrap">
                       <thead className="bg-[#f7f9fb] border-b border-slate-200 sticky top-0 z-20 shadow-sm backdrop-blur-sm bg-opacity-95">
                         <tr>
                            <th className="px-5 py-3.5 w-12 border-r border-slate-200">
                              <input
                                type="checkbox"
                                onChange={(e) => setSelectedIds(e.target.checked ? new Set(paginatedProducts.map(p => p._id)) : new Set())}
                                className="rounded border-slate-300 text-[#FF5B03] focus:ring-[#FF5B03]"
                              />
                            </th>
                                      {visibleColumns['Img'] && <th className="px-4 py-3.5 font-bold text-slate-600 text-xs tracking-wider uppercase">IMG</th>}
                            {visibleColumns['SKU'] && <th className="px-4 py-3.5 font-bold text-slate-600 text-xs tracking-wider uppercase">SKU</th>}
                            {visibleColumns['Descrição'] && <th className="px-4 py-3.5 font-bold text-slate-600 text-xs tracking-wider uppercase">Título</th>}
                            {visibleColumns['Categoria'] && <th className="px-4 py-3.5 font-bold text-slate-600 text-xs tracking-wider uppercase">Categoria</th>}
                            {visibleColumns['Marca'] && <th className="px-4 py-3.5 font-bold text-slate-600 text-xs tracking-wider uppercase">Marca</th>}
                            {visibleColumns['Status'] && <th className="px-4 py-3.5 font-bold text-slate-600 text-xs tracking-wider uppercase">Status</th>}
                            <th className="px-5 py-3.5 text-right font-bold text-slate-600 text-xs tracking-wider uppercase bg-[#f7f9fb] shadow-[inset_1px_0_0_0_#e2e8f0] sticky right-0 z-20 w-[280px]">Ações</th>
                         </tr>
                       </thead>
                       <tbody className="divide-y divide-slate-100">
                          {products.length === 0 ? (
                            <tr>
                              <td colSpan={20}>
                                <div className="p-16 flex flex-col items-center justify-center text-center w-full">
                                  <div className="w-16 h-16 bg-slate-50 border border-slate-200 rounded-2xl flex items-center justify-center mb-4">
                                    <LinkIcon className="w-8 h-8 text-slate-400" />
                                  </div>
                                  <h3 className="font-display text-2xl font-bold text-slate-900 mb-2 text-center">Pronto para começar?</h3>
                                  <p className="text-sm text-slate-500 mb-8 max-w-sm text-center">
                                    Cole o link de um produto e deixe a IA preencher o resto para você.
                                  </p>
                                  <button
                                    onClick={() => setIsProductUrlImportOpen(true)}
                                    className="px-8 py-3 bg-[#FF5B03] text-white rounded-xl shadow-lg shadow-orange-200 font-bold hover:bg-[#E14E00] transition-all hover:scale-105 active:scale-95 flex items-center gap-2 mb-4"
                                  >
                                    <LinkIcon className="w-5 h-5" /> Colar link do produto
                                  </button>
                                  <p className="text-xs text-slate-400 mb-2">ou importe uma planilha</p>
                                  <div className="flex flex-col sm:flex-row items-center gap-3">
                                    <button
                                      onClick={() => fileInputRef.current?.click()}
                                      className="px-6 py-3 bg-white text-slate-700 rounded-xl border border-slate-200 font-semibold hover:bg-slate-50 transition-all hover:scale-105 active:scale-95 flex items-center gap-2 text-sm"
                                    >
                                      <Upload className="w-4 h-4" /> Importar Arquivo
                                    </button>
                                    <button
                                      onClick={downloadBlankTemplate}
                                      className="px-6 py-3 bg-white text-slate-700 rounded-xl border border-slate-200 font-semibold hover:bg-slate-50 transition-all hover:scale-105 active:scale-95 flex items-center gap-2 text-sm"
                                    >
                                      <Download className="w-4 h-4 text-slate-500" /> Baixar Planilha Padrão
                                    </button>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          ) : paginatedProducts.length === 0 ? (
                            <tr><td colSpan={20} className="text-center p-8 text-slate-500">Nenhum produto corresponde aos filtros.</td></tr>
                          ) : paginatedProducts.map(product => {
                            const isProcessed = product._statusDescricao === 'Gerado por IA';
                            const isOriginal = product._statusDescricao === 'Descrição original';
                            const isError = !!product._generationError || product._statusDescricao === 'Erro';
                            const isEnriched = !!product._enrichmentLog;
                            const flags = getProductStatusFlags(product);
                            const hasChildren = !!(product._children && product._children.length > 0);
                            const isExpanded = expandedParentIds.has(product._id);

                            return (
                            <React.Fragment key={product._id}>
                            <tr className={cn(
                              "hover:bg-[#f1f5f9]/60 transition-colors group relative",
                              product._generationError
                                ? "bg-red-50/40 hover:bg-red-50/60"
                                : selectedIds.has(product._id) ? "bg-orange-50/40" : "bg-white"
                            )}>
                              <td className="px-5 py-3 border-r border-slate-100 bg-inherit">
                                <div className={`absolute left-0 top-0 bottom-0 w-1 transition-colors ${product._generationError ? 'bg-red-500' : isProcessed ? 'bg-orange-500' : isOriginal ? 'bg-emerald-500' : 'bg-transparent'}`}></div>
                                <div className="flex items-center gap-1.5">
                                {hasChildren && (
                                  <button
                                    onClick={() => setExpandedParentIds(prev => {
                                      const next = new Set(prev);
                                      if (next.has(product._id)) next.delete(product._id);
                                      else next.add(product._id);
                                      return next;
                                    })}
                                    className="text-slate-400 hover:text-slate-700 transition-colors"
                                    title={isExpanded ? 'Recolher variantes' : `Expandir ${product._children!.length} variante(s)`}
                                  >
                                    <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${isExpanded ? '' : '-rotate-90'}`} />
                                  </button>
                                )}
                                <input
                                  type="checkbox"
                                  checked={selectedIds.has(product._id)}
                                  onChange={(e) => {
                                    const next = new Set(selectedIds);
                                    if (e.target.checked) next.add(product._id);
                                    else next.delete(product._id);
                                    setSelectedIds(next);
                                  }}
                                  className="rounded border-slate-300 text-[#FF5B03] focus:ring-[#FF5B03]"
                                />
                                </div>
                              </td>
                              {visibleColumns['Img'] && (
                                <td className="px-4 py-2.5 bg-inherit">
                                   <div className="relative inline-block">
                                     {product._generationError && (
                                       <div className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full border border-white shadow-sm z-10 animate-pulse" title="Erro na geração"></div>
                                     )}
                                     {(product._selectedImage || product['URL imagem 1']) ? (
                                       <div className="w-10 h-10 rounded-md border border-slate-200 overflow-hidden bg-white p-[1px] shadow-sm hover:border-[#FF5B03] cursor-pointer transition-colors relative" onClick={() => setCurrentImageSearchProduct(product)}>
                                         <img
                                           src={(product._selectedImage || product['URL imagem 1']!.toString())}
                                           alt="Product"
                                           className="w-full h-full object-contain rounded-sm"
                                           onError={e => {
                                             e.currentTarget.style.display = 'none';
                                             const fallback = e.currentTarget.nextElementSibling as HTMLElement | null;
                                             if (fallback) fallback.removeAttribute('hidden');
                                           }}
                                         />
                                         <span hidden className="absolute inset-0 flex items-center justify-center text-slate-400">
                                           <ImageIcon className="w-4 h-4 opacity-70" />
                                         </span>
                                       </div>
                                     ) : (
                                       <div className="w-10 h-10 rounded-md border border-slate-200 bg-slate-50 flex items-center justify-center text-slate-400 hover:border-[#FF5B03] hover:text-[#FF5B03] cursor-pointer transition-colors shadow-sm" onClick={() => setCurrentImageSearchProduct(product)}>
                                         <ImageIcon className="w-4 h-4 opacity-70" />
                                       </div>
                                     )}
                                   </div>
                                </td>
                              )}
                              {visibleColumns['SKU'] && <td className="px-4 py-3 font-mono text-xs text-slate-600 font-medium bg-inherit">{product['Código (SKU)']}</td>}
                              {visibleColumns['Descrição'] && (
                                <td className="px-4 py-3 text-slate-900 bg-inherit">
                                  <div className="max-w-[400px] 2xl:max-w-[600px] truncate" title={product['Descrição']}>{product['Descrição']}</div>
                                  {hasChildren && (
                                    <div className="mt-0.5">
                                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-orange-50 text-orange-600 border border-orange-200 uppercase tracking-wide cursor-pointer" onClick={() => setExpandedParentIds(prev => { const next = new Set(prev); if (next.has(product._id)) next.delete(product._id); else next.add(product._id); return next; })}>
                                        {product._children!.length} variante{product._children!.length > 1 ? 's' : ''} {isExpanded ? '▲' : '▼'}
                                      </span>
                                    </div>
                                  )}
                                </td>
                              )}
                              {visibleColumns['Categoria'] && <td className="px-4 py-3 text-slate-500 text-xs bg-inherit"><div className="max-w-[120px] truncate">{product['Categoria'] || '-'}</div></td>}
                              {visibleColumns['Marca'] && <td className="px-4 py-3 text-slate-500 text-xs bg-inherit"><div className="max-w-[100px] truncate">{product['Marca'] || '-'}</div></td>}
                              {visibleColumns['Status'] && (
                                <td className="px-4 py-3 bg-inherit">
                                   <div className="flex flex-col gap-1.5">
                                     <div className="flex items-center gap-1">
                                       {([
                                         { on: flags.descricaoGerada, Icon: Sparkles, label: 'Descrição', onClass: 'bg-orange-50 text-orange-700 border-orange-200/60' },
                                         { on: flags.atributosGerados, Icon: Tag, label: 'Atributos', onClass: 'bg-amber-50 text-amber-700 border-amber-200/60' },
                                         // { on: flags.enriquecido, Icon: Search, label: 'Enriquecido', onClass: 'bg-purple-50 text-purple-700 border-purple-200/60' }, // desativado temporariamente
                                         { on: flags.imagensGeradas, Icon: ImageIcon, label: 'Imagens', onClass: 'bg-orange-50 text-orange-700 border-orange-200/60' },
                                       ] as const).map(({ on, Icon, label, onClass }) => (
                                         <span
                                           key={label}
                                           title={`${label}: ${on ? 'concluído' : 'pendente'}`}
                                           className={cn(
                                             "inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border text-[9px] font-bold uppercase tracking-wider transition-colors",
                                             on ? onClass : "bg-slate-50 text-slate-300 border-slate-200/60"
                                           )}
                                         >
                                           <Icon className="w-3 h-3" />
                                         </span>
                                       ))}
                                     </div>
                                     {isError && (
                                       <div className="flex items-center gap-2">
                                         <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wider text-red-600 animate-pulse" title={product._generationError || 'Erro'}>
                                           <AlertCircle className="w-3 h-3" /> Erro
                                         </span>
                                       </div>
                                     )}
                                   </div>
                                </td>
                              )}
                              <td className="px-5 py-3 text-right bg-inherit transition-colors sticky right-0 shadow-[inset_1px_0_0_0_#f1f5f9] group-hover:shadow-[inset_1px_0_0_0_#e2e8f0] z-10 w-[280px]">
                                <div className="flex items-center justify-end gap-1.5 bg-inherit h-full">
                                  <button
                                    onClick={() => openPreview(product)}
                                    className="text-[#FF5B03] hover:bg-orange-600 hover:text-white bg-orange-50 border border-orange-100 p-1.5 rounded-lg transition-all shadow-sm flex items-center justify-center w-8 h-8 group/edit"
                                    title="Visualizar Detalhes"
                                    id="product-edit-btn"
                                  >
                                    <Eye className="w-3.5 h-3.5 transition-transform group-hover/edit:scale-110" />
                                  </button>
                                  <button
                                    onClick={() => openPreview(product, 'atributos')}
                                    className={cn(
                                      "rounded-md transition-all shadow-sm flex items-center justify-center w-8 h-8",
                                      flags.atributosGerados
                                        ? "bg-amber-50 text-amber-700 border border-amber-200"
                                        : "bg-white text-slate-400 hover:text-amber-700 border border-slate-200 hover:border-amber-300 hover:bg-amber-50"
                                    )}
                                    title="Gerar Atributos"
                                  >
                                    <Tag className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={() => openPreview(product, 'imagem')}
                                    className={cn(
                                      "rounded-md transition-all shadow-sm flex items-center justify-center w-8 h-8",
                                      flags.imagensGeradas
                                        ? "bg-orange-50 text-orange-700 border border-orange-200"
                                        : "bg-white text-slate-400 hover:text-orange-700 border border-slate-200 hover:border-orange-300 hover:bg-orange-50"
                                    )}
                                    title="Gerar Imagens"
                                  >
                                    <ImageIcon className="w-3.5 h-3.5" />
                                  </button>
                                  {/* Botão Enriquecer individual — desativado temporariamente
                                  <div className="w-px h-5 bg-slate-200 mx-0.5"></div>
                                  <button
                                    onClick={() => handleEnrichSingle(product._id)}
                                    disabled={product._isEnriching}
                                    className={cn(
                                      "rounded-md transition-all shadow-sm disabled:opacity-50 flex items-center justify-center w-8 h-8",
                                      isEnriched
                                        ? "bg-purple-50 text-purple-700 border border-purple-200"
                                        : "bg-white text-slate-400 hover:text-purple-700 border border-slate-200 hover:border-purple-300 hover:bg-purple-50"
                                    )}
                                    title={isEnriched ? "Enriquecer Dados (já enriquecido)" : "Enriquecer Dados"}
                                  >
                                    <Search className={`w-3.5 h-3.5 ${product._isEnriching ? 'animate-spin' : ''}`} />
                                  </button>
                                  */}
                                  <button
                                    onClick={() => handleGenerateSingle(product._id)}
                                    disabled={product._isGenerating}
                                    className={cn(
                                      "rounded-md transition-all shadow-sm disabled:opacity-50 flex items-center justify-center w-8 h-8",
                                      isProcessed
                                        ? "bg-[#FF5B03]/10 text-[#FF5B03] border border-[#FF5B03]/20"
                                        : "bg-white text-slate-400 hover:text-[#FF5B03] border border-slate-200 hover:border-orange-300 hover:bg-orange-50"
                                    )}
                                    title={isProcessed ? "Gerar Descrição (já gerada)" : "Gerar Descrição"}
                                  >
                                    <Sparkles className={`w-3.5 h-3.5 ${product._isGenerating ? 'animate-pulse text-[#FF5B03]' : ''}`} />
                                   </button>
                                 </div>
                              </td>
                            </tr>
                            {hasChildren && isExpanded && product._children!.map(child => (
                              <tr key={child._id} className="bg-slate-50/70 border-l-2 border-orange-300">
                                <td className="pl-10 pr-3 py-2.5 border-r border-slate-100">
                                  <input
                                    type="checkbox"
                                    checked={selectedIds.has(child._id)}
                                    onChange={(e) => {
                                      const next = new Set(selectedIds);
                                      if (e.target.checked) next.add(child._id);
                                      else next.delete(child._id);
                                      setSelectedIds(next);
                                    }}
                                    className="rounded border-slate-300 text-[#FF5B03] focus:ring-[#FF5B03]"
                                  />
                                </td>
                                {visibleColumns['Img'] && (
                                  <td className="px-4 py-2.5">
                                    {(child._selectedImage || child['URL imagem 1']) ? (
                                      <img src={child._selectedImage || child['URL imagem 1']!.toString()} alt="" className="w-8 h-8 object-contain rounded border border-slate-200" />
                                    ) : (
                                      <div className="w-8 h-8 rounded border border-slate-200 bg-slate-100 flex items-center justify-center">
                                        <ImageIcon className="w-3.5 h-3.5 text-slate-400" />
                                      </div>
                                    )}
                                  </td>
                                )}
                                {visibleColumns['SKU'] && (
                                  <td className="px-4 py-2.5 font-mono text-xs text-slate-500">
                                    <div className="flex items-center gap-1.5">
                                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-orange-50 text-orange-600 border border-orange-200 uppercase tracking-wide">variante</span>
                                      {child['Código (SKU)']}
                                    </div>
                                  </td>
                                )}
                                {visibleColumns['Descrição'] && (
                                  <td className="px-4 py-2.5 text-slate-600 text-sm" colSpan={1}>
                                    <div className="flex flex-col gap-0.5">
                                      <span className="truncate max-w-[300px]" title={child['Descrição']}>{child['Descrição']}</span>
                                      {child['Variações'] && (
                                        <div className="flex flex-wrap gap-1">
                                          {child['Variações'].split('||').map((v, i) => (
                                            <span key={i} className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium bg-slate-100 text-slate-600 border border-slate-200">
                                              {v.trim()}
                                            </span>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  </td>
                                )}
                                {visibleColumns['Categoria'] && <td className="px-4 py-2.5 text-slate-400 text-xs">{child['Categoria'] || '-'}</td>}
                                {visibleColumns['Marca'] && <td className="px-4 py-2.5 text-slate-400 text-xs">{child['Marca'] || '-'}</td>}
                                {visibleColumns['Status'] && <td className="px-4 py-2.5 text-slate-400 text-xs">—</td>}
                                <td className="px-4 py-2.5"></td>
                              </tr>
                            ))}
                            </React.Fragment>
                            )
                          })
                        }
                    </tbody>
                     </table>
                  </div>

                  {/* Pagination */}
                  {filteredProducts.length > 0 && (
                    <div className="px-6 py-4 border-t border-slate-200 bg-white flex flex-wrap justify-between items-center gap-4 shrink-0 rounded-b-xl">
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2">
                          <span>Linhas por página:</span>
                          <select
                            value={itemsPerPage}
                            onChange={(e) => { setItemsPerPage(Number(e.target.value)); setCurrentPage(1); }}
                            className="text-xs border-slate-200 rounded-md font-medium focus:ring-[#FF5B03] focus:border-[#FF5B03] py-1 px-2.5 hover:bg-slate-50 transition-colors cursor-pointer outline-none shadow-sm"
                          >
                            <option value={10}>10</option>
                            <option value={20}>20</option>
                            <option value={50}>50</option>
                            <option value={100}>100</option>
                          </select>
                        </div>
                        <span className="hidden sm:inline">Mostrando <span className="font-medium text-slate-700">{Math.min(filteredProducts.length, (currentPage - 1) * itemsPerPage + 1)}</span> a <span className="font-medium text-slate-700">{Math.min(filteredProducts.length, currentPage * itemsPerPage)}</span> de <span className="font-medium text-slate-700">{filteredProducts.length}</span> resultados</span>
                      </div>
                      
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="px-3 py-1.5 bg-white border border-slate-200 rounded-md text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors shadow-sm font-medium">Anterior</button>
                        <div className="flex items-center gap-1 px-2">
                           <span className="font-medium text-slate-900">{currentPage}</span> <span className="text-slate-400">/</span> <span>{totalPages || 1}</span>
                        </div>
                        <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages || totalPages === 0} className="px-3 py-1.5 bg-white border border-slate-200 rounded-md text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors shadow-sm font-medium">Próximo</button>
                    </div>
                  </div>
                )}
                </div>
              </div>
            )}
        </main>
      </div>

      {/* Preview Modal */}
      {previewProduct && (
        <Suspense fallback={<div className="fixed inset-0 z-[100] bg-slate-50 flex items-center justify-center"><RefreshCw className="w-7 h-7 animate-spin text-[#FF5B03]" /></div>}>
          <ProductEditModal
            key={previewProduct._id}
            product={previewProduct}
            categories={existingCategories}
            templates={templates}
            selectedTemplateId={selectedTemplateId}
            initialTab={previewInitialTab}
            onClose={() => setPreviewProduct(null)}
            onOpenImageModal={() => {
              setCurrentImageSearchProduct(previewProduct);
              setIsImageSearchModalOpen(true);
              setPreviewProduct(null); // Optional: close edit modal, or leave it open
            }}
            onSave={(updated) => {
              setProducts(products.map(p => p._id === updated._id ? { ...updated, _isDirty: true } : p));
              setPreviewProduct(updated);
            }}
            onCategoryUpdate={async (categoryId, newAttr) => {
              if (!user) return;
              const updatedCategory = await addAttributeToCategory(user.uid, categoryId, existingCategories, newAttr);
              setExistingCategories(existingCategories.map(c => c.id === categoryId ? updatedCategory : c));
            }}
            uid={user?.uid ?? ''}
            hasContentAgent={hasContentAgent}
            hasVideoModule={hasVideoModule}
            activeVideoProductId={products.find(p => p._videoStatus === 'queued' || p._videoStatus === 'processing')?._id}
            getIdToken={async () => {
              const currentUser = auth.currentUser;
              if (!currentUser) throw new Error('Não autenticado');
              return currentUser.getIdToken();
            }}
            onVideoJobStarted={handleVideoJobStarted}
            onVideoGenerated={(productId, videoUrl, jobId) => {
              setProducts((prev) => {
                const updated = prev.map((p) =>
                  p._id === productId
                    ? { ...p, _videoUrl: videoUrl, _videoJobId: jobId, _videoStatus: 'done' as const }
                    : p,
                );
                const prod = prev.find(p => p._id === productId);
                const name = prod?.['Descrição'] ?? prod?.['Título SEO'] ?? 'Produto';
                setVideoReadyNotification({ productId, productName: name, videoUrl });
                setTimeout(() => setVideoReadyNotification(null), 12000);
                return updated;
              });
            }}
          />
        </Suspense>
      )}

      {/* Settings Modal */}
      {isTemplateModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto" aria-labelledby="settings-modal-title" role="dialog" aria-modal="true">
          <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 bg-gray-900/50 transition-opacity" aria-hidden="true" onClick={() => setIsTemplateModalOpen(false)}></div>
            <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
            <div className="relative z-10 inline-block align-bottom bg-white rounded-xl text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-5xl w-full">

              <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                <div className="flex justify-between items-start mb-4 pb-4 border-b border-gray-100">
                  <h3 className="text-lg leading-6 font-bold text-gray-900" id="settings-modal-title">
                    Configurações
                  </h3>
                  <button onClick={() => setIsTemplateModalOpen(false)} className="text-gray-400 hover:text-gray-500 bg-gray-50 hover:bg-gray-100 rounded-full p-1 transition-colors">
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Tabs */}
                <div className="flex gap-1 mb-6 border-b border-gray-200">
                  <button
                    onClick={() => setSettingsTab('templates')}
                    className={`px-4 py-2 text-sm font-medium rounded-t-md transition-colors ${settingsTab === 'templates' ? 'text-orange-600 border-b-2 border-orange-600' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                    Templates de Descrição
                  </button>
                  <button
                    onClick={() => setSettingsTab('images')}
                    className={`px-4 py-2 text-sm font-medium rounded-t-md transition-colors ${settingsTab === 'images' ? 'text-orange-600 border-b-2 border-orange-600' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                    Imagens Ambientadas
                  </button>
                </div>

                {settingsTab === 'templates' && (
                  <div className="flex flex-col md:flex-row gap-6">
                    {/* Template List */}
                    <div className="w-full md:w-1/3 border-r border-gray-200 pr-4">
                      <div className="flex justify-between items-center mb-4">
                        <h4 className="font-medium text-gray-900">Seus Templates</h4>
                        <button
                          onClick={() => setEditingTemplate({ id: `temp_${Date.now()}`, name: 'Novo Template', prompt: '' })}
                          className="p-1 text-orange-600 hover:bg-orange-50 rounded"
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
                              className={`flex-1 text-left px-3 py-2 rounded-md text-sm truncate ${editingTemplate?.id === t.id ? 'bg-orange-50 text-orange-700 font-medium' : 'text-gray-700 hover:bg-gray-50'}`}
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
                              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-orange-500 focus:border-orange-500 sm:text-sm disabled:bg-gray-100"
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
                              className="w-full h-96 p-3 border border-gray-300 rounded-lg focus:ring-orange-500 focus:border-orange-500 font-mono text-sm disabled:bg-gray-100"
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
                                  trackTemplateSaved({ is_new: !exists, template_name: editingTemplate.name });
                                  setEditingTemplate(null);
                                }}
                                disabled={!editingTemplate.name.trim() || !editingTemplate.prompt.trim()}
                                className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 border border-transparent rounded-md shadow-sm text-sm font-medium text-white hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-500 disabled:opacity-50 disabled:cursor-not-allowed"
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
                )}

                {settingsTab === 'images' && (
                  <div className="max-w-2xl space-y-6">
                    {/* Aspect Ratio Padrão */}
                    <div>
                      <label className="block text-sm font-bold text-gray-900 mb-1">Aspecto Ratio Padrão das Imagens</label>
                      <p className="text-xs text-gray-500 mb-3">Define o formato padrão das fotos ambientadas geradas. Pode ser alterado individualmente em cada geração.</p>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {[
                          { value: '1:1', label: '1:1 — Quadrado', desc: 'Amazon, Shopee, Mercado Livre' },
                          { value: '4:3', label: '4:3 — Paisagem', desc: 'Marketplace tradicional, banners' },
                          { value: '3:4', label: '3:4 — Retrato', desc: 'Mobile-first, Pinterest, Moda' },
                          { value: '16:9', label: '16:9 — Wide', desc: 'Banners, hero images' },
                          { value: '9:16', label: '9:16 — Vertical', desc: 'Stories, Reels, TikTok' },
                        ].map(({ value, label, desc }) => (
                          <button
                            key={value}
                            type="button"
                            onClick={() => setDefaultAspectRatio(value)}
                            className={`p-3 rounded-xl border-2 text-left transition-all ${
                              defaultAspectRatio === value
                                ? 'border-orange-500 bg-orange-50'
                                : 'border-gray-200 hover:border-gray-300 bg-white'
                            }`}
                          >
                            <p className={`text-sm font-bold ${defaultAspectRatio === value ? 'text-orange-700' : 'text-gray-900'}`}>{label}</p>
                            <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
                          </button>
                        ))}
                      </div>
                    </div>
                    <hr className="border-gray-100" />
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        id="enableCategoryImagePrompts"
                        checked={enableCategoryImagePrompts}
                        onChange={(e) => setEnableCategoryImagePrompts(e.target.checked)}
                        className="w-4 h-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
                      />
                      <label htmlFor="enableCategoryImagePrompts" className="text-sm font-medium text-gray-900">
                        Habilitar prompt por categoria
                      </label>
                    </div>

                    {!enableCategoryImagePrompts ? (
                      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-sm text-gray-600">
                        <p className="font-medium text-gray-800 mb-1">Modo automático ativo</p>
                        <p>O sistema gera cenas inteligentes para cada produto com base na categoria, descrição e imagem fornecida, usando técnica profissional de direção fotográfica. Nenhuma configuração necessária.</p>
                      </div>
                    ) : (
                      <div className="space-y-5">
                        <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 text-sm text-orange-800 space-y-2">
                          <p className="font-semibold">Como funciona</p>
                          <p>Configure cenas por categoria no menu <strong>Categorias</strong>. Cada produto usará o prompt da sua categoria (ou da categoria pai, se não tiver prompt próprio).</p>
                          <p className="font-semibold mt-3">Cenas padrão (use como referência)</p>
                          <ul className="space-y-1 list-disc list-inside text-orange-700">
                            <li><strong>Cena 1:</strong> produto em cenário realista e contextual para a categoria</li>
                            <li><strong>Cena 2:</strong> pessoa do público-alvo usando o produto em situação cotidiana</li>
                            <li><strong>Cena 3:</strong> mãos segurando o produto para referência de tamanho real</li>
                          </ul>
                        </div>
                        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
                          <p className="font-semibold mb-1">⚠️ Atenção para manter a qualidade</p>
                          <ul className="space-y-1 list-disc list-inside">
                            <li>Descreva apenas <strong>a cena desejada</strong> — o ambiente, pessoas, objetos ao redor</li>
                            <li><strong>Não</strong> descreva o produto em si (cor, material, tamanho)</li>
                            <li>O sistema aplica iluminação, câmera e técnica fotográfica profissional automaticamente</li>
                            <li>Mantenha as descrições concisas (1–2 frases por cena)</li>
                          </ul>
                        </div>
                      </div>
                    )}
                  </div>
                )}
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
                <button
                  onClick={() => {
                    setIsCreditHistoryOpen(false);
                    setIsCreditPurchaseOpen(true);
                    trackCreditPurchaseOpen();
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 text-white text-xs font-medium rounded-lg hover:bg-amber-600 transition-colors"
                >
                  <Coins className="w-3.5 h-3.5" />
                  Comprar créditos
                </button>
              </div>

              <div className="max-h-[400px] overflow-y-auto">
                {isLoadingLogs ? (
                  <div className="flex flex-col items-center justify-center py-12">
                    <RefreshCw className="w-8 h-8 text-orange-600 animate-spin mb-4" />
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
                            {log.type === 'bonus' ? (
                              <div className="text-xs text-gray-500">—</div>
                            ) : (
                              <>
                                <div className="text-xs text-gray-900 truncate max-w-[200px]" title={log.productName}>
                                  {log.productName}
                                </div>
                                <div className="text-[10px] text-gray-500 font-mono">{log.sku}</div>
                              </>
                            )}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-right text-xs font-bold">
                            {isCreditGrant(log) ? (
                              <span className="text-green-600">+{log.creditsAdded}</span>
                            ) : (
                              <span className="text-amber-600">-{log.creditsConsumed || 0}</span>
                            )}
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

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {showDeleteConfirm && showDeleteConfirm.isOpen && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-md p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden border border-gray-100"
            >
              <div className="p-6">
                <div className="flex items-center gap-4 mb-6">
                  <div className="p-3 rounded-xl bg-red-50 text-red-600">
                    <Trash2 className="w-8 h-8" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-gray-900">
                      Confirmar Exclusão
                    </h3>
                    <p className="text-sm text-gray-500">
                      Esta ação removerá produtos da aba de importar.
                    </p>
                  </div>
                </div>

                <div className="bg-gray-50 rounded-xl p-4 mb-6 space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Produtos a excluir:</span>
                    <span className="font-bold text-gray-900">
                      {showDeleteConfirm.type === 'selected' ? selectedIds.size : filteredProducts.length}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Ação:</span>
                    <span className="font-medium text-red-600 uppercase">
                      Remover da lista
                    </span>
                  </div>
                  <div className="border-t border-gray-200 pt-3 flex justify-between items-center text-sm text-gray-500">
                    *Esta ação afetará apenas a lista de importação atual.
                  </div>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => setShowDeleteConfirm(null)}
                    className="flex-1 px-4 py-3 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl font-medium transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={processDelete}
                    className="flex-1 px-4 py-3 text-white rounded-xl font-bold shadow-lg shadow-opacity-20 transition-all transform hover:scale-[1.02] active:scale-[0.98] bg-red-600 hover:bg-red-700 shadow-red-500"
                  >
                    Confirmar Exclusão
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

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
                  <div className={`p-3 rounded-xl ${showMassActionConfirm.type === 'generate' ? 'bg-orange-50 text-orange-600' : 'bg-purple-50 text-purple-600'}`}>
                    {showMassActionConfirm.type === 'generate' ? <Sparkles className="w-8 h-8" /> : <Search className="w-8 h-8" />}
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-gray-900">
                      {showMassActionConfirm.count === 1 ? 'Confirmar Ação' : 'Confirmar Ação em Massa'}
                    </h3>
                    <p className="text-sm text-gray-500">
                      {showMassActionConfirm.count === 1 ? 'Esta ação processará um produto.' : 'Esta ação processará múltiplos produtos.'}
                    </p>
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

                {showMassActionConfirm.type === 'generate' && templates.length > 1 && (
                  <div className="mb-6">
                    <label className="block text-sm font-medium text-gray-700 mb-2">Selecione o Template de SEO</label>
                    <select
                      value={selectedTemplateId}
                      onChange={(e) => setSelectedTemplateId(e.target.value)}
                      className="w-full bg-white border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-orange-500 focus:border-orange-500 block p-2.5"
                    >
                      {templates.map(t => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  </div>
                )}

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
                        if (showMassActionConfirm.targetId) {
                          startGenerateSingle(showMassActionConfirm.targetId);
                        } else {
                          startGenerateMass();
                        }
                      } else {
                        startEnrichMass();
                      }
                    }}
                    className={`flex-1 px-4 py-3 text-white rounded-xl font-bold shadow-lg shadow-opacity-20 transition-all transform hover:scale-[1.02] active:scale-[0.98]
                      ${showMassActionConfirm.type === 'generate' ? 'bg-orange-600 hover:bg-orange-700 shadow-orange-500' : 'bg-purple-600 hover:bg-purple-700 shadow-purple-500'}
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
      {isImageSearchModalOpen && (
        <Suspense fallback={null}>
          <ImageSearchModal
            isOpen={isImageSearchModalOpen}
            onClose={() => {
              setIsImageSearchModalOpen(false);
              if (productUrlImportResumeStep) {
                setIsProductUrlImportOpen(true);
              }
            }}
            product={currentImageSearchProduct}
            uid={user?.uid || ''}
            onSave={handleSaveImages}
            credits={credits}
            getCreditCost={getCreditCost}
            consumeCredit={consumeCredit}
            existingCategories={existingCategories}
            defaultAspectRatio={defaultAspectRatio}
          />
        </Suspense>
      )}

      {/* Category Import Review Modal */}
      {showCategoryImport && (
        <Suspense fallback={null}>
          <CategoryImportModal
            isOpen={showCategoryImport}
            onClose={() => setShowCategoryImport(false)}
            foundCategories={foundCategoriesFile}
            existingCategories={existingCategories}
            onConfirm={processCategoryImport}
            isProcessing={isProcessingCategories}
          />
        </Suspense>
      )}

      {isProductUrlImportOpen && (
        <Suspense fallback={null}>
          <ProductUrlImportModal
            isOpen={isProductUrlImportOpen}
            onClose={() => setIsProductUrlImportOpen(false)}
            categories={existingCategories}
            initialStep={productUrlImportResumeStep ?? undefined}
            initialProduct={products.find((p) => p._id === productUrlImportProductId) ?? null}
            onProductCreated={handleProductCreatedFromOnboarding}
            onGenerateDescription={handleGenerateDescriptionForOnboarding}
            onSuggestAttributes={handleSuggestAttributesForOnboarding}
            onOpenImageSearch={handleOpenImageSearchFromOnboarding}
            onCreateCategory={handleCreateCategoryForOnboarding}
            onFinish={() => { setIsProductUrlImportOpen(false); setProductUrlImportResumeStep(null); }}
            descriptionCreditCost={getCreditCost(CREDIT_ACTIONS.generateSeoSingle.key)}
            currentCredits={credits}
          />
        </Suspense>
      )}

      {isCreditPurchaseOpen && (
        <CreditPurchaseModal onClose={() => setIsCreditPurchaseOpen(false)} />
      )}

      {isOnboardingWizardOpen && user && (
        <Suspense fallback={null}>
          <OnboardingWizard
            user={user}
            onClose={() => setIsOnboardingWizardOpen(false)}
            onCompleted={() => setIsOnboardingWizardOpen(false)}
          />
        </Suspense>
      )}

      {/* Build version footer */}
      <div className="fixed bottom-1 right-2 z-40 text-[10px] text-slate-400 pointer-events-none select-none">
        build {BUILD_VERSION}
      </div>

      {/* Toast: Vídeo pronto */}
      {videoReadyNotification && (
        <div className="fixed bottom-6 right-6 z-[200] max-w-sm w-full animate-in slide-in-from-bottom-4 duration-300">
          <div className="bg-white border border-green-200 rounded-2xl shadow-xl p-4 flex items-start gap-3">
            <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.069A1 1 0 0121 8.883v6.234a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-gray-900">Vídeo pronto!</p>
              <p className="text-xs text-gray-500 mt-0.5 truncate">{videoReadyNotification.productName}</p>
              <button
                onClick={() => {
                  const prod = products.find(p => p._id === videoReadyNotification.productId);
                  if (prod) {
                    setPreviewProduct(prod);
                    setPreviewInitialTab('video');
                  }
                  setVideoReadyNotification(null);
                }}
                className="mt-2 text-xs font-bold text-violet-600 hover:text-violet-800 transition-colors"
              >
                Ver vídeo →
              </button>
            </div>
            <button
              onClick={() => setVideoReadyNotification(null)}
              className="text-gray-400 hover:text-gray-600 transition-colors shrink-0"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

    </div>
  );

  return (
    <Routes>
      <Route element={<MarketingLayout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/agente-de-produto" element={<ProductAgentPage />} />
        <Route path="/agente-de-conteudo" element={<ContentAgentPage />} />
        <Route path="/precos" element={<PricingPage />} />
        <Route path="/casos" element={<CasesPage />} />
        <Route path="/contato" element={<ContactPage />} />
        <Route path="/termos-de-servico" element={<TermsPage />} />
        <Route path="/politica-de-privacidade" element={<PrivacyPage />} />
      </Route>
      <Route
        path="/entrar"
        element={user ? <Navigate to="/app" replace /> : (
          <AuthPage
            onGoogleLogin={handleLogin}
            onEmailLogin={handleEmailLogin}
            onEmailRegister={handleEmailRegister}
            onPasswordReset={handlePasswordReset}
          />
        )}
      />
      <Route path="/app/*" element={user ? renderApp() : <Navigate to="/entrar" replace />} />
      {/* CRM interno. O acesso real é gravado no custom claim e verificado no
          servidor em todo /api/admin/*; aqui só exigimos estar logado. */}
      <Route
        path="/admin/*"
        element={
          user ? (
            <Suspense fallback={<div className="min-h-screen bg-slate-50" />}>
              <AdminApp />
            </Suspense>
          ) : (
            <Navigate to="/entrar" replace />
          )
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
