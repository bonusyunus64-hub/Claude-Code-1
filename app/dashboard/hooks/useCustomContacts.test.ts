import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const syncStorage = vi.hoisted(() => ({ setItem: vi.fn(), removeItem: vi.fn() }));
vi.mock('@/lib/remoteSync', () => ({ syncStorage }));

import { useCustomContacts } from './useCustomContacts';

function makeChangeEvent(file: File | undefined): React.ChangeEvent<HTMLInputElement> {
  return { target: { files: file ? [file] : [], value: '' } } as unknown as React.ChangeEvent<HTMLInputElement>;
}

describe('useCustomContacts', () => {
  afterEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  describe('addCustomContact', () => {
    it('adds a contact with a generated id, persists the list, closes the form, and resets the draft', () => {
      const { result } = renderHook(() => useCustomContacts());
      act(() => result.current.setShowAddCustomContact(true));
      act(() => result.current.setNewCustomContact({ artistName: 'Nova', managerName: 'Sam', managerEmail: 'sam@example.com' }));
      act(() => result.current.addCustomContact());

      expect(result.current.customContacts).toEqual([
        expect.objectContaining({ artistName: 'Nova', managerName: 'Sam', managerEmail: 'sam@example.com' }),
      ]);
      expect(result.current.customContacts[0].id).toBeTruthy();
      expect(result.current.showAddCustomContact).toBe(false);
      expect(result.current.newCustomContact).toEqual({ artistName: '', managerName: '', managerEmail: '' });
      expect(syncStorage.setItem).toHaveBeenCalledWith('tp_custom_contacts', JSON.stringify(result.current.customContacts));
    });

    it('does not add a contact missing artistName or managerEmail, and never touches storage', () => {
      const { result } = renderHook(() => useCustomContacts());
      act(() => result.current.setNewCustomContact({ artistName: '', managerName: '', managerEmail: 'sam@example.com' }));
      act(() => result.current.addCustomContact());
      expect(result.current.customContacts).toEqual([]);

      act(() => result.current.setNewCustomContact({ artistName: 'Nova', managerName: '', managerEmail: '' }));
      act(() => result.current.addCustomContact());
      expect(result.current.customContacts).toEqual([]);
      expect(syncStorage.setItem).not.toHaveBeenCalled();
    });
  });

  describe('removeCustomContact', () => {
    it('removes the matching contact and persists the updated (now empty) list', () => {
      const { result } = renderHook(() => useCustomContacts());
      act(() => result.current.setNewCustomContact({ artistName: 'Nova', managerName: 'Sam', managerEmail: 'sam@example.com' }));
      act(() => result.current.addCustomContact());
      const id = result.current.customContacts[0].id;

      act(() => result.current.removeCustomContact(id));
      expect(result.current.customContacts).toEqual([]);
      expect(syncStorage.setItem).toHaveBeenLastCalledWith('tp_custom_contacts', '[]');
    });

    it('leaves the list untouched when the id does not match anything', () => {
      const { result } = renderHook(() => useCustomContacts());
      act(() => result.current.setNewCustomContact({ artistName: 'Nova', managerName: 'Sam', managerEmail: 'sam@example.com' }));
      act(() => result.current.addCustomContact());

      act(() => result.current.removeCustomContact('no-such-id'));
      expect(result.current.customContacts).toHaveLength(1);
    });
  });

  describe('handleCustomContactsCsv', () => {
    it('imports new rows from CSV, skipping an address already present, and resets the file input', async () => {
      const { result } = renderHook(() => useCustomContacts());
      act(() => result.current.setNewCustomContact({ artistName: 'Existing Act', managerName: '', managerEmail: 'existing@example.com' }));
      act(() => result.current.addCustomContact());

      const file = new File(['Nova,Sam,sam@example.com\nExisting Act,,existing@example.com'], 'contacts.csv', { type: 'text/csv' });
      const event = makeChangeEvent(file);
      act(() => result.current.handleCustomContactsCsv(event));

      await waitFor(() => expect(result.current.customContacts).toHaveLength(2));
      expect(result.current.customContacts.map(c => c.managerEmail).sort()).toEqual(['existing@example.com', 'sam@example.com']);
      expect(event.target.value).toBe('');
      // Two persists total: one from addCustomContact above, one from the import.
      expect(syncStorage.setItem).toHaveBeenCalledTimes(2);
    });

    it('does nothing when no file was chosen', () => {
      const { result } = renderHook(() => useCustomContacts());
      act(() => result.current.handleCustomContactsCsv(makeChangeEvent(undefined)));
      expect(result.current.customContacts).toEqual([]);
      expect(syncStorage.setItem).not.toHaveBeenCalled();
    });

    it('does not touch state or storage when the CSV has no valid rows', async () => {
      const { result } = renderHook(() => useCustomContacts());
      const file = new File(['not,a,valid,row,at,all\njust garbage'], 'contacts.csv', { type: 'text/csv' });
      act(() => result.current.handleCustomContactsCsv(makeChangeEvent(file)));

      // Give the FileReader a turn to settle before asserting nothing changed.
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      expect(result.current.customContacts).toEqual([]);
      expect(syncStorage.setItem).not.toHaveBeenCalled();
    });
  });

  describe('hydrateFromStorage', () => {
    it('loads the saved list from localStorage', () => {
      const saved = [{ id: '1', artistName: 'Nova', managerName: 'Sam', managerEmail: 'sam@example.com' }];
      localStorage.setItem('tp_custom_contacts', JSON.stringify(saved));

      const { result } = renderHook(() => useCustomContacts());
      act(() => result.current.hydrateFromStorage());

      expect(result.current.customContacts).toEqual(saved);
    });

    it('leaves customContacts empty when nothing was saved', () => {
      const { result } = renderHook(() => useCustomContacts());
      act(() => result.current.hydrateFromStorage());
      expect(result.current.customContacts).toEqual([]);
    });
  });
});
