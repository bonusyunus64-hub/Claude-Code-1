import { describe, it, expect, vi, beforeEach } from 'vitest';

const mxRecords = new Map<string, { exchange: string; priority: number }[]>();
const aRecords = new Set<string>();

vi.mock('dns', () => ({
  promises: {
    resolveMx: (domain: string) => {
      const records = mxRecords.get(domain);
      return records && records.length > 0 ? Promise.resolve(records) : Promise.reject(new Error('ENODATA'));
    },
    resolve: (domain: string) => aRecords.has(domain) ? Promise.resolve(['1.2.3.4']) : Promise.reject(new Error('ENOTFOUND')),
  },
}));

import { domainOf, isWellFormedEmail, checkRecipients } from './mxCheck';

describe('domainOf', () => {
  it('extracts the domain after the last @', () => {
    expect(domainOf('manager@example.com')).toBe('example.com');
  });

  it('lowercases and trims the domain', () => {
    expect(domainOf(' manager@Example.COM ')).toBe('example.com');
  });

  it('returns null when there is no @', () => {
    expect(domainOf('not-an-email')).toBeNull();
  });

  it('returns null when @ is the last character', () => {
    expect(domainOf('manager@')).toBeNull();
  });
});

describe('isWellFormedEmail', () => {
  it('accepts a normal address', () => {
    expect(isWellFormedEmail('manager@example.com')).toBe(true);
  });

  it('rejects addresses with no domain dot', () => {
    expect(isWellFormedEmail('manager@localhost')).toBe(false);
  });

  it('rejects addresses with no @', () => {
    expect(isWellFormedEmail('not-an-email')).toBe(false);
  });

  it('rejects addresses with spaces', () => {
    expect(isWellFormedEmail('man ager@example.com')).toBe(false);
  });
});

describe('checkRecipients', () => {
  beforeEach(() => {
    mxRecords.clear();
    aRecords.clear();
  });

  it('passes an address whose domain has MX records', async () => {
    mxRecords.set('good.com', [{ exchange: 'mail.good.com', priority: 10 }]);
    const result = await checkRecipients(['manager@good.com']);
    expect(result.malformed).toEqual([]);
    expect(result.noMx).toEqual([]);
  });

  it('flags an address whose domain has neither MX nor A records', async () => {
    const result = await checkRecipients(['manager@dead.com']);
    expect(result.noMx).toEqual(['manager@dead.com']);
  });

  it('falls back to accepting a domain with an A record but no MX record', async () => {
    aRecords.add('a-only.com');
    const result = await checkRecipients(['manager@a-only.com']);
    expect(result.noMx).toEqual([]);
  });

  it('flags malformed addresses separately from MX lookups', async () => {
    const result = await checkRecipients(['not-an-email']);
    expect(result.malformed).toEqual(['not-an-email']);
    expect(result.noMx).toEqual([]);
  });

  it('only looks up each domain once for repeated addresses at the same domain', async () => {
    mxRecords.set('shared.com', [{ exchange: 'mail.shared.com', priority: 10 }]);
    const spy = vi.spyOn(await import('dns').then(m => m.promises), 'resolveMx');
    await checkRecipients(['a@shared.com', 'b@shared.com', 'c@shared.com']);
    const callsForDomain = spy.mock.calls.filter(c => c[0] === 'shared.com');
    expect(callsForDomain.length).toBeLessThanOrEqual(1);
    spy.mockRestore();
  });
});
