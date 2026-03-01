// services/stream/StreamResolver.ts
import axios from 'axios';

const STREAM_HEADERS = {
  'User-Agent': 'VLC/3.0.18 LibVLC/3.0.18',
  'Accept': 'application/x-mpegURL, application/vnd.apple.mpegurl, audio/mpegurl, application/dash+xml, */*',
};

// ─── Stream Type Detection ────────────────────────────────────────────────────

export type StreamType = 'm3u8' | 'mpd' | 'mp4' | 'ts' | 'flv' | 'mkv';

/**
 * Detects stream type from a URL.
 * Returns null if the URL is not a recognized direct stream (e.g. play.php?id=xxx).
 */
export function detectStreamType(url: string): StreamType | null {
  const lower = url.toLowerCase().split('?')[0]; // strip query params before checking extension

  if (lower.endsWith('.m3u8'))  return 'm3u8';
  if (lower.endsWith('.mpd'))   return 'mpd';   // ← MPEG-DASH (JioTV, etc.)
  if (lower.endsWith('.mp4'))   return 'mp4';
  if (lower.endsWith('.ts'))    return 'ts';
  if (lower.endsWith('.flv'))   return 'flv';
  if (lower.endsWith('.mkv'))   return 'mkv';

  return null; // Unknown — needs resolution or we'll assume HLS
}

/**
 * Returns the stream type to pass to react-native-video's `source.type`.
 * Falls back to 'm3u8' for unrecognized URLs (PHP wrappers, short URLs, etc.)
 * since most IPTV streams are HLS.
 */
export function getStreamType(url: string): StreamType {
  return detectStreamType(url) ?? 'm3u8';
}

// ─── URL Resolution ───────────────────────────────────────────────────────────

export interface ResolvedStream {
  url: string;
  type: StreamType;
}

export class StreamResolver {
  /**
   * Resolves any URL to a directly playable stream URL + its type.
   *
   * Handles:
   * - Direct streams (.m3u8, .mpd, .mp4, etc.)        → returned as-is
   * - Short/redirect URLs (short.gy, bit.ly, etc.)     → followed to final URL
   * - PHP wrapper URLs (play.php?id=xxx)               → GET body parsed
   * - Nested .m3u/.m3u8 playlists                      → first stream URL extracted
   * - MPEG-DASH .mpd streams                           → returned with type 'mpd'
   */
  static async resolve(url: string): Promise<ResolvedStream> {
    const knownType = detectStreamType(url);

    // Already a recognized direct stream — no resolution needed
    if (knownType && knownType !== 'm3u8') {
      // Non-playlist direct stream (mp4, mpd, ts, flv, mkv)
      console.log(`[StreamResolver] Direct ${knownType} stream:`, url);
      return { url, type: knownType };
    }

    if (knownType === 'm3u8') {
      // Could still be a nested playlist — return as-is and let the player handle it
      console.log('[StreamResolver] Direct m3u8 stream:', url);
      return { url, type: 'm3u8' };
    }

    // Unknown URL — needs resolution
    console.log('[StreamResolver] Resolving unknown URL:', url);

    // Strategy 1: HEAD to follow redirects cheaply
    try {
      const result = await this.resolveViaHead(url);
      if (result) {
        console.log(`[StreamResolver] ✅ HEAD resolved → ${result.type}:`, result.url);
        return result;
      }
    } catch (e: any) {
      console.log('[StreamResolver] HEAD failed:', e?.response?.status, e?.code, e?.message);
    }

    // Strategy 2: GET to read the response body
    try {
      const result = await this.resolveViaGet(url);
      if (result) {
        console.log(`[StreamResolver] ✅ GET resolved → ${result.type}:`, result.url);
        return result;
      }
    } catch (e: any) {
      console.log('[StreamResolver] GET failed:', e?.response?.status, e?.code, e?.message);
    }

    // Strategy 3: Fall back to original URL, assume HLS
    console.warn('[StreamResolver] ⚠️ Could not resolve, falling back to original URL:', url);
    return { url, type: 'm3u8' };
  }

