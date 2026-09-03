/**
 * Flags concrete, actionable copy problems in a template or subject line —
 * deliberately not a spam "score" anymore. The old version produced a 0-100
 * number built by adding up made-up per-hit weights (8 points a phrase, 6 a
 * punctuation mark, ...) that implied a precision nobody could defend: there's
 * no dataset behind "guaranteed free prize" being worth exactly 16 more points
 * than one exclamation mark. A list of specific issues with a severity each is
 * something every entry here can actually be justified, one at a time — see the
 * comment above each check below.
 *
 * It's also grounded in how TrackPitch itself builds and sends a message
 * (lib/mailSend.ts, lib/emailTemplate.ts, lib/demosSend.ts, lib/broadcastSend.ts,
 * lib/autoFollowUp.ts) rather than a generic "spam word" blocklist copied from
 * nowhere in particular:
 *
 *  - Every pitch this tool sends carries exactly one link by design — the
 *    Google Drive link, inserted via {{driveLink}} (see the DEFAULT_*_TEMPLATE
 *    constants in app/dashboard/constants.ts). A short message dominated by a
 *    bare link is one of the most reliable signals a receiving mail server
 *    checks for, so it's checked directly below instead of being guessed at
 *    indirectly through a phrase list.
 *  - renderTemplate() (lib/emailTemplate.ts) falls back to the literal
 *    "{{key}}" text whenever a variable name isn't in the vars object it's
 *    given — a silent failure, not a thrown error (see its one-line
 *    implementation: `vars[key] ?? \`{{${key}}}\``). DEFAULT_TEMPLATE_VARS and
 *    MULTI_ARTIST_TEMPLATE_VARS below are every variable name this app's send
 *    paths ever actually populate (grep lib/demosSend.ts — including
 *    buildMultiArtistMessage, lib/broadcastSend.ts, lib/autoFollowUp.ts for
 *    their renderTemplate() calls) — anything else in a template is either a
 *    typo that will never resolve for *any* recipient, or stray {{...}} text
 *    that shouldn't be there, and nothing else in this codebase catches it
 *    before it mails out verbatim. Which of the two sets applies depends on
 *    which send path a given template goes through, which is why
 *    computeSpamScore() takes the set as a parameter instead of hardcoding
 *    one — see the comment above DEFAULT_TEMPLATE_VARS below.
 *  - There is deliberately no "missing plaintext alternative" check. HTML-only
 *    mail is a real spam signal, but it doesn't apply here: lib/mailSend.ts's
 *    sendMessages() sets `mailOptions.text = msg.body` unconditionally, before
 *    the signOffImage branch ever touches `mailOptions.html`. Every message
 *    this tool sends either has a plaintext part only (no signature image), or
 *    a plaintext part *and* an html part (signature image configured) — never
 *    html without a plaintext alternative. Confirmed by reading that function,
 *    not assumed.
 */

export type IssueSeverity = 'high' | 'medium';

export interface SpamScoreIssue {
  message: string;
  severity: IssueSeverity;
}

export interface SpamScoreResult {
  /** Highest severity among `issues`, or 'low' when there are none. Drives the badge color. */
  risk: 'low' | 'medium' | 'high';
  issues: SpamScoreIssue[];
}

/**
 * Every variable name this app's send paths ever put into a renderTemplate()
 * vars object:
 *  - lib/demosSend.ts (buildEmailsForArtist, and the custom-contacts branch of
 *    sendDemos): managerName, artistName, trackTitle, driveLink, senderName,
 *    managementCompany, pronoun
 *  - lib/broadcastSend.ts (sendBroadcast, shared by the radio and playlist
 *    routes): trackTitle, driveLink, senderName, plus whichever of
 *    stationName/curatorName the caller passes as `nameVar`
 *  - lib/autoFollowUp.ts (buildFollowUpMessage): the same demos-shaped set
 *
 * A {{word}} in a template that isn't one of these can never resolve, for any
 * recipient, ever — it's not a "sometimes this recipient is missing a field"
 * case, it's a template that will ship the literal braces to every recipient
 * it goes to. That's what makes it worth a flag at edit time, before any
 * recipient-specific data is even involved: this check runs on the raw
 * template (that's what SpamScoreBadge is actually passed — see
 * MainTemplatePanel.tsx, FollowUpTemplatePanel.tsx, PromotionSection.tsx), so
 * it can only ever catch variable *names* that are wrong, not a specific
 * recipient's data being blank (e.g. an artist with no managementCompany on
 * file) — that failure mode only exists after rendering, per recipient, which
 * needs a check wired into the rendered preview rather than this function.
 *
 * DEFAULT_TEMPLATE_VARS is that set. It is deliberately NOT the only set this
 * file exports, and computeSpamScore() takes it as a parameter rather than
 * hardcoding it, because it stopped being true — for one send path — the
 * moment the shared-manager, multi-artist pitch shipped. buildMultiArtistMessage
 * (lib/demosSend.ts) populates five more names on top of this set:
 * artistSummary, artistNames, artistCount, otherCount, allArtistNames — see
 * MULTI_ARTIST_TEMPLATE_VARS below. Folding those five into this set instead
 * of keeping it separate would break the exact guarantee this comment opens
 * with: a plain single-artist template (lib/demosSend.ts's
 * buildEmailsForArtist / custom-contacts branch, lib/broadcastSend.ts,
 * lib/autoFollowUp.ts) never populates artistSummary or the other four, so
 * {{artistSummary}} typed into the main pitch or follow-up template would
 * mail out as the literal, unresolved braces — silently, since nothing else
 * in this codebase catches it — while this checker stayed quiet about it.
 * That's a worse failure than the one this whole file exists to catch: a
 * false negative on the loudest, highest-severity check here, traded for
 * fixing a false positive on one panel. Per-panel sets are what let each
 * template be checked against only the variables *its own* send path
 * actually fills in, so "known variable" keeps meaning "this specific
 * template will resolve it," not "some send path somewhere resolves it."
 */
