'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import CampaignChrome from '../_components/CampaignChrome';
import { loadSongs, addSong, upsertCampaign, type Song, type OutreachCampaign, type CampaignTargetState } from '@/lib/campaigns';
import { GOAL_META, fetchCampaignMeta, fetchCampaignTargets, type GoalType, type CampaignMeta, type TargetCriteria } from '@/lib/campaignTargets';

type Step = 'song' | 'goal' | 'criteria';

export default function NewCampaignPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('song');

  const [songs, setSongs] = useState<Song[]>([]);
  const [selectedSongId, setSelectedSongId] = useState<string | null>(null);
  const [newSongTitle, setNewSongTitle] = useState('');
  const [newSongLink, setNewSongLink] = useState('');

  const [goal, setGoal] = useState<GoalType | null>(null);

  const [meta, setMeta] = useState<CampaignMeta | null>(null);
  const [metaLoading, setMetaLoading] = useState(false);
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [genreSearch, setGenreSearch] = useState('');
  const [showGenreDropdown, setShowGenreDropdown] = useState(false);
  const [selectedLocations, setSelectedLocations] = useState<string[]>([]);
  const [selectedSubtypes, setSelectedSubtypes] = useState<string[]>([]);
  const [matchMode, setMatchMode] = useState<'any' | 'all'>('any');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSongs(loadSongs());
  }, []);

  useEffect(() => {
    if (step !== 'criteria' || !goal) return;
    setMetaLoading(true);
    setSelectedGenres([]);
    setSelectedLocations([]);
    setSelectedSubtypes([]);
    fetchCampaignMeta(goal)
      .then(setMeta)
      .finally(() => setMetaLoading(false));
  }, [step, goal]);

  const filteredGenres = useMemo(() => {
    if (!meta) return [];
    return meta.genres.filter(g => !selectedGenres.includes(g) && g.toLowerCase().includes(genreSearch.toLowerCase()));
  }, [meta, selectedGenres, genreSearch]);

  function toggleGenre(g: string) {
    setSelectedGenres(prev => prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g]);
  }

  function toggleLocation(l: string) {
    setSelectedLocations(prev => prev.includes(l) ? prev.filter(x => x !== l) : [...prev, l]);
  }

  function toggleSubtype(s: string) {
    setSelectedSubtypes(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
  }

  const selectedSong = songs.find(s => s.id === selectedSongId) ?? null;

  function handleCreateSong() {
    if (!newSongTitle.trim()) return;
    const song = addSong({ title: newSongTitle.trim(), driveLink: newSongLink.trim() });
    setSongs(prev => [...prev, song]);
    setSelectedSongId(song.id);
    setNewSongTitle('');
    setNewSongLink('');
  }

  async function handleSubmit() {
    if (!selectedSong || !goal) return;
    setSubmitting(true);
    setError(null);
    try {
      const criteria: TargetCriteria = {
        genres: selectedGenres,
        locations: selectedLocations,
        subtypes: selectedSubtypes,
        matchMode,
      };
      const fetched = await fetchCampaignTargets(goal, criteria);
      const targets: CampaignTargetState[] = fetched.map(t => ({
        ...t,
        selected: false,
        status: 'not_contacted',
        draft: null,
      }));
      const campaign: OutreachCampaign = {
        id: `campaign-${Date.now()}`,
        songId: selectedSong.id,
        songTitle: selectedSong.title,
        songDriveLink: selectedSong.driveLink,
        goal,
        criteria,
        createdAt: Date.now(),
        targets,
      };
      upsertCampaign(campaign);
      router.push(`/dashboard/campaigns/${campaign.id}`);
    } catch {
      setError('Could not fetch targets. Please try again.');
      setSubmitting(false);
    }
  }

  return (
    <CampaignChrome>
      <div>
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-1">New Campaign</h2>
        <p className="text-xs text-zinc-500">
          Step {step === 'song' ? 1 : step === 'goal' ? 2 : 3} of 3 — {step === 'song' ? 'pick a song' : step === 'goal' ? 'pick a goal' : 'define your targets'}
        </p>
      </div>

      {step === 'song' && (
        <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 md:p-6 space-y-4">
          <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Which song?</h3>
          <div className="grid gap-2">
            {songs.map(s => (
              <button
                key={s.id}
                onClick={() => setSelectedSongId(s.id)}
                className={`text-left px-4 py-3 rounded-lg border text-sm font-medium transition ${
                  selectedSongId === s.id ? 'bg-violet-600 border-violet-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white'
                }`}
              >
                {s.title}
              </button>
            ))}
          </div>
          <div className="border-t border-zinc-800 pt-4 space-y-2">
            <p className="text-xs font-medium text-zinc-400">Or add a new song</p>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={newSongTitle}
                onChange={e => setNewSongTitle(e.target.value)}
                placeholder="Song title"
                className="flex-1 rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-2.5 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition"
              />
              <input
                type="text"
                value={newSongLink}
                onChange={e => setNewSongLink(e.target.value)}
                placeholder="Link (optional)"
                className="flex-1 rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-2.5 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition"
              />
              <button
                onClick={handleCreateSong}
                disabled={!newSongTitle.trim()}
                className="px-4 py-2.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-white text-sm font-medium transition disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
              >
                Add
              </button>
            </div>
          </div>
          <div className="flex justify-end pt-2">
            <button
              onClick={() => setStep('goal')}
              disabled={!selectedSong}
              className="px-5 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </section>
      )}

      {step === 'goal' && (
        <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 md:p-6 space-y-4">
          <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">What&apos;s the goal for &quot;{selectedSong?.title}&quot;?</h3>
          <div className="grid sm:grid-cols-2 gap-3">
            {(Object.keys(GOAL_META) as GoalType[]).map(g => (
              <button
                key={g}
                onClick={() => setGoal(g)}
                className={`text-left px-4 py-4 rounded-lg border transition ${
                  goal === g ? 'bg-violet-600 border-violet-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white'
                }`}
              >
                <div className="text-sm font-semibold">{GOAL_META[g].label}</div>
                <div className={`text-xs mt-1 ${goal === g ? 'text-violet-100' : 'text-zinc-500'}`}>{GOAL_META[g].description}</div>
              </button>
            ))}
          </div>
          <div className="flex justify-between pt-2">
            <button onClick={() => setStep('song')} className="px-5 py-2.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-white text-sm font-medium transition">
              Back
            </button>
            <button
              onClick={() => setStep('criteria')}
              disabled={!goal}
              className="px-5 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </section>
      )}

      {step === 'criteria' && goal && (
        <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 md:p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Define your targets</h3>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-zinc-500">Match:</span>
              {(['any', 'all'] as const).map(mode => (
                <button
                  key={mode}
                  onClick={() => setMatchMode(mode)}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition ${matchMode === mode ? 'bg-violet-600 border-violet-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white'}`}
                >
                  {mode === 'any' ? 'Any genre' : 'All genres'}
                </button>
              ))}
            </div>
          </div>

          {metaLoading || !meta ? (
            <p className="text-sm text-zinc-500">Loading filters…</p>
          ) : (
            <>
              <div className="space-y-2">
                <p className="text-xs font-medium text-zinc-400">Genres</p>
                {selectedGenres.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {selectedGenres.map(g => (
                      <button
                        key={g}
                        onClick={() => toggleGenre(g)}
                        className="inline-flex items-center gap-1.5 bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium px-3 py-1 rounded-full transition"
                      >
                        {g}<span className="text-violet-200">×</span>
                      </button>
                    ))}
                    <button onClick={() => setSelectedGenres([])} className="text-xs text-zinc-500 hover:text-zinc-300 px-2 py-1 transition">Clear all</button>
                  </div>
                )}
                <div className="relative">
                  <input
                    type="text"
                    value={genreSearch}
                    onChange={e => setGenreSearch(e.target.value)}
                    onFocus={() => setShowGenreDropdown(true)}
                    onBlur={() => setTimeout(() => setShowGenreDropdown(false), 150)}
                    placeholder="Search genres..."
                    className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-2.5 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition"
                  />
                  {showGenreDropdown && filteredGenres.length > 0 && (
                    <div className="absolute z-10 mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl max-h-56 overflow-y-auto">
                      {filteredGenres.map(g => (
                        <button key={g} onMouseDown={() => { toggleGenre(g); setGenreSearch(''); }} className="w-full text-left px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-700 transition">
                          {g}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {meta.locations.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-zinc-400">{meta.locationLabel ?? 'Location'}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {meta.locations.map(l => (
                      <button
                        key={l}
                        onClick={() => toggleLocation(l)}
                        className={`px-2.5 py-1 rounded-full text-xs font-medium border transition ${selectedLocations.includes(l) ? 'bg-violet-600 border-violet-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white'}`}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {meta.subtypes.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-zinc-400">{meta.subtypeLabel ?? 'Type'}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {meta.subtypes.map(s => (
                      <button
                        key={s}
                        onClick={() => toggleSubtype(s)}
                        className={`px-2.5 py-1 rounded-full text-xs font-medium border transition ${selectedSubtypes.includes(s) ? 'bg-violet-600 border-violet-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white'}`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex justify-between pt-2">
            <button onClick={() => setStep('goal')} className="px-5 py-2.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-white text-sm font-medium transition">
              Back
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="px-5 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {submitting ? 'Finding targets…' : 'Find targets'}
            </button>
          </div>
        </section>
      )}
    </CampaignChrome>
  );
}
