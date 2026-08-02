import { describe, it, expect, vi, afterEach } from 'vitest';

// createTransport/sendMessagesPooled go through nodemailer.createTransport for real,
// so exercising the pool options and the close-on-finally behaviour needs a mock
// transporter rather than the fake { sendMail } object the other sendMessages tests
// use (those bypass createTransport entirely by constructing their own transporter).
const mockSendMail = vi.fn();
const mockClose = vi.fn();
const mockCreateTransport = vi.fn((options: unknown) => {
  void options; // recorded via mock.calls for assertions below; unused otherwise
  return { sendMail: mockSendMail, close: mockClose };
});
vi.mock('nodemailer', () => ({
  default: { createTransport: (options: unknown) => mockCreateTransport(options) },
}));

import {
  paginate, resolveSmtpConfig, sendMessages, sendMessagesPooled, createTransport,
  dedupeByRecipient, formatFromHeader, assignSubjectVariant, subjectTemplateFor, type OutboundMessage,
} from './mailSend';

describe('formatFromHeader', () => {
  it('quotes a plain display name', () => {
    expect(formatFromHeader('TrackPitch', 'hello@example.com')).toBe('"TrackPitch" <hello@example.com>');
  });

  it('escapes a double quote in the display name', () => {
    expect(formatFromHeader('Sender\'s "Nickname" Band', 'hello@example.com'))
      .toBe('"Sender\'s \\"Nickname\\" Band" <hello@example.com>');
  });

  it('escapes a backslash in the display name', () => {
    expect(formatFromHeader('Rock \\ Roll', 'hello@example.com')).toBe('"Rock \\\\ Roll" <hello@example.com>');
  });

  it('omits the quoting entirely for an empty name', () => {
    expect(formatFromHeader('', 'hello@example.com')).toBe('hello@example.com');
    expect(formatFromHeader('   ', 'hello@example.com')).toBe('hello@example.com');
  });
});

describe('dedupeByRecipient', () => {
  it('collapses multiple messages to the same address down to one', () => {
    const messages: OutboundMessage[] = [
      { to: 'manager@example.com', subject: 'A', body: 'Artist A pitch' },
      { to: 'manager@example.com', subject: 'B', body: 'Artist B pitch' },
      { to: 'other@example.com', subject: 'C', body: 'Artist C pitch' },
    ];
    const result = dedupeByRecipient(messages);
    expect(result).toHaveLength(2);
    expect(result.map(m => m.to)).toEqual(['manager@example.com', 'other@example.com']);
  });

  it('matches addresses case-insensitively', () => {
    const messages: OutboundMessage[] = [
      { to: 'Manager@Example.com', subject: 'A', body: 'x' },
      { to: 'manager@example.com', subject: 'B', body: 'y' },
    ];
    expect(dedupeByRecipient(messages)).toHaveLength(1);
  });

  it('keeps the highest-rank message for a shared address', () => {
    const messages: OutboundMessage[] = [
      { to: 'manager@example.com', subject: 'Small act', body: 'x', rank: 100 },
      { to: 'manager@example.com', subject: 'Big act', body: 'y', rank: 90000 },
    ];
    const [result] = dedupeByRecipient(messages);
    expect(result.subject).toBe('Big act');
  });

  it('keeps the first message when ranks tie', () => {
    const messages: OutboundMessage[] = [
      { to: 'manager@example.com', subject: 'First', body: 'x', rank: 5 },
      { to: 'manager@example.com', subject: 'Second', body: 'y', rank: 5 },
    ];
    const [result] = dedupeByRecipient(messages);
    expect(result.subject).toBe('First');
  });

  it('preserves first-seen order of the surviving addresses', () => {
    const messages: OutboundMessage[] = [
      { to: 'z@example.com', subject: '1', body: 'x' },
      { to: 'a@example.com', subject: '2', body: 'y' },
      { to: 'z@example.com', subject: '3', body: 'z', rank: 1 },
    ];
    expect(dedupeByRecipient(messages).map(m => m.to)).toEqual(['z@example.com', 'a@example.com']);
  });
});

