import type { Artist, CustomContact, DemosFilterPreset, EmailAccount, SavedTemplate } from '../types';
import type { ManagerGroup } from '@/lib/artistFit';
import { MainTemplatePanel } from './demos/MainTemplatePanel';
import { FollowUpTemplatePanel } from './demos/FollowUpTemplatePanel';
import { MultiArtistTemplatePanel } from './demos/MultiArtistTemplatePanel';
import { TrackDetailsPanel } from './demos/TrackDetailsPanel';
import { SavedFiltersPanel } from './demos/SavedFiltersPanel';
import { GenreSelector } from './demos/GenreSelector';
import { AudienceFiltersPanel } from './demos/AudienceFiltersPanel';
import { CustomContactsPanel } from './demos/CustomContactsPanel';
import { PreviewControls } from './demos/PreviewControls';
import { RecipientsPreviewList } from './demos/RecipientsPreviewList';
import { CustomContactsPreviewList } from './demos/CustomContactsPreviewList';
import { SendWarnings } from './demos/SendWarnings';
import { SendControls } from './demos/SendControls';
import { TestEmailPanel } from './demos/TestEmailPanel';

export interface DemosSectionProps {
  demosTab: 'compose' | 'template';
  setDemosTab: (tab: 'compose' | 'template') => void;

  demosSubject: string;
  setDemosSubject: (value: string) => void;
  demosSubjectB: string;
  setDemosSubjectB: (value: string) => void;
  subjectTestEnabled: boolean;
  setSubjectTestEnabled: (updater: (prev: boolean) => boolean) => void;
  demosTemplate: string;
  setDemosTemplate: (value: string) => void;
  demosTemplateLibrary: SavedTemplate[];
  newDemosTemplateName: string;
  setNewDemosTemplateName: (value: string) => void;
  saveDemosTemplateToLibrary: () => void;
  loadDemosTemplateFromLibrary: (template: SavedTemplate) => void;
  deleteDemosTemplateFromLibrary: (id: string) => void;

  demosFollowUpSubject: string;
  setDemosFollowUpSubject: (value: string) => void;
  demosFollowUpTemplate: string;
  setDemosFollowUpTemplate: (value: string) => void;
  followUpTemplateLibrary: SavedTemplate[];
  newFollowUpTemplateName: string;
  setNewFollowUpTemplateName: (value: string) => void;
  saveFollowUpTemplateToLibrary: () => void;
  loadFollowUpTemplateFromLibrary: (template: SavedTemplate) => void;
  deleteFollowUpTemplateFromLibrary: (id: string) => void;

  demosMultiArtistSubject: string;
  setDemosMultiArtistSubject: (value: string) => void;
  demosMultiArtistTemplate: string;
  setDemosMultiArtistTemplate: (value: string) => void;

  senderName: string;
  setSenderName: (value: string) => void;
  trackTitle: string;
  setTrackTitle: (value: string) => void;
  demosPitchCount: number;
  driveLink: string;
  setDriveLink: (value: string) => void;

  demosPresets: DemosFilterPreset[];
  newDemosPresetName: string;
  setNewDemosPresetName: (value: string) => void;
  saveDemosPreset: () => void;
  loadDemosPreset: (preset: DemosFilterPreset) => void;
  deleteDemosPreset: (id: string) => void;

  demosMatchMode: 'any' | 'all';
  setDemosMatchMode: (mode: 'any' | 'all') => void;
  selectedGenres: string[];
  setSelectedGenres: (genres: string[]) => void;
  toggleGenre: (genre: string) => void;
  genreSearch: string;
  setGenreSearch: (value: string) => void;
  showGenreDropdown: boolean;
  setShowGenreDropdown: (show: boolean) => void;
  topGenres: string[];
  filteredGenres: string[];
  resetFilters: () => void;
  setPreviewDone: (done: boolean) => void;
  setSendResult: (result: { sent: number; failed: number; total: number } | null) => void;

