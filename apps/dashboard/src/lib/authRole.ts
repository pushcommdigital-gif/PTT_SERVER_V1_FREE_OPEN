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
export function getJwtRoleLevel(): number {
  try {
    const token = localStorage.getItem('accessToken');
    if (!token) return 0;
    const payload = JSON.parse(atob(token.split('.')[1]));
    return typeof payload.roleLevel === 'number' ? payload.roleLevel : 0;
  } catch {
    return 0;
  }
}
