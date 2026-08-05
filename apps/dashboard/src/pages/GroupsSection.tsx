/*
 * PushComm Community Edition
 * Copyright (C) 2026 PushComm Digital
 *
 * This program is free software: you can redistribute it and/or modify it
 * under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or (at your
 * option) any later version. See the LICENSE file for the full text.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
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
