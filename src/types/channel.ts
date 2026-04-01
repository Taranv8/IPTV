// src/types/channel.ts

// ─── StreamUrl (one entry in the streamUrls array) ────────────────────────────

export interface StreamUrl {
  url:          string;
  source?:      string;
  logo?:        string;
  group?:       string;
  addedAt?:     string;

  // DRM — only present when the stream is encrypted
  licenseType?: 'clearkey' | 'widevine' | 'playready' | null;
  /** ClearKey format: "kid_hex:key_hex"  e.g. "6f7b...aa:6578...db" */
  licenseKey?:  string | null;
  userAgent?:   string | null;
  httpHeaders?: Record<string, string> | null;
}

// ─── Channel (app-side model) ─────────────────────────────────────────────────

export interface Channel {
  id:        string;
  name:      string;

  /**
   * Active stream URL — resolved from `streamUrls[0]` (or the legacy flat
   * `streamUrl` field on old documents). VideoPlayer uses this directly.
   */
  streamUrl: string;

  /** Full list of available streams — used for source-fallback logic. */
  streamUrls: StreamUrl[];

  number:    number;
  logo?:     string;
  group:     string;
  language?: string | null;
  country?:  string | null;
  tvgId?:    string | null;
  sourceUrl?: string | null;
  bandwidth?: string | null;
  codecs?:    string | null;
  resolution?: string | null;
  duration?:   string | null;
  createdAt?:  string;
  updatedAt?:  string;

  // ── Active stream's DRM / header info ──────────────────────────────────────
  // Populated from the selected StreamUrl entry so VideoPlayer doesn't need
  // to dig into the array itself.
  licenseType?: 'clearkey' | 'widevine' | 'playready' | null;
  licenseKey?:  string | null;   // "kid_hex:key_hex" for clearkey
  userAgent?:   string | null;
  httpHeaders?: Record<string, string> | null;

  // App-only fields (not in DB, managed locally)
  isFavorite?: boolean;
  isHD?:       boolean;
}

export interface ChannelFilter {
  category?: string;
  language?: string;
  search?:   string;
  country?:  string;
}

// ─── Raw shapes ───────────────────────────────────────────────────────────────

/**
 * Shape returned by the NEW backend (server.js).
 * The server may return either the old flat `streamUrl` string
 * OR the new `streamUrls` array — we handle both.
 */
export interface MappedChannelResponse {
  id:          string;
  name:        string;
  number:      number;
  streamUrl?:  string;                // legacy flat field
  streamUrls?: StreamUrl[];           // new array field
  logo?:       string;
  group?:      string;
  language?:   string | null;
  country?:    string | null;
}

/**
 * Raw MongoDB document shape (old backend / direct Atlas access).
 */
export interface RawChannelDocument {
  _id?:        { $oid: string } | string;
  id?:         string;
  name:        string;

  // Stream URL — old flat string OR new array
  streamUrl?:  string;
  streamUrls?: Array<{
    url:          string;
    source?:      string;
    logo?:        string;
    group?:       string;
    licenseType?: string | null;
    licenseKey?:  string | null;
    userAgent?:   string | null;
    httpHeaders?: Record<string, string> | null;
    addedAt?:     { $date: string } | string;
  }>;

  number?:     number;
  epgNo?:      number;
  channelNo?:  number;
  tvgId?:      string | null;
  logo?:       string;
  group?:      string;
  genre?:      string;          // DB may use 'genre' instead of 'group'
  hdSd?:       string;          // "HD" | "SD" — DB flag
  language?:   string | null;
  country?:    string | null;
  sourceUrl?:  string | null;
  bandwidth?:  string | null;
  codecs?:     string | null;
  resolution?: string | null;
  duration?:   string | null;
  createdAt?:  { $date: string } | string;
  updatedAt?:  { $date: string } | string;
}

// ─── normalizeChannel ─────────────────────────────────────────────────────────

