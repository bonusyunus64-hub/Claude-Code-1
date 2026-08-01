import type { SavedTemplate } from '../../types';
import { DEFAULT_DEMOS_TEMPLATE, DEFAULT_DEMOS_SUBJECT } from '../../constants';
import { CopyChip } from '../../components/CopyChip';
import { SpamScoreBadge } from '../../components/SpamScoreBadge';
import { SavedItemList } from './SavedItemList';

export interface MainTemplatePanelProps {
  demosSubject: string;
  setDemosSubject: (value: string) => void;
  demosSubjectB: string;
  setDemosSubjectB: (value: string) => void;
  subjectTestEnabled: boolean;
  setSubjectTestEnabled: (updater: (prev: boolean) => boolean) => void;
  demosTemplate: string;
  setDemosTemplate: (value: string) => void;
  demosTemplateLibrary: SavedTemplate[];
  newDemosTemplateName: string;
  setNewDemosTemplateName: (value: string) => void;
  saveDemosTemplateToLibrary: () => void;
  loadDemosTemplateFromLibrary: (template: SavedTemplate) => void;
  deleteDemosTemplateFromLibrary: (id: string) => void;
}

export function MainTemplatePanel(props: MainTemplatePanelProps) {
  const {
    demosSubject, setDemosSubject, demosSubjectB, setDemosSubjectB, subjectTestEnabled, setSubjectTestEnabled,
    demosTemplate, setDemosTemplate, demosTemplateLibrary,
    newDemosTemplateName, setNewDemosTemplateName, saveDemosTemplateToLibrary, loadDemosTemplateFromLibrary, deleteDemosTemplateFromLibrary,
  } = props;

  return (
    <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 md:p-6 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-1">Main Template</h2>
        <p className="text-sm text-zinc-500 mb-2">Click a variable to copy it:</p>
        <div className="flex flex-wrap gap-1.5">
          {['{{managerName}}', '{{artistName}}', '{{trackTitle}}', '{{driveLink}}', '{{senderName}}', '{{managementCompany}}', '{{pronoun}}'].map(v => (
            <CopyChip key={v} value={v} />
          ))}
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-zinc-400 mb-1.5">Subject line{subjectTestEnabled ? ' (A)' : ''}</label>
        <input type="text" value={demosSubject} onChange={e => setDemosSubject(e.target.value)}
          className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-2.5 text-sm text-white font-mono focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition" />
        {subjectTestEnabled && <div className="mt-1.5"><SpamScoreBadge template={demosSubject} /></div>}
      </div>
      <div className="space-y-2">
        <label className="flex items-center gap-2 cursor-pointer select-none w-fit">
          <div
            onClick={() => setSubjectTestEnabled(p => !p)}
            className={`relative w-9 h-5 rounded-full transition ${subjectTestEnabled ? 'bg-violet-600' : 'bg-zinc-700'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${subjectTestEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
          </div>
          <span className="text-xs text-zinc-400">Test a second subject line</span>
        </label>
        {subjectTestEnabled && (
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-zinc-400">Subject line (B)</label>
            <input type="text" value={demosSubjectB} onChange={e => setDemosSubjectB(e.target.value)}
              placeholder="Try a different subject line here"
              className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-2.5 text-sm text-white font-mono placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition" />
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-xs text-zinc-500 max-w-md">
                About half your recipients will get Subject A, half will get Subject B — split by their email address, so it stays the same person-to-subject match up even if you send in several batches. Check the Overview tab after sending to see which one got more replies.
              </p>
              {demosSubjectB.trim() && <SpamScoreBadge template={demosSubjectB} />}
            </div>
          </div>
        )}
      </div>
      <textarea value={demosTemplate} onChange={e => setDemosTemplate(e.target.value)} rows={14}
        className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-3 text-sm text-white font-mono focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition resize-y" />
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <button onClick={() => { setDemosTemplate(DEFAULT_DEMOS_TEMPLATE); setDemosSubject(DEFAULT_DEMOS_SUBJECT); }} className="text-xs text-zinc-500 hover:text-zinc-300 transition">
          Reset to default
        </button>
        <SpamScoreBadge template={demosTemplate} />
      </div>
      <div className="pt-3 border-t border-zinc-800 space-y-3">
        <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Saved Templates</h3>
        <SavedItemList
          items={demosTemplateLibrary}
          onLoad={loadDemosTemplateFromLibrary}
          onDelete={deleteDemosTemplateFromLibrary}
          newName={newDemosTemplateName}
          setNewName={setNewDemosTemplateName}
          onSave={saveDemosTemplateToLibrary}
          placeholder="Name this template (e.g. Casual Tone)"
        />
      </div>
    </section>
  );
}
