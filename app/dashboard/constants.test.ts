import { describe, it, expect } from 'vitest';
import { computeSpamScore } from '@/lib/spamScore';
import {
  DEFAULT_DEMOS_TEMPLATE,
  DEFAULT_FOLLOWUP_TEMPLATE,
  DEFAULT_RADIO_TEMPLATE,
  DEFAULT_SIGN_OFF,
} from './constants';

// Regression guard for a real incident (August 2026): one agent rewrote these
// three DEFAULT_*_TEMPLATE constants to be much shorter, another independently
// rewrote lib/spamScore.ts's checker to flag short-body-plus-link copy as the
// canonical spam shape (see the `wordCount < 40` branch there). Neither agent
// saw the other's change, so every shipped default ended up tripping our own
// highest-severity ("high") rule the moment a brand-new user opened the app —
// every built-in template showed a red spam-risk badge before they'd typed a
// word. The checker was correct; the templates were the bug.
//
// This file exists to make that class of bug loud and immediate rather than
// something a future editor discovers by opening the app and eyeballing a
// badge. If you're here because this test just failed: you (or a template
// this depends on, e.g. DEFAULT_SIGN_OFF) changed one of the DEFAULT_*_TEMPLATE
// constants and computeSpamScore now disagrees with it. Fix the COPY, not this
// test — a shipped default that our own deliverability checker flags as high
// risk is incoherent on its face, whatever the reason. If the checker's rule
// itself is what actually needs to change, that's a deliberate, visible
// decision to make in lib/spamScore.ts, not a reason to delete or weaken this
// test.

// The complete set of {{variable}} names each send path actually populates in
// its renderTemplate() call — re-declared here (rather than imported) because
// lib/spamScore.ts's KNOWN_TEMPLATE_VARS is not exported and that file is
// owned by other work in flight. KNOWN_TEMPLATE_VARS in lib/spamScore.ts is
// the source of truth this list must keep matching; it documents the same
// three call sites (lib/demosSend.ts's buildEmailsForArtist and the
// customContacts branch, lib/broadcastSend.ts's sendBroadcast, and
// lib/autoFollowUp.ts's buildFollowUpMessage) that this list is derived from.
const DEMOS_AND_FOLLOWUP_VARS = new Set([
  'managerName', 'artistName', 'trackTitle', 'driveLink', 'senderName',
  'managementCompany', 'pronoun',
]);
const RADIO_VARS = new Set(['stationName', 'trackTitle', 'driveLink', 'senderName']);

/** Every distinct {{name}} appearing in `text`, in first-seen order. */
function templateVarsIn(text: string): string[] {
  return [...new Set([...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map(m => m[1]))];
}

describe.each([
  ['DEFAULT_DEMOS_TEMPLATE', DEFAULT_DEMOS_TEMPLATE, DEMOS_AND_FOLLOWUP_VARS],
  ['DEFAULT_FOLLOWUP_TEMPLATE', DEFAULT_FOLLOWUP_TEMPLATE, DEMOS_AND_FOLLOWUP_VARS],
  ['DEFAULT_RADIO_TEMPLATE', DEFAULT_RADIO_TEMPLATE, RADIO_VARS],
] as const)('%s', (name, template, allowedVars) => {
  it('is low risk with zero issues on its own — a shipped default must not trip our own spam checker', () => {
    const result = computeSpamScore(template);
    expect(
      result.issues,
      `${name} tripped computeSpamScore: ${JSON.stringify(result.issues)}. ` +
        `A default template that our own deliverability checker flags is incoherent to ship — ` +
        `see the file header comment in app/dashboard/constants.test.ts before touching this test.`
    ).toEqual([]);
    expect(result.risk).toBe('low');
  });

  it('is still low risk with zero issues once DEFAULT_SIGN_OFF is appended, matching how it actually renders', () => {
    // Every real send appends the sign-off to the body (see buildEmailsForArtist,
    // sendBroadcast, buildFollowUpMessage all pushing renderTemplate(signOff, vars)
    // onto bodyParts) — checking the template in isolation isn't the whole story,
    // since a template close to the word-count floor could tip over once rendered
    // copy is checked instead. This is what SpamScoreBadge is actually shown for.
    const rendered = `${template}\n\n${DEFAULT_SIGN_OFF}`;
    const result = computeSpamScore(rendered);
    expect(
      result.issues,
      `${name} + DEFAULT_SIGN_OFF tripped computeSpamScore: ${JSON.stringify(result.issues)}.`
    ).toEqual([]);
    expect(result.risk).toBe('low');
  });

  it('only uses {{variables}} the corresponding send path actually populates', () => {
    const used = templateVarsIn(template);
    const unknown = used.filter(v => !allowedVars.has(v));
    expect(
      unknown,
      `${name} references {{${unknown.join('}}, {{')}}}, which nothing in lib/demosSend.ts, ` +
        `lib/broadcastSend.ts, or lib/autoFollowUp.ts ever populates for it — renderTemplate() ` +
        `falls back to the literal "{{name}}" text for any var not in its vars object, so this ` +
        `would mail out to every recipient as broken literal braces. Invented variable, or a typo.`
    ).toEqual([]);

    // Belt-and-braces: computeSpamScore's own unrecognized-variable check should
    // independently agree there's nothing unknown in here, since that's the
    // mechanism a real editor sees (the badge), not this test's allowedVars set.
    const result = computeSpamScore(template);
    expect(result.issues.some(i => i.message.includes('Unrecognized template variable'))).toBe(false);
  });
});