describe('paginate', () => {
  const items = Array.from({ length: 10 }, (_, i) => i);

  it('slices the requested window and reports total', () => {
    const { batch, total, nextOffset } = paginate(items, 0, 4);
    expect(batch).toEqual([0, 1, 2, 3]);
    expect(total).toBe(10);
    expect(nextOffset).toBe(4);
  });

  it('returns null nextOffset once the last batch is reached', () => {
    const { batch, nextOffset } = paginate(items, 8, 4);
    expect(batch).toEqual([8, 9]);
    expect(nextOffset).toBeNull();
  });

  it('returns an empty batch past the end', () => {
    const { batch, nextOffset } = paginate(items, 20, 4);
    expect(batch).toEqual([]);
    expect(nextOffset).toBeNull();
  });
});

describe('assignSubjectVariant', () => {
  it('is deterministic — the same address always gets the same variant', () => {
    const first = assignSubjectVariant('manager@example.com');
    for (let i = 0; i < 20; i++) expect(assignSubjectVariant('manager@example.com')).toBe(first);
  });

  it('is case-insensitive and trims whitespace, matching dedupeByRecipient\'s address normalization', () => {
    expect(assignSubjectVariant('Manager@Example.com')).toBe(assignSubjectVariant('manager@example.com'));
    expect(assignSubjectVariant('  manager@example.com  ')).toBe(assignSubjectVariant('manager@example.com'));
  });

  it('only ever returns A or B', () => {
    for (const email of ['a@x.com', 'b@x.com', 'nova@label.com', 'someone.else@thing.io', 'z@z.com']) {
      expect(['A', 'B']).toContain(assignSubjectVariant(email));
    }
  });

  it('splits a realistic list of addresses roughly 50/50, not all into one bucket', () => {
    const emails = Array.from({ length: 200 }, (_, i) => `recipient${i}@example.com`);
    const counts = { A: 0, B: 0 };
    emails.forEach(e => counts[assignSubjectVariant(e)]++);
    // Not asserting an exact 50/50 split (hashing 200 arbitrary strings won't land
    // exactly even), just that it's a real split rather than a degenerate one —
    // both sides need at least 35% for this to count as "roughly uniform".
    expect(counts.A).toBeGreaterThan(70);
    expect(counts.B).toBeGreaterThan(70);
    expect(counts.A + counts.B).toBe(200);
  });
});

describe('subjectTemplateFor', () => {
  it('always returns subjectA when subjectB is undefined — a payload with no B variant is unaffected', () => {
    expect(subjectTemplateFor('anyone@example.com', 'Subject A', undefined)).toBe('Subject A');
  });

  it('always returns subjectA when subjectB is blank/whitespace-only', () => {
    expect(subjectTemplateFor('anyone@example.com', 'Subject A', '   ')).toBe('Subject A');
  });

  it('picks whichever of A/B assignSubjectVariant assigns this address to', () => {
    // Any two example addresses will do — what matters is that the choice tracks
    // assignSubjectVariant exactly, not any particular email landing in A vs B.
    for (const email of ['sam@example.com', 'jamie@label.io', 'x@y.com']) {
      const expected = assignSubjectVariant(email) === 'A' ? 'Subject A' : 'Subject B';
      expect(subjectTemplateFor(email, 'Subject A', 'Subject B')).toBe(expected);
    }
  });

  it('gives the same recipient the same subject no matter how many times it\'s called — the deterministic-split guarantee batching/resuming relies on', () => {
    const results = new Set(Array.from({ length: 10 }, () => subjectTemplateFor('manager@example.com', 'Subject A', 'Subject B')));
    expect(results.size).toBe(1);
  });
});

