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
import { useState, useEffect } from 'react';

interface HealthData {
  status: string;
  version: string;
  uptime: number;
  services: {
    database: boolean;
    redis: boolean;
    livekit: boolean;
    martin: boolean;
  };
}

export function useHealth() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json())
      .then((data) => setHealth(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return { health, loading };
}
