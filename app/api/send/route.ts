import { NextRequest, NextResponse } from 'next/server';
import { getArtistsByGenres, Artist } from '@/lib/roster';
import { renderTemplate, pronounFor } from '@/lib/emailTemplate';
import {
  resolveSmtpConfig, sendMessagesPooled, paginate, dedupeByRecipient,
  DEFAULT_SEND_BATCH_SIZE, OutboundMessage,
} from '@/lib/mailSend';
import { resolveAccount } from '@/lib/accounts';
import { checkCapAllows, recordSends } from '@/lib/sendQuota';
import { getBlacklist } from '@/lib/unsubscribe';

// A batch of DEFAULT_SEND_BATCH_SIZE emails with SMTP retries (up to 2, ~1-2s each)
// and a configurable inter-message sendDelay stacked on top can comfortably exceed
// Vercel's 10s default — this raises the ceiling to 60s, the max the Hobby plan
// allows, rather than risk the function getting killed mid-batch.
export const maxDuration = 60;

interface SendPayload {
  trackTitle: string;
  driveLink: string;
  genres: string[];
  emailTemplate: string;
  subjectTemplate?: string;
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
    const subject = renderTemplate(subjectTemplate, vars);
    // When one manager covers several matched artists they get a single email, and
    // the biggest artist is the one worth leading with.
    return { to: email, subject, body, rank: artist.spotifyFollowers ?? 0 };
  });
}

export async function POST(req: NextRequest) {
  const {
    trackTitle, driveLink, genres, emailTemplate, subjectTemplate, senderName,
    signOff, signOffImage, minAudience, maxAudience, gender, artistType, minInstagram, maxInstagram, matchMode, accountId,
    sendDelay, blacklist, excludeEmails, customContacts, threadIds, offset, limit,
  } = await req.json() as SendPayload;

  const subjectTpl = subjectTemplate?.trim() || `Music Submission: {{trackTitle}} for {{artistName}}`;

  if (!trackTitle || !driveLink || !emailTemplate || (!genres?.length && !customContacts?.length)) {
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

  const artists = genres?.length
    ? getArtistsByGenres(genres, minAudience ?? 0, maxAudience ?? 0, gender ?? '', artistType ?? '', minInstagram ?? 0, maxInstagram ?? 0, matchMode ?? 'any')
    : [];

  const artistMessages = artists.flatMap(a =>
    buildEmailsForArtist(a, trackTitle, driveLink, emailTemplate, subjectTpl, signOff ?? '', senderName)
  );

  const customMessages: OutboundMessage[] = (customContacts ?? []).map(cc => {
    const vars = { managerName: cc.managerName || 'there', artistName: cc.artistName, trackTitle, driveLink, senderName, managementCompany: '', pronoun: 'they' };
    const bodyParts = [renderTemplate(emailTemplate, vars)];
    if (signOff?.trim()) bodyParts.push(renderTemplate(signOff, vars));
    const body = bodyParts.join('\n\n');
    const subject = renderTemplate(subjectTpl, vars);
    return { to: cc.managerEmail, subject, body, rank: CUSTOM_CONTACT_RANK };
  });

  // The client-supplied lists cover session-local exclusions (e.g. "just sent to
  // this address"); the server blacklist is the authoritative Do Not Contact
  // record from unsubscribes, which a stale client tab can't be trusted to know
  // about — union them rather than replacing either.
  const serverBlacklist = await getBlacklist();
  const bl = new Set([...(blacklist ?? []), ...(excludeEmails ?? []), ...serverBlacklist].map(e => e.toLowerCase()));
  const allMessages = dedupeByRecipient(
    [...artistMessages, ...customMessages].filter(msg => !bl.has(msg.to.toLowerCase()))
  ).map(msg => {
    const threadId = threadIds?.[msg.to.toLowerCase()];
    return threadId ? { ...msg, inReplyTo: threadId } : msg;
  });

  const { batch, total, nextOffset } = paginate(allMessages, offset ?? 0, limit ?? DEFAULT_SEND_BATCH_SIZE);

  const capCheck = await checkCapAllows(batch.length, accountId);
  if (!capCheck.ok) return NextResponse.json({ error: capCheck.error }, { status: 429 });

  const results = await sendMessagesPooled(
    { smtpHost, smtpPort, smtpUser, smtpPass },
    batch,
    { fromName, fromEmail: fromEmail as string, signOffImage, sendDelay }
  );

  const sent = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  await recordSends(sent, accountId);

  return NextResponse.json({ sent, failed, total, batchTotal: batch.length, nextOffset, results });
}
