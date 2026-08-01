export interface PreviewControlsProps {
  handlePreview: () => void;
  previewLoading: boolean;
  previewDone: boolean;
  hasSelectedGenres: boolean;
  customContactsCount: number;
  includedArtistsCount: number;
  previewArtistsCount: number;
  totalEmails: number;
  excludedByBlacklist: number;
  setPreviewModalType: (type: 'demos' | 'radio' | null) => void;
  setPreviewModalIdx: (idx: number) => void;
}

export function PreviewControls(props: PreviewControlsProps) {
  const {
    handlePreview, previewLoading, previewDone, hasSelectedGenres, customContactsCount,
    includedArtistsCount, previewArtistsCount, totalEmails, excludedByBlacklist,
    setPreviewModalType, setPreviewModalIdx,
  } = props;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button onClick={() => handlePreview()} disabled={!hasSelectedGenres || previewLoading}
        className="rounded-lg bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 px-5 py-2.5 text-sm font-semibold text-white transition">
        {previewLoading ? 'Loading...' : 'Preview Recipients'}
      </button>
      {(previewDone || customContactsCount > 0) && (
        <button
          onClick={() => { setPreviewModalType('demos'); setPreviewModalIdx(0); }}
          className="rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 px-4 py-2.5 text-sm font-medium text-zinc-300 transition">
          Preview Email
        </button>
      )}
      {previewDone && (
        <span className="text-sm text-zinc-400">
          {includedArtistsCount}{includedArtistsCount !== previewArtistsCount ? ` of ${previewArtistsCount}` : ''} artists selected · {totalEmails} emails
          {excludedByBlacklist > 0 && (
            <span className="text-zinc-600"> ({excludedByBlacklist} on Do Not Contact, excluded)</span>
          )}
        </span>
      )}
      {!previewDone && customContactsCount > 0 && (
        <span className="text-sm text-zinc-400">{customContactsCount} custom contact{customContactsCount !== 1 ? 's' : ''}</span>
      )}
    </div>
  );
}
