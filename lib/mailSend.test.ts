import { describe, it, expect, vi } from 'vitest';
import { paginate, resolveSmtpConfig, sendMessages, type OutboundMessage } from './mailSend';

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
});
