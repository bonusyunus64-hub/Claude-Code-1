import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, screen, cleanup } from '@testing-library/react';
import { RecipientsPreviewList, type RecipientsPreviewListProps } from './RecipientsPreviewList';
import type { Artist } from '../../types';

// @testing-library/react's auto-cleanup only registers itself when it detects a
// global `afterEach` (this project doesn't turn on vitest's `test.globals`), so
// each render has to be unmounted by hand or later tests see leftover DOM from
// earlier ones.
afterEach(cleanup);

function artist(overrides: Partial<Artist> = {}): Artist {
  return {
    name: 'Nova', genres: ['Pop', 'Indie'], spotifyFollowers: 10_000, managementCompany: 'Acme Mgmt',
    managerNames: ['Sam'], managerEmails: ['sam@example.com'], labels: '',
    instagramHandle: '', avatarUrl: '', gender: '', type: 'Person',
    ...overrides,
  };
}

/** Distinct from the default `artist()` fixture in every field a test might
 *  assert on, so a query for one artist's data can never accidentally match
 *  the other's. */
function echo(overrides: Partial<Artist> = {}): Artist {
  return artist({
    name: 'Echo', genres: ['Rock'], managementCompany: 'Echo Mgmt',
    managerNames: ['Robin'], managerEmails: ['robin@example.com'],
    ...overrides,
  });
}

/**
 * This is the most logic-heavy piece pulled out of DemosSection: it owns
 * per-artist exclusion checkboxes, select-all/deselect-all, the genre-chip
 * toggle that refreshes the filter set, sorting, and the outside-search
 * fallback when nothing in the current filters matches the search box. A
 * render test here is worth more than one on the thinner panels since this
 * is where the refactor had the most opportunity to lose behavior.
 */
function baseProps(overrides: Partial<RecipientsPreviewListProps> = {}): RecipientsPreviewListProps {
  return {
    previewLoading: false,
    previewArtists: [artist({ name: 'Nova' }), echo()],
    visibleArtists: [artist({ name: 'Nova' }), echo()],
    excludedArtistNames: new Set<string>(),
    setExcludedArtistNames: vi.fn(),
    toggleArtistExclusion: vi.fn(),
    recipientSearch: '',
    setRecipientSearch: vi.fn(),
    sortOrder: 'followers-desc',
    setSortOrder: vi.fn(),
    selectedGenres: ['Pop'],
    toggleGenreFromPreview: vi.fn(),
    outsideResults: [],
    outsideResultsQuery: '',
    outsideSearchLoading: false,
    handleOutsideSearch: vi.fn(),
    addOutsideArtistToContacts: vi.fn(),
    customContacts: [],
    pitchedEmailMap: new Map(),
    ...overrides,
  };
}

describe('RecipientsPreviewList', () => {
  it('renders every visible artist with its manager email', () => {
    render(<RecipientsPreviewList {...baseProps()} />);
    expect(screen.getByText('Nova')).toBeTruthy();
    expect(screen.getByText('Echo')).toBeTruthy();
    expect(screen.getByText(/sam@example\.com/)).toBeTruthy();
    expect(screen.getByText(/robin@example\.com/)).toBeTruthy();
  });

  it('clicking a row toggles that artist\'s exclusion, not some other artist\'s', () => {
    // Click the management-company line rather than the artist name: the name
    // is a CopyableName that stopPropagation()s its own click (copy-to-clipboard
    // instead of toggling the row) — clicking it wouldn't exercise the row's
    // own handler at all.
    const toggleArtistExclusion = vi.fn();
    render(<RecipientsPreviewList {...baseProps({ toggleArtistExclusion })} />);
    fireEvent.click(screen.getByText('Echo Mgmt'));
    expect(toggleArtistExclusion).toHaveBeenCalledTimes(1);
    expect(toggleArtistExclusion).toHaveBeenCalledWith('Echo');
  });

  it('renders excluded artists checked-off and dimmed', () => {
    const { container } = render(<RecipientsPreviewList {...baseProps({ excludedArtistNames: new Set(['Nova']) })} />);
    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    expect((checkboxes[0] as HTMLInputElement).checked).toBe(false);
    expect((checkboxes[1] as HTMLInputElement).checked).toBe(true);
  });

  it('"Deselect all" adds every currently visible artist to the exclusion set, keeping others already excluded', () => {
    const setExcludedArtistNames = vi.fn();
    render(<RecipientsPreviewList {...baseProps({ setExcludedArtistNames, excludedArtistNames: new Set(['SomeoneElse']) })} />);
    fireEvent.click(screen.getByText('Deselect all'));
    expect(setExcludedArtistNames).toHaveBeenCalledTimes(1);
    const updater = setExcludedArtistNames.mock.calls[0][0] as (prev: Set<string>) => Set<string>;
    const result = updater(new Set(['SomeoneElse']));
    expect(result).toEqual(new Set(['SomeoneElse', 'Nova', 'Echo']));
  });

  it('"Select all" removes every currently visible artist from the exclusion set', () => {
    const setExcludedArtistNames = vi.fn();
    render(<RecipientsPreviewList {...baseProps({ setExcludedArtistNames, excludedArtistNames: new Set(['Nova', 'Echo', 'SomeoneElse']) })} />);
    fireEvent.click(screen.getByText('Select all'));
    const updater = setExcludedArtistNames.mock.calls[0][0] as (prev: Set<string>) => Set<string>;
    const result = updater(new Set(['Nova', 'Echo', 'SomeoneElse']));
    expect(result).toEqual(new Set(['SomeoneElse']));
  });

  it('clicking a genre chip toggles the filter without also toggling the artist row (event propagation is stopped)', () => {
    const toggleGenreFromPreview = vi.fn();
    const toggleArtistExclusion = vi.fn();
    render(<RecipientsPreviewList {...baseProps({ toggleGenreFromPreview, toggleArtistExclusion })} />);
    fireEvent.click(screen.getByText('Pop'));
    expect(toggleGenreFromPreview).toHaveBeenCalledWith('Pop');
    expect(toggleArtistExclusion).not.toHaveBeenCalled();
  });

  it('changing the sort dropdown reports the new order', () => {
    const setSortOrder = vi.fn();
    render(<RecipientsPreviewList {...baseProps({ setSortOrder })} />);
    fireEvent.change(screen.getByDisplayValue('Followers: High → Low'), { target: { value: 'alpha-asc' } });
    expect(setSortOrder).toHaveBeenCalledWith('alpha-asc');
  });

  it('falls back to the outside-search block when no visible artists match the current search', () => {
    render(<RecipientsPreviewList {...baseProps({ visibleArtists: [], recipientSearch: 'Zzz' })} />);
    expect(screen.getByText(/No artists match/)).toBeTruthy();
    expect(screen.getByText('Show results outside your filters')).toBeTruthy();
  });
});
