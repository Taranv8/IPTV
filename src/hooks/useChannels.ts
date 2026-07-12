import { useState, useEffect, useCallback, useRef } from 'react';
import { Channel } from '../types/channel';
import { channelApi } from '../services/api/channelApi';
import { CacheService } from '../services/storage/CacheService';
import { APP_CONFIG } from '../constants/config';

// Coalesce WS batches into UI updates at most this often — the socket can
// deliver a 50-channel batch every ~50-100ms, but re-rendering a big list
// that often is wasted work on a low-end TV. Progress still streams in
// underneath; only the visible list update is throttled.
const PROGRESS_FLUSH_MS = 250;

export interface SyncProgress {
  received: number;
  total: number;
}

export const useChannels = () => {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [isLoading, setIsLoading] = useState(APP_CONFIG.ENABLE_CACHE ? false : true);
  const [error, setError] = useState<string | null>(null);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchChannels = useCallback(async () => {
    // Cancel any sync still in flight (e.g. a fast refetch, or the previous
    // mount's request) — this actually closes the WS and lets the server
    // stop querying/streaming instead of finishing in the background.
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const { signal } = abortRef.current;

    let latest: Channel[] = [];
    let hadCache = false;
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      flushTimer = null;
      if (signal.aborted) return;
      setChannels(latest);
    };

    const scheduleFlush = () => {
      if (flushTimer) return; // a flush is already pending; it'll pick up the latest data
      flushTimer = setTimeout(flush, PROGRESS_FLUSH_MS);
    };

    // Called after every WS batch with the *cumulative* list received so far.
    let isFirstBatch = true;
    const handleProgress = (channelsSoFar: Channel[], received: number, total: number) => {
      if (signal.aborted) return;
      latest = channelsSoFar;
      setSyncProgress({ received, total });

      const isFinalBatch = received >= total;
      // The very first batch (no cache on screen) must paint immediately —
      // it already contains everything the visible screen needs, so waiting
      // out the throttle window here would just be reintroducing the hang
      // we're trying to fix.
      const flushImmediately = isFinalBatch || (isFirstBatch && !hadCache);
      isFirstBatch = false;

      if (hadCache && !isFinalBatch) {
        // A (possibly stale) cached list is already on screen — don't
        // replace it with a partial fresh list, that would visibly shrink
        // the grid mid-sync. Just let syncProgress drive a subtle
        // "refreshing" indicator; the full swap happens once, atomically,
        // when the fresh data is complete.
        return;
      }

      if (flushImmediately) {
        if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
        flush();
      } else {
        scheduleFlush();
      }
    };

    try {
      setError(null);
      if (!APP_CONFIG.ENABLE_CACHE) setIsLoading(true);

      if (APP_CONFIG.ENABLE_CACHE) {
        const cached = await CacheService.getChannels();
        if (cached && cached.data.length > 0 && !signal.aborted) {
          setChannels(cached.data);
          latest = cached.data;
          hadCache = true;
          if (!cached.stale) setIsLoading(false);
        }
      }

      const freshChannels = await channelApi.getAllChannels(handleProgress, signal);

      if (freshChannels.length === 0) {
        throw new Error('No channels returned from server');
      }

      if (!signal.aborted) {
        setChannels(freshChannels);
        await CacheService.saveChannels(freshChannels);
      }
    } catch (err) {
      if (signal.aborted) return;

      const message = err instanceof Error ? err.message : 'Failed to load channels';

      try {
        const cached = await CacheService.getChannels();
        if (cached && cached.data.length > 0) {
          setChannels(cached.data);
          setError(message + ' (using cached data)');
          return;
        }
      } catch {
        // cache also failed, fall through to set raw error
      }

      setError(message);
    } finally {
      if (flushTimer) clearTimeout(flushTimer);
      if (!signal.aborted) {
        setIsLoading(false);
        setSyncProgress(null);
      }
    }
  }, []);

  useEffect(() => {
    fetchChannels();
    return () => { abortRef.current?.abort(); };
  }, [fetchChannels]);

  return {
    channels,
    isLoading,
    error,
    /** { received, total } while a fresh sync is streaming in; null when idle. */
    syncProgress,
    refetch: fetchChannels,
  };
};