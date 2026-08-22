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
import { DEFAULT_DEMOS_SUBJECT, DEFAULT_MULTI_ARTIST_SUBJECT } from '@/lib/emailDefaults';
import { MAX_CAMPAIGN_RECIPIENTS } from '@/lib/sendLimits';
import { rankArtistsForPitch, groupArtistsByManagerEmail, buildArtistNameVars, ManagerGroup } from '@/lib/artistFit';

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
  /**
   * Body copy for the "one manager reps several of this campaign's matched
   * artists" case (see lib/artistFit.ts's module comment for the problem this
   * solves). Absent, blank, or whitespace-only is NOT an error — it means the
   * caller hasn't shipped multi-artist copy yet (an old dashboard build, or a
   * follow-up send, which never sends this field at all), so every such group
   * falls back to exactly today's behavior: one email about whichever artist in
   * the group ranks highest (rankArtistsForPitch). This is load-bearing for a
   * stale browser tab left open from before this feature shipped — it must not
   * be able to send multi-artist copy the user has never seen.
   */
  multiArtistTemplate?: string;
  /**
   * Subject for the multi-artist email above. Blank/absent falls back to
   * DEFAULT_MULTI_ARTIST_SUBJECT, the same "blank means use the default" contract
   * subjectTemplate has with DEFAULT_DEMOS_SUBJECT. Unlike subjectTemplate there
   * is no *TemplateB counterpart here — see buildMultiArtistMessage for why an
   * A/B split doesn't apply to this email.
   */
  multiArtistSubject?: string;
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

