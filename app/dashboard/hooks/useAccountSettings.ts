'use client';

import { useState } from 'react';
import { syncStorage } from '@/lib/remoteSync';
import type { EmailAccount, NewAccountForm, DeliverabilityResult } from '../types';
import { DEFAULT_SIGN_OFF, BLANK_ACCOUNT } from '../constants';

/**
 * Accounts, sign-off, blacklist, failed-sends, send-pacing settings, and
 * deliverability — everything the Account tab owns, plus the handful of values
 * (signOff/signOffImage, blacklist, sendDelay, dailySendCap, sendsToday,
 * accountCapError, refreshSendsToday, recordFailedEmails, emailAccounts,
 * selectedAccountId) that the Demos/Radio/Playlists send flows and campaign
 * history read as config. Deliberately does NOT own the test-email feature: it
 * needs a sample artist from useDemosFlow's preview list, and useDemosFlow in
 * turn needs signOff/blacklist/etc. from here — putting both in the same hook
 * would make each require the other to exist first. Test email stays a
 * page.tsx-level function instead, the same way page.tsx already keeps
 * addOutsideArtistToContacts alongside customContacts for an analogous reason.
 *
 * Returns fields under the same names app/dashboard/sections/AccountSection.tsx's
 * props already use, so page.tsx can spread `{...account}` at the call site.
 */
