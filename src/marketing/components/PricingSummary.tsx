import { Link } from 'react-router-dom';

export default function PricingSummary() {
  return (
    <div className="text-center max-w-2xl mx-auto">
      <h2 className="font-display text-3xl md:text-4xl font-extrabold mb-4">Preço transparente por créditos</h2>
      <p className="text-ink/60 mb-2">Você paga só pelo que usar. Cada operação de IA consome créditos — sem mensalidade escondida.</p>
      <p className="text-ink/60 mb-8">Novos usuários começam com <strong className="text-orange">10 créditos grátis</strong>.</p>
      <Link to="/precos" className="inline-block px-6 py-3 rounded-xl font-bold bg-orange text-white hover:brightness-95 transition">Ver planos e créditos</Link>
    </div>
  );
}
