// services/ads/AdPrefetchService.ts
//
// Prefetches and validates the VAST ad tag in the background BEFORE the
// settle-check in VideoPlayer.tsx ever decides to trigger an ad. This turns
// "attach tag + remount + hope IMA finds something to play" into "we
// already know there's a fillable ad waiting, so trigger with confidence."
//
// This does NOT let us skip react-native-video/IMA's own native ad
// request — there's no API in this library to hand IMA a pre-parsed VAST
// response, only a URL. What this buys us:
//   1. We never trigger a remount for a tag that turns out to be
//      empty/no-fill (previously: remount → spinner → IMA discovers no ad
//      → silently falls back to content after a wasted spinner cycle).
//   2. The ad server + CDN connection (DNS/TCP/TLS) is warmed by the time
//      IMA makes its own request, which measurably shortens IMA's own
//      fetch on most networks (OS-level connection reuse).
//   3. We can cap how long we're willing to wait — if the prefetch is
//      slow, VideoPlayer.tsx skips the ad for this channel-settle window
//      instead of forcing the user to sit through an unbounded spinner.

import AdService from './AdService';

interface PrefetchResult {
  tagUrl: string;
  hasFill: boolean;
  fetchedAt: number;
}

const PREFETCH_TIMEOUT_MS = 3000;
const PREFETCH_TTL_MS     = 20000; // VAST responses are usually single-use /
                                    // time-boxed by cache-busting macros —
                                    // don't trust a prefetch older than this.

class AdPrefetchServiceImpl {
  private inFlight: Promise<PrefetchResult> | null = null;
  private lastResult: PrefetchResult | null = null;

  /** Kick off (or return the in-flight/cached) prefetch for the current
   *  tag. Safe to call multiple times — de-duped while in flight, and
   *  reused if a fresh-enough result is already cached. */
  prefetch(): Promise<PrefetchResult> {
    const tagUrl = AdService.vastTagUrl;

    if (
      this.lastResult &&
      this.lastResult.tagUrl === tagUrl &&
      Date.now() - this.lastResult.fetchedAt < PREFETCH_TTL_MS
    ) {
      return Promise.resolve(this.lastResult);
    }

    if (this.inFlight) return this.inFlight;

    this.inFlight = this.doFetch(tagUrl).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async doFetch(tagUrl: string): Promise<PrefetchResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PREFETCH_TIMEOUT_MS);

    try {
      const res = await fetch(tagUrl, { signal: controller.signal });
      const xml = await res.text();
      // Cheap fill check — a real VAST parser would walk <Ad>/<InLine|Wrapper>
      // nodes, but for a go/no-go gate this substring check is enough: an
      // empty/no-fill response is a <VAST ...></VAST> with no <Ad> child.
      // If you already have a VAST parser elsewhere in the app, swap this
      // out for that instead of hand-rolling XML inspection here.
      const hasFill = /<Ad[\s>]/i.test(xml);
      const result: PrefetchResult = { tagUrl, hasFill, fetchedAt: Date.now() };
      this.lastResult = result;
      console.log(`[AdPrefetch] tag prefetched — hasFill=${hasFill}`);
      return result;
    } catch (e: any) {
      console.warn('[AdPrefetch] prefetch failed/timed out:', e?.message ?? e);
      const result: PrefetchResult = { tagUrl, hasFill: false, fetchedAt: Date.now() };
      this.lastResult = result;
      return result;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Non-blocking peek at the last known result for the current tag,
   *  without triggering a new fetch. */
  getCached(): PrefetchResult | null {
    const tagUrl = AdService.vastTagUrl;
    if (
      this.lastResult &&
      this.lastResult.tagUrl === tagUrl &&
      Date.now() - this.lastResult.fetchedAt < PREFETCH_TTL_MS
    ) {
      return this.lastResult;
    }
    return null;
  }

  reset() {
    this.lastResult = null;
  }
}

const AdPrefetchService = new AdPrefetchServiceImpl();
export default AdPrefetchService;