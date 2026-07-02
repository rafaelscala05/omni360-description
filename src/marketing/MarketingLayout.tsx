import { Outlet } from 'react-router-dom';

export default function MarketingLayout() {
  return (
    <div className="min-h-screen bg-porcelain text-ink font-sans">
      <Outlet />
    </div>
  );
}
