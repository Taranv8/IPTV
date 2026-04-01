// src/services/stream/StreamResolver.ts
//
// LESSON LEARNED from logs:
//
// ranapk.online/JIOBEE/play.php?id=xxx is a JioTV-style middleware endpoint.
// Every HTTP request it receives counts as a "session hit". When we fire
// multiple GET requests trying to resolve the URL, the server sees them as
// separate hits and rate-limits ExoPlayer's actual stream fetch with a 500.
//
// The correct behaviour for PHP-wrapper / opaque URLs is to pass them
// DIRECTLY to ExoPlayer without any pre-resolution. ExoPlayer handles
// live HLS natively.
//
// DRM NOTE:
// ClearKey streams (.mpd with PSSH) require a drm config on the Video
// component. We pass the parsed DRMConfig through ResolvedStream so
// VideoPlayer can attach it to <Video drm={...}> without re-parsing.
// ─────────────────────────────────────────────────────────────────────────────

import axios from 'axios';
import { StreamUrl } from '../../types/channel';
import { Buffer } from 'buffer';

// ─── The one User-Agent ranapk.online accepts ────────────────────────────────
export const VLC_USER_AGENT = 'VLC/3.0.18 LibVLC/3.0.18';

export const DEFAULT_STREAM_HEADERS = {
  'User-Agent':      VLC_USER_AGENT,
  'Accept':          'application/x-mpegURL, application/vnd.apple.mpegurl, audio/mpegurl, application/dash+xml, video/mp4, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Connection':      'keep-alive',
};

// ─── Types ────────────────────────────────────────────────────────────────────

export type StreamType = 'm3u8' | 'mpd' | 'mp4' | 'ts' | 'flv' | 'mkv' | 'rtmp' | 'rtsp';

/**
 * Parsed ClearKey descriptor ready for react-native-video.
 * keys: Record<kid_base64url, key_base64url>
 */
export interface ClearKeyDRM {
  type: 'clearkey';
  /** Map of base64url(kid) → base64url(key) */
  clearkeys: Record<string, string>;
}

export interface WidevineDRM {
  type: 'widevine';
  licenseServer: string;
  headers?: Record<string, string>;
}

export interface PlayReadyDRM {
  type: 'playready';
  licenseServer: string;
  headers?: Record<string, string>;
}

export type DRMConfig = ClearKeyDRM | WidevineDRM | PlayReadyDRM;

export interface ResolvedStream {
  url:         string;
  type:        StreamType;
  userAgent:   string;
  /** Extra HTTP headers to pass to ExoPlayer (e.g. cookie, authorization). */
  httpHeaders?: Record<string, string>;
  /** DRM config — null/undefined means unencrypted stream. */
  drm?:        DRMConfig | null;
}

// ─── ClearKey key parser ──────────────────────────────────────────────────────

/**
 * Converts a hex string to a base64url-encoded string.
 * Required because react-native-video ClearKey expects base64url kid/key pairs,
 * but the DB stores them as hex ("6f7b...aa:6578...db").
 */
