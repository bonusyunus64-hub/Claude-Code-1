// From lib/recipients.ts, not lib/mailSend.ts: this module is imported by a client
// component, and mailSend.ts pulls in nodemailer. See lib/recipients.ts's header.
import { dedupeByRecipient, type OutboundMessage } from '@/lib/recipients';

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
