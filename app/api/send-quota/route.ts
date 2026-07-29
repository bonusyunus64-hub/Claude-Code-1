import { NextResponse } from 'next/server';
import { getDailyCap, getSendsToday } from '@/lib/sendQuota';

// The dashboard reads today's count from here rather than keeping its own tally,
// so the number it shows matches the one the send routes actually enforce.
export async function GET() {
  const [sends, cap] = await Promise.all([getSendsToday(), getDailyCap()]);
  return NextResponse.json({ ...sends, cap });
}
