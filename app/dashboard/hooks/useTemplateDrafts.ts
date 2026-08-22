'use client';

import { useState } from 'react';
import { syncStorage } from '@/lib/remoteSync';
import {
  DEFAULT_DEMOS_TEMPLATE, DEFAULT_FOLLOWUP_TEMPLATE, DEFAULT_RADIO_TEMPLATE,
  DEFAULT_DEMOS_SUBJECT, DEFAULT_FOLLOWUP_SUBJECT, DEFAULT_RADIO_SUBJECT,
  DEFAULT_MULTI_ARTIST_TEMPLATE, DEFAULT_MULTI_ARTIST_SUBJECT,
  DEFAULT_SIGN_OFF,
} from '../constants';

export interface TemplateDraftsConfig {
  /**
   * signOff/signOffImage are owned by useAccountSettings, not this hook — but
   * they participate in the same dirty-tracking/save-all as the template drafts
   * below (the Save button covers both), so they're threaded in as a value +
   * setter pair, the same way useCampaignHistory takes account.emailAccounts.
   * Do NOT give this hook its own signOff state; that would split ownership of
   * a single value across two hooks with nothing keeping them in sync.
   */
  signOff: string;
  setSignOff: (value: string) => void;
  signOffImage: string | null;
  setSignOffImage: (value: string | null) => void;
}

/**
 * The template/subject drafts for Song Demos (initial pitch + follow-up) and
 * Track Promotion (Radio), plus the machinery that saves and discards them —
 * and, via the threaded-in signOff/signOffImage above, the account signature
 * too. All of it shares one dirty flag and one Save button, which is the
 * reason these fields never moved into useDemosFlow/usePromotionChannel: both
 * of those hooks take the current draft values as config instead, the same
 * way they take signOff/signOffImage.
 *
 * Returns fields under the same names page.tsx's call sites (DemosSection,
 * PromotionSection via `radio`, AccountSection, the test-email handler, the
 * preview modal, the floating save bar) already use.
 */
