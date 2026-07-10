// src/services/ads/AdService.ts
//
// Ad-break FREQUENCY controller only.
//
// VAST/VMAP parsing, media-file selection, and tracking-pixel firing are
// GONE from this file. react-native-video's built-in Google IMA integration
// (ExoPlayer's IMA extension on Android, the native IMA SDK on iOS) now owns
// all of that — it fetches the tag, resolves wrapper chains, fires
// impression/quartile/error pixels, and renders its own ad UI.
//
// This file's only remaining job is deciding WHEN an ad break is allowed to
// start. VideoPlayer.tsx is responsible for actually attaching the VAST tag
// to the <Video> element (see the `adTagUrl` state there).
//
// ── Known risk when migrating from the old XML-parsing implementation ──────
// The old `fetchXml()` sent a custom Referer (`https://<spot_id>.bid.onclckstr.com`)
// and a custom User-Agent when requesting this tag. IMA's native fetch of the
// ad tag URL does NOT expose a way to set custom headers from JS. If
// bid.onclckstr.com's fill rate depends on that Referer (common for
// RTB/bidstream exchanges), you may see meaningfully worse fill after
// switching — verify with real device traffic before deleting the old
// XML-parsing code path for good.

export const VAST_AD_TAG_URL = 'https://bid.onclckstr.com/vast?spot_id=6122362';

export interface AdFrequencyConfig {
  minMinutesBetweenAds: number;
  midRollIntervalMinutes: number;
  playOnChannelChange: boolean;
  maxAdsPerSession: number;
}

const DEFAULT_FREQUENCY: AdFrequencyConfig = {
  minMinutesBetweenAds: 8,
  midRollIntervalMinutes: 12,
  playOnChannelChange: true,
  maxAdsPerSession: 20,
};

class AdServiceImpl {
  private config: AdFrequencyConfig = { ...DEFAULT_FREQUENCY };

  // BUG FIX: this used to be `Date.now()`, which starts the "cooldown" the
  // instant the app launches — for an ad that never played. That silently
  // blocked the very first pre-roll for `minMinutesBetweenAds` minutes after
  // every cold start. Starting at 0 (epoch) means "no ad has ever played",
  // so the very first cooldown check always passes.
  private lastAdAt = 0;
  private adsShownThisSession = 0;

  configure(partial: Partial<AdFrequencyConfig>) {
    console.log('[AdService] configure:', partial);
    this.config = { ...this.config, ...partial };
  }

  getConfig(): AdFrequencyConfig {
    return { ...this.config };
  }

  private cooldownElapsed(): boolean {
    const elapsedMs  = Date.now() - this.lastAdAt;
    const requiredMs = this.config.minMinutesBetweenAds * 60_000;
    const result = elapsedMs >= requiredMs;
    console.log(
      `[AdService]   cooldownElapsed? ${result}` +
      ` (elapsed=${(elapsedMs / 1000).toFixed(1)}s, required=${(requiredMs / 1000).toFixed(1)}s,` +
      ` lastAdAt=${this.lastAdAt === 0 ? 'never' : new Date(this.lastAdAt).toISOString()})`,
    );
    return result;
  }

  private underSessionCap(): boolean {
    const result = this.config.maxAdsPerSession === 0 || this.adsShownThisSession < this.config.maxAdsPerSession;
    console.log(
      `[AdService]   underSessionCap? ${result}` +
      ` (shown=${this.adsShownThisSession}, cap=${this.config.maxAdsPerSession})`,
    );
    return result;
  }

  /** Should a pre-roll play the moment a channel change happens? */
  shouldPlayOnChannelChange(): boolean {
    console.log('[AdService] shouldPlayOnChannelChange() checking…');
    const cooldownOk = this.cooldownElapsed();
    const capOk       = this.underSessionCap();
    const result = this.config.playOnChannelChange && cooldownOk && capOk;
    console.log(
      `[AdService] → shouldPlayOnChannelChange = ${result}` +
      ` (playOnChannelChange=${this.config.playOnChannelChange}, cooldownOk=${cooldownOk}, capOk=${capOk})`,
    );
    return result;
  }

  /** Should the mid-roll timer be allowed to fire an ad break right now? */
  canPlayMidRoll(): boolean {
    console.log('[AdService] canPlayMidRoll() checking…');
    const cooldownOk = this.cooldownElapsed();
    const capOk       = this.underSessionCap();
    const result = cooldownOk && capOk;
    console.log(`[AdService] → canPlayMidRoll = ${result} (cooldownOk=${cooldownOk}, capOk=${capOk})`);
    return result;
  }

  midRollIntervalMs(): number {
    return this.config.midRollIntervalMinutes * 60_000;
  }

  /** Call this once IMA signals the ad break has ended (or errored out). */
  markAdShown() {
    this.lastAdAt = Date.now();
    this.adsShownThisSession += 1;
    console.log(
      `[AdService] 🧾 markAdShown — total this session: ${this.adsShownThisSession}` +
      ` (cooldown resets from now)`,
    );
  }
}

const AdService = new AdServiceImpl();
export default AdService;