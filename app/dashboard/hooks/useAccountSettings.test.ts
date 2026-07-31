import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const syncStorage = vi.hoisted(() => ({ setItem: vi.fn(), removeItem: vi.fn() }));
vi.mock('@/lib/remoteSync', () => ({ syncStorage }));

import { useAccountSettings, fitWithinEdge, dataUrlByteSize, SIGN_OFF_IMAGE_MAX_BYTES } from './useAccountSettings';
import type { EmailAccount } from '../types';

function makeChangeEvent(file: File | undefined): React.ChangeEvent<HTMLInputElement> {
  return { target: { files: file ? [file] : [], value: '' } } as unknown as React.ChangeEvent<HTMLInputElement>;
}

/** A base64 string of roughly `bytes` decoded bytes — enough to build an oversized file without a real image. */
function base64OfSize(bytes: number): string {
  return 'A'.repeat(Math.ceil((bytes * 4) / 3));
}

function account(overrides: Partial<EmailAccount> = {}): EmailAccount {
  return { id: 'acct-1', name: 'Main', email: 'main@example.com', smtpHost: 'smtp.zoho.com', smtpPort: '465', smtpUser: 'main@example.com', ...overrides };
}

/**
 * The hook fetches GET /api/blacklist once on mount (see the useEffect in
 * useAccountSettings.ts), independently of whatever a given test is exercising — so most
 * tests below need a fetch stub that answers that call sanely (an empty list) and defers
 * everything else to the URL-specific behaviour the test actually cares about, rather than
 * every test having to special-case it. Tests that care about the mount-time fetch itself
 * (the 'loads the Do Not Contact list on mount' describe block) stub fetch directly instead.
 */
