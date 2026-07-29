import { describe, it, expect } from 'vitest';
import { resolveImapConfig, sendersFromEnvelope, matchResponders, isBounceSender, extractFailedRecipients } from './checkReplies';

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