// Builds the one email a manager address gets when either only one matched
// artist sits behind it, or several do but the caller hasn't supplied
// multi-artist copy (see DemosSendPayload.multiArtistTemplate) — in both cases
// `artist` is whichever one rankArtistsForPitch says leads for this address,
// and `managerName`/`email` come from the ManagerGroup so a name attached to
// one specific managerEmails[i] slot (not just "the artist's name") is used.
function buildSingleArtistMessage(
  artist: Artist,
  managerName: string,
  email: string,
  trackTitle: string,
  driveLink: string,
  emailTemplate: string,
  subjectTemplate: string,
  subjectTemplateB: string | undefined,
  signOff: string,
  senderName: string
): OutboundMessage {
  const vars = {
    managerName: managerName || 'there',
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
  // There's now at most one roster message per address, so this no longer picks
  // a winner between roster messages the way it used to — but CUSTOM_CONTACT_RANK
  // still has to beat it below when a hand-added custom contact collides with a
  // roster manager's address, so the field stays.
  return { to: email, subject, body, rank: artist.spotifyFollowers ?? 0 };
}

// Builds the "several matched artists, one manager" email. Only reached for a
// group of 2+ artists that DID get multi-artist copy (see the fallback branch
// in sendDemos otherwise) — group.artists is rankArtistsForPitch's output, so
// group.artists[0] (buildArtistNameVars' leadArtist) is already the best-fit
// artist for this address, not just the one with the most followers.
function buildMultiArtistMessage(
  group: ManagerGroup<Artist>,
  trackTitle: string,
  driveLink: string,
  multiArtistTemplate: string,
  multiArtistSubject: string,
  signOff: string,
  senderName: string
): OutboundMessage {
  const nameVars = buildArtistNameVars(group.artists);
  const leadArtist = nameVars.leadArtist;
  const vars = {
    artistNames: nameVars.artistNames,
    artistSummary: nameVars.artistSummary,
    artistCount: nameVars.artistCount,
    otherCount: nameVars.otherCount,
    allArtistNames: nameVars.allArtistNames,
    // A stray {{artistName}} left in the user's copy (or in signOff) gets the
    // lead artist's real name rather than rendering literally as "{{artistName}}"
    // in a cold email — see renderTemplate's unknown-key fallback.
    artistName: leadArtist.name,
    managementCompany: leadArtist.managementCompany,
    managerName: group.managerName || 'there',
    // Deliberately NOT pronounFor(leadArtist...): this email is about several
    // people, and rendering "she" because the top-ranked artist happens to be a
    // woman would be wrong about everyone else behind this address. 'they' is
    // the only pronoun that's never wrong for a group.
    pronoun: 'they',
    trackTitle,
    driveLink,
    senderName,
  };
  const bodyParts = [renderTemplate(multiArtistTemplate, vars)];
  if (signOff?.trim()) bodyParts.push(renderTemplate(signOff, vars));
  const body = bodyParts.join('\n\n');
  // No subjectTemplateFor/A-B split here (contrast buildSingleArtistMessage):
  // splitting an already-smaller set of multi-artist recipients in two would
  // make any test on this subject unreadable for little statistical value.
  const subject = renderTemplate(multiArtistSubject, vars);
  return { to: group.email, subject, body, rank: leadArtist.spotifyFollowers ?? 0 };
}

export async function sendDemos(payload: DemosSendPayload) {
  const {
    trackTitle, driveLink, genres, emailTemplate, subjectTemplate, subjectTemplateB,
    multiArtistTemplate, multiArtistSubject, senderName,
    signOff, signOffImage, minAudience, maxAudience, gender, artistType, minInstagram, maxInstagram, matchMode,
    maxCompanySize, freemailOnly, matchAllGenres, accountId,
    sendDelay, blacklist, excludeEmails, customContacts, threadIds, offset, limit,
  } = payload;

  const subjectTpl = subjectTemplate?.trim() || DEFAULT_DEMOS_SUBJECT;
  // Blank/whitespace-only counts the same as absent — see multiArtistTemplate's
  // doc comment on why that has to fall all the way back to today's behavior.
  const multiTpl = multiArtistTemplate?.trim();
  const multiSubjectTpl = multiArtistSubject?.trim() || DEFAULT_MULTI_ARTIST_SUBJECT;

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

  // Rank once over the WHOLE matched list (not per-group) so a group's artists
  // arrive already in fit order — groupArtistsByManagerEmail's doc comment
  // states this dependency, and re-sorting inside a group would break the
  // "first non-blank managerName wins" rule it relies on that ordering for.
  const rankedArtists = rankArtistsForPitch(artists, genres ?? []);
  const managerGroups = groupArtistsByManagerEmail(rankedArtists);

  const artistMessages: OutboundMessage[] = managerGroups.map(group => {
    // A group of 2+ only gets the multi-artist treatment once the caller has
    // actually supplied copy for it; otherwise (including every group of
    // exactly 1) this is today's single-artist email about whichever artist in
    // the group ranks highest for this address.
    if (group.artists.length > 1 && multiTpl) {
      return buildMultiArtistMessage(group, trackTitle, driveLink, multiTpl, multiSubjectTpl, signOff ?? '', senderName);
    }
    const leadArtist = group.artists[0];
    return buildSingleArtistMessage(
      leadArtist, group.managerName, group.email,
      trackTitle, driveLink, emailTemplate, subjectTpl, subjectTemplateB, signOff ?? '', senderName
    );
  });

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

  // Hard blast-radius ceiling (operator-chosen, see MAX_CAMPAIGN_RECIPIENTS' doc
  // comment): checked against the FULL matched recipient set — roster-derived
  // recipients and customContacts together, after dedup/blacklist/exclusion
  // filtering, i.e. exactly what pagination below runs over — not the current
  // page. A per-page check wouldn't cap anything: the dashboard just keeps paging
  // with a rising offset until the audience is exhausted (sendInBatches in
  // app/dashboard/utils.ts), so this has to fire before paginate/checkCapAllows/
  // recordSends and evaluate identically no matter what `offset` this particular
  // request carries — allMessages is rebuilt from scratch on every request, so an
  // over-limit campaign can't slip through one page at a time. Refuses outright
  // rather than truncating to the first MAX_CAMPAIGN_RECIPIENTS: truncating would
  // silently pick who gets left out based on whatever sort order happened to be
  // active. Checked before recordSends so a refused campaign never consumes any
  // daily quota.
  if (allMessages.length > MAX_CAMPAIGN_RECIPIENTS) {
    return NextResponse.json({
      error: `Your filters match ${allMessages.length} recipients. A campaign can send to at most ${MAX_CAMPAIGN_RECIPIENTS} — narrow your filters (fewer genres, or turn on "Independent contacts only") and try again.`,
    }, { status: 400 });
  }

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
