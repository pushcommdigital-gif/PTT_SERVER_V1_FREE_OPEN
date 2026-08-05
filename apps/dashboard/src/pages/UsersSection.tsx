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