describe('resolveSmtpConfig', () => {
  it('prefers the explicit fromAccount over env vars', () => {
    const config = resolveSmtpConfig(
      { name: 'Band', email: 'band@example.com', smtpHost: 'smtp.example.com', smtpPort: 587, smtpUser: 'u', smtpPass: 'p' },
      'Sender'
    );
    expect(config).toEqual({
      smtpUser: 'u',
      smtpPass: 'p',
      smtpHost: 'smtp.example.com',
      smtpPort: 587,
      fromName: 'Band',
      fromEmail: 'band@example.com',
    });
  });

  it('falls back to env vars and Zoho defaults when no fromAccount is given', () => {
    vi.stubEnv('ZOHO_USER', 'me@zoho.com');
    vi.stubEnv('ZOHO_PASS', 'secret');
    const config = resolveSmtpConfig(undefined, 'Sender Name');
    expect(config.smtpUser).toBe('me@zoho.com');
    expect(config.smtpPass).toBe('secret');
    expect(config.smtpHost).toBe('smtp.zoho.com');
    expect(config.smtpPort).toBe(465);
    expect(config.fromName).toBe('Sender Name');
    expect(config.fromEmail).toBe('me@zoho.com');
    vi.unstubAllEnvs();
  });
});

function fakeTransport(sendMail: (opts: unknown) => Promise<unknown>) {
  return { sendMail } as unknown as Parameters<typeof sendMessages>[0];
}

describe('sendMessages', () => {
  const messages: OutboundMessage[] = [{ to: 'a@example.com', subject: 'Hi', body: 'Body' }];

  it('reports success when sendMail resolves', async () => {
    const sendMail = vi.fn().mockResolvedValue(undefined);
    const results = await sendMessages(fakeTransport(sendMail), messages, { fromName: 'F', fromEmail: 'f@example.com' });
    expect(results).toEqual([{ to: 'a@example.com', success: true }]);
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it('retries transient failures and eventually succeeds', async () => {
    vi.useFakeTimers();
    const sendMail = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }))
      .mockResolvedValueOnce(undefined);
    const promise = sendMessages(fakeTransport(sendMail), messages, { fromName: 'F', fromEmail: 'f@example.com' });
    await vi.runAllTimersAsync();
    const results = await promise;
    vi.useRealTimers();
    expect(results).toEqual([{ to: 'a@example.com', success: true }]);
    expect(sendMail).toHaveBeenCalledTimes(2);
  });

  it('does not retry permanent SMTP rejections (5xx)', async () => {
    const sendMail = vi.fn().mockRejectedValue(Object.assign(new Error('rejected'), { responseCode: 550 }));
    const results = await sendMessages(fakeTransport(sendMail), messages, { fromName: 'F', fromEmail: 'f@example.com' });
    expect(results[0].success).toBe(false);
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it('captures the returned Message-ID on success', async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: '<abc123@example.com>' });
    const results = await sendMessages(fakeTransport(sendMail), messages, { fromName: 'F', fromEmail: 'f@example.com' });
    expect(results).toEqual([{ to: 'a@example.com', success: true, messageId: '<abc123@example.com>' }]);
  });

  it('sets In-Reply-To/References when a message threads onto a prior one', async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: '<followup@example.com>' });
    const threaded: OutboundMessage[] = [
      { to: 'a@example.com', subject: 'Following up', body: 'Body', inReplyTo: '<original@example.com>' },
    ];
    await sendMessages(fakeTransport(sendMail), threaded, { fromName: 'F', fromEmail: 'f@example.com' });
    const sentOptions = sendMail.mock.calls[0][0];
    expect(sentOptions.inReplyTo).toBe('<original@example.com>');
    expect(sentOptions.references).toBe('<original@example.com>');
  });

  it('gives up after exhausting retries on persistent transient failures', async () => {
    vi.useFakeTimers();
    const sendMail = vi.fn().mockRejectedValue(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }));
    const promise = sendMessages(fakeTransport(sendMail), messages, { fromName: 'F', fromEmail: 'f@example.com' });
    await vi.runAllTimersAsync();
    const results = await promise;
    vi.useRealTimers();
    expect(results[0].success).toBe(false);
    expect(sendMail).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  // A pitch is sent to a handful of hand-picked contacts a week and is meant to read as
  // personally written, so it carries no unsubscribe footer and no RFC 8058
  // List-Unsubscribe header — see lib/doNotContact.ts's header comment. These assert the
  // absence rather than just omitting the old tests: re-adding either one is a silent,
  // outward-facing change to every email that goes out, so it should fail here first.
  describe('no unsubscribe footer or headers', () => {
    afterEach(() => vi.unstubAllEnvs());

    it('sends the body verbatim, with no footer appended', async () => {
      const sendMail = vi.fn().mockResolvedValue(undefined);
      await sendMessages(fakeTransport(sendMail), messages, { fromName: 'F', fromEmail: 'f@example.com' });
      const sentOptions = sendMail.mock.calls[0][0];
      expect(sentOptions.text).toBe('Body');
      expect(sentOptions.text).not.toContain('Unsubscribe');
      expect(sentOptions.headers).toBeUndefined();
    });

    it('still sends no footer or headers when an encryption secret IS configured', async () => {
      // The footer used to be gated on this secret being present, so a send with one set
      // is the case that would regress if the old token-signing path ever came back.
      vi.stubEnv('ACCOUNTS_SECRET', 'test-secret');
      const sendMail = vi.fn().mockResolvedValue(undefined);
      await sendMessages(fakeTransport(sendMail), messages, { fromName: 'F', fromEmail: 'f@example.com' });
      const sentOptions = sendMail.mock.calls[0][0];
      expect(sentOptions.text).toBe('Body');
      expect(sentOptions.headers).toBeUndefined();
    });

    it('omits the footer from the HTML part of a signature-image send too', async () => {
      vi.stubEnv('ACCOUNTS_SECRET', 'test-secret');
      const sendMail = vi.fn().mockResolvedValue(undefined);
      await sendMessages(fakeTransport(sendMail), messages, {
        fromName: 'F', fromEmail: 'f@example.com',
        signOffImage: 'data:image/png;base64,aGk=',
      });
      const sentOptions = sendMail.mock.calls[0][0];
      expect(sentOptions.html).toContain('cid:signature@trackpitch');
      expect(sentOptions.html).not.toContain('Unsubscribe');
    });
  });
});

