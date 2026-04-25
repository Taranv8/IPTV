// src/services/epgService.ts
// ─── EPG Service ─────────────────────────────────────────────────────────────
// Fetches Electronic Program Guide data for channels.
// Replace EPG_API_BASE_URL with your actual EPG API endpoint.
// Expected API format: GET /epg?channels=101,102,103&date=2024-01-15
// ─────────────────────────────────────────────────────────────────────────────

export interface EPGProgram {
  id: string;
  channelId: string;
  title: string;
  description?: string;
  startTime: Date;
  endTime: Date;
  category?: string;
  isLive?: boolean;
  thumbnail?: string;
}

export interface EPGChannel {
  channelId: string;
  programs: EPGProgram[];
}

// ── Replace this with your actual EPG API endpoint ───────────────────────────
const EPG_API_BASE_URL = 'https://your-epg-api.com/api';
// e.g. 'https://epg.example.com/xmltv' or 'http://192.168.1.100:8080/epg'

// Cache TTL: refresh EPG data every 15 minutes
const CACHE_TTL_MS = 15 * 60 * 1000;

interface CacheEntry {
  data: Map<string, EPGChannel>;
  fetchedAt: number;
}

let epgCache: CacheEntry | null = null;

/**
 * Fetch EPG data from your API.
 * Returns a map of channelId → EPGChannel.
 * Falls back to empty programs if the API is unavailable.
 */
export async function fetchEPG(
  channelIds: string[]
): Promise<Map<string, EPGChannel>> {
  // Return cached data if still fresh
  if (epgCache && Date.now() - epgCache.fetchedAt < CACHE_TTL_MS) {
    return epgCache.data;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout

  try {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const ids = channelIds.join(',');
    const url = `${EPG_API_BASE_URL}/epg?channels=${ids}&date=${today}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`EPG API error: ${response.status}`);
    }

    const json = await response.json();
    const result = parseEPGResponse(json);

    epgCache = {
      data: result,
      fetchedAt: Date.now(),
    };

    return result;
  } catch (err: any) {
    clearTimeout(timeoutId);

    if (err?.name === 'AbortError') {
      console.warn('EPG request timed out');
    } else {
      console.warn('EPG fetch failed:', err);
    }

    // API unavailable — return empty map (UI shows "No information")
    const empty = new Map<string, EPGChannel>();
    channelIds.forEach((id) =>
      empty.set(id, { channelId: id, programs: [] })
    );

    return empty;
  }
}

/**
 * Parse the raw API JSON into typed EPGChannel objects.
 * Adjust this function to match your API's actual response shape.
 *
 * Expected shape (example):
 * {
 *   "channels": [
 *     {
 *       "id": "101",
 *       "programs": [
 *         { "id": "p1", "title": "News Hour", "start": "2024-01-15T12:00:00Z", "end": "2024-01-15T13:00:00Z", "category": "News" }
 *       ]
 *     }
 *   ]
 * }
 */
function parseEPGResponse(json: any): Map<string, EPGChannel> {
  const result = new Map<string, EPGChannel>();

  const channels: any[] = json?.channels ?? json?.data ?? [];
  for (const ch of channels) {
    const channelId = String(ch.id ?? ch.channelId ?? '');
    const programs: EPGProgram[] = (ch.programs ?? ch.epg ?? []).map((p: any) => ({
      id: String(p.id ?? Math.random()),
      channelId,
      title: p.title ?? p.name ?? 'Unknown Program',
      description: p.description ?? p.desc ?? '',
      startTime: new Date(p.start ?? p.startTime ?? p.start_time),
      endTime: new Date(p.end ?? p.endTime ?? p.end_time ?? p.stop),
      category: p.category ?? p.genre ?? '',
      isLive: false,
      thumbnail: p.thumbnail ?? p.image ?? '',
    }));

    // Mark currently airing program
    const now = Date.now();
    programs.forEach(prog => {
      prog.isLive = prog.startTime.getTime() <= now && prog.endTime.getTime() >= now;
    });

    result.set(channelId, { channelId, programs });
  }

  return result;
}

/**
 * Get the current + next program for a channel.
 */
export function getCurrentAndNext(
  epgData: Map<string, EPGChannel>,
  channelId: string,
): { current: EPGProgram | null; next: EPGProgram | null } {
  const channel = epgData.get(channelId);
  if (!channel || channel.programs.length === 0) return { current: null, next: null };

  const now = Date.now();
  const sorted = [...channel.programs].sort(
    (a, b) => a.startTime.getTime() - b.startTime.getTime(),
  );

  let currentIdx = -1;
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    if (p.startTime.getTime() <= now && p.endTime.getTime() >= now) {
      currentIdx = i;
      break;
    }
  }

  if (currentIdx === -1) {
    // No current program — find the next upcoming one
    const upcoming = sorted.find(p => p.startTime.getTime() > now);
    return { current: null, next: upcoming ?? null };
  }

  return {
    current: sorted[currentIdx],
    next: sorted[currentIdx + 1] ?? null,
  };
}

/**
 * Get programs for a time window (for the EPG grid).
 */
export function getProgramsInRange(
  epgData: Map<string, EPGChannel>,
  channelId: string,
  from: Date,
  to: Date,
): EPGProgram[] {
  const channel = epgData.get(channelId);
  if (!channel) return [];
  return channel.programs.filter(
    p => p.endTime > from && p.startTime < to,
  );
}

/**
 * Format time as "12:30 PM"
 */
export function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Get progress percentage (0–100) of current program.
 */
export function getProgramProgress(program: EPGProgram): number {
  const now = Date.now();
  const total = program.endTime.getTime() - program.startTime.getTime();
  const elapsed = now - program.startTime.getTime();
  return Math.min(100, Math.max(0, (elapsed / total) * 100));
}