export const DEFAULT_TEMPLATE_VARS = new Set([
  'managerName', 'artistName', 'trackTitle', 'driveLink', 'senderName',
  'managementCompany', 'pronoun', 'stationName', 'curatorName',
]);

/**
 * The set for the Shared-Manager (multi-artist) template panel only. Built
 * from DEFAULT_TEMPLATE_VARS plus the five names buildMultiArtistMessage
 * (lib/demosSend.ts) adds to its renderTemplate() vars object: artistNames,
 * artistSummary, artistCount, otherCount, allArtistNames. The single-artist
 * names carry over unchanged because buildMultiArtistMessage really does
 * still populate artistName (the lead artist), managementCompany (the lead
 * artist's), managerName (the group's), and pronoun (hardcoded 'they', never
 * resolved per-artist — see the file header comment there) — confirmed by
 * reading that function, not assumed. stationName/curatorName carry over too
 * even though this send path never fills them, since DEFAULT_TEMPLATE_VARS is
 * additive here, not narrowed; they're simply never used in a template this
 * panel edits, so their presence in the set is inert.
 */
export const MULTI_ARTIST_TEMPLATE_VARS = new Set([
  ...DEFAULT_TEMPLATE_VARS,
  'artistSummary', 'artistNames', 'artistCount', 'otherCount', 'allArtistNames',
]);

/**
 * A short, deliberately conservative list of multi-word constructions that are
 * essentially unheard of in genuine "pitching a track to a manager or radio
 * station" copy — unlike the old list, which included ordinary English words
 * ("free", "amazing", "instant", "urgent", "cash") that fire constantly on
 * completely normal lines like "an amazing record" or "free to use the
 * stems." Every phrase below is a multi-word MLM/bulk-mail construction,
 * chosen because a phrase, not a single common word, is what actually
 * distinguishes spam template boilerplate from ordinary sentences that happen
 * to contain one of its words.
 */
const SPAM_PHRASES = [
  'click here', 'act now', 'limited time offer', 'no obligation',
  'risk-free', 'risk free', 'buy now', 'order now', 'work from home',
  'be your own boss', 'earn extra cash', 'double your income',
  'satisfaction guaranteed', "this isn't spam", 'no credit card required',
  '100% free',
];

/**
 * Matches either a real URL or the {{driveLink}} placeholder standing in for
 * the one link every pitch ships with by design. Counting the placeholder
 * (rather than only real URLs) is what lets this same function meaningfully
 * check an unrendered template — which is what every current caller actually
 * passes it (see the SpamScoreBadge usages above) — and not just a fully
 * rendered body.
 */
const LINK_PATTERN = /\{\{\s*driveLink\s*\}\}|https?:\/\/\S+|www\.\S+/gi;

