import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { syncStorage, hydrateFromRemote } from './remoteSync';

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body };
}

describe('syncStorage.setItem', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('writes to localStorage, pushes to the server, and returns true on success', () => {
    const fetchMock = vi.fn(async () => jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);

    const ok = syncStorage.setItem('tp_test', 'value');

    expect(ok).toBe(true);
    expect(localStorage.getItem('tp_test')).toBe('value');
    expect(fetchMock).toHaveBeenCalledWith('/api/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'tp_test', value: 'value' }),
    });
  });

  it('still pushes to the server and returns false when localStorage.setItem throws (e.g. quota exceeded)', () => {
    const fetchMock = vi.fn(async () => jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    });

    const ok = syncStorage.setItem('tp_sign_off_image', 'data:image/png;base64,aaaa');

    expect(ok).toBe(false);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    // The remote push — the more valuable write since it has no 5MB ceiling — must still
    // happen even though the local write blew up.
    expect(fetchMock).toHaveBeenCalledWith('/api/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'tp_sign_off_image', value: 'data:image/png;base64,aaaa' }),
    });
  });

  it('does not throw when the remote push itself fails (fire-and-forget)', () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network down'))));
    expect(() => syncStorage.setItem('tp_test', 'v')).not.toThrow();
  });
});

describe('syncStorage.removeItem', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('removes from localStorage and sends a DELETE to the server', () => {
    localStorage.setItem('tp_test', 'v');
    const fetchMock = vi.fn(async () => jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);

    syncStorage.removeItem('tp_test');

    expect(localStorage.getItem('tp_test')).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith('/api/state?key=tp_test', { method: 'DELETE' });
  });
});

describe('hydrateFromRemote', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('pulls remote values into localStorage for known synced keys', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ state: { tp_selected_account: 'acct-1' } })));

    await hydrateFromRemote();

    expect(localStorage.getItem('tp_selected_account')).toBe('acct-1');
  });

  it('pushes a local-only value up to the server when the remote has nothing for that key (never synced before)', async () => {
    localStorage.setItem('tp_selected_account', 'acct-local-only');
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method) return jsonResponse({}); // the POST push made by pushToRemote
      return jsonResponse({ state: {}, tombstones: {} }); // the initial GET — no value, no tombstone
    });
    vi.stubGlobal('fetch', fetchMock);

    await hydrateFromRemote();

    const pushCall = fetchMock.mock.calls.find(([, init]) => {
      const request = init as RequestInit | undefined;
      if (request?.method !== 'POST' || typeof request.body !== 'string') return false;
      return JSON.parse(request.body).key === 'tp_selected_account';
    });
    expect(pushCall).toBeTruthy();
  });

  it('does not overwrite localStorage for a key the server has nothing for and that has no local value either', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method) return jsonResponse({});
      return jsonResponse({ state: {}, tombstones: {} });
    });
    vi.stubGlobal('fetch', fetchMock);

    await hydrateFromRemote();

    const pushCalls = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST');
    expect(pushCalls).toHaveLength(0);
  });

  it('removes the local copy — and does NOT push it back up — when the server has a tombstone for that key', async () => {
    // Simulates: this device deleted tp_sign_off_image, then a second device (with a
    // stale local copy from before the deletion) hydrates. Before tombstones existed,
    // this was the bug: the second device would see "server has nothing" and push its
    // stale copy back up, silently resurrecting the deleted image.
    localStorage.setItem('tp_sign_off_image', 'data:image/png;base64,stale-deleted-elsewhere');
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method) return jsonResponse({});
      return jsonResponse({ state: {}, tombstones: { tp_sign_off_image: Date.now() } });
    });
    vi.stubGlobal('fetch', fetchMock);

    await hydrateFromRemote();

    expect(localStorage.getItem('tp_sign_off_image')).toBeNull();
    const pushCalls = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST');
    expect(pushCalls).toHaveLength(0);
  });

  it('treats a missing tombstones field as "no known deletions" (backward compatible with a stale cached response)', async () => {
    localStorage.setItem('tp_selected_account', 'acct-local-only');
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ state: {} }))); // no `tombstones` key at all
    await hydrateFromRemote();
    // Falls through to the "never synced" branch and pushes, same as before tombstones existed.
    expect(localStorage.getItem('tp_selected_account')).toBe('acct-local-only');
  });

  it('does not throw when the initial request fails (offline)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
    await expect(hydrateFromRemote()).resolves.toBeUndefined();
  });

  it('does not throw when the initial response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, false)));
    await expect(hydrateFromRemote()).resolves.toBeUndefined();
  });
});
