// src/services/stream/StreamResolver.ts
//
// FIXES APPLIED:
//
// 1. parseClearKeyString now detects URL-based licenseKeys
//    (e.g. "https://keys.lrl45.workers.dev/key/1106") and returns a
//    ClearKeyDRM with licenseServer instead of trying to hex-parse them.
//    Previously this returned null → DRM was silently dropped → ExoPlayer
//    tried to play encrypted content without keys → crash or black screen.
//
// 2. ClearKeyDRM interface extended with optional licenseServer field so
//    both inline (clearkeys map) and URL-based (licenseServer) variants
//    are represented in the same type.
//
// 3. All async paths wrapped in try/catch so a bad source never throws
//    an unhandled rejection to the caller.
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

// ─── Source cycling ───────────────────────────────────────────────────────────
export const MAX_RETRIES_PER_SOURCE = 3;

// ─── Types ────────────────────────────────────────────────────────────────────

export type StreamType = 'm3u8' | 'mpd' | 'mp4' | 'ts' | 'flv' | 'mkv' | 'rtmp' | 'rtsp';

/**
 * ClearKey DRM — supports two variants:
 *   a) Inline:  clearkeys map  { [kid_b64url]: key_b64url }
 *   b) Remote:  licenseServer URL (ExoPlayer fetches the key from the endpoint)
 *
 * Exactly one of clearkeys / licenseServer will be present.
 */
export interface ClearKeyDRM {
  type: 'clearkey';
  /** Inline kid → key map (base64url-encoded). Present for hex "kid:key" strings. */
  clearkeys?: Record<string, string>;
  /** Remote key server URL. Present when licenseKey is an https:// URL. */
  licenseServer?: string;
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
  url:          string;
  type:         StreamType;
  userAgent:    string;
  /** Extra HTTP headers to pass to ExoPlayer (e.g. cookie, authorization). */
  httpHeaders?: Record<string, string>;
  /** DRM config — null/undefined means unencrypted stream. */
  drm?:         DRMConfig | null;
}

// ─── ClearKey key parser ──────────────────────────────────────────────────────

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
 * Parses a ClearKey licenseKey string into a DRMConfig.
 *
 * Handles TWO formats:
 *   a) Hex pair:  "6f7b...aa:6578...db"   → inline clearkeys map
 *   b) URL:       "https://keys.example.com/key/123" → licenseServer
 *
 * Returns null when the string is missing, malformed, or contains null literals.
 */
