import type { Artist, CustomContact, DemosFilterPreset, EmailAccount, SavedTemplate } from '../types';
import { DEFAULT_DEMOS_TEMPLATE, DEFAULT_DEMOS_SUBJECT, DEFAULT_FOLLOWUP_TEMPLATE, DEFAULT_FOLLOWUP_SUBJECT } from '../constants';
import { CopyChip } from '../components/CopyChip';
import { CopyableName } from '../components/CopyableName';
import { SpotifyLink } from '../components/SpotifyLink';
import { PitchedBadge } from '../components/PitchedBadge';
import { SpamScoreBadge } from '../components/SpamScoreBadge';

const FOLLOWER_STEPS = [
  { label: 'Any', value: 0 },
  { label: '100K', value: 100_000 },
  { label: '250K', value: 250_000 },
  { label: '500K', value: 500_000 },
  { label: '1M', value: 1_000_000 },
  { label: '2M', value: 2_000_000 },
  { label: '3M', value: 3_000_000 },
  { label: '5M', value: 5_000_000 },
  { label: '10M', value: 10_000_000 },
  { label: '50M', value: 50_000_000 },
];

const GENDER_OPTIONS = [
  { label: 'Any', value: '' },
  { label: 'Male', value: 'MALE' },
  { label: 'Female', value: 'FEMALE' },
];

const ARTIST_TYPE_OPTIONS = [
  { label: 'Any', value: '' },
  { label: 'Solo', value: 'Person' },
  { label: 'Group', value: 'Group' },
];

const INSTAGRAM_ICON_PATH = 'M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.012-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.058 1.645-.07 4.849-.07zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.98-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.198-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z';

function InstagramIcon({ className }: { className: string }) {
  return <svg viewBox="0 0 24 24" className={className}><path d={INSTAGRAM_ICON_PATH} /></svg>;
}

export interface DemosSectionProps {
  demosTab: 'compose' | 'template';
  setDemosTab: (tab: 'compose' | 'template') => void;

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

  senderName: string;
  setSenderName: (value: string) => void;
  trackTitle: string;
  setTrackTitle: (value: string) => void;
  demosPitchCount: number;
  driveLink: string;
  setDriveLink: (value: string) => void;

  demosPresets: DemosFilterPreset[];
  newDemosPresetName: string;
  setNewDemosPresetName: (value: string) => void;
  saveDemosPreset: () => void;
  loadDemosPreset: (preset: DemosFilterPreset) => void;
  deleteDemosPreset: (id: string) => void;

  demosMatchMode: 'any' | 'all';
  setDemosMatchMode: (mode: 'any' | 'all') => void;
  selectedGenres: string[];
  setSelectedGenres: (genres: string[]) => void;
  toggleGenre: (genre: string) => void;
  genreSearch: string;
  setGenreSearch: (value: string) => void;
  showGenreDropdown: boolean;
  setShowGenreDropdown: (show: boolean) => void;
  topGenres: string[];
  filteredGenres: string[];
  resetFilters: () => void;
  setPreviewDone: (done: boolean) => void;
  setSendResult: (result: { sent: number; failed: number; total: number } | null) => void;

  minAudience: number;
  setMinAudience: (value: number) => void;
  maxAudience: number;
  setMaxAudience: (value: number) => void;
  showInstagram: boolean;
  setShowInstagram: (updater: (prev: boolean) => boolean) => void;
  minInstagram: number;
  setMinInstagram: (value: number) => void;
  maxInstagram: number;
  setMaxInstagram: (value: number) => void;
  gender: string;
  setGender: (value: string) => void;
  artistType: string;
  setArtistType: (value: string) => void;

  customContacts: CustomContact[];
  removeCustomContact: (id: string) => void;
  showAddCustomContact: boolean;
  setShowAddCustomContact: (show: boolean) => void;
  newCustomContact: { artistName: string; managerName: string; managerEmail: string };
  setNewCustomContact: React.Dispatch<React.SetStateAction<{ artistName: string; managerName: string; managerEmail: string }>>;
  addCustomContact: () => void;
  handleCustomContactsCsv: (e: React.ChangeEvent<HTMLInputElement>) => void;

