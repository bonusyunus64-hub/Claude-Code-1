'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';

const DEFAULT_TEMPLATE = `Hi {{managerName}},

My name is {{senderName}}, and I'm reaching out to submit a track for your consideration for {{artistName}}.

I've attached the track "{{trackTitle}}" — you can listen here:
{{driveLink}}

I believe this would be a strong fit for {{artistName}}'s sound and audience. I'd love to discuss any potential collaboration or placement.

Please let me know if you need anything further.

Best regards,
{{senderName}}`;

interface Artist {
  name: string;
  genres: string[];
  spotifyFollowers: number;
  managementCompany: string;
  managerNames: string[];
  managerEmails: string[];
  labels: string;
  instagramHandle: string;
  avatarUrl: string;
}

export default function Dashboard() {
  const [allGenres, setAllGenres] = useState<string[]>([]);
  const [genreSearch, setGenreSearch] = useState('');
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [showGenreDropdown, setShowGenreDropdown] = useState(false);

  const [minAudience, setMinAudience] = useState(0);
  const [maxAudience, setMaxAudience] = useState(0);
  const [gender, setGender] = useState('');

  const [trackTitle, setTrackTitle] = useState('');
  const [driveLink, setDriveLink] = useState('');
  const [senderName, setSenderName] = useState('');
  const [emailTemplate, setEmailTemplate] = useState(DEFAULT_TEMPLATE);

  const [previewArtists, setPreviewArtists] = useState<Artist[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewDone, setPreviewDone] = useState(false);
  const [sortOrder, setSortOrder] = useState<'followers-desc' | 'followers-asc' | 'alpha-asc' | 'alpha-desc' | 'random'>('followers-desc');

  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ sent: number; failed: number; total: number } | null>(null);
  const [sendError, setSendError] = useState('');

  const [activeTab, setActiveTab] = useState<'compose' | 'template'>('compose');

  useEffect(() => {
    fetch('/api/genres')
      .then(r => r.json())
      .then(d => setAllGenres(d.genres || []));
  }, []);

  const filteredGenres = useMemo(() =>
    allGenres.filter(g =>
      g.toLowerCase().includes(genreSearch.toLowerCase()) &&
      !selectedGenres.includes(g)
    ).slice(0, 50),
    [allGenres, genreSearch, selectedGenres]
  );

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

  const resetFilters = () => { setPreviewDone(false); setSendResult(null); };

  const toggleGenre = useCallback((genre: string) => {
    setSelectedGenres(prev =>
      prev.includes(genre) ? prev.filter(g => g !== genre) : [...prev, genre]
    );
    setPreviewDone(false);
    setSendResult(null);
  }, []);

  async function handlePreview() {
    setPreviewLoading(true);
    setPreviewDone(false);
    try {
      const res = await fetch('/api/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ genres: selectedGenres, minAudience, maxAudience, gender }),
      });
      const data = await res.json();
      setPreviewArtists(data.artists || []);
      setPreviewDone(true);
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleSend() {
    if (!trackTitle || !driveLink || !selectedGenres.length) return;
    setSending(true);
    setSendError('');
    setSendResult(null);
    try {
      const res = await fetch('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackTitle, driveLink, genres: selectedGenres, emailTemplate, senderName, minAudience, maxAudience, gender }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSendError(data.error || 'Failed to send.');
      } else {
        setSendResult({ sent: data.sent, failed: data.failed, total: data.total });
      }
    } catch {
      setSendError('Network error. Please try again.');
    } finally {
      setSending(false);
    }
  }

  const sortedArtists = useMemo(() => {
    const arr = [...previewArtists];
    switch (sortOrder) {
      case 'followers-desc': return arr.sort((a, b) => b.spotifyFollowers - a.spotifyFollowers);
      case 'followers-asc':  return arr.sort((a, b) => a.spotifyFollowers - b.spotifyFollowers);
      case 'alpha-asc':      return arr.sort((a, b) => a.name.localeCompare(b.name));
      case 'alpha-desc':     return arr.sort((a, b) => b.name.localeCompare(a.name));
      case 'random':         return arr.sort(() => Math.random() - 0.5);
    }
  }, [previewArtists, sortOrder]);

  const totalEmails = previewArtists.reduce((acc, a) => acc + a.managerEmails.length, 0);
  const canSend = trackTitle && driveLink && selectedGenres.length > 0 && previewDone;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between">
        <h1 className="text-lg font-bold tracking-tight text-white">TrackPitch</h1>
        <a
          href="/api/logout"
          className="text-sm text-zinc-400 hover:text-white transition"
        >
          Log out
        </a>
      </header>

      <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-6 md:px-6 md:py-10 space-y-6 md:space-y-8">

        {/* Tabs */}
        <div className="flex gap-1 bg-zinc-900 rounded-lg p-1 w-fit">
          {(['compose', 'template'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition ${
                activeTab === tab
                  ? 'bg-zinc-700 text-white'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {tab === 'compose' ? 'Compose Pitch' : 'Email Template'}
            </button>
          ))}
        </div>

        {activeTab === 'compose' && (
          <div className="space-y-6">
            {/* Track Info */}
            <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 md:p-6 space-y-4">
              <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Track Details</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-1.5">Your Name</label>
                  <input
                    type="text"
                    value={senderName}
                    onChange={e => setSenderName(e.target.value)}
                    placeholder="Eren Senbay"
                    className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-2.5 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-1.5">Track Title</label>
                  <input
                    type="text"
                    value={trackTitle}
                    onChange={e => setTrackTitle(e.target.value)}
                    placeholder="e.g. Give Me A Sign"
                    className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-2.5 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-zinc-300 mb-1.5">Google Drive Link</label>
                  <input
                    type="url"
                    value={driveLink}
                    onChange={e => setDriveLink(e.target.value)}
                    placeholder="https://drive.google.com/file/d/..."
                    className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-2.5 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition"
                  />
                </div>
              </div>
            </section>

            {/* Genre Selector */}
            <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 md:p-6 space-y-4">
              <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Select Genres</h2>
              <p className="text-sm text-zinc-500">The track will be sent to managers of all artists tagged with the selected genres.</p>

              {/* Selected chips */}
              {selectedGenres.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {selectedGenres.map(g => (
                    <button
                      key={g}
                      onClick={() => toggleGenre(g)}
                      className="inline-flex items-center gap-1.5 bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium px-3 py-1 rounded-full transition"
                    >
                      {g}
                      <span className="text-violet-200">×</span>
                    </button>
                  ))}
                  <button
                    onClick={() => { setSelectedGenres([]); setPreviewDone(false); setSendResult(null); }}
                    className="text-xs text-zinc-500 hover:text-zinc-300 px-2 py-1 transition"
                  >
                    Clear all
                  </button>
                </div>
              )}

              {/* Search + dropdown */}
              <div className="relative">
                <input
                  type="text"
                  value={genreSearch}
                  onChange={e => setGenreSearch(e.target.value)}
                  onFocus={() => setShowGenreDropdown(true)}
                  onBlur={() => setTimeout(() => setShowGenreDropdown(false), 150)}
                  placeholder="Search genres (e.g. Pop, R&B, Hip Hop...)"
                  className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-2.5 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition"
                />
                {showGenreDropdown && filteredGenres.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl max-h-56 overflow-y-auto">
                    {filteredGenres.map(g => (
                      <button
                        key={g}
                        onMouseDown={() => { toggleGenre(g); setGenreSearch(''); }}
                        className="w-full text-left px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-700 transition"
                      >
                        {g}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </section>

            {/* Audience & Gender Filters */}
            <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 md:p-6 space-y-5">
              <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Filters</h2>

              {/* Follower range */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="space-y-2">
                  <p className="text-xs font-medium text-zinc-400">Min Spotify followers</p>
                  <div className="flex flex-wrap gap-1.5">
                    {FOLLOWER_STEPS.map(opt => (
                      <button
                        key={`min-${opt.value}`}
                        onClick={() => { setMinAudience(opt.value); resetFilters(); }}
                        className={`px-2.5 py-1 rounded-full text-xs font-medium border transition ${
                          minAudience === opt.value
                            ? 'bg-violet-600 border-violet-500 text-white'
                            : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-medium text-zinc-400">Max Spotify followers</p>
                  <div className="flex flex-wrap gap-1.5">
                    {FOLLOWER_STEPS.map(opt => (
                      <button
                        key={`max-${opt.value}`}
                        onClick={() => { setMaxAudience(opt.value); resetFilters(); }}
                        className={`px-2.5 py-1 rounded-full text-xs font-medium border transition ${
                          maxAudience === opt.value
                            ? 'bg-violet-600 border-violet-500 text-white'
                            : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Gender */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-zinc-400">Artist gender</p>
                <div className="flex gap-1.5">
                  {GENDER_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => { setGender(opt.value); resetFilters(); }}
                      className={`px-3 py-1 rounded-full text-xs font-medium border transition ${
                        gender === opt.value
                          ? 'bg-violet-600 border-violet-500 text-white'
                          : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </section>

            {/* Preview */}
            <div className="flex items-center gap-4">
              <button
                onClick={handlePreview}
                disabled={!selectedGenres.length || previewLoading}
                className="rounded-lg bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 px-5 py-2.5 text-sm font-semibold text-white transition"
              >
                {previewLoading ? 'Loading...' : 'Preview Recipients'}
              </button>
              {previewDone && (
                <span className="text-sm text-zinc-400">
                  {previewArtists.length} artists · {totalEmails} emails
                </span>
              )}
            </div>

            {previewDone && previewArtists.length > 0 && (
              <section className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
                <div className="px-4 md:px-6 py-3 md:py-4 border-b border-zinc-800 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-zinc-300">Recipients Preview <span className="text-zinc-500 font-normal">· {previewArtists.length} artists</span></h3>
                  <select
                    value={sortOrder}
                    onChange={e => setSortOrder(e.target.value as typeof sortOrder)}
                    className="text-xs bg-zinc-800 border border-zinc-700 text-zinc-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-violet-500"
                  >
                    <option value="followers-desc">Followers: High → Low</option>
                    <option value="followers-asc">Followers: Low → High</option>
                    <option value="alpha-asc">A → Z</option>
                    <option value="alpha-desc">Z → A</option>
                    <option value="random">Random</option>
                  </select>
                </div>
                <div className="divide-y divide-zinc-800 max-h-[32rem] overflow-y-auto">
                  {sortedArtists.map(a => (
                    <div key={a.name} className="px-4 md:px-6 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4">
                      {/* Left: avatar + name */}
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="shrink-0 w-10 h-10 rounded-full overflow-hidden bg-zinc-700">
                          {a.avatarUrl ? (
                            <img
                              src={a.avatarUrl}
                              alt={a.name}
                              width={40}
                              height={40}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-zinc-500 text-xs font-bold">
                              {a.name.charAt(0)}
                            </div>
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <p className="text-sm font-medium text-white">{a.name}</p>
                            {a.instagramHandle && (
                              <a
                                href={`https://instagram.com/${a.instagramHandle.replace('@', '')}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-pink-400 hover:text-pink-300 transition"
                              >
                                {a.instagramHandle}
                              </a>
                            )}
                            {a.spotifyFollowers > 0 && (
                              <span className="inline-flex items-center gap-1 text-xs bg-zinc-800 text-green-400 px-1.5 py-0.5 rounded font-medium">
                                <svg viewBox="0 0 24 24" className="w-3 h-3 fill-green-400 shrink-0" xmlns="http://www.w3.org/2000/svg">
                                  <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
                                </svg>
                                {a.spotifyFollowers >= 1_000_000
                                  ? `${(a.spotifyFollowers / 1_000_000).toFixed(1)}M`
                                  : `${Math.round(a.spotifyFollowers / 1_000)}K`}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-zinc-500 mt-0.5">{a.managementCompany || 'Independent'}</p>
                        </div>
                      </div>
                      {/* Right: manager emails — below on mobile, right on desktop */}
                      <div className="pl-[52px] sm:pl-0 sm:text-right sm:shrink-0 space-y-0.5">
                        {a.managerEmails.map((email, i) => (
                          <p key={email} className="text-xs text-violet-400 break-all sm:break-normal">
                            {a.managerNames[i] ? `${a.managerNames[i]} — ` : ''}{email}
                          </p>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {previewDone && previewArtists.length === 0 && (
              <p className="text-sm text-zinc-500">No artists with manager emails found for the selected genres.</p>
            )}

            {/* Send */}
            {sendResult && (
              <div className="rounded-lg bg-green-900/30 border border-green-700 px-5 py-4">
                <p className="text-green-400 font-semibold">
                  Sent {sendResult.sent} of {sendResult.total} emails successfully.
                  {sendResult.failed > 0 && ` ${sendResult.failed} failed.`}
                </p>
              </div>
            )}
            {sendError && (
              <div className="rounded-lg bg-red-900/30 border border-red-700 px-5 py-4">
                <p className="text-red-400 text-sm">{sendError}</p>
              </div>
            )}

            <button
              onClick={handleSend}
              disabled={!canSend || sending}
              className="rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 px-6 py-3 font-semibold text-white transition focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 focus:ring-offset-zinc-950 text-sm"
            >
              {sending
                ? 'Sending...'
                : canSend
                ? `Send to ${totalEmails} recipient${totalEmails !== 1 ? 's' : ''}`
                : 'Preview recipients first'}
            </button>
          </div>
        )}

        {activeTab === 'template' && (
          <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-6 space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-1">Email Template</h2>
              <p className="text-sm text-zinc-500">
                Available variables:{' '}
                {['{{managerName}}', '{{artistName}}', '{{trackTitle}}', '{{driveLink}}', '{{senderName}}', '{{managementCompany}}'].map(v => (
                  <code key={v} className="text-xs bg-zinc-800 text-violet-400 px-1.5 py-0.5 rounded mr-1">{v}</code>
                ))}
              </p>
            </div>
            <textarea
              value={emailTemplate}
              onChange={e => setEmailTemplate(e.target.value)}
              rows={20}
              className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-3 text-sm text-white placeholder-zinc-500 font-mono focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition resize-y"
            />
            <button
              onClick={() => setEmailTemplate(DEFAULT_TEMPLATE)}
              className="text-xs text-zinc-500 hover:text-zinc-300 transition"
            >
              Reset to default
            </button>
          </section>
        )}
      </main>
    </div>
  );
}