function stubFetch(handler: (url: string, init?: RequestInit) => Promise<unknown> | unknown) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/blacklist' && (!init || !init.method || init.method === 'GET')) {
      return { ok: true, json: async () => ({ blacklist: [] }) };
    }
    return handler(url, init);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('useAccountSettings', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  describe('accountCapError', () => {
    it('allows the send when the account has no per-account cap set', () => {
      const { result } = renderHook(() => useAccountSettings());
      act(() => result.current.setEmailAccounts([account({ dailyCap: 0 })]));
      expect(result.current.accountCapError('acct-1', 1000)).toBeNull();
    });

    it('allows the send when it stays within the cap', () => {
      const { result } = renderHook(() => useAccountSettings());
      act(() => {
        result.current.setEmailAccounts([account({ dailyCap: 10 })]);
        result.current.setSendsTodayByAccount({ 'acct-1': 5 });
      });
      expect(result.current.accountCapError('acct-1', 5)).toBeNull();
    });

    it('blocks the send when it would exceed the cap, naming the account\'s current usage', () => {
      const { result } = renderHook(() => useAccountSettings());
      act(() => {
        result.current.setEmailAccounts([account({ dailyCap: 10 })]);
        result.current.setSendsTodayByAccount({ 'acct-1': 8 });
      });
      const error = result.current.accountCapError('acct-1', 5);
      expect(error).toMatch(/8\/10 sent today/);
    });

    it('allows the send for an unrecognized account id (defaults to no cap)', () => {
      const { result } = renderHook(() => useAccountSettings());
      expect(result.current.accountCapError('missing-id', 1_000_000)).toBeNull();
    });
  });

  describe('blacklist', () => {
    it('adds a trimmed, lowercased address, clears the input, and pushes it to /api/blacklist', () => {
      const fetchMock = stubFetch(async () => ({ ok: true, json: async () => ({ blacklist: ['manager@example.com'] }) }));
      const { result } = renderHook(() => useAccountSettings());
      act(() => result.current.setNewBlacklistEmail('  Manager@Example.com  '));
      act(() => result.current.addToBlacklist());
      expect(result.current.blacklist).toEqual(['manager@example.com']);
      expect(result.current.newBlacklistEmail).toBe('');
      expect(fetchMock).toHaveBeenCalledWith('/api/blacklist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'manager@example.com' }),
      });
    });

    it('does not add a blank or already-present address', () => {
      stubFetch(async () => ({ ok: true, json: async () => ({ blacklist: [] }) }));
      const { result } = renderHook(() => useAccountSettings());
      act(() => result.current.setNewBlacklistEmail(''));
      act(() => result.current.addToBlacklist());
      expect(result.current.blacklist).toEqual([]);

      act(() => result.current.setBlacklist(['manager@example.com']));
      act(() => result.current.setNewBlacklistEmail('manager@example.com'));
      act(() => result.current.addToBlacklist());
      expect(result.current.blacklist).toEqual(['manager@example.com']);
    });

    it('removes an address from the blacklist and sends a DELETE to /api/blacklist', () => {
      const fetchMock = stubFetch(async () => ({ ok: true, json: async () => ({ blacklist: ['b@example.com'] }) }));
      const { result } = renderHook(() => useAccountSettings());
      act(() => result.current.setBlacklist(['a@example.com', 'b@example.com']));
      act(() => result.current.removeFromBlacklist('a@example.com'));
      expect(result.current.blacklist).toEqual(['b@example.com']);
      expect(fetchMock).toHaveBeenCalledWith('/api/blacklist?email=a%40example.com', { method: 'DELETE' });
    });

    it('addFailedToBlacklist merges, lowercases, and dedupes locally, and pushes the whole batch in one request', () => {
      const fetchMock = stubFetch(async () => ({ ok: true, json: async () => ({ blacklist: [] }) }));
      const { result } = renderHook(() => useAccountSettings());
      act(() => result.current.setBlacklist(['existing@example.com']));
      act(() => result.current.addFailedToBlacklist(['New@Example.com', 'existing@example.com']));
      expect(result.current.blacklist.sort()).toEqual(['existing@example.com', 'new@example.com']);

      // One /api/blacklist POST for the whole batch, not one request per address.
      const pushCalls = fetchMock.mock.calls.filter(([url, init]) => url === '/api/blacklist' && (init as RequestInit | undefined)?.method === 'POST');
      expect(pushCalls).toHaveLength(1);
      expect(JSON.parse((pushCalls[0][1] as RequestInit).body as string)).toEqual({ emails: ['new@example.com', 'existing@example.com'] });
    });
  });

  describe('loads the Do Not Contact list on mount', () => {
    it('populates blacklist from GET /api/blacklist', async () => {
      vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        if (url === '/api/blacklist') return { ok: true, json: async () => ({ blacklist: ['a@example.com', 'b@example.com'] }) };
        throw new Error(`unexpected fetch in this test: ${url}`);
      }));
      const { result } = renderHook(() => useAccountSettings());
      await waitFor(() => expect(result.current.blacklist).toEqual(['a@example.com', 'b@example.com']));
    });

    it('leaves blacklist empty (rather than throwing) when the request fails', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
      const { result } = renderHook(() => useAccountSettings());
      // Give the effect's fetch().catch() a turn to settle before asserting nothing changed.
      await act(async () => { await Promise.resolve(); });
      expect(result.current.blacklist).toEqual([]);
    });
  });

  describe('failed emails', () => {
    it('recordFailedEmails merges, lowercases, and dedupes; a no-op on an empty list', () => {
      const { result } = renderHook(() => useAccountSettings());
      act(() => result.current.recordFailedEmails(['A@example.com', 'b@example.com']));
      act(() => result.current.recordFailedEmails(['a@example.com']));
      expect(result.current.failedEmails.sort()).toEqual(['a@example.com', 'b@example.com']);

      act(() => result.current.recordFailedEmails([]));
      expect(result.current.failedEmails.sort()).toEqual(['a@example.com', 'b@example.com']);
    });

    it('removeFromFailedEmails removes a single address', () => {
      const { result } = renderHook(() => useAccountSettings());
      act(() => result.current.recordFailedEmails(['a@example.com', 'b@example.com']));
      act(() => result.current.removeFromFailedEmails('a@example.com'));
      expect(result.current.failedEmails).toEqual(['b@example.com']);
    });

    it('moveFailedToDoNotContact blacklists the address and drops it from failedEmails', () => {
      const { result } = renderHook(() => useAccountSettings());
      act(() => result.current.recordFailedEmails(['a@example.com']));
      act(() => result.current.moveFailedToDoNotContact('a@example.com'));
      expect(result.current.blacklist).toEqual(['a@example.com']);
      expect(result.current.failedEmails).toEqual([]);
    });
  });

  describe('account CRUD', () => {
    it('adds an account on success, selects it, and closes the add-account form', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ account: account() }) })));
      const { result } = renderHook(() => useAccountSettings());
      act(() => result.current.setShowAddAccount(true));
      act(() => result.current.setNewAccount({ name: 'Main', email: '', smtpHost: 'smtp.zoho.com', smtpPort: '465', smtpUser: 'main@example.com', smtpPass: 'hunter2', dailyCap: 0 }));

      await act(async () => { await result.current.addAccount(); });

      expect(result.current.emailAccounts).toEqual([account()]);
      expect(result.current.selectedAccountId).toBe('acct-1');
      expect(result.current.showAddAccount).toBe(false);
      expect(result.current.newAccount.smtpUser).toBe('');
    });

    it('does not submit when required fields are missing', async () => {
      // The hook's own mount-time GET to /api/blacklist (see the 'loads the Do Not
      // Contact list on mount' describe block) means fetch does get called at least
      // once regardless — this test only cares that addAccount() itself doesn't call
      // /api/accounts when required fields are missing.
      const fetchMock = stubFetch(async (url: string) => { throw new Error(`unexpected fetch: ${url}`); });
      const { result } = renderHook(() => useAccountSettings());
      await act(async () => { await result.current.addAccount(); });
      expect(fetchMock.mock.calls.filter(([url]) => url === '/api/accounts')).toHaveLength(0);
    });

    it('surfaces a server-provided error and leaves the account list untouched', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({ error: 'SMTP login failed.' }) })));
      const { result } = renderHook(() => useAccountSettings());
      act(() => result.current.setNewAccount({ name: 'Main', email: '', smtpHost: 'smtp.zoho.com', smtpPort: '465', smtpUser: 'main@example.com', smtpPass: 'wrong', dailyCap: 0 }));
      await act(async () => { await result.current.addAccount(); });
      expect(result.current.accountError).toBe('SMTP login failed.');
      expect(result.current.emailAccounts).toEqual([]);
    });

    it('removing the selected account falls back to the next remaining one', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));
      const { result } = renderHook(() => useAccountSettings());
      act(() => {
        result.current.setEmailAccounts([account({ id: 'a' }), account({ id: 'b' })]);
        result.current.setSelectedAccountId('a');
      });
      await act(async () => { await result.current.removeAccount('a'); });
      expect(result.current.emailAccounts.map(a => a.id)).toEqual(['b']);
      expect(result.current.selectedAccountId).toBe('b');
    });

    it('removing a non-selected account leaves the current selection alone', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));
      const { result } = renderHook(() => useAccountSettings());
      act(() => {
        result.current.setEmailAccounts([account({ id: 'a' }), account({ id: 'b' })]);
        result.current.setSelectedAccountId('a');
      });
      await act(async () => { await result.current.removeAccount('b'); });
      expect(result.current.selectedAccountId).toBe('a');
    });

    it('selectAccount switches the selected id', () => {
      const { result } = renderHook(() => useAccountSettings());
      act(() => result.current.selectAccount('acct-2'));
      expect(result.current.selectedAccountId).toBe('acct-2');
    });

    it('selectedAccount derives from emailAccounts + selectedAccountId', () => {
      const { result } = renderHook(() => useAccountSettings());
      act(() => {
        result.current.setEmailAccounts([account({ id: 'a' })]);
        result.current.setSelectedAccountId('a');
      });
      expect(result.current.selectedAccount?.id).toBe('a');
    });
  });

  describe('settings persistence', () => {
    it('setDailyCap updates state and syncs to storage', () => {
      const { result } = renderHook(() => useAccountSettings());
      act(() => result.current.setDailyCap(50));
      expect(result.current.dailySendCap).toBe(50);
      expect(syncStorage.setItem).toHaveBeenCalledWith('tp_daily_cap', '50');
    });

    it('setAutoFollowUp updates state and syncs to storage', () => {
      const { result } = renderHook(() => useAccountSettings());
      act(() => result.current.setAutoFollowUp(true));
      expect(result.current.autoFollowUpEnabled).toBe(true);
      expect(syncStorage.setItem).toHaveBeenCalledWith('tp_auto_followup_enabled', 'true');
    });

    it('setAutoFollowUpDaysValue updates state and syncs to storage', () => {
      const { result } = renderHook(() => useAccountSettings());
      act(() => result.current.setAutoFollowUpDaysValue(10));
      expect(result.current.autoFollowUpDays).toBe(10);
      expect(syncStorage.setItem).toHaveBeenCalledWith('tp_auto_followup_days', '10');
    });
  });

  describe('refreshSendsToday', () => {
    it('updates the send counters from /api/send-quota', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ count: 12, byAccount: { 'acct-1': 12 } }) })));
      const { result } = renderHook(() => useAccountSettings());
      await act(async () => { await result.current.refreshSendsToday(); });
      expect(result.current.sendsToday).toBe(12);
      expect(result.current.sendsTodayByAccount).toEqual({ 'acct-1': 12 });
    });

    it('does not throw when the request fails', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
      const { result } = renderHook(() => useAccountSettings());
      await act(async () => { await result.current.refreshSendsToday(); });
      expect(result.current.sendsToday).toBe(0);
    });
  });

  describe('handleDeliverabilityCheck', () => {
    it('does nothing when there is no selected account', async () => {
      const fetchMock = stubFetch(async (url: string) => { throw new Error(`unexpected fetch: ${url}`); });
      const { result } = renderHook(() => useAccountSettings());
      await act(async () => { await result.current.handleDeliverabilityCheck(); });
      expect(fetchMock.mock.calls.filter(([url]) => url === '/api/deliverability')).toHaveLength(0);
    });

    it('checks the selected account\'s domain and stores the result', async () => {
      const deliverability = { domain: 'example.com', spf: true, spfRecord: '', dkim: true, dkimSelector: '', mx: true, mxRecords: [], dmarc: true, dmarcRecord: '', dmarcPolicy: 'reject' as const };
      const fetchMock = stubFetch(async () => ({ json: async () => deliverability }));
      const { result } = renderHook(() => useAccountSettings());
      act(() => {
        result.current.setEmailAccounts([account({ email: 'main@example.com' })]);
        result.current.setSelectedAccountId('acct-1');
      });
      await act(async () => { await result.current.handleDeliverabilityCheck(); });
      expect(result.current.deliverabilityResult).toEqual(deliverability);
      const call = fetchMock.mock.calls.find(([url]) => url === '/api/deliverability');
      expect(call).toBeTruthy();
      const [, init] = call!;
      expect(JSON.parse((init as RequestInit).body as string)).toEqual({ domain: 'example.com' });
    });
  });

  describe('handleSignOffImageUpload', () => {
    it('does nothing when no file was chosen', async () => {
      const { result } = renderHook(() => useAccountSettings());
      await act(async () => { await result.current.handleSignOffImageUpload(makeChangeEvent(undefined)); });
      expect(result.current.signOffImage).toBeNull();
      expect(result.current.signOffImageError).toBe('');
    });

    it('rejects a non-image file with a visible error and leaves signOffImage untouched', async () => {
      const { result } = renderHook(() => useAccountSettings());
      const file = new File(['not an image'], 'notes.txt', { type: 'text/plain' });
      await act(async () => { await result.current.handleSignOffImageUpload(makeChangeEvent(file)); });
      expect(result.current.signOffImage).toBeNull();
      expect(result.current.signOffImageError).toBe('Please choose an image file.');
    });

    it('stores a small image directly, without touching Image/canvas at all', async () => {
      // Small enough that dataUrlByteSize(...) <= SIGN_OFF_IMAGE_MAX_BYTES, so the
      // implementation should short-circuit before ever constructing an Image.
      const imageCtor = vi.fn();
      vi.stubGlobal('Image', imageCtor);
      const { result } = renderHook(() => useAccountSettings());
      const file = new File(['tiny signature bytes'], 'sig.png', { type: 'image/png' });
      await act(async () => { await result.current.handleSignOffImageUpload(makeChangeEvent(file)); });
      expect(result.current.signOffImage).toMatch(/^data:image\/png;base64,/);
      expect(result.current.signOffImageError).toBe('');
      expect(imageCtor).not.toHaveBeenCalled();
    });

    it('downscales an oversized image, stepping dimensions down until the re-encoded PNG fits the cap', async () => {
      // Stand in for a large photo: file content alone decodes to well over the cap.
      const file = new File([base64OfSize(SIGN_OFF_IMAGE_MAX_BYTES * 3)], 'signature.png', { type: 'image/png' });

      // jsdom doesn't decode images at all (Image never fires load/error for a real
      // src), so both Image and canvas need stubbing to exercise this path.
      class FakeImage {
        naturalWidth = 3000;
        naturalHeight = 1500;
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(_v: string) { queueMicrotask(() => this.onload?.()); }
      }
      vi.stubGlobal('Image', FakeImage);

      // Each render's output "size" scales with requested canvas area, tuned so the
      // first pass (600x300, the un-stepped-down SIGN_OFF_IMAGE_MAX_EDGE) is still over
      // the cap and the second pass (after one 25% step-down) fits — exercising the
      // real step-down loop, not just a single pass.
      const toDataURL = vi.fn((canvas: { width: number; height: number }) => {
        const bytes = Math.floor(canvas.width * canvas.height * 1.7);
        return `data:image/png;base64,${base64OfSize(bytes)}`;
      });
      const realCreateElement = document.createElement.bind(document);
      const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        if (tag !== 'canvas') return realCreateElement(tag);
        const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: () => {} }), toDataURL: () => '' };
        canvas.toDataURL = () => toDataURL(canvas);
        return canvas as unknown as HTMLCanvasElement;
      });

      const { result } = renderHook(() => useAccountSettings());
      await act(async () => { await result.current.handleSignOffImageUpload(makeChangeEvent(file)); });

      expect(result.current.signOffImageError).toBe('');
      expect(result.current.signOffImage).toMatch(/^data:image\/png;base64,/);
      expect(dataUrlByteSize(result.current.signOffImage!)).toBeLessThanOrEqual(SIGN_OFF_IMAGE_MAX_BYTES);
      // More than one render pass was needed — confirms the step-down loop actually ran.
      expect(toDataURL.mock.calls.length).toBeGreaterThan(1);

      createElementSpy.mockRestore();
    });

    it('gives up with a clear, user-visible error when no amount of downscaling fits the cap', async () => {
      const file = new File([base64OfSize(SIGN_OFF_IMAGE_MAX_BYTES * 3)], 'signature.png', { type: 'image/png' });

      class FakeImage {
        naturalWidth = 3000;
        naturalHeight = 1500;
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(_v: string) { queueMicrotask(() => this.onload?.()); }
      }
      vi.stubGlobal('Image', FakeImage);

      // Always over the cap, no matter how small the requested canvas gets.
      const realCreateElement = document.createElement.bind(document);
      const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        if (tag !== 'canvas') return realCreateElement(tag);
        return {
          width: 0, height: 0,
          getContext: () => ({ drawImage: () => {} }),
          toDataURL: () => `data:image/png;base64,${base64OfSize(SIGN_OFF_IMAGE_MAX_BYTES * 2)}`,
        } as unknown as HTMLCanvasElement;
      });

      const { result } = renderHook(() => useAccountSettings());
      await act(async () => { await result.current.handleSignOffImageUpload(makeChangeEvent(file)); });

      expect(result.current.signOffImage).toBeNull();
      expect(result.current.signOffImageError).toMatch(/too large/i);

      createElementSpy.mockRestore();
    });

    it('clears a previous error once a new upload succeeds', async () => {
      const { result } = renderHook(() => useAccountSettings());
      const badFile = new File(['x'], 'notes.txt', { type: 'text/plain' });
      await act(async () => { await result.current.handleSignOffImageUpload(makeChangeEvent(badFile)); });
      expect(result.current.signOffImageError).not.toBe('');

      const goodFile = new File(['tiny'], 'sig.png', { type: 'image/png' });
      await act(async () => { await result.current.handleSignOffImageUpload(makeChangeEvent(goodFile)); });
      expect(result.current.signOffImageError).toBe('');
      expect(result.current.signOffImage).toMatch(/^data:image\/png;base64,/);
    });
  });
});

