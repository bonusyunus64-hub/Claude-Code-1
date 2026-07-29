import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { encrypt, decrypt } from './accounts';

describe('encrypt/decrypt', () => {
  beforeEach(() => {
    vi.stubEnv('SITE_PASSWORD', 'correct-horse-battery-staple');
    vi.stubEnv('ACCOUNTS_SECRET', '');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('round-trips a plaintext password', () => {
    const encrypted = encrypt('hunter2');
    expect(encrypted).not.toContain('hunter2');
    expect(decrypt(encrypted)).toBe('hunter2');
  });

  it('produces different ciphertext for the same plaintext (random IV)', () => {
    expect(encrypt('hunter2')).not.toBe(encrypt('hunter2'));
  });

  it('fails to decrypt under a different secret, rather than returning garbage', () => {
    const encrypted = encrypt('hunter2');
    vi.stubEnv('SITE_PASSWORD', 'a-different-secret');
    expect(decrypt(encrypted)).toBeNull();
  });

  it('rejects tampered ciphertext instead of returning corrupted plaintext', () => {
    const encrypted = encrypt('hunter2');
    const parts = encrypted.split(':');
    // Flip a hex character in the ciphertext segment — GCM's auth tag should reject this.
    parts[3] = (parts[3][0] === '0' ? '1' : '0') + parts[3].slice(1);
    expect(decrypt(parts.join(':'))).toBeNull();
  });

  it('returns null for a payload that is not in the expected v1 format', () => {
    expect(decrypt('not-a-valid-payload')).toBeNull();
  });

  it('throws when encrypting with no secret configured at all', () => {
    vi.unstubAllEnvs();
    expect(() => encrypt('hunter2')).toThrow();
  });
});
