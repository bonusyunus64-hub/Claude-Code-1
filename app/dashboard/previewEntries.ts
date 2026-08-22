// From lib/recipients.ts, not lib/mailSend.ts: this module is imported by a client
// component, and mailSend.ts pulls in nodemailer. See lib/recipients.ts's header.
import { dedupeByRecipient, subjectTemplateFor, type OutboundMessage } from '@/lib/recipients';
// artistFit.ts is client-safe by design (see its own header comment) — this is
// the same "rank, then group by manager address" pair lib/demosSend.ts's
// sendDemos runs server-side, reused here so the preview modal can never
// disagree with what a real send would build for the same matched artists.
import { rankArtistsForPitch, groupArtistsByManagerEmail, buildArtistNameVars } from '@/lib/artistFit';
import { renderTemplateClient, pronounForClient } from './utils';
import { DEFAULT_MULTI_ARTIST_SUBJECT } from './constants';
import type { Artist, CustomContact } from './types';

// Rendering every recipient's fully-built email body in the preview modal doesn't
// scale to a several-hundred-row send — it's wasted work the user never scrolls
// to. Capped, but the modal still reports the true *unique* recipient count (see
// buildPreviewEntries below) so "first 20" never reads as "this is everyone", and
// so that count agrees with the send button's countUniqueRecipients.
export const PREVIEW_MODAL_RECIPIENT_CAP = 20;

// Mirrors app/api/send/route.ts's constant of the same name and value: a manager
// the user added by hand always outranks whatever the roster suggests for the
// same address, so the preview shows their framing of the pitch, not the roster's.
export const CUSTOM_CONTACT_RANK = Number.MAX_SAFE_INTEGER;

/**
 * One recipient before its email is rendered. `subject`/`body` are placeholders —
 * they only exist so this satisfies OutboundMessage and can go through
 * dedupeByRecipient, the exact function the server runs before sending. `vars` is
 * template variables to render post-dedup; `label` is the modal's dropdown text.
 */
export type PreviewCandidate = OutboundMessage & { label: string; vars: Record<string, string> };

/** Shape rendered in the modal's recipient dropdown and detail panes. */
export type PreviewEntry = { label: string; to: string; subject: string; body: string };

/**
 * Dedupes preview candidates by address using the same rule the server applies
 * before sending (dedupeByRecipient: highest `rank` wins, ties keep the first
 * seen), then drops anyone on the Do Not Contact list — the same filter
 * lib/demosSend.ts/lib/broadcastSend.ts apply server-side before a send ever
 * reaches them — so the modal never previews a row that would never actually
 * go out, and its `total` agrees with the send button's own
 * countSendableRecipients. Subject/body are rendered only for the first `cap`
 * of the deduped, blacklist-filtered list, not every candidate —
 * renderTemplateClient is real work, and a full send can be hundreds of
 * recipients that the user will never scroll to in this modal.
 *
 * Lives here rather than in page.tsx so it's an ordinary importable module: a
 * route entry point isn't the place to hang exported helpers off, and its test
 * shouldn't have to import a page component to reach one pure function.
 *
 * `render` also receives the recipient's address, not just their template
 * vars — needed so a caller doing subject-line A/B testing (lib/recipients.ts's
 * subjectTemplateFor) can pick the same variant for this preview row that
 * app/api/send/route.ts will actually use for that address.
 *
 * `blacklist` defaults to empty so an existing caller that doesn't pass one
 * behaves exactly as before (nothing filtered, excludedByBlacklist always 0).
 */
export function buildPreviewEntries(
  candidates: PreviewCandidate[],
  cap: number,
  render: (vars: Record<string, string>, to: string) => { subject: string; body: string },
  blacklist: string[] = []
): { entries: PreviewEntry[]; total: number; excludedByBlacklist: number } {
  const bl = new Set(blacklist.map(e => e.trim().toLowerCase()));
  const deduped = dedupeByRecipient(candidates);
  const sendable = deduped.filter(c => !bl.has(c.to.trim().toLowerCase()));
  const excludedByBlacklist = deduped.length - sendable.length;
  const entries = sendable.slice(0, cap).map(c => ({ label: c.label, to: c.to, ...render(c.vars, c.to) }));
  return { entries, total: sendable.length, excludedByBlacklist };
}

