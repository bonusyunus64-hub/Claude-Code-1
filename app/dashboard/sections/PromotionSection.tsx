import type { EmailAccount, RadioStation } from '../types';
import type { PromotionChannel } from '../hooks/usePromotionChannel';
import { DEFAULT_RADIO_TEMPLATE, DEFAULT_RADIO_SUBJECT, LOCATION_OPTIONS } from '../constants';
import { CopyChip } from '../components/CopyChip';
import { PitchedBadge } from '../components/PitchedBadge';
import { SpamScoreBadge } from '../components/SpamScoreBadge';

export interface PromotionSectionProps {
  promotionTab: 'compose' | 'template';
  setPromotionTab: (tab: 'compose' | 'template') => void;

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
  setPreviewModalType: (type: 'demos' | 'radio' | null) => void;
  setPreviewModalIdx: (idx: number) => void;

  radio: PromotionChannel<RadioStation>;
  radioPitchCount: number;
}

export function PromotionSection(props: PromotionSectionProps) {
  const {
    promotionTab, setPromotionTab,
    senderName, setSenderName, trackTitle, setTrackTitle, driveLink, setDriveLink,
    pitchedEmailMap, selectedAccount, setActiveSection, addFailedToBlacklist, setPreviewModalType, setPreviewModalIdx,
    radio, radioPitchCount,
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

      {promotionTab === 'template' && (
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
            <input type="text" value={radio.subject} onChange={e => radio.setSubject(e.target.value)}
              className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-2.5 text-sm text-white font-mono focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition" />
          </div>
          <textarea value={radio.template} onChange={e => radio.setTemplate(e.target.value)} rows={16}
            className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-3 text-sm text-white font-mono focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition resize-y" />
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <button onClick={() => { radio.setTemplate(DEFAULT_RADIO_TEMPLATE); radio.setSubject(DEFAULT_RADIO_SUBJECT); }} className="text-xs text-zinc-500 hover:text-zinc-300 transition">
              Reset to default
            </button>
            <SpamScoreBadge template={radio.template} />
          </div>
          <div className="pt-3 border-t border-zinc-800 space-y-3">
            <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Saved Templates</h3>
            {radio.templateLibrary.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {radio.templateLibrary.map(t => (
                  <div key={t.id} className="inline-flex items-center gap-1.5 bg-zinc-800 border border-zinc-700 rounded-full pl-3 pr-1.5 py-1">
                    <button onClick={() => radio.loadTemplateFromLibrary(t)} className="text-xs text-zinc-200 hover:text-violet-400 transition">{t.name}</button>
                    <button onClick={() => radio.deleteTemplateFromLibrary(t.id)} className="text-zinc-600 hover:text-red-400 transition text-sm leading-none px-1">×</button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <input value={radio.newTemplateName} onChange={e => radio.setNewTemplateName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') radio.saveTemplateToLibrary(); }}
                placeholder="Name this template (e.g. Indie Stations)"
                className="flex-1 rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent" />
              <button onClick={radio.saveTemplateToLibrary} disabled={!radio.newTemplateName.trim()}
                className="rounded-lg bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 px-4 py-2 text-sm font-semibold text-white transition shrink-0">
                Save Current
              </button>
            </div>
          </div>
        </section>
      )}

      {promotionTab === 'compose' && (<>
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
            {radio.presets.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {radio.presets.map(p => (
                  <div key={p.id} className="inline-flex items-center gap-1.5 bg-zinc-800 border border-zinc-700 rounded-full pl-3 pr-1.5 py-1">
                    <button onClick={() => radio.loadPreset(p)} className="text-xs text-zinc-200 hover:text-violet-400 transition">{p.name}</button>
                    <button onClick={() => radio.deletePreset(p.id)} className="text-zinc-600 hover:text-red-400 transition text-sm leading-none px-1">×</button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <input value={radio.newPresetName} onChange={e => radio.setNewPresetName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') radio.savePreset(); }}
                placeholder="Name this filter set (e.g. Australian Radio)"
                className="flex-1 rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent" />
              <button onClick={radio.savePreset} disabled={!radio.newPresetName.trim()}
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
                  <button key={mode} onClick={() => { radio.setMatchMode(mode); radio.resetPreview(); }}
                    className={`px-3 py-1 rounded-full text-xs font-medium border transition ${radio.matchMode === mode ? 'bg-violet-600 border-violet-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white'}`}>
                    {mode === 'any' ? 'Any genre' : 'All genres'}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-sm text-zinc-500">
              {radio.matchMode === 'any' ? 'Stations tagged with at least one selected genre. Leave empty to include all.' : 'Stations tagged with every selected genre.'}
            </p>
            {radio.selectedGenres.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {radio.selectedGenres.map(g => (
                  <button key={g} onClick={() => radio.toggleGenre(g)}
                    className="inline-flex items-center gap-1.5 bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium px-3 py-1 rounded-full transition">
                    {g}<span className="text-violet-200">×</span>
                  </button>
                ))}
                <button onClick={() => { radio.setSelectedGenres([]); radio.resetPreview(); }}
                  className="text-xs text-zinc-500 hover:text-zinc-300 px-2 py-1 transition">Clear all</button>
              </div>
            )}
            <div className="relative">
              <input type="text" value={radio.genreSearch} onChange={e => radio.setGenreSearch(e.target.value)}
                onFocus={() => radio.setShowGenreDropdown(true)}
                onBlur={() => setTimeout(() => radio.setShowGenreDropdown(false), 150)}
                placeholder="Search genres (e.g. Pop, Alternative, Indie...)"
                className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-2.5 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition" />
              {radio.showGenreDropdown && radio.filteredGenres.length > 0 && (
                <div className="absolute z-10 mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl max-h-56 overflow-y-auto">
                  {radio.filteredGenres.map(g => (
                    <button key={g} onMouseDown={() => { radio.toggleGenre(g); radio.setGenreSearch(''); }}
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
                <button key={loc} onClick={() => radio.toggleSecondary(loc)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${
                    radio.selectedSecondary.includes(loc)
                      ? 'bg-violet-600 border-violet-500 text-white'
                      : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white'
                  }`}>
                  {loc}
                </button>
              ))}
              {radio.selectedSecondary.length > 0 && (
                <button onClick={() => { radio.setSelectedSecondary([]); radio.resetPreview(); }}
                  className="text-xs text-zinc-500 hover:text-zinc-300 px-2 py-1 transition">Clear</button>
              )}
            </div>
          </section>

          {/* Preview */}
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={radio.handlePreview} disabled={radio.previewLoading}
              className="rounded-lg bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 px-5 py-2.5 text-sm font-semibold text-white transition">
              {radio.previewLoading ? 'Loading...' : 'Preview Stations'}
            </button>
            {radio.previewDone && (
              <>
                <button
                  onClick={() => { setPreviewModalType('radio'); setPreviewModalIdx(0); }}
                  className="rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 px-4 py-2.5 text-sm font-medium text-zinc-300 transition">
                  Preview Email
                </button>
                <span className="text-sm text-zinc-400">{radio.results.length} stations · {radio.totalEmails} emails</span>
              </>
            )}
          </div>

          {radio.previewDone && radio.results.length > 0 && (
            <section className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
              <div className="px-4 md:px-6 py-3 md:py-4 border-b border-zinc-800">
                <h3 className="text-sm font-semibold text-zinc-300">Stations Preview <span className="text-zinc-500 font-normal">· {radio.results.length} stations</span></h3>
              </div>
              <div className="divide-y divide-zinc-800 max-h-[32rem] overflow-y-auto">
                {radio.results.map(s => {
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

          {radio.previewDone && radio.results.length === 0 && (
            <p className="text-sm text-zinc-500">No stations found for the selected filters.</p>
          )}

          {!radio.sendResult && radio.duplicateRecipients.length > 0 && (
            <div className="rounded-lg bg-amber-900/20 border border-amber-700/40 px-5 py-3">
              <p className="text-amber-400 text-sm">
                {radio.duplicateRecipients.length} recipient{radio.duplicateRecipients.length !== 1 ? 's have' : ' has'} already been pitched &ldquo;{trackTitle}&rdquo; before (via Song Demos or Track Promotion). You can still send.
              </p>
            </div>
          )}

          {!radio.sendResult && radio.invalidEmails.length > 0 && (
            <div className="rounded-lg bg-red-900/20 border border-red-700/40 px-5 py-3 space-y-2">
              <p className="text-red-400 text-sm">
                {radio.invalidEmails.length} address{radio.invalidEmails.length !== 1 ? 'es' : ''} {radio.invalidEmails.length !== 1 ? "don't" : "doesn't"} look deliverable (no working mail server found) and will likely bounce.
              </p>
              <button onClick={() => { addFailedToBlacklist(radio.invalidEmails); radio.setInvalidEmails([]); }}
                className="text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 px-3 py-1.5 rounded-lg text-zinc-300 transition">
                Add {radio.invalidEmails.length} address{radio.invalidEmails.length !== 1 ? 'es' : ''} to blacklist
              </button>
            </div>
          )}

          {radio.sendResult && (
            <div className="rounded-lg bg-green-900/30 border border-green-700 px-5 py-4 space-y-2">
              <p className="text-green-400 font-semibold">
                Sent {radio.sendResult.sent} of {radio.sendResult.total} emails successfully.
                {radio.sendResult.failed > 0 && ` ${radio.sendResult.failed} failed.`}
              </p>
              {radio.sendFailedEmails.length > 0 && (
                <button
                  onClick={() => { addFailedToBlacklist(radio.sendFailedEmails); radio.setSendFailedEmails([]); }}
                  className="text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 px-3 py-1.5 rounded-lg text-zinc-300 transition"
                >
                  Add {radio.sendFailedEmails.length} failed address{radio.sendFailedEmails.length !== 1 ? 'es' : ''} to blacklist
                </button>
              )}
            </div>
          )}
          {radio.sendError && (
            <div className="rounded-lg bg-red-900/30 border border-red-700 px-5 py-4">
              <p className="text-red-400 text-sm">{radio.sendError}</p>
            </div>
          )}

          <div className="flex flex-col sm:flex-row sm:items-center gap-3 pb-6">
            <button onClick={radio.handleSend} disabled={!radio.canSend || radio.sending}
              className="rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 px-6 py-3 font-semibold text-white transition focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 focus:ring-offset-zinc-950 text-sm">
              {radio.sending ? `Sending... (${(radio.sendResult?.sent ?? 0) + (radio.sendResult?.failed ?? 0)}/${radio.totalEmails})` : radio.canSend ? `Send to ${radio.totalEmails} station${radio.totalEmails !== 1 ? 's' : ''}` : 'Preview stations first'}
            </button>
            {selectedAccount ? (
              <span className="text-xs text-zinc-500">From <span className="text-zinc-300">{selectedAccount.name}</span> ({selectedAccount.email || selectedAccount.smtpUser})</span>
            ) : (
              <span className="text-xs text-amber-500">No email account — <button onClick={() => setActiveSection('account')} className="underline hover:text-amber-400">add one</button></span>
            )}
          </div>
      </>)}
    </>
  );
}
