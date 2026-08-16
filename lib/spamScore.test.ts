import { describe, it, expect } from 'vitest';
import { computeSpamScore } from './spamScore';

// A realistically-sized pitch body, the same shape as
// app/dashboard/constants.ts's DEFAULT_DEMOS_TEMPLATE: a greeting, some real
// copy, exactly one {{driveLink}}, and only known template variables. Used as
// the "this should never flag anything" baseline for several tests below,
// rather than an artificially short one-liner — a real pitch email is this
// long, not three words, so the baseline should be too.
const CLEAN_PITCH = `Hi {{managerName}},

My name is {{senderName}}, and I'm reaching out to submit a track for your consideration for {{artistName}}. I think it could be a strong fit for what you're already working on.

I've attached the track "{{trackTitle}}" — you can listen here:
{{driveLink}}

I believe this would suit {{artistName}}'s sound and audience well, and I'd love to discuss any potential collaboration or placement. Please let me know if you need anything further, and thanks so much for taking the time to listen.`;

describe('computeSpamScore', () => {
  it('finds no issues in a realistically-sized clean pitch', () => {
    const result = computeSpamScore(CLEAN_PITCH);
    expect(result.issues).toHaveLength(0);
    expect(result.risk).toBe('low');
  });

  it('finds no issues in short clean text with no link and no phrases', () => {
    // Short, but not link-dominated and not near-textless either (12+ words).
    const result = computeSpamScore('Hi there, hope you enjoy this brand new single we just put out this week.');
    expect(result.issues).toHaveLength(0);
    expect(result.risk).toBe('low');
  });

  describe('regression: old ordinary-English false positives', () => {
    it('does not flag "an amazing record" embedded in real copy', () => {
      const body = `Hi {{managerName}}, I just heard {{artistName}}'s new single and honestly think it's an amazing record — the production really stands out. Track: {{trackTitle}}. Listen here: {{driveLink}}. Let me know what you think, thanks!`;
      const result = computeSpamScore(body);
      expect(result.issues.some(i => i.message.includes('spam-trigger'))).toBe(false);
    });

    it('does not flag "free to use the stems" embedded in real copy', () => {
      const body = `Hi {{managerName}}, quick note on {{artistName}}'s track "{{trackTitle}}" — you're free to use the stems for any remix or sync opportunity you have in mind. Full version here: {{driveLink}}. Appreciate you taking a listen.`;
      const result = computeSpamScore(body);
      expect(result.issues.some(i => i.message.includes('spam-trigger'))).toBe(false);
    });

    it('does not flag standalone "urgent", "cash", "instant" used in ordinary business English', () => {
      const body = `Hi {{managerName}}, apologies for the instant follow-up, this isn't urgent — no need to turn it into cash flow, just wanted to flag {{artistName}}'s new record "{{trackTitle}}". Link: {{driveLink}}. Thanks for your time.`;
      const result = computeSpamScore(body);
      expect(result.issues.some(i => i.message.includes('spam-trigger'))).toBe(false);
    });

    it('does not flag "no fees" or "lower your" used in ordinary business English', () => {
      const body = `Hi {{managerName}}, just a heads up that there are no fees on our end for a sync placement of {{artistName}}'s "{{trackTitle}}", and licensing this way could lower your overall costs versus the usual route. Listen here: {{driveLink}}. Thanks for considering it.`;
      const result = computeSpamScore(body);
      expect(result.issues.some(i => i.message.includes('spam-trigger'))).toBe(false);
    });
  });

  describe('spam-trigger phrases (trimmed list)', () => {
    it('still flags genuinely spammy multi-word constructions', () => {
      const result = computeSpamScore('Click here to listen, act now, this offer is risk-free!');
      expect(result.issues.some(i => i.message.includes('spam-trigger'))).toBe(true);
    });

    it('marks high severity when several spam phrases stack up', () => {
      const result = computeSpamScore('Buy now, order now, act now, click here, no obligation, risk free, work from home.');
      const phraseIssue = result.issues.find(i => i.message.includes('spam-trigger'));
      expect(phraseIssue?.severity).toBe('high');
    });
  });

  describe('link signal', () => {
    it('flags a short body dominated by a bare link as high severity', () => {
      const result = computeSpamScore('Check this out: {{driveLink}}');
      const linkIssue = result.issues.find(i => i.message.includes('dominated by a bare link'));
      expect(linkIssue).toBeDefined();
      expect(linkIssue?.severity).toBe('high');
    });

    it('flags a short body dominated by a real URL the same way as {{driveLink}}', () => {
      const result = computeSpamScore('Listen here: https://drive.google.com/file/d/abc123/view');
      const linkIssue = result.issues.find(i => i.message.includes('dominated by a bare link'));
      expect(linkIssue).toBeDefined();
    });

    it('flags a poor link-to-text ratio in an otherwise long body', () => {
      const filler = Array(45).fill('word').join(' ');
      const body = `${filler} {{driveLink}} {{driveLink}} {{driveLink}} {{driveLink}}`;
      const result = computeSpamScore(body);
      expect(result.issues.some(i => i.message.includes('link-to-text ratio'))).toBe(true);
    });

    it('flags more than two links regardless of surrounding text length', () => {
      const result = computeSpamScore(`${CLEAN_PITCH} Also: https://a.example.com https://b.example.com https://c.example.com`);
      expect(result.issues.some(i => i.message.includes('links in one message'))).toBe(true);
    });

    it('does not flag link issues for a well-proportioned single-link body', () => {
      const result = computeSpamScore(CLEAN_PITCH);
      expect(result.issues.some(i => i.message.includes('bare link') || i.message.includes('link-to-text') || i.message.includes('links in one message'))).toBe(false);
    });
  });

  describe('near-textless body (no link)', () => {
    it('flags a very short body with no link at all', () => {
      const result = computeSpamScore('Hey, take a listen!');
      expect(result.issues.some(i => i.message.includes('image-heavy'))).toBe(true);
    });

    it('does not double-flag near-textless when a link is already flagged as the short-body-with-link issue', () => {
      const result = computeSpamScore('{{driveLink}}');
      expect(result.issues.some(i => i.message.includes('image-heavy'))).toBe(false);
    });
  });

  describe('unrendered / unknown template variables', () => {
    it('does not flag known template variables', () => {
      const result = computeSpamScore(CLEAN_PITCH);
      expect(result.issues.some(i => i.message.includes('Unrecognized template variable'))).toBe(false);
    });

    it('flags an unknown/misspelled variable loudly', () => {
      const body = CLEAN_PITCH.replace(/\{\{artistName\}\}/g, '{{aristName}}');
      const result = computeSpamScore(body);
      const issue = result.issues.find(i => i.message.includes('Unrecognized template variable'));
      expect(issue).toBeDefined();
      expect(issue?.message).toContain('{{aristName}}');
      expect(issue?.severity).toBe('high');
    });

    it('lists each distinct unknown variable name only once even if repeated', () => {
      const body = 'Hi {{weirdVar}}, thanks again {{weirdVar}}! {{driveLink}}';
      const result = computeSpamScore(body);
      const issue = result.issues.find(i => i.message.includes('Unrecognized template variable'));
      expect(issue?.message.match(/\{\{weirdVar\}\}/g)).toHaveLength(1);
    });
  });

  describe('excessive exclamation marks (kept from the old implementation)', () => {
    it('flags more than two exclamation marks', () => {
      const result = computeSpamScore('Wow! Great! Nice track!');
      expect(result.issues.some(i => i.message.includes('exclamation'))).toBe(true);
    });

    it('does not flag two or fewer exclamation marks', () => {
      const result = computeSpamScore('Hey! Loved this one!');
      expect(result.issues.some(i => i.message.includes('exclamation'))).toBe(false);
    });
  });

  describe('ALL CAPS ratio (kept from the old implementation)', () => {
    it('flags a high ratio of all-caps words', () => {
      const result = computeSpamScore('THIS IS A REALLY GREAT DEAL FOR YOU TODAY');
      expect(result.issues.some(i => i.message.includes('ALL CAPS'))).toBe(true);
    });

    it('does not flag a normal amount of capitalization', () => {
      const result = computeSpamScore(CLEAN_PITCH);
      expect(result.issues.some(i => i.message.includes('ALL CAPS'))).toBe(false);
    });
  });

  describe('risk aggregation', () => {
    it('is low risk with no issues', () => {
      expect(computeSpamScore('').risk).toBe('low');
    });

    it('is high risk when any issue is high severity', () => {
      const result = computeSpamScore('{{driveLink}}');
      expect(result.issues.some(i => i.severity === 'high')).toBe(true);
      expect(result.risk).toBe('high');
    });

    it('is medium risk when the worst issue present is medium severity', () => {
      const result = computeSpamScore('Hey, take a listen!');
      expect(result.issues.every(i => i.severity !== 'high')).toBe(true);
      expect(result.issues.some(i => i.severity === 'medium')).toBe(true);
      expect(result.risk).toBe('medium');
    });
  });
});
