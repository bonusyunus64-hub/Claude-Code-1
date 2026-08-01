import type { SavedTemplate } from '../../types';
import { DEFAULT_FOLLOWUP_TEMPLATE, DEFAULT_FOLLOWUP_SUBJECT } from '../../constants';
import { CopyChip } from '../../components/CopyChip';
import { SpamScoreBadge } from '../../components/SpamScoreBadge';
import { SavedItemList } from './SavedItemList';

export interface FollowUpTemplatePanelProps {
  demosFollowUpSubject: string;
  setDemosFollowUpSubject: (value: string) => void;
  demosFollowUpTemplate: string;
  setDemosFollowUpTemplate: (value: string) => void;
  followUpTemplateLibrary: SavedTemplate[];
  newFollowUpTemplateName: string;
  setNewFollowUpTemplateName: (value: string) => void;
  saveFollowUpTemplateToLibrary: () => void;
  loadFollowUpTemplateFromLibrary: (template: SavedTemplate) => void;
  deleteFollowUpTemplateFromLibrary: (id: string) => void;
}

export function FollowUpTemplatePanel(props: FollowUpTemplatePanelProps) {
  const {
    demosFollowUpSubject, setDemosFollowUpSubject, demosFollowUpTemplate, setDemosFollowUpTemplate, followUpTemplateLibrary,
    newFollowUpTemplateName, setNewFollowUpTemplateName, saveFollowUpTemplateToLibrary, loadFollowUpTemplateFromLibrary, deleteFollowUpTemplateFromLibrary,
  } = props;

  return (
    <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 md:p-6 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-1">Follow-up Template</h2>
        <p className="text-xs text-zinc-500 mb-2">Used when the follow-up toggle is enabled on the Compose tab. Click a variable to copy it:</p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {['{{managerName}}', '{{artistName}}', '{{trackTitle}}', '{{driveLink}}', '{{senderName}}', '{{pronoun}}'].map(v => (
          <CopyChip key={v} value={v} />
        ))}
      </div>
      <div>
        <label className="block text-xs font-medium text-zinc-400 mb-1.5">Subject line</label>
        <input type="text" value={demosFollowUpSubject} onChange={e => setDemosFollowUpSubject(e.target.value)}
          className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-2.5 text-sm text-white font-mono focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition" />
      </div>
      <textarea value={demosFollowUpTemplate} onChange={e => setDemosFollowUpTemplate(e.target.value)} rows={12}
        className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-3 text-sm text-white font-mono focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition resize-y" />
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <button onClick={() => { setDemosFollowUpTemplate(DEFAULT_FOLLOWUP_TEMPLATE); setDemosFollowUpSubject(DEFAULT_FOLLOWUP_SUBJECT); }} className="text-xs text-zinc-500 hover:text-zinc-300 transition">
          Reset to default
        </button>
        <SpamScoreBadge template={demosFollowUpTemplate} />
      </div>
      <div className="pt-3 border-t border-zinc-800 space-y-3">
        <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Saved Templates</h3>
        <SavedItemList
          items={followUpTemplateLibrary}
          onLoad={loadFollowUpTemplateFromLibrary}
          onDelete={deleteFollowUpTemplateFromLibrary}
          newName={newFollowUpTemplateName}
          setNewName={setNewFollowUpTemplateName}
          onSave={saveFollowUpTemplateToLibrary}
          placeholder="Name this template (e.g. Second Nudge)"
        />
      </div>
    </section>
  );
}
