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
import { Navigate, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { LoginPage } from './pages/LoginPage';
import { SetupWizard } from './pages/SetupWizard';
import { useSetupState } from './hooks/useSetupState';
import { DashboardPage } from './pages/DashboardPage';
import { UsersPage } from './pages/UsersPage';
import { UsersSection } from './pages/UsersSection';
import { DevicesPage } from './pages/DevicesPage';
import { GroupsPage } from './pages/GroupsPage';
import { GroupsSection } from './pages/GroupsSection';
import { RolesPage } from './pages/RolesPage';
import { GroupTypesPage } from './pages/GroupTypesPage';
import { CustomStatesPage } from './pages/CustomStatesPage';
import { SosPage } from './pages/SosPage';
import { ZoneAlertsPage } from './pages/ZoneAlertsPage';
import { CdrPage } from './pages/CdrPage';
import { SettingsPage } from './pages/SettingsPage';
import { getRegisteredRoutes } from './addons/registry';

export function App() {
  const { setupComplete, loading } = useSetupState();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg-primary">
        <div className="animate-spin w-8 h-8 border-2 border-accent border-t-transparent rounded-full" />
      </div>
    );
  }

  // Fresh install: the only thing reachable is the first-boot wizard.
  if (!setupComplete) {
    return (
      <Routes>
        <Route path="/setup" element={<SetupWizard />} />
        <Route path="*" element={<Navigate to="/setup" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      {/* Setup already done → keep the wizard out of reach. */}
      <Route path="/setup" element={<Navigate to="/" replace />} />
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route index element={<DashboardPage />} />
          <Route path="users" element={<UsersSection />}>
            <Route index element={<UsersPage />} />
            <Route path="roles" element={<RolesPage />} />
          </Route>
          <Route path="devices" element={<DevicesPage />} />
          <Route path="groups" element={<GroupsSection />}>
            <Route index element={<GroupsPage />} />
            <Route path="types" element={<GroupTypesPage />} />
          </Route>
          {/* Legacy top-level routes → redirect into their parent's sub-tab */}
          <Route path="roles" element={<Navigate to="/users/roles" replace />} />
          <Route path="group-types" element={<Navigate to="/groups/types" replace />} />
          <Route path="statuses" element={<CustomStatesPage />} />
          <Route path="sos" element={<SosPage />} />
          <Route path="zone-alerts" element={<ZoneAlertsPage />} />
          <Route path="cdr" element={<CdrPage />} />
          {/* Recordings consolidated into CDR (Clips view) */}
          <Route path="recordings" element={<Navigate to="/cdr" replace />} />
          <Route path="settings" element={<SettingsPage />} />

          {/* EXTENSION POINT: add-on pages from the registry. Empty in CE. */}
          {getRegisteredRoutes().map((r) => {
            const Page = r.component;
            return <Route key={r.path} path={r.path} element={<Page />} />;
          })}

          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Route>
    </Routes>
  );
}