export function useAccountSettings() {
  const [emailAccounts, setEmailAccounts] = useState<EmailAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [newAccount, setNewAccount] = useState<NewAccountForm>({ ...BLANK_ACCOUNT });
  const [savingAccount, setSavingAccount] = useState(false);
  const [accountError, setAccountError] = useState('');

  const [signOff, setSignOff] = useState(DEFAULT_SIGN_OFF);
  const [signOffImage, setSignOffImage] = useState<string | null>(null);

  const [sendDelay, setSendDelay] = useState(0);
  const [dailySendCap, setDailySendCap] = useState(0);
  const [autoFollowUpEnabled, setAutoFollowUpEnabled] = useState(false);
  const [autoFollowUpDays, setAutoFollowUpDays] = useState(5);
  const [sendsToday, setSendsToday] = useState(0);
  const [sendsTodayByAccount, setSendsTodayByAccount] = useState<Record<string, number>>({});

  const [blacklist, setBlacklist] = useState<string[]>([]);
  const [newBlacklistEmail, setNewBlacklistEmail] = useState('');

  // Emails that bounced/failed on a send — kept separate from the blacklist so they can
  // be reviewed (a failure can be a fluke) rather than silently blocked forever.
  const [failedEmails, setFailedEmails] = useState<string[]>([]);

  const [deliverabilityResult, setDeliverabilityResult] = useState<DeliverabilityResult | null>(null);
  const [deliverabilityLoading, setDeliverabilityLoading] = useState(false);

  // The cap is enforced server-side (see checkCapAllows in the send routes) against a
  // Redis counter, so after any send this just re-reads that counter rather than
  // keeping its own running total — one source of truth, no drift across tabs/devices.
  async function refreshSendsToday() {
    try {
      const res = await fetch('/api/send-quota');
      const data = await res.json();
      setSendsToday(data.count ?? 0);
      setSendsTodayByAccount(data.byAccount ?? {});
    } catch {}
  }

  async function addAccount() {
    if (!newAccount.name || !newAccount.smtpUser || !newAccount.smtpPass) return;
    setSavingAccount(true);
    setAccountError('');
    try {
      const res = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newAccount),
      });
      const data = await res.json();
      if (!res.ok) { setAccountError(data.error || 'Could not save account.'); return; }
      const account = data.account as EmailAccount;
      setEmailAccounts(prev => [...prev, account]);
      setSelectedAccountId(account.id);
      syncStorage.setItem('tp_selected_account', account.id);
      setShowAddAccount(false);
      setNewAccount({ ...BLANK_ACCOUNT });
    } catch {
      setAccountError('Network error. Please try again.');
    } finally {
      setSavingAccount(false);
    }
  }

  async function removeAccount(id: string) {
    const updated = emailAccounts.filter(a => a.id !== id);
    setEmailAccounts(updated);
    if (selectedAccountId === id) {
      const next = updated[0]?.id ?? '';
      setSelectedAccountId(next);
      syncStorage.setItem('tp_selected_account', next);
    }
    await fetch(`/api/accounts?id=${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
  }

  function selectAccount(id: string) {
    setSelectedAccountId(id);
    syncStorage.setItem('tp_selected_account', id);
  }

  function handleSignOffImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setSignOffImage(reader.result as string);
    reader.readAsDataURL(file);
  }

  function addToBlacklist() {
    const email = newBlacklistEmail.trim().toLowerCase();
    if (!email || blacklist.includes(email)) return;
    const updated = [...blacklist, email];
    setBlacklist(updated);
    syncStorage.setItem('tp_blacklist', JSON.stringify(updated));
    setNewBlacklistEmail('');
  }

  function removeFromBlacklist(email: string) {
    const updated = blacklist.filter(e => e !== email);
    setBlacklist(updated);
    syncStorage.setItem('tp_blacklist', JSON.stringify(updated));
  }

  function addFailedToBlacklist(emails: string[]) {
    const lower = emails.map(e => e.toLowerCase());
    const merged = [...new Set([...blacklist, ...lower])];
    setBlacklist(merged);
    syncStorage.setItem('tp_blacklist', JSON.stringify(merged));
  }

  function setDailyCap(value: number) {
    setDailySendCap(value);
    syncStorage.setItem('tp_daily_cap', String(value));
  }

  function setAutoFollowUp(enabled: boolean) {
    setAutoFollowUpEnabled(enabled);
    syncStorage.setItem('tp_auto_followup_enabled', String(enabled));
  }

  function setAutoFollowUpDaysValue(days: number) {
    setAutoFollowUpDays(days);
    syncStorage.setItem('tp_auto_followup_days', String(days));
  }

  function recordFailedEmails(emails: string[]) {
    if (!emails.length) return;
    setFailedEmails(prev => {
      const merged = [...new Set([...prev, ...emails.map(e => e.toLowerCase())])];
      syncStorage.setItem('tp_failed_emails', JSON.stringify(merged));
      return merged;
    });
  }

  function removeFromFailedEmails(email: string) {
    setFailedEmails(prev => {
      const updated = prev.filter(e => e !== email);
      syncStorage.setItem('tp_failed_emails', JSON.stringify(updated));
      return updated;
    });
  }

  function moveFailedToDoNotContact(email: string) {
    addFailedToBlacklist([email]);
    removeFromFailedEmails(email);
  }

  /**
   * Client-side mirror of the per-account check in lib/sendQuota.ts's
   * checkCapAllows — lets a send be blocked before any network request instead of
   * only after the server rejects the first batch. The server still enforces this
   * independently, since sendsTodayByAccount here can be stale.
   */
  function accountCapError(accountId: string, additionalSends: number): string | null {
    const account = emailAccounts.find(a => a.id === accountId);
    const cap = account?.dailyCap ?? 0;
    if (cap <= 0) return null;
    const sentSoFar = sendsTodayByAccount[accountId] ?? 0;
    if (sentSoFar + additionalSends <= cap) return null;
    return `This account has reached its daily limit (${sentSoFar}/${cap} sent today). Switch accounts, wait until tomorrow, or raise its limit in Account settings.`;
  }

  async function handleDeliverabilityCheck() {
    const acc = emailAccounts.find(a => a.id === selectedAccountId);
    const emailAddr = acc?.email || acc?.smtpUser;
    if (!emailAddr) return;
    const domain = emailAddr.split('@')[1];
    if (!domain) return;
    setDeliverabilityLoading(true); setDeliverabilityResult(null);
    try {
      const res = await fetch('/api/deliverability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain }),
      });
      const data = await res.json();
      setDeliverabilityResult(data);
    } catch {}
    finally { setDeliverabilityLoading(false); }
  }

  const selectedAccount = emailAccounts.find(a => a.id === selectedAccountId);

  return {
    emailAccounts, setEmailAccounts, selectedAccountId, setSelectedAccountId, selectAccount, removeAccount,
    showAddAccount, setShowAddAccount, newAccount, setNewAccount, addAccount, savingAccount, accountError, setAccountError,

    signOff, setSignOff, signOffImage, setSignOffImage, handleSignOffImageUpload,

    blacklist, setBlacklist, newBlacklistEmail, setNewBlacklistEmail, addToBlacklist, removeFromBlacklist, addFailedToBlacklist,

    failedEmails, setFailedEmails, moveFailedToDoNotContact, removeFromFailedEmails, recordFailedEmails,

    sendDelay, setSendDelay,
    dailySendCap, setDailySendCap, setDailyCap, sendsToday, setSendsToday, sendsTodayByAccount, setSendsTodayByAccount, refreshSendsToday,
    autoFollowUpEnabled, setAutoFollowUpEnabled, setAutoFollowUp, autoFollowUpDays, setAutoFollowUpDays, setAutoFollowUpDaysValue,

    accountCapError,

    selectedAccount, deliverabilityLoading, handleDeliverabilityCheck, deliverabilityResult,
  };
}
