import { Outlet } from 'react-router-dom';
import MarketingNav from './components/MarketingNav';
import MarketingFooter from './components/MarketingFooter';

export default function MarketingLayout() {
  return (
    <div className="min-h-screen bg-porcelain text-ink font-sans">
      <MarketingNav />
      <Outlet />
      <MarketingFooter />
    </div>
  );
}
