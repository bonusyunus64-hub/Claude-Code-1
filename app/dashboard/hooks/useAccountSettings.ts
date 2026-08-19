'use client';

import { useEffect, useMemo, useState } from 'react';
import { syncStorage } from '@/lib/remoteSync';
import type { EmailAccount, NewAccountForm, DeliverabilityResult, FailedEmailEntry } from '../types';
import { DEFAULT_SIGN_OFF, BLANK_ACCOUNT, DEFAULT_SEND_WINDOW_START_HOUR, DEFAULT_SEND_WINDOW_END_HOUR, DEFAULT_CONTACT_COOLDOWN_DAYS } from '../constants';
import type { SendWindowSettings } from '@/lib/sendWindow';
import { DEFAULT_DAILY_CAP } from '@/lib/sendLimits';

/**
 * Tolerates both the current FailedEmailEntry[] shape and the legacy
 * tp_failed_emails shape (a plain string[], from before permanent/transient
 * failures were distinguished) — so a value already sitting in a user's
 * synced settings from before this change doesn't crash page.tsx's
 * initial-load effect. A bare string becomes a transient entry: the safer
 * default, since wrongly treating an old fluke as a confirmed hard bounce
 * would auto-suppress an address that was never actually confirmed dead.
 */
export function parseFailedEmails(raw: unknown): FailedEmailEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: FailedEmailEntry[] = [];
  for (const entry of raw) {
    if (typeof entry === 'string') {
      out.push({ email: entry, permanent: false });
    } else if (entry && typeof entry === 'object' && typeof (entry as { email?: unknown }).email === 'string') {
      out.push({ email: (entry as { email: string }).email, permanent: !!(entry as { permanent?: unknown }).permanent });
    }
  }
  return out;
}

// --- Signature image upload: bounded size, downscaled client-side ---
//
// The data URL produced here travels a long way: into localStorage (5MB browser
// quota), into Redis via /api/state (see lib/remoteSync.ts), into the body of every
// outbound send request, and into every campaign's persisted pendingSend.payload. An
// unbounded upload — a user reasonably dropping in a full-resolution signature export —
// blows through all four before anyone notices: a ~3MB PNG becomes a ~4MB base64
// string, well past what Upstash accepts in a single write, so a large signature can
// break campaign-history persistence for the whole account, not just the signature.
//
// Signatures render at max-width:600px in the email body (lib/mailSend.ts) and at
// max-h-24 in the settings preview below, so there's no visual benefit to keeping more
// resolution than that. Rather than reject anything over the cap outright, this
// downscales via an offscreen canvas until the encoded result fits.

// ~200KB keeps a single signature well clear of Upstash's per-write limits even after
// JSON/base64 overhead, while leaving headroom for everything else already living in
// the same synced-settings blob (see SYNCED_KEYS in lib/remoteSync.ts) and in each
// campaign's pendingSend.payload.
export const SIGN_OFF_IMAGE_MAX_BYTES = 200 * 1024;

// Comfortably above both render sizes (600px wide in email, ~96px tall in the
// max-h-24 preview) so a downscaled signature still looks sharp at either.
export const SIGN_OFF_IMAGE_MAX_EDGE = 600;

/**
 * Pure: given an image's natural size and a target longest-edge, returns the size to
 * draw it at. Never upscales — a signature already smaller than the cap is left
 * exactly as-is instead of being blown up and softened.
 */
export function fitWithinEdge(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge || longest === 0) return { width, height };
  const scale = maxEdge / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * Pure: the actual byte size of the binary a data URL encodes, as opposed to the
 * string's own length — base64 inflates size by ~4/3, and the `data:image/png;base64,`
 * prefix isn't part of the image at all, so `.length` alone overstates or understates
 * depending on the prefix's length relative to the payload.
 */
export function dataUrlByteSize(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode that image.'));
    img.src = dataUrl;
  });
}

