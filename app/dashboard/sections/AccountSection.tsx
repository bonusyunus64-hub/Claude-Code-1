import type { EmailAccount, NewAccountForm, DeliverabilityResult } from '../types';
import { DEFAULT_SIGN_OFF, SEND_DELAY_OPTIONS, DAILY_CAP_OPTIONS, BLANK_ACCOUNT } from '../constants';
import { syncStorage } from '@/lib/remoteSync';

export interface AccountSectionProps {
  emailAccounts: EmailAccount[];
  selectedAccountId: string;
  selectAccount: (id: string) => void;
  removeAccount: (id: string) => void;
  showAddAccount: boolean;
  setShowAddAccount: (show: boolean) => void;
  newAccount: NewAccountForm;
  setNewAccount: React.Dispatch<React.SetStateAction<NewAccountForm>>;
  addAccount: () => void;
  savingAccount: boolean;
  accountError: string;
  setAccountError: (error: string) => void;

  signOff: string;
  setSignOff: (value: string) => void;
  signOffImage: string | null;
  setSignOffImage: (value: string | null) => void;
  handleSignOffImageUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;

  blacklist: string[];
  newBlacklistEmail: string;
  setNewBlacklistEmail: (value: string) => void;
  addToBlacklist: () => void;
  removeFromBlacklist: (email: string) => void;

  failedEmails: string[];
  moveFailedToDoNotContact: (email: string) => void;
  removeFromFailedEmails: (email: string) => void;

  sendDelay: number;
  setSendDelay: (value: number) => void;

  dailySendCap: number;
  setDailyCap: (value: number) => void;
  sendsToday: number;
  sendsTodayByAccount: Record<string, number>;

  testEmailTo: string;
  setTestEmailTo: (value: string) => void;
  testEmailSending: boolean;
  handleTestEmail: () => void;
  showTestEmailOptions: boolean;
  setShowTestEmailOptions: (updater: (prev: boolean) => boolean) => void;
  testEmailSubject: string;
  setTestEmailSubject: (value: string) => void;
  testEmailMessage: string;
  setTestEmailMessage: (value: string) => void;
  demosSubject: string;
  demosTemplate: string;
  testEmailResult: 'success' | 'error' | null;
  setTestEmailResult: (result: 'success' | 'error' | null) => void;
  testEmailError: string;

  selectedAccount: EmailAccount | undefined;
  deliverabilityLoading: boolean;
  handleDeliverabilityCheck: () => void;
  deliverabilityResult: DeliverabilityResult | null;
}

