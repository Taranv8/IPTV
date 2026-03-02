export interface Channel {
  id: string;              // mapped from _id.$oid
  name: string;
  streamUrl: string;       // was 'url'
  logo?: string;
  group: string;           // replaces 'category'
  language?: string | null;
  country?: string | null;
  tvgId?: string | null;
  sourceUrl?: string | null;
  bandwidth?: string | null;
  codecs?: string | null;
  resolution?: string | null;
  duration?: string | null;
  createdAt?: string;
  updatedAt?: string;

  // App-only fields (not in DB, managed locally)
  isFavorite?: boolean;
  isHD?: boolean;          // can be derived from name (e.g. "HD" in name)
  number?: number;         // can be derived from tvgId or index
}

export interface ChannelFilter {
  category?: string;       // maps to 'group' in DB
  language?: string;
  search?: string;
  country?: string;
}

// Raw shape coming directly from MongoDB API response
export interface RawChannelDocument {
  _id: { $oid: string } | string;
  name: string;
  streamUrl: string;
  logo?: string;
  group?: string;
  language?: string | null;
  country?: string | null;
  tvgId?: string | null;
  sourceUrl?: string | null;
  bandwidth?: string | null;
  codecs?: string | null;
  resolution?: string | null;
  duration?: string | null;
  createdAt?: { $date: string } | string;
  updatedAt?: { $date: string } | string;
}

// Utility to normalize raw MongoDB doc → Channel
export function normalizeChannel(raw: RawChannelDocument, index: number): Channel {
const id = typeof raw._id === 'string' 
  ? raw._id 
  : raw._id?.$oid ?? raw._id?.toString() ?? String(raw._id);
  return {
    id,
    name: raw.name,
    streamUrl: raw.streamUrl,
    logo: raw.logo || undefined,
    group: raw.group || 'Uncategorized',
    language: raw.language || undefined,
    country: raw.country || undefined,
    tvgId: raw.tvgId || undefined,
    sourceUrl: raw.sourceUrl || undefined,
    bandwidth: raw.bandwidth || undefined,
    codecs: raw.codecs || undefined,
    resolution: raw.resolution || undefined,
    duration: raw.duration || undefined,
    isFavorite: false,
    isHD: raw.name?.toUpperCase().includes('HD') ?? false,
    number: raw.tvgId ? parseInt(raw.tvgId, 10) : index + 1,
  };
}