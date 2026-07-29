import { describe, it, expect } from 'vitest';
import { resolveImapConfig, sendersFromEnvelope, matchResponders } from './checkReplies';

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
