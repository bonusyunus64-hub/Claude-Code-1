export interface TrackDetailsPanelProps {
  senderName: string;
  setSenderName: (value: string) => void;
  trackTitle: string;
  setTrackTitle: (value: string) => void;
  demosPitchCount: number;
  driveLink: string;
  setDriveLink: (value: string) => void;
}

export function TrackDetailsPanel({ senderName, setSenderName, trackTitle, setTrackTitle, demosPitchCount, driveLink, setDriveLink }: TrackDetailsPanelProps) {
  return (
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
  );
}
