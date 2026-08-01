import type { DemosFilterPreset } from '../../types';
import { SavedItemList } from './SavedItemList';

export interface SavedFiltersPanelProps {
  demosPresets: DemosFilterPreset[];
  newDemosPresetName: string;
  setNewDemosPresetName: (value: string) => void;
  saveDemosPreset: () => void;
  loadDemosPreset: (preset: DemosFilterPreset) => void;
  deleteDemosPreset: (id: string) => void;
}

export function SavedFiltersPanel({ demosPresets, newDemosPresetName, setNewDemosPresetName, saveDemosPreset, loadDemosPreset, deleteDemosPreset }: SavedFiltersPanelProps) {
  return (
    <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 md:p-6 space-y-3">
      <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Saved Filters</h2>
      <SavedItemList
        items={demosPresets}
        onLoad={loadDemosPreset}
        onDelete={deleteDemosPreset}
        newName={newDemosPresetName}
        setNewName={setNewDemosPresetName}
        onSave={saveDemosPreset}
        placeholder="Name this filter set (e.g. Indie Pop Campaigns)"
      />
    </section>
  );
}
