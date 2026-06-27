'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';

const DEFAULT_TEMPLATE = `Hi {{managerName}},

My name is {{senderName}}, and I'm reaching out to submit a track for your consideration for {{artistName}}.

I've attached the track "{{trackTitle}}" — you can listen here:
{{driveLink}}

I believe this would be a strong fit for {{artistName}}'s sound and audience. I'd love to discuss any potential collaboration or placement.

Please let me know if you need anything further.`;

const DEFAULT_SIGN_OFF = `Best regards,
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

interface EmailAccount {
  id: string;
  name: string;
  email: string;
  smtpHost: string;
  smtpPort: string;
  smtpUser: string;
  smtpPass: string;
}

function fmtFollowers(n: number): string {
  if (!n) return '';
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1_000)}K`;
}

function FilterRow({
  label, badge, isOpen, onToggle, children,
}: {
  label: string; badge?: string; isOpen: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div className="border-t border-zinc-800 first:border-t-0">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between py-3 text-left group"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-medium text-zinc-400 group-hover:text-zinc-200 transition">{label}</span>
          {badge && !isOpen && (
            <span className="text-xs text-violet-400 font-medium">{badge}</span>
          )}
        </div>
        <svg viewBox="0 0 24 24" className={`w-3.5 h-3.5 shrink-0 fill-none stroke-zinc-500 stroke-2 transition-transform ${isOpen ? 'rotate-180' : ''}`} strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
      {isOpen && <div className="pb-4 flex flex-wrap gap-1.5">{children}</div>}
    </div>
  );
}

function CopyChip({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }
  return (
    <button
      onClick={copy}
      className={`text-xs px-2 py-1 rounded font-mono transition select-none ${
        copied
          ? 'bg-green-700/40 text-green-400 border border-green-600'
          : 'bg-zinc-800 text-violet-400 border border-zinc-700 hover:border-violet-500 hover:bg-zinc-700'
      }`}
    >
      {copied ? '✓ Copied' : value}
    </button>
  );
}

const BLANK_ACCOUNT: Omit<EmailAccount, 'id'> = {
  name: '', email: '', smtpHost: 'smtp.zoho.com', smtpPort: '465', smtpUser: '', smtpPass: '',
};

