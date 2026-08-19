import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Link as LinkIcon, PenLine, Camera, Tag, FolderTree, FileText, Tags, Image as ImageIcon, PartyPopper } from 'lucide-react';
import type { Category, Product } from '../../types/models';
import { scrapeProductUrl, type ScrapeProductUrlResult } from '../../services/productImportService';
import { uploadProductImage } from '../../services/uploadService';
import { trackProductUrlImportStarted, trackProductUrlImportResult, trackOnboardingStepCompleted } from '../../analytics';
import ProductFormFields, { isProductFormValid, type ProductFormValue } from './ProductFormFields';
import EnrichmentStepCard from './EnrichmentStepCard';

export type WizardStep =
  | 'intro' | 'loading' | 'review' | 'manual'
  | 'enrich-description' | 'enrich-attributes' | 'enrich-image' | 'done';

export interface ProductUrlImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  categories: Category[];
  initialStep?: WizardStep;
  initialProduct?: Product | null;
  onProductCreated: (product: Product) => void;
  onGenerateDescription: (id: string) => Promise<void>;
  onSuggestAttributes: (id: string) => Promise<boolean>;
  onOpenImageSearch: (id: string) => void;
  onCreateCategory: (name: string) => Promise<string | null>;
  onFinish: () => void;
  descriptionCreditCost: number;
  currentCredits: number;
  isFirstProduct?: boolean;
}

const emptyForm: ProductFormValue = { title: '', categoryId: '', imageUrl: '', price: '', description: '' };

function buildProduct(form: ProductFormValue, categories: Category[]): Product {
  const category = categories.find((c) => c.id === form.categoryId);
  return {
    _id: `prod_url_${Date.now()}`,
    _statusDescricao: 'Sem descrição',
    _statusSEO: 'Sem SEO',
    _isDirty: true,
    _selectedImage: form.imageUrl,
    'Descrição': form.title,
    'Descrição complementar': form.description || undefined,
    'Categoria': category?.path.join(' > '),
    categoryId: form.categoryId || undefined,
    categoryPath: category?.path,
    'Preço': form.price || undefined,
    'URL imagem externa 1': form.imageUrl,
  };
}

