import { NextResponse } from 'next/server';
import { getArtistsByGenres, Artist } from '@/lib/roster';
import { renderTemplate, pronounFor } from '@/lib/emailTemplate';
import {
  resolveSmtpConfig, sendMessagesPooled, paginate, dedupeByRecipient,
  DEFAULT_SEND_BATCH_SIZE, OutboundMessage, subjectTemplateFor,
} from '@/lib/mailSend';
import { resolveAccount } from '@/lib/accounts';
import { checkCapAllows, recordSends } from '@/lib/sendQuota';
import { getBlacklist } from '@/lib/doNotContact';
import { DEFAULT_DEMOS_SUBJECT } from '@/lib/emailDefaults';

export interface DemosSendPayload {
  trackTitle: string;
  driveLink: string;
  genres: string[];
  emailTemplate: string;
  subjectTemplate?: string;
  /**
   * Second subject line for two-variant A/B testing (DemosSection's "Test a
   * second subject line" toggle) — blank/absent means no test is running for
   * this send, which is the exact behavior a payload from before this feature
   * existed already has. See subjectTemplateFor (lib/recipients.ts) for how a
   * recipient is deterministically assigned to one or the other.
   */
  subjectTemplateB?: string;
  senderName: string;
  signOff?: string;
  signOffImage?: string;
  minAudience?: number;
  maxAudience?: number;
  gender?: string;
  artistType?: string;
  minInstagram?: number;
  maxInstagram?: number;
  matchMode?: 'any' | 'all';
  /** Reachability filters — see lib/roster.ts's getArtistsByGenres for the
   *  full doc on both, including why they OR together rather than AND. */
  maxCompanySize?: number;
  freemailOnly?: boolean;
  /**
   * Required (not just non-empty `genres`) before an empty genre selection is
   * allowed to reach the roster at all. Without this, `genres: []` behaves
   * exactly as it always has — zero roster artists — even though
   * getArtistsByGenres itself would now treat an empty array as "no genre
   * constraint." That's deliberate: this is the server-side half of the
   * guard against an accidental unfiltered send (the client-side half is
   * useDemosFlow.ts's confirm() before calling this at all) — a stale or
   * pre-this-feature client payload that sends `genres: []` with no
   * customContacts still gets today's 400, not a 7,230-recipient send.
   */
  matchAllGenres?: boolean;
  accountId?: string;
  sendDelay?: number;
  blacklist?: string[];
  excludeEmails?: string[];
  customContacts?: { artistName: string; managerName: string; managerEmail: string }[];
  /** Lowercased recipient -> Message-ID of the original pitch, set when sending a follow-up. */
  threadIds?: Record<string, string>;
  offset?: number;
  limit?: number;
}

// A manager the user added by hand always outranks whatever the roster suggests,
// so their chosen framing of the pitch is the one that goes out.
const CUSTOM_CONTACT_RANK = Number.MAX_SAFE_INTEGER;

function buildEmailsForArtist(
  artist: Artist,
  trackTitle: string,
  driveLink: string,
  emailTemplate: string,
  subjectTemplate: string,
  subjectTemplateB: string | undefined,
  signOff: string,
  senderName: string
): OutboundMessage[] {
  return artist.managerEmails.map((email, idx) => {
    const managerName = artist.managerNames[idx] || 'there';
    const vars = {
      managerName,
      artistName: artist.name,
      trackTitle,
      driveLink,
      senderName,
      managementCompany: artist.managementCompany,
      pronoun: pronounFor(artist.gender, artist.type),
    };
    const bodyParts = [renderTemplate(emailTemplate, vars)];
    if (signOff?.trim()) bodyParts.push(renderTemplate(signOff, vars));
    const body = bodyParts.join('\n\n');
    const subject = renderTemplate(subjectTemplateFor(email, subjectTemplate, subjectTemplateB), vars);
    // When one manager covers several matched artists they get a single email, and
    // the biggest artist is the one worth leading with.
    return { to: email, subject, body, rank: artist.spotifyFollowers ?? 0 };
  });
}