  minAudience: number;
  setMinAudience: (value: number) => void;
  maxAudience: number;
  setMaxAudience: (value: number) => void;
  showInstagram: boolean;
  setShowInstagram: (updater: (prev: boolean) => boolean) => void;
  minInstagram: number;
  setMinInstagram: (value: number) => void;
  maxInstagram: number;
  setMaxInstagram: (value: number) => void;
  gender: string;
  setGender: (value: string) => void;
  artistType: string;
  setArtistType: (value: string) => void;
  reachableOnly: boolean;
  setReachableOnly: (updater: (prev: boolean) => boolean) => void;
  matchAllGenres: boolean;
  setMatchAllGenres: (updater: (prev: boolean) => boolean) => void;
  audienceEstimate: { artists: number; inboxes: number } | null;
  audienceEstimateLoading: boolean;

  customContacts: CustomContact[];
  removeCustomContact: (id: string) => void;
  showAddCustomContact: boolean;
  setShowAddCustomContact: (show: boolean) => void;
  newCustomContact: { artistName: string; managerName: string; managerEmail: string };
  setNewCustomContact: React.Dispatch<React.SetStateAction<{ artistName: string; managerName: string; managerEmail: string }>>;
  addCustomContact: () => void;
  handleCustomContactsCsv: (e: React.ChangeEvent<HTMLInputElement>) => void;

  handlePreview: () => void;
  previewDone: boolean;
  previewLoading: boolean;
  previewArtists: Artist[];
  includedArtists: Artist[];
  visibleArtists: Artist[];
  totalEmails: number;
  excludedByBlacklist: number;
  setExcludedArtistNames: React.Dispatch<React.SetStateAction<Set<string>>>;
  excludedArtistNames: Set<string>;
  toggleArtistExclusion: (name: string) => void;
  toggleGenreFromPreview: (genre: string) => void;
  recipientSearch: string;
  setRecipientSearch: (value: string) => void;
  sortOrder: 'followers-desc' | 'followers-asc' | 'alpha-asc' | 'alpha-desc' | 'random';
  setSortOrder: (order: 'followers-desc' | 'followers-asc' | 'alpha-asc' | 'alpha-desc' | 'random') => void;
  outsideResults: Artist[];
  outsideResultsQuery: string;
  outsideSearchLoading: boolean;
  handleOutsideSearch: (query: string) => void;
  addOutsideArtistToContacts: (a: Artist) => void;
  pitchedEmailMap: Map<string, string[]>;

  setPreviewModalType: (type: 'demos' | 'radio' | null) => void;
  setPreviewModalIdx: (idx: number) => void;

  demosDuplicateRecipients: string[];
  cooldownRecipients: string[];
  contactCooldownDays: number;
  overCapManagers: ManagerGroup<Artist>[];
  demosInvalidEmails: string[];
  setDemosInvalidEmails: (emails: string[]) => void;
  addFailedToBlacklist: (emails: string[]) => void;

  sendResult: { sent: number; failed: number; total: number } | null;
  sendFailedEmails: string[];
  setSendFailedEmails: (emails: string[]) => void;
  sendError: string;

  useFollowUp: boolean;
  setUseFollowUp: (updater: (prev: boolean) => boolean) => void;
  handleSend: () => void;
  canSend: boolean;
  sending: boolean;

  selectedAccount: EmailAccount | undefined;
  setActiveSection: (section: 'overview' | 'demos' | 'promotion' | 'account' | 'history') => void;

  testEmailTo: string;
  setTestEmailTo: (value: string) => void;
  setTestEmailResult: (result: 'success' | 'error' | null) => void;
  handleTestEmail: () => void;
  testEmailSending: boolean;
  selectedAccountId: string;
  testEmailResult: 'success' | 'error' | null;
  testEmailError: string;
}

