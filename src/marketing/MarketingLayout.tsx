import { Outlet } from 'react-router-dom';
import MarketingNav from './components/MarketingNav';
import MarketingFooter from './components/MarketingFooter';

/**
 * O site inteiro vive no escopo `.alfreds` (tema claro fixo), com a aurora do
 * app presa à janela atrás do conteúdo — o vidro dos cartões a desfoca ao rolar.
 */
export default function MarketingLayout() {
  return (
    <div className="alfreds relative isolate min-h-screen font-sans antialiased" data-tema="claro" style={{ background: 'var(--ag-bg)' }}>
      <div aria-hidden className="ag-aurora -z-10 pointer-events-none" style={{ position: 'fixed', inset: 0 }} />
      <MarketingNav />
      <main>
        <Outlet />
      </main>
      <MarketingFooter />
    </div>
  );
}
