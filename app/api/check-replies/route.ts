import { NextRequest, NextResponse } from 'next/server';
import { resolveSmtpConfig } from '@/lib/mailSend';
import { resolveImapConfig, findResponders } from '@/lib/checkReplies';
import { getAccount } from '@/lib/accounts';

interface CheckRepliesPayload {
  emails: string[];
  since: number;
  accountId?: string;
  senderName?: string;
}

export async function POST(req: NextRequest) {
  const { emails, since, accountId, senderName } = await req.json() as CheckRepliesPayload;

  if (!emails?.length || !since) {
    return NextResponse.json({ error: 'Missing emails or since' }, { status: 400 });
  }

  const account = accountId ? await getAccount(accountId) : null;
  if (accountId && !account) {
    return NextResponse.json(
      { error: 'The account this was sent from is no longer available.' },
      { status: 400 }
    );
  }

  const { smtpUser, smtpPass, smtpHost } = resolveSmtpConfig(account ?? undefined, senderName);
  if (!smtpUser || !smtpPass) {
    return NextResponse.json({ error: 'No email account configured.' }, { status: 500 });
  }

  const imapConfig = resolveImapConfig(smtpHost, smtpUser, smtpPass);

  try {
    const responded = await findResponders(imapConfig, emails, new Date(since));
    return NextResponse.json({ responded });
  } catch (err) {
    return NextResponse.json(
      { error: `Could not connect to inbox (${imapConfig.host}). Make sure IMAP is enabled on the account and, if 2FA is on, use an app-specific password. ${String(err)}` },
      { status: 502 }
    );
  }
}
