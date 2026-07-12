// services/ads/AdService.ts
//
// Ad-break FREQUENCY + ELIGIBILITY controller.
//
// VAST/VMAP parsing, media-file selection, and tracking-pixel firing are
// handled entirely by react-native-video's built-in Google IMA integration
// (ExoPlayer's IMA extension on Android, the native IMA SDK on iOS).
//
// This file's job is deciding WHEN an ad is allowed to play and WHICH tag
// to request. Every knob here is remote-configurable — see
// remoteConfigService.ts, which calls AdService.configure() after every
// Firebase Remote Config fetch. Nothing in this file is a build-time
// constant; a config push can flip ads off entirely, change the tag URL,
// or retune frequency without an app release.
//
// ── Ad policy (why these knobs exist) ───────────────────────────────────────
//
// Ads only ever fire on a channel change — there is no periodic mid-roll
// timer anymore. Two things keep this from feeling like the worst version
// of YouTube's ad experience:
//
//   1. adsEnabled — a hard remote kill switch. Flip to false and every ad
//      surface goes dark on the next config fetch, no app release needed
//      (useful for an ad-partner outage, or a fill-rate collapse that makes
//      showing ads not worth the UX cost).
//
//   2. minMinutesBetweenAds / maxAdsPerSession — classic frequency capping:
//      nobody sees back-to-back ads just because they changed channels
//      twice in a row.
//
// VideoPlayer.tsx additionally waits for the viewer to SETTLE on a channel
// (channelSettleDelayMs of stable playback) before ever requesting an ad —
// see the `pendingSettleCheckRef` gate there. That's what makes rapid
// channel-surfing completely ad-free: the ad opportunity only exists once
// someone has actually stopped to watch something. It also means a
// mid-stream error recovery (hard restart) never accidentally counts as
// "a channel switch" and sneaks in a bonus ad.

export interface AdFrequencyConfig {
  /** Remote kill switch. False = no ad is ever requested, anywhere. */
  adsEnabled: boolean;
  /** Whether channel changes are eligible to carry an ad at all. */
  playOnChannelChange: boolean;
  /** Minimum spacing (minutes) between the end of one ad and the start of the next. */
  minMinutesBetweenAds: number;
  /** Hard cap on ads per app session. 0 = unlimited. */
  maxAdsPerSession: number;
  /**
   * How long (ms) a viewer must stay on a channel, with content actually
   * playing, before an ad is allowed to interrupt it. This is what makes
   * channel-surfing ad-free — only someone who stops and watches can ever
   * see one. Setting this to 0 turns the guard off (ad becomes a strict
   * pre-roll attached before the very first frame of every channel change —
   * not recommended; see the comment in VideoPlayer.tsx).
   */
  channelSettleDelayMs: number;
  /** VAST tag URL, swappable without an app release. */
  vastTagUrl: string;
}

const DEFAULT_FREQUENCY: AdFrequencyConfig = {
  adsEnabled: true,
  playOnChannelChange: true,
  minMinutesBetweenAds: 8,
  maxAdsPerSession: 20,
  channelSettleDelayMs: 1500,
  vastTagUrl: 'https://bid.onclckstr.com/vast?spot_id=6122362',
};

class AdServiceImpl {
  private config: AdFrequencyConfig = { ...DEFAULT_FREQUENCY };

  // Starts at "never" (epoch), not Date.now() — otherwise the very first
  // cooldown check after a cold start fails for an ad that hasn't played
  // yet, silently blocking the first eligible ad for minMinutesBetweenAds.
  private lastAdAt = 0;
  private adsShownThisSession = 0;

  /** Called by remoteConfigService.ts after every RC fetch. Partial merge —
   *  only keys present in the remote payload are overwritten, so a
   *  malformed/partial RC value never resets the rest of the config back
   *  to defaults. */
  configure(partial: Partial<AdFrequencyConfig>) {
    console.log('[AdService] configure:', partial);
    this.config = { ...this.config, ...partial };
  }

  getConfig(): AdFrequencyConfig {
    return { ...this.config };
  }

  get vastTagUrl(): string {
    return this.config.vastTagUrl;
  }

  get channelSettleDelayMs(): number {
    return this.config.channelSettleDelayMs;
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

  /** Should an ad be allowed to interrupt the channel the viewer just
   *  settled on? Called from VideoPlayer.tsx only after channelSettleDelayMs
   *  of stable playback on a genuine channel change — never on the switch
   *  itself, and never on an error-recovery reconnect. */
  shouldPlayOnChannelChange(): boolean {
    console.log('[AdService] shouldPlayOnChannelChange() checking…');

    if (!this.config.adsEnabled) {
      console.log('[AdService] → false (adsEnabled=false — remote kill switch is on)');
      return false;
    }

    const cooldownOk = this.cooldownElapsed();
    const capOk       = this.underSessionCap();
    const result = this.config.playOnChannelChange && cooldownOk && capOk;
    console.log(
      `[AdService] → shouldPlayOnChannelChange = ${result}` +
      ` (playOnChannelChange=${this.config.playOnChannelChange}, cooldownOk=${cooldownOk}, capOk=${capOk})`,
    );
    return result;
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