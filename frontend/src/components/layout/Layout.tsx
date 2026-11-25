import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/features/auth/AuthContext';
import {
  LayoutDashboard,
  Users,
  ClipboardList,
  ClipboardCheck,
  ChartNoAxesColumnIncreasing,
  Trophy,
  Vote,
  BadgeCheck,
  History,
  PlusCircle,
  ScrollText,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Menu,
  X,
} from 'lucide-react';

interface LayoutProps {
  children: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close the mobile drawer whenever the route changes
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  // Escape closes the mobile drawer
  useEffect(() => {
    if (!mobileOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [mobileOpen]);

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  const isActive = (path: string) => location.pathname === path;

  // Role-based navigation
  const isVoter = user?.role === 'voter';
  const isChair = user?.role === 'chair';

  const navItems = isVoter
    ? [
        { label: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
        { label: 'Kandidat', path: '/candidates', icon: Users },
        { label: 'Voting', path: '/voting', icon: Vote },
        { label: 'Hasil Voting', path: '/voting/results', icon: Trophy },
        { label: 'Keputusan', path: '/decisions/final', icon: BadgeCheck },
        { label: 'Riwayat Pemilihan', path: '/elections', icon: History },
      ]
    : [
        { label: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
        { label: 'Kandidat', path: '/candidates', icon: Users },
        { label: 'Kriteria', path: '/criteria', icon: ClipboardList },
        { label: 'Penilaian', path: '/assessments', icon: ClipboardCheck },
        { label: 'Hasil TOPSIS', path: '/results/topsis', icon: ChartNoAxesColumnIncreasing },
        { label: 'Hasil Borda', path: '/results/borda', icon: Trophy },
        { label: 'Voting', path: '/voting', icon: Vote },
        { label: 'Keputusan', path: '/decisions/final', icon: BadgeCheck },
        { label: 'Riwayat Pemilihan', path: '/elections', icon: History },
        ...(isChair
          ? [
              { label: 'Pemilihan Baru', path: '/elections/new', icon: PlusCircle },
              { label: 'Log Aktivitas', path: '/audit-logs', icon: ScrollText },
            ]
          : []),
      ];

  const getRoleBadge = (role?: string) => {
    switch (role) {
      case 'chair':
        return 'Ketua Panel';
      case 'member':
        return 'Anggota Panel';
      case 'voter':
        return 'Pemilih Terdaftar';
      default:
        return 'Pengguna';
    }
  };

  const handleNavigate = (path: string) => {
    navigate(path);
    setMobileOpen(false);
  };

  return (
    <div className="flex h-screen bg-canvas">
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 md:hidden no-print"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar: off-canvas drawer on mobile, static on desktop */}
      <aside
        id="app-sidebar"
        className={[
          'bg-navy-800 text-white transition-all duration-300 flex flex-col shadow-lg z-40 no-print',
          'fixed inset-y-0 left-0 md:static md:inset-auto',
          mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
          sidebarOpen ? 'md:w-64' : 'md:w-20',
          'w-64',
        ].join(' ')}
        aria-label="Navigasi utama"
      >
        {/* Header */}
        <div className="p-4 border-b border-navy-700 flex items-center justify-between">
          <h1 className={`text-lg font-bold tracking-wider ${sidebarOpen ? '' : 'md:hidden'}`}>PILPRESS</h1>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="hidden md:inline-flex p-1 hover:bg-navy-700 rounded transition text-slate-300 focus:outline-none focus:ring-2 focus:ring-gold-accent"
              aria-label={sidebarOpen ? 'Perkecil sidebar' : 'Perbesar sidebar'}
              aria-expanded={sidebarOpen}
              aria-controls="app-sidebar"
            >
              {sidebarOpen ? <ChevronLeft className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
            </button>
            <button
              onClick={() => setMobileOpen(false)}
              className="md:hidden p-1 hover:bg-navy-700 rounded transition text-slate-300 focus:outline-none focus:ring-2 focus:ring-gold-accent"
              aria-label="Tutup menu navigasi"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Nav Items */}
        <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.path);
            return (
              <button
                key={item.path}
                onClick={() => handleNavigate(item.path)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition focus:outline-none focus:ring-2 focus:ring-gold-accent ${
                  active
                    ? 'bg-gold-accent text-navy-800 font-semibold'
                    : 'text-slate-300 hover:bg-navy-700'
                }`}
                title={item.label}
                aria-current={active ? 'page' : undefined}
              >
                <Icon className="w-5 h-5 flex-shrink-0" aria-hidden="true" />
                <span className={`text-sm ${sidebarOpen ? '' : 'md:hidden'}`}>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* User & Logout */}
        <div className="p-4 border-t border-navy-700 space-y-2">
          <div className={`text-xs mb-3 ${sidebarOpen ? '' : 'md:hidden'}`}>
            <p className="font-semibold text-gold-accent">{user?.name}</p>
            <p className="text-slate-400">{getRoleBadge(user?.role)}</p>
          </div>
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-action-red hover:bg-action-hover text-white rounded-lg transition text-sm font-medium focus:outline-none focus:ring-2 focus:ring-gold-accent"
          >
            <LogOut className="w-4 h-4" aria-hidden="true" />
            <span className={sidebarOpen ? '' : 'md:hidden'}>Logout</span>
            <span className="sr-only md:hidden">Logout</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Top Bar */}
        <div className="bg-white border-b border-slate-200 px-4 md:px-6 py-3 md:py-4 flex items-center justify-between gap-3 shadow-sm no-print">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setMobileOpen(true)}
              className="md:hidden p-2 -ml-2 rounded-lg hover:bg-slate-100 text-navy-800 focus:outline-none focus:ring-2 focus:ring-gold-accent"
              aria-label="Buka menu navigasi"
              aria-expanded={mobileOpen}
              aria-controls="app-sidebar"
            >
              <Menu className="w-5 h-5" />
            </button>
            <h2 className="text-lg md:text-xl font-semibold text-navy-800 truncate">
              {navItems.find((i) => i.path === location.pathname)?.label || 'Dashboard'}
            </h2>
          </div>
          <div className="text-sm text-slate-600 hidden sm:block whitespace-nowrap">
            {new Date().toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6">
          {children}
        </div>
      </main>
    </div>
  );
};
