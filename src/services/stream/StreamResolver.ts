// services/stream/StreamResolver.ts
//
// LESSON LEARNED from logs:
//
// ranapk.online/JIOBEE/play.php?id=xxx is a JioTV-style middleware endpoint.
// Every HTTP request it receives counts as a "session hit". When we fire
// 4 GET requests (one per UA) trying to resolve the URL, the server sees
// 4 hits before ExoPlayer even connects — then rate-limits the 5th request
// (ExoPlayer's actual stream fetch) with a 500.
//
// The correct behaviour for PHP-wrapper / opaque URLs is to pass them
// DIRECTLY to ExoPlayer without any pre-resolution. ExoPlayer handles
// live HLS natively:
//   • fetches the playlist with our headers
//   • parses the segment list
//   • re-fetches the playlist every #EXT-X-TARGETDURATION seconds
//   • follows token-based segment URLs on its own
//
// We only run the resolver for URLs that genuinely need it:
//   - Short-link redirects (bit.ly, short.gy) where the URL itself is useless
//   - Static file extensions we need to type-detect
//   - HLS master playlists pointing to multiple quality variants
// ─────────────────────────────────────────────────────────────────────────────

import axios from 'axios';

// ─── The one User-Agent ranapk.online accepts ────────────────────────────────
//
// Confirmed from logs: VLC/3.0.18 is the only UA that gets a 200 from this
// server. We use it everywhere — in the resolver AND in ExoPlayer headers.
export const VLC_USER_AGENT = 'VLC/3.0.18 LibVLC/3.0.18';

export const DEFAULT_STREAM_HEADERS = {
  'User-Agent':      VLC_USER_AGENT,
  'Accept':          'application/x-mpegURL, application/vnd.apple.mpegurl, audio/mpegurl, application/dash+xml, video/mp4, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Connection':      'keep-alive',
};

// ─── Types ────────────────────────────────────────────────────────────────────

export type StreamType = 'm3u8' | 'mpd' | 'mp4' | 'ts' | 'flv' | 'mkv' | 'rtmp' | 'rtsp';

export interface ResolvedStream {
  url:       string;
  type:      StreamType;
  userAgent: string;
}

// ─── URL helpers ──────────────────────────────────────────────────────────────

export function detectStreamType(url: string): StreamType | null {
  if (!url) return null;
  if (url.startsWith('rtmp://') || url.startsWith('rtmps://')) return 'rtmp';
  if (url.startsWith('rtsp://'))                                 return 'rtsp';
  const lower = url.toLowerCase().split('?')[0].split('#')[0];
  if (lower.endsWith('.m3u8') || lower.endsWith('.m3u')) return 'm3u8';
  if (lower.endsWith('.mpd'))  return 'mpd';
  if (lower.endsWith('.mp4'))  return 'mp4';
  if (lower.endsWith('.ts'))   return 'ts';
  if (lower.endsWith('.flv'))  return 'flv';
  if (lower.endsWith('.mkv'))  return 'mkv';
  return null;
}

function typeFromContentType(ct: string | undefined): StreamType | null {
  if (!ct) return null;
  const s = ct.toLowerCase();
  if (s.includes('mpegurl') || s.includes('m3u8'))     return 'm3u8';
  if (s.includes('dash+xml') || s.includes('/mpd'))    return 'mpd';
  if (s.includes('/mp4') || s.includes('mpeg4'))       return 'mp4';
  if (s.includes('mp2t')  || s.includes('mpeg2'))      return 'ts';
  if (s.includes('flv'))                                return 'flv';
  if (s.includes('matroska') || s.includes('mkv'))     return 'mkv';
  return null;
}

/**
 * Returns true for PHP/opaque wrapper URLs.
 *
 * These must NOT be pre-fetched by the resolver. Every request to these
 * endpoints is counted by the server. Pre-fetching burns the request budget
 * so ExoPlayer's subsequent connection gets rate-limited (500).
 *
 * ExoPlayer handles these natively — it fetches the URL, gets the HLS
 * playlist back, and manages segment fetching itself.
 */
function isOpaqueWrapper(url: string): boolean {
  const lower = url.toLowerCase();
  return (
    lower.includes('.php')      ||
    lower.includes('/get/')     ||
    lower.includes('/stream/')  ||
    lower.includes('/live/')    ||
    lower.includes('/play/')
  );
}

/**
 * Returns true when a playlist body is a MEDIA playlist (lists .ts segments).
 * We must return the PLAYLIST URL, not extract individual segment lines.
 */
function isHlsMediaPlaylist(body: string): boolean {
  return (
    body.includes('#EXT-X-TARGETDURATION') ||
    body.includes('#EXT-X-MEDIA-SEQUENCE') ||
    body.includes('#EXT-X-ENDLIST')
  );
}

export function getStreamType(url: string): StreamType {
  return detectStreamType(url) ?? 'm3u8';
}

// ─── StreamResolver ───────────────────────────────────────────────────────────

export class StreamResolver {

  /**
   * Resolves a URL to a { url, type, userAgent } that ExoPlayer can play.
   *
   * Decision tree:
   *
   *   rtmp / rtsp              → return as-is (no HTTP possible)
   *   .mp4 / .ts / .flv / .mkv → return as-is (direct file, no playlist)
   *   PHP wrapper / opaque URL → return as-is WITHOUT any pre-fetch
   *                              (pre-fetching causes 500 rate-limit on server)
   *   .m3u8 / .mpd             → quick single HEAD for redirect detection only
   *   unknown non-PHP URL      → single GET to detect type / follow redirect
   */
  static async resolve(url: string): Promise<ResolvedStream> {
    if (!url) {
      console.warn('[StreamResolver] Empty URL');
      return { url: '', type: 'm3u8', userAgent: VLC_USER_AGENT };
    }

    const knownType = detectStreamType(url);

    // ── 1. Direct protocols ───────────────────────────────────────────────────
    if (knownType === 'rtmp' || knownType === 'rtsp') {
      console.log(`[StreamResolver] Direct ${knownType}:`, url);
      return { url, type: knownType, userAgent: VLC_USER_AGENT };
    }

    // ── 2. Non-playlist direct file streams ───────────────────────────────────
    if (knownType && knownType !== 'm3u8' && knownType !== 'mpd') {
      console.log(`[StreamResolver] Direct ${knownType}:`, url);
      return { url, type: knownType, userAgent: VLC_USER_AGENT };
    }

    // ── 3. PHP wrapper / opaque URL → pass directly to ExoPlayer ─────────────
    //
    // DO NOT pre-fetch these. The server counts every request.
    // ExoPlayer + VLC UA will fetch and handle the HLS playlist on its own.
    if (isOpaqueWrapper(url)) {
      console.log('[StreamResolver] Opaque wrapper — passing directly to ExoPlayer:', url);
      return { url, type: 'm3u8', userAgent: VLC_USER_AGENT };
    }

    // ── 4. Known m3u8 / mpd: single HEAD for redirect detection ──────────────
    if (knownType === 'm3u8' || knownType === 'mpd') {
      console.log(`[StreamResolver] Known ${knownType}, checking redirect:`, url);
      try {
        const headResult = await StreamResolver._head(url);
        if (headResult && headResult.url !== url) {
          console.log(`[StreamResolver] ✅ Redirect → ${headResult.type}:`, headResult.url);
          return headResult;
        }
      } catch (e: any) {
        console.log('[StreamResolver] HEAD failed:', e?.message);
      }
      return { url, type: knownType, userAgent: VLC_USER_AGENT };
    }

    // ── 5. Unknown non-PHP URL (e.g. short link): single GET ─────────────────
    console.log('[StreamResolver] Unknown URL — single GET:', url);
    try {
      const result = await StreamResolver._get(url);
      if (result) {
        console.log(`[StreamResolver] ✅ GET → ${result.type}:`, result.url);
        return result;
      }
    } catch (e: any) {
      console.log('[StreamResolver] GET failed:', e?.response?.status ?? e?.message);
    }

    // ── 6. Fallback — let ExoPlayer try the original URL ─────────────────────
    console.warn('[StreamResolver] ⚠️ Falling back to original URL:', url);
    return { url, type: 'm3u8', userAgent: VLC_USER_AGENT };
  }

  // ─── HEAD (redirect detection only) ──────────────────────────────────────

  private static async _head(url: string): Promise<ResolvedStream | null> {
    const res = await axios.head(url, {
      maxRedirects: 10,
      timeout: 8_000,
      headers: DEFAULT_STREAM_HEADERS,
      validateStatus: s => s < 500,
    });

    const finalUrl: string =
      (res.request as any)?.responseURL ||
      (res.config  as any)?.url         ||
      res.headers?.location             || '';

    const resolvedUrl = (finalUrl && finalUrl !== url) ? finalUrl : url;
    const ctType      = typeFromContentType(res.headers?.['content-type']);

    if (ctType)                           return { url: resolvedUrl, type: ctType,  userAgent: VLC_USER_AGENT };
    if (finalUrl && finalUrl !== url) {
      const ext = detectStreamType(finalUrl);
      if (ext)                            return { url: finalUrl,    type: ext,     userAgent: VLC_USER_AGENT };
    }
    return null;
  }

  // ─── GET (type detection + playlist parsing for non-PHP URLs only) ────────

  private static async _get(url: string): Promise<ResolvedStream | null> {
    const res = await axios.get(url, {
      maxRedirects: 10,
      timeout: 12_000,
      headers: DEFAULT_STREAM_HEADERS,
      responseType: 'text',
      maxContentLength: 1024 * 200,
      validateStatus: s => s >= 200 && s < 300,
    });

    const body: string  = typeof res.data === 'string' ? res.data.trim() : '';
    const finalUrl: string =
      (res.request as any)?.responseURL ||
      (res.config  as any)?.url         || '';

    console.log('[StreamResolver] GET', res.status, finalUrl || url);
    console.log('[StreamResolver] GET body[:200]:', body.substring(0, 200));

    const ctType = typeFromContentType(res.headers?.['content-type']);

    // Redirect landed on a direct stream URL
    if (finalUrl && finalUrl !== url) {
      const ext = detectStreamType(finalUrl) ?? ctType;
      if (ext) return { url: finalUrl, type: ext, userAgent: VLC_USER_AGENT };
    }

    // Body is a plain URL on one line
    if (body.startsWith('http') && !body.includes('\n') && !body.includes('<')) {
      const type = detectStreamType(body) ?? ctType ?? 'm3u8';
      return { url: body, type, userAgent: VLC_USER_AGENT };
    }

    // HLS MEDIA playlist → return the playlist URL itself, never extract segments
    if (isHlsMediaPlaylist(body)) {
      console.log('[StreamResolver] HLS media playlist — returning playlist URL');
      return { url, type: 'm3u8', userAgent: VLC_USER_AGENT };
    }

    // HLS MASTER playlist → pick highest bandwidth variant
    if (body.includes('#EXT-X-STREAM-INF')) {
      const extracted = StreamResolver._parseMasterPlaylist(body, finalUrl || url);
      if (extracted) return { ...extracted, userAgent: VLC_USER_AGENT };
    }

    // MPEG-DASH MPD
    if (body.includes('<MPD') || body.includes('urn:mpeg:dash')) {
      const extracted = StreamResolver._parseMpd(body, finalUrl || url);
      if (extracted) return { ...extracted, userAgent: VLC_USER_AGENT };
    }

    // Plain M3U channel list
    if (body.startsWith('#EXTM3U') && !isHlsMediaPlaylist(body)) {
      const extracted = StreamResolver._parsePlainM3u(body, finalUrl || url);
      if (extracted) return { ...extracted, userAgent: VLC_USER_AGENT };
    }

    if (ctType) return { url: finalUrl || url, type: ctType, userAgent: VLC_USER_AGENT };

    return null;
  }

  // ─── Playlist parsers ─────────────────────────────────────────────────────

  private static _parseMasterPlaylist(
    body: string, baseUrl: string,
  ): Omit<ResolvedStream, 'userAgent'> | null {
    const lines    = body.split('\n').map(l => l.trim());
    const variants: { bw: number; url: string }[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].startsWith('#EXT-X-STREAM-INF')) continue;
      const bwM = lines[i].match(/BANDWIDTH=(\d+)/i);
      const bw  = bwM ? parseInt(bwM[1], 10) : 0;
      const nxt = lines.slice(i + 1).find(l => l && !l.startsWith('#'));
      if (!nxt || nxt.startsWith('?')) continue;
      const varUrl = nxt.startsWith('http') ? nxt : new URL(nxt, baseUrl).toString();
      variants.push({ bw, url: varUrl });
    }
    if (variants.length === 0) return null;
    variants.sort((a, b) => b.bw - a.bw);
    console.log(`[StreamResolver] Master: ${variants[0].bw}bps from ${variants.length} variants`);
    return { url: variants[0].url, type: 'm3u8' };
  }

  private static _parseMpd(
    body: string, baseUrl: string,
  ): Omit<ResolvedStream, 'userAgent'> | null {
    const m = body.match(/<BaseURL[^>]*>([^<]+)<\/BaseURL>/);
    if (m) {
      const raw = m[1].trim();
      return { url: raw.startsWith('http') ? raw : new URL(raw, baseUrl).toString(), type: 'mpd' };
    }
    return { url: baseUrl, type: 'mpd' };
  }

  private static _parsePlainM3u(
    body: string, baseUrl: string,
  ): Omit<ResolvedStream, 'userAgent'> | null {
    for (const line of body.split('\n').map(l => l.trim()).filter(Boolean)) {
      if (line.startsWith('#') || line.startsWith('?')) continue;
      if (line.startsWith('http://') || line.startsWith('https://') ||
          line.startsWith('rtmp://')  || line.startsWith('rtsp://')) {
        return { url: line, type: detectStreamType(line) ?? 'm3u8' };
      }
      try {
        const resolved = new URL(line, baseUrl).toString();
        return { url: resolved, type: detectStreamType(resolved) ?? 'm3u8' };
      } catch {}
    }
    return null;
  }
}