export function AccountSection(props: AccountSectionProps) {
  const {
    emailAccounts, selectedAccountId, selectAccount, removeAccount,
    showAddAccount, setShowAddAccount, newAccount, setNewAccount, addAccount, savingAccount, accountError, setAccountError,
    signOff, setSignOff, signOffImage, setSignOffImage, handleSignOffImageUpload,
    blacklist, newBlacklistEmail, setNewBlacklistEmail, addToBlacklist, removeFromBlacklist,
    failedEmails, moveFailedToDoNotContact, removeFromFailedEmails,
    sendDelay, setSendDelay,
    dailySendCap, setDailyCap, sendsToday, sendsTodayByAccount,
    testEmailTo, setTestEmailTo, testEmailSending, handleTestEmail,
    showTestEmailOptions, setShowTestEmailOptions, testEmailSubject, setTestEmailSubject,
    testEmailMessage, setTestEmailMessage, demosSubject, demosTemplate, testEmailResult, setTestEmailResult, testEmailError,
    selectedAccount, deliverabilityLoading, handleDeliverabilityCheck, deliverabilityResult,
  } = props;

  return (
    <div className="space-y-6 pb-6">
      {/* Email Accounts */}
      <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 md:p-6 space-y-4">
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Email Accounts</h2>
        {emailAccounts.length > 0 && (
          <div className="space-y-2">
            {emailAccounts.map(acc => (
              <div key={acc.id} onClick={() => selectAccount(acc.id)}
                className={`flex items-center justify-between gap-3 px-4 py-3 rounded-lg border cursor-pointer transition ${
                  selectedAccountId === acc.id ? 'border-violet-500 bg-violet-600/10' : 'border-zinc-700 bg-zinc-800 hover:border-zinc-600'
                }`}>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white">{acc.name}</p>
                  <p className="text-xs text-zinc-400 truncate">{acc.email || acc.smtpUser} · {acc.smtpHost}:{acc.smtpPort}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {selectedAccountId === acc.id && <span className="text-xs text-violet-400 font-medium">Active</span>}
                  <button onClick={e => { e.stopPropagation(); removeAccount(acc.id); }}
                    className="text-zinc-600 hover:text-red-400 transition text-lg leading-none">×</button>
                </div>
              </div>
            ))}
          </div>
        )}
        {emailAccounts.length === 0 && !showAddAccount && (
          <p className="text-sm text-zinc-500">No accounts added yet.</p>
        )}
        {!showAddAccount ? (
          <button onClick={() => setShowAddAccount(true)} className="text-sm text-violet-400 hover:text-violet-300 transition">
            + Add email account
          </button>
        ) : (
          <div className="border border-zinc-700 rounded-xl p-4 space-y-3">
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">New Account</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                { label: 'Display Name', key: 'name', placeholder: 'e.g. Work Email', type: 'text' },
                { label: 'From Address', key: 'email', placeholder: 'you@example.com', type: 'email' },
                { label: 'SMTP Host', key: 'smtpHost', placeholder: 'smtp.zoho.com', type: 'text' },
                { label: 'Port', key: 'smtpPort', placeholder: '465', type: 'text' },
                { label: 'SMTP Username', key: 'smtpUser', placeholder: 'your@email.com', type: 'text' },
                { label: 'Password / App Password', key: 'smtpPass', placeholder: '••••••••', type: 'password' },
              ].map(({ label, key, placeholder, type }) => (
                <div key={key}>
                  <label className="block text-xs text-zinc-400 mb-1">{label}</label>
                  <input
                    type={type}
                    value={newAccount[key as keyof typeof newAccount]}
                    onChange={e => setNewAccount(p => ({ ...p, [key]: e.target.value }))}
                    placeholder={placeholder}
                    className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent" />
                </div>
              ))}
            </div>
            <p className="text-xs text-zinc-500">For Gmail use an App Password. For Zoho use your account password or an app-specific password.</p>
            {accountError && <p className="text-xs text-red-400">{accountError}</p>}
            <div className="flex gap-2 pt-1">
              <button onClick={addAccount} disabled={!newAccount.name || !newAccount.smtpUser || !newAccount.smtpPass || savingAccount}
                className="rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 px-4 py-2 text-sm font-semibold text-white transition">
                {savingAccount ? 'Saving…' : 'Save Account'}
              </button>
              <button onClick={() => { setShowAddAccount(false); setNewAccount({ ...BLANK_ACCOUNT }); setAccountError(''); }}
                className="rounded-lg bg-zinc-800 hover:bg-zinc-700 px-4 py-2 text-sm text-zinc-300 transition">
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Sign-off */}
      <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 md:p-6 space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-1">Sign-off</h2>
          <p className="text-xs text-zinc-500">Appended after every email body. Used for both Song Demos and Track Promotion.</p>
        </div>
        <textarea value={signOff} onChange={e => setSignOff(e.target.value)} rows={3}
          className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-3 text-sm text-white font-mono focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition resize-y" />
        {signOffImage ? (
          <div className="flex items-start gap-3 pt-1">
            <img src={signOffImage} alt="Signature" className="max-h-20 max-w-xs rounded border border-zinc-700 object-contain bg-zinc-800" />
            <button onClick={() => setSignOffImage(null)} className="text-xs text-red-400 hover:text-red-300 transition mt-1">Remove image</button>
          </div>
        ) : (
          <label className="inline-flex items-center gap-2 cursor-pointer px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 hover:border-zinc-500 text-xs text-zinc-300 transition w-fit">
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            Upload signature image
            <input type="file" accept="image/*" className="hidden" onChange={handleSignOffImageUpload} />
          </label>
        )}
        <button onClick={() => setSignOff(DEFAULT_SIGN_OFF)} className="text-xs text-zinc-500 hover:text-zinc-300 transition">Reset to default</button>
      </section>

      {/* Blacklist */}
      <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 md:p-6 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-1">Do Not Contact</h2>
          <p className="text-xs text-zinc-500">Emails on this list are skipped from all sends.</p>
        </div>
        <div className="flex gap-2">
          <input
            type="email"
            value={newBlacklistEmail}
            onChange={e => setNewBlacklistEmail(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addToBlacklist(); }}
            placeholder="email@example.com"
            className="flex-1 rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-2.5 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition text-sm"
          />
          <button onClick={addToBlacklist} disabled={!newBlacklistEmail}
            className="rounded-lg bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 px-4 py-2.5 text-sm font-semibold text-white transition shrink-0">
            Add
          </button>
        </div>
        {blacklist.length > 0 ? (
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {blacklist.map(email => (
              <div key={email} className="flex items-center justify-between px-3 py-2 bg-zinc-800 rounded-lg">
                <span className="text-xs text-zinc-300 font-mono">{email}</span>
                <button onClick={() => removeFromBlacklist(email)} className="text-zinc-600 hover:text-red-400 transition text-lg leading-none ml-3">×</button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-zinc-600">No blocked emails.</p>
        )}
      </section>

      {/* Potential False Emails */}
      <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 md:p-6 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-1">Potential False Emails</h2>
          <p className="text-xs text-zinc-500">Addresses that bounced or failed on a send land here automatically — review them, then move to Do Not Contact or dismiss if it was a fluke.</p>
        </div>
        {failedEmails.length > 0 ? (
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {failedEmails.map(email => (
              <div key={email} className="flex items-center justify-between px-3 py-2 bg-zinc-800 rounded-lg gap-3">
                <span className="text-xs text-zinc-300 font-mono truncate">{email}</span>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => moveFailedToDoNotContact(email)}
                    className="text-xs text-amber-400 hover:text-amber-300 transition whitespace-nowrap">Do Not Contact</button>
                  <button onClick={() => removeFromFailedEmails(email)} className="text-zinc-600 hover:text-red-400 transition text-lg leading-none">×</button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-zinc-600">No failed sends recorded.</p>
        )}
      </section>

      {/* Send Rate Limiter */}
      <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 md:p-6 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-1">Send Rate</h2>
          <p className="text-xs text-zinc-500">Delay between each email to avoid triggering spam filters.</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {SEND_DELAY_OPTIONS.map(opt => (
            <button key={opt.value}
              onClick={() => { setSendDelay(opt.value); syncStorage.setItem('tp_send_delay', String(opt.value)); }}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${sendDelay === opt.value ? 'bg-violet-600 border-violet-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white'}`}>
              {opt.label}
            </button>
          ))}
        </div>
        {sendDelay > 0 && (
          <p className="text-xs text-zinc-500">{sendDelay / 1000}s delay between each email.</p>
        )}
      </section>

      {/* Daily Send Limit */}
      <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 md:p-6 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-1">Daily Send Limit</h2>
          <p className="text-xs text-zinc-500">Cap how many emails can be sent per day across all campaigns.</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {DAILY_CAP_OPTIONS.map(opt => (
            <button key={opt.value}
              onClick={() => setDailyCap(opt.value)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${dailySendCap === opt.value ? 'bg-violet-600 border-violet-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white'}`}>
              {opt.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-zinc-500">
          {dailySendCap > 0 ? `${sendsToday} of ${dailySendCap} sent today.` : `${sendsToday} sent today. No limit set.`}
        </p>
        {emailAccounts.length > 1 && sendsToday > 0 && (
          <div className="space-y-1 pt-1 border-t border-zinc-800">
            <p className="text-xs text-zinc-600 uppercase tracking-wider pt-2">By account</p>
            {emailAccounts.map(acc => (
              <div key={acc.id} className="flex items-center justify-between text-xs text-zinc-400">
                <span>{acc.name || acc.email}</span>
                <span className="font-mono text-zinc-300">{sendsTodayByAccount[acc.id] ?? 0}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Test Email */}
      <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 md:p-6 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-1">Send Test Email</h2>
          <p className="text-xs text-zinc-500">Confirm your email account is connected and working.</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="email"
            value={testEmailTo}
            onChange={e => { setTestEmailTo(e.target.value); setTestEmailResult(null); }}
            placeholder="recipient@example.com"
            className="flex-1 rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-2.5 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition text-sm"
          />
          <button
            onClick={handleTestEmail}
            disabled={!testEmailTo || testEmailSending || !selectedAccountId}
            className="rounded-lg bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 px-4 py-2.5 text-sm font-semibold text-white transition sm:shrink-0"
          >
            {testEmailSending ? 'Sending...' : 'Send'}
          </button>
        </div>

        <div>
          <button
            onClick={() => setShowTestEmailOptions(p => !p)}
            className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 transition"
          >
            Optional: customize subject &amp; message
            <span className={`transition-transform inline-block ${showTestEmailOptions ? 'rotate-180' : ''}`}>▾</span>
          </button>
          {showTestEmailOptions && (
            <div className="mt-3 space-y-3 rounded-lg bg-zinc-800/50 border border-zinc-800 p-3">
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">Subject</label>
                <input
                  type="text"
                  value={testEmailSubject}
                  onChange={e => setTestEmailSubject(e.target.value)}
                  placeholder={demosSubject}
                  className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">Message</label>
                <textarea
                  value={testEmailMessage}
                  onChange={e => setTestEmailMessage(e.target.value)}
                  placeholder={demosTemplate}
                  rows={6}
                  className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-600 font-mono focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition resize-y"
                />
              </div>
              <p className="text-xs text-zinc-600">Leave blank to send your Song Demos template as-is. Both support the same {'{{variables}}'}.</p>
            </div>
          )}
        </div>

        {testEmailResult === 'success' && <p className="text-sm text-green-400">Test email sent successfully. Check your inbox.</p>}
        {testEmailResult === 'error' && <p className="text-sm text-red-400">{testEmailError}</p>}
        {!selectedAccountId && <p className="text-xs text-amber-500">Add and select an email account above first.</p>}
      </section>

      {/* Deliverability Checker */}
      <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 md:p-6 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-1">Deliverability Check</h2>
          <p className="text-xs text-zinc-500">Checks SPF, DKIM, and MX DNS records for your sending domain.</p>
        </div>
        {selectedAccount ? (
          <div className="space-y-4">
            <p className="text-xs text-zinc-400">
              Domain: <span className="text-zinc-200 font-mono">{(selectedAccount.email || selectedAccount.smtpUser).split('@')[1]}</span>
            </p>
            <button
              onClick={handleDeliverabilityCheck}
              disabled={deliverabilityLoading}
              className="rounded-lg bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 px-4 py-2.5 text-sm font-semibold text-white transition"
            >
              {deliverabilityLoading ? 'Checking...' : 'Run Check'}
            </button>
            {deliverabilityResult && (
              <div className="space-y-2">
                {[
                  {
                    label: 'SPF',
                    pass: deliverabilityResult.spf,
                    detail: deliverabilityResult.spf ? deliverabilityResult.spfRecord : 'No SPF record found',
                  },
                  {
                    label: 'DKIM',
                    pass: deliverabilityResult.dkim,
                    detail: deliverabilityResult.dkim ? `Selector: ${deliverabilityResult.dkimSelector}` : 'No DKIM record found',
                  },
                  {
                    label: 'MX',
                    pass: deliverabilityResult.mx,
                    detail: deliverabilityResult.mx ? deliverabilityResult.mxRecords.join(', ') : 'No MX records found',
                  },
                ].map(item => (
                  <div key={item.label} className={`flex items-start gap-3 px-4 py-3 rounded-lg border ${item.pass ? 'border-green-700/50 bg-green-900/10' : 'border-red-700/50 bg-red-900/10'}`}>
                    <span className={`text-lg leading-none mt-0.5 ${item.pass ? 'text-green-400' : 'text-red-400'}`}>
                      {item.pass ? '✓' : '✗'}
                    </span>
                    <div className="min-w-0">
                      <p className={`text-sm font-semibold ${item.pass ? 'text-green-400' : 'text-red-400'}`}>{item.label}</p>
                      <p className="text-xs text-zinc-400 mt-0.5 break-all">{item.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-amber-500">Select an email account above to check its domain.</p>
        )}
      </section>
    </div>
  );
}