export function parseClearKeyString(licenseKey: string | null | undefined): ClearKeyDRM | null {
  if (!licenseKey) return null;

  const trimmed = licenseKey.trim();

  // Reject literal "null:null" or any half-null
  if (
    trimmed === 'null:null' ||
    trimmed.startsWith('null:') ||
    trimmed.endsWith(':null')
  ) {
    console.warn('[StreamResolver] licenseKey contains null literals — ignoring DRM:', trimmed);
    return null;
  }

  // ── FIX: URL-based license server ─────────────────────────────────────────
  // Keys like "https://keys.lrl45.workers.dev/key/1106" must be passed to
  // ExoPlayer as a licenseServer URL, NOT hex-parsed (they contain ":" in
  // the protocol prefix which would break the hex splitter).
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    console.log('[StreamResolver] ClearKey licenseServer URL:', trimmed);
    return { type: 'clearkey', licenseServer: trimmed };
  }

  // ── Hex pair  "kidHex:keyHex" ──────────────────────────────────────────────
  const colonIdx = trimmed.indexOf(':');
  if (colonIdx <= 0 || colonIdx === trimmed.length - 1) {
    console.warn('[StreamResolver] Malformed ClearKey licenseKey (expected "kid:key" or URL):', licenseKey);
    return null;
  }
  const kidHex = trimmed.slice(0, colonIdx);
  const keyHex = trimmed.slice(colonIdx + 1);

  // Basic sanity: both parts should look like hex strings
  if (!/^[0-9a-fA-F]+$/.test(kidHex) || !/^[0-9a-fA-F]+$/.test(keyHex)) {
    console.warn('[StreamResolver] ClearKey parts are not valid hex — ignoring DRM:', licenseKey);
    return null;
  }

  try {
    return {
      type: 'clearkey',
      clearkeys: { [hexToBase64Url(kidHex)]: hexToBase64Url(keyHex) },
    };
  } catch (e) {
    console.warn('[StreamResolver] ClearKey hex-to-base64url conversion failed:', e);
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
 * Returns true for PHP/opaque wrapper URLs that must NOT be pre-fetched.
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
   * Resolves a StreamUrl (or a plain URL string) to a ResolvedStream.
   * Never throws — always returns a usable (possibly fallback) ResolvedStream.
   */
  static async resolve(streamUrlOrString: StreamUrl | string): Promise<ResolvedStream> {
    try {
      return await StreamResolver._resolveInternal(streamUrlOrString);
    } catch (e: any) {
      // Last-resort safety net so VideoPlayer never gets an unhandled rejection.
      const url = typeof streamUrlOrString === 'string'
        ? streamUrlOrString
        : (streamUrlOrString as StreamUrl).url ?? '';
      console.error('[StreamResolver] Unexpected error — falling back to raw URL:', e?.message ?? e);
      return { url, type: getStreamType(url), userAgent: VLC_USER_AGENT };
    }
  }

  private static async _resolveInternal(
    streamUrlOrString: StreamUrl | string,
  ): Promise<ResolvedStream> {

    const streamEntry: StreamUrl =
      typeof streamUrlOrString === 'string'
        ? { url: streamUrlOrString }
        : streamUrlOrString;

    const url = streamEntry.url ?? '';

    if (!url) {
      console.warn('[StreamResolver] Empty URL — returning empty stream');
      return { url: '', type: 'm3u8', userAgent: VLC_USER_AGENT };
    }

    // ── Effective User-Agent ──────────────────────────────────────────────────
    const rawUA   = streamEntry.userAgent ?? '';
    const stripped = rawUA.startsWith('@') ? rawUA.slice(1) : rawUA;
    const looksLikeRealUA =
      stripped.length > 0 &&
      (stripped.includes('/') || stripped.toLowerCase().includes('mozilla'));
    const userAgent = looksLikeRealUA ? stripped : VLC_USER_AGENT;

    // ── Normalise HTTP headers ────────────────────────────────────────────────
    const httpHeaders: Record<string, string> | undefined = (() => {
      const raw = streamEntry.httpHeaders;
      if (!raw || Object.keys(raw).length === 0) return undefined;

      const normalised: Record<string, string> = {};
      for (const [k, v] of Object.entries(raw)) {
        if (k.toLowerCase() === 'user-agent') continue; // handled separately
        const normKey = k.toLowerCase() === 'cookie' ? 'Cookie' : k;
        normalised[normKey] = v;
      }
      return Object.keys(normalised).length > 0 ? normalised : undefined;
    })();

    // ── Parse DRM config ──────────────────────────────────────────────────────
    let drm: DRMConfig | null = null;

    if (streamEntry.licenseType) {
      const lk = streamEntry.licenseKey;

      switch (streamEntry.licenseType) {
        case 'clearkey': {
          if (lk && lk !== 'null:null' && !lk.startsWith('null:') && !lk.endsWith(':null')) {
            const parsed = parseClearKeyString(lk);
            if (parsed) {
              drm = parsed;
              console.log(
                '[StreamResolver] ClearKey DRM:',
                parsed.licenseServer
                  ? `licenseServer=${parsed.licenseServer}`
                  : `inline keys (${Object.keys(parsed.clearkeys ?? {}).length} kid/key pairs)`,
              );
            } else {
              console.warn('[StreamResolver] ClearKey parse returned null — playing without DRM:', url);
            }
          } else {
            console.warn('[StreamResolver] ClearKey licenseKey is null/missing — playing without DRM:', url);
          }
          break;
        }

        case 'widevine':
        case 'playready':
          if (lk) {
            drm = { type: streamEntry.licenseType, licenseServer: lk, headers: httpHeaders };
            console.log(`[StreamResolver] ${streamEntry.licenseType.toUpperCase()} DRM: licenseServer=${lk}`);
          } else {
            console.warn('[StreamResolver] DRM stream missing licenseKey (license server URL):', url);
          }
          break;

        default:
          console.warn('[StreamResolver] Unknown licenseType:', streamEntry.licenseType, '— playing without DRM');
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
    if (isOpaqueWrapper(url)) {
      console.log('[StreamResolver] Opaque wrapper — passing directly to ExoPlayer:', url);
      return { url, type: 'm3u8', userAgent, httpHeaders, drm };
    }

    // ── 4. Known m3u8 / mpd ───────────────────────────────────────────────────
    if (knownType === 'm3u8' || knownType === 'mpd') {
      const cookieValue = httpHeaders?.['Cookie'] ?? '';
      const hasSignedToken =
        url.includes('__hdnea__') ||
        url.includes('__token__') ||
        url.includes('hdntl=')    ||
        url.includes('hmac=')     ||
        cookieValue.includes('__hdnea__') ||
        cookieValue.includes('hdntl=')    ||
        cookieValue.includes('hmac=');

      if (hasSignedToken) {
        console.log(`[StreamResolver] Signed-token ${knownType} — skipping HEAD:`, url);
        return { url, type: knownType, userAgent, httpHeaders, drm };
      }

      console.log(`[StreamResolver] Known ${knownType}, checking redirect:`, url);
      try {
        const headResult = await StreamResolver._head(url, userAgent, httpHeaders);
        if (headResult && headResult.url !== url) {
          console.log(`[StreamResolver] ✅ Redirect → ${headResult.type}:`, headResult.url);
          return { ...headResult, userAgent, httpHeaders, drm };
        }
      } catch (e: any) {
        console.log('[StreamResolver] HEAD failed (non-fatal):', e?.message);
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
      console.log('[StreamResolver] GET failed (non-fatal):', e?.response?.status ?? e?.message);
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

    if (ctType)                         return { url: resolvedUrl, type: ctType, userAgent };
    if (finalUrl && finalUrl !== url) {
      const ext = detectStreamType(finalUrl);
      if (ext)                          return { url: finalUrl,    type: ext,    userAgent };
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

    const body: string = typeof res.data === 'string' ? res.data.trim() : '';
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
      try {
        const varUrl = nxt.startsWith('http') ? nxt : new URL(nxt, baseUrl).toString();
        variants.push({ bw, url: varUrl });
      } catch {}
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
      try {
        return { url: raw.startsWith('http') ? raw : new URL(raw, baseUrl).toString(), type: 'mpd' };
      } catch {}
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