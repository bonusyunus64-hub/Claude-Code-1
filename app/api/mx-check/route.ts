import { NextRequest, NextResponse } from 'next/server';
import { checkRecipients } from '@/lib/mxCheck';
import { readJsonBody } from '@/lib/readJsonBody';

export async function POST(req: NextRequest) {
  const parsed = await readJsonBody<{ emails?: string[] }>(req);
  if (!parsed.ok) return parsed.response;

  const { emails } = parsed.data;
  if (!emails?.length) return NextResponse.json({ malformed: [], noMx: [] });

  const unique = Array.from(new Set(emails.map(e => e.trim()).filter(Boolean)));
  const result = await checkRecipients(unique);
  return NextResponse.json(result);
}
