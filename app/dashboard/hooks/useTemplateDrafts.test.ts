import { describe, it, expect, vi, afterEach } from 'vitest';
import { useState } from 'react';
import { renderHook, act } from '@testing-library/react';

const syncStorage = vi.hoisted(() => ({ setItem: vi.fn(() => true), removeItem: vi.fn() }));
vi.mock('@/lib/remoteSync', () => ({ syncStorage }));

import { useTemplateDrafts } from './useTemplateDrafts';
import { DEFAULT_SIGN_OFF, DEFAULT_MULTI_ARTIST_TEMPLATE, DEFAULT_MULTI_ARTIST_SUBJECT } from '../constants';

/**
 * signOff/signOffImage are a controlled value + setter pair owned by the parent
 * in real usage (useAccountSettings, via page.tsx) — this harness owns them the
 * same way, so discardChanges/saveAll's writes to the threaded-in setters
 * actually round-trip into something a test can observe, the same pattern
 * useDemosFlow.test.ts uses for its own controlled template/subject props.
 */
function useHarness(initial: { signOff?: string; signOffImage?: string | null } = {}) {
  const [signOff, setSignOff] = useState(initial.signOff ?? DEFAULT_SIGN_OFF);
  const [signOffImage, setSignOffImage] = useState<string | null>(initial.signOffImage ?? null);
  const drafts = useTemplateDrafts({ signOff, setSignOff, signOffImage, setSignOffImage });
  return { ...drafts, signOff, setSignOff, signOffImage, setSignOffImage };
}

function renderDrafts(initial: { signOff?: string; signOffImage?: string | null } = {}) {
  return renderHook(() => useHarness(initial));
}