describe('fitWithinEdge', () => {
  it('leaves an image already within the cap untouched', () => {
    expect(fitWithinEdge(400, 200, 600)).toEqual({ width: 400, height: 200 });
  });

  it('scales the longest edge down to the cap, preserving aspect ratio', () => {
    expect(fitWithinEdge(3000, 1500, 600)).toEqual({ width: 600, height: 300 });
    expect(fitWithinEdge(1500, 3000, 600)).toEqual({ width: 300, height: 600 });
  });

  it('never upscales a small image', () => {
    expect(fitWithinEdge(100, 50, 600)).toEqual({ width: 100, height: 50 });
  });

  it('does not divide by zero for a degenerate zero-sized image', () => {
    expect(fitWithinEdge(0, 0, 600)).toEqual({ width: 0, height: 0 });
  });
});

describe('dataUrlByteSize', () => {
  it('matches the real decoded byte length of a small data URL', () => {
    const bytes = Buffer.from('hello world');
    const dataUrl = `data:image/png;base64,${bytes.toString('base64')}`;
    expect(dataUrlByteSize(dataUrl)).toBe(bytes.length);
  });

  it('accounts for base64 padding', () => {
    const bytes = Buffer.from('ab'); // 2 bytes -> base64 padded with one '='
    const dataUrl = `data:image/png;base64,${bytes.toString('base64')}`;
    expect(dataUrlByteSize(dataUrl)).toBe(2);
  });
});
