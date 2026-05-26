// src/services/stream/StreamHealthService.ts
//
// Thin client for the stream-health backend.
//
// What this does
// ──────────────
//  • report()      — fire-and-forget: tells the server a URL succeeded /
//                    errored / stalled.  Never blocks playback.
//  • fetchHealth() — fetches a { [url]: UrlStat } map for a channel.
//                    Called once per channel load, before the first source
//                    is tried.
//  • sort()        — sorts a StreamUrl array so high-score (live) sources
//                    come first and isDead sources sink to the bottom.
//                    Dead sources are NOT removed — they remain as a last
//                    resort if every other source also fails.
// ─────────────────────────────────────────────────────────────────────────────

// Resolve the API base from your env var.
// For Expo: set EXPO_PUBLIC_API_URL=https://your-server.com in .env
// For bare RN: replace with your constant or AsyncStorage-backed config.
import { APP_CONFIG } from '../../constants/config';

const API_BASE = APP_CONFIG.API_BASE_URL.replace(/\/$/, '');

console.log('API_BASE_URL for health:', API_BASE);
// ─── Types ────────────────────────────────────────────────────────────────────

/** Outcome of a single stream attempt — mirrors the backend enum. */
export type StreamOutcome = 'success' | 'error' | 'stall';

/** Health record for one URL, as returned by GET /stream-health. */
export interface UrlStat {
  /** True when attempts ≥ MIN_ATTEMPTS and successes === 0. */
  isDead:    boolean;
  /**
   * 0–100 composite score:
   *   (successes/attempts)×80 − (stalls/attempts)×20 + recency bonus
   * Unknown URLs return 50 (neutral).
   */
  score:     number;
  attempts:  number;
  successes: number;
}

/** Map returned by GET /api/channels/:id/stream-health */
export type HealthMap = Record<string, UrlStat>;

// ─── StreamHealthService ──────────────────────────────────────────────────────

export class StreamHealthService {

  // ── report ──────────────────────────────────────────────────────────────────

  /**
   * Fire-and-forget: notify the server of a stream URL outcome.
   *
   * Never throws or awaits — it must never delay or interrupt playback.
   *
   * @param channelId     Channel._id string
   * @param url           Exact URL that was attempted
   * @param outcome       "success" | "error" | "stall"
   * @param stallDurationMs  Only meaningful for "stall" (default 0)
   */
  static report(
    channelId:      string,
    url:            string,
    outcome:        StreamOutcome,
    stallDurationMs = 0,
  ): void {
    if (!channelId || !url) return;

    fetch(`${API_BASE}/api/channels/${channelId}/stream-report`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ url, outcome, stallDurationMs }),
    }).catch(() => { /* silently ignored — telemetry is non-critical */ });
  }

  // ── fetchHealth ─────────────────────────────────────────────────────────────

  /**
   * Fetch the health map for every known URL of a channel.
   * Times out after 4 s and returns {} on any failure so playback
   * is never blocked waiting for stats.
   */
  static async fetchHealth(channelId: string): Promise<HealthMap> {
    if (!channelId) return {};

    try {
      const controller = new AbortController();
      const timer      = setTimeout(() => controller.abort(), 4_000);

      const res = await fetch(
        `${API_BASE}/api/channels/${channelId}/stream-health`,
        { signal: controller.signal },
      );

      clearTimeout(timer);

      if (!res.ok) return {};
      return (await res.json()) as HealthMap;

    } catch {
      return {};
    }
  }

  // ── sort ─────────────────────────────────────────────────────────────────────

  /**
   * Sort stream URL entries so that:
   *   1. Live / high-score sources come first.
   *   2. Dead sources sink to the bottom (but are NOT removed — last resort).
   *   3. URLs with no recorded stats get a neutral score of 50 and appear
   *      between known-good and known-dead sources.
   *
   * The original array is NOT mutated.
   */
  static sort<T extends { url: string; addedAt?: string | Date | { $date: string } }>(
    urls: T[],
    health: HealthMap,
  ): T[] {
    if (!urls.length) return urls;

    function toMs(v: T['addedAt']): number {
      if (!v) return 0;
      if (v instanceof Date)     return v.getTime();
      if (typeof v === 'string') return new Date(v).getTime() || 0;
      if ('$date' in v)          return new Date((v as { $date: string }).$date).getTime() || 0;
      return 0;
    }

    return [...urls].sort((a, b) => {
      const ha = health[a.url];
      const hb = health[b.url];

      // 1. Dead URLs always lose
      const deadA = ha?.isDead ? 1 : 0;
      const deadB = hb?.isDead ? 1 : 0;
      if (deadA !== deadB) return deadA - deadB;

      // 2. Higher score wins; unknown URLs are neutral (50)
      const scoreA = ha?.score ?? 50;
      const scoreB = hb?.score ?? 50;
      if (scoreB !== scoreA) return scoreB - scoreA;

      // 3. Tiebreaker: most recently added URL wins
      return toMs(b.addedAt) - toMs(a.addedAt);
    });
  }
}