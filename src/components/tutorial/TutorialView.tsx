import React from 'react';

interface TutorialViewProps {
  onFinish: () => void;
}

const TutorialView: React.FC<TutorialViewProps> = ({ onFinish }) => {
  return (
    <div className="max-w-3xl mx-auto px-4 md:px-6 py-6">
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-8 text-center">
        <h2 className="text-lg font-bold text-slate-800">Tutorial</h2>
        <p className="text-sm text-slate-500 mt-2">Em construção.</p>
        <button
          onClick={onFinish}
          className="mt-4 text-sm font-medium text-[#FF5B03] hover:underline"
        >
          Voltar para produtos
        </button>
      </div>
    </div>
  );
};

export default TutorialView;
