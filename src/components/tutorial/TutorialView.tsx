import React, { useState } from 'react';
import {
  GraduationCap, ArrowRight, ArrowLeft, CheckCircle2, Image as ImageIcon,
  Sparkles, Loader2, Play, Eye, Tag, Layout, Video, Wand2, Save,
} from 'lucide-react';

interface TutorialViewProps {
  onFinish: () => void;
}

type Screen = 'welcome' | 'catalog' | 'modal' | 'done';
type ModalTab = 'geral' | 'atributos' | 'conteudo' | 'imagens' | 'video';

const MOCK_PRODUCT = {
  sku: 'TENIS-AZUL-42',
  rawName: 'TENIS ESPORTIVO MASC AZUL 42',
};

const MOCK_DESCRIPTION_HTML = `<p><strong>Tênis Esportivo Masculino Azul</strong> desenvolvido para quem busca conforto e desempenho no dia a dia. Cabedal em mesh respirável, entressola com amortecimento em EVA e solado antiderrapante.</p><ul><li>Material: mesh + sintético</li><li>Solado: borracha antiderrapante</li><li>Indicado para caminhada e uso casual</li></ul>`;

const MOCK_SEO = {
  title: 'Tênis Esportivo Masculino Azul 42 | Conforto no Dia a Dia',
  metaDescription: 'Tênis esportivo masculino azul, tam. 42, com cabedal em mesh respirável e solado antiderrapante. Confira agora.',
};

const MOCK_ATTRIBUTES: { key: string; label: string; value: string }[] = [
  { key: 'cor', label: 'Cor', value: 'Azul' },
  { key: 'material', label: 'Material', value: 'Mesh' },
  { key: 'tamanho', label: 'Tamanho', value: '42' },
  { key: 'genero', label: 'Gênero', value: 'Masculino' },
];

const MOCK_CATEGORY_PATH = ['Calçados', 'Esportivo', 'Tênis'];

const MODAL_TABS: { id: ModalTab; label: string; icon: React.ElementType }[] = [
  { id: 'geral', label: 'Geral', icon: Layout },
  { id: 'atributos', label: 'Atributos', icon: Tag },
  { id: 'conteudo', label: 'Conteúdo', icon: Sparkles },
  { id: 'imagens', label: 'Imagens', icon: ImageIcon },
  { id: 'video', label: 'Vídeo', icon: Video },
];