  // ─── Private strategies ───────────────────────────────────────────────────

  private static async resolveViaHead(url: string): Promise<ResolvedStream | null> {
    const response = await axios.head(url, {
      maxRedirects: 10,
      timeout: 8000,
      headers: STREAM_HEADERS,
      validateStatus: (s) => s < 500,
    });

    const finalUrl: string =
      (response.request as any)?.responseURL ||
      (response.config as any)?.url ||
      response.headers?.location ||
      '';

    if (!finalUrl || finalUrl === url) return null;

    const type = detectStreamType(finalUrl);
    if (type) return { url: finalUrl, type };

    return null;
  }

  private static async resolveViaGet(url: string): Promise<ResolvedStream | null> {
    const response = await axios.get(url, {
      maxRedirects: 10,
      timeout: 10000,
      headers: STREAM_HEADERS,
      responseType: 'text',
      maxContentLength: 1024 * 200, // 200 KB — enough for any playlist
      validateStatus: (s) => s < 500,
    });

    const body = typeof response.data === 'string' ? response.data.trim() : '';
    const finalUrl: string =
      (response.request as any)?.responseURL ||
      (response.config as any)?.url ||
      '';

    console.log('[StreamResolver] GET status:', response.status);
    console.log('[StreamResolver] GET finalUrl:', finalUrl);
    console.log('[StreamResolver] GET body (first 300):', body.substring(0, 300));

    // ── Case A: Final redirected URL is a known stream type ──────────────────
    if (finalUrl && finalUrl !== url) {
      const type = detectStreamType(finalUrl);
      if (type) return { url: finalUrl, type };
    }

    // ── Case B: Body is a plain URL ──────────────────────────────────────────
    if (body.startsWith('http') && !body.includes('\n') && !body.includes('<')) {
      const type = detectStreamType(body) ?? 'm3u8';
      return { url: body, type };
    }

    // ── Case C: Body is an M3U/M3U8/MPD playlist ─────────────────────────────
    if (
      body.startsWith('#EXTM3U') ||
      body.includes('#EXTINF') ||
      body.includes('#EXT-X-') ||
      body.includes('<?xml') ||           // MPD is XML
      body.includes('<MPD') ||
      body.includes('urn:mpeg:dash')
    ) {
      const extracted = this.extractFromPlaylist(body, finalUrl || url);
      if (extracted) return extracted;
    }

    return null;
  }

  /**
   * Extracts the first playable stream from a playlist body.
   * Supports: M3U, M3U8, MPEG-DASH MPD (XML).
   */
  private static extractFromPlaylist(body: string, baseUrl: string): ResolvedStream | null {
    // MPEG-DASH MPD (XML) — extract first BaseURL or initialization URL
    if (body.includes('<MPD') || body.includes('urn:mpeg:dash')) {
      // Try to find a BaseURL element
      const baseUrlMatch = body.match(/<BaseURL[^>]*>([^<]+)<\/BaseURL>/);
      if (baseUrlMatch) {
        const raw = baseUrlMatch[1].trim();
        const resolved = raw.startsWith('http') ? raw : new URL(raw, baseUrl).toString();
        return { url: resolved, type: 'mpd' };
      }
      // MPD itself is the stream descriptor — play the MPD URL directly
      return { url: baseUrl, type: 'mpd' };
    }

    // M3U / M3U8 — find first non-comment line with a URL
    const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      if (line.startsWith('#')) continue;

      if (
        line.startsWith('http://') || line.startsWith('https://') ||
        line.startsWith('rtmp://') || line.startsWith('rtsp://')
      ) {
        const type = detectStreamType(line) ?? 'm3u8';
        return { url: line, type };
      }

      // Relative URL
      if (line.length > 0 && !line.startsWith('#')) {
        try {
          const resolved = new URL(line, baseUrl).toString();
          const type = detectStreamType(resolved) ?? 'm3u8';
          return { url: resolved, type };
        } catch {}
      }
    }

    return null;
  }
}