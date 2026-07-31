import { describe, it, expect, vi, beforeEach } from 'vitest';

// checkReplies.ts's classifyReplies() delegates AI classification to
// lib/replyClassifier.ts — mocked here so these tests exercise the pre-filtering,
// fallback, and batch-plumbing logic in checkReplies.ts without any real network
// call. lib/replyClassifier.test.ts covers the AI-calling module itself.
const mockClassifyRepliesWithAI = vi.fn();
vi.mock('./replyClassifier', () => ({
  classifyRepliesWithAI: (...args: unknown[]) => mockClassifyRepliesWithAI(...args),
}));

import {
  resolveImapConfig, sendersFromEnvelope, matchResponders, isBounceSender,
  extractFailedRecipients, classifyReply, classifyReplies,
} from './checkReplies';

describe('resolveImapConfig', () => {
  it('derives the imap host from an smtp.* host', () => {
    expect(resolveImapConfig('smtp.zoho.com', 'u', 'p')).toEqual({
      host: 'imap.zoho.com', port: 993, user: 'u', pass: 'p',
    });
  });

  it('falls back to the smtp host unchanged when it has no smtp. prefix', () => {
    expect(resolveImapConfig('mail.example.com', 'u', 'p').host).toBe('mail.example.com');
  });
});

describe('sendersFromEnvelope', () => {
  it('pulls addresses out of from/replyTo/sender and lowercases them', () => {
    const envelope = {
      from: [{ address: 'Manager@Example.com' }],
      replyTo: [{ address: 'other@example.com' }],
    };
    expect(sendersFromEnvelope(envelope)).toEqual(['manager@example.com', 'other@example.com']);
  });

  it('handles a missing envelope', () => {
    expect(sendersFromEnvelope(undefined)).toEqual([]);
  });

  it('drops entries with no address', () => {
    expect(sendersFromEnvelope({ from: [{}] })).toEqual([]);
  });
});

describe('matchResponders', () => {
  it('returns recipients whose address appears among inbox senders, case-insensitively', () => {
    const emails = ['Manager@Example.com', 'other@example.com', 'noreply@example.com'];
    const inboxSenders = ['manager@example.com', 'someone-else@example.com'];
    expect(matchResponders(emails, inboxSenders)).toEqual(['Manager@Example.com']);
  });

  it('returns the original casing from the recipient list, not the inbox sender', () => {
    const result = matchResponders(['Some.Manager@Example.com'], ['some.manager@example.com']);
    expect(result).toEqual(['Some.Manager@Example.com']);
  });

  it('does not duplicate a recipient matched by multiple inbox messages', () => {
    const result = matchResponders(['a@example.com'], ['a@example.com', 'a@example.com']);
    expect(result).toEqual(['a@example.com']);
  });

  it('returns nothing when no inbox sender matches', () => {
    expect(matchResponders(['a@example.com'], ['b@example.com'])).toEqual([]);
  });
});

describe('isBounceSender', () => {
  it('recognizes common DSN sender local-parts', () => {
    expect(isBounceSender('mailer-daemon@gmail.com')).toBe(true);
    expect(isBounceSender('MAILER-DAEMON@googlemail.com')).toBe(true);
    expect(isBounceSender('postmaster@zoho.com')).toBe(true);
    expect(isBounceSender('mail-daemon@example.com')).toBe(true);
  });

  it('recognizes tagged variants (mailer-daemon+something@)', () => {
    expect(isBounceSender('mailer-daemon+abc123@gmail.com')).toBe(true);
  });

  it('does not flag a real manager address', () => {
    expect(isBounceSender('manager@labelgroup.com')).toBe(false);
  });
});

