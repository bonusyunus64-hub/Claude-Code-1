import { verifyUnsubscribeToken, addToBlacklistServerSide } from '@/lib/unsubscribe';

// Deliberately outside /dashboard and /api, so proxy.ts's matcher (which only
// covers those two) never gates it — a recipient clicking this link from their
// inbox has no session and shouldn't need one. The token in the URL (not a login)
// is what proves the request is legitimate.

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; token?: string }>;
}) {
  const { email, token } = await searchParams;

  let status: 'done' | 'invalid' | 'missing' = 'missing';
  if (email && token) {
    status = verifyUnsubscribeToken(email, token) ? 'done' : 'invalid';
    if (status === 'done') await addToBlacklistServerSide(email);
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <h1 className="text-2xl font-bold tracking-tight text-white mb-4">TrackPitch</h1>
        {status === 'done' && (
          <>
            <p className="text-white font-medium">You&rsquo;ve been unsubscribed.</p>
            <p className="text-sm text-zinc-400 mt-2">
              <span className="font-mono">{email}</span> won&rsquo;t receive any further emails from us.
            </p>
          </>
        )}
        {status === 'invalid' && (
          <p className="text-sm text-red-400">
            This unsubscribe link isn&rsquo;t valid. If you&rsquo;re still receiving emails you don&rsquo;t want, reply to the sender directly.
          </p>
        )}
        {status === 'missing' && (
          <p className="text-sm text-red-400">This unsubscribe link is missing information and can&rsquo;t be processed.</p>
        )}
      </div>
    </div>
  );
}