export function DemosSection(props: DemosSectionProps) {
  const {
    demosTab, setDemosTab,
    demosSubject, setDemosSubject, demosSubjectB, setDemosSubjectB, subjectTestEnabled, setSubjectTestEnabled,
    demosTemplate, setDemosTemplate, demosTemplateLibrary,
    newDemosTemplateName, setNewDemosTemplateName, saveDemosTemplateToLibrary, loadDemosTemplateFromLibrary, deleteDemosTemplateFromLibrary,
    demosFollowUpSubject, setDemosFollowUpSubject, demosFollowUpTemplate, setDemosFollowUpTemplate, followUpTemplateLibrary,
    newFollowUpTemplateName, setNewFollowUpTemplateName, saveFollowUpTemplateToLibrary, loadFollowUpTemplateFromLibrary, deleteFollowUpTemplateFromLibrary,
    demosMultiArtistSubject, setDemosMultiArtistSubject, demosMultiArtistTemplate, setDemosMultiArtistTemplate,
    senderName, setSenderName, trackTitle, setTrackTitle, demosPitchCount, driveLink, setDriveLink,
    demosPresets, newDemosPresetName, setNewDemosPresetName, saveDemosPreset, loadDemosPreset, deleteDemosPreset,
    demosMatchMode, setDemosMatchMode, selectedGenres, setSelectedGenres, toggleGenre, genreSearch, setGenreSearch,
    showGenreDropdown, setShowGenreDropdown, topGenres, filteredGenres, resetFilters, setPreviewDone, setSendResult,
    minAudience, setMinAudience, maxAudience, setMaxAudience, showInstagram, setShowInstagram,
    minInstagram, setMinInstagram, maxInstagram, setMaxInstagram, gender, setGender, artistType, setArtistType,
    reachableOnly, setReachableOnly, matchAllGenres, setMatchAllGenres, audienceEstimate, audienceEstimateLoading,
    customContacts, removeCustomContact, showAddCustomContact, setShowAddCustomContact,
    newCustomContact, setNewCustomContact, addCustomContact, handleCustomContactsCsv,
    handlePreview, previewDone, previewLoading, previewArtists, includedArtists, visibleArtists, totalEmails, excludedByBlacklist,
    setExcludedArtistNames, excludedArtistNames, toggleArtistExclusion, toggleGenreFromPreview,
    recipientSearch, setRecipientSearch, sortOrder, setSortOrder,
    outsideResults, outsideResultsQuery, outsideSearchLoading, handleOutsideSearch, addOutsideArtistToContacts, pitchedEmailMap,
    setPreviewModalType, setPreviewModalIdx,
    demosDuplicateRecipients, cooldownRecipients, contactCooldownDays, overCapManagers, demosInvalidEmails, setDemosInvalidEmails, addFailedToBlacklist,
    sendResult, sendFailedEmails, setSendFailedEmails, sendError,
    useFollowUp, setUseFollowUp, handleSend, canSend, sending,
    selectedAccount, setActiveSection,
    testEmailTo, setTestEmailTo, setTestEmailResult, handleTestEmail, testEmailSending, selectedAccountId, testEmailResult, testEmailError,
  } = props;

  return (
    <>
      <div className="flex gap-1 bg-zinc-900 rounded-lg p-1 w-fit border border-zinc-800">
        {(['compose', 'template'] as const).map(t => (
          <button key={t} onClick={() => setDemosTab(t)}
            className={`px-3 py-1.5 rounded-md text-xs md:text-sm font-medium transition ${demosTab === t ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}>
            {t === 'compose' ? 'Compose Pitch' : 'Email Template'}
          </button>
        ))}
      </div>

      {demosTab === 'template' && (
        <div className="space-y-6">
          <MainTemplatePanel
            demosSubject={demosSubject} setDemosSubject={setDemosSubject}
            demosSubjectB={demosSubjectB} setDemosSubjectB={setDemosSubjectB}
            subjectTestEnabled={subjectTestEnabled} setSubjectTestEnabled={setSubjectTestEnabled}
            demosTemplate={demosTemplate} setDemosTemplate={setDemosTemplate}
            demosTemplateLibrary={demosTemplateLibrary}
            newDemosTemplateName={newDemosTemplateName} setNewDemosTemplateName={setNewDemosTemplateName}
            saveDemosTemplateToLibrary={saveDemosTemplateToLibrary}
            loadDemosTemplateFromLibrary={loadDemosTemplateFromLibrary}
            deleteDemosTemplateFromLibrary={deleteDemosTemplateFromLibrary}
          />

          <FollowUpTemplatePanel
            demosFollowUpSubject={demosFollowUpSubject} setDemosFollowUpSubject={setDemosFollowUpSubject}
            demosFollowUpTemplate={demosFollowUpTemplate} setDemosFollowUpTemplate={setDemosFollowUpTemplate}
            followUpTemplateLibrary={followUpTemplateLibrary}
            newFollowUpTemplateName={newFollowUpTemplateName} setNewFollowUpTemplateName={setNewFollowUpTemplateName}
            saveFollowUpTemplateToLibrary={saveFollowUpTemplateToLibrary}
            loadFollowUpTemplateFromLibrary={loadFollowUpTemplateFromLibrary}
            deleteFollowUpTemplateFromLibrary={deleteFollowUpTemplateFromLibrary}
          />

          <MultiArtistTemplatePanel
            demosMultiArtistSubject={demosMultiArtistSubject} setDemosMultiArtistSubject={setDemosMultiArtistSubject}
            demosMultiArtistTemplate={demosMultiArtistTemplate} setDemosMultiArtistTemplate={setDemosMultiArtistTemplate}
          />
        </div>
      )}

      {demosTab === 'compose' && (<>
        {/* Track Info */}
        <TrackDetailsPanel
          senderName={senderName} setSenderName={setSenderName}
          trackTitle={trackTitle} setTrackTitle={setTrackTitle}
          demosPitchCount={demosPitchCount}
          driveLink={driveLink} setDriveLink={setDriveLink}
        />

        {/* Saved Filter Presets */}
        <SavedFiltersPanel
          demosPresets={demosPresets}
          newDemosPresetName={newDemosPresetName} setNewDemosPresetName={setNewDemosPresetName}
          saveDemosPreset={saveDemosPreset} loadDemosPreset={loadDemosPreset} deleteDemosPreset={deleteDemosPreset}
        />

        {/* Genre Selector */}
        <GenreSelector
          demosMatchMode={demosMatchMode} setDemosMatchMode={setDemosMatchMode}
          selectedGenres={selectedGenres} setSelectedGenres={setSelectedGenres} toggleGenre={toggleGenre}
          genreSearch={genreSearch} setGenreSearch={setGenreSearch}
          showGenreDropdown={showGenreDropdown} setShowGenreDropdown={setShowGenreDropdown}
          topGenres={topGenres} filteredGenres={filteredGenres}
          setPreviewDone={setPreviewDone} setSendResult={setSendResult}
        />

        {/* Filters */}
        <AudienceFiltersPanel
          minAudience={minAudience} setMinAudience={setMinAudience}
          maxAudience={maxAudience} setMaxAudience={setMaxAudience}
          showInstagram={showInstagram} setShowInstagram={setShowInstagram}
          minInstagram={minInstagram} setMinInstagram={setMinInstagram}
          maxInstagram={maxInstagram} setMaxInstagram={setMaxInstagram}
          gender={gender} setGender={setGender}
          artistType={artistType} setArtistType={setArtistType}
          resetFilters={resetFilters}
          reachableOnly={reachableOnly} setReachableOnly={setReachableOnly}
          matchAllGenres={matchAllGenres} setMatchAllGenres={setMatchAllGenres}
          selectedGenres={selectedGenres}
          audienceEstimate={audienceEstimate} audienceEstimateLoading={audienceEstimateLoading}
        />

        {/* Custom Contacts */}
        <CustomContactsPanel
          customContacts={customContacts} removeCustomContact={removeCustomContact}
          showAddCustomContact={showAddCustomContact} setShowAddCustomContact={setShowAddCustomContact}
          newCustomContact={newCustomContact} setNewCustomContact={setNewCustomContact}
          addCustomContact={addCustomContact} handleCustomContactsCsv={handleCustomContactsCsv}
        />

        {/* Preview */}
        <PreviewControls
          handlePreview={handlePreview}
          previewLoading={previewLoading}
          previewDone={previewDone}
          hasSelectedGenres={selectedGenres.length > 0}
          customContactsCount={customContacts.length}
          includedArtistsCount={includedArtists.length}
          previewArtistsCount={previewArtists.length}
          totalEmails={totalEmails}
          excludedByBlacklist={excludedByBlacklist}
          setPreviewModalType={setPreviewModalType}
          setPreviewModalIdx={setPreviewModalIdx}
        />

        {previewDone && previewArtists.length > 0 && (
          <RecipientsPreviewList
            previewLoading={previewLoading}
            previewArtists={previewArtists}
            visibleArtists={visibleArtists}
            excludedArtistNames={excludedArtistNames}
            setExcludedArtistNames={setExcludedArtistNames}
            toggleArtistExclusion={toggleArtistExclusion}
            recipientSearch={recipientSearch}
            setRecipientSearch={setRecipientSearch}
            sortOrder={sortOrder}
            setSortOrder={setSortOrder}
            selectedGenres={selectedGenres}
            toggleGenreFromPreview={toggleGenreFromPreview}
            outsideResults={outsideResults}
            outsideResultsQuery={outsideResultsQuery}
            outsideSearchLoading={outsideSearchLoading}
            handleOutsideSearch={handleOutsideSearch}
            addOutsideArtistToContacts={addOutsideArtistToContacts}
            customContacts={customContacts}
            pitchedEmailMap={pitchedEmailMap}
          />
        )}

        {previewDone && previewArtists.length === 0 && !customContacts.length && (
          <p className="text-sm text-zinc-500">No artists with manager emails found for the selected genres.</p>
        )}

        {/* Custom contacts in preview */}
        {customContacts.length > 0 && (
          <CustomContactsPreviewList customContacts={customContacts} pitchedEmailMap={pitchedEmailMap} />
        )}

        <SendWarnings
          trackTitle={trackTitle}
          demosDuplicateRecipients={demosDuplicateRecipients}
          cooldownRecipients={cooldownRecipients}
          contactCooldownDays={contactCooldownDays}
          overCapManagers={overCapManagers}
          demosInvalidEmails={demosInvalidEmails}
          setDemosInvalidEmails={setDemosInvalidEmails}
          addFailedToBlacklist={addFailedToBlacklist}
          sendResult={sendResult}
          sendFailedEmails={sendFailedEmails}
          setSendFailedEmails={setSendFailedEmails}
          sendError={sendError}
        />

        <SendControls
          useFollowUp={useFollowUp}
          setUseFollowUp={setUseFollowUp}
          subjectTestEnabled={subjectTestEnabled}
          demosSubjectB={demosSubjectB}
          handleSend={handleSend}
          canSend={canSend}
          sending={sending}
          sendResult={sendResult}
          totalEmails={totalEmails}
          selectedAccount={selectedAccount}
          setActiveSection={setActiveSection}
        />

        <TestEmailPanel
          testEmailTo={testEmailTo}
          setTestEmailTo={setTestEmailTo}
          setTestEmailResult={setTestEmailResult}
          handleTestEmail={handleTestEmail}
          testEmailSending={testEmailSending}
          selectedAccountId={selectedAccountId}
          testEmailResult={testEmailResult}
          testEmailError={testEmailError}
        />
      </>)}
    </>
  );
}
