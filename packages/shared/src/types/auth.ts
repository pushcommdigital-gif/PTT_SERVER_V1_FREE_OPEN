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
import type { Role } from '../constants.js';

export interface JwtPayload {
  sub: string; // user UUID
  email: string | null;
  role: Role;
  roleLevel: number; // hierarchy level from roles table
  departmentId: string;
  iat?: number;
  exp?: number;
}

export interface LoginRequest {
  email: string; // identifier — accepts either email or username (server resolves)
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string | null;
    username: string;
    firstName: string;
    lastName: string;
    role: Role;
    departmentId: string;
  };
}

export interface RefreshRequest {
  refreshToken: string;
}

export interface RefreshResponse {
  accessToken: string;
  refreshToken: string;
}