describe('useTemplateDrafts', () => {
  afterEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  describe('isDirty', () => {
    it('starts false and flips true when a draft diverges from its saved mirror', () => {
      const { result } = renderDrafts();
      expect(result.current.isDirty).toBe(false);

      act(() => result.current.setDemosTemplate('A new pitch'));
      expect(result.current.isDirty).toBe(true);
    });

    it('flips true via the threaded-in sign-off, not just the local drafts', () => {
      const { result } = renderDrafts();
      expect(result.current.isDirty).toBe(false);

      act(() => result.current.setSignOff('Cheers,\n{{senderName}}'));
      expect(result.current.isDirty).toBe(true);
    });

    it('flips true when only the radio draft changes', () => {
      const { result } = renderDrafts();
      act(() => result.current.setRadioSubject('New radio subject'));
      expect(result.current.isDirty).toBe(true);
    });
  });

  describe('saveAll', () => {
    it('writes every draft and the sign-off to syncStorage, and clears isDirty', () => {
      const { result } = renderDrafts();
      act(() => {
        result.current.setDemosTemplate('Demos template');
        result.current.setDemosSubject('Demos subject');
        result.current.setDemosSubjectB('Demos subject B');
        result.current.setDemosFollowUpTemplate('Follow-up template');
        result.current.setDemosFollowUpSubject('Follow-up subject');
        result.current.setRadioTemplate('Radio template');
        result.current.setRadioSubject('Radio subject');
        result.current.setSignOff('New sign-off');
      });
      expect(result.current.isDirty).toBe(true);

      act(() => result.current.saveAll());

      expect(syncStorage.setItem).toHaveBeenCalledWith('tp_email_template', 'Demos template');
      expect(syncStorage.setItem).toHaveBeenCalledWith('tp_email_subject', 'Demos subject');
      expect(syncStorage.setItem).toHaveBeenCalledWith('tp_email_subject_b', 'Demos subject B');
      expect(syncStorage.setItem).toHaveBeenCalledWith('tp_followup_template', 'Follow-up template');
      expect(syncStorage.setItem).toHaveBeenCalledWith('tp_followup_subject', 'Follow-up subject');
      expect(syncStorage.setItem).toHaveBeenCalledWith('tp_radio_template', 'Radio template');
      expect(syncStorage.setItem).toHaveBeenCalledWith('tp_radio_subject', 'Radio subject');
      expect(syncStorage.setItem).toHaveBeenCalledWith('tp_sign_off', 'New sign-off');
      expect(result.current.isDirty).toBe(false);
    });

    it('pushes tp_sign_off_image when an image is set, and removes it (rather than pushing null) when there is none', () => {
      const withImage = renderDrafts({ signOffImage: 'data:image/png;base64,ABC' });
      act(() => withImage.result.current.saveAll());
      expect(syncStorage.setItem).toHaveBeenCalledWith('tp_sign_off_image', 'data:image/png;base64,ABC');
      expect(syncStorage.removeItem).not.toHaveBeenCalled();

      const withoutImage = renderDrafts({ signOffImage: null });
      act(() => withoutImage.result.current.saveAll());
      expect(syncStorage.removeItem).toHaveBeenCalledWith('tp_sign_off_image');
    });

    it('sets saveLocalWarning when a syncStorage.setItem write fails locally, and clears it on a subsequent clean save', () => {
      const { result } = renderDrafts();
      syncStorage.setItem.mockReturnValueOnce(false); // simulates the tp_email_template write failing locally
      act(() => result.current.setDemosTemplate('Too big for localStorage, hypothetically'));
      act(() => result.current.saveAll());
      expect(result.current.saveLocalWarning).toMatch(/local storage is full/i);

      act(() => result.current.setDemosTemplate('A second, successful save'));
      act(() => result.current.saveAll());
      expect(result.current.saveLocalWarning).toBe('');
    });
  });

  describe('discardChanges', () => {
    it('restores every draft and the sign-off to their last-saved values, and clears the warning', () => {
      const { result } = renderDrafts();
      act(() => {
        result.current.setDemosTemplate('Saved template');
        result.current.setSignOff('Saved sign-off');
      });
      act(() => result.current.saveAll()); // establishes the baseline discardChanges should restore
      expect(result.current.isDirty).toBe(false);

      syncStorage.setItem.mockReturnValueOnce(false);
      act(() => {
        result.current.setDemosTemplate('Unsaved edit');
        result.current.setSignOff('Unsaved sign-off');
      });
      act(() => result.current.saveAll()); // leaves a warning behind for discardChanges to clear
      expect(result.current.saveLocalWarning).not.toBe('');

      act(() => {
        result.current.setDemosTemplate('Discarded edit, should not survive');
        result.current.setSignOff('Discarded sign-off, should not survive');
      });

      act(() => result.current.discardChanges());

      expect(result.current.demosTemplate).toBe('Unsaved edit');
      expect(result.current.signOff).toBe('Unsaved sign-off');
      expect(result.current.isDirty).toBe(false);
      expect(result.current.saveLocalWarning).toBe('');
    });
  });

  describe('hydrateFromStorage', () => {
    it('loads every saved key into both the draft and its lastSaved mirror, including via the threaded-in sign-off setters', () => {
      localStorage.setItem('tp_sign_off', 'Stored sign-off');
      localStorage.setItem('tp_sign_off_image', 'data:image/png;base64,STORED');
      localStorage.setItem('tp_email_template', 'Stored demos template');
      localStorage.setItem('tp_email_subject', 'Stored demos subject');
      localStorage.setItem('tp_email_subject_b', 'Stored subject B');
      localStorage.setItem('tp_followup_template', 'Stored follow-up template');
      localStorage.setItem('tp_followup_subject', 'Stored follow-up subject');
      localStorage.setItem('tp_radio_template', 'Stored radio template');
      localStorage.setItem('tp_radio_subject', 'Stored radio subject');

      const { result } = renderDrafts();
      act(() => result.current.hydrateFromStorage());

      expect(result.current.demosTemplate).toBe('Stored demos template');
      expect(result.current.demosSubject).toBe('Stored demos subject');
      expect(result.current.demosSubjectB).toBe('Stored subject B');
      expect(result.current.demosFollowUpTemplate).toBe('Stored follow-up template');
      expect(result.current.demosFollowUpSubject).toBe('Stored follow-up subject');
      expect(result.current.radioTemplate).toBe('Stored radio template');
      expect(result.current.radioSubject).toBe('Stored radio subject');
      expect(result.current.signOff).toBe('Stored sign-off');
      expect(result.current.signOffImage).toBe('data:image/png;base64,STORED');
      // Mirrors were updated too, not just the drafts — otherwise the save bar
      // would show "Unsaved changes" the instant a hydrated device loads.
      expect(result.current.isDirty).toBe(false);
    });

    it('leaves defaults in place for keys that were never saved', () => {
      const { result } = renderDrafts();
      act(() => result.current.hydrateFromStorage());
      expect(result.current.demosTemplate).not.toBe('');
      expect(result.current.isDirty).toBe(false);
    });
  });

  // The shared-manager ("2+ matched artists, one manager") template pair —
  // added in this phase, following demosFollowUpTemplate/demosFollowUpSubject's
  // own tests above through every place that pair is exercised: initial
  // defaults, dirty-tracking, save-all's persisted keys, discard, and hydration.
  describe('demosMultiArtistTemplate / demosMultiArtistSubject', () => {
    it('starts at the documented defaults, same as every other template draft', () => {
      const { result } = renderDrafts();
      expect(result.current.demosMultiArtistTemplate).toBe(DEFAULT_MULTI_ARTIST_TEMPLATE);
      expect(result.current.demosMultiArtistSubject).toBe(DEFAULT_MULTI_ARTIST_SUBJECT);
    });

    it('flips isDirty true when only the multi-artist draft changes', () => {
      const { result } = renderDrafts();
      expect(result.current.isDirty).toBe(false);
      act(() => result.current.setDemosMultiArtistTemplate('Hi {{managerName}}, sharing {{artistSummary}}'));
      expect(result.current.isDirty).toBe(true);
    });

    it('saveAll writes both keys to syncStorage and clears isDirty', () => {
      const { result } = renderDrafts();
      act(() => {
        result.current.setDemosMultiArtistTemplate('Multi-artist template');
        result.current.setDemosMultiArtistSubject('Multi-artist subject');
      });
      expect(result.current.isDirty).toBe(true);

      act(() => result.current.saveAll());

      expect(syncStorage.setItem).toHaveBeenCalledWith('tp_multiartist_template', 'Multi-artist template');
      expect(syncStorage.setItem).toHaveBeenCalledWith('tp_multiartist_subject', 'Multi-artist subject');
      expect(result.current.isDirty).toBe(false);
    });

    it('discardChanges restores the last-saved multi-artist draft, dropping an unsaved edit', () => {
      const { result } = renderDrafts();
      act(() => result.current.setDemosMultiArtistTemplate('Saved multi-artist template'));
      act(() => result.current.saveAll());

      act(() => result.current.setDemosMultiArtistTemplate('Unsaved edit, should not survive'));
      expect(result.current.isDirty).toBe(true);

      act(() => result.current.discardChanges());
      expect(result.current.demosMultiArtistTemplate).toBe('Saved multi-artist template');
      expect(result.current.isDirty).toBe(false);
    });

    it('hydrateFromStorage loads both keys into the draft and its lastSaved mirror', () => {
      localStorage.setItem('tp_multiartist_template', 'Stored multi-artist template');
      localStorage.setItem('tp_multiartist_subject', 'Stored multi-artist subject');

      const { result } = renderDrafts();
      act(() => result.current.hydrateFromStorage());

      expect(result.current.demosMultiArtistTemplate).toBe('Stored multi-artist template');
      expect(result.current.demosMultiArtistSubject).toBe('Stored multi-artist subject');
      // The lastSaved mirror was updated too, not just the draft — otherwise the
      // save bar would show "Unsaved changes" the instant a hydrated device loads.
      expect(result.current.isDirty).toBe(false);
    });
  });
});