/**
 * Converts a raw MongoDB document OR an already-mapped backend response
 * into a clean Channel the app can use.
 *
 * Stream selection strategy (first match wins):
 *   1. streamUrls[0] if the array is present and non-empty  (new format)
 *   2. raw.streamUrl string                                  (legacy format)
 *   3. Empty string with a console warning
 *
 * DRM info (licenseType, licenseKey, userAgent, httpHeaders) is read from
 * the selected StreamUrl entry and promoted to the top-level Channel so
 * VideoPlayer can access it without iterating the array.
 */
export function normalizeChannel(
  raw: RawChannelDocument,
  index: number,
): Channel {

  // ── Resolve id ────────────────────────────────────────────────────────────
  let id: string;
  if (raw.id) {
    id = raw.id;
  } else if (raw._id) {
    id = typeof raw._id === 'string'
      ? raw._id
      : (raw._id as { $oid: string }).$oid ?? String(raw._id);
  } else {
    console.warn('[normalizeChannel] Channel has no id or _id at index', index, raw);
    id = `generated-${index}`;
  }

  // ── Resolve number ────────────────────────────────────────────────────────
  const number: number =
    raw.number                                   ? raw.number                      :
    raw.channelNo                                ? raw.channelNo                   :
    raw.epgNo                                    ? raw.epgNo                       :
    raw.tvgId && !isNaN(parseInt(raw.tvgId, 10)) ? parseInt(raw.tvgId, 10)         :
    index + 1;

  // ── Normalise streamUrls array ────────────────────────────────────────────
  const streamUrls: StreamUrl[] = [];

  if (raw.streamUrls && raw.streamUrls.length > 0) {
    for (const s of raw.streamUrls) {
      if (!s?.url) continue;
      streamUrls.push({
        url:          s.url,
        source:       s.source    || undefined,
        logo:         s.logo      || undefined,
        group:        s.group     || undefined,
        licenseType:  (s.licenseType as StreamUrl['licenseType']) || null,
        licenseKey:   s.licenseKey  || null,
        userAgent:    s.userAgent   || null,
        httpHeaders:  s.httpHeaders || null,
        addedAt:
          s.addedAt
            ? typeof s.addedAt === 'string'
              ? s.addedAt
              : (s.addedAt as { $date: string }).$date
            : undefined,
      });
    }
  }

  // Legacy flat streamUrl → wrap in a minimal StreamUrl so the array is
  // never empty for channels that haven't been migrated yet.
  if (streamUrls.length === 0 && raw.streamUrl) {
    streamUrls.push({ url: raw.streamUrl, source: 'legacy' });
  }

  if (streamUrls.length === 0) {
    console.warn('[normalizeChannel] Channel has no stream URLs at index', index, raw);
  }

  // ── Pick active stream (first entry) ─────────────────────────────────────
  const active = streamUrls[0] ?? null;

  // ── Resolve group / genre ─────────────────────────────────────────────────
  // DB may store category as `genre` (JioTV channels) or `group` (M3U channels).
  const group: string =
    raw.group || raw.genre || active?.group || 'Uncategorized';

  // ── Resolve isHD ─────────────────────────────────────────────────────────
  // Prefer the explicit DB flag (`hdSd`), fall back to name-contains-HD heuristic.
  const isHD: boolean =
    raw.hdSd
      ? raw.hdSd.toUpperCase() === 'HD'
      : Boolean(raw.name?.toUpperCase().includes('HD'));

  return {
    id,
    name:      raw.name      ?? 'Unknown Channel',
    streamUrl: active?.url   ?? '',
    streamUrls,
    number,
    logo:      raw.logo      || active?.logo  || undefined,
    group,
    language:  raw.language  || undefined,
    country:   raw.country   || undefined,
    tvgId:     raw.tvgId     || undefined,
    sourceUrl: raw.sourceUrl || undefined,
    bandwidth: raw.bandwidth || undefined,
    codecs:    raw.codecs    || undefined,
    resolution: raw.resolution || undefined,
    duration:  raw.duration  || undefined,

    // Promote active stream's DRM/header fields to top-level
    licenseType: active?.licenseType ?? null,
    licenseKey:  active?.licenseKey  ?? null,
    userAgent:   active?.userAgent   ?? null,
    httpHeaders: active?.httpHeaders ?? null,

    isFavorite: false,
    isHD,
  };
}