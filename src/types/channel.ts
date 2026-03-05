// src/types/channel.ts

// ─── Channel (app-side model) ─────────────────────────────────────────────────

export interface Channel {
  id:        string;          // always present — mapped from _id or id
  name:      string;
  streamUrl: string;
  number:    number;          // NOT optional — always set (from tvgId or index)
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

  // App-only fields (not in DB, managed locally)
  isFavorite?: boolean;
  isHD?:       boolean;       // derived from name containing "HD"
}

export interface ChannelFilter {
  category?: string;          // maps to 'group' in DB
  language?: string;
  search?:   string;
  country?:  string;
}

// ─── Raw shapes ───────────────────────────────────────────────────────────────

/**
 * Shape returned by the NEW backend (server.js with mapChannel).
 * Fields are already flat strings — no ObjectId wrappers.
 *
 *   { id, name, number, streamUrl, logo, group, language, country }
 */
export interface MappedChannelResponse {
  id:        string;
  name:      string;
  number:    number;
  streamUrl: string;
  logo?:     string;
  group?:    string;
  language?: string | null;
  country?:  string | null;
}

/**
 * Shape coming directly from a raw MongoDB API response (old backend or direct Atlas access).
 * _id may be an ObjectId wrapper object or a plain string depending on the driver.
 */
export interface RawChannelDocument {
  _id?:       { $oid: string } | string;  // old format
  id?:        string;                      // new backend format (already mapped)
  name:       string;
  streamUrl:  string;
  number?:    number;                      // new backend sets this
  tvgId?:     string | null;              // old/raw format — source of channel number
  logo?:      string;
  group?:     string;
  language?:  string | null;
  country?:   string | null;
  sourceUrl?: string | null;
  bandwidth?: string | null;
  codecs?:    string | null;
  resolution?: string | null;
  duration?:   string | null;
  createdAt?:  { $date: string } | string;
  updatedAt?:  { $date: string } | string;
}

// ─── normalizeChannel ─────────────────────────────────────────────────────────

/**
 * Converts either a raw MongoDB document OR an already-mapped backend response
 * into a clean Channel object the app can use.
 *
 * ROOT CAUSE OF THE BUG THIS FIXES:
 *   The updated server.js maps _id → id (plain string) and tvgId → number
 *   before sending the response. The old normalizeChannel() only looked for
 *   raw._id, which was undefined in the new response, making id = undefined,
 *   which React rendered as key={undefined} → ".$undefined" key error →
 *   whole FlatList remounted on every render → VideoPlayer useEffect fired
 *   14 times per channel selection.
 *
 * Fix: check `raw.id` first (new backend), fall back to `raw._id` (old/raw).
 */
export function normalizeChannel(
  raw: RawChannelDocument,
  index: number,
): Channel {

  // ── Resolve id ────────────────────────────────────────────────────────────
  //
  // Priority:
  //   1. raw.id         → new backend already mapped it to a plain string
  //   2. raw._id.$oid   → raw MongoDB ObjectId wrapper (old backend / direct Atlas)
  //   3. raw._id string → raw MongoDB with string _id
  //   4. String(index)  → absolute last resort — guarantees no undefined key
  //
  let id: string;
  if (raw.id) {
    // ✅ New backend format — most common case after server.js update
    id = raw.id;
  } else if (raw._id) {
    // Old/raw MongoDB format
    id = typeof raw._id === 'string'
      ? raw._id
      : (raw._id as { $oid: string }).$oid ?? String(raw._id);
  } else {
    // Should never happen, but never let id be undefined
    console.warn('[normalizeChannel] Channel has no id or _id at index', index, raw);
    id = `generated-${index}`;
  }

  // ── Resolve number ────────────────────────────────────────────────────────
  //
  // Priority:
  //   1. raw.number  → new backend sets this from tvgId (e.g. 303)
  //   2. raw.tvgId   → old/raw format, parse to int
  //   3. index + 1   → position-based fallback
  //
  const number: number =
    raw.number                              ? raw.number                     :
    raw.tvgId && !isNaN(parseInt(raw.tvgId, 10)) ? parseInt(raw.tvgId, 10)  :
    index + 1;

  return {
    id,
    name:      raw.name        ?? 'Unknown Channel',
    streamUrl: raw.streamUrl   ?? '',
    number,
    logo:      raw.logo        || undefined,
    group:     raw.group       || 'Uncategorized',
    language:  raw.language    || undefined,
    country:   raw.country     || undefined,
    tvgId:     raw.tvgId       || undefined,
    sourceUrl: raw.sourceUrl   || undefined,
    bandwidth: raw.bandwidth   || undefined,
    codecs:    raw.codecs      || undefined,
    resolution: raw.resolution || undefined,
    duration:  raw.duration    || undefined,
    isFavorite: false,
    // Derive HD flag from channel name — works for "NDTV HD", "Sony HD", etc.
    isHD: Boolean(raw.name?.toUpperCase().includes('HD')),
  };
}