describe('extractFailedRecipients', () => {
  const candidates = ['manager@example.com', 'other@example.com'];

  it('reads the Final-Recipient DSN header', () => {
    const source = 'Content-Type: message/delivery-status\n\nFinal-Recipient: rfc822;manager@example.com\nAction: failed\n';
    expect(extractFailedRecipients(source, candidates)).toEqual(['manager@example.com']);
  });

  it('reads X-Failed-Recipients as a fallback header', () => {
    const source = 'X-Failed-Recipients: manager@example.com\n';
    expect(extractFailedRecipients(source, candidates)).toEqual(['manager@example.com']);
  });

  it('falls back to a plain substring match in the body', () => {
    const source = 'The following address(es) had permanent fatal errors:\n\nmanager@example.com\n';
    expect(extractFailedRecipients(source, candidates)).toEqual(['manager@example.com']);
  });

  it('is case-insensitive', () => {
    const source = 'Final-Recipient: rfc822;MANAGER@EXAMPLE.COM\n';
    expect(extractFailedRecipients(source, candidates)).toEqual(['manager@example.com']);
  });

  it('only reports addresses from the candidate list, ignoring other addresses in the body', () => {
    const source = 'Final-Recipient: rfc822;manager@example.com\nX-Original-To: someone-else@unrelated.com\n';
    expect(extractFailedRecipients(source, candidates)).toEqual(['manager@example.com']);
  });

  it('returns an empty array when nothing matches', () => {
    const source = 'This message has nothing to do with any recipient.';
    expect(extractFailedRecipients(source, candidates)).toEqual([]);
  });

  it('can report multiple failed recipients from one DSN', () => {
    const source = 'Final-Recipient: rfc822;manager@example.com\nFinal-Recipient: rfc822;other@example.com\n';
    expect(extractFailedRecipients(source, candidates)).toEqual(candidates);
  });
});

function fakeMessage(opts: { headers?: string; subject?: string; body?: string }): string {
  const headers = [`Subject: ${opts.subject ?? 'Re: Music Submission'}`, opts.headers ?? ''].filter(Boolean).join('\n');
  return `${headers}\n\n${opts.body ?? ''}`;
}

describe('classifyReply', () => {
  it('classifies an auto-reply by header, regardless of body content', () => {
    const source = fakeMessage({ headers: 'Auto-Submitted: auto-replied', body: 'I love this, send it over!' });
    expect(classifyReply(source)).toBe('auto-reply');
  });

  it('treats "Auto-Submitted: no" as a real reply, not an auto-reply', () => {
    const source = fakeMessage({ headers: 'Auto-Submitted: no', body: 'Sounds great, would love to hear more.' });
    expect(classifyReply(source)).toBe('interested');
  });

  it('classifies a vacation-responder subject as auto-reply', () => {
    const source = fakeMessage({ subject: 'Automatic reply: Out of Office', body: 'I am currently out of the office.' });
    expect(classifyReply(source)).toBe('auto-reply');
  });

  it('classifies a clearly positive reply as interested', () => {
    const source = fakeMessage({ body: "This sounds great, we'd love to hear more. Please send it over!" });
    expect(classifyReply(source)).toBe('interested');
  });

  it('classifies a clearly negative reply as pass', () => {
    const source = fakeMessage({ body: "Thanks for reaching out, but we're not interested at this time." });
    expect(classifyReply(source)).toBe('pass');
  });

  it('falls back to unclassified for an ambiguous reply', () => {
    const source = fakeMessage({ body: 'Thanks for reaching out, who is this?' });
    expect(classifyReply(source)).toBe('unclassified');
  });

  it('strips quoted history so the original pitch text does not skew classification', () => {
    const source = fakeMessage({
      body: "Not interested, sorry.\n\nOn Mon, Jan 1, 2024 at 9:00 AM Sender <sender@example.com> wrote:\n> Would love to hear your thoughts, sounds great right?",
    });
    expect(classifyReply(source)).toBe('pass');
  });

  it('strips HTML tags before matching keywords', () => {
    const source = fakeMessage({
      headers: 'Content-Type: text/html',
      body: '<div><p>We are <b>not interested</b> right now, thanks.</p></div>',
    });
    expect(classifyReply(source)).toBe('pass');
  });
});