export function useTemplateDrafts(config: TemplateDraftsConfig) {
  const { signOff, setSignOff, signOffImage, setSignOffImage } = config;

  // Song Demos — template/subject text (both the initial-pitch and follow-up
  // pair) lives here rather than in useDemosFlow since it participates in this
  // hook's shared dirty-tracking/save-all below; everything else is owned by
  // useDemosFlow, which receives these as config.
  const [demosTemplate, setDemosTemplate] = useState(DEFAULT_DEMOS_TEMPLATE);
  const [demosSubject, setDemosSubject] = useState(DEFAULT_DEMOS_SUBJECT);
  // Second subject line for A/B testing (DemosSection's "Test a second subject
  // line" toggle) — empty by default, same as demosSubject would be for a fresh
  // account if it didn't have DEFAULT_DEMOS_SUBJECT to fall back to. Lives here
  // rather than in useDemosFlow for the same reason demosSubject does: it
  // participates in the shared dirty-tracking/save-all below.
  const [demosSubjectB, setDemosSubjectB] = useState('');
  const [demosFollowUpTemplate, setDemosFollowUpTemplate] = useState(DEFAULT_FOLLOWUP_TEMPLATE);
  const [demosFollowUpSubject, setDemosFollowUpSubject] = useState(DEFAULT_FOLLOWUP_SUBJECT);
  // The shared-manager ("2+ matched artists, one manager") pitch — see
  // lib/artistFit.ts's module comment for the problem this solves. Lives here
  // for the exact same reason demosFollowUpTemplate/demosFollowUpSubject do:
  // it participates in this hook's shared dirty-tracking/save-all below, not
  // useDemosFlow's own state.
  const [demosMultiArtistTemplate, setDemosMultiArtistTemplate] = useState(DEFAULT_MULTI_ARTIST_TEMPLATE);
  const [demosMultiArtistSubject, setDemosMultiArtistSubject] = useState(DEFAULT_MULTI_ARTIST_SUBJECT);

  // Track Promotion (Radio) — template/subject text stays here since it
  // participates in the shared dirty-tracking/save-all below; everything else
  // (genre/secondary-filter selection, preview, send, presets, template library)
  // is owned by usePromotionChannel, which receives these as config.
  const [radioTemplate, setRadioTemplate] = useState(DEFAULT_RADIO_TEMPLATE);
  const [radioSubject, setRadioSubject] = useState(DEFAULT_RADIO_SUBJECT);

  // Save tracking
  const [lastSavedDemosTemplate, setLastSavedDemosTemplate] = useState(DEFAULT_DEMOS_TEMPLATE);
  const [lastSavedDemosSubject, setLastSavedDemosSubject] = useState(DEFAULT_DEMOS_SUBJECT);
  const [lastSavedDemosSubjectB, setLastSavedDemosSubjectB] = useState('');
  const [lastSavedFollowUpTemplate, setLastSavedFollowUpTemplate] = useState(DEFAULT_FOLLOWUP_TEMPLATE);
  const [lastSavedFollowUpSubject, setLastSavedFollowUpSubject] = useState(DEFAULT_FOLLOWUP_SUBJECT);
  const [lastSavedMultiArtistTemplate, setLastSavedMultiArtistTemplate] = useState(DEFAULT_MULTI_ARTIST_TEMPLATE);
  const [lastSavedMultiArtistSubject, setLastSavedMultiArtistSubject] = useState(DEFAULT_MULTI_ARTIST_SUBJECT);
  const [lastSavedRadioTemplate, setLastSavedRadioTemplate] = useState(DEFAULT_RADIO_TEMPLATE);
  const [lastSavedRadioSubject, setLastSavedRadioSubject] = useState(DEFAULT_RADIO_SUBJECT);
  const [lastSavedSignOff, setLastSavedSignOff] = useState(DEFAULT_SIGN_OFF);
  const [lastSavedSignOffImage, setLastSavedSignOffImage] = useState<string | null>(null);

  // Set when saveAll() finds that one of its syncStorage.setItem calls couldn't write to
  // localStorage (see the return-value comment on syncStorage.setItem) — most likely the
  // signature image pushing the synced-settings blob over the browser's 5MB quota. The
  // server copy still saved fine, so this is informational rather than blocking.
  const [saveLocalWarning, setSaveLocalWarning] = useState('');

  const isDirty =
    demosTemplate !== lastSavedDemosTemplate ||
    demosSubject !== lastSavedDemosSubject ||
    demosSubjectB !== lastSavedDemosSubjectB ||
    demosFollowUpTemplate !== lastSavedFollowUpTemplate ||
    demosFollowUpSubject !== lastSavedFollowUpSubject ||
    demosMultiArtistTemplate !== lastSavedMultiArtistTemplate ||
    demosMultiArtistSubject !== lastSavedMultiArtistSubject ||
    radioTemplate !== lastSavedRadioTemplate ||
    radioSubject !== lastSavedRadioSubject ||
    signOff !== lastSavedSignOff ||
    signOffImage !== lastSavedSignOffImage;

  function saveAll() {
    // syncStorage.setItem returns false when the localStorage half of the write failed
    // (e.g. quota exceeded) — it still pushes to the server regardless, so nothing here
    // is actually lost, but the user should know their next page-load might not reflect
    // it instantly if this browser goes offline before the server copy is fetched again.
    let localWriteFailed = false;
    const track = (ok: boolean) => { if (!ok) localWriteFailed = true; };
    track(syncStorage.setItem('tp_email_template', demosTemplate));
    track(syncStorage.setItem('tp_email_subject', demosSubject));
    track(syncStorage.setItem('tp_email_subject_b', demosSubjectB));
    track(syncStorage.setItem('tp_followup_template', demosFollowUpTemplate));
    track(syncStorage.setItem('tp_followup_subject', demosFollowUpSubject));
    track(syncStorage.setItem('tp_multiartist_template', demosMultiArtistTemplate));
    track(syncStorage.setItem('tp_multiartist_subject', demosMultiArtistSubject));
    track(syncStorage.setItem('tp_radio_template', radioTemplate));
    track(syncStorage.setItem('tp_radio_subject', radioSubject));
    track(syncStorage.setItem('tp_sign_off', signOff));
    if (signOffImage) track(syncStorage.setItem('tp_sign_off_image', signOffImage));
    else syncStorage.removeItem('tp_sign_off_image');
    setSaveLocalWarning(localWriteFailed
      ? "Saved to your account, but this browser's local storage is full (likely the signature image) — clear some space or shrink the image so this device stays in sync while offline."
      : '');
    setLastSavedDemosTemplate(demosTemplate);
    setLastSavedDemosSubject(demosSubject);
    setLastSavedDemosSubjectB(demosSubjectB);
    setLastSavedFollowUpTemplate(demosFollowUpTemplate);
    setLastSavedFollowUpSubject(demosFollowUpSubject);
    setLastSavedMultiArtistTemplate(demosMultiArtistTemplate);
    setLastSavedMultiArtistSubject(demosMultiArtistSubject);
    setLastSavedRadioTemplate(radioTemplate);
    setLastSavedRadioSubject(radioSubject);
    setLastSavedSignOff(signOff);
    setLastSavedSignOffImage(signOffImage);
  }

  function discardChanges() {
    setDemosTemplate(lastSavedDemosTemplate);
    setDemosSubject(lastSavedDemosSubject);
    setDemosSubjectB(lastSavedDemosSubjectB);
    setDemosFollowUpTemplate(lastSavedFollowUpTemplate);
    setDemosFollowUpSubject(lastSavedFollowUpSubject);
    setDemosMultiArtistTemplate(lastSavedMultiArtistTemplate);
    setDemosMultiArtistSubject(lastSavedMultiArtistSubject);
    setRadioTemplate(lastSavedRadioTemplate);
    setRadioSubject(lastSavedRadioSubject);
    setSignOff(lastSavedSignOff);
    setSignOffImage(lastSavedSignOffImage);
    setSaveLocalWarning('');
  }

  /**
   * For page.tsx's initial-load effect: hydrates every draft (and, via the
   * threaded-in setters, the sign-off mirrors) from localStorage after
   * hydrateFromRemote() resolves — see that effect's own comment for why
   * hydrateFromRemote() must run first (it seeds localStorage from the server
   * before this reads it back out).
   */
  function hydrateFromStorage() {
    const savedSignOff = localStorage.getItem('tp_sign_off');
    if (savedSignOff !== null) { setSignOff(savedSignOff); setLastSavedSignOff(savedSignOff); }

    const savedImage = localStorage.getItem('tp_sign_off_image');
    if (savedImage) { setSignOffImage(savedImage); setLastSavedSignOffImage(savedImage); }

    const savedDemosTemplate = localStorage.getItem('tp_email_template');
    if (savedDemosTemplate !== null) { setDemosTemplate(savedDemosTemplate); setLastSavedDemosTemplate(savedDemosTemplate); }

    const savedDemosSubject = localStorage.getItem('tp_email_subject');
    if (savedDemosSubject !== null) { setDemosSubject(savedDemosSubject); setLastSavedDemosSubject(savedDemosSubject); }

    const savedDemosSubjectB = localStorage.getItem('tp_email_subject_b');
    if (savedDemosSubjectB !== null) { setDemosSubjectB(savedDemosSubjectB); setLastSavedDemosSubjectB(savedDemosSubjectB); }

    const savedFollowUp = localStorage.getItem('tp_followup_template');
    if (savedFollowUp !== null) { setDemosFollowUpTemplate(savedFollowUp); setLastSavedFollowUpTemplate(savedFollowUp); }

    const savedFollowUpSubject = localStorage.getItem('tp_followup_subject');
    if (savedFollowUpSubject !== null) { setDemosFollowUpSubject(savedFollowUpSubject); setLastSavedFollowUpSubject(savedFollowUpSubject); }

    const savedMultiArtistTemplate = localStorage.getItem('tp_multiartist_template');
    if (savedMultiArtistTemplate !== null) { setDemosMultiArtistTemplate(savedMultiArtistTemplate); setLastSavedMultiArtistTemplate(savedMultiArtistTemplate); }

    const savedMultiArtistSubject = localStorage.getItem('tp_multiartist_subject');
    if (savedMultiArtistSubject !== null) { setDemosMultiArtistSubject(savedMultiArtistSubject); setLastSavedMultiArtistSubject(savedMultiArtistSubject); }

    const savedRadioTemplate = localStorage.getItem('tp_radio_template');
    if (savedRadioTemplate !== null) { setRadioTemplate(savedRadioTemplate); setLastSavedRadioTemplate(savedRadioTemplate); }

    const savedRadioSubject = localStorage.getItem('tp_radio_subject');
    if (savedRadioSubject !== null) { setRadioSubject(savedRadioSubject); setLastSavedRadioSubject(savedRadioSubject); }
  }

  return {
    demosTemplate, setDemosTemplate, demosSubject, setDemosSubject,
    demosSubjectB, setDemosSubjectB,
    demosFollowUpTemplate, setDemosFollowUpTemplate, demosFollowUpSubject, setDemosFollowUpSubject,
    demosMultiArtistTemplate, setDemosMultiArtistTemplate, demosMultiArtistSubject, setDemosMultiArtistSubject,
    radioTemplate, setRadioTemplate, radioSubject, setRadioSubject,

    isDirty, saveAll, discardChanges,
    saveLocalWarning, setSaveLocalWarning,

    hydrateFromStorage,
  };
}
