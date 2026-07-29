import type { EmailAccount, PlaylistCurator, PlaylistFilterPreset, RadioFilterPreset, RadioStation, SavedTemplate } from '../types';
import {
  DEFAULT_RADIO_TEMPLATE, DEFAULT_RADIO_SUBJECT, DEFAULT_PLAYLIST_TEMPLATE, DEFAULT_PLAYLIST_SUBJECT,
  LOCATION_OPTIONS, PLATFORM_OPTIONS,
} from '../constants';
import { CopyChip } from '../components/CopyChip';
import { PitchedBadge } from '../components/PitchedBadge';
import { SpamScoreBadge } from '../components/SpamScoreBadge';

export interface PromotionSectionProps {
  promotionTab: 'compose' | 'template';
  setPromotionTab: (tab: 'compose' | 'template') => void;
  promotionSection: 'radio' | 'playlists';
  setPromotionSection: (section: 'radio' | 'playlists') => void;

  senderName: string;
  setSenderName: (value: string) => void;
  trackTitle: string;
  setTrackTitle: (value: string) => void;
  driveLink: string;
  setDriveLink: (value: string) => void;

  pitchedEmailMap: Map<string, string[]>;
  selectedAccount: EmailAccount | undefined;
  setActiveSection: (section: 'overview' | 'demos' | 'promotion' | 'account' | 'history') => void;
  addFailedToBlacklist: (emails: string[]) => void;
  setPreviewModalType: (type: 'demos' | 'radio' | 'playlists' | null) => void;
  setPreviewModalIdx: (idx: number) => void;

  // Radio
  radioSubject: string;
  setRadioSubject: (value: string) => void;
  radioTemplate: string;
  setRadioTemplate: (value: string) => void;
  radioTemplateLibrary: SavedTemplate[];
  newRadioTemplateName: string;
  setNewRadioTemplateName: (value: string) => void;
  saveRadioTemplateToLibrary: () => void;
  loadRadioTemplateFromLibrary: (template: SavedTemplate) => void;
  deleteRadioTemplateFromLibrary: (id: string) => void;
  radioPitchCount: number;
  radioPresets: RadioFilterPreset[];
  newRadioPresetName: string;
  setNewRadioPresetName: (value: string) => void;
  saveRadioPreset: () => void;
  loadRadioPreset: (preset: RadioFilterPreset) => void;
  deleteRadioPreset: (id: string) => void;
  radioMatchMode: 'any' | 'all';
  setRadioMatchMode: (mode: 'any' | 'all') => void;
  setRadioPreviewDone: (done: boolean) => void;
  setRadioSendResult: (result: { sent: number; failed: number; total: number } | null) => void;
  selectedRadioGenres: string[];
  toggleRadioGenre: (genre: string) => void;
  setSelectedRadioGenres: (genres: string[]) => void;
  radioGenreSearch: string;
  setRadioGenreSearch: (value: string) => void;
  showRadioGenreDropdown: boolean;
  setShowRadioGenreDropdown: (show: boolean) => void;
  filteredRadioGenres: string[];
  selectedLocations: string[];
  toggleLocation: (loc: string) => void;
  setSelectedLocations: (locations: string[]) => void;
  handleRadioPreview: () => void;
  radioPreviewLoading: boolean;
  radioPreviewDone: boolean;
  radioStations: RadioStation[];
  radioTotalEmails: number;
  radioDuplicateRecipients: string[];
  radioInvalidEmails: string[];
  setRadioInvalidEmails: (emails: string[]) => void;
  radioSendResult: { sent: number; failed: number; total: number } | null;
  radioSendFailedEmails: string[];
  setRadioSendFailedEmails: (emails: string[]) => void;
  radioSendError: string;
  handleRadioSend: () => void;
  canSendRadio: boolean;
  radioSending: boolean;