export async function sendDemos(payload: DemosSendPayload) {
  const {
    trackTitle, driveLink, genres, emailTemplate, subjectTemplate, subjectTemplateB, senderName,
    signOff, signOffImage, minAudience, maxAudience, gender, artistType, minInstagram, maxInstagram, matchMode,
    maxCompanySize, freemailOnly, matchAllGenres, accountId,
    sendDelay, blacklist, excludeEmails, customContacts, threadIds, offset, limit,
  } = payload;

  const subjectTpl = subjectTemplate?.trim() || DEFAULT_DEMOS_SUBJECT;

  // A roster query happens when genres are actually selected, or the caller has
  // explicitly confirmed it wants the unfiltered "every genre" query (see
  // matchAllGenres's doc comment above) — genres: [] alone is NOT enough,
  // exactly so this 400 still fires for the same "nothing to send to" case it
  // always has when a caller (old or new) sends neither.
  const wantsRosterArtists = !!genres?.length || matchAllGenres === true;

  if (!trackTitle || !driveLink || !emailTemplate || (!wantsRosterArtists && !customContacts?.length)) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const { account, error: accountError } = await resolveAccount(accountId);
  if (accountError) return NextResponse.json({ error: accountError }, { status: 400 });

  const { smtpUser, smtpPass, smtpHost, smtpPort, fromName, fromEmail } = resolveSmtpConfig(account ?? undefined, senderName);

  if (!smtpUser || !smtpPass) {
    return NextResponse.json(
      { error: 'No email account configured. Add one in the Email Template tab.' },
      { status: 500 }
    );
  }

  const artists = wantsRosterArtists
    ? getArtistsByGenres({
        genres: genres ?? [], minFollowers: minAudience ?? 0, maxFollowers: maxAudience ?? 0,
        gender: gender ?? '', artistType: artistType ?? '', minInstagram: minInstagram ?? 0, maxInstagram: maxInstagram ?? 0,
        matchMode: matchMode ?? 'any', maxCompanySize: maxCompanySize ?? 0, freemailOnly: !!freemailOnly,
      })
    : [];

  const artistMessages = artists.flatMap(a =>
    buildEmailsForArtist(a, trackTitle, driveLink, emailTemplate, subjectTpl, subjectTemplateB, signOff ?? '', senderName)
  );

  const customMessages: OutboundMessage[] = (customContacts ?? []).map(cc => {
    const vars = { managerName: cc.managerName || 'there', artistName: cc.artistName, trackTitle, driveLink, senderName, managementCompany: '', pronoun: 'they' };
    const bodyParts = [renderTemplate(emailTemplate, vars)];
    if (signOff?.trim()) bodyParts.push(renderTemplate(signOff, vars));
    const body = bodyParts.join('\n\n');
    const subject = renderTemplate(subjectTemplateFor(cc.managerEmail, subjectTpl, subjectTemplateB), vars);
    return { to: cc.managerEmail, subject, body, rank: CUSTOM_CONTACT_RANK };
  });

  // The client-supplied lists cover session-local exclusions (e.g. "just sent to
  // this address"); the server blacklist is the authoritative Do Not Contact
  // record from bounces and hand-added entries, which a stale client tab can't be trusted to know
  // about — union them rather than replacing either.
  const serverBlacklist = await getBlacklist();
  const bl = new Set([...(blacklist ?? []), ...(excludeEmails ?? []), ...serverBlacklist].map(e => e.toLowerCase()));
  const allMessages = dedupeByRecipient(
    [...artistMessages, ...customMessages].filter(msg => !bl.has(msg.to.toLowerCase()))
  ).map(msg => {
    const threadId = threadIds?.[msg.to.toLowerCase()];
    return threadId ? { ...msg, inReplyTo: threadId } : msg;
  });

  const { batch, total, nextOffset: pageNextOffset } = paginate(allMessages, offset ?? 0, limit ?? DEFAULT_SEND_BATCH_SIZE);

  const capCheck = await checkCapAllows(batch.length, accountId);
  if (capCheck.allowed === 0) return NextResponse.json({ error: capCheck.error }, { status: 429 });

  // The cap may allow fewer than the full page (e.g. 5 of a 10-message batch).
  // Trim to what's actually allowed and make sure the untrimmed remainder isn't
  // dropped: since checkCapAllows clamps `allowed` to at most `batch.length`, a
  // partial allowance means there's more of this same page left over, so
  // nextOffset must point past only what actually went out rather than the
  // full page — the client pages by an exclusion set built from `results`
  // (see sendInBatches in app/dashboard/utils.ts), so a `results` entry only
  // for what was actually sent, plus a non-null nextOffset, is what makes the
  // leftover get retried on the next request instead of silently skipped.
  const sendBatch = capCheck.allowed < batch.length ? batch.slice(0, capCheck.allowed) : batch;
  const nextOffset = capCheck.allowed < batch.length ? (offset ?? 0) + sendBatch.length : pageNextOffset;

  const results = await sendMessagesPooled(
    { smtpHost, smtpPort, smtpUser, smtpPass },
    sendBatch,
    { fromName, fromEmail: fromEmail as string, signOffImage, sendDelay }
  );

  const sent = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  await recordSends(sent, accountId);

  return NextResponse.json({ sent, failed, total, batchTotal: sendBatch.length, nextOffset, results });
}
