import { NextResponse } from 'next/server';
import { getRoster } from '@/lib/roster';

export async function GET() {
  const { genres } = getRoster();
  return NextResponse.json({ genres });
}
