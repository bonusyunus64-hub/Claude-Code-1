import { NextRequest, NextResponse } from 'next/server';
import { getRoster } from '@/lib/roster';

// Backfills artist details for campaigns sent before recipient snapshots were
// captured at send time — matches historical recipient emails against the
// current roster. Artists who left the roster or emails that were never in
// it (custom contacts) simply come back with blank fields.
export async function POST(req: NextRequest) {
  const { emails } = await req.json() as { emails?: string[] };
  if (!emails || !emails.length) return NextResponse.json({ recipients: [] });

  const { artists } = getRoster();
  const byEmail = new Map<string, { name: string; managerName: string; avatarUrl: string; managementCompany: string; genres: string[]; instagramHandle: string; spotifyFollowers: number }>();
  artists.forEach(a => {
    a.managerEmails.forEach((email, index) => {
      byEmail.set(email.toLowerCase(), {
        name: a.name,
        managerName: a.managerNames[index] || '',
        avatarUrl: a.avatarUrl,
        managementCompany: a.managementCompany,
        genres: a.genres,
        instagramHandle: a.instagramHandle,
        spotifyFollowers: a.spotifyFollowers,
      });
    });
  });

  const recipients = emails.map(email => {
    const match = byEmail.get(email.toLowerCase());
    return {
      email,
      artistName: match?.name ?? '',
      managerName: match?.managerName ?? '',
      avatarUrl: match?.avatarUrl ?? '',
      managementCompany: match?.managementCompany ?? '',
      genres: match?.genres ?? [],
      instagramHandle: match?.instagramHandle ?? '',
      spotifyFollowers: match?.spotifyFollowers ?? 0,
    };
  });

  return NextResponse.json({ recipients });
}