  // Playlists
  playlistSubject: string;
  setPlaylistSubject: (value: string) => void;
  playlistTemplate: string;
  setPlaylistTemplate: (value: string) => void;
  playlistTemplateLibrary: SavedTemplate[];
  newPlaylistTemplateName: string;
  setNewPlaylistTemplateName: (value: string) => void;
  savePlaylistTemplateToLibrary: () => void;
  loadPlaylistTemplateFromLibrary: (template: SavedTemplate) => void;
  deletePlaylistTemplateFromLibrary: (id: string) => void;
  playlistPitchCount: number;
  playlistAllGenres: string[];
  playlistPresets: PlaylistFilterPreset[];
  newPlaylistPresetName: string;
  setNewPlaylistPresetName: (value: string) => void;
  savePlaylistPreset: () => void;
  loadPlaylistPreset: (preset: PlaylistFilterPreset) => void;
  deletePlaylistPreset: (id: string) => void;
  playlistMatchMode: 'any' | 'all';
  setPlaylistMatchMode: (mode: 'any' | 'all') => void;
  setPlaylistPreviewDone: (done: boolean) => void;
  setPlaylistSendResult: (result: { sent: number; failed: number; total: number } | null) => void;
  selectedPlaylistGenres: string[];
  togglePlaylistGenre: (genre: string) => void;
  setSelectedPlaylistGenres: (genres: string[]) => void;
  playlistGenreSearch: string;
  setPlaylistGenreSearch: (value: string) => void;
  showPlaylistGenreDropdown: boolean;
  setShowPlaylistGenreDropdown: (show: boolean) => void;
  filteredPlaylistGenres: string[];
  selectedPlatforms: string[];
  togglePlatform: (platform: string) => void;
  setSelectedPlatforms: (platforms: string[]) => void;
  handlePlaylistPreview: () => void;
  playlistPreviewLoading: boolean;
  playlistPreviewDone: boolean;
  playlistCurators: PlaylistCurator[];
  playlistTotalEmails: number;
  playlistDuplicateRecipients: string[];
  playlistInvalidEmails: string[];
  setPlaylistInvalidEmails: (emails: string[]) => void;
  playlistSendResult: { sent: number; failed: number; total: number } | null;
  playlistSendFailedEmails: string[];
  setPlaylistSendFailedEmails: (emails: string[]) => void;
  playlistSendError: string;
  handlePlaylistSend: () => void;
  canSendPlaylist: boolean;
  playlistSending: boolean;
}