  handlePreview: () => void;
  previewDone: boolean;
  previewLoading: boolean;
  previewArtists: Artist[];
  includedArtists: Artist[];
  visibleArtists: Artist[];
  totalEmails: number;
  setExcludedArtistNames: React.Dispatch<React.SetStateAction<Set<string>>>;
  excludedArtistNames: Set<string>;
  toggleArtistExclusion: (name: string) => void;
  toggleGenreFromPreview: (genre: string) => void;
  recipientSearch: string;
  setRecipientSearch: (value: string) => void;
  sortOrder: 'followers-desc' | 'followers-asc' | 'alpha-asc' | 'alpha-desc' | 'random';
  setSortOrder: (order: 'followers-desc' | 'followers-asc' | 'alpha-asc' | 'alpha-desc' | 'random') => void;
  outsideResults: Artist[];
  outsideResultsQuery: string;
  outsideSearchLoading: boolean;
  handleOutsideSearch: (query: string) => void;
  addOutsideArtistToContacts: (a: Artist) => void;
  pitchedEmailMap: Map<string, string[]>;

  setPreviewModalType: (type: 'demos' | 'radio' | null) => void;
  setPreviewModalIdx: (idx: number) => void;

  demosDuplicateRecipients: string[];
  demosInvalidEmails: string[];
  setDemosInvalidEmails: (emails: string[]) => void;
  addFailedToBlacklist: (emails: string[]) => void;

  sendResult: { sent: number; failed: number; total: number } | null;
  sendFailedEmails: string[];
  setSendFailedEmails: (emails: string[]) => void;
  sendError: string;

  useFollowUp: boolean;
  setUseFollowUp: (updater: (prev: boolean) => boolean) => void;
  handleSend: () => void;
  canSend: boolean;
  sending: boolean;

  selectedAccount: EmailAccount | undefined;
  setActiveSection: (section: 'overview' | 'demos' | 'promotion' | 'account' | 'history') => void;

  testEmailTo: string;
  setTestEmailTo: (value: string) => void;
  setTestEmailResult: (result: 'success' | 'error' | null) => void;
  handleTestEmail: () => void;
  testEmailSending: boolean;
  selectedAccountId: string;
  testEmailResult: 'success' | 'error' | null;
  testEmailError: string;
}

