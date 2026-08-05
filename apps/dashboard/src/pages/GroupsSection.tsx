import { Outlet, Navigate, useLocation } from 'react-router-dom';
import { SectionTabs, type SectionTab } from '../components/ui/SectionTabs';
import { getJwtRoleLevel } from '../lib/authRole';
import { ADMIN_LEVEL } from '@pushcomm/shared';

/**
 * Wraps the Groups page and nests Group Types as an admin-only sub-tab.
 * Dispatchers (below ADMIN_LEVEL) see only the Groups list with no tab strip,
 * and can't reach the Group Types sub-route directly.
 */
export function GroupsSection() {
  const isAdmin = getJwtRoleLevel() >= ADMIN_LEVEL;
  const { pathname } = useLocation();

  if (!isAdmin && pathname !== '/groups') {
    return <Navigate to="/groups" replace />;
  }

  const tabs: SectionTab[] = [
    { label: 'Groups', to: '/groups', end: true },
    { label: 'Group Types', to: '/groups/types' },
  ];

  return (
    <div>
      {isAdmin && <SectionTabs tabs={tabs} />}
      <Outlet />
    </div>
  );
}
