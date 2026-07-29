import { NextRequest, NextResponse } from 'next/server';
import { isKvConfigured } from '@/lib/kv';
import { listAccounts, saveAccount, deleteAccount, type StoredAccount } from '@/lib/accounts';

// Accounts live server-side so the browser never holds an SMTP password. The
// client works purely with account ids; the send routes look the credentials up
// themselves.

export async function GET() {
  if (!isKvConfigured()) return NextResponse.json({ accounts: [], storageReady: false });
  return NextResponse.json({ accounts: await listAccounts(), storageReady: true });
}

export async function POST(req: NextRequest) {
  if (!isKvConfigured()) {
    return NextResponse.json({ error: 'Account storage is not configured on the server.' }, { status: 500 });
  }

  const body = await req.json() as Partial<StoredAccount>;
  const { id, name, email, smtpHost, smtpPort, smtpUser, smtpPass } = body;

  if (!name || !smtpUser || !smtpPass) {
    return NextResponse.json({ error: 'Name, SMTP user and password are required.' }, { status: 400 });
  }

  try {
    const account = await saveAccount({
      id: id || Date.now().toString(),
      name,
      email: email || smtpUser,
      smtpHost: smtpHost || 'smtp.zoho.com',
      smtpPort: Number(smtpPort) || 465,
      smtpUser,
      smtpPass,
    });
    return NextResponse.json({ account });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!isKvConfigured()) {
    return NextResponse.json({ error: 'Account storage is not configured on the server.' }, { status: 500 });
  }
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  await deleteAccount(id);
  return NextResponse.json({ ok: true });
}
