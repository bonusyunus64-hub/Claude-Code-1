import type { CustomContact } from '../../types';
import { CopyableName } from '../../components/CopyableName';
import { PitchedBadge } from '../../components/PitchedBadge';

export interface CustomContactsPreviewListProps {
  customContacts: CustomContact[];
  pitchedEmailMap: Map<string, string[]>;
}

export function CustomContactsPreviewList({ customContacts, pitchedEmailMap }: CustomContactsPreviewListProps) {
  return (
    <section className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
      <div className="px-4 md:px-6 py-3 border-b border-zinc-800">
        <h3 className="text-sm font-semibold text-zinc-300">Custom Contacts <span className="text-zinc-500 font-normal">· {customContacts.length}</span></h3>
      </div>
      <div className="divide-y divide-zinc-800">
        {customContacts.map(c => {
          const pitchedTracks = pitchedEmailMap.get(c.managerEmail.toLowerCase()) ?? [];
          return (
            <div key={c.id} className="px-4 md:px-6 py-3 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <CopyableName name={c.artistName} className="text-sm font-medium text-white" />
                  <span className="text-xs bg-zinc-700 text-zinc-300 px-1.5 py-0.5 rounded">Custom</span>
                  {pitchedTracks.length > 0 && <PitchedBadge tracks={pitchedTracks} />}
                </div>
                {c.managerName && <p className="text-xs text-zinc-500 mt-0.5">{c.managerName}</p>}
              </div>
              <p className="text-xs text-violet-400 text-right shrink-0">{c.managerEmail}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
