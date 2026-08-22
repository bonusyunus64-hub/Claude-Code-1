import { NAMED_ARTIST_CAP, type ManagerGroup } from '@/lib/artistFit';
import type { Artist } from '../../types';

// How many offending managers the banner names individually before collapsing
// the rest into a "+N more" line — same reasoning as NAMED_ARTIST_CAP itself:
// one of these campaigns can have dozens of over-cap managers, and listing
// all of them would push the Send button off screen.
const OVER_CAP_LIST_DISPLAY_CAP = 5;

export interface SendWarningsProps {
  trackTitle: string;
  demosDuplicateRecipients: string[];
  cooldownRecipients: string[];
  contactCooldownDays: number;
  overCapManagers: ManagerGroup<Artist>[];
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
    trackTitle, demosDuplicateRecipients, cooldownRecipients, contactCooldownDays, overCapManagers,
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

      {!sendResult && overCapManagers.length > 0 && (
        <div className="rounded-lg bg-amber-900/20 border border-amber-700/40 px-5 py-3 space-y-2">
          <p className="text-amber-400 text-sm">
            {overCapManagers.length} manager{overCapManagers.length !== 1 ? 's rep' : ' reps'} more than {NAMED_ARTIST_CAP} of your matched artists — their email will name {NAMED_ARTIST_CAP} and count the rest.
          </p>
          <ul className="text-amber-400/80 text-xs space-y-0.5">
            {overCapManagers.slice(0, OVER_CAP_LIST_DISPLAY_CAP).map(group => (
              <li key={group.email}>
                {group.managerName ? `${group.managerName} <${group.email}>` : group.email} — {group.artists.length} artist{group.artists.length !== 1 ? 's' : ''}
              </li>
            ))}
            {overCapManagers.length > OVER_CAP_LIST_DISPLAY_CAP && (
              <li>+{overCapManagers.length - OVER_CAP_LIST_DISPLAY_CAP} more</li>
            )}
          </ul>
          <p className="text-amber-400 text-sm">
            Narrowing your genre selection will bring these counts down. You can still send.
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
