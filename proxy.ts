import { NextRequest, NextResponse } from 'next/server';

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Only protect dashboard routes
  if (!pathname.startsWith('/dashboard')) return NextResponse.next();

  const auth = req.cookies.get('auth')?.value;
  const correct = process.env.SITE_PASSWORD;

  if (!correct || auth !== correct) {
    return NextResponse.redirect(new URL('/', req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*'],
};
