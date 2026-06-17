import React, { useState } from 'react';
import { X, Coins, Minus, Plus, CreditCard, Loader2 } from 'lucide-react';
import { auth } from '../../firebase';

interface Props {
  onClose: () => void;
}

type Step = 'form' | 'waiting';

function formatCpfCnpj(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length <= 11) {
    return digits
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  }
  return digits
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2');
}

export default function CreditPurchaseModal({ onClose }: Props) {
  const [step, setStep] = useState<Step>('form');
  const [credits, setCredits] = useState(10);
  const [name, setName] = useState('');
  const [cpfCnpj, setCpfCnpj] = useState('');
  const [coupon, setCoupon] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [validatingCoupon, setValidatingCoupon] = useState(false);
  const [couponError, setCouponError] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<{ code: string; amount: number; discount: number } | null>(null);

  const baseAmount = credits * 0.5;
  const finalAmount = appliedCoupon ? appliedCoupon.amount : baseAmount;

  // Cupom validado deixa de valer se a quantidade de créditos mudar.
  function resetCoupon() {
    if (appliedCoupon) setAppliedCoupon(null);
    if (couponError) setCouponError('');
  }

  async function handleValidateCoupon() {
    if (!coupon.trim()) return;
    setCouponError('');
    setValidatingCoupon(true);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Usuário não autenticado');
      const token = await user.getIdToken();

      const resp = await fetch('/api/payments/validate-coupon', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ credits, coupon: coupon.trim() }),
      });

      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        setAppliedCoupon(null);
        throw new Error((data as { error?: string }).error ?? 'Cupom inválido');
      }

      const { code, amount, discount } = data as { code: string; amount: number; discount: number };
      setAppliedCoupon({ code, amount, discount });
    } catch (err: unknown) {
      setCouponError(err instanceof Error ? err.message : 'Cupom inválido');
    } finally {
      setValidatingCoupon(false);
    }
  }

  function handleCpfCnpjChange(e: React.ChangeEvent<HTMLInputElement>) {
    setCpfCnpj(formatCpfCnpj(e.target.value));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Usuário não autenticado');
      const token = await user.getIdToken();

      const resp = await fetch('/api/payments/create-checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ credits, name: name.trim(), cpfCnpj, coupon: coupon.trim() || undefined }),
      });

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? 'Erro ao gerar cobrança');
      }

      const { invoiceUrl } = await resp.json() as { invoiceUrl: string };
      window.open(invoiceUrl, '_blank', 'noopener,noreferrer');
      setStep('waiting');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro inesperado');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 sm:p-0">
        <div
          className="fixed inset-0 transition-opacity bg-gray-500 bg-opacity-75"
          onClick={onClose}
        />
        <div className="relative inline-block w-full max-w-md p-6 overflow-hidden text-left align-middle transition-all transform bg-white shadow-xl rounded-2xl">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <Coins className="w-6 h-6 text-amber-500" />
              <h3 className="text-lg font-semibold text-gray-900">Comprar Créditos</h3>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-500">
              <X className="w-6 h-6" />
            </button>
          </div>

          {step === 'form' ? (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Quantidade de créditos
                </label>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => { setCredits((c) => Math.max(10, c - 10)); resetCoupon(); }}
                    className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-700 disabled:opacity-40"
                    disabled={credits <= 10}
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <span className="text-2xl font-bold text-gray-900 w-16 text-center">
                    {credits}
                  </span>
                  <button
                    type="button"
                    onClick={() => { setCredits((c) => c + 10); resetCoupon(); }}
                    className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-700"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                  <div className="ml-auto text-right">
                    <p className="text-sm text-gray-500">Total</p>
                    {appliedCoupon ? (
                      <>
                        <p className="text-xs text-gray-400 line-through">R$ {baseAmount.toFixed(2)}</p>
                        <p className="text-xl font-bold text-green-600">R$ {finalAmount.toFixed(2)}</p>
                      </>
                    ) : (
                      <p className="text-xl font-bold text-gray-900">R$ {finalAmount.toFixed(2)}</p>
                    )}
                  </div>
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  R$ 0,50 por crédito · mínimo 10 créditos
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Nome completo
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  placeholder="Seu nome completo"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#004ac6] focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  CPF ou CNPJ
                </label>
                <input
                  type="text"
                  value={cpfCnpj}
                  onChange={handleCpfCnpjChange}
                  required
                  placeholder="000.000.000-00"
                  maxLength={18}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#004ac6] focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Cupom de desconto <span className="text-gray-400 font-normal">(opcional)</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={coupon}
                    onChange={(e) => { setCoupon(e.target.value.toUpperCase()); resetCoupon(); }}
                    placeholder="Ex: BEMVINDO10"
                    className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-[#004ac6] focus:border-transparent"
                  />
                  <button
                    type="button"
                    onClick={handleValidateCoupon}
                    disabled={!coupon.trim() || validatingCoupon || !!appliedCoupon}
                    className="px-4 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors flex items-center gap-1.5"
                  >
                    {validatingCoupon ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    {appliedCoupon ? 'Aplicado' : 'Aplicar'}
                  </button>
                </div>
                {appliedCoupon && (
                  <p className="text-xs text-green-600 mt-1 font-medium">
                    Cupom {appliedCoupon.code} aplicado — desconto de R$ {appliedCoupon.discount.toFixed(2)}.
                  </p>
                )}
                {couponError && (
                  <p className="text-xs text-red-600 mt-1">{couponError}</p>
                )}
              </div>

              {error && (
                <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-[#004ac6] text-white rounded-xl font-medium hover:bg-[#003aa0] disabled:opacity-60 transition-colors"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Gerando cobrança...
                  </>
                ) : (
                  <>
                    <CreditCard className="w-4 h-4" />
                    Ir para o pagamento
                  </>
                )}
              </button>
            </form>
          ) : (
            <div className="text-center py-6 space-y-4">
              <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mx-auto">
                <CreditCard className="w-8 h-8 text-green-600" />
              </div>
              <div>
                <h4 className="text-base font-semibold text-gray-900 mb-1">
                  Janela de pagamento aberta
                </h4>
                <p className="text-sm text-gray-500">
                  Complete o pagamento na janela do Asaas. Após a confirmação, seus créditos
                  serão adicionados automaticamente.
                </p>
              </div>
              <button
                onClick={onClose}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Fechar
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
