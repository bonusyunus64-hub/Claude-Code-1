interface SavedItem {
  id: string;
  name: string;
}

export interface SavedItemListProps<T extends SavedItem> {
  items: T[];
  onLoad: (item: T) => void;
  onDelete: (id: string) => void;
  newName: string;
  setNewName: (value: string) => void;
  onSave: () => void;
  placeholder: string;
}

/** Reused wherever a small named list of saved things (a template, a filter preset)
 *  is shown as pill chips above a "name it and save the current state" input — the
 *  main template library, the follow-up template library, and the saved filter
 *  presets all share this exact shape, just with a different item type. */
export function SavedItemList<T extends SavedItem>({ items, onLoad, onDelete, newName, setNewName, onSave, placeholder }: SavedItemListProps<T>) {
  return (
    <>
      {items.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {items.map(item => (
            <div key={item.id} className="inline-flex items-center gap-1.5 bg-zinc-800 border border-zinc-700 rounded-full pl-3 pr-1.5 py-1">
              <button onClick={() => onLoad(item)} className="text-xs text-zinc-200 hover:text-violet-400 transition">{item.name}</button>
              <button onClick={() => onDelete(item.id)} className="text-zinc-600 hover:text-red-400 transition text-sm leading-none px-1">×</button>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input value={newName} onChange={e => setNewName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') onSave(); }}
          placeholder={placeholder}
          className="flex-1 rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent" />
        <button onClick={onSave} disabled={!newName.trim()}
          className="rounded-lg bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 px-4 py-2 text-sm font-semibold text-white transition shrink-0">
          Save Current
        </button>
      </div>
    </>
  );
}
