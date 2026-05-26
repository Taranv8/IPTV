import { APP_CONFIG } from '../../constants/config';

const BASE_URL = APP_CONFIG.API_BASE_URL;
const PAGE_SIZE       = 100;
const TOTAL_TIMEOUT_MS = 60_000;
const PAGE_TIMEOUT_MS  = 15_000;
const BATCH            = 3;
const BATCH_DELAY_MS   = 200;

async function fetchPage(page: number, signal: AbortSignal): Promise<{ data: any[]; total: number }> {
  const pageController = new AbortController();
  const pageTimeout    = setTimeout(() => pageController.abort(), PAGE_TIMEOUT_MS);
  signal.addEventListener('abort', () => pageController.abort(), { once: true });

  try {
    const res = await fetch(`${BASE_URL}/channels?page=${page}&limit=${PAGE_SIZE}`, {
      method:  'GET',
      headers: { 'Content-Type': 'application/json' },
      signal:  pageController.signal,
    });
    if (!res.ok) throw new Error(`Page ${page}: ${res.status} ${res.statusText}`);
    const json = await res.json();
    return { data: json.data ?? [], total: json.total ?? 0 };
  } finally {
    clearTimeout(pageTimeout);
  }
}

export const apiClient = {
  async findAll(): Promise<any[]> {
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), TOTAL_TIMEOUT_MS);

    try {
      console.log('[apiClient] Fetching page 1…');
      const first      = await fetchPage(1, controller.signal);
      const total      = first.total;
      const totalPages = Math.ceil(total / PAGE_SIZE);
      console.log(`[apiClient] ${total} channels across ${totalPages} pages`);

      if (totalPages <= 1) return first.data;

      const all: any[] = [...first.data];

      for (let start = 2; start <= totalPages; start += BATCH) {
        if (controller.signal.aborted) break;

        const end     = Math.min(start + BATCH - 1, totalPages);
        const pages   = Array.from({ length: end - start + 1 }, (_, i) => start + i);
        const results = await Promise.allSettled(
          pages.map(p => fetchPage(p, controller.signal))
        );

        for (let i = 0; i < results.length; i++) {
          const r = results[i];
          if (r.status === 'fulfilled') {
            all.push(...r.value.data);
          } else {
            console.warn(`[apiClient] Page ${pages[i]} failed (skipping):`, r.reason?.message);
          }
        }

        // Brief pause between batches — avoid hammering the server
if (start + BATCH <= totalPages) {
  await new Promise<void>(resolve =>
    setTimeout(() => resolve(), BATCH_DELAY_MS)
  );
}
      }

      console.log(`[apiClient] Loaded ${all.length} / ${total} channels`);
      return all;

    } finally {
      clearTimeout(timeout);
    }
  },
};