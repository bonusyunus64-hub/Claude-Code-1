import type { SendResultEntry, BatchProgress } from './types';
export { renderTemplate as renderTemplateClient, pronounFor as pronounForClient } from '@/lib/emailTemplate';

/**
 * How many distinct messages a send with these email lists will actually produce.
 * The server dedupes by lowercased address (dedupeByRecipient in lib/mailSend.ts) —
 * one address that shows up under several recipients (a manager covering many
 * artists, a station listing the same inbox on two shows) becomes a single send.
 * Counting raw list lengths client-side overstates the total against the daily cap.
 */
export function countUniqueRecipients(...emailLists: string[][]): number {
  const seen = new Set<string>();
  for (const list of emailLists) {
    for (const email of list) seen.add(email.trim().toLowerCase());
  }
  return seen.size;
}

export function getTodayDateStr(): string {
  return new Date().toISOString().slice(0, 10);
}

// Send routes page through recipients (offset/limit) instead of one long request, so a
// large batch can't hit a serverless function timeout. This loops until the server
// reports no more pages, reporting live progress as each page comes back.
//
// onProgress also receives the cumulative results-so-far (not just counts) so a
// caller can persist campaign history as each batch lands, rather than only after
// the whole send finishes — closing the tab mid-send then loses at most the
// in-flight batch instead of the entire campaign record. It also gets the offset
// the *next* batch would start from (null once the whole list is done), so a
// caller can persist a resume point and pick a paused/interrupted send back up
// later via `startOffset` instead of restarting — and, since payload/endpoint are
// exactly what a caller already has on hand, re-sending nothing that already went out.
export async function sendInBatches(
  endpoint: string,
  payload: Record<string, unknown>,
  onProgress: (progress: BatchProgress, resultsSoFar: SendResultEntry[], nextOffset: number | null) => void,
  startOffset = 0
): Promise<{ ok: true; results: SendResultEntry[]; total: number } | { ok: false; error: string }> {
  let offset = startOffset;
  const allResults: SendResultEntry[] = [];
  let total = 0;
  for (;;) {
    let res: Response;
    let data: { error?: string; results?: SendResultEntry[]; total?: number; nextOffset?: number | null };
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, offset }),
      });
      data = await res.json();
    } catch {
      return { ok: false, error: 'Network error. Please try again.' };
    }
    if (!res.ok) return { ok: false, error: data.error || 'Failed to send.' };
    allResults.push(...(data.results ?? []));
    total = data.total ?? allResults.length;
    const nextOffset = data.nextOffset ?? null;
    onProgress({
      sent: allResults.filter(r => r.success).length,
      failed: allResults.filter(r => !r.success).length,
      total,
    }, allResults, nextOffset);
    if (nextOffset == null) break;
    offset = nextOffset;
  }
  return { ok: true, results: allResults, total };
}

export function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows.map(row => row.map(csvEscape).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function parseContactsCsv(text: string): { artistName: string; managerName: string; managerEmail: string }[] {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const out: { artistName: string; managerName: string; managerEmail: string }[] = [];
  for (const line of lines) {
    const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    if (cols.length < 2) continue;
    const [artistName, managerName, managerEmail] = cols.length >= 3
      ? [cols[0], cols[1], cols[2]]
      : [cols[0], '', cols[1]];
    if (!artistName || !managerEmail || !managerEmail.includes('@')) continue;
    if (artistName.toLowerCase() === 'artist' && managerEmail.toLowerCase().includes('email')) continue;
    out.push({ artistName, managerName, managerEmail });
  }
  return out;
}

/** Uniform shuffle (Fisher-Yates) — Math.random()-based comparator sorts are a well-known non-fix that biases the result. */
export function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Which of `emails` were already pitched the current track under a previous
 * campaign — `pitchedEmailMap` (lowercased email -> track titles it's been sent
 * for) is built once from campaign history, so this is just a lookup per address.
 * Empty `trackTitle` means nothing to compare against yet, so nothing is flagged.
 */
export function findDuplicateRecipients(
  pitchedEmailMap: Map<string, string[]>,
  trackTitle: string,
  emails: string[]
): string[] {
  const title = trackTitle.trim().toLowerCase();
  if (!title) return [];
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const email of emails) {
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const tracks = pitchedEmailMap.get(key) ?? [];
    if (tracks.some(t => t.trim().toLowerCase() === title)) dupes.push(email);
  }
  return dupes;
}

/** Lowercased recipient -> Message-ID, for whichever results actually got one (skips failures). */
export function messageIdsFromResults(results: SendResultEntry[]): Record<string, string> {
  const ids: Record<string, string> = {};
  results.forEach(r => { if (r.success && r.messageId) ids[r.to.toLowerCase()] = r.messageId; });
  return ids;
}

/**
 * Screens a freshly-loaded recipient list for addresses guaranteed to bounce
 * (malformed, or a domain with no usable mail DNS) so they can be flagged before
 * a send ever reaches them. Best-effort: any network/server failure just means no
 * addresses get flagged, not that the caller's preview fails.
 */
export async function checkRecipientsValidity(emails: string[]): Promise<string[]> {
  if (!emails.length) return [];
  try {
    const res = await fetch('/api/mx-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emails }),
    });
    if (!res.ok) return [];
    const data = await res.json() as { malformed: string[]; noMx: string[] };
    return [...data.malformed, ...data.noMx];
  } catch {
    return [];
  }
}
