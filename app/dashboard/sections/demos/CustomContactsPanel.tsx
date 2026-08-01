import type { CustomContact } from '../../types';

export interface CustomContactsPanelProps {
  customContacts: CustomContact[];
  removeCustomContact: (id: string) => void;
  showAddCustomContact: boolean;
  setShowAddCustomContact: (show: boolean) => void;
  newCustomContact: { artistName: string; managerName: string; managerEmail: string };
  setNewCustomContact: React.Dispatch<React.SetStateAction<{ artistName: string; managerName: string; managerEmail: string }>>;
  addCustomContact: () => void;
  handleCustomContactsCsv: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export function CustomContactsPanel(props: CustomContactsPanelProps) {
  const {
    customContacts, removeCustomContact, showAddCustomContact, setShowAddCustomContact,
    newCustomContact, setNewCustomContact, addCustomContact, handleCustomContactsCsv,
  } = props;

  return (
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
  );
}