export function computeSpamScore(
  text: string,
  knownVars: ReadonlySet<string> = DEFAULT_TEMPLATE_VARS
): SpamScoreResult {
  const issues: SpamScoreIssue[] = [];

  // --- Unrendered / unknown template variables --------------------------
  // Deliberately treated as the loudest possible issue: a literal
  // "{{artistName}}" landing in a real inbox is instantly, visibly broken in
  // a way none of the other checks below are — there's no reading of it that
  // isn't a mistake.
  const varMatches = [...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)];
  const unknownVarNames = [...new Set(
    varMatches.filter(m => !knownVars.has(m[1])).map(m => m[1])
  )];
  if (unknownVarNames.length > 0) {
    issues.push({
      severity: 'high',
      message: `Unrecognized template variable${unknownVarNames.length !== 1 ? 's' : ''} ${unknownVarNames.map(n => `{{${n}}}`).join(', ')} — this app only ever fills in ${[...knownVars].map(v => `{{${v}}}`).join(', ')}. Anything else is never replaced and mails out to the recipient as this exact literal text.`,
    });
  }

  // --- Link signal --------------------------------------------------------
  const linkMatches = text.match(LINK_PATTERN) || [];
  const linkCount = linkMatches.length;
  const words = text.trim().split(/\s+/).filter(Boolean);
  const wordCount = words.length;

  if (linkCount > 0 && wordCount < 40) {
    // The strongest signal this tool can actually produce: every pitch has
    // exactly one link by design ({{driveLink}}), so a short body built
    // mostly of a greeting and a bare link is close to the canonical shape of
    // a spam message, independent of what the surrounding words actually say.
    issues.push({
      severity: 'high',
      message: `Body is only ${wordCount} word${wordCount !== 1 ? 's' : ''} for a message containing a link. A short message dominated by a bare link is one of the strongest signals a mailbox provider checks for — add more real copy around it before sending.`,
    });
  } else if (linkCount > 0) {
    const wordsPerLink = wordCount / linkCount;
    if (wordsPerLink < 15) {
      issues.push({
        severity: 'medium',
        message: `High link-to-text ratio (~${Math.round(wordsPerLink)} words per link) — pad out the copy around the link, or cut down how many links are in the message.`,
      });
    }
  }

  if (linkCount > 2) {
    // Independent of the ratio checks above: this pitch only ever needs the
    // one Drive link, so several links in one message is worth a second look
    // regardless of how much text surrounds them.
    issues.push({
      severity: 'medium',
      message: `${linkCount} links in one message — this pitch only needs the one Drive link ({{driveLink}}); extra links are worth double-checking.`,
    });
  }

  if (linkCount === 0 && wordCount > 0 && wordCount < 12) {
    // No link to blame here, just very little copy — worth flagging on its
    // own because Account settings lets a sender attach a signature image to
    // every send (see the signOffImage branch in lib/mailSend.ts's
    // sendMessages()), and a near-empty body plus an image is a well-known
    // image-heavy, text-light spam shape. This function only sees the body
    // text, not whether a signature image is actually configured, so the
    // wording below is conditional rather than asserting the image exists.
    issues.push({
      severity: 'medium',
      message: `Body is only ${wordCount} word${wordCount !== 1 ? 's' : ''}. If this account has a signature image configured, a near-empty body plus an image reads as image-heavy, text-light mail to spam filters — add more real copy.`,
    });
  }

  // --- Spam-trigger phrases ------------------------------------------------
  const lower = text.toLowerCase();
  const matchedPhrases = SPAM_PHRASES.filter(p => lower.includes(p));
  if (matchedPhrases.length > 0) {
    issues.push({
      // More than a couple of these in one message is a stronger tell than
      // any single one on its own — none of them are ambiguous the way
      // "free" or "amazing" were, but stacking several is still worse than one.
      severity: matchedPhrases.length > 2 ? 'high' : 'medium',
      message: `Contains spam-trigger phrase${matchedPhrases.length !== 1 ? 's' : ''}: ${matchedPhrases.map(p => `"${p}"`).join(', ')}`,
    });
  }

  // --- Excessive exclamation marks ------------------------------------------
  // Kept as-is from the old implementation — this one was already sound and
  // isn't specific to any particular kind of copy.
  const exclamations = (text.match(/!/g) || []).length;
  if (exclamations > 2) {
    issues.push({
      severity: exclamations > 5 ? 'high' : 'medium',
      message: `Excessive exclamation marks (${exclamations})`,
    });
  }

  // --- ALL-CAPS ratio ---------------------------------------------------------
  // Also kept as-is — a genuinely sound signal independent of subject matter.
  const capsCandidates = text.match(/[A-Za-z]{3,}/g) || [];
  const capsWords = capsCandidates.filter(w => w === w.toUpperCase());
  const capsRatio = capsCandidates.length > 0 ? capsWords.length / capsCandidates.length : 0;
  if (capsWords.length >= 3 && capsRatio > 0.1) {
    issues.push({
      severity: capsRatio > 0.3 ? 'high' : 'medium',
      message: `${Math.round(capsRatio * 100)}% of words are in ALL CAPS`,
    });
  }

  const risk: SpamScoreResult['risk'] = issues.some(i => i.severity === 'high')
    ? 'high'
    : issues.some(i => i.severity === 'medium')
    ? 'medium'
    : 'low';

  return { risk, issues };
}
