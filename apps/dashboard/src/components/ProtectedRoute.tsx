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
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { DISPATCHER_LEVEL } from '@pushcomm/shared';
import { getJwtRoleLevel } from '../lib/authRole';

export function ProtectedRoute() {
  const { isAuthenticated, isLoading, logout } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg-primary">
        <div className="animate-spin w-8 h-8 border-2 border-accent border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!isAuthenticated) return <Navigate to="/login" replace />;

  if (getJwtRoleLevel() < DISPATCHER_LEVEL) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg-primary px-4 text-center">
        <div className="max-w-md rounded-xl border border-border bg-bg-card p-6">
          <h1 className="text-xl font-semibold text-white">Management access required</h1>
          <p className="mt-2 text-sm text-text-secondary">
            This dashboard is available to dispatchers and administrators only.
          </p>
          <button
            type="button"
            onClick={logout}
            className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
          >
            Log out and sign in again
          </button>
        </div>
      </div>
    );
  }

  return <Outlet />;
}
