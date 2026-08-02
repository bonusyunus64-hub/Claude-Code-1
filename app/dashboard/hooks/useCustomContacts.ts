'use client';

import { useState } from 'react';
import { syncStorage } from '@/lib/remoteSync';
import { parseContactsCsv } from '../utils';
import type { CustomContact } from '../types';

/**
 * Hand-added and CSV-imported manager contacts. Its own hook (rather than folded
 * into useDemosFlow, the only place besides useCampaignHistory that reads the
 * list) because both useCampaignHistory (backfillRecipients' name lookup) and
 * useDemosFlow (exclusion/duplicate/cooldown checks, the send payload itself)
 * need `customContacts` as a read-only input — so this must be instantiated
 * before either of them in page.tsx, the same way useAccountSettings is
 * instantiated first for its own consumers.
 *
 * addOutsideArtistToContacts stays in page.tsx rather than moving here: it needs
 * an Artist from useDemosFlow's outside-artist search, and useDemosFlow in turn
 * needs `customContacts` from here — folding it into this hook would make the
 * two hooks require each other to exist first, the same circular-dependency
 * shape useAccountSettings' own doc comment describes for why it doesn't own
 * test email either.
 */
export function useCustomContacts() {
  const [customContacts, setCustomContacts] = useState<CustomContact[]>([]);
  const [newCustomContact, setNewCustomContact] = useState({ artistName: '', managerName: '', managerEmail: '' });
  const [showAddCustomContact, setShowAddCustomContact] = useState(false);

  function addCustomContact() {
    if (!newCustomContact.artistName || !newCustomContact.managerEmail) return;
    const contact: CustomContact = { id: Date.now().toString(), ...newCustomContact };
    const updated = [...customContacts, contact];
    setCustomContacts(updated);
    syncStorage.setItem('tp_custom_contacts', JSON.stringify(updated));
    setShowAddCustomContact(false);
    setNewCustomContact({ artistName: '', managerName: '', managerEmail: '' });
  }

  function removeCustomContact(id: string) {
    const updated = customContacts.filter(c => c.id !== id);
    setCustomContacts(updated);
    syncStorage.setItem('tp_custom_contacts', JSON.stringify(updated));
  }

  function handleCustomContactsCsv(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseContactsCsv(String(reader.result));
      if (!parsed.length) return;
      const existingEmails = new Set(customContacts.map(c => c.managerEmail.toLowerCase()));
      const fresh = parsed.filter(p => !existingEmails.has(p.managerEmail.toLowerCase()));
      const added = fresh.map(p => ({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, ...p }));
      const updated = [...customContacts, ...added];
      setCustomContacts(updated);
      syncStorage.setItem('tp_custom_contacts', JSON.stringify(updated));
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  /** For page.tsx's initial-load effect to hydrate from localStorage after hydrateFromRemote() resolves. */
  function hydrateFromStorage() {
    const savedCustomContacts = localStorage.getItem('tp_custom_contacts');
    if (savedCustomContacts) setCustomContacts(JSON.parse(savedCustomContacts));
  }

  return {
    customContacts, setCustomContacts,
    newCustomContact, setNewCustomContact,
    showAddCustomContact, setShowAddCustomContact,
    addCustomContact, removeCustomContact, handleCustomContactsCsv,
    hydrateFromStorage,
  };
}