/**
 * Draws `img` at `width`x`height` onto an offscreen canvas and re-encodes as PNG (not
 * JPEG) so a signature with a transparent background stays transparent. Kept as its
 * own function (rather than inlined into the resize loop below) so it can be driven
 * directly in tests via a stubbed Image/canvas, without needing a real image decode.
 */
export function renderScaledPng(img: CanvasImageSource, width: number, height: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not process that image.');
  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL('image/png');
}

// How many times to try a smaller size before giving up — each attempt shrinks the
// target long-edge by 25%, so 6 attempts covers 600px down to well under 100px, far
// past the point any real signature would still need shrinking.
const MAX_DOWNSCALE_ATTEMPTS = 6;
const MIN_EDGE_PX = 40;

/**
 * File -> bounded data URL. Returns the original data URL untouched when it's already
 * under the cap, so a small image isn't needlessly re-encoded and re-compressed.
 * Otherwise decodes it, downscales toward SIGN_OFF_IMAGE_MAX_EDGE, and re-encodes,
 * stepping the target size down further if one pass isn't enough — PNG is lossless,
 * so dimensions are the only lever available here, unlike JPEG's quality knob.
 */
async function buildBoundedSignOffImage(file: File): Promise<string> {
  const original = await readFileAsDataUrl(file);
  if (dataUrlByteSize(original) <= SIGN_OFF_IMAGE_MAX_BYTES) return original;

  const img = await loadImage(original);
  let maxEdge = SIGN_OFF_IMAGE_MAX_EDGE;
  for (let attempt = 0; attempt < MAX_DOWNSCALE_ATTEMPTS && maxEdge >= MIN_EDGE_PX; attempt++) {
    const { width, height } = fitWithinEdge(img.naturalWidth || img.width, img.naturalHeight || img.height, maxEdge);
    const resized = renderScaledPng(img, width, height);
    if (dataUrlByteSize(resized) <= SIGN_OFF_IMAGE_MAX_BYTES) return resized;
    maxEdge = Math.round(maxEdge * 0.75);
  }
  throw new Error('That image is too large to use as a signature even after shrinking. Try a smaller or simpler image.');
}

/**
 * Accounts, sign-off, blacklist, failed-sends, send-pacing settings, and
 * deliverability — everything the Account tab owns, plus the handful of values
 * (signOff/signOffImage, blacklist, sendDelay, dailySendCap, sendsToday,
 * accountCapError, refreshSendsToday, recordFailedEmails, emailAccounts,
 * selectedAccountId) that the Demos/Radio/Playlists send flows and campaign
 * history read as config. Deliberately does NOT own the test-email feature: it
 * needs a sample artist from useDemosFlow's preview list, and useDemosFlow in
 * turn needs signOff/blacklist/etc. from here — putting both in the same hook
 * would make each require the other to exist first. Test email stays a
 * page.tsx-level function instead, the same way page.tsx already keeps
 * addOutsideArtistToContacts alongside customContacts for an analogous reason.
 *
 * Returns fields under the same names app/dashboard/sections/AccountSection.tsx's
 * props already use, so page.tsx can spread `{...account}` at the call site.
 */
