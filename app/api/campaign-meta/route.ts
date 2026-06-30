import { NextRequest, NextResponse } from 'next/server';
import { getAllRadioGenres, getAllRadioRegions } from '@/lib/radio';
import { getAllPlaylistGenres, getAllPlaylistPlatforms } from '@/lib/playlists';
import { getAllCollaboratorGenres, getAllCollaboratorLocations, getAllCollaboratorRoles } from '@/lib/collaborators';
import { getAllLabelGenres, getAllLabelRegions, getAllLabelTypes } from '@/lib/labels';

// Per-goal filter metadata: which genre/location/subtype options exist for
// the criteria step of the "new campaign" flow, and what to call them.
// Empty locations/subtypes means that filter isn't applicable to this goal.
export async function GET(req: NextRequest) {
  const goal = req.nextUrl.searchParams.get('goal');

  switch (goal) {
    case 'radio':
      return NextResponse.json({
        genres: getAllRadioGenres(),
        locations: getAllRadioRegions(),
        subtypes: [],
        locationLabel: 'Region',
        subtypeLabel: null,
      });
    case 'playlist':
      return NextResponse.json({
        genres: getAllPlaylistGenres(),
        locations: [],
        subtypes: getAllPlaylistPlatforms(),
        locationLabel: null,
        subtypeLabel: 'Platform',
      });
    case 'collaborator':
      return NextResponse.json({
        genres: getAllCollaboratorGenres(),
        locations: getAllCollaboratorLocations(),
        subtypes: getAllCollaboratorRoles(),
        locationLabel: 'Location',
        subtypeLabel: 'Role',
      });
    case 'label':
      return NextResponse.json({
        genres: getAllLabelGenres(),
        locations: getAllLabelRegions(),
        subtypes: getAllLabelTypes(),
        locationLabel: 'Region',
        subtypeLabel: 'Type',
      });
    default:
      return NextResponse.json({ error: 'Unknown goal' }, { status: 400 });
  }
}
