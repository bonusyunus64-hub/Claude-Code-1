// Mirrors the app's localStorage settings (email accounts, templates, presets,
// campaign history, etc.) to a small server-side store, so switching devices
// doesn't mean redoing setup. localStorage stays the fast local cache; every
// write is also pushed to the server, and hydrateFromRemote() reconciles on
// load: keys the server already has win locally (so a second device catches
// up), and keys that only exist locally (set before this device ever synced,
// or before this feature existed) get pushed up so the *other* device can
// pick them up next time it loads.
//
// That last case used to be a straight "server has nothing -> push local up", which
// can't tell "this key has never been synced" (correct to push up) apart from "another
// device deleted this key" (must NOT push the stale local copy back — that would
// silently undo the deletion, e.g. resurrecting a deleted signature image). The server
// now records a tombstone (deletedAt timestamp, see app/api/state/route.ts) whenever a
// key is removed, and hydrateFromRemote() checks that before deciding to push: a
// tombstoned key gets removed locally instead of re-pushed, so whichever happened most
// recently — the delete or the stale local write — the delete wins. Tombstones expire
// after 90 days (see TOMBSTONE_TTL_MS server-side) on the assumption that any device
// that's going to sync a deletion has done so well before then; a device that comes back
// online after a longer gap than that could in theory resurrect an old deletion, which is
// an accepted tradeoff against keeping a deletion log forever.

// tp_email_accounts, tp_sends_today and tp_campaigns intentionally aren't here any
// more: accounts (including passwords) live behind /api/accounts, the send counter
// behind /api/send-quota, and campaign history behind /api/campaigns — all three
// are sources of truth the client reads directly rather than mirroring into this
// generic settings blob.
//
// tp_blacklist isn't here either, for a related but distinct reason: the Do Not Contact
// list moved to its own Redis set (lib/doNotContact.ts) so concurrent unsubscribes can't
// lose one to a read-modify-write race the way this key-value blob would. The dashboard
// reads/writes it through /api/blacklist instead — see useAccountSettings.ts.
const SYNCED_KEYS = [
  'tp_selected_account',
  'tp_sign_off', 'tp_sign_off_image',
  'tp_email_template', 'tp_email_subject',
  'tp_followup_template', 'tp_followup_subject',
  'tp_radio_template', 'tp_radio_subject',
  // No tp_playlist_* keys: the Playlists tab was removed, so nothing reads or
  // writes them any more. Values already in Redis from before the removal are
  // simply left there — harmless, and still present if the tab ever comes back.
  'tp_demos_templates', 'tp_followup_templates', 'tp_radio_templates',
  'tp_demos_presets', 'tp_radio_presets',
  'tp_failed_emails', 'tp_custom_contacts',
  'tp_send_delay', 'tp_daily_cap', 'tp_contact_cooldown_days',
  'tp_auto_followup_enabled', 'tp_auto_followup_days',
  'tp_send_window_enabled', 'tp_send_window_start_hour', 'tp_send_window_end_hour', 'tp_send_window_timezone',
  // Lowercased "campaignId:email" -> the epoch ms it was marked handled, for the
  // Overview tab's cross-campaign replies worklist (collectInterestedReplies in
  // app/dashboard/utils.ts). Keyed by campaign+recipient rather than anything
  // deeper (the classification itself, a message id) so a mark survives that
  // campaign later being re-checked for replies — checkReplies only ever adds to
  // or overwrites `classifications`, it never changes the campaign id or the
  // recipient address a key is built from.
  'tp_handled_replies',
];

export async function hydrateFromRemote(): Promise<void> {
  try {
    const res = await fetch('/api/state');
    if (!res.ok) return;
    const { state, tombstones } = await res.json() as { state: Record<string, string>; tombstones?: Record<string, number> };
    const tomb = tombstones ?? {}; // old server build / cached response without the field — treat as "no known deletions"
    for (const key of SYNCED_KEYS) {
      const remoteValue = state[key];
      if (typeof remoteValue === 'string') {
        localStorage.setItem(key, remoteValue);
      } else if (key in tomb) {
        // Another device deleted this key since we last synced — honour that deletion
        // locally rather than treating "server has nothing" as "never synced" and
        // pushing our now-stale local copy back up.
        localStorage.removeItem(key);
      } else {
        const localValue = localStorage.getItem(key);
        if (localValue !== null) pushToRemote(key, localValue);
      }
    }
  } catch {
    // Offline or sync store unavailable — fall back to whatever's already in localStorage.
  }
}

function pushToRemote(key: string, value: string): void {
  fetch('/api/state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value }),
  }).catch(() => {});
}

function removeFromRemote(key: string): void {
  fetch(`/api/state?key=${encodeURIComponent(key)}`, { method: 'DELETE' }).catch(() => {});
}

// Drop-in replacement for the localStorage.setItem/removeItem calls this app already made —
// same signature, plus a fire-and-forget push to the server.
export const syncStorage = {
  /**
   * localStorage.setItem can throw QuotaExceededError — most commonly today because a
   * signature image (see handleSignOffImageUpload in useAccountSettings.ts) pushed the
   * synced-settings blob over the browser's ~5MB-per-origin quota. Before this guard, that
   * exception propagated straight out of setItem and up through callers that don't wrap
   * their calls in try/catch (saveAll() in app/dashboard/page.tsx is the main one) — the
   * Save button would die on whichever key happened to be too big, silently skipping every
   * key after it in the same function, including the remote push for all of them.
   *
   * The fix treats the local write and the remote push as independent: localStorage is
   * just a fast local cache (hydrateFromRemote() is what lets a second device catch up),
   * so failing to update it is a much smaller problem than failing to reach the server —
   * Upstash has no 5MB ceiling, and the server copy is what every other device/tab
   * reconciles against on load. So a local quota failure is caught and warned about, but
   * never blocks the remote push from being attempted.
   *
   * On reporting the failure: rather than threading a new error-reporting channel through
   * this module's ~20 call sites (most of which don't check a return value today and don't
   * need to), setItem returns a boolean — true when localStorage was actually updated,
   * false when it wasn't. Existing call sites that ignore the return value keep compiling
   * and behaving exactly as before; a call site that cares (saveAll, which surfaces a
   * warning near the Save button) can start checking it. That's the least invasive option
   * that still doesn't let the failure disappear silently.
   */
  setItem(key: string, value: string): boolean {
    let localOk = true;
    try {
      localStorage.setItem(key, value);
    } catch (err) {
      localOk = false;
      console.warn(`syncStorage: localStorage.setItem('${key}') failed — continuing with remote-only save.`, err);
    }
    pushToRemote(key, value);
    return localOk;
  },
  removeItem(key: string): void {
    localStorage.removeItem(key);
    removeFromRemote(key);
  },
};
