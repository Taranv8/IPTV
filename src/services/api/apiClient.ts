// src/api/apiClient.ts
//
// Fetches ALL channels with pagination.
// Your API returns max 50 per page but has 4000+ channels.
// Without pagination only the first 50 load.

import { APP_CONFIG } from '../../constants/config';

const BASE_URL  = 'https://iptv-backend-production-9adb.up.railway.app';
const PAGE_SIZE = 100; // ask for max per page

async function fetchPage(page: number, signal: AbortSignal): Promise<{ data: any[]; total: number }> {
  const res = await fetch(`${BASE_URL}/channels?page=${page}&limit=${PAGE_SIZE}`, {
    method:  'GET',
    headers: { 'Content-Type': 'application/json' },
    signal,
  });
  if (!res.ok) throw new Error(`Page ${page}: ${res.status} ${res.statusText}`);
  const json = await res.json();
  return { data: json.data ?? [], total: json.total ?? 0 };
}

export const apiClient = {
  async findAll(): Promise<any[]> {
    const controller = new AbortController();
    // Give plenty of time — loading 4000 channels across many pages takes a while
    const timeout = setTimeout(() => controller.abort(), Math.max(APP_CONFIG.REQUEST_TIMEOUT ?? 15_000, 60_000));

    try {
      console.log('[apiClient] Fetching page 1…');
      const first      = await fetchPage(1, controller.signal);
      const total       = first.total;
      const totalPages  = Math.ceil(total / PAGE_SIZE);
      console.log(`[apiClient] ${total} channels across ${totalPages} pages`);

      if (totalPages <= 1) return first.data;

      const all: any[] = [...first.data];

      // Parallel batches of 5 pages — fast but not hammering the server
      const BATCH = 5;
      for (let start = 2; start <= totalPages; start += BATCH) {
        const end   = Math.min(start + BATCH - 1, totalPages);
        const pages = Array.from({ length: end - start + 1 }, (_, i) => start + i);

        const results = await Promise.allSettled(pages.map(p => fetchPage(p, controller.signal)));

        for (let i = 0; i < results.length; i++) {
          const r = results[i];
          if (r.status === 'fulfilled') {
            all.push(...r.value.data);
          } else {
            console.warn(`[apiClient] Page ${pages[i]} failed (skipping):`, r.reason?.message);
          }
        }
      }

      console.log(`[apiClient] Loaded ${all.length} / ${total} channels`);
      return all;
    } finally {
      clearTimeout(timeout);
    }
  },
};