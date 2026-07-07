import React, { useState } from 'react';
import { GraduationCap, ArrowRight, ArrowLeft, X, CheckCircle2 } from 'lucide-react';

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

const TutorialView: React.FC<TutorialViewProps> = ({ onFinish }) => {
  const [stepIndex, setStepIndex] = useState(0);
  const step = STEPS[stepIndex].id;

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
