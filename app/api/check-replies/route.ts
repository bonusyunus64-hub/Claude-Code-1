import { NextRequest, NextResponse } from 'next/server';
import { resolveSmtpConfig } from '@/lib/mailSend';
import { resolveImapConfig, findResponders } from '@/lib/checkReplies';
import { resolveAccount } from '@/lib/accounts';

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

  const { account, error: accountError } = await resolveAccount(accountId);
  if (accountError) return NextResponse.json({ error: accountError }, { status: 400 });

  const { smtpUser, smtpPass, smtpHost } = resolveSmtpConfig(account ?? undefined, senderName);
  if (!smtpUser || !smtpPass) {
    return NextResponse.json({ error: 'No email account configured.' }, { status: 500 });
  }

  const imapConfig = resolveImapConfig(smtpHost, smtpUser, smtpPass);

  try {
    const { responded, bounced } = await findResponders(imapConfig, emails, new Date(since));
    return NextResponse.json({ responded, bounced });
  } catch (err) {
    return NextResponse.json(
      { error: `Could not connect to inbox (${imapConfig.host}). Make sure IMAP is enabled on the account and, if 2FA is on, use an app-specific password. ${String(err)}` },
      { status: 502 }
    );
  }
}
