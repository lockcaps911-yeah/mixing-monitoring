'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import type { AuthUser } from '@/lib/auth';

export default function SideNav({
  user,
  defaultMachine,
  authenticationEnabled,
}: {
  user: Pick<AuthUser, 'name' | 'email' | 'role'>;
  defaultMachine: { line: string; code: string } | null;
  authenticationEnabled: boolean;
}) {
  const { line, machine } = useParams<{ line?: string; machine?: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const path = (pathname || '').toLowerCase();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const [sessionError, setSessionError] = useState('');

  async function logout() {
    setLoggingOut(true);
    setLogoutError('');
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' });
      if (!response.ok) {
        setLogoutError('Tidak dapat keluar. Silakan coba lagi.');
        setLoggingOut(false);
        return;
      }
      router.replace('/login');
      router.refresh();
    } catch {
      setLogoutError('Tidak dapat terhubung ke server. Silakan coba lagi.');
      setLoggingOut(false);
    }
  }

  useEffect(() => {
    const closeTimer = setTimeout(() => setMobileOpen(false), 0);
    return () => clearTimeout(closeTimer);
  }, [pathname]);

  useEffect(() => {
    let active = true;
    const checkSession = async () => {
      try {
        const response = await fetch('/api/auth/me', { cache: 'no-store' });
        if (!active) return;
        if (response.status === 401) {
          router.replace('/login');
          return;
        }
        if (!response.ok) return;
        setSessionError('');
        const result = await response.json() as { user?: { role?: string } };
        if (active && pathname.startsWith('/dashboard/users') && result.user?.role !== 'ADMIN') {
          router.replace('/dashboard');
        }
      } catch {
        if (active) setSessionError('Tidak dapat memeriksa sesi. Periksa koneksi Anda.');
      }
    };
    void checkSession();
    const timer = setInterval(() => void checkSession(), 15_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [pathname, router]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && mobileOpen) {
        setMobileOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mobileOpen]);

  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileOpen]);

  const base = line && machine
    ? `/dashboard/${line}/${machine}`
    : defaultMachine
      ? `/dashboard/${defaultMachine.line}/${defaultMachine.code}`
      : null;

  const items = [
    {
      href: base ?? '/dashboard',
      label: 'Dashboard Realtime',
      active: base !== null && path === base.toLowerCase(),
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="7" height="9" rx="1" />
          <rect x="14" y="3" width="7" height="5" rx="1" />
          <rect x="14" y="12" width="7" height="9" rx="1" />
          <rect x="3" y="16" width="7" height="5" rx="1" />
        </svg>
      ),
    },
    {
      href: base ? `${base}/mimic` : '/dashboard',
      label: 'Digital Twin',
      active: base !== null && path.startsWith(`${base}/mimic`.toLowerCase()),
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2L2 7l10 5 10-5-10-5z" />
          <path d="M2 17l10 5 10-5" />
          <path d="M2 12l10 5 10-5" />
        </svg>
      ),
    },
    {
      href: base ? `${base}/riwayat` : '/dashboard',
      label: 'Riwayat Data',
      active: base !== null && path.startsWith(`${base}/riwayat`.toLowerCase()),
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <polyline points="10 9 9 9 8 9" />
        </svg>
      ),
    },
    {
      href: base ? `${base}/alarms` : '/dashboard',
      label: 'Riwayat Alarm',
      active: base !== null && path.startsWith(`${base}/alarms`.toLowerCase()),
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
      ),
    },
  ];
  if (authenticationEnabled && user.role === 'ADMIN') {
    items.push({
      href: '/dashboard/users',
      label: 'Manajemen Pengguna',
      active: path.startsWith('/dashboard/users'),
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="10" cy="7" r="4" />
          <path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      ),
    });
  }

  const renderLinks = (links: typeof items) => links.map((i) => (
    <Link
      key={i.href}
      href={i.href}
      aria-label={i.label}
      aria-current={i.active ? 'page' : undefined}
      title={collapsed ? i.label : undefined}
      onClick={() => setMobileOpen(false)}
    >
      <span className="sc-nav-icon" aria-hidden="true">{i.icon}</span>
      <span className="sc-nav-label">{i.label}</span>
    </Link>
  ));

  return (
    <>
      {/* Mobile Top Bar */}
      <header className="sc-mobile-bar" aria-label="Mobile Navigation Bar">
        <button
          type="button"
          className="sc-mobile-toggle"
          onClick={() => setMobileOpen(true)}
          aria-label="Buka menu navigasi"
          aria-expanded={mobileOpen}
          aria-controls="primary-sidebar"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>

        <div className="sc-mobile-brand">
          <strong>Satoria Mixing Monitor</strong>
          <span>Sistem Monitoring</span>
        </div>
      </header>

      {/* Backdrop overlay */}
      <div
        className={`sc-overlay ${mobileOpen ? 'is-active' : ''}`}
        onClick={() => setMobileOpen(false)}
        aria-hidden="true"
      />

      {/* Sidebar */}
      <aside
        id="primary-sidebar"
        className={`sc-side ${mobileOpen ? 'is-open' : ''} ${collapsed ? 'is-collapsed' : ''}`}
        aria-label="Menu utama"
      >
        <div className="sc-brand">
          <div className="sc-brand-row">
            <div className="sc-brand-text">
              <strong>Satoria Mixing Monitor</strong>
              <span>Sistem Monitoring</span>
            </div>
            <button
              type="button"
              className="sc-collapse-toggle"
              onClick={() => setCollapsed((value) => !value)}
              aria-label={collapsed ? 'Perluas navigasi' : 'Ciutkan navigasi'}
              aria-expanded={!collapsed}
              aria-controls="primary-navigation"
              title={collapsed ? 'Perluas navigasi' : 'Ciutkan navigasi'}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {collapsed ? <path d="m9 18 6-6-6-6" /> : <path d="m15 18-6-6 6-6" />}
              </svg>
            </button>
            <button
              type="button"
              className="sc-side-close"
              onClick={() => setMobileOpen(false)}
              aria-label="Tutup menu"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        <nav id="primary-navigation" className="sc-nav" aria-label="Menu utama">
          <div className="sc-nav-section">
            <span className="sc-nav-group">Monitoring</span>
            {renderLinks(items.slice(0, 2))}
          </div>
          <div className="sc-nav-section">
            <span className="sc-nav-group">Riwayat</span>
            {renderLinks(items.slice(2, 4))}
          </div>
          {items.length > 4 && (
            <div className="sc-nav-section">
              <span className="sc-nav-group">Administrasi</span>
              {renderLinks(items.slice(4))}
            </div>
          )}
        </nav>
        <div className="sc-user-panel">
          <div>
            <strong>{user.name}</strong>
            <span>{user.email}</span>
            <small>{user.role}</small>
          </div>
          {authenticationEnabled && (
            <>
              <button type="button" onClick={logout} disabled={loggingOut}>
                {loggingOut ? 'Keluar...' : 'Keluar'}
              </button>
              {logoutError && <span role="alert">{logoutError}</span>}
            </>
          )}
          {sessionError && <span role="status">{sessionError}</span>}
        </div>
      </aside>
    </>
  );
}
