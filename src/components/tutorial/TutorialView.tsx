import React, { useState } from 'react';
import { GraduationCap, ArrowRight, ArrowLeft, X, CheckCircle2, Image as ImageIcon, Sparkles, Loader2 } from 'lucide-react';

interface TutorialViewProps {
  onFinish: () => void;
}

type StepId = 'welcome' | 'product' | 'description' | 'attributes' | 'category' | 'images' | 'video' | 'done';

const STEPS: { id: StepId; label: string }[] = [
  { id: 'welcome', label: 'Início' },
  { id: 'product', label: 'Produto' },
  { id: 'description', label: 'Descrição' },
  { id: 'attributes', label: 'Atributos' },
  { id: 'category', label: 'Categoria' },
  { id: 'images', label: 'Imagens' },
  { id: 'video', label: 'Vídeo' },
  { id: 'done', label: 'Concluído' },
];

const MOCK_PRODUCT = {
  sku: 'TENIS-AZUL-42',
  rawName: 'TENIS ESPORTIVO MASC AZUL 42',
};

const MOCK_DESCRIPTION_HTML = `<p><strong>Tênis Esportivo Masculino Azul</strong> desenvolvido para quem busca conforto e desempenho no dia a dia. Cabedal em mesh respirável, entressola com amortecimento em EVA e solado antiderrapante.</p><ul><li>Material: mesh + sintético</li><li>Solado: borracha antiderrapante</li><li>Indicado para caminhada e uso casual</li></ul>`;

const MOCK_SEO = {
  title: 'Tênis Esportivo Masculino Azul 42 | Conforto no Dia a Dia',
  metaDescription: 'Tênis esportivo masculino azul, tam. 42, com cabedal em mesh respirável e solado antiderrapante. Confira agora.',
};

const MOCK_ATTRIBUTES: { label: string; value: string }[] = [
  { label: 'Cor', value: 'Azul' },
  { label: 'Material', value: 'Mesh' },
  { label: 'Tamanho', value: '42' },
  { label: 'Gênero', value: 'Masculino' },
];

const MOCK_CATEGORY_PATH = ['Calçados', 'Esportivo', 'Tênis'];