export function useAccountSettings() {
  const [emailAccounts, setEmailAccounts] = useState<EmailAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [newAccount, setNewAccount] = useState<NewAccountForm>({ ...BLANK_ACCOUNT });
  const [savingAccount, setSavingAccount] = useState(false);
  const [accountError, setAccountError] = useState('');

  const [signOff, setSignOff] = useState(DEFAULT_SIGN_OFF);
  const [signOffImage, setSignOffImage] = useState<string | null>(null);
  const [signOffImageError, setSignOffImageError] = useState('');

  const [sendDelay, setSendDelay] = useState(0);
  // Defaults to DEFAULT_DAILY_CAP (50), matching lib/sendQuota.ts's getDailyCap
  // default for the same "never set" case — a fresh page load with nothing in
  // localStorage/synced settings yet should show the number the server will
  // actually enforce, not a 0 that reads as "unlimited". page.tsx's initial-load
  // effect (see the `tp_daily_cap` localStorage read) only overrides this when a
  // saved value actually exists, so an explicit "None" (stored `"0"`) still wins
  // once it loads.
  const [dailySendCap, setDailySendCap] = useState(DEFAULT_DAILY_CAP);
  // How many days must pass before the same address is fair game again for a
  // *different* track — a send-pacing setting alongside sendDelay/dailySendCap
  // above, synced the same way (see setContactCooldown below). 0 = off, same
  // convention as dailySendCap; see findCooldownRecipients in utils.ts for how
  // it's actually applied (a warning, never a hard block).
  const [contactCooldownDays, setContactCooldownDays] = useState(DEFAULT_CONTACT_COOLDOWN_DAYS);
  // Names (and localStorage keys, via setAutoFollowUp/setAutoFollowUpDaysValue below)
  // are unchanged from when this drove an automatic daily cron send — that cron is
  // gone. autoFollowUpEnabled now means "show a Needs-follow-up reminder in
  // Overview" and autoFollowUpDays means "how many days to wait before showing
  // one"; nothing is ever sent without a manual button press (see
  // OverviewSection.tsx's NeedsFollowUpPanel / useCampaignHistory's sendFollowUp).
  // Kept as-is rather than renamed since both keys are in remoteSync.ts's
  // SYNCED_KEYS and renaming would break cross-device sync for existing users.
  const [autoFollowUpEnabled, setAutoFollowUpEnabled] = useState(false);
  const [autoFollowUpDays, setAutoFollowUpDays] = useState(5);
  const [sendsToday, setSendsToday] = useState(0);
  const [sendsTodayByAccount, setSendsTodayByAccount] = useState<Record<string, number>>({});

  // Send Window — off by default (nothing changes for an existing user until they
  // opt in). `sendWindowTimezone` starts blank rather than defaulting to the
  // browser's own zone right here: this hook can run its first render during SSR,
  // where `Intl.DateTimeFormat().resolvedOptions().timeZone` would read the
  // *server's* zone and could mismatch what the client renders on hydration.
  // page.tsx's client-only init effect fills in the real browser default (or
  // whatever was previously saved) after mount instead — see its own comment.
  const [sendWindowEnabled, setSendWindowEnabled] = useState(false);
  const [sendWindowStartHour, setSendWindowStartHour] = useState(DEFAULT_SEND_WINDOW_START_HOUR);
  const [sendWindowEndHour, setSendWindowEndHour] = useState(DEFAULT_SEND_WINDOW_END_HOUR);
  const [sendWindowTimezone, setSendWindowTimezone] = useState('');

  const [blacklist, setBlacklist] = useState<string[]>([]);
  const [newBlacklistEmail, setNewBlacklistEmail] = useState('');

  // The Do Not Contact list is authoritative server-side (a Redis set, see
  // lib/doNotContact.ts) rather than synced through the generic settings blob like the
  // rest of this hook's state — see remoteSync.ts's SYNCED_KEYS comment for why. So unlike
  // everything else here, it isn't seeded by page.tsx's initial-load effect (that effect
  // still does a legacy `localStorage.getItem('tp_blacklist')` + setBlacklist() for
  // backward compatibility with tabs open before this change shipped, but that's just a
  // stale snapshot — this fetch is the real load, and being a single request it resolves
  // well before that effect's chain of awaited calls gets to its blacklist line, so it
  // wins the race in practice). Loads once per mount; addToBlacklist/removeFromBlacklist/
  // addFailedToBlacklist below update local state optimistically and push the change
  // through /api/blacklist rather than re-fetching.
  useEffect(() => {
    fetch('/api/blacklist')
      .then(res => (res.ok ? res.json() : Promise.reject()))
      .then((data: { blacklist: string[] }) => setBlacklist(data.blacklist ?? []))
      .catch(() => {}); // offline or KV not configured — start empty rather than throw
  }, []);

  // Emails that bounced/failed on a send — kept separate from the blacklist so they can
  // be reviewed (a failure can be a fluke) rather than silently blocked forever. A
  // `permanent` entry (see FailedEmailEntry/SendResultEntry) is the exception: it's
  // already been auto-added to the blacklist below (see recordFailedEmails) — it
  // stays visible here too, rather than just vanishing into the Do Not Contact list,
  // so the auto-suppression is something the user can see and undo, not silent.
  const [failedEmails, setFailedEmails] = useState<FailedEmailEntry[]>([]);

  const [deliverabilityResult, setDeliverabilityResult] = useState<DeliverabilityResult | null>(null);
  const [deliverabilityLoading, setDeliverabilityLoading] = useState(false);

  // The cap is enforced server-side (see checkCapAllows in the send routes) against a
  // Redis counter, so after any send this just re-reads that counter rather than
  // keeping its own running total — one source of truth, no drift across tabs/devices.
  async function refreshSendsToday() {
    try {
      const res = await fetch('/api/send-quota');
      const data = await res.json();
      setSendsToday(data.count ?? 0);
      setSendsTodayByAccount(data.byAccount ?? {});
    } catch {}
  }

  async function addAccount() {
    if (!newAccount.name || !newAccount.smtpUser || !newAccount.smtpPass) return;
    setSavingAccount(true);
    setAccountError('');
    try {
      const res = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newAccount),
      });
      const data = await res.json();
      if (!res.ok) { setAccountError(data.error || 'Could not save account.'); return; }
      const account = data.account as EmailAccount;
      setEmailAccounts(prev => [...prev, account]);
      setSelectedAccountId(account.id);
      syncStorage.setItem('tp_selected_account', account.id);
      setShowAddAccount(false);
      setNewAccount({ ...BLANK_ACCOUNT });
    } catch {
      setAccountError('Network error. Please try again.');
    } finally {
      setSavingAccount(false);
    }
  }

  async function removeAccount(id: string) {
    const updated = emailAccounts.filter(a => a.id !== id);
    setEmailAccounts(updated);
    if (selectedAccountId === id) {
      const next = updated[0]?.id ?? '';
      setSelectedAccountId(next);
      syncStorage.setItem('tp_selected_account', next);
    }
    await fetch(`/api/accounts?id=${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
  }

  function selectAccount(id: string) {
    setSelectedAccountId(id);
    syncStorage.setItem('tp_selected_account', id);
  }

  async function handleSignOffImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset the input so choosing the same file again after a rejection still fires onChange.
    e.target.value = '';
    if (!file) return;
    setSignOffImageError('');
    if (!file.type.startsWith('image/')) {
      setSignOffImageError('Please choose an image file.');
      return;
    }
    try {
      setSignOffImage(await buildBoundedSignOffImage(file));
    } catch (err) {
      setSignOffImageError(err instanceof Error ? err.message : 'Could not process that image.');
    }
  }

  // Fire-and-forget pushes to /api/blacklist, same idiom as pushToRemote/removeFromRemote
  // in lib/remoteSync.ts: local state is updated optimistically above, so a failed request
  // here (offline, KV down) doesn't block the UI — it just means this device's change
  // hasn't reached the server yet, same tradeoff the rest of this app already makes.
  function pushBlacklistAdd(emails: string[]): void {
    if (!emails.length) return;
    const body = emails.length === 1 ? { email: emails[0] } : { emails };
    fetch('/api/blacklist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => {});
  }

  function pushBlacklistRemove(email: string): void {
    fetch(`/api/blacklist?email=${encodeURIComponent(email)}`, { method: 'DELETE' }).catch(() => {});
  }

  function addToBlacklist() {
    const email = newBlacklistEmail.trim().toLowerCase();
    if (!email || blacklist.includes(email)) return;
    const updated = [...blacklist, email];
    setBlacklist(updated);
    setNewBlacklistEmail('');
    pushBlacklistAdd([email]);
  }

  function removeFromBlacklist(email: string) {
    const updated = blacklist.filter(e => e !== email);
    setBlacklist(updated);
    pushBlacklistRemove(email);
  }

  /** Batched: one /api/blacklist request for the whole list, not one per address. */
  function addFailedToBlacklist(emails: string[]) {
    const lower = emails.map(e => e.toLowerCase());
    const merged = [...new Set([...blacklist, ...lower])];
    setBlacklist(merged);
    pushBlacklistAdd(lower);
  }

  function setDailyCap(value: number) {
    setDailySendCap(value);
    syncStorage.setItem('tp_daily_cap', String(value));
  }

  function setContactCooldown(value: number) {
    setContactCooldownDays(value);
    syncStorage.setItem('tp_contact_cooldown_days', String(value));
  }

  function setAutoFollowUp(enabled: boolean) {
    setAutoFollowUpEnabled(enabled);
    syncStorage.setItem('tp_auto_followup_enabled', String(enabled));
  }

  function setAutoFollowUpDaysValue(days: number) {
    setAutoFollowUpDays(days);
    syncStorage.setItem('tp_auto_followup_days', String(days));
  }

  function setSendWindowEnabledOption(enabled: boolean) {
    setSendWindowEnabled(enabled);
    syncStorage.setItem('tp_send_window_enabled', String(enabled));
  }

  function setSendWindowStartHourOption(hour: number) {
    setSendWindowStartHour(hour);
    syncStorage.setItem('tp_send_window_start_hour', String(hour));
  }

  function setSendWindowEndHourOption(hour: number) {
    setSendWindowEndHour(hour);
    syncStorage.setItem('tp_send_window_end_hour', String(hour));
  }

  function setSendWindowTimezoneOption(timezone: string) {
    setSendWindowTimezone(timezone);
    syncStorage.setItem('tp_send_window_timezone', timezone);
  }

  // Memoized so useDemosFlow/usePromotionChannel's handleSend (which depends on
  // this object) doesn't see a new identity — and re-run whatever effects/
  // useCallbacks key off it — on every unrelated render of this hook.
  // sendWindowTimezone falls back live to the browser's own zone rather than an
  // empty string: page.tsx's init effect normally fills a real value in almost
  // immediately after mount, but a render in the narrow gap before that (or a
  // test harness that never runs it) shouldn't silently disable the window by
  // handing lib/sendWindow.ts a timezone Intl can't resolve.
  const sendWindowSettings: SendWindowSettings = useMemo(() => ({
    enabled: sendWindowEnabled,
    startHour: sendWindowStartHour,
    endHour: sendWindowEndHour,
    timezone: sendWindowTimezone || (typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC'),
  }), [sendWindowEnabled, sendWindowStartHour, sendWindowEndHour, sendWindowTimezone]);

  /**
   * Merges newly-failed addresses into the reviewable list, keyed by lowercased
   * address so the same recipient failing again (a different campaign, a retry)
   * updates one entry instead of piling up duplicates. A permanent failure
   * (SendResultEntry.permanent — an outright SMTP rejection, not a dropped
   * connection) is also pushed straight to the Do Not Contact list: see
   * lib/mailSend.ts's doc comment on `permanent` for why nothing else would
   * ever otherwise learn this address is dead. Once an address is marked
   * permanent it stays permanent even if a later, unrelated transient failure
   * for the same address comes in — a real hard rejection doesn't get less
   * real because something else also timed out once.
   */
  function recordFailedEmails(entries: FailedEmailEntry[]) {
    if (!entries.length) return;
    setFailedEmails(prev => {
      const merged = new Map(prev.map(e => [e.email, e]));
      for (const entry of entries) {
        const email = entry.email.toLowerCase();
        merged.set(email, { email, permanent: entry.permanent || merged.get(email)?.permanent || false });
      }
      const updated = Array.from(merged.values());
      syncStorage.setItem('tp_failed_emails', JSON.stringify(updated));
      return updated;
    });
    const permanentEmails = entries.filter(e => e.permanent).map(e => e.email);
    if (permanentEmails.length) addFailedToBlacklist(permanentEmails);
  }

  function removeFromFailedEmails(email: string) {
    setFailedEmails(prev => {
      const updated = prev.filter(e => e.email !== email);
      syncStorage.setItem('tp_failed_emails', JSON.stringify(updated));
      return updated;
    });
  }

  function moveFailedToDoNotContact(email: string) {
    addFailedToBlacklist([email]);
    removeFromFailedEmails(email);
  }

  /**
   * Client-side mirror of the per-account check in lib/sendQuota.ts's
   * checkCapAllows — lets a send be blocked before any network request instead of
   * only after the server rejects the first batch. The server still enforces this
   * independently, since sendsTodayByAccount here can be stale.
   */
  function accountCapError(accountId: string, additionalSends: number): string | null {
    const account = emailAccounts.find(a => a.id === accountId);
    const cap = account?.dailyCap ?? 0;
    if (cap <= 0) return null;
    const sentSoFar = sendsTodayByAccount[accountId] ?? 0;
    if (sentSoFar + additionalSends <= cap) return null;
    return `This account has reached its daily limit (${sentSoFar}/${cap} sent today). Switch accounts, wait until tomorrow, or raise its limit in Account settings.`;
  }

  async function handleDeliverabilityCheck() {
    const acc = emailAccounts.find(a => a.id === selectedAccountId);
    const emailAddr = acc?.email || acc?.smtpUser;
    if (!emailAddr) return;
    const domain = emailAddr.split('@')[1];
    if (!domain) return;
    setDeliverabilityLoading(true); setDeliverabilityResult(null);
    try {
      const res = await fetch('/api/deliverability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain }),
      });
      const data = await res.json();
      setDeliverabilityResult(data);
    } catch {}
    finally { setDeliverabilityLoading(false); }
  }

  const selectedAccount = emailAccounts.find(a => a.id === selectedAccountId);

  return {
    emailAccounts, setEmailAccounts, selectedAccountId, setSelectedAccountId, selectAccount, removeAccount,
    showAddAccount, setShowAddAccount, newAccount, setNewAccount, addAccount, savingAccount, accountError, setAccountError,

    signOff, setSignOff, signOffImage, setSignOffImage, handleSignOffImageUpload, signOffImageError, setSignOffImageError,

    blacklist, setBlacklist, newBlacklistEmail, setNewBlacklistEmail, addToBlacklist, removeFromBlacklist, addFailedToBlacklist,

    failedEmails, setFailedEmails, moveFailedToDoNotContact, removeFromFailedEmails, recordFailedEmails,

    sendDelay, setSendDelay,
    dailySendCap, setDailySendCap, setDailyCap, sendsToday, setSendsToday, sendsTodayByAccount, setSendsTodayByAccount, refreshSendsToday,
    contactCooldownDays, setContactCooldownDays, setContactCooldown,
    autoFollowUpEnabled, setAutoFollowUpEnabled, setAutoFollowUp, autoFollowUpDays, setAutoFollowUpDays, setAutoFollowUpDaysValue,

    sendWindowEnabled, setSendWindowEnabled, setSendWindowEnabledOption,
    sendWindowStartHour, setSendWindowStartHour, setSendWindowStartHourOption,
    sendWindowEndHour, setSendWindowEndHour, setSendWindowEndHourOption,
    sendWindowTimezone, setSendWindowTimezone, setSendWindowTimezoneOption,
    sendWindowSettings,

    accountCapError,

    selectedAccount, deliverabilityLoading, handleDeliverabilityCheck, deliverabilityResult,
  };
}
