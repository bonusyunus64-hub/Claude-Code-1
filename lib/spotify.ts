// Resolves an artist name to their real open.spotify.com/artist/<id> page via the
// Spotify Web API (Client Credentials flow — no user login needed, just an app's
// client id/secret from https://developer.spotify.com/dashboard).

let cachedToken: { token: string; expiresAt: number } | null = null;

export function isSpotifyConfigured(): boolean {
  return !!process.env.SPOTIFY_CLIENT_ID && !!process.env.SPOTIFY_CLIENT_SECRET;
}

async function getAccessToken(): Promise<string | null> {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token;

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) return null;

  const data = await res.json() as { access_token: string; expires_in: number };
  cachedToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return cachedToken.token;
}

interface SpotifySearchResponse {
  artists: {
    items: { name: string; external_urls: { spotify: string } }[];
  };
}

// Returns the artist's real Spotify page, or null if Spotify isn't configured
// or has no match. Picks the top search hit — good enough for our roster names,
// which are already exact artist names rather than free-text queries.
export async function findArtistUrl(name: string): Promise<string | null> {
  const token = await getAccessToken();
  if (!token) return null;

  const res = await fetch(
    `https://api.spotify.com/v1/search?q=${encodeURIComponent(name)}&type=artist&limit=1`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) return null;

  const data = await res.json() as SpotifySearchResponse;
  return data.artists.items[0]?.external_urls.spotify ?? null;
}
