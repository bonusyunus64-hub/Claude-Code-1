import { describe, it, expect, afterEach, vi } from 'vitest';
import { isAuthorizedCronRequest } from './cronAuth';

function fakeReq(authorizationHeader: string | undefined) {
  return {
    headers: { get: (name: string) => (name === 'authorization' && authorizationHeader !== undefined ? authorizationHeader : null) },
  } as unknown as Parameters<typeof isAuthorizedCronRequest>[0];
}

describe('isAuthorizedCronRequest', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('accepts a request bearing the correct CRON_SECRET', () => {
    vi.stubEnv('CRON_SECRET', 'the-secret');
    expect(isAuthorizedCronRequest(fakeReq('Bearer the-secret'))).toBe(true);
  });

  it('rejects a request with the wrong bearer token', () => {
    vi.stubEnv('CRON_SECRET', 'the-secret');
    expect(isAuthorizedCronRequest(fakeReq('Bearer wrong'))).toBe(false);
  });

  it('rejects a request with no Authorization header', () => {
    vi.stubEnv('CRON_SECRET', 'the-secret');
    expect(isAuthorizedCronRequest(fakeReq(undefined))).toBe(false);
  });

  it('fails closed when CRON_SECRET is not configured, even with a header present', () => {
    expect(isAuthorizedCronRequest(fakeReq('Bearer anything'))).toBe(false);
  });
});
