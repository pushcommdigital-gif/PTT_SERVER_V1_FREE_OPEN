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
import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../lib/api';

// Whether first-boot setup is complete. Drives whether the dashboard shows the
// setup wizard or the normal app. Fetched once at startup (public endpoint).
export function useSetupState() {
  const [setupComplete, setSetupComplete] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(() => {
    setLoading(true);
    apiFetch<{ setupComplete: boolean }>('/setup/state')
      .then((res) => setSetupComplete(res.data?.setupComplete ?? true))
      // If the check fails, fail safe to "complete" so we never block the app at login.
      .catch(() => setSetupComplete(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  return { setupComplete, loading, refetch };
}
