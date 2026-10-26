import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Header from './Header';
import Sidebar from './Sidebar';

export default function Layout() {
  const [navOpen, setNavOpen] = useState(false);
  return (
    <div className="h-full flex flex-col bg-surface-subtle bg-mesh p-0 lg:p-3 lg:gap-3 lg:flex-row">
      <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />
      <div className="flex-1 flex flex-col overflow-hidden lg:rounded-2xl lg:ring-1 lg:ring-ink/5 lg:glass-card">
        <Header onMenu={() => setNavOpen(true)} />
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
