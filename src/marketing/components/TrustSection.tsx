import { ShieldCheck, Server, Lock } from 'lucide-react';

const items = [
  { icon: ShieldCheck, title: 'Dados privados', text: 'Seus dados não são compartilhados com terceiros.' },
  { icon: Server, title: 'Chaves no servidor', text: 'As chaves de IA nunca ficam expostas no navegador.' },
  { icon: Lock, title: 'Uso responsável de IA', text: 'Você revisa e aprova tudo antes de publicar.' },
];

export default function TrustSection() {
  return (
    <div className="grid gap-8 md:grid-cols-3">
      {items.map(({ icon: Icon, title, text }) => (
        <div key={title} className="flex gap-4">
          <div className="w-11 h-11 rounded-xl bg-orange/10 text-orange flex items-center justify-center shrink-0"><Icon className="w-5 h-5" /></div>
          <div>
            <h3 className="font-bold mb-1">{title}</h3>
            <p className="text-porcelain/70 text-sm">{text}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
