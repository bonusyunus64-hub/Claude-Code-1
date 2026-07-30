import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const syncStorage = vi.hoisted(() => ({ setItem: vi.fn(), removeItem: vi.fn() }));
vi.mock('@/lib/remoteSync', () => ({ syncStorage }));

import { useAccountSettings } from './useAccountSettings';
import type { EmailAccount } from '../types';

function account(overrides: Partial<EmailAccount> = {}): EmailAccount {
  return { id: 'acct-1', name: 'Main', email: 'main@example.com', smtpHost: 'smtp.zoho.com', smtpPort: '465', smtpUser: 'main@example.com', ...overrides };
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
    it('adds a trimmed, lowercased address and clears the input', () => {
      const { result } = renderHook(() => useAccountSettings());
      act(() => result.current.setNewBlacklistEmail('  Manager@Example.com  '));
      act(() => result.current.addToBlacklist());
      expect(result.current.blacklist).toEqual(['manager@example.com']);
      expect(result.current.newBlacklistEmail).toBe('');
    });

    it('does not add a blank or already-present address', () => {
      const { result } = renderHook(() => useAccountSettings());
      act(() => result.current.setNewBlacklistEmail(''));
      act(() => result.current.addToBlacklist());
      expect(result.current.blacklist).toEqual([]);

      act(() => result.current.setBlacklist(['manager@example.com']));
      act(() => result.current.setNewBlacklistEmail('manager@example.com'));
      act(() => result.current.addToBlacklist());
      expect(result.current.blacklist).toEqual(['manager@example.com']);
    });

    it('removes an address from the blacklist', () => {
      const { result } = renderHook(() => useAccountSettings());
      act(() => result.current.setBlacklist(['a@example.com', 'b@example.com']));
      act(() => result.current.removeFromBlacklist('a@example.com'));
      expect(result.current.blacklist).toEqual(['b@example.com']);
    });

    it('addFailedToBlacklist merges, lowercases, and dedupes against the existing list', () => {
      const { result } = renderHook(() => useAccountSettings());
      act(() => result.current.setBlacklist(['existing@example.com']));
      act(() => result.current.addFailedToBlacklist(['New@Example.com', 'existing@example.com']));
      expect(result.current.blacklist.sort()).toEqual(['existing@example.com', 'new@example.com']);
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
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const { result } = renderHook(() => useAccountSettings());
      await act(async () => { await result.current.addAccount(); });
      expect(fetchMock).not.toHaveBeenCalled();
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
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const { result } = renderHook(() => useAccountSettings());
      await act(async () => { await result.current.handleDeliverabilityCheck(); });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('checks the selected account\'s domain and stores the result', async () => {
      const deliverability = { domain: 'example.com', spf: true, spfRecord: '', dkim: true, dkimSelector: '', mx: true, mxRecords: [], dmarc: true, dmarcRecord: '', dmarcPolicy: 'reject' as const };
      const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<{ json: () => Promise<unknown> }>>()
        .mockImplementation(async () => ({ json: async () => deliverability }));
      vi.stubGlobal('fetch', fetchMock);
      const { result } = renderHook(() => useAccountSettings());
      act(() => {
        result.current.setEmailAccounts([account({ email: 'main@example.com' })]);
        result.current.setSelectedAccountId('acct-1');
      });
      await act(async () => { await result.current.handleDeliverabilityCheck(); });
      expect(result.current.deliverabilityResult).toEqual(deliverability);
      const [, init] = fetchMock.mock.calls[0];
      expect(JSON.parse((init as RequestInit).body as string)).toEqual({ domain: 'example.com' });
    });
  });
});
