import { DEFAULT_MULTI_ARTIST_TEMPLATE, DEFAULT_MULTI_ARTIST_SUBJECT } from '../../constants';
import { CopyChip } from '../../components/CopyChip';
import { SpamScoreBadge } from '../../components/SpamScoreBadge';

export interface MultiArtistTemplatePanelProps {
  demosMultiArtistSubject: string;
  setDemosMultiArtistSubject: (value: string) => void;
  demosMultiArtistTemplate: string;
  setDemosMultiArtistTemplate: (value: string) => void;
}

// Deliberately no saved-template library here (contrast FollowUpTemplatePanel's
// SavedItemList + newFollowUpTemplateName): this is a single template with no
// variants to switch between yet, and wiring up a second full save/load/delete
// library (its own SavedItemList instance, a name-draft field, its own
// syncStorage key) would roughly double this panel's plumbing for a feature
// nobody's asked for on a template that didn't exist before this phase. Add
// one later if a real need for saved multi-artist variants shows up.
export function MultiArtistTemplatePanel(props: MultiArtistTemplatePanelProps) {
  const {
    demosMultiArtistSubject, setDemosMultiArtistSubject, demosMultiArtistTemplate, setDemosMultiArtistTemplate,
  } = props;

  return (
    <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 md:p-6 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-1">Shared-Manager Template</h2>
        <p className="text-xs text-zinc-500 mb-2">
          Used instead of the main pitch above whenever one manager represents 2 or more of the artists this
          campaign matched, so that manager gets a single email naming everyone they rep, rather than an email
          about just one of their artists with no mention of the rest. {'{{artistSummary}}'} is the ready-to-use
          phrase for this: it reads as &ldquo;Nori, Cayo and Rence&rdquo; when there are three or fewer, and
          &ldquo;Nori, Cayo, Rence and 4 others&rdquo; once there are more than that. {'{{artistNames}}'} is the
          plainer version of the same list &mdash; just the names, capped the same way, but without that
          &ldquo;and N others&rdquo; count added on, in case you&rsquo;d rather phrase the overflow yourself. Click a
          variable to copy it:
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {['{{managerName}}', '{{artistSummary}}', '{{artistNames}}', '{{artistCount}}', '{{otherCount}}', '{{trackTitle}}', '{{driveLink}}', '{{senderName}}'].map(v => (
          <CopyChip key={v} value={v} />
        ))}
      </div>
      <div>
        <label className="block text-xs font-medium text-zinc-400 mb-1.5">Subject line</label>
        <input type="text" value={demosMultiArtistSubject} onChange={e => setDemosMultiArtistSubject(e.target.value)}
          className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-2.5 text-sm text-white font-mono focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition" />
      </div>
      <textarea value={demosMultiArtistTemplate} onChange={e => setDemosMultiArtistTemplate(e.target.value)} rows={12}
        className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-3 text-sm text-white font-mono focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition resize-y" />
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <button onClick={() => { setDemosMultiArtistTemplate(DEFAULT_MULTI_ARTIST_TEMPLATE); setDemosMultiArtistSubject(DEFAULT_MULTI_ARTIST_SUBJECT); }} className="text-xs text-zinc-500 hover:text-zinc-300 transition">
          Reset to default
        </button>
        <SpamScoreBadge template={demosMultiArtistTemplate} />
      </div>
    </section>
  );
}
