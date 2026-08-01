export interface SendWarningsProps {
  trackTitle: string;
  demosDuplicateRecipients: string[];
  cooldownRecipients: string[];
  contactCooldownDays: number;
  demosInvalidEmails: string[];
  setDemosInvalidEmails: (emails: string[]) => void;
  addFailedToBlacklist: (emails: string[]) => void;
  sendResult: { sent: number; failed: number; total: number } | null;
  sendFailedEmails: string[];
  setSendFailedEmails: (emails: string[]) => void;
  sendError: string;
}

export function SendWarnings(props: SendWarningsProps) {
  const {
    trackTitle, demosDuplicateRecipients, cooldownRecipients, contactCooldownDays,
    demosInvalidEmails, setDemosInvalidEmails, addFailedToBlacklist,
    sendResult, sendFailedEmails, setSendFailedEmails, sendError,
  } = props;

  return (
    <>
      {!sendResult && demosDuplicateRecipients.length > 0 && (
        <div className="rounded-lg bg-amber-900/20 border border-amber-700/40 px-5 py-3">
          <p className="text-amber-400 text-sm">
            {demosDuplicateRecipients.length} recipient{demosDuplicateRecipients.length !== 1 ? 's have' : ' has'} already been pitched &ldquo;{trackTitle}&rdquo; before (via Song Demos or Track Promotion). You can still send.
          </p>
        </div>
      )}

      {!sendResult && cooldownRecipients.length > 0 && (
        <div className="rounded-lg bg-amber-900/20 border border-amber-700/40 px-5 py-3">
          <p className="text-amber-400 text-sm">
            {cooldownRecipients.length} recipient{cooldownRecipients.length !== 1 ? 's were' : ' was'} contacted within the last {contactCooldownDays} day{contactCooldownDays !== 1 ? 's' : ''} (a different track, via Song Demos or Track Promotion). You can still send.
          </p>
        </div>
      )}

      {!sendResult && demosInvalidEmails.length > 0 && (
        <div className="rounded-lg bg-red-900/20 border border-red-700/40 px-5 py-3 space-y-2">
          <p className="text-red-400 text-sm">
            {demosInvalidEmails.length} address{demosInvalidEmails.length !== 1 ? 'es' : ''} {demosInvalidEmails.length !== 1 ? "don't" : "doesn't"} look deliverable (no working mail server found) and will likely bounce.
          </p>
          <button onClick={() => { addFailedToBlacklist(demosInvalidEmails); setDemosInvalidEmails([]); }}
            className="text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 px-3 py-1.5 rounded-lg text-zinc-300 transition">
            Add {demosInvalidEmails.length} address{demosInvalidEmails.length !== 1 ? 'es' : ''} to blacklist
          </button>
        </div>
      )}

      {sendResult && (
        <div className="rounded-lg bg-green-900/30 border border-green-700 px-5 py-4 space-y-2">
          <p className="text-green-400 font-semibold">
            Sent {sendResult.sent} of {sendResult.total} emails successfully.
            {sendResult.failed > 0 && ` ${sendResult.failed} failed.`}
          </p>
          {sendFailedEmails.length > 0 && (
            <button onClick={() => { addFailedToBlacklist(sendFailedEmails); setSendFailedEmails([]); }}
              className="text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 px-3 py-1.5 rounded-lg text-zinc-300 transition">
              Add {sendFailedEmails.length} failed address{sendFailedEmails.length !== 1 ? 'es' : ''} to blacklist
            </button>
          )}
        </div>
      )}
      {sendError && (
        <div className="rounded-lg bg-red-900/30 border border-red-700 px-5 py-4">
          <p className="text-red-400 text-sm">{sendError}</p>
        </div>
      )}
    </>
  );
}
