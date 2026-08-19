// Blast-radius and pacing ceilings the operator has deliberately chosen for this
// solo, real-mail outreach tool. Both live here (rather than beside sendQuota.ts's
// other logic, or duplicated per send route) so every caller — server routes and
// the dashboard's own pre-checks alike — imports the same number instead of
// re-typing a magic literal that could silently drift out of sync.

/**
 * Hard per-campaign ceiling on how many distinct recipients ONE campaign send may
 * reach, across every outbound channel (Song Demos, Radio, Playlist Curators).
 * Deliberately NOT applied to lib/followUpSend.ts — a follow-up can only re-mail
 * people already contacted within that same campaign, so it can never widen the
 * blast radius, and enforcing this there would break follow-ups on campaigns sent
 * before this cap existed.
 *
 * When the full matched audience exceeds this, the send routes REFUSE the whole
 * campaign outright rather than truncating to the first MAX_CAMPAIGN_RECIPIENTS —
 * truncation would silently decide who gets left out based on whatever sort order
 * happened to be active, which is worse than just telling the operator to narrow
 * their filters. This has to be checked against the FULL recipient total (every
 * page of a paginated send combined), not any single page/batch — a per-request
 * limit wouldn't cap anything at all, since the dashboard just keeps paging with a
 * rising offset until the audience is exhausted (see sendInBatches in
 * app/dashboard/utils.ts).
 */
export const MAX_CAMPAIGN_RECIPIENTS = 25;

/**
 * The daily send cap (lib/sendQuota.ts's getDailyCap) applied when the operator has
 * never touched the setting at all — i.e. `tp_daily_cap` was never written to Redis
 * (null/undefined), as distinct from an explicit stored `"0"`, which is the
 * operator deliberately choosing DAILY_CAP_OPTIONS' "None" (unlimited) and must
 * keep meaning that. A fresh install enforcing nothing by default was too easy to
 * ship a mass-send from by accident, so an install that has never visited Account
 * settings gets this number instead of 0/unlimited.
 */
export const DEFAULT_DAILY_CAP = 50;