describe('createTransport', () => {
  const config = { smtpHost: 'smtp.example.com', smtpPort: 465, smtpUser: 'u', smtpPass: 'p' };

  it('enables pooling with a single connection, deliberately not nodemailer\'s multi-connection default', () => {
    createTransport(config);
    expect(mockCreateTransport).toHaveBeenCalledWith(expect.objectContaining({
      pool: true,
      maxConnections: 1,
      maxMessages: 100,
    }));
  });
});

describe('sendMessagesPooled', () => {
  const config = { smtpHost: 'smtp.example.com', smtpPort: 465, smtpUser: 'u', smtpPass: 'p' };
  const messages: OutboundMessage[] = [{ to: 'a@example.com', subject: 'Hi', body: 'Body' }];

  afterEach(() => {
    mockSendMail.mockReset();
    mockClose.mockReset();
    mockCreateTransport.mockClear();
  });

  it('closes the pooled transport after a successful batch', async () => {
    mockSendMail.mockResolvedValue(undefined);
    const results = await sendMessagesPooled(config, messages, { fromName: 'F', fromEmail: 'f@example.com' });
    expect(results).toEqual([{ to: 'a@example.com', success: true }]);
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  // The whole reason sendMessagesPooled exists rather than leaving callers to close
  // the transport themselves: a pooled connection left open holds a serverless
  // function alive past the response, so the close has to run on the error path too.
  it('still closes the pooled transport when every message fails', async () => {
    mockSendMail.mockRejectedValue(Object.assign(new Error('rejected'), { responseCode: 550 }));
    const results = await sendMessagesPooled(config, messages, { fromName: 'F', fromEmail: 'f@example.com' });
    expect(results[0].success).toBe(false);
    expect(mockClose).toHaveBeenCalledTimes(1);
  });
});
