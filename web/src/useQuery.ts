import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from './api';

// Tiny data-loading hook: loads on mount (and when `key` changes), optionally polls,
// and lets callers replace the data immediately (used for optimistic updates).
export function useQuery<T>(key: string, fetcher: () => Promise<T>, pollMs = 0) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  // Every request gets a number; only the newest one is allowed to update the screen.
  // This stops a slow, older response from overwriting newer data.
  const latestRequest = useRef(0);

  const refetch = useCallback(async () => {
    const requestId = ++latestRequest.current;
    try {
      const result = await fetcherRef.current();
      if (requestId !== latestRequest.current) return;
      setData(result);
      setError(null);
    } catch (e) {
      if (requestId !== latestRequest.current) return;
      setError(e instanceof ApiError ? e : new ApiError(0, String(e), null));
    } finally {
      if (requestId === latestRequest.current) setLoading(false);
    }
  }, []);

  // Set data right now and ignore any request that was already in flight
  const mutate = useCallback((next: T) => {
    latestRequest.current++;
    setData(next);
  }, []);

  useEffect(() => {
    setData(undefined);
    setLoading(true);
    refetch();
    if (!pollMs) return;
    const timer = setInterval(refetch, pollMs);
    return () => clearInterval(timer);
  }, [key, pollMs, refetch]);

  return { data, error, loading, refetch, mutate };
}
