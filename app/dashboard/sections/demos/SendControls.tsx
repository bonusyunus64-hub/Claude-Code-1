import type { EmailAccount } from '../../types';

export interface SendControlsProps {
  useFollowUp: boolean;
  setUseFollowUp: (updater: (prev: boolean) => boolean) => void;
  subjectTestEnabled: boolean;
  demosSubjectB: string;
  handleSend: () => void;
  canSend: boolean;
  sending: boolean;
  sendResult: { sent: number; failed: number; total: number } | null;
  totalEmails: number;
  selectedAccount: EmailAccount | undefined;
  setActiveSection: (section: 'overview' | 'demos' | 'promotion' | 'account' | 'history') => void;
}

export function SendControls(props: SendControlsProps) {
  const {
    useFollowUp, setUseFollowUp, subjectTestEnabled, demosSubjectB, handleSend, canSend, sending,
    sendResult, totalEmails, selectedAccount, setActiveSection,
  } = props;

  return (
    <div className="space-y-3 pb-6">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <div
            onClick={() => setUseFollowUp(p => !p)}
            className={`relative w-9 h-5 rounded-full transition ${useFollowUp ? 'bg-violet-600' : 'bg-zinc-700'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${useFollowUp ? 'translate-x-4' : 'translate-x-0'}`} />
          </div>
          <span className="text-sm text-zinc-300">Send as follow-up</span>
        </label>
        {useFollowUp && (
          <span className="text-xs text-amber-400 bg-amber-600/15 border border-amber-600/30 px-2 py-0.5 rounded-full">Using follow-up template</span>
        )}
        {subjectTestEnabled && demosSubjectB.trim() && (
          useFollowUp ? (
            <span className="text-xs text-zinc-500">Subject line test is skipped for follow-up sends</span>
          ) : (
            <span className="text-xs text-violet-400 bg-violet-600/15 border border-violet-600/30 px-2 py-0.5 rounded-full">Testing 2 subject lines</span>
          )
        )}
      </div>
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <button onClick={handleSend} disabled={!canSend || sending}
          className="rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 px-6 py-3 font-semibold text-white transition focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 focus:ring-offset-zinc-950 text-sm">
          {sending ? `Sending... (${(sendResult?.sent ?? 0) + (sendResult?.failed ?? 0)}/${totalEmails})` : canSend ? `Send to ${totalEmails} recipient${totalEmails !== 1 ? 's' : ''}` : 'Preview recipients first'}
        </button>
        {selectedAccount ? (
          <span className="text-xs text-zinc-500">From <span className="text-zinc-300">{selectedAccount.name}</span> ({selectedAccount.email || selectedAccount.smtpUser})</span>
        ) : (
          <span className="text-xs text-amber-500">No email account — <button onClick={() => setActiveSection('account')} className="underline hover:text-amber-400">add one</button></span>
        )}
      </div>
    </div>
  );
}
