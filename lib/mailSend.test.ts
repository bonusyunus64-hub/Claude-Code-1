import { describe, it, expect, vi, afterEach } from 'vitest';
import { paginate, resolveSmtpConfig, sendMessages, dedupeByRecipient, formatFromHeader, type OutboundMessage } from './mailSend';

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

  describe('unsubscribe link and headers', () => {
    afterEach(() => vi.unstubAllEnvs());

    it('appends an unsubscribe footer and List-Unsubscribe headers when a secret is configured', async () => {
      vi.stubEnv('ACCOUNTS_SECRET', 'test-secret');
      const sendMail = vi.fn().mockResolvedValue(undefined);
      await sendMessages(fakeTransport(sendMail), messages, { fromName: 'F', fromEmail: 'f@example.com' });
      const sentOptions = sendMail.mock.calls[0][0];
      expect(sentOptions.text).toContain('Unsubscribe:');
      expect(sentOptions.text).toContain('/unsubscribe?email=a%40example.com&token=');
      expect(sentOptions.headers['List-Unsubscribe']).toContain('/api/unsubscribe?email=a%40example.com&token=');
      expect(sentOptions.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    });

    it('sends without an unsubscribe link or headers when no secret is configured', async () => {
      const sendMail = vi.fn().mockResolvedValue(undefined);
      await sendMessages(fakeTransport(sendMail), messages, { fromName: 'F', fromEmail: 'f@example.com' });
      const sentOptions = sendMail.mock.calls[0][0];
      expect(sentOptions.text).toBe('Body');
      expect(sentOptions.headers).toBeUndefined();
    });
  });
});
