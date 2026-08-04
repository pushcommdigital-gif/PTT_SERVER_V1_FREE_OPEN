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
