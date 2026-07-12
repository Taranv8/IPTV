import { APP_CONFIG } from '../../constants/config';

// ── Config ──────────────────────────────────────────────────────────────────
const HTTP_BASE_URL = APP_CONFIG.API_BASE_URL;

const CONNECT_TIMEOUT_MS = 8_000;   // time allowed to open the socket
const IDLE_TIMEOUT_MS    = 15_000;  // no message received -> treat as stalled
const TOTAL_TIMEOUT_MS   = 60_000;  // absolute ceiling for the whole sync

// Derive a ws(s)://host[:port] origin from the HTTP base URL without relying
// on the `URL` global (not guaranteed on older Hermes/RN runtimes).
function toWsOrigin(httpUrl: string): string {
  const match = httpUrl.match(/^(https?):\/\/([^/]+)/i);
  if (!match) return httpUrl;
  const [, protocol, host] = match;
  const wsProtocol = protocol.toLowerCase() === 'https' ? 'wss' : 'ws';
  return `${wsProtocol}://${host}`;
}

const WS_URL = `${toWsOrigin(HTTP_BASE_URL)}/ws/channels`;

// ── Types ───────────────────────────────────────────────────────────────────
export interface ChannelSyncOptions {
  group?: string;
  search?: string;
  epg?: boolean;
  batchSize?: number;
  /** Size of the first batch only — sized to roughly one screenful so first paint is near-instant. */
  firstBatchSize?: number;
}

export interface ChannelSyncHandlers {
  /** Fired once, right after connecting, with the total channel count. */
  onMeta?: (total: number, totalBatches: number) => void;
  /** Fired for every batch as it streams in — use this for progressive rendering. */
  onBatch?: (data: any[], sentCount: number, total: number) => void;
}

function buildQuery(options: ChannelSyncOptions): string {
  // Avoid URLSearchParams — React Native's polyfill/typings for it are
  // inconsistent across versions (e.g. missing `.set()`), same reason
  // toWsOrigin() avoids the `URL` global above.
  const parts: string[] = [];
  if (options.group)          parts.push(`group=${encodeURIComponent(options.group)}`);
  if (options.search)         parts.push(`search=${encodeURIComponent(options.search)}`);
  if (options.epg)            parts.push('epg=true');
  if (options.batchSize)      parts.push(`batchSize=${encodeURIComponent(String(options.batchSize))}`);
  if (options.firstBatchSize) parts.push(`firstBatchSize=${encodeURIComponent(String(options.firstBatchSize))}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

/**
 * Streams the channel list over WebSocket instead of one big HTTP response.
 * Resolves with the full flattened array once the server sends `done`
 * (callers that want progressive rendering should use `handlers.onBatch`
 * rather than waiting on the returned promise).
 *
 * Rejects on connect timeout, idle/stall timeout, total timeout, or any
 * server-reported error — callers should catch and fall back to HTTP
 * pagination (see channelApi.ts).
 */
export function syncChannelsOverSocket(
  options: ChannelSyncOptions = {},
  handlers: ChannelSyncHandlers = {},
  signal?: AbortSignal
): Promise<any[]> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Channel sync aborted'));
      return;
    }

    const url = `${WS_URL}${buildQuery(options)}`;
    let ws: WebSocket;

    try {
      ws = new WebSocket(url);
    } catch (err) {
      reject(err instanceof Error ? err : new Error('Failed to open channel socket'));
      return;
    }

    const all: any[] = [];
    let settled = false;
    let idleTimer: ReturnType<typeof setTimeout>;
    let connectTimer: ReturnType<typeof setTimeout>;
    const totalTimer = setTimeout(() => fail(new Error('Channel sync timed out')), TOTAL_TIMEOUT_MS);

    const onAbort = () => fail(new Error('Channel sync aborted'));
    signal?.addEventListener('abort', onAbort, { once: true });

    const cleanup = () => {
      clearTimeout(idleTimer);
      clearTimeout(connectTimer);
      clearTimeout(totalTimer);
      signal?.removeEventListener('abort', onAbort);
    };

    const resetIdle = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(
        () => fail(new Error('Channel sync stalled (no data received)')),
        IDLE_TIMEOUT_MS
      );
    };

    const succeed = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(all);
    };

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      try { ws.close(); } catch {}
      reject(err);
    };

    connectTimer = setTimeout(() => fail(new Error('Channel socket connect timed out')), CONNECT_TIMEOUT_MS);

    ws.onopen = () => {
      clearTimeout(connectTimer);
      resetIdle();
      console.log('[channelSocket] connected');
    };

    ws.onmessage = (event: any) => {
      resetIdle();
      let msg: any;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return; // ignore malformed frames
      }

      switch (msg.type) {
        case 'meta':
          handlers.onMeta?.(msg.total, msg.totalBatches);
          break;
        case 'batch':
          all.push(...(msg.data ?? []));
          handlers.onBatch?.(msg.data ?? [], msg.sentCount, msg.total);
          break;
        case 'done':
          succeed();
          break;
        case 'error':
          fail(new Error(msg.message || 'Server reported a channel sync error'));
          break;
        default:
          break; // forward-compatible: ignore unknown message types
      }
    };

    ws.onerror = () => {
      fail(new Error('Channel socket error'));
    };

    ws.onclose = () => {
      // If we never received 'done', a close is premature -> treat as failure
      if (!settled) fail(new Error('Channel socket closed unexpectedly'));
    };
  });
}