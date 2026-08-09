/*
 * PushComm Community Edition
 * Copyright (C) 2026 Corbani Mauro
 *
 * This program is free software: you can redistribute it and/or modify it
 * under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or (at your
 * option) any later version. See the LICENSE file for the full text.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { apiFetch, setTokens, loadTokens, clearTokens } from '../lib/api';
import { DISPATCHER_LEVEL } from '@pushcomm/shared';

interface AuthUser {
  id: string;
  departmentId: string;
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  role: string;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

interface AuthState {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

function getRoleLevelFromToken(token: string): number {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return typeof payload.roleLevel === 'number' ? payload.roleLevel : 0;
  } catch {
    return 0;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchMe = useCallback(async () => {
    try {
      const res = await apiFetch<AuthUser>('/users/me');
      if (res.data) setUser(res.data);
    } catch {
      clearTokens();
      setUser(null);
    }
  }, []);

  useEffect(() => {
    loadTokens();

    const token = localStorage.getItem('accessToken');
    const hasValidToken = !!token && getRoleLevelFromToken(token) >= DISPATCHER_LEVEL;

    const boot = async () => {
      if (hasValidToken) {
        await fetchMe();
        return;
      }
      if (token) clearTokens(); // present but wrong role
    };

    boot().finally(() => setIsLoading(false));
  }, [fetchMe]);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await apiFetch<{ accessToken: string; refreshToken: string }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      if (res.data) {
        if (getRoleLevelFromToken(res.data.accessToken) < DISPATCHER_LEVEL) {
          throw new Error('Access denied. Dispatcher role or higher is required to use this console.');
        }
        setTokens(res.data.accessToken, res.data.refreshToken);
        await fetchMe();
      }
    },
    [fetchMe],
  );

  const logout = useCallback(() => {
    apiFetch('/auth/logout', { method: 'POST' }).catch(() => {});
    clearTokens();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
