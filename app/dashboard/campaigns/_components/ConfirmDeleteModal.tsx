'use client';

export default function ConfirmDeleteModal({
  songTitle,
  onCancel,
  onConfirm,
}: {
  songTitle: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl w-full max-w-sm">
        <div className="px-5 py-4 border-b border-zinc-800">
          <h2 className="text-sm font-semibold text-white">Delete campaign?</h2>
        </div>
        <div className="p-5 space-y-1">
          <p className="text-sm text-zinc-300">
            This will permanently delete the campaign for <span className="font-medium text-white">{songTitle}</span>.
          </p>
          <p className="text-xs text-zinc-500">This can&apos;t be undone.</p>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-zinc-800">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-white text-xs font-medium transition"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-medium transition"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