function hexToBase64Url(hex: string): string {
  const bytes: number[] = [];
  for (let i = 0; i + 1 < hex.length; i += 2) {
    bytes.push(parseInt(hex.slice(i, i + 2), 16));
  }
  return Buffer.from(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * Parses a ClearKey string in "kid_hex:key_hex" format into a DRMConfig.
 *
 * Example input: "6f7b7241b2935a909d389fe318e5baaa:65783311644973348f359dc154bb41db"
 *
 * Returns null if the string is malformed (logs a warning).
 */
export function parseClearKeyString(licenseKey: string): ClearKeyDRM | null {
  const parts = licenseKey.trim().split(':');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    console.warn('[StreamResolver] Malformed ClearKey licenseKey:', licenseKey);
    return null;
  }
  const [kidHex, keyHex] = parts;
  try {
    return {
      type: 'clearkey',
      clearkeys: { [hexToBase64Url(kidHex)]: hexToBase64Url(keyHex) },
    };
  } catch (e) {
    console.warn('[StreamResolver] ClearKey parse error:', e);
    return null;
  }
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
 * These must NOT be pre-fetched — every request counts as a session hit.
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
   * Resolves a StreamUrl (or a plain URL string) to a ResolvedStream that
   * VideoPlayer / ExoPlayer can consume directly.
   *
   * DRM handling:
   *   - If the StreamUrl has licenseType === 'clearkey', the licenseKey string
   *     is parsed and returned as a ClearKeyDRM config.
   *   - Widevine / PlayReady are passed through as-is (licenseKey treated as
   *     a license server URL).
   *   - No DRM → drm field is null.
   *
   * Decision tree (URL-level):
   *   rtmp / rtsp              → return as-is
   *   .mp4 / .ts / .flv / .mkv → return as-is
   *   PHP wrapper / opaque URL → return as-is WITHOUT pre-fetch
   *   .m3u8 / .mpd             → single HEAD for redirect detection only
   *   unknown non-PHP URL      → single GET to detect type / follow redirect
   */
  static async resolve(streamUrlOrString: StreamUrl | string): Promise<ResolvedStream> {

    // Normalise input — accept both a plain string (legacy callers) and a
    // full StreamUrl object (new callers that have DRM info).
    const streamEntry: StreamUrl =
      typeof streamUrlOrString === 'string'
        ? { url: streamUrlOrString }
        : streamUrlOrString;

    const url = streamEntry.url ?? '';

    if (!url) {
      console.warn('[StreamResolver] Empty URL');
      return { url: '', type: 'm3u8', userAgent: VLC_USER_AGENT };
    }

    // ── Resolve effective User-Agent ────────────────────────────────────────
    // Stream-level UA (e.g. "@StreamFlex19") > VLC default.
    // Strip leading "@" if present (some IPTV sources prefix UA with "@").
    const rawUA = streamEntry.userAgent ?? '';
    const userAgent = rawUA
      ? rawUA.startsWith('@') ? rawUA.slice(1) : rawUA
      : VLC_USER_AGENT;

    // ── Build extra HTTP headers from the stream entry ───────────────────────
    const httpHeaders: Record<string, string> | undefined =
      streamEntry.httpHeaders && Object.keys(streamEntry.httpHeaders).length > 0
        ? streamEntry.httpHeaders
        : undefined;

    // ── Parse DRM config ─────────────────────────────────────────────────────
    let drm: DRMConfig | null = null;
    if (streamEntry.licenseType) {
      switch (streamEntry.licenseType) {
        case 'clearkey':
          if (streamEntry.licenseKey) {
            drm = parseClearKeyString(streamEntry.licenseKey);
          } else {
            console.warn('[StreamResolver] ClearKey stream missing licenseKey:', url);
          }
          break;

        case 'widevine':
        case 'playready':
          if (streamEntry.licenseKey) {
            drm = {
              type: streamEntry.licenseType,
              licenseServer: streamEntry.licenseKey,
              headers: httpHeaders,
            };
          } else {
            console.warn('[StreamResolver] DRM stream missing licenseKey (license server URL):', url);
          }
          break;

        default:
          console.warn('[StreamResolver] Unknown licenseType:', streamEntry.licenseType);
      }
    }

    const knownType = detectStreamType(url);

    // ── 1. Direct protocols ───────────────────────────────────────────────────
    if (knownType === 'rtmp' || knownType === 'rtsp') {
      console.log(`[StreamResolver] Direct ${knownType}:`, url);
      return { url, type: knownType, userAgent, httpHeaders, drm };
    }

    // ── 2. Non-playlist direct file streams ───────────────────────────────────
    if (knownType && knownType !== 'm3u8' && knownType !== 'mpd') {
      console.log(`[StreamResolver] Direct ${knownType}:`, url);
      return { url, type: knownType, userAgent, httpHeaders, drm };
    }

    // ── 3. PHP wrapper / opaque URL → pass directly to ExoPlayer ─────────────
    // DRM info is still attached — ExoPlayer will use it when decrypting.
    if (isOpaqueWrapper(url)) {
      console.log('[StreamResolver] Opaque wrapper — passing directly to ExoPlayer:', url);
      return { url, type: 'm3u8', userAgent, httpHeaders, drm };
    }

    // ── 4. Known m3u8 / mpd: single HEAD for redirect detection ──────────────
    if (knownType === 'm3u8' || knownType === 'mpd') {
      console.log(`[StreamResolver] Known ${knownType}, checking redirect:`, url);
      try {
        const headResult = await StreamResolver._head(url, userAgent, httpHeaders);
        if (headResult && headResult.url !== url) {
          console.log(`[StreamResolver] ✅ Redirect → ${headResult.type}:`, headResult.url);
          return { ...headResult, userAgent, httpHeaders, drm };
        }
      } catch (e: any) {
        console.log('[StreamResolver] HEAD failed:', e?.message);
      }
      return { url, type: knownType, userAgent, httpHeaders, drm };
    }

    // ── 5. Unknown non-PHP URL: single GET ────────────────────────────────────
    console.log('[StreamResolver] Unknown URL — single GET:', url);
    try {
      const result = await StreamResolver._get(url, userAgent, httpHeaders);
      if (result) {
        console.log(`[StreamResolver] ✅ GET → ${result.type}:`, result.url);
        return { ...result, userAgent, httpHeaders, drm };
      }
    } catch (e: any) {
      console.log('[StreamResolver] GET failed:', e?.response?.status ?? e?.message);
    }

    // ── 6. Fallback ───────────────────────────────────────────────────────────
    console.warn('[StreamResolver] ⚠️ Falling back to original URL:', url);
    return { url, type: 'm3u8', userAgent, httpHeaders, drm };
  }

  // ─── HEAD (redirect detection only) ──────────────────────────────────────

  private static async _head(
    url: string,
    userAgent: string,
    httpHeaders?: Record<string, string>,
  ): Promise<ResolvedStream | null> {
    const res = await axios.head(url, {
      maxRedirects: 10,
      timeout: 8_000,
      headers: { ...DEFAULT_STREAM_HEADERS, 'User-Agent': userAgent, ...httpHeaders },
      validateStatus: s => s < 500,
    });

    const finalUrl: string =
      (res.request as any)?.responseURL ||
      (res.config  as any)?.url         ||
      res.headers?.location             || '';

    const resolvedUrl = (finalUrl && finalUrl !== url) ? finalUrl : url;
    const ctType      = typeFromContentType(res.headers?.['content-type']);

    if (ctType)                           return { url: resolvedUrl, type: ctType,  userAgent };
    if (finalUrl && finalUrl !== url) {
      const ext = detectStreamType(finalUrl);
      if (ext)                            return { url: finalUrl,    type: ext,     userAgent };
    }
    return null;
  }

  // ─── GET (type detection + playlist parsing for non-PHP URLs only) ────────

  private static async _get(
    url: string,
    userAgent: string,
    httpHeaders?: Record<string, string>,
  ): Promise<ResolvedStream | null> {
    const res = await axios.get(url, {
      maxRedirects: 10,
      timeout: 12_000,
      headers: { ...DEFAULT_STREAM_HEADERS, 'User-Agent': userAgent, ...httpHeaders },
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

    if (finalUrl && finalUrl !== url) {
      const ext = detectStreamType(finalUrl) ?? ctType;
      if (ext) return { url: finalUrl, type: ext, userAgent };
    }

    if (body.startsWith('http') && !body.includes('\n') && !body.includes('<')) {
      const type = detectStreamType(body) ?? ctType ?? 'm3u8';
      return { url: body, type, userAgent };
    }

    if (isHlsMediaPlaylist(body)) {
      console.log('[StreamResolver] HLS media playlist — returning playlist URL');
      return { url, type: 'm3u8', userAgent };
    }

    if (body.includes('#EXT-X-STREAM-INF')) {
      const extracted = StreamResolver._parseMasterPlaylist(body, finalUrl || url);
      if (extracted) return { ...extracted, userAgent };
    }

    if (body.includes('<MPD') || body.includes('urn:mpeg:dash')) {
      const extracted = StreamResolver._parseMpd(body, finalUrl || url);
      if (extracted) return { ...extracted, userAgent };
    }

    if (body.startsWith('#EXTM3U') && !isHlsMediaPlaylist(body)) {
      const extracted = StreamResolver._parsePlainM3u(body, finalUrl || url);
      if (extracted) return { ...extracted, userAgent };
    }

    if (ctType) return { url: finalUrl || url, type: ctType, userAgent };

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