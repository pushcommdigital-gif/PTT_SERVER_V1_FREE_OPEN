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
