import React from 'react';
import { Sparkles, Search, FileSpreadsheet, Image as ImageIcon, CheckCircle, ArrowRight, ShieldCheck, Zap } from 'lucide-react';

interface LoginLandingProps {
  onLogin: () => void;
}

export default function LoginLanding({ onLogin }: LoginLandingProps) {
  const features = [
    {
      title: "Importação Inteligente",
      description: "Importe sua planilha Excel de produtos em segundos e deixe a IA cuidar do resto.",
      icon: <FileSpreadsheet className="w-6 h-6 text-blue-600" />,
      color: "bg-blue-50"
    },
    {
      title: "Enriquecimento de Dados",
      description: "Buscamos informações técnicas reais e detalhadas na internet para completar o cadastro dos seus produtos.",
      icon: <Search className="w-6 h-6 text-purple-600" />,
      color: "bg-purple-50"
    },
    {
      title: "Geração SEO com IA",
      description: "Criamos títulos, descrições e palavras-chave otimizadas para o Google automaticamente, aumentando suas vendas.",
      icon: <Sparkles className="w-6 h-6 text-amber-600" />,
      color: "bg-amber-50"
    },
    {
      title: "Ambientação Profissional",
      description: "Gere imagens realistas do seu produto em cenários profissionais e lifestyle para atrair mais clientes.",
      icon: <ImageIcon className="w-6 h-6 text-green-600" />,
      color: "bg-green-50"
    }
  ];

  return (
    <div className="min-h-screen flex bg-white font-sans overflow-hidden">
      {/* Left Column: Summary and Features */}
      <div className="hidden lg:flex lg:w-3/5 bg-slate-50 relative p-12 flex-col justify-center">
        {/* Background Decorative Elements */}
        <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none opacity-20">
          <div className="absolute -top-24 -left-24 w-96 h-96 bg-blue-200 rounded-full blur-3xl"></div>
          <div className="absolute bottom-1/4 -right-24 w-96 h-96 bg-purple-200 rounded-full blur-3xl"></div>
        </div>

        <div className="relative z-10 max-w-2xl mx-auto">
          <div className="flex items-center gap-3 mb-8">
            <div className="bg-blue-600 p-2.5 rounded-xl shadow-lg shadow-blue-200">
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <h2 className="text-2xl font-black text-gray-900 tracking-tight">Omni360 AI</h2>
          </div>

          <h1 className="text-5xl font-black text-gray-900 leading-tight mb-4">
            Transforme seus produtos em <span className="text-blue-600">vendas automáticas</span>
          </h1>
          <p className="text-lg text-gray-600 mb-12 leading-relaxed">
            A plataforma definitiva para gestores de e-commerce que desejam escalar seus cadastros com Inteligência Artificial Generativa de ponta.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {features.map((feature, index) => (
              <div key={index} className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
                <div className={`${feature.color} w-12 h-12 rounded-xl flex items-center justify-center mb-4`}>
                  {feature.icon}
                </div>
                <h3 className="font-bold text-gray-900 mb-2">{feature.title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-12 flex items-center gap-8 text-gray-400">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5" />
              <span className="text-sm font-medium">Seguro & Privado</span>
            </div>
            <div className="flex items-center gap-2">
              <Zap className="w-5 h-5" />
              <span className="text-sm font-medium">Processamento Real-time</span>
            </div>
          </div>
        </div>
      </div>

      {/* Right Column: Login Part */}
      <div className="w-full lg:w-2/5 flex flex-col justify-center items-center p-8 bg-white border-l border-gray-100 relative">
        <div className="absolute top-8 right-8 lg:hidden">
            <div className="flex items-center gap-2">
                <div className="bg-blue-600 p-1.5 rounded-lg shadow-md h-8 w-8 flex items-center justify-center">
                    <Sparkles className="w-4 h-4 text-white" />
                </div>
                <span className="font-bold text-gray-900">Omni360 AI</span>
            </div>
        </div>

        <div className="w-full max-w-sm">
          <div className="text-center mb-10">
            <h2 className="text-3xl font-black text-gray-900 mb-3">Bem-vindo(a)</h2>
            <p className="text-gray-500">Faça login para acessar suas ferramentas de IA e gerenciar seus créditos.</p>
          </div>

          <div className="space-y-4">
            <button
              onClick={onLogin}
              className="w-full flex items-center justify-center gap-3 py-3.5 px-4 bg-white border border-gray-300 rounded-xl shadow-sm text-gray-700 font-bold hover:bg-gray-50 hover:border-gray-400 transition-all active:scale-[0.98]"
            >
              <img src="https://www.google.com/favicon.ico" alt="Google" className="w-5 h-5" />
              Entrar com o Google
            </button>
            <p className="text-[10px] text-gray-400 text-center leading-relaxed">
              Ao entrar, você concorda com nossos termos de uso e política de privacidade. O acesso é restrito apenas a usuários autorizados.
            </p>
          </div>

          <div className="mt-16 p-6 bg-blue-50 rounded-2xl border border-blue-100">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle className="w-4 h-4 text-blue-600" />
              <span className="text-xs font-bold text-blue-900 uppercase tracking-widest">Bônus de Boas-vindas</span>
            </div>
            <p className="text-sm text-blue-800 leading-relaxed">
              Novos usuários recebem <strong>10 créditos gratuitos</strong> para testar a geração SEO e ambientação de imagens hoje mesmo.
            </p>
          </div>
        </div>

        <div className="absolute bottom-8 text-gray-400 text-xs">
          © {new Date().getFullYear()} Omni360 Agencia. Todos os direitos reservados.
        </div>
      </div>
    </div>
  );
}