const TutorialView: React.FC<TutorialViewProps> = ({ onFinish }) => {
  const [stepIndex, setStepIndex] = useState(0);
  const step = STEPS[stepIndex].id;

  const [descriptionLoading, setDescriptionLoading] = useState(false);
  const [descriptionGenerated, setDescriptionGenerated] = useState(false);

  const simulateDescription = () => {
    setDescriptionLoading(true);
    setTimeout(() => {
      setDescriptionLoading(false);
      setDescriptionGenerated(true);
    }, 1200);
  };

  const [attributesLoading, setAttributesLoading] = useState(false);
  const [attributesGenerated, setAttributesGenerated] = useState(false);

  const simulateAttributes = () => {
    setAttributesLoading(true);
    setTimeout(() => {
      setAttributesLoading(false);
      setAttributesGenerated(true);
    }, 1200);
  };

  const [imagesLoading, setImagesLoading] = useState(false);
  const [imagesGenerated, setImagesGenerated] = useState(false);

  const simulateImages = () => {
    setImagesLoading(true);
    setTimeout(() => {
      setImagesLoading(false);
      setImagesGenerated(true);
    }, 1500);
  };

  const goNext = () => setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
  const goBack = () => setStepIndex((i) => Math.max(i - 1, 0));
  const restart = () => setStepIndex(0);

  const renderStepContent = (currentStep: StepId): React.ReactNode => {
    switch (currentStep) {
      case 'welcome':
        return (
          <div className="text-center py-6">
            <div className="mx-auto w-14 h-14 rounded-2xl bg-[#FF5B03]/10 flex items-center justify-center mb-4">
              <GraduationCap className="w-7 h-7 text-[#FF5B03]" />
            </div>
            <h2 className="text-xl font-bold text-slate-900">Bem-vindo ao tutorial</h2>
            <p className="text-sm text-slate-500 mt-2 max-w-md mx-auto">
              Vamos simular, com um produto fictício, todo o fluxo de geração
              de descrição, atributos, categoria, imagens ambientadas e vídeo.
              Nenhum crédito é gasto e nenhum dado real é alterado.
            </p>
          </div>
        );
      case 'product':
        return (
          <div>
            <h3 className="text-base font-bold text-slate-800 mb-1">Produto de exemplo</h3>
            <p className="text-sm text-slate-500 mb-4">
              Este é o produto fictício que vamos usar durante o tutorial.
            </p>
            <div className="flex items-center gap-4 p-4 border border-slate-200 rounded-xl bg-slate-50">
              <div className="w-20 h-20 rounded-lg bg-slate-200 flex items-center justify-center shrink-0">
                <ImageIcon className="w-8 h-8 text-slate-400" />
              </div>
              <div>
                <p className="text-xs text-slate-400 font-medium">{MOCK_PRODUCT.sku}</p>
                <p className="text-sm font-semibold text-slate-800">{MOCK_PRODUCT.rawName}</p>
                <p className="text-xs text-slate-400 mt-1">Sem descrição, atributos ou categoria ainda.</p>
              </div>
            </div>
          </div>
        );
      case 'description':
        return (
          <div>
            <h3 className="text-base font-bold text-slate-800 mb-1">Gerar Descrição</h3>
            <p className="text-sm text-slate-500 mb-4">
              A IA transforma o nome cru do produto em uma descrição rica e
              campos de SEO, a partir do template configurado.
            </p>
            {!descriptionGenerated ? (
              <button
                onClick={simulateDescription}
                disabled={descriptionLoading}
                className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-[#FF5B03] rounded-lg hover:bg-[#e65200] transition-colors disabled:opacity-60"
              >
                {descriptionLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4" />
                )}
                {descriptionLoading ? 'Gerando...' : 'Simular geração'}
              </button>
            ) : (
              <div className="space-y-3">
                <div className="p-4 border border-slate-200 rounded-xl bg-white">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-2">Descrição gerada</p>
                  <div
                    className="prose prose-sm max-w-none text-slate-700"
                    dangerouslySetInnerHTML={{ __html: MOCK_DESCRIPTION_HTML }}
                  />
                </div>
                <div className="p-4 border border-slate-200 rounded-xl bg-white">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-2">SEO</p>
                  <p className="text-sm font-semibold text-slate-800">{MOCK_SEO.title}</p>
                  <p className="text-xs text-slate-500 mt-1">{MOCK_SEO.metaDescription}</p>
                </div>
              </div>
            )}
          </div>
        );
      case 'attributes':
        return (
          <div>
            <h3 className="text-base font-bold text-slate-800 mb-1">Gerar Atributos</h3>
            <p className="text-sm text-slate-500 mb-4">
              A IA extrai atributos estruturados (cor, material, tamanho...)
              a partir da descrição e da categoria do produto.
            </p>
            {!attributesGenerated ? (
              <button
                onClick={simulateAttributes}
                disabled={attributesLoading}
                className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-[#FF5B03] rounded-lg hover:bg-[#e65200] transition-colors disabled:opacity-60"
              >
                {attributesLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4" />
                )}
                {attributesLoading ? 'Gerando...' : 'Simular geração'}
              </button>
            ) : (
              <div className="flex flex-wrap gap-2">
                {MOCK_ATTRIBUTES.map((attr) => (
                  <span
                    key={attr.label}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-amber-50 text-amber-700 text-xs font-medium border border-amber-100"
                  >
                    {attr.label}: {attr.value}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      case 'category':
        return (
          <div>
            <h3 className="text-base font-bold text-slate-800 mb-1">Categorizar</h3>
            <p className="text-sm text-slate-500 mb-4">
              Com base na descrição, o produto é encaixado na árvore de
              categorias já cadastrada.
            </p>
            <div className="flex items-center gap-2 flex-wrap p-4 border border-slate-200 rounded-xl bg-slate-50">
              {MOCK_CATEGORY_PATH.map((part, i) => (
                <React.Fragment key={part}>
                  <span className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-sm font-medium text-slate-700 shadow-sm">
                    {part}
                  </span>
                  {i < MOCK_CATEGORY_PATH.length - 1 && (
                    <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                  )}
                </React.Fragment>
              ))}
            </div>
          </div>
        );
      case 'images':
        return (
          <div>
            <h3 className="text-base font-bold text-slate-800 mb-1">Gerar Imagens Ambientadas</h3>
            <p className="text-sm text-slate-500 mb-4">
              A IA gera fotos de estilo de vida mostrando o produto em uso,
              a partir da foto original.
            </p>
            {!imagesGenerated ? (
              <button
                onClick={simulateImages}
                disabled={imagesLoading}
                className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-[#FF5B03] rounded-lg hover:bg-[#e65200] transition-colors disabled:opacity-60"
              >
                {imagesLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4" />
                )}
                {imagesLoading ? 'Gerando...' : 'Simular geração'}
              </button>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                {[1, 2, 3].map((n) => (
                  <div
                    key={n}
                    className="aspect-square rounded-xl bg-slate-100 border border-slate-200 flex flex-col items-center justify-center gap-2"
                  >
                    <ImageIcon className="w-6 h-6 text-slate-400" />
                    <span className="text-[11px] font-medium text-slate-400">Ambientação {n}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      case 'done':
        return (
          <div className="text-center py-6">
            <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-slate-900">Tutorial concluído!</h2>
            <p className="text-sm text-slate-500 mt-2 max-w-md mx-auto">
              Você viu o fluxo completo: descrição, atributos, categoria,
              imagens ambientadas e vídeo. Agora é só aplicar isso nos seus
              produtos reais.
            </p>
            <div className="flex items-center justify-center gap-3 mt-6">
              <button
                onClick={restart}
                className="px-4 py-2 text-sm font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
              >
                Reiniciar tutorial
              </button>
              <button
                onClick={onFinish}
                className="px-4 py-2 text-sm font-medium text-white bg-[#FF5B03] rounded-lg hover:bg-[#e65200] transition-colors"
              >
                Ir para meus produtos
              </button>
            </div>
          </div>
        );
      default:
        return (
          <div className="text-center py-12 text-slate-400 text-sm">
            Etapa "{currentStep}" ainda não implementada.
          </div>
        );
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 md:px-6 py-6">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          {STEPS.map((s, i) => (
            <div key={s.id} className="flex items-center gap-2">
              <div
                className={`w-2.5 h-2.5 rounded-full transition-colors ${
                  i === stepIndex ? 'bg-[#FF5B03]' : i < stepIndex ? 'bg-[#FF5B03]/40' : 'bg-slate-200'
                }`}
                title={s.label}
              />
              {i < STEPS.length - 1 && <div className="w-4 h-px bg-slate-200" />}
            </div>
          ))}
        </div>
        {step !== 'done' && (
          <button
            onClick={() => setStepIndex(STEPS.length - 1)}
            className="flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X className="w-3.5 h-3.5" /> Pular tutorial
          </button>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm px-6 py-6 min-h-[320px] flex flex-col justify-center">
        {renderStepContent(step)}
      </div>

      {step !== 'welcome' && step !== 'done' && (
        <div className="flex items-center justify-between mt-4">
          <button
            onClick={goBack}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> Voltar
          </button>
          <button
            onClick={goNext}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-[#FF5B03] rounded-lg hover:bg-[#e65200] transition-colors"
          >
            Avançar <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {step === 'welcome' && (
        <div className="flex justify-end mt-4">
          <button
            onClick={goNext}
            className="flex items-center gap-1.5 px-5 py-2.5 text-sm font-medium text-white bg-[#FF5B03] rounded-lg hover:bg-[#e65200] transition-colors"
          >
            Começar <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
};

export default TutorialView;