/** Everything page.tsx's demos preview-modal branch needs — one plain object
 *  rather than a dozen positional args, since almost every field here is a
 *  string/boolean drawn straight off useDemosFlow/useTemplateDrafts/useAccountSettings. */
export interface DemosPreviewInput {
  includedArtists: Artist[];
  selectedGenres: string[];
  customContacts: CustomContact[];
  demosTemplate: string;
  demosSubject: string;
  demosSubjectB: string;
  demosFollowUpTemplate: string;
  demosFollowUpSubject: string;
  demosMultiArtistTemplate: string;
  demosMultiArtistSubject: string;
  useFollowUp: boolean;
  subjectTestEnabled: boolean;
  signOff: string;
  blacklist: string[];
  trackTitle: string;
  driveLink: string;
  senderName: string;
}

/**
 * Builds the Song Demos preview modal's candidates and renders the capped
 * survivors — the client-side mirror of lib/demosSend.ts's sendDemos. Moved
 * out of page.tsx's useMemo body (rather than left inline) specifically so it
 * can be unit-tested without rendering the Dashboard component or mocking its
 * dozen other hooks; page.tsx just gathers the current values and calls this.
 *
 * The grouping has to agree with sendDemos EXACTLY, not just approximately:
 * rankArtistsForPitch, then groupArtistsByManagerEmail, then one candidate per
 * group — a group of 2+ artists gets the multi-artist copy only when there
 * actually IS non-blank copy to send AND this isn't a follow-up (a follow-up
 * never even carries multiArtistTemplate in the real payload — see
 * useDemosFlow.ts's handleSend — so previewing one here would show copy the
 * recipient could never actually receive on that send).
 */
