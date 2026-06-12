// Tiny localStorage-backed state hooks, shared across screens so UI preferences
// (view, sort, filters) survive reloads. Lifted out of Inventory.tsx so every
// screen uses one implementation.
import { type Dispatch, type SetStateAction, useEffect, useState } from "react";

/** Persisted string UI state (view, tile size, label density). Survives reloads. */
export function usePersisted<T extends string>(key: string, fallback: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      return (localStorage.getItem(key) as T) || fallback;
    } catch {
      return fallback;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, v);
    } catch {
      /* ignore quota/availability errors */
    }
  }, [key, v]);
  return [v, setV];
}

/** Persisted JSON state for objects/arrays (sort state, filter sets). Same shape
 *  as useState (supports functional updates), but mirrored to localStorage. */
export function usePersistedJSON<T>(key: string, fallback: T): [T, Dispatch<SetStateAction<T>>] {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw != null ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(v));
    } catch {
      /* ignore quota/availability errors */
    }
  }, [key, v]);
  return [v, setV];
}