describe('classifyReplies', () => {
  beforeEach(() => {
    mockClassifyRepliesWithAI.mockReset();
    mockClassifyRepliesWithAI.mockResolvedValue({});
  });

  it('classifies a header-based auto-reply without ever calling the AI classifier', async () => {
    const source = fakeMessage({ headers: 'Auto-Submitted: auto-replied', body: 'I love this, send it over!' });
    const labels = await classifyReplies([{ uid: 1, sender: 'a@example.com', source }]);
    expect(labels.get(1)).toBe('auto-reply');
    expect(mockClassifyRepliesWithAI).not.toHaveBeenCalled();
  });

  it('classifies a subject-based auto-reply without ever calling the AI classifier', async () => {
    const source = fakeMessage({ subject: 'Automatic reply: Out of Office', body: 'Away until Monday.' });
    const labels = await classifyReplies([{ uid: 1, sender: 'a@example.com', source }]);
    expect(labels.get(1)).toBe('auto-reply');
    expect(mockClassifyRepliesWithAI).not.toHaveBeenCalled();
  });

  it('does not call the AI classifier at all when every pending message is an auto-reply', async () => {
    const source = fakeMessage({ headers: 'Auto-Submitted: auto-replied' });
    await classifyReplies([
      { uid: 1, sender: 'a@example.com', source },
      { uid: 2, sender: 'b@example.com', source },
    ]);
    expect(mockClassifyRepliesWithAI).not.toHaveBeenCalled();
  });

  it('uses the AI classification when the classifier returns a label for the message (successful classification)', async () => {
    mockClassifyRepliesWithAI.mockResolvedValue({ '7': 'interested' });
    const source = fakeMessage({ body: "We'd need to hear the stems first, but keen." });
    const labels = await classifyReplies([{ uid: 7, sender: 'a@example.com', source }]);
    expect(labels.get(7)).toBe('interested');
  });

  it('sends only non-auto-reply messages to the AI classifier, keyed by uid, with headers/quoting already stripped', async () => {
    const s1 = fakeMessage({ body: 'Sounds interesting, tell me more.' });
    const s2 = fakeMessage({ headers: 'Auto-Submitted: auto-replied', body: 'Out of office' });
    await classifyReplies([
      { uid: 1, sender: 'a@example.com', source: s1 },
      { uid: 2, sender: 'b@example.com', source: s2 },
    ]);
    expect(mockClassifyRepliesWithAI).toHaveBeenCalledTimes(1);
    expect(mockClassifyRepliesWithAI).toHaveBeenCalledWith([
      { key: '1', text: 'Sounds interesting, tell me more.' },
    ]);
  });

  it('batches every non-auto-reply message from one call into a single classifyRepliesWithAI invocation', async () => {
    const s1 = fakeMessage({ body: 'Sounds interesting, tell me more.' });
    const s2 = fakeMessage({ body: 'Not for us.' });
    const s3 = fakeMessage({ body: 'Who is this?' });
    await classifyReplies([
      { uid: 1, sender: 'a@example.com', source: s1 },
      { uid: 2, sender: 'b@example.com', source: s2 },
      { uid: 3, sender: 'c@example.com', source: s3 },
    ]);
    expect(mockClassifyRepliesWithAI).toHaveBeenCalledTimes(1);
    const [batchArg] = mockClassifyRepliesWithAI.mock.calls[0] as [{ key: string }[]];
    expect(batchArg.map(r => r.key)).toEqual(['1', '2', '3']);
  });

  it('falls back to the keyword classifier for a message the AI classifier returns no label for (API failure or no key configured)', async () => {
    // classifyRepliesWithAI itself never throws — a missing API key or a failed
    // request both surface as the key simply being absent from its result, which
    // is exactly what the default mockResolvedValue({}) in beforeEach simulates.
    const source = fakeMessage({ body: "This sounds great, we'd love to hear more. Please send it over!" });
    const labels = await classifyReplies([{ uid: 1, sender: 'a@example.com', source }]);
    expect(labels.get(1)).toBe('interested');
  });

  it('falls back to unclassified via keywords when the AI classifier has no label and no keyword matches either', async () => {
    const source = fakeMessage({ body: 'Thanks for reaching out, who is this?' });
    const labels = await classifyReplies([{ uid: 1, sender: 'a@example.com', source }]);
    expect(labels.get(1)).toBe('unclassified');
  });

  it('falls back per-message: an AI label for one uid does not affect a sibling message the classifier omitted', async () => {
    mockClassifyRepliesWithAI.mockResolvedValue({ '1': 'interested' });
    const s1 = fakeMessage({ body: 'Ambiguous but AI says interested.' });
    const s2 = fakeMessage({ body: "We're not interested, but the AI classifier didn't return anything for this one." });
    const labels = await classifyReplies([
      { uid: 1, sender: 'a@example.com', source: s1 },
      { uid: 2, sender: 'b@example.com', source: s2 },
    ]);
    expect(labels.get(1)).toBe('interested'); // from the mocked AI response
    expect(labels.get(2)).toBe('pass'); // AI classifier returned nothing for uid 2 -> keyword fallback
  });
});