export function PromotionSection(props: PromotionSectionProps) {
  const {
    promotionTab, setPromotionTab, promotionSection, setPromotionSection,
    senderName, setSenderName, trackTitle, setTrackTitle, driveLink, setDriveLink,
    pitchedEmailMap, selectedAccount, setActiveSection, addFailedToBlacklist, setPreviewModalType, setPreviewModalIdx,

    radioSubject, setRadioSubject, radioTemplate, setRadioTemplate, radioTemplateLibrary,
    newRadioTemplateName, setNewRadioTemplateName, saveRadioTemplateToLibrary, loadRadioTemplateFromLibrary, deleteRadioTemplateFromLibrary,
    radioPitchCount, radioPresets, newRadioPresetName, setNewRadioPresetName, saveRadioPreset, loadRadioPreset, deleteRadioPreset,
    radioMatchMode, setRadioMatchMode, setRadioPreviewDone, setRadioSendResult,
    selectedRadioGenres, toggleRadioGenre, setSelectedRadioGenres, radioGenreSearch, setRadioGenreSearch,
    showRadioGenreDropdown, setShowRadioGenreDropdown, filteredRadioGenres,
    selectedLocations, toggleLocation, setSelectedLocations,
    handleRadioPreview, radioPreviewLoading, radioPreviewDone, radioStations, radioTotalEmails,
    radioDuplicateRecipients, radioInvalidEmails, setRadioInvalidEmails,
    radioSendResult, radioSendFailedEmails, setRadioSendFailedEmails, radioSendError, handleRadioSend, canSendRadio, radioSending,

    playlistSubject, setPlaylistSubject, playlistTemplate, setPlaylistTemplate, playlistTemplateLibrary,
    newPlaylistTemplateName, setNewPlaylistTemplateName, savePlaylistTemplateToLibrary, loadPlaylistTemplateFromLibrary, deletePlaylistTemplateFromLibrary,
    playlistPitchCount, playlistAllGenres, playlistPresets, newPlaylistPresetName, setNewPlaylistPresetName,
    savePlaylistPreset, loadPlaylistPreset, deletePlaylistPreset,
    playlistMatchMode, setPlaylistMatchMode, setPlaylistPreviewDone, setPlaylistSendResult,
    selectedPlaylistGenres, togglePlaylistGenre, setSelectedPlaylistGenres, playlistGenreSearch, setPlaylistGenreSearch,
    showPlaylistGenreDropdown, setShowPlaylistGenreDropdown, filteredPlaylistGenres,
    selectedPlatforms, togglePlatform, setSelectedPlatforms,
    handlePlaylistPreview, playlistPreviewLoading, playlistPreviewDone, playlistCurators, playlistTotalEmails,
    playlistDuplicateRecipients, playlistInvalidEmails, setPlaylistInvalidEmails,
    playlistSendResult, playlistSendFailedEmails, setPlaylistSendFailedEmails, playlistSendError, handlePlaylistSend, canSendPlaylist, playlistSending,
  } = props;

  return (
    <>
      <div className="flex gap-1 bg-zinc-900 rounded-lg p-1 w-fit border border-zinc-800">
        {(['compose', 'template'] as const).map(t => (
          <button key={t} onClick={() => setPromotionTab(t)}
            className={`px-3 py-1.5 rounded-md text-xs md:text-sm font-medium transition ${promotionTab === t ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}>
            {t === 'compose' ? 'Compose Pitch' : 'Email Template'}
          </button>
        ))}
      </div>

      {promotionTab === 'template' && promotionSection === 'radio' && (
        <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 md:p-6 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-1">Radio Email Template</h2>
            <p className="text-sm text-zinc-500 mb-2">Click a variable to copy it:</p>
            <div className="flex flex-wrap gap-1.5">
              {['{{stationName}}', '{{trackTitle}}', '{{driveLink}}', '{{senderName}}'].map(v => (
                <CopyChip key={v} value={v} />
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Subject line</label>
            <input type="text" value={radioSubject} onChange={e => setRadioSubject(e.target.value)}
              className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-2.5 text-sm text-white font-mono focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition" />
          </div>
          <textarea value={radioTemplate} onChange={e => setRadioTemplate(e.target.value)} rows={16}
            className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-3 text-sm text-white font-mono focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition resize-y" />
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <button onClick={() => { setRadioTemplate(DEFAULT_RADIO_TEMPLATE); setRadioSubject(DEFAULT_RADIO_SUBJECT); }} className="text-xs text-zinc-500 hover:text-zinc-300 transition">
              Reset to default
            </button>
            <SpamScoreBadge template={radioTemplate} />
          </div>
          <div className="pt-3 border-t border-zinc-800 space-y-3">
            <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Saved Templates</h3>
            {radioTemplateLibrary.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {radioTemplateLibrary.map(t => (
                  <div key={t.id} className="inline-flex items-center gap-1.5 bg-zinc-800 border border-zinc-700 rounded-full pl-3 pr-1.5 py-1">
                    <button onClick={() => loadRadioTemplateFromLibrary(t)} className="text-xs text-zinc-200 hover:text-violet-400 transition">{t.name}</button>
                    <button onClick={() => deleteRadioTemplateFromLibrary(t.id)} className="text-zinc-600 hover:text-red-400 transition text-sm leading-none px-1">×</button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <input value={newRadioTemplateName} onChange={e => setNewRadioTemplateName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveRadioTemplateToLibrary(); }}
                placeholder="Name this template (e.g. Indie Stations)"
                className="flex-1 rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent" />
              <button onClick={saveRadioTemplateToLibrary} disabled={!newRadioTemplateName.trim()}
                className="rounded-lg bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 px-4 py-2 text-sm font-semibold text-white transition shrink-0">
                Save Current
              </button>
            </div>
          </div>
        </section>
      )}

      {promotionTab === 'template' && promotionSection === 'playlists' && (
        <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 md:p-6 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-1">Playlist Email Template</h2>
            <p className="text-sm text-zinc-500 mb-2">Click a variable to copy it:</p>
            <div className="flex flex-wrap gap-1.5">
              {['{{curatorName}}', '{{trackTitle}}', '{{driveLink}}', '{{senderName}}'].map(v => (
                <CopyChip key={v} value={v} />
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Subject line</label>
            <input type="text" value={playlistSubject} onChange={e => setPlaylistSubject(e.target.value)}
              className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-2.5 text-sm text-white font-mono focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition" />
          </div>
          <textarea value={playlistTemplate} onChange={e => setPlaylistTemplate(e.target.value)} rows={16}
            className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-3 text-sm text-white font-mono focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition resize-y" />
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <button onClick={() => { setPlaylistTemplate(DEFAULT_PLAYLIST_TEMPLATE); setPlaylistSubject(DEFAULT_PLAYLIST_SUBJECT); }} className="text-xs text-zinc-500 hover:text-zinc-300 transition">
              Reset to default
            </button>
            <SpamScoreBadge template={playlistTemplate} />
          </div>
          <div className="pt-3 border-t border-zinc-800 space-y-3">
            <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Saved Templates</h3>
            {playlistTemplateLibrary.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {playlistTemplateLibrary.map(t => (
                  <div key={t.id} className="inline-flex items-center gap-1.5 bg-zinc-800 border border-zinc-700 rounded-full pl-3 pr-1.5 py-1">
                    <button onClick={() => loadPlaylistTemplateFromLibrary(t)} className="text-xs text-zinc-200 hover:text-violet-400 transition">{t.name}</button>
                    <button onClick={() => deletePlaylistTemplateFromLibrary(t.id)} className="text-zinc-600 hover:text-red-400 transition text-sm leading-none px-1">×</button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <input value={newPlaylistTemplateName} onChange={e => setNewPlaylistTemplateName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') savePlaylistTemplateToLibrary(); }}
                placeholder="Name this template (e.g. Indie Pop Playlists)"
                className="flex-1 rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent" />
              <button onClick={savePlaylistTemplateToLibrary} disabled={!newPlaylistTemplateName.trim()}
                className="rounded-lg bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 px-4 py-2 text-sm font-semibold text-white transition shrink-0">
                Save Current
              </button>
            </div>
          </div>
        </section>
      )}

      {promotionTab === 'compose' && (<>
        {/* Section toggle: Radio / Playlists */}
        <div className="flex gap-1.5">
          {(['radio', 'playlists'] as const).map(sec => (
            <button key={sec} onClick={() => setPromotionSection(sec)}
              className={`px-4 py-1.5 rounded-full text-xs font-medium border transition capitalize ${promotionSection === sec ? 'bg-violet-600 border-violet-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white'}`}>
              {sec === 'radio' ? 'Radio' : 'Playlist Curators'}
            </button>
          ))}
        </div>

        {/* Playlists section */}
        {promotionSection === 'playlists' && (<>
          {playlistAllGenres.length === 0 && (
            <div className="rounded-lg bg-amber-900/20 border border-amber-700/40 px-5 py-3">
              <p className="text-amber-400 text-sm">
                The playlist curator database (<code className="text-amber-300">data/playlists.json</code>) is empty, so this tab has no one to send to yet.
                Add curator records there matching the <code className="text-amber-300">PlaylistCurator</code> shape in <code className="text-amber-300">lib/playlists.ts</code> to enable it.
              </p>
            </div>
          )}
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
                {playlistPitchCount > 0 && (
                  <p className="text-xs text-amber-400 mt-1.5">Already pitched to {playlistPitchCount} recipient{playlistPitchCount !== 1 ? 's' : ''} for this track.</p>
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
            {playlistPresets.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {playlistPresets.map(p => (
                  <div key={p.id} className="inline-flex items-center gap-1.5 bg-zinc-800 border border-zinc-700 rounded-full pl-3 pr-1.5 py-1">
                    <button onClick={() => loadPlaylistPreset(p)} className="text-xs text-zinc-200 hover:text-violet-400 transition">{p.name}</button>
                    <button onClick={() => deletePlaylistPreset(p.id)} className="text-zinc-600 hover:text-red-400 transition text-sm leading-none px-1">×</button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <input value={newPlaylistPresetName} onChange={e => setNewPlaylistPresetName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') savePlaylistPreset(); }}
                placeholder="Name this filter set (e.g. Indie Pop Playlists)"
                className="flex-1 rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent" />
              <button onClick={savePlaylistPreset} disabled={!newPlaylistPresetName.trim()}
                className="rounded-lg bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 px-4 py-2 text-sm font-semibold text-white transition shrink-0">
                Save Current
              </button>
            </div>
          </section>

          {/* Genre Filter */}
          <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 md:p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Genre Filter</h2>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-zinc-500">Match:</span>
                {(['any', 'all'] as const).map(mode => (
                  <button key={mode} onClick={() => { setPlaylistMatchMode(mode); setPlaylistPreviewDone(false); setPlaylistSendResult(null); }}
                    className={`px-3 py-1 rounded-full text-xs font-medium border transition ${playlistMatchMode === mode ? 'bg-violet-600 border-violet-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white'}`}>
                    {mode === 'any' ? 'Any genre' : 'All genres'}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-sm text-zinc-500">
              {playlistMatchMode === 'any' ? 'Curators tagged with at least one selected genre. Leave empty to include all.' : 'Curators tagged with every selected genre.'}
            </p>
            {selectedPlaylistGenres.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {selectedPlaylistGenres.map(g => (
                  <button key={g} onClick={() => togglePlaylistGenre(g)}
                    className="inline-flex items-center gap-1.5 bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium px-3 py-1 rounded-full transition">
                    {g}<span className="text-violet-200">×</span>
                  </button>
                ))}
                <button onClick={() => { setSelectedPlaylistGenres([]); setPlaylistPreviewDone(false); setPlaylistSendResult(null); }}
                  className="text-xs text-zinc-500 hover:text-zinc-300 px-2 py-1 transition">Clear all</button>
              </div>
            )}
            <div className="relative">
              <input type="text" value={playlistGenreSearch} onChange={e => setPlaylistGenreSearch(e.target.value)}
                onFocus={() => setShowPlaylistGenreDropdown(true)}
                onBlur={() => setTimeout(() => setShowPlaylistGenreDropdown(false), 150)}
                placeholder="Search genres (e.g. Pop, Alternative, Indie...)"
                className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-2.5 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition" />
              {showPlaylistGenreDropdown && filteredPlaylistGenres.length > 0 && (
                <div className="absolute z-10 mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl max-h-56 overflow-y-auto">
                  {filteredPlaylistGenres.map(g => (
                    <button key={g} onMouseDown={() => { togglePlaylistGenre(g); setPlaylistGenreSearch(''); }}
                      className="w-full text-left px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-700 transition">{g}</button>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* Platform Filter */}
          <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 md:p-6 space-y-4">
            <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Platform Filter</h2>
            <p className="text-sm text-zinc-500">Filter curators by streaming platform. Leave empty to include all platforms.</p>
            <div className="flex flex-wrap gap-2">
              {PLATFORM_OPTIONS.map(platform => (
                <button key={platform} onClick={() => togglePlatform(platform)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${
                    selectedPlatforms.includes(platform)
                      ? 'bg-violet-600 border-violet-500 text-white'
                      : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white'
                  }`}>
                  {platform}
                </button>
              ))}
              {selectedPlatforms.length > 0 && (
                <button onClick={() => { setSelectedPlatforms([]); setPlaylistPreviewDone(false); setPlaylistSendResult(null); }}
                  className="text-xs text-zinc-500 hover:text-zinc-300 px-2 py-1 transition">Clear</button>
              )}
            </div>
          </section>

          {/* Preview */}
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={handlePlaylistPreview} disabled={playlistPreviewLoading}
              className="rounded-lg bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 px-5 py-2.5 text-sm font-semibold text-white transition">
              {playlistPreviewLoading ? 'Loading...' : 'Preview Curators'}
            </button>
            {playlistPreviewDone && (
              <>
                <button
                  onClick={() => { setPreviewModalType('playlists'); setPreviewModalIdx(0); }}
                  className="rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 px-4 py-2.5 text-sm font-medium text-zinc-300 transition">
                  Preview Email
                </button>
                <span className="text-sm text-zinc-400">{playlistCurators.length} curators · {playlistTotalEmails} emails</span>
              </>
            )}
          </div>

          {playlistPreviewDone && playlistCurators.length > 0 && (
            <section className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
              <div className="px-4 md:px-6 py-3 md:py-4 border-b border-zinc-800">
                <h3 className="text-sm font-semibold text-zinc-300">Curators Preview <span className="text-zinc-500 font-normal">· {playlistCurators.length} curators</span></h3>
              </div>
              <div className="divide-y divide-zinc-800 max-h-[32rem] overflow-y-auto">
                {playlistCurators.map(c => {
                  const pitchedTracks = c.emails.flatMap(email => pitchedEmailMap.get(email.toLowerCase()) ?? []);
                  const uniquePitched = [...new Set(pitchedTracks)];
                  return (
                    <div key={c.name} className="px-4 md:px-6 py-3 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-4">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <p className="text-sm font-medium text-white">{c.name}</p>
                          {uniquePitched.length > 0 && <PitchedBadge tracks={uniquePitched} />}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                          <span className="text-xs text-zinc-500">{c.platform}{c.followers ? ` · ${c.followers.toLocaleString()} followers` : ''}</span>
                          {c.genres.slice(0, 3).map(g => (
                            <span key={g} className="text-xs bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded">{g}</span>
                          ))}
                        </div>
                      </div>
                      <div className="sm:text-right sm:shrink-0 space-y-0.5">
                        {c.emails.map(email => (
                          <p key={email} className="text-xs text-violet-400 break-all sm:break-normal">{email}</p>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {playlistPreviewDone && playlistCurators.length === 0 && (
            <p className="text-sm text-zinc-500">No curators found for the selected filters.</p>
          )}

          {!playlistSendResult && playlistDuplicateRecipients.length > 0 && (
            <div className="rounded-lg bg-amber-900/20 border border-amber-700/40 px-5 py-3">
              <p className="text-amber-400 text-sm">
                {playlistDuplicateRecipients.length} recipient{playlistDuplicateRecipients.length !== 1 ? 's have' : ' has'} already been pitched &ldquo;{trackTitle}&rdquo; before (via Song Demos or Track Promotion). You can still send.
              </p>
            </div>
          )}

          {!playlistSendResult && playlistInvalidEmails.length > 0 && (
            <div className="rounded-lg bg-red-900/20 border border-red-700/40 px-5 py-3 space-y-2">
              <p className="text-red-400 text-sm">
                {playlistInvalidEmails.length} address{playlistInvalidEmails.length !== 1 ? 'es' : ''} {playlistInvalidEmails.length !== 1 ? "don't" : "doesn't"} look deliverable (no working mail server found) and will likely bounce.
              </p>
              <button onClick={() => { addFailedToBlacklist(playlistInvalidEmails); setPlaylistInvalidEmails([]); }}
                className="text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 px-3 py-1.5 rounded-lg text-zinc-300 transition">
                Add {playlistInvalidEmails.length} address{playlistInvalidEmails.length !== 1 ? 'es' : ''} to blacklist
              </button>
            </div>
          )}

          {playlistSendResult && (
            <div className="rounded-lg bg-green-900/30 border border-green-700 px-5 py-4 space-y-2">
              <p className="text-green-400 font-semibold">
                Sent {playlistSendResult.sent} of {playlistSendResult.total} emails successfully.
                {playlistSendResult.failed > 0 && ` ${playlistSendResult.failed} failed.`}
              </p>
              {playlistSendFailedEmails.length > 0 && (
                <button
                  onClick={() => { addFailedToBlacklist(playlistSendFailedEmails); setPlaylistSendFailedEmails([]); }}
                  className="text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 px-3 py-1.5 rounded-lg text-zinc-300 transition"
                >
                  Add {playlistSendFailedEmails.length} failed address{playlistSendFailedEmails.length !== 1 ? 'es' : ''} to blacklist
                </button>
              )}
            </div>
          )}
          {playlistSendError && (
            <div className="rounded-lg bg-red-900/30 border border-red-700 px-5 py-4">
              <p className="text-red-400 text-sm">{playlistSendError}</p>
            </div>
          )}

          <div className="flex flex-col sm:flex-row sm:items-center gap-3 pb-6">
            <button onClick={handlePlaylistSend} disabled={!canSendPlaylist || playlistSending}
              className="rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 px-6 py-3 font-semibold text-white transition focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 focus:ring-offset-zinc-950 text-sm">
              {playlistSending ? `Sending... (${(playlistSendResult?.sent ?? 0) + (playlistSendResult?.failed ?? 0)}/${playlistTotalEmails})` : canSendPlaylist ? `Send to ${playlistTotalEmails} curator${playlistTotalEmails !== 1 ? 's' : ''}` : 'Preview curators first'}
            </button>
            {selectedAccount ? (
              <span className="text-xs text-zinc-500">From <span className="text-zinc-300">{selectedAccount.name}</span> ({selectedAccount.email || selectedAccount.smtpUser})</span>
            ) : (
              <span className="text-xs text-amber-500">No email account — <button onClick={() => setActiveSection('account')} className="underline hover:text-amber-400">add one</button></span>
            )}
          </div>
        </>)}

        {/* Radio section */}
        {promotionSection === 'radio' && (<>
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
                {radioPitchCount > 0 && (
                  <p className="text-xs text-amber-400 mt-1.5">Already pitched to {radioPitchCount} recipient{radioPitchCount !== 1 ? 's' : ''} for this track.</p>
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
            {radioPresets.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {radioPresets.map(p => (
                  <div key={p.id} className="inline-flex items-center gap-1.5 bg-zinc-800 border border-zinc-700 rounded-full pl-3 pr-1.5 py-1">
                    <button onClick={() => loadRadioPreset(p)} className="text-xs text-zinc-200 hover:text-violet-400 transition">{p.name}</button>
                    <button onClick={() => deleteRadioPreset(p.id)} className="text-zinc-600 hover:text-red-400 transition text-sm leading-none px-1">×</button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <input value={newRadioPresetName} onChange={e => setNewRadioPresetName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveRadioPreset(); }}
                placeholder="Name this filter set (e.g. Australian Radio)"
                className="flex-1 rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent" />
              <button onClick={saveRadioPreset} disabled={!newRadioPresetName.trim()}
                className="rounded-lg bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 px-4 py-2 text-sm font-semibold text-white transition shrink-0">
                Save Current
              </button>
            </div>
          </section>

          {/* Genre Filter */}
          <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 md:p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Genre Filter</h2>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-zinc-500">Match:</span>
                {(['any', 'all'] as const).map(mode => (
                  <button key={mode} onClick={() => { setRadioMatchMode(mode); setRadioPreviewDone(false); setRadioSendResult(null); }}
                    className={`px-3 py-1 rounded-full text-xs font-medium border transition ${radioMatchMode === mode ? 'bg-violet-600 border-violet-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white'}`}>
                    {mode === 'any' ? 'Any genre' : 'All genres'}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-sm text-zinc-500">
              {radioMatchMode === 'any' ? 'Stations tagged with at least one selected genre. Leave empty to include all.' : 'Stations tagged with every selected genre.'}
            </p>
            {selectedRadioGenres.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {selectedRadioGenres.map(g => (
                  <button key={g} onClick={() => toggleRadioGenre(g)}
                    className="inline-flex items-center gap-1.5 bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium px-3 py-1 rounded-full transition">
                    {g}<span className="text-violet-200">×</span>
                  </button>
                ))}
                <button onClick={() => { setSelectedRadioGenres([]); setRadioPreviewDone(false); setRadioSendResult(null); }}
                  className="text-xs text-zinc-500 hover:text-zinc-300 px-2 py-1 transition">Clear all</button>
              </div>
            )}
            <div className="relative">
              <input type="text" value={radioGenreSearch} onChange={e => setRadioGenreSearch(e.target.value)}
                onFocus={() => setShowRadioGenreDropdown(true)}
                onBlur={() => setTimeout(() => setShowRadioGenreDropdown(false), 150)}
                placeholder="Search genres (e.g. Pop, Alternative, Indie...)"
                className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-2.5 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition" />
              {showRadioGenreDropdown && filteredRadioGenres.length > 0 && (
                <div className="absolute z-10 mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl max-h-56 overflow-y-auto">
                  {filteredRadioGenres.map(g => (
                    <button key={g} onMouseDown={() => { toggleRadioGenre(g); setRadioGenreSearch(''); }}
                      className="w-full text-left px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-700 transition">{g}</button>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* Location Filter */}
          <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 md:p-6 space-y-4">
            <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Location Filter</h2>
            <p className="text-sm text-zinc-500">Filter stations by region. Leave empty to include all locations.</p>
            <div className="flex flex-wrap gap-2">
              {LOCATION_OPTIONS.map(loc => (
                <button key={loc} onClick={() => toggleLocation(loc)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${
                    selectedLocations.includes(loc)
                      ? 'bg-violet-600 border-violet-500 text-white'
                      : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white'
                  }`}>
                  {loc}
                </button>
              ))}
              {selectedLocations.length > 0 && (
                <button onClick={() => { setSelectedLocations([]); setRadioPreviewDone(false); setRadioSendResult(null); }}
                  className="text-xs text-zinc-500 hover:text-zinc-300 px-2 py-1 transition">Clear</button>
              )}
            </div>
          </section>

          {/* Preview */}
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={handleRadioPreview} disabled={radioPreviewLoading}
              className="rounded-lg bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 px-5 py-2.5 text-sm font-semibold text-white transition">
              {radioPreviewLoading ? 'Loading...' : 'Preview Stations'}
            </button>
            {radioPreviewDone && (
              <>
                <button
                  onClick={() => { setPreviewModalType('radio'); setPreviewModalIdx(0); }}
                  className="rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 px-4 py-2.5 text-sm font-medium text-zinc-300 transition">
                  Preview Email
                </button>
                <span className="text-sm text-zinc-400">{radioStations.length} stations · {radioTotalEmails} emails</span>
              </>
            )}
          </div>

          {radioPreviewDone && radioStations.length > 0 && (
            <section className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
              <div className="px-4 md:px-6 py-3 md:py-4 border-b border-zinc-800">
                <h3 className="text-sm font-semibold text-zinc-300">Stations Preview <span className="text-zinc-500 font-normal">· {radioStations.length} stations</span></h3>
              </div>
              <div className="divide-y divide-zinc-800 max-h-[32rem] overflow-y-auto">
                {radioStations.map(s => {
                  const pitchedTracks = s.emails.flatMap(email => pitchedEmailMap.get(email.toLowerCase()) ?? []);
                  const uniquePitched = [...new Set(pitchedTracks)];
                  return (
                    <div key={s.name} className="px-4 md:px-6 py-3 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-4">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <p className="text-sm font-medium text-white">{s.name}</p>
                          {uniquePitched.length > 0 && <PitchedBadge tracks={uniquePitched} />}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                          <span className="text-xs text-zinc-500">{s.region}</span>
                          {s.genres.slice(0, 3).map(g => (
                            <span key={g} className="text-xs bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded">{g}</span>
                          ))}
                        </div>
                      </div>
                      <div className="sm:text-right sm:shrink-0 space-y-0.5">
                        {s.emails.map(email => (
                          <p key={email} className="text-xs text-violet-400 break-all sm:break-normal">{email}</p>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {radioPreviewDone && radioStations.length === 0 && (
            <p className="text-sm text-zinc-500">No stations found for the selected filters.</p>
          )}

          {!radioSendResult && radioDuplicateRecipients.length > 0 && (
            <div className="rounded-lg bg-amber-900/20 border border-amber-700/40 px-5 py-3">
              <p className="text-amber-400 text-sm">
                {radioDuplicateRecipients.length} recipient{radioDuplicateRecipients.length !== 1 ? 's have' : ' has'} already been pitched &ldquo;{trackTitle}&rdquo; before (via Song Demos or Track Promotion). You can still send.
              </p>
            </div>
          )}

          {!radioSendResult && radioInvalidEmails.length > 0 && (
            <div className="rounded-lg bg-red-900/20 border border-red-700/40 px-5 py-3 space-y-2">
              <p className="text-red-400 text-sm">
                {radioInvalidEmails.length} address{radioInvalidEmails.length !== 1 ? 'es' : ''} {radioInvalidEmails.length !== 1 ? "don't" : "doesn't"} look deliverable (no working mail server found) and will likely bounce.
              </p>
              <button onClick={() => { addFailedToBlacklist(radioInvalidEmails); setRadioInvalidEmails([]); }}
                className="text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 px-3 py-1.5 rounded-lg text-zinc-300 transition">
                Add {radioInvalidEmails.length} address{radioInvalidEmails.length !== 1 ? 'es' : ''} to blacklist
              </button>
            </div>
          )}

          {radioSendResult && (
            <div className="rounded-lg bg-green-900/30 border border-green-700 px-5 py-4 space-y-2">
              <p className="text-green-400 font-semibold">
                Sent {radioSendResult.sent} of {radioSendResult.total} emails successfully.
                {radioSendResult.failed > 0 && ` ${radioSendResult.failed} failed.`}
              </p>
              {radioSendFailedEmails.length > 0 && (
                <button
                  onClick={() => { addFailedToBlacklist(radioSendFailedEmails); setRadioSendFailedEmails([]); }}
                  className="text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 px-3 py-1.5 rounded-lg text-zinc-300 transition"
                >
                  Add {radioSendFailedEmails.length} failed address{radioSendFailedEmails.length !== 1 ? 'es' : ''} to blacklist
                </button>
              )}
            </div>
          )}
          {radioSendError && (
            <div className="rounded-lg bg-red-900/30 border border-red-700 px-5 py-4">
              <p className="text-red-400 text-sm">{radioSendError}</p>
            </div>
          )}

          <div className="flex flex-col sm:flex-row sm:items-center gap-3 pb-6">
            <button onClick={handleRadioSend} disabled={!canSendRadio || radioSending}
              className="rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 px-6 py-3 font-semibold text-white transition focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 focus:ring-offset-zinc-950 text-sm">
              {radioSending ? `Sending... (${(radioSendResult?.sent ?? 0) + (radioSendResult?.failed ?? 0)}/${radioTotalEmails})` : canSendRadio ? `Send to ${radioTotalEmails} station${radioTotalEmails !== 1 ? 's' : ''}` : 'Preview stations first'}
            </button>
            {selectedAccount ? (
              <span className="text-xs text-zinc-500">From <span className="text-zinc-300">{selectedAccount.name}</span> ({selectedAccount.email || selectedAccount.smtpUser})</span>
            ) : (
              <span className="text-xs text-amber-500">No email account — <button onClick={() => setActiveSection('account')} className="underline hover:text-amber-400">add one</button></span>
            )}
          </div>
        </>)}
      </>)}
    </>
  );
}
