import { NextRequest, NextResponse } from 'next/server';
import { checkRecipients } from '@/lib/mxCheck';

export async function POST(req: NextRequest) {
  const { emails } = await req.json() as { emails?: string[] };
  if (!emails?.length) return NextResponse.json({ malformed: [], noMx: [] });

  const unique = Array.from(new Set(emails.map(e => e.trim()).filter(Boolean)));
  const result = await checkRecipients(unique);
  return NextResponse.json(result);
}