const TutorialView: React.FC<TutorialViewProps> = ({ onFinish }) => {
  const [screen, setScreen] = useState<Screen>('welcome');
  const [activeTab, setActiveTab] = useState<ModalTab>('geral');

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
  const [confirmedAttrs, setConfirmedAttrs] = useState<Set<string>>(new Set());
  const simulateAttributes = () => {
    setAttributesLoading(true);
    setTimeout(() => {
      setAttributesLoading(false);
      setAttributesGenerated(true);
    }, 1200);
  };
  const confirmAttribute = (key: string) => {
    setConfirmedAttrs((prev) => new Set(prev).add(key));
  };
  const attributesDone = confirmedAttrs.size === MOCK_ATTRIBUTES.length && MOCK_ATTRIBUTES.length > 0;

  const [imagesLoading, setImagesLoading] = useState(false);
  const [imagesGenerated, setImagesGenerated] = useState(false);
  const simulateImages = () => {
    setImagesLoading(true);
    setTimeout(() => {
      setImagesLoading(false);
      setImagesGenerated(true);
    }, 1500);
  };

  const [videoStatus, setVideoStatus] = useState<'idle' | 'processing' | 'done'>('idle');
  const [videoStepLabel, setVideoStepLabel] = useState('');
  const [videoError, setVideoError] = useState(false);
  const simulateVideo = () => {
    setVideoStatus('processing');
    const stages: [string, number][] = [
      ['Gerando roteiro...', 800],
      ['Renderizando cenas...', 1200],
      ['Gerando narração...', 800],
      ['Mixando áudio...', 600],
      ['Finalizando vídeo...', 600],
    ];
    let elapsed = 0;
    stages.forEach(([label, duration]) => {
      elapsed += duration;
      setTimeout(() => setVideoStepLabel(label), elapsed - duration);
    });
    setTimeout(() => setVideoStatus('done'), elapsed);
  };

  const openModal = (tab: ModalTab) => {
    setActiveTab(tab);
    setScreen('modal');
  };

  const restart = () => {
    setScreen('welcome');
    setActiveTab('geral');
    setDescriptionLoading(false);
    setDescriptionGenerated(false);
    setAttributesLoading(false);
    setAttributesGenerated(false);
    setConfirmedAttrs(new Set());
    setImagesLoading(false);
    setImagesGenerated(false);
    setVideoStatus('idle');
    setVideoStepLabel('');
    setVideoError(false);
  };

  if (screen === 'welcome') {
    return (
      <div className="max-w-3xl mx-auto px-4 md:px-6 py-6">
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm px-6 py-10 text-center">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-[#FF5B03]/10 flex items-center justify-center mb-4">
            <GraduationCap className="w-7 h-7 text-[#FF5B03]" />
          </div>
          <h2 className="text-xl font-bold text-slate-900">Bem-vindo ao tutorial</h2>
          <p className="text-sm text-slate-500 mt-2 max-w-md mx-auto">
            Vamos simular, com um produto fictício, a tela de catálogo e o
            editor de produto reais — gerando descrição, atributos, imagens
            ambientadas e vídeo. Nenhum crédito é gasto e nenhum dado real é
            alterado.
          </p>
          <button
            onClick={() => setScreen('catalog')}
            className="mt-6 flex items-center gap-1.5 mx-auto px-5 py-2.5 text-sm font-medium text-white bg-[#FF5B03] rounded-lg hover:bg-[#e65200] transition-colors"
          >
            Começar <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  if (screen === 'done') {
    return (
      <div className="max-w-3xl mx-auto px-4 md:px-6 py-6">
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm px-6 py-10 text-center">
          <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-slate-900">Tutorial concluído!</h2>
          <p className="text-sm text-slate-500 mt-2 max-w-md mx-auto">
            Você viu as telas reais de catálogo e edição de produto: descrição,
            atributos, imagens ambientadas e vídeo. Agora é só aplicar isso nos
            seus produtos de verdade.
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
      </div>
    );
  }

  if (screen === 'catalog') {
    return (
      <div className="max-w-5xl mx-auto px-4 md:px-6 py-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Catálogo de Produtos</h2>
            <p className="text-xs text-slate-500 mt-0.5">Assim é a tela onde você gerencia seus produtos de verdade.</p>
          </div>
          <button
            onClick={() => setScreen('done')}
            className="text-xs font-medium text-slate-400 hover:text-slate-600 transition-colors"
          >
            Concluir tutorial
          </button>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-[#f7f9fb] border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 font-bold text-slate-600 text-xs tracking-wider uppercase">IMG</th>
                <th className="px-4 py-3 font-bold text-slate-600 text-xs tracking-wider uppercase">SKU</th>
                <th className="px-4 py-3 font-bold text-slate-600 text-xs tracking-wider uppercase">Título</th>
                <th className="px-4 py-3 font-bold text-slate-600 text-xs tracking-wider uppercase">Categoria</th>
                <th className="px-4 py-3 font-bold text-slate-600 text-xs tracking-wider uppercase">Status</th>
                <th className="px-4 py-3 text-right font-bold text-slate-600 text-xs tracking-wider uppercase">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              <tr className="hover:bg-[#f1f5f9]/60 transition-colors">
                <td className="px-4 py-3">
                  <div className="w-10 h-10 rounded-md border border-slate-200 bg-slate-50 flex items-center justify-center text-slate-400">
                    <ImageIcon className="w-4 h-4 opacity-70" />
                  </div>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-slate-600 font-medium">{MOCK_PRODUCT.sku}</td>
                <td className="px-4 py-3 text-slate-900">{MOCK_PRODUCT.rawName}</td>
                <td className="px-4 py-3 text-slate-500 text-xs">{attributesDone ? MOCK_CATEGORY_PATH.join(' > ') : '-'}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    {([
                      { on: descriptionGenerated, Icon: Sparkles, onClass: 'bg-orange-50 text-orange-700 border-orange-200/60' },
                      { on: attributesDone, Icon: Tag, onClass: 'bg-amber-50 text-amber-700 border-amber-200/60' },
                      { on: imagesGenerated, Icon: ImageIcon, onClass: 'bg-orange-50 text-orange-700 border-orange-200/60' },
                    ] as const).map(({ on, Icon, onClass }, i) => (
                      <span
                        key={i}
                        className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border text-[9px] font-bold uppercase tracking-wider ${on ? onClass : 'bg-slate-50 text-slate-300 border-slate-200/60'}`}
                      >
                        <Icon className="w-3 h-3" />
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    <button
                      onClick={() => openModal('geral')}
                      className="text-[#FF5B03] hover:bg-orange-600 hover:text-white bg-orange-50 border border-orange-100 p-1.5 rounded-lg transition-all shadow-sm flex items-center justify-center w-8 h-8"
                      title="Visualizar Detalhes"
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => openModal('atributos')}
                      className={`rounded-md transition-all shadow-sm flex items-center justify-center w-8 h-8 ${attributesDone ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-white text-slate-400 border border-slate-200 hover:border-amber-300 hover:bg-amber-50'}`}
                      title="Gerar Atributos"
                    >
                      <Tag className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => openModal('imagens')}
                      className={`rounded-md transition-all shadow-sm flex items-center justify-center w-8 h-8 ${imagesGenerated ? 'bg-orange-50 text-orange-700 border border-orange-200' : 'bg-white text-slate-400 border border-slate-200 hover:border-orange-300 hover:bg-orange-50'}`}
                      title="Gerar Imagens"
                    >
                      <ImageIcon className="w-3.5 h-3.5" />
                    </button>
                    <div className="relative">
                      <button
                        onClick={() => openModal('conteudo')}
                        className={`rounded-md transition-all shadow-sm flex items-center justify-center w-8 h-8 ${descriptionGenerated ? 'bg-[#FF5B03]/10 text-[#FF5B03] border border-[#FF5B03]/20' : 'bg-white text-slate-400 border border-slate-200 hover:border-orange-300 hover:bg-orange-50'}`}
                        title="Gerar Descrição"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                      </button>
                      {!descriptionGenerated && !attributesDone && !imagesGenerated && (
                        <div className="absolute -top-9 right-0 px-2.5 py-1.5 bg-slate-900 text-white text-[10px] font-medium rounded-lg whitespace-nowrap shadow-lg">
                          Clique para abrir o produto
                          <div className="absolute top-full right-3 border-4 border-transparent border-t-slate-900" />
                        </div>
                      )}
                    </div>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 md:px-6 py-6">
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <header className="h-16 bg-white border-b border-slate-200 px-4 md:px-6 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setScreen('catalog')}
              className="p-2 hover:bg-slate-100 rounded-lg text-slate-500 transition-colors shrink-0"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="h-8 w-px bg-slate-200 shrink-0" />
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-10 w-10 rounded-md bg-slate-100 flex items-center justify-center border border-slate-200 shrink-0">
                <ImageIcon className="w-5 h-5 text-slate-400" />
              </div>
              <div className="min-w-0">
                <h1 className="text-sm md:text-base font-bold text-slate-900 truncate">{MOCK_PRODUCT.rawName}</h1>
                <p className="text-[10px] text-slate-500 font-mono">SKU: {MOCK_PRODUCT.sku}</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setScreen('done')}
              className="px-2.5 py-2 text-xs font-bold text-slate-500 hover:bg-slate-100 rounded-xl transition-colors whitespace-nowrap"
            >
              Concluir tutorial
            </button>
            <button
              onClick={() => setScreen('catalog')}
              className="px-3 md:px-6 py-2 bg-[#FF5B03] text-white text-xs md:text-sm font-bold rounded-xl shadow-lg shadow-orange-200 hover:bg-orange-700 transition-all flex items-center gap-1.5 whitespace-nowrap"
            >
              <Save className="w-4 h-4" />
              <span className="hidden sm:inline">Salvar e Fechar</span>
            </button>
          </div>
        </header>

        <div className="flex flex-col md:flex-row">
          <aside className="w-full md:w-56 bg-white border-b md:border-b-0 md:border-r border-slate-200 flex flex-row md:flex-col p-2 md:p-4 gap-1.5 md:gap-2 shrink-0 overflow-x-auto">
            {MODAL_TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              const done =
                tab.id === 'atributos' ? attributesDone :
                tab.id === 'conteudo' ? descriptionGenerated :
                tab.id === 'imagens' ? imagesGenerated :
                tab.id === 'video' ? videoStatus === 'done' :
                false;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 md:gap-3 px-3 py-2 md:px-4 md:py-3 rounded-lg md:rounded-xl text-xs md:text-sm font-bold transition-all shrink-0 ${isActive ? 'bg-orange-50 text-[#FF5B03] shadow-sm' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'}`}
                >
                  <Icon className={`w-5 h-5 ${isActive ? 'text-[#FF5B03]' : 'text-slate-400'}`} />
                  {tab.label}
                  {done && <CheckCircle2 className="w-4 h-4 text-emerald-500 ml-auto shrink-0" />}
                </button>
              );
            })}
          </aside>

          <main className="flex-1 p-6 md:p-8 min-h-[420px]">
            {activeTab === 'geral' && (
              <div className="text-center py-12 text-slate-400 text-sm">Aba "Geral" ainda não implementada.</div>
            )}
            {activeTab === 'atributos' && (
              <div className="text-center py-12 text-slate-400 text-sm">Aba "Atributos" ainda não implementada.</div>
            )}
            {activeTab === 'conteudo' && (
              <div className="text-center py-12 text-slate-400 text-sm">Aba "Conteúdo" ainda não implementada.</div>
            )}
            {activeTab === 'imagens' && (
              <div className="text-center py-12 text-slate-400 text-sm">Aba "Imagens" ainda não implementada.</div>
            )}
            {activeTab === 'video' && (
              <div className="text-center py-12 text-slate-400 text-sm">Aba "Vídeo" ainda não implementada.</div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
};

export default TutorialView;