const ProductUrlImportModal: React.FC<ProductUrlImportModalProps> = ({
  isOpen, onClose, categories, initialStep, initialProduct,
  onProductCreated, onGenerateDescription, onSuggestAttributes, onOpenImageSearch, onCreateCategory, onFinish,
  descriptionCreditCost, currentCredits, isFirstProduct = true,
}) => {
  const [step, setStep] = useState<WizardStep>(initialStep ?? 'intro');
  const [product, setProduct] = useState<Product | null>(initialProduct ?? null);
  const [url, setUrl] = useState('');
  const [form, setForm] = useState<ProductFormValue>(emptyForm);
  const [manualReason, setManualReason] = useState<'chosen' | 'fallback' | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRunningStep, setIsRunningStep] = useState(false);
  const [stepError, setStepError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleAnalyzeUrl = async () => {
    if (!url.trim()) return;
    setStep('loading');
    setError(null);
    trackProductUrlImportStarted();
    let result: ScrapeProductUrlResult;
    try {
      result = await scrapeProductUrl(url.trim());
    } catch (e) {
      trackProductUrlImportResult({ source: 'failed' });
      setManualReason('fallback');
      setForm(emptyForm);
      setStep('manual');
      return;
    }
    trackProductUrlImportResult({ source: result.source });
    if (result.source === 'failed' || !result.product.title) {
      setManualReason('fallback');
      setForm({ ...emptyForm, imageUrl: result.product.imageUrl ?? '' });
      setStep('manual');
      return;
    }
    setForm({
      title: result.product.title ?? '',
      categoryId: '',
      imageUrl: result.product.imageUrl ?? '',
      price: result.product.price != null ? String(result.product.price) : '',
      description: result.product.description ?? '',
    });
    setStep('review');
  };

  const handleUploadImage = async (file: File) => {
    setIsUploadingImage(true);
    try {
      const uploadedUrl = await uploadProductImage(file);
      setForm((prev) => ({ ...prev, imageUrl: uploadedUrl }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao enviar imagem.');
    } finally {
      setIsUploadingImage(false);
    }
  };

  const handleCreateProduct = () => {
    const created = buildProduct(form, categories);
    setProduct(created);
    onProductCreated(created);
    setStep('enrich-description');
  };

  const handleGenerateDescription = async () => {
    if (!product) return;
    setIsRunningStep(true);
    setStepError(null);
    try {
      await onGenerateDescription(product._id);
      trackOnboardingStepCompleted({ step: 'description', skipped: false });
      setStep('enrich-attributes');
    } catch (e) {
      setStepError(e instanceof Error ? e.message : 'Erro ao gerar descrição.');
    } finally {
      setIsRunningStep(false);
    }
  };

  const handleSuggestAttributes = async () => {
    if (!product) return;
    setIsRunningStep(true);
    setStepError(null);
    try {
      await onSuggestAttributes(product._id);
      trackOnboardingStepCompleted({ step: 'attributes', skipped: false });
      setStep('enrich-image');
    } catch (e) {
      setStepError(e instanceof Error ? e.message : 'Erro ao sugerir atributos.');
    } finally {
      setIsRunningStep(false);
    }
  };

  const skipStep = (step: 'description' | 'attributes' | 'image', next: WizardStep) => {
    trackOnboardingStepCompleted({ step, skipped: true });
    setStep(next);
  };

  const renderIntro = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-3 text-center">
        {[
          { icon: Camera, label: 'Imagem', hint: 'obrigatória' },
          { icon: Tag, label: 'Título', hint: '' },
          { icon: FolderTree, label: 'Categoria', hint: '' },
        ].map(({ icon: Icon, label, hint }) => (
          <div key={label} className="bg-slate-50 rounded-xl p-3">
            <Icon className="w-5 h-5 mx-auto text-orange-500 mb-1.5" />
            <p className="text-xs font-bold text-slate-700">{label}</p>
            {hint && <p className="text-[10px] text-slate-400">{hint}</p>}
          </div>
        ))}
      </div>
      <p className="text-sm text-slate-500 text-center">O resto — descrição, atributos e imagens ambientadas — a IA faz por você.</p>

      <div className="space-y-2">
        <div className="relative">
          <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Cole o link do produto"
            className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
          />
        </div>
        <button
          type="button"
          onClick={handleAnalyzeUrl}
          disabled={!url.trim()}
          className="w-full py-3 px-4 bg-[#FF5B03] text-white rounded-xl font-bold hover:bg-[#E14E00] transition-all disabled:opacity-50"
        >
          Analisar produto
        </button>
      </div>

      <button
        type="button"
        onClick={() => { setManualReason('chosen'); setForm(emptyForm); setStep('manual'); }}
        className="w-full flex items-center justify-center gap-2 py-3 text-sm font-semibold text-slate-500 hover:text-slate-700 transition-colors"
      >
        <PenLine className="w-4 h-4" /> Quero inserir manualmente meu produto
      </button>
    </div>
  );

  const renderLoading = () => (
    <div className="text-center py-10">
      <div className="w-10 h-10 border-4 border-orange-200 border-t-orange-500 rounded-full animate-spin mx-auto mb-4" />
      <p className="text-sm text-slate-500">Lendo a página do seu produto...</p>
    </div>
  );

  const renderForm = (isManual: boolean) => (
    <div className="space-y-4 pb-4 sm:pb-0">
      {isManual && manualReason === 'fallback' && (
        <p className="text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
          Não conseguimos ler essa página automaticamente — sem problema, preencha à mão.
        </p>
      )}
      <ProductFormFields
        value={form}
        onChange={setForm}
        categories={categories}
        onUploadImage={handleUploadImage}
        isUploadingImage={isUploadingImage}
        onCreateCategory={onCreateCategory}
      />
      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
      {/* No mobile a CTA vira uma barra fixa fora deste fluxo (ver abaixo) — o
          botão inline só aparece a partir do sm: para não duplicar a ação. */}
      <button
        type="button"
        onClick={handleCreateProduct}
        disabled={!isProductFormValid(form)}
        className="hidden sm:block w-full py-3.5 px-4 bg-[#FF5B03] text-white rounded-xl font-bold hover:bg-[#E14E00] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Criar produto
      </button>
      {/* Reserva espaço para a barra fixa mobile não cobrir o último campo ao rolar até o fim. */}
      <div className="h-16 sm:hidden" />
    </div>
  );

  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="max-w-lg w-full my-8">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#141311] to-[#1e3a8a] p-6 mb-6 text-white shadow-lg">
          <button onClick={onClose} className="absolute right-4 top-4 p-1.5 rounded-full bg-white/10 hover:bg-white/20 transition-colors">
            <X className="w-4 h-4" />
          </button>
          <h2 className="font-display text-xl font-bold tracking-tight">{isFirstProduct ? 'Cadastre seu primeiro produto' : 'Novo Produto'}</h2>
          <p className="text-sm text-white/70">Cole o link ou preencha na mão — a IA cuida do resto.</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 md:p-8 overflow-hidden">
          <AnimatePresence mode="wait">
            <motion.div key={step} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.22, ease: 'easeOut' }}>
              {step === 'intro' && renderIntro()}
              {step === 'loading' && renderLoading()}
              {step === 'review' && renderForm(false)}
              {step === 'manual' && renderForm(true)}
              {step === 'enrich-description' && (
                <EnrichmentStepCard
                  icon={FileText}
                  title="Gerar descrição com IA"
                  description="Criamos uma descrição de venda a partir do título, categoria e imagem do produto."
                  costLabel={`${descriptionCreditCost} crédito${descriptionCreditCost === 1 ? '' : 's'} · você tem ${currentCredits}`}
                  isRunning={isRunningStep}
                  isDone={false}
                  error={stepError}
                  onRun={handleGenerateDescription}
                  onSkip={() => skipStep('description', 'enrich-attributes')}
                />
              )}
              {step === 'enrich-attributes' && (
                <EnrichmentStepCard
                  icon={Tags}
                  title="Sugerir atributos"
                  description="A IA analisa o texto e a imagem do produto e sugere atributos da categoria."
                  costLabel="Grátis"
                  isRunning={isRunningStep}
                  isDone={false}
                  error={stepError}
                  onRun={handleSuggestAttributes}
                  onSkip={() => skipStep('attributes', 'enrich-image')}
                />
              )}
              {step === 'enrich-image' && (
                <EnrichmentStepCard
                  icon={ImageIcon}
                  title="Gerar imagens ambientadas"
                  description="Coloque seu produto em cenários realistas gerados por IA."
                  costLabel="1 crédito por imagem"
                  isRunning={false}
                  isDone={false}
                  error={null}
                  onRun={() => product && onOpenImageSearch(product._id)}
                  onSkip={() => skipStep('image', 'done')}
                />
              )}
              {step === 'done' && (
                <div className="text-center py-6">
                  <div className="w-14 h-14 mx-auto rounded-full bg-emerald-50 flex items-center justify-center mb-4">
                    <PartyPopper className="w-7 h-7 text-emerald-500" />
                  </div>
                  <h3 className="font-display text-lg font-bold text-slate-900">Seu primeiro produto está pronto!</h3>
                  <p className="text-sm text-slate-500 mt-1">Você já pode continuar editando ou importar mais produtos.</p>
                  <div className="flex items-center justify-center gap-3 mt-6">
                    <button
                      type="button"
                      onClick={onFinish}
                      className="px-5 py-2.5 text-sm font-semibold text-white bg-[#FF5B03] hover:bg-[#E14E00] rounded-xl shadow-sm transition-colors"
                    >
                      Ver produto
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {/* CTA fixa no rodapé — mobile only. Vive fora do card animado para não
          herdar o transform do motion.div nem o overflow-hidden do card
          (ambos quebrariam position:fixed/sticky se ela estivesse lá dentro). */}
      {(step === 'review' || step === 'manual') && (
        <div
          className="sm:hidden fixed inset-x-0 bottom-0 z-10 bg-white border-t border-slate-200 px-4 py-3"
          style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}
        >
          <button
            type="button"
            onClick={handleCreateProduct}
            disabled={!isProductFormValid(form)}
            className="w-full py-3.5 px-4 bg-[#FF5B03] text-white rounded-xl font-bold hover:bg-[#E14E00] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Criar produto
          </button>
        </div>
      )}
    </div>
  );
};

export default ProductUrlImportModal;
