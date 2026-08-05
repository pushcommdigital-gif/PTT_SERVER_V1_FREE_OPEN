import { useState, useCallback, useEffect } from 'react';

const STORAGE_KEY = 'dispatch:trackedUsers';

export function useTrackedUsers() {
  const [trackedIds, setTrackedIds] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? new Set<string>(JSON.parse(raw)) : new Set<string>();
    } catch {
      return new Set<string>();
    }
  });

  // Persist to localStorage on change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...trackedIds]));
  }, [trackedIds]);

  const toggle = useCallback((id: string) => {
    setTrackedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const addMany = useCallback((ids: string[]) => {
    setTrackedIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      return next;
    });
  }, []);

  const removeMany = useCallback((ids: string[]) => {
    setTrackedIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
  }, []);

  const clear = useCallback(() => setTrackedIds(new Set()), []);

  return { trackedIds, toggle, addMany, removeMany, clear };
}