export default function Dashboard() {
  const [allGenres, setAllGenres] = useState<string[]>([]);
  const [genreSearch, setGenreSearch] = useState('');
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [showGenreDropdown, setShowGenreDropdown] = useState(false);

  const [minAudience, setMinAudience] = useState(0);
  const [maxAudience, setMaxAudience] = useState(0);
  const [gender, setGender] = useState('');
  const [artistType, setArtistType] = useState('');
  const [minInstagram, setMinInstagram] = useState(0);
  const [maxInstagram, setMaxInstagram] = useState(0);
  const [expandedFilters, setExpandedFilters] = useState<Set<string>>(new Set(['min-spotify']));
  function toggleFilter(key: string) {
    setExpandedFilters(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  }

  const [trackTitle, setTrackTitle] = useState('');
  const [driveLink, setDriveLink] = useState('');
  const [senderName, setSenderName] = useState('');
  const [emailTemplate, setEmailTemplate] = useState(DEFAULT_TEMPLATE);
  const [signOff, setSignOff] = useState(DEFAULT_SIGN_OFF);

  // Email accounts (persisted in localStorage)
  const [emailAccounts, setEmailAccounts] = useState<EmailAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [newAccount, setNewAccount] = useState({ ...BLANK_ACCOUNT });

  const [previewArtists, setPreviewArtists] = useState<Artist[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewDone, setPreviewDone] = useState(false);
  const [sortOrder, setSortOrder] = useState<'followers-desc' | 'followers-asc' | 'alpha-asc' | 'alpha-desc' | 'random'>('followers-desc');

  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ sent: number; failed: number; total: number } | null>(null);
  const [sendError, setSendError] = useState('');

  const [activeTab, setActiveTab] = useState<'compose' | 'template'>('compose');

  const [signOffImage, setSignOffImage] = useState<string | null>(null);
  const [lastSavedTemplate, setLastSavedTemplate] = useState(DEFAULT_TEMPLATE);
  const [lastSavedSignOff, setLastSavedSignOff] = useState(DEFAULT_SIGN_OFF);
  const [lastSavedSignOffImage, setLastSavedSignOffImage] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/genres')
      .then(r => r.json())
      .then(d => setAllGenres(d.genres || []));
    // Load persisted data
    try {
      const accounts = JSON.parse(localStorage.getItem('tp_email_accounts') || '[]') as EmailAccount[];
      setEmailAccounts(accounts);
      const savedId = localStorage.getItem('tp_selected_account');
      if (savedId && accounts.find(a => a.id === savedId)) setSelectedAccountId(savedId);
      else if (accounts.length > 0) setSelectedAccountId(accounts[0].id);
      const savedSignOff = localStorage.getItem('tp_sign_off');
      if (savedSignOff !== null) { setSignOff(savedSignOff); setLastSavedSignOff(savedSignOff); }
      const savedTemplate = localStorage.getItem('tp_email_template');
      if (savedTemplate !== null) { setEmailTemplate(savedTemplate); setLastSavedTemplate(savedTemplate); }
      const savedImage = localStorage.getItem('tp_sign_off_image');
      if (savedImage) { setSignOffImage(savedImage); setLastSavedSignOffImage(savedImage); }
    } catch {}
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

  const ARTIST_TYPE_OPTIONS = [
    { label: 'Any', value: '' },
    { label: 'Solo', value: 'Person' },
    { label: 'Group', value: 'Group' },
  ];

  const resetFilters = () => { setPreviewDone(false); setSendResult(null); };

  function persistAccounts(accounts: EmailAccount[]) {
    setEmailAccounts(accounts);
    localStorage.setItem('tp_email_accounts', JSON.stringify(accounts));
  }

  function addAccount() {
    if (!newAccount.name || !newAccount.smtpUser || !newAccount.smtpPass) return;
    const account: EmailAccount = { id: Date.now().toString(), ...newAccount };
    const updated = [...emailAccounts, account];
    persistAccounts(updated);
    setSelectedAccountId(account.id);
    localStorage.setItem('tp_selected_account', account.id);
    setShowAddAccount(false);
    setNewAccount({ ...BLANK_ACCOUNT });
  }

  function removeAccount(id: string) {
    const updated = emailAccounts.filter(a => a.id !== id);
    persistAccounts(updated);
    if (selectedAccountId === id) {
      const next = updated[0]?.id ?? '';
      setSelectedAccountId(next);
      localStorage.setItem('tp_selected_account', next);
    }
  }

  function selectAccount(id: string) {
    setSelectedAccountId(id);
    localStorage.setItem('tp_selected_account', id);
  }

  const isDirty = emailTemplate !== lastSavedTemplate || signOff !== lastSavedSignOff || signOffImage !== lastSavedSignOffImage;

  function saveAll() {
    localStorage.setItem('tp_email_template', emailTemplate);
    localStorage.setItem('tp_sign_off', signOff);
    if (signOffImage) {
      localStorage.setItem('tp_sign_off_image', signOffImage);
    } else {
      localStorage.removeItem('tp_sign_off_image');
    }
    setLastSavedTemplate(emailTemplate);
    setLastSavedSignOff(signOff);
    setLastSavedSignOffImage(signOffImage);
  }

  function discardChanges() {
    setEmailTemplate(lastSavedTemplate);
    setSignOff(lastSavedSignOff);
    setSignOffImage(lastSavedSignOffImage);
  }

  function handleSignOffImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setSignOffImage(reader.result as string);
    reader.readAsDataURL(file);
  }

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
        body: JSON.stringify({ genres: selectedGenres, minAudience, maxAudience, gender, artistType, minInstagram, maxInstagram }),
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
        body: JSON.stringify({
          trackTitle, driveLink, genres: selectedGenres, emailTemplate,
          senderName, signOff, signOffImage, minAudience, maxAudience, gender, artistType, minInstagram, maxInstagram,
          fromAccount: emailAccounts.find(a => a.id === selectedAccountId)
            ? { ...emailAccounts.find(a => a.id === selectedAccountId)!, smtpPort: Number(emailAccounts.find(a => a.id === selectedAccountId)!.smtpPort) }
            : undefined,
        }),
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

            {/* Filters */}
            <section className="bg-zinc-900 rounded-xl border border-zinc-800 px-4 md:px-6 pt-4 md:pt-6 pb-1">
              <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-1">Filters</h2>
              <div>
                <FilterRow
                  label="Min Spotify followers"
                  badge={fmtFollowers(minAudience)}
                  isOpen={expandedFilters.has('min-spotify')}
                  onToggle={() => toggleFilter('min-spotify')}
                >
                  {FOLLOWER_STEPS.map(opt => (
                    <button key={`min-sp-${opt.value}`} onClick={() => { setMinAudience(opt.value); resetFilters(); }}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium border transition ${minAudience === opt.value ? 'bg-violet-600 border-violet-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white'}`}>
                      {opt.label}
                    </button>
                  ))}
                </FilterRow>

                <FilterRow
                  label="Max Spotify followers"
                  badge={fmtFollowers(maxAudience)}
                  isOpen={expandedFilters.has('max-spotify')}
                  onToggle={() => toggleFilter('max-spotify')}
                >
                  {FOLLOWER_STEPS.map(opt => (
                    <button key={`max-sp-${opt.value}`} onClick={() => { setMaxAudience(opt.value); resetFilters(); }}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium border transition ${maxAudience === opt.value ? 'bg-violet-600 border-violet-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white'}`}>
                      {opt.label}
                    </button>
                  ))}
                </FilterRow>

                <FilterRow
                  label="Min Instagram followers"
                  badge={fmtFollowers(minInstagram)}
                  isOpen={expandedFilters.has('min-ig')}
                  onToggle={() => toggleFilter('min-ig')}
                >
                  {FOLLOWER_STEPS.map(opt => (
                    <button key={`min-ig-${opt.value}`} onClick={() => { setMinInstagram(opt.value); resetFilters(); }}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium border transition ${minInstagram === opt.value ? 'bg-violet-600 border-violet-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white'}`}>
                      {opt.label}
                    </button>
                  ))}
                </FilterRow>

                <FilterRow
                  label="Max Instagram followers"
                  badge={fmtFollowers(maxInstagram)}
                  isOpen={expandedFilters.has('max-ig')}
                  onToggle={() => toggleFilter('max-ig')}
                >
                  {FOLLOWER_STEPS.map(opt => (
                    <button key={`max-ig-${opt.value}`} onClick={() => { setMaxInstagram(opt.value); resetFilters(); }}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium border transition ${maxInstagram === opt.value ? 'bg-violet-600 border-violet-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white'}`}>
                      {opt.label}
                    </button>
                  ))}
                </FilterRow>

                <FilterRow
                  label="Artist gender"
                  badge={GENDER_OPTIONS.find(o => o.value === gender && gender)?.label}
                  isOpen={expandedFilters.has('gender')}
                  onToggle={() => toggleFilter('gender')}
                >
                  {GENDER_OPTIONS.map(opt => (
                    <button key={`gender-${opt.value}`} onClick={() => { setGender(opt.value); resetFilters(); }}
                      className={`px-3 py-1 rounded-full text-xs font-medium border transition ${gender === opt.value ? 'bg-violet-600 border-violet-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white'}`}>
                      {opt.label}
                    </button>
                  ))}
                </FilterRow>

                <FilterRow
                  label="Artist type"
                  badge={ARTIST_TYPE_OPTIONS.find(o => o.value === artistType && artistType)?.label}
                  isOpen={expandedFilters.has('type')}
                  onToggle={() => toggleFilter('type')}
                >
                  {ARTIST_TYPE_OPTIONS.map(opt => (
                    <button key={`type-${opt.value}`} onClick={() => { setArtistType(opt.value); resetFilters(); }}
                      className={`px-3 py-1 rounded-full text-xs font-medium border transition ${artistType === opt.value ? 'bg-violet-600 border-violet-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white'}`}>
                      {opt.label}
                    </button>
                  ))}
                </FilterRow>
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

            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
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
              {(() => {
                const acc = emailAccounts.find(a => a.id === selectedAccountId);
                return acc ? (
                  <span className="text-xs text-zinc-500">
                    Sending from <span className="text-zinc-300">{acc.name}</span> ({acc.email || acc.smtpUser})
                  </span>
                ) : (
                  <span className="text-xs text-amber-500">
                    No email account selected — <button onClick={() => setActiveTab('template')} className="underline hover:text-amber-400">add one</button>
                  </span>
                );
              })()}
            </div>
          </div>
        )}

        {activeTab === 'template' && (
          <div className="space-y-6">

            {/* From Account */}
            <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 md:p-6 space-y-4">
              <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">From Account</h2>

              {emailAccounts.length > 0 && (
                <div className="space-y-2">
                  {emailAccounts.map(acc => (
                    <div
                      key={acc.id}
                      onClick={() => selectAccount(acc.id)}
                      className={`flex items-center justify-between gap-3 px-4 py-3 rounded-lg border cursor-pointer transition ${
                        selectedAccountId === acc.id
                          ? 'border-violet-500 bg-violet-600/10'
                          : 'border-zinc-700 bg-zinc-800 hover:border-zinc-600'
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-white">{acc.name}</p>
                        <p className="text-xs text-zinc-400 truncate">{acc.email || acc.smtpUser} · {acc.smtpHost}:{acc.smtpPort}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {selectedAccountId === acc.id && (
                          <span className="text-xs text-violet-400 font-medium">Active</span>
                        )}
                        <button
                          onClick={e => { e.stopPropagation(); removeAccount(acc.id); }}
                          className="text-zinc-600 hover:text-red-400 transition text-lg leading-none"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {emailAccounts.length === 0 && !showAddAccount && (
                <p className="text-sm text-zinc-500">No accounts added yet. Add one below to send emails.</p>
              )}

              {!showAddAccount ? (
                <button
                  onClick={() => setShowAddAccount(true)}
                  className="text-sm text-violet-400 hover:text-violet-300 transition"
                >
                  + Add email account
                </button>
              ) : (
                <div className="border border-zinc-700 rounded-xl p-4 space-y-3">
                  <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">New Account</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-zinc-400 mb-1">Display Name</label>
                      <input value={newAccount.name} onChange={e => setNewAccount(p => ({ ...p, name: e.target.value }))}
                        placeholder="e.g. Work Email"
                        className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent" />
                    </div>
                    <div>
                      <label className="block text-xs text-zinc-400 mb-1">From Address</label>
                      <input value={newAccount.email} onChange={e => setNewAccount(p => ({ ...p, email: e.target.value }))}
                        placeholder="you@example.com"
                        className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent" />
                    </div>
                    <div>
                      <label className="block text-xs text-zinc-400 mb-1">SMTP Host</label>
                      <input value={newAccount.smtpHost} onChange={e => setNewAccount(p => ({ ...p, smtpHost: e.target.value }))}
                        placeholder="smtp.zoho.com"
                        className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent" />
                    </div>
                    <div>
                      <label className="block text-xs text-zinc-400 mb-1">Port</label>
                      <input value={newAccount.smtpPort} onChange={e => setNewAccount(p => ({ ...p, smtpPort: e.target.value }))}
                        placeholder="465"
                        className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent" />
                    </div>
                    <div>
                      <label className="block text-xs text-zinc-400 mb-1">SMTP Username</label>
                      <input value={newAccount.smtpUser} onChange={e => setNewAccount(p => ({ ...p, smtpUser: e.target.value }))}
                        placeholder="your@email.com"
                        className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent" />
                    </div>
                    <div>
                      <label className="block text-xs text-zinc-400 mb-1">Password / App Password</label>
                      <input type="password" value={newAccount.smtpPass} onChange={e => setNewAccount(p => ({ ...p, smtpPass: e.target.value }))}
                        placeholder="••••••••"
                        className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent" />
                    </div>
                  </div>
                  <p className="text-xs text-zinc-500">For Gmail use an App Password. For Zoho use your account password or an app-specific password.</p>
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={addAccount}
                      disabled={!newAccount.name || !newAccount.smtpUser || !newAccount.smtpPass}
                      className="rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 px-4 py-2 text-sm font-semibold text-white transition"
                    >
                      Save Account
                    </button>
                    <button
                      onClick={() => { setShowAddAccount(false); setNewAccount({ ...BLANK_ACCOUNT }); }}
                      className="rounded-lg bg-zinc-800 hover:bg-zinc-700 px-4 py-2 text-sm text-zinc-300 transition"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </section>

            {/* Sign-off */}
            <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 md:p-6 space-y-3">
              <div>
                <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-1">Sign-off</h2>
                <p className="text-xs text-zinc-500">Appended automatically after every email body. Supports the same variables.</p>
              </div>
              <textarea
                value={signOff}
                onChange={e => setSignOff(e.target.value)}
                rows={3}
                className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-3 text-sm text-white font-mono focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition resize-y"
              />
              {signOffImage ? (
                <div className="flex items-start gap-3 pt-1">
                  <img
                    src={signOffImage}
                    alt="Signature"
                    className="max-h-20 max-w-xs rounded border border-zinc-700 object-contain bg-zinc-800"
                  />
                  <button
                    onClick={() => setSignOffImage(null)}
                    className="text-xs text-red-400 hover:text-red-300 transition mt-1"
                  >
                    Remove image
                  </button>
                </div>
              ) : (
                <label className="inline-flex items-center gap-2 cursor-pointer px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 hover:border-zinc-500 text-xs text-zinc-300 transition w-fit">
                  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                    <polyline points="17 8 12 3 7 8"/>
                    <line x1="12" y1="3" x2="12" y2="15"/>
                  </svg>
                  Upload signature image
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleSignOffImageUpload}
                  />
                </label>
              )}
              <button onClick={() => setSignOff(DEFAULT_SIGN_OFF)} className="text-xs text-zinc-500 hover:text-zinc-300 transition">
                Reset to default
              </button>
            </section>

            {/* Email Template */}
            <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 md:p-6 space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-1">Email Body</h2>
                <p className="text-sm text-zinc-500 mb-2">Click a variable to copy it:</p>
                <div className="flex flex-wrap gap-1.5">
                  {['{{managerName}}', '{{artistName}}', '{{trackTitle}}', '{{driveLink}}', '{{senderName}}', '{{managementCompany}}'].map(v => (
                    <CopyChip key={v} value={v} />
                  ))}
                </div>
              </div>
              <textarea
                value={emailTemplate}
                onChange={e => setEmailTemplate(e.target.value)}
                rows={16}
                className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-3 text-sm text-white placeholder-zinc-500 font-mono focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition resize-y"
              />
              <button onClick={() => setEmailTemplate(DEFAULT_TEMPLATE)} className="text-xs text-zinc-500 hover:text-zinc-300 transition">
                Reset to default
              </button>
            </section>

          </div>
        )}
      </main>

      {isDirty && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl shadow-black/50 px-4 py-3">
          <span className="text-xs text-zinc-400 mr-1">Unsaved changes</span>
          <button
            onClick={discardChanges}
            className="text-xs text-zinc-400 hover:text-zinc-200 px-2 py-1.5 rounded transition hover:bg-zinc-800"
          >
            Discard
          </button>
          <button
            onClick={saveAll}
            className="text-xs bg-violet-600 hover:bg-violet-500 text-white font-semibold px-3 py-1.5 rounded-lg transition"
          >
            Save
          </button>
        </div>
      )}
    </div>
  );
}
