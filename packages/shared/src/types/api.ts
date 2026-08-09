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
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface PaginationQuery {
  page?: number;
  limit?: number;
}

export interface HealthResponse {
  status: 'ok' | 'degraded' | 'error';
  version: string;
  uptime: number;
  services: {
    database: boolean;
    redis: boolean;
    livekit: boolean;
    martin: boolean;
  };
}

export interface DirectConversation {
  partner_id: string;
  last_message: string;
  last_message_at: string;
  last_sender_id: string;
  partner_first_name: string;
  partner_last_name: string;
  unread_count: number;
}

export interface GroupConversation {
  group_id: string;
  last_message: string;
  last_message_at: string;
  last_sender_id: string;
  group_name: string;
  sender_first_name: string | null;
  sender_last_name: string | null;
  unread_count: number;
}

export interface BroadcastMessage {
  id: string;
  last_message: string;
  last_message_at: string;
  sender_id: string;
  subject: string | null;
  sender_first_name: string | null;
  sender_last_name: string | null;
  is_read: boolean;
}

export interface ConversationsData {
  direct: DirectConversation[];
  group: GroupConversation[];
  broadcast: BroadcastMessage[];
}
