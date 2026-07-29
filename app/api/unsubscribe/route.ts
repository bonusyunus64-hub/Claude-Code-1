import { NextRequest, NextResponse } from 'next/server';
import { verifyUnsubscribeToken, addToBlacklistServerSide } from '@/lib/unsubscribe';

// Machine-facing counterpart to app/unsubscribe/page.tsx (the human landing page):
// this is what the List-Unsubscribe email header points at, so a mail client's
// built-in one-click "Unsubscribe" button (RFC 8058) can hit it directly with a
// POST and no page render. Also answers GET for the handful of clients that still
// treat List-Unsubscribe as a plain link. Public — listed in proxy.ts's
// PUBLIC_API_PATHS — since the recipient clicking it has no dashboard session.

async function handle(req: NextRequest) {
  const email = req.nextUrl.searchParams.get('email');
  const token = req.nextUrl.searchParams.get('token');
  if (!email || !token || !verifyUnsubscribeToken(email, token)) {
    return NextResponse.json({ error: 'Invalid or missing unsubscribe token.' }, { status: 400 });
  }
  await addToBlacklistServerSide(email);
  return NextResponse.json({ ok: true });
}

export const GET = handle;
export const POST = handle;
