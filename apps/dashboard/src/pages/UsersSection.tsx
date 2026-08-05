import { Outlet, Navigate, useLocation } from 'react-router-dom';
import { SectionTabs, type SectionTab } from '../components/ui/SectionTabs';
import { getJwtRoleLevel } from '../lib/authRole';
import { ADMIN_LEVEL } from '@pushcomm/shared';

/**
 * Wraps the Users page and nests Roles as an admin-only sub-tab. Dispatchers
 * (below ADMIN_LEVEL) see only the Users list with no tab strip, and can't
 * reach the Roles sub-route directly.
 */
export function UsersSection() {
  const isAdmin = getJwtRoleLevel() >= ADMIN_LEVEL;
  const { pathname } = useLocation();

  if (!isAdmin && pathname !== '/users') {
    return <Navigate to="/users" replace />;
  }

  const tabs: SectionTab[] = [
    { label: 'Users', to: '/users', end: true },
    { label: 'Roles', to: '/users/roles' },
  ];

  return (
    <div>
      {isAdmin && <SectionTabs tabs={tabs} />}
      <Outlet />
    </div>
  );
}
