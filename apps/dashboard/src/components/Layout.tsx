import type { ComponentType } from 'react';
import { Outlet, NavLink } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useWsStatus } from '../contexts/WebSocketContext';
import { LayoutDashboard, Users, Radio, LogOut, Siren, PhoneCall, MapPin, Smartphone, SlidersHorizontal, Settings } from 'lucide-react';
import { ADMIN_LEVEL, DISPATCHER_LEVEL } from '@pushcomm/shared';
import { getJwtRoleLevel } from '../lib/authRole';
import { getRegisteredNav } from '../addons/registry';

interface NavItem {
  label: string;
  to: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  minRoleLevel: number;
}

// Core nav. Add-on entries are spliced in from the registry (empty in CE) —
// 'operations' after SOS/Zone Alerts, 'management' after Status Settings, and
// 'system' just before Settings.
const operationsNav: NavItem[] = [
  { label: 'Dashboard', to: '/', icon: LayoutDashboard, minRoleLevel: DISPATCHER_LEVEL },
  { label: 'Users', to: '/users', icon: Users, minRoleLevel: DISPATCHER_LEVEL },
  { label: 'Devices', to: '/devices', icon: Smartphone, minRoleLevel: DISPATCHER_LEVEL },
  { label: 'Groups', to: '/groups', icon: Radio, minRoleLevel: DISPATCHER_LEVEL },
  { label: 'SOS Events', to: '/sos', icon: Siren, minRoleLevel: DISPATCHER_LEVEL },
  { label: 'Zone Alerts', to: '/zone-alerts', icon: MapPin, minRoleLevel: DISPATCHER_LEVEL },
  { label: 'Recordings / CDR', to: '/cdr', icon: PhoneCall, minRoleLevel: DISPATCHER_LEVEL },
];

const managementNav: NavItem[] = [
  { label: 'Status Settings', to: '/statuses', icon: SlidersHorizontal, minRoleLevel: ADMIN_LEVEL },
];

const systemNav: NavItem[] = [
  { label: 'Settings', to: '/settings', icon: Settings, minRoleLevel: ADMIN_LEVEL },
];

/** EXTENSION POINT: add-on nav entries for a section. Empty in CE. */
function addonNav(section: 'operations' | 'management' | 'system'): NavItem[] {
  return getRegisteredNav(section).map((r) => ({
    label: r.nav!.label,
    to: `/${r.path}`,
    icon: r.nav!.icon,
    minRoleLevel: r.nav!.minRoleLevel ?? DISPATCHER_LEVEL,
  }));
}

const navItems: NavItem[] = [
  ...operationsNav,
  ...addonNav('operations'),
  ...managementNav,
  ...addonNav('management'),
  ...addonNav('system'),
  ...systemNav,
];

const statusConfig = {
  connected: { color: 'bg-success', label: 'Live' },
  connecting: { color: 'bg-warning', label: 'Connecting...' },
  disconnected: { color: 'bg-danger', label: 'Disconnected' },
} as const;

export function Layout() {
  const { user, logout } = useAuth();
  const wsStatus = useWsStatus();
  const roleLevel = getJwtRoleLevel();
  const visibleNavItems = navItems.filter((item) => roleLevel >= item.minRoleLevel);

  const initials = user
    ? `${user.firstName.charAt(0) || '?'}${user.lastName.charAt(0) || ''}`.toUpperCase()
    : '?';

  const displayName = user
    ? `${user.firstName} ${user.lastName}`
    : 'User';

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-56 bg-bg-sidebar border-r border-border flex flex-col">
        {/* Logo */}
        <div className="h-14 flex items-center px-4 border-b border-border">
          <span className="text-xl font-bold text-accent">PUSHCOMM</span>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-4 px-2 space-y-1 overflow-y-auto">
          <p className="px-3 text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">
            Admin
          </p>
          {visibleNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive
                    ? 'bg-accent text-white'
                    : 'text-text-secondary hover:bg-white/5 hover:text-white'
                }`
              }
            >
              <item.icon size={18} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        {/* Status bar */}
        <div className="border-t border-border px-4 py-3 text-xs text-text-secondary">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${statusConfig[wsStatus].color}`} />
            <span>{statusConfig[wsStatus].label}</span>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-y-auto">
        {/* Top bar */}
        <header className="h-14 bg-bg-card border-b border-border flex items-center justify-between px-6 flex-shrink-0">
          <span className="text-sm text-text-secondary">Management Dashboard</span>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center text-sm font-bold">
                {initials}
              </div>
              <span className="text-sm">{displayName}</span>
            </div>
            <button
              onClick={logout}
              className="text-text-secondary hover:text-white transition-colors"
              title="Logout"
            >
              <LogOut size={18} />
            </button>
          </div>
        </header>

        {/* Page content */}
        <div className="p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