export function buildDemosPreviewEntries(input: DemosPreviewInput): { entries: PreviewEntry[]; total: number; excludedByBlacklist: number } {
  const {
    includedArtists, selectedGenres, customContacts,
    demosTemplate, demosSubject, demosSubjectB,
    demosFollowUpTemplate, demosFollowUpSubject,
    demosMultiArtistTemplate, demosMultiArtistSubject,
    useFollowUp, subjectTestEnabled, signOff, blacklist,
    trackTitle, driveLink, senderName,
  } = input;

  const tpl = useFollowUp ? demosFollowUpTemplate : demosTemplate;
  const subjectA = useFollowUp ? demosFollowUpSubject : demosSubject;
  // Mirrors useDemosFlow's handleSend: A/B testing never applies to a
  // follow-up send, and only kicks in once the toggle is on with real text
  // in Subject B — matching exactly what a send would actually do.
  const subjectB = (!useFollowUp && subjectTestEnabled) ? demosSubjectB : undefined;

  // Same "no multiArtistTemplate -> today's behavior" fallback lib/demosSend.ts
  // applies (multiArtistTemplate?.trim()), combined with useDemosFlow's own
  // rule that the field is never even sent on a follow-up — a stale/blank
  // template, or a follow-up send, must preview as exactly today's
  // single-artist email, never the shared-manager one. Diverging from either
  // condition would make this preview lie about what Send actually mails.
  const multiTpl = useFollowUp ? '' : demosMultiArtistTemplate.trim();
  const multiSubjectTpl = demosMultiArtistSubject.trim() || DEFAULT_MULTI_ARTIST_SUBJECT;

  // Rank once over the whole matched list, then group by manager address —
  // byte-for-byte the same two calls lib/demosSend.ts's sendDemos makes, so
  // a group's lead artist (and therefore which single artist a non-multi row
  // previews) can never disagree with what the server would pick.
  const rankedArtists = rankArtistsForPitch(includedArtists, selectedGenres);
  const managerGroups = groupArtistsByManagerEmail(rankedArtists);

  // A custom contact ALWAYS outranks a roster group at the same address
  // (CUSTOM_CONTACT_RANK, applied below and by dedupeByRecipient) — so no
  // address a custom contact claims can ever survive dedup as the
  // multi-artist row, even when 2+ matched artists sit behind it too.
  // Excluded here, at the point multiArtistAddresses is built, rather than
  // left for `render` to re-derive per row: `render` only sees whichever
  // candidate actually survived dedup, by address, with no way to tell
  // whether that survivor was the custom contact or the roster group — so
  // the set itself has to already reflect the true winner, not just "is this
  // address a 2+ group," or a colliding custom contact would get rendered
  // through the multi-artist template/subject with its own (non-multi) vars.
  const customContactAddresses = new Set(customContacts.map(cc => cc.managerEmail.trim().toLowerCase()));
  const multiArtistAddresses = new Set(
    multiTpl
      ? managerGroups
          .filter(g => g.artists.length > 1 && !customContactAddresses.has(g.email.trim().toLowerCase()))
          .map(g => g.email.trim().toLowerCase())
      : []
  );

  const render = (vars: Record<string, string>, to: string) => {
    const isMulti = multiArtistAddresses.has(to.trim().toLowerCase());
    // The multi-artist subject never splits A/B (see lib/demosSend.ts's
    // buildMultiArtistMessage for why) — subjectTemplateFor only runs for the
    // single-artist branch, same as a real send.
    const subjectTpl = isMulti ? multiSubjectTpl : subjectTemplateFor(to, subjectA, subjectB);
    const bodyParts = [renderTemplateClient(isMulti ? multiTpl : tpl, vars)];
    if (signOff?.trim()) bodyParts.push(renderTemplateClient(signOff, vars));
    return { subject: renderTemplateClient(subjectTpl, vars), body: bodyParts.join('\n\n') };
  };

  const candidates: PreviewCandidate[] = [];
  // Custom contacts first: they always outrank roster suggestions for the same
  // address (CUSTOM_CONTACT_RANK), and putting them first also means a hand-added
  // contact — the whole reason someone added it — isn't the entry that falls off
  // the end when a large roster match pushes the deduped list past the cap.
  customContacts.forEach(cc => {
    candidates.push({
      to: cc.managerEmail, subject: '', body: '', rank: CUSTOM_CONTACT_RANK,
      label: `${cc.artistName}${cc.managerName ? ` (${cc.managerName})` : ''} <${cc.managerEmail}> [Custom]`,
      vars: { managerName: cc.managerName || 'there', artistName: cc.artistName, trackTitle, driveLink, senderName, managementCompany: '', pronoun: 'they' },
    });
  });

  // One candidate per manager group (address) — not one per artist x address
  // the way this used to iterate — so a manager repping several matched
  // artists gets previewed as the single email lib/demosSend.ts actually
  // builds for them, instead of a row per artist that dedupeByRecipient would
  // then collapse down to whichever happened to have the most followers
  // (today's bug this whole feature exists to fix).
  managerGroups.forEach(group => {
    if (multiArtistAddresses.has(group.email.trim().toLowerCase())) {
      const nameVars = buildArtistNameVars(group.artists);
      const leadArtist = nameVars.leadArtist;
      const otherCount = group.artists.length - 1;
      candidates.push({
        to: group.email, subject: '', body: '', rank: leadArtist.spotifyFollowers ?? 0,
        label: `${leadArtist.name} +${otherCount} other${otherCount === 1 ? '' : 's'}${group.managerName ? ` (${group.managerName})` : ''} <${group.email}>`,
        vars: {
          artistNames: nameVars.artistNames, artistSummary: nameVars.artistSummary,
          artistCount: nameVars.artistCount, otherCount: nameVars.otherCount, allArtistNames: nameVars.allArtistNames,
          artistName: leadArtist.name, managementCompany: leadArtist.managementCompany,
          managerName: group.managerName || 'there', pronoun: 'they',
          trackTitle, driveLink, senderName,
        },
      });
    } else {
      const leadArtist = group.artists[0];
      candidates.push({
        to: group.email, subject: '', body: '', rank: leadArtist.spotifyFollowers ?? 0,
        label: `${leadArtist.name}${group.managerName ? ` (${group.managerName})` : ''} <${group.email}>`,
        vars: {
          managerName: group.managerName || 'there', artistName: leadArtist.name, trackTitle, driveLink, senderName,
          managementCompany: leadArtist.managementCompany, pronoun: pronounForClient(leadArtist.gender, leadArtist.type),
        },
      });
    }
  });

  return buildPreviewEntries(candidates, PREVIEW_MODAL_RECIPIENT_CAP, render, blacklist);
}