export function DemosSection(props: DemosSectionProps) {
  const {
    demosTab, setDemosTab,
    demosSubject, setDemosSubject, demosSubjectB, setDemosSubjectB, subjectTestEnabled, setSubjectTestEnabled,
    demosTemplate, setDemosTemplate, demosTemplateLibrary,
    newDemosTemplateName, setNewDemosTemplateName, saveDemosTemplateToLibrary, loadDemosTemplateFromLibrary, deleteDemosTemplateFromLibrary,
    demosFollowUpSubject, setDemosFollowUpSubject, demosFollowUpTemplate, setDemosFollowUpTemplate, followUpTemplateLibrary,
    newFollowUpTemplateName, setNewFollowUpTemplateName, saveFollowUpTemplateToLibrary, loadFollowUpTemplateFromLibrary, deleteFollowUpTemplateFromLibrary,
    senderName, setSenderName, trackTitle, setTrackTitle, demosPitchCount, driveLink, setDriveLink,
    demosPresets, newDemosPresetName, setNewDemosPresetName, saveDemosPreset, loadDemosPreset, deleteDemosPreset,
    demosMatchMode, setDemosMatchMode, selectedGenres, setSelectedGenres, toggleGenre, genreSearch, setGenreSearch,
    showGenreDropdown, setShowGenreDropdown, topGenres, filteredGenres, resetFilters, setPreviewDone, setSendResult,
    minAudience, setMinAudience, maxAudience, setMaxAudience, showInstagram, setShowInstagram,
    minInstagram, setMinInstagram, maxInstagram, setMaxInstagram, gender, setGender, artistType, setArtistType,
    customContacts, removeCustomContact, showAddCustomContact, setShowAddCustomContact,
    newCustomContact, setNewCustomContact, addCustomContact, handleCustomContactsCsv,
    handlePreview, previewDone, previewLoading, previewArtists, includedArtists, visibleArtists, totalEmails,
    setExcludedArtistNames, excludedArtistNames, toggleArtistExclusion, toggleGenreFromPreview,
    recipientSearch, setRecipientSearch, sortOrder, setSortOrder,
    outsideResults, outsideResultsQuery, outsideSearchLoading, handleOutsideSearch, addOutsideArtistToContacts, pitchedEmailMap,
    setPreviewModalType, setPreviewModalIdx,
    demosDuplicateRecipients, demosInvalidEmails, setDemosInvalidEmails, addFailedToBlacklist,
    sendResult, sendFailedEmails, setSendFailedEmails, sendError,
    useFollowUp, setUseFollowUp, handleSend, canSend, sending,
    selectedAccount, setActiveSection,
    testEmailTo, setTestEmailTo, setTestEmailResult, handleTestEmail, testEmailSending, selectedAccountId, testEmailResult, testEmailError,
  } = props;

  return (
    <>
      <div className="flex gap-1 bg-zinc-900 rounded-lg p-1 w-fit border border-zinc-800">
        {(['compose', 'template'] as const).map(t => (
          <button key={t} onClick={() => setDemosTab(t)}
            className={`px-3 py-1.5 rounded-md text-xs md:text-sm font-medium transition ${demosTab === t ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}>
            {t === 'compose' ? 'Compose Pitch' : 'Email Template'}
          </button>
        ))}
      </div>

      {demosTab === 'template' && (
        <div className="space-y-6">
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
              {demosTemplateLibrary.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {demosTemplateLibrary.map(t => (
                    <div key={t.id} className="inline-flex items-center gap-1.5 bg-zinc-800 border border-zinc-700 rounded-full pl-3 pr-1.5 py-1">
                      <button onClick={() => loadDemosTemplateFromLibrary(t)} className="text-xs text-zinc-200 hover:text-violet-400 transition">{t.name}</button>
                      <button onClick={() => deleteDemosTemplateFromLibrary(t.id)} className="text-zinc-600 hover:text-red-400 transition text-sm leading-none px-1">×</button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <input value={newDemosTemplateName} onChange={e => setNewDemosTemplateName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') saveDemosTemplateToLibrary(); }}
                  placeholder="Name this template (e.g. Casual Tone)"
                  className="flex-1 rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent" />
                <button onClick={saveDemosTemplateToLibrary} disabled={!newDemosTemplateName.trim()}
                  className="rounded-lg bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 px-4 py-2 text-sm font-semibold text-white transition shrink-0">
                  Save Current
                </button>
              </div>
            </div>
          </section>

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
              {followUpTemplateLibrary.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {followUpTemplateLibrary.map(t => (
                    <div key={t.id} className="inline-flex items-center gap-1.5 bg-zinc-800 border border-zinc-700 rounded-full pl-3 pr-1.5 py-1">
                      <button onClick={() => loadFollowUpTemplateFromLibrary(t)} className="text-xs text-zinc-200 hover:text-violet-400 transition">{t.name}</button>
                      <button onClick={() => deleteFollowUpTemplateFromLibrary(t.id)} className="text-zinc-600 hover:text-red-400 transition text-sm leading-none px-1">×</button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <input value={newFollowUpTemplateName} onChange={e => setNewFollowUpTemplateName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') saveFollowUpTemplateToLibrary(); }}
                  placeholder="Name this template (e.g. Second Nudge)"
                  className="flex-1 rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent" />
                <button onClick={saveFollowUpTemplateToLibrary} disabled={!newFollowUpTemplateName.trim()}
                  className="rounded-lg bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 px-4 py-2 text-sm font-semibold text-white transition shrink-0">
                  Save Current
                </button>
              </div>
            </div>
          </section>
        </div>
      )}

      {demosTab === 'compose' && (<>
        {/* Track Info */}
        <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 md:p-6 space-y-4">
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Track Details</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1.5">Your Name</label>
              <input type="text" value={senderName} onChange={e => setSenderName(e.target.value)}
                placeholder="Eren Senbay"
                className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-2.5 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition" />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1.5">Track Title</label>
              <input type="text" value={trackTitle} onChange={e => setTrackTitle(e.target.value)}
                placeholder="e.g. Give Me A Sign"
                className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-2.5 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition" />
              {demosPitchCount > 0 && (
                <p className="text-xs text-amber-400 mt-1.5">Already pitched to {demosPitchCount} recipient{demosPitchCount !== 1 ? 's' : ''} for this track.</p>
              )}
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-zinc-300 mb-1.5">Google Drive Link</label>
              <input type="url" value={driveLink} onChange={e => setDriveLink(e.target.value)}
                placeholder="https://drive.google.com/file/d/..."
                className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-2.5 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition" />
            </div>
          </div>
        </section>

        {/* Saved Filter Presets */}
        <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 md:p-6 space-y-3">
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Saved Filters</h2>
          {demosPresets.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {demosPresets.map(p => (
                <div key={p.id} className="inline-flex items-center gap-1.5 bg-zinc-800 border border-zinc-700 rounded-full pl-3 pr-1.5 py-1">
                  <button onClick={() => loadDemosPreset(p)} className="text-xs text-zinc-200 hover:text-violet-400 transition">{p.name}</button>
                  <button onClick={() => deleteDemosPreset(p.id)} className="text-zinc-600 hover:text-red-400 transition text-sm leading-none px-1">×</button>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <input value={newDemosPresetName} onChange={e => setNewDemosPresetName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') saveDemosPreset(); }}
              placeholder="Name this filter set (e.g. Indie Pop Campaigns)"
              className="flex-1 rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent" />
            <button onClick={saveDemosPreset} disabled={!newDemosPresetName.trim()}
              className="rounded-lg bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 px-4 py-2 text-sm font-semibold text-white transition shrink-0">
              Save Current
            </button>
          </div>
        </section>

        {/* Genre Selector */}
        <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 md:p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Select Genres</h2>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-zinc-500">Match:</span>
              {(['any', 'all'] as const).map(mode => (
                <button key={mode} onClick={() => { setDemosMatchMode(mode); setPreviewDone(false); setSendResult(null); }}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition ${demosMatchMode === mode ? 'bg-violet-600 border-violet-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white'}`}>
                  {mode === 'any' ? 'Any genre' : 'All genres'}
                </button>
              ))}
            </div>
          </div>
          <p className="text-sm text-zinc-500">
            {demosMatchMode === 'any' ? 'Artists tagged with at least one of the selected genres.' : 'Artists tagged with every selected genre.'}
          </p>
          {selectedGenres.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {selectedGenres.map(g => (
                <button key={g} onClick={() => toggleGenre(g)}
                  className="inline-flex items-center gap-1.5 bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium px-3 py-1 rounded-full transition">
                  {g}<span className="text-violet-200">×</span>
                </button>
              ))}
              <button onClick={() => { setSelectedGenres([]); setPreviewDone(false); setSendResult(null); }}
                className="text-xs text-zinc-500 hover:text-zinc-300 px-2 py-1 transition">Clear all</button>
            </div>
          )}
          <div className="relative">
            <input type="text" value={genreSearch} onChange={e => setGenreSearch(e.target.value)}
              onFocus={() => setShowGenreDropdown(true)}
              onBlur={() => setTimeout(() => setShowGenreDropdown(false), 150)}
              placeholder="Search genres (e.g. Pop, R&B, Hip Hop...)"
              className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-2.5 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition" />
            {showGenreDropdown && genreSearch.trim() === '' && topGenres.length > 0 && (
              <div className="absolute z-10 mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl max-h-56 overflow-y-auto">
                <p className="px-4 pt-2 pb-1 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">Most popular genres</p>
                {topGenres.filter(g => !selectedGenres.includes(g)).map(g => (
                  <button key={g} onMouseDown={() => { toggleGenre(g); setGenreSearch(''); }}
                    className="w-full text-left px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-700 transition">{g}</button>
                ))}
              </div>
            )}
            {showGenreDropdown && genreSearch.trim() !== '' && filteredGenres.length > 0 && (
              <div className="absolute z-10 mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl max-h-56 overflow-y-auto">
                {filteredGenres.map(g => (
                  <button key={g} onMouseDown={() => { toggleGenre(g); setGenreSearch(''); }}
                    className="w-full text-left px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-700 transition">{g}</button>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Filters */}
        <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 md:p-6 space-y-5">
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Filters</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-2">
              <p className="text-xs font-medium text-zinc-400">Min Spotify followers</p>
              <div className="flex flex-wrap gap-1.5">
                {FOLLOWER_STEPS.map(opt => (
                  <button key={`min-sp-${opt.value}`} onClick={() => { setMinAudience(opt.value); resetFilters(); }}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium border transition ${minAudience === opt.value ? 'bg-violet-600 border-violet-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white'}`}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium text-zinc-400">Max Spotify followers</p>
              <div className="flex flex-wrap gap-1.5">
                {FOLLOWER_STEPS.map(opt => (
                  <button key={`max-sp-${opt.value}`} onClick={() => { setMaxAudience(opt.value); resetFilters(); }}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium border transition ${maxAudience === opt.value ? 'bg-violet-600 border-violet-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white'}`}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="md:col-span-2 space-y-3">
              <button onClick={() => setShowInstagram(p => !p)}
                className="flex items-center gap-1.5 text-xs font-medium text-zinc-400 hover:text-zinc-200 transition">
                <svg viewBox="0 0 24 24" className={`w-3.5 h-3.5 fill-none stroke-current stroke-2 transition-transform ${showInstagram ? 'rotate-180' : ''}`} strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
                Instagram followers
                {(minInstagram > 0 || maxInstagram > 0) && !showInstagram && (
                  <span className="text-violet-400">
                    {minInstagram > 0 && maxInstagram > 0
                      ? `${minInstagram >= 1_000_000 ? `${(minInstagram/1_000_000).toFixed(1)}M` : `${Math.round(minInstagram/1_000)}K`} – ${maxInstagram >= 1_000_000 ? `${(maxInstagram/1_000_000).toFixed(1)}M` : `${Math.round(maxInstagram/1_000)}K`}`
                      : minInstagram > 0
                      ? `min ${minInstagram >= 1_000_000 ? `${(minInstagram/1_000_000).toFixed(1)}M` : `${Math.round(minInstagram/1_000)}K`}`
                      : `max ${maxInstagram >= 1_000_000 ? `${(maxInstagram/1_000_000).toFixed(1)}M` : `${Math.round(maxInstagram/1_000)}K`}`}
                  </span>
                )}
              </button>
              {showInstagram && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-1">
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-zinc-400">Min</p>
                    <div className="flex flex-wrap gap-1.5">
                      {FOLLOWER_STEPS.map(opt => (
                        <button key={`min-ig-${opt.value}`} onClick={() => { setMinInstagram(opt.value); resetFilters(); }}
                          className={`px-2.5 py-1 rounded-full text-xs font-medium border transition ${minInstagram === opt.value ? 'bg-violet-600 border-violet-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white'}`}>
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-zinc-400">Max</p>
                    <div className="flex flex-wrap gap-1.5">
                      {FOLLOWER_STEPS.map(opt => (
                        <button key={`max-ig-${opt.value}`} onClick={() => { setMaxInstagram(opt.value); resetFilters(); }}
                          className={`px-2.5 py-1 rounded-full text-xs font-medium border transition ${maxInstagram === opt.value ? 'bg-violet-600 border-violet-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white'}`}>
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-2">
              <p className="text-xs font-medium text-zinc-400">Artist gender</p>
              <div className="flex flex-wrap gap-1.5">
                {GENDER_OPTIONS.map(opt => (
                  <button key={`gender-${opt.value}`} onClick={() => { setGender(opt.value); resetFilters(); }}
                    className={`px-3 py-1 rounded-full text-xs font-medium border transition ${gender === opt.value ? 'bg-violet-600 border-violet-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white'}`}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium text-zinc-400">Artist type</p>
              <div className="flex flex-wrap gap-1.5">
                {ARTIST_TYPE_OPTIONS.map(opt => (
                  <button key={`type-${opt.value}`} onClick={() => { setArtistType(opt.value); resetFilters(); }}
                    className={`px-3 py-1 rounded-full text-xs font-medium border transition ${artistType === opt.value ? 'bg-violet-600 border-violet-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white'}`}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Custom Contacts */}
        <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 md:p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Custom Contacts</h2>
              <p className="text-xs text-zinc-500 mt-0.5">Add contacts outside the database — always included in sends.</p>
            </div>
            {customContacts.length > 0 && (
              <span className="text-xs text-zinc-500">{customContacts.length} contact{customContacts.length !== 1 ? 's' : ''}</span>
            )}
          </div>
          {customContacts.length > 0 && (
            <div className="divide-y divide-zinc-800 border border-zinc-800 rounded-lg overflow-hidden">
              {customContacts.map(c => (
                <div key={c.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm text-white font-medium">{c.artistName}</p>
                    <p className="text-xs text-zinc-500">{c.managerName ? `${c.managerName} · ` : ''}{c.managerEmail}</p>
                  </div>
                  <button onClick={() => removeCustomContact(c.id)}
                    className="text-zinc-600 hover:text-red-400 transition text-lg leading-none shrink-0">×</button>
                </div>
              ))}
            </div>
          )}
          {showAddCustomContact ? (
            <div className="border border-zinc-700 rounded-xl p-4 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Artist / Project Name *</label>
                  <input value={newCustomContact.artistName} onChange={e => setNewCustomContact(p => ({ ...p, artistName: e.target.value }))}
                    placeholder="Artist name"
                    className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent" />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Manager Name</label>
                  <input value={newCustomContact.managerName} onChange={e => setNewCustomContact(p => ({ ...p, managerName: e.target.value }))}
                    placeholder="Manager name (optional)"
                    className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent" />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs text-zinc-400 mb-1">Email Address *</label>
                  <input type="email" value={newCustomContact.managerEmail} onChange={e => setNewCustomContact(p => ({ ...p, managerEmail: e.target.value }))}
                    placeholder="contact@example.com"
                    className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent" />
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={addCustomContact} disabled={!newCustomContact.artistName || !newCustomContact.managerEmail}
                  className="rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 px-4 py-2 text-sm font-semibold text-white transition">
                  Add Contact
                </button>
                <button onClick={() => { setShowAddCustomContact(false); setNewCustomContact({ artistName: '', managerName: '', managerEmail: '' }); }}
                  className="rounded-lg bg-zinc-800 hover:bg-zinc-700 px-4 py-2 text-sm text-zinc-300 transition">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <button onClick={() => setShowAddCustomContact(true)} className="text-sm text-violet-400 hover:text-violet-300 transition">
                + Add custom contact
              </button>
              <label className="text-sm text-zinc-400 hover:text-zinc-200 transition cursor-pointer">
                Import CSV
                <input type="file" accept=".csv,text/csv" className="hidden" onChange={handleCustomContactsCsv} />
              </label>
              <span className="text-xs text-zinc-600">Columns: Artist, Manager (optional), Email</span>
            </div>
          )}
        </section>

        {/* Preview */}
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={() => handlePreview()} disabled={!selectedGenres.length || previewLoading}
            className="rounded-lg bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 px-5 py-2.5 text-sm font-semibold text-white transition">
            {previewLoading ? 'Loading...' : 'Preview Recipients'}
          </button>
          {(previewDone || customContacts.length > 0) && (
            <button
              onClick={() => { setPreviewModalType('demos'); setPreviewModalIdx(0); }}
              className="rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 px-4 py-2.5 text-sm font-medium text-zinc-300 transition">
              Preview Email
            </button>
          )}
          {previewDone && (
            <span className="text-sm text-zinc-400">
              {includedArtists.length}{includedArtists.length !== previewArtists.length ? ` of ${previewArtists.length}` : ''} artists selected · {totalEmails} emails
            </span>
          )}
          {!previewDone && customContacts.length > 0 && (
            <span className="text-sm text-zinc-400">{customContacts.length} custom contact{customContacts.length !== 1 ? 's' : ''}</span>
          )}
        </div>

        {previewDone && previewArtists.length > 0 && (
          <section className={`bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden transition-opacity ${previewLoading ? 'opacity-60' : ''}`}>
            <div className="px-4 md:px-6 py-3 md:py-4 border-b border-zinc-800 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-zinc-300">Recipients Preview <span className="text-zinc-500 font-normal">· {previewLoading ? 'Updating…' : `${visibleArtists.length}${visibleArtists.length !== previewArtists.length ? ` of ${previewArtists.length}` : ''} artists`}</span></h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setExcludedArtistNames(prev => {
                    const next = new Set(prev);
                    visibleArtists.forEach(a => next.add(a.name));
                    return next;
                  })}
                  className="text-xs text-zinc-400 hover:text-zinc-200 transition"
                  title="Uncheck all artists currently shown">
                  Deselect all
                </button>
                <button
                  onClick={() => setExcludedArtistNames(prev => {
                    const next = new Set(prev);
                    visibleArtists.forEach(a => next.delete(a.name));
                    return next;
                  })}
                  className="text-xs text-zinc-400 hover:text-zinc-200 transition"
                  title="Check all artists currently shown">
                  Select all
                </button>
                <input type="text" value={recipientSearch} onChange={e => setRecipientSearch(e.target.value)}
                  placeholder="Search artist..."
                  className="text-xs bg-zinc-800 border border-zinc-700 text-zinc-300 placeholder-zinc-500 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition w-36 sm:w-48" />
                <select value={sortOrder} onChange={e => setSortOrder(e.target.value as typeof sortOrder)}
                  className="text-xs bg-zinc-800 border border-zinc-700 text-zinc-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-violet-500">
                  <option value="followers-desc">Followers: High → Low</option>
                  <option value="followers-asc">Followers: Low → High</option>
                  <option value="alpha-asc">A → Z</option>
                  <option value="alpha-desc">Z → A</option>
                  <option value="random">Random</option>
                </select>
              </div>
            </div>
            {visibleArtists.length === 0 && (
              <div className="px-4 md:px-6 py-4 space-y-3">
                <p className="text-sm text-zinc-500">No artists match &ldquo;{recipientSearch}&rdquo; in your current filters.</p>
                {outsideResultsQuery === recipientSearch.trim() && outsideResults.length > 0 ? (
                  <div className="border border-zinc-800 rounded-lg overflow-hidden divide-y divide-zinc-800">
                    {outsideResults.map(a => {
                      const pitchedTracks = a.managerEmails.flatMap(email => pitchedEmailMap.get(email.toLowerCase()) ?? []);
                      const uniquePitched = [...new Set(pitchedTracks)];
                      const alreadyAdded = a.managerEmails.every(e => customContacts.some(c => c.managerEmail.toLowerCase() === e.toLowerCase()));
                      return (
                        <div key={a.name} className="px-3 py-2.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="shrink-0 w-9 h-9 rounded-full overflow-hidden bg-zinc-700">
                              {a.avatarUrl ? (
                                <img src={a.avatarUrl} alt={a.name} width={36} height={36} className="w-full h-full object-cover" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-zinc-500 text-xs font-bold">{a.name.charAt(0)}</div>
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                                <CopyableName name={a.name} className="text-sm font-medium text-white" />
                                {uniquePitched.length > 0 && <PitchedBadge tracks={uniquePitched} />}
                                {a.instagramHandle && (
                                  <a href={`https://instagram.com/${a.instagramHandle.replace('@', '')}`} target="_blank" rel="noopener noreferrer"
                                    onClick={e => e.stopPropagation()}
                                    className="inline-flex items-center bg-zinc-800 hover:bg-zinc-700 text-pink-400 p-1 rounded transition">
                                    <InstagramIcon className="w-3 h-3 fill-pink-400 shrink-0" />
                                  </a>
                                )}
                                {a.spotifyFollowers > 0 && (
                                  <SpotifyLink name={a.name} followers={a.spotifyFollowers} />
                                )}
                              </div>
                              <p className="text-xs text-zinc-500 mt-0.5">{a.managementCompany || 'Independent'}</p>
                            </div>
                          </div>
                          <div className="pl-[46px] sm:pl-0 flex items-center gap-2.5 sm:shrink-0">
                            <div className="sm:text-right space-y-0.5 min-w-0">
                              {a.managerEmails.map((email, i) => (
                                <p key={email} className="text-xs text-violet-400 break-all sm:break-normal">
                                  {a.managerNames[i] ? `${a.managerNames[i]} — ` : ''}{email}
                                </p>
                              ))}
                            </div>
                            <button onClick={() => addOutsideArtistToContacts(a)} disabled={alreadyAdded}
                              className="shrink-0 text-xs rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:hover:bg-violet-600 px-2.5 py-1.5 font-medium text-white transition">
                              {alreadyAdded ? 'Added' : 'Add'}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : outsideResultsQuery === recipientSearch.trim() ? (
                  <p className="text-xs text-zinc-500">No matches found outside your filters either.</p>
                ) : (
                  <button onClick={() => handleOutsideSearch(recipientSearch)} disabled={outsideSearchLoading || !recipientSearch.trim()}
                    className="text-xs rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 disabled:opacity-40 px-3 py-1.5 font-medium text-zinc-300 transition">
                    {outsideSearchLoading ? 'Searching...' : 'Show results outside your filters'}
                  </button>
                )}
              </div>
            )}
            <div className="divide-y divide-zinc-800 max-h-[32rem] overflow-y-auto">
              {visibleArtists.map(a => {
                const pitchedTracks = a.managerEmails.flatMap(email => pitchedEmailMap.get(email.toLowerCase()) ?? []);
                const uniquePitched = [...new Set(pitchedTracks)];
                const isExcluded = excludedArtistNames.has(a.name);
                return (
                  <div key={a.name} onClick={() => toggleArtistExclusion(a.name)}
                    className={`cursor-pointer px-4 md:px-6 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4 transition hover:bg-zinc-800/40 ${isExcluded ? 'opacity-40' : ''}`}>
                    <div className="flex items-center gap-3 min-w-0">
                      <input type="checkbox" checked={!isExcluded} onChange={() => toggleArtistExclusion(a.name)}
                        onClick={e => e.stopPropagation()}
                        title={isExcluded ? 'Excluded from this send — click to include' : 'Click to exclude from this send'}
                        className="shrink-0 w-4 h-4 rounded border-zinc-600 bg-zinc-800 text-violet-600 focus:ring-2 focus:ring-violet-500 focus:ring-offset-0 cursor-pointer accent-violet-600" />
                      <div className="shrink-0 w-10 h-10 rounded-full overflow-hidden bg-zinc-700">
                        {a.avatarUrl ? (
                          <img src={a.avatarUrl} alt={a.name} width={40} height={40} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-zinc-500 text-xs font-bold">{a.name.charAt(0)}</div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <CopyableName name={a.name} className="text-sm font-medium text-white" />
                          {uniquePitched.length > 0 && <PitchedBadge tracks={uniquePitched} />}
                          {a.instagramHandle && (
                            <a href={`https://instagram.com/${a.instagramHandle.replace('@', '')}`} target="_blank" rel="noopener noreferrer"
                              onClick={e => e.stopPropagation()}
                              className="inline-flex items-center gap-1 text-xs bg-zinc-800 hover:bg-zinc-700 text-pink-400 px-1.5 py-0.5 rounded font-medium transition">
                              <InstagramIcon className="w-3 h-3 fill-pink-400 shrink-0" />
                              {a.instagramHandle}
                            </a>
                          )}
                          {a.spotifyFollowers > 0 && (
                            <SpotifyLink name={a.name} followers={a.spotifyFollowers} />
                          )}
                        </div>
                        <p className="text-xs text-zinc-500 mt-0.5">{a.managementCompany || 'Independent'}</p>
                        {a.genres.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {a.genres.map(g => {
                              const active = selectedGenres.includes(g);
                              return (
                                <button
                                  key={g}
                                  onClick={e => { e.stopPropagation(); toggleGenreFromPreview(g); }}
                                  disabled={previewLoading}
                                  title={active ? `Remove "${g}" from genre filters and refresh` : `Add "${g}" to genre filters and refresh`}
                                  className={`text-[11px] px-2 py-0.5 rounded-full font-medium transition disabled:opacity-50 disabled:cursor-not-allowed ${
                                    active
                                      ? 'bg-violet-600/20 text-violet-300 border border-violet-600/30 hover:bg-violet-600/30 hover:border-violet-500'
                                      : 'bg-zinc-800 text-zinc-400 border border-zinc-700 hover:border-violet-500 hover:text-violet-300'
                                  }`}
                                >
                                  {g}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="pl-[52px] sm:pl-0 sm:text-right sm:shrink-0 space-y-0.5">
                      {a.managerEmails.map((email, i) => (
                        <p key={email} className="text-xs text-violet-400 break-all sm:break-normal">
                          {a.managerNames[i] ? `${a.managerNames[i]} — ` : ''}{email}
                        </p>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {previewDone && previewArtists.length === 0 && !customContacts.length && (
          <p className="text-sm text-zinc-500">No artists with manager emails found for the selected genres.</p>
        )}

        {/* Custom contacts in preview */}
        {customContacts.length > 0 && (
          <section className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
            <div className="px-4 md:px-6 py-3 border-b border-zinc-800">
              <h3 className="text-sm font-semibold text-zinc-300">Custom Contacts <span className="text-zinc-500 font-normal">· {customContacts.length}</span></h3>
            </div>
            <div className="divide-y divide-zinc-800">
              {customContacts.map(c => {
                const pitchedTracks = pitchedEmailMap.get(c.managerEmail.toLowerCase()) ?? [];
                return (
                  <div key={c.id} className="px-4 md:px-6 py-3 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <CopyableName name={c.artistName} className="text-sm font-medium text-white" />
                        <span className="text-xs bg-zinc-700 text-zinc-300 px-1.5 py-0.5 rounded">Custom</span>
                        {pitchedTracks.length > 0 && <PitchedBadge tracks={pitchedTracks} />}
                      </div>
                      {c.managerName && <p className="text-xs text-zinc-500 mt-0.5">{c.managerName}</p>}
                    </div>
                    <p className="text-xs text-violet-400 text-right shrink-0">{c.managerEmail}</p>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {!sendResult && demosDuplicateRecipients.length > 0 && (
          <div className="rounded-lg bg-amber-900/20 border border-amber-700/40 px-5 py-3">
            <p className="text-amber-400 text-sm">
              {demosDuplicateRecipients.length} recipient{demosDuplicateRecipients.length !== 1 ? 's have' : ' has'} already been pitched &ldquo;{trackTitle}&rdquo; before (via Song Demos or Track Promotion). You can still send.
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

        <div className="pt-3 mt-1 border-t border-zinc-800 space-y-2">
          <p className="text-xs text-zinc-500">Happy with it? Send yourself a test with the real subject, template and merge fields filled in before sending to everyone.</p>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="email"
              value={testEmailTo}
              onChange={e => { setTestEmailTo(e.target.value); setTestEmailResult(null); }}
              placeholder="your-own-email@example.com"
              className="flex-1 rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition"
            />
            <button
              onClick={handleTestEmail}
              disabled={!testEmailTo || testEmailSending || !selectedAccountId}
              className="rounded-lg bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 px-4 py-2 text-sm font-semibold text-white transition sm:shrink-0"
            >
              {testEmailSending ? 'Sending…' : 'Send test email'}
            </button>
          </div>
          {testEmailResult === 'success' && <p className="text-xs text-green-400">Test email sent. Check your inbox.</p>}
          {testEmailResult === 'error' && <p className="text-xs text-red-400">{testEmailError}</p>}
          {!selectedAccountId && <p className="text-xs text-amber-500">Add and select an email account in the Account tab first.</p>}
        </div>
      </>)}
    </>
  );
}
