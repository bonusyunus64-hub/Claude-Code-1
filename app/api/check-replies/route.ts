import { NextRequest, NextResponse } from 'next/server';
import { resolveSmtpConfig } from '@/lib/mailSend';
import { resolveImapConfig, findResponders } from '@/lib/checkReplies';
import { resolveAccount } from '@/lib/accounts';

// findResponders opens an IMAP connection and walks the inbox once per recipient
// address being checked — a campaign with dozens of recipients can take well past
// Vercel's 10s default, so this raises the ceiling to 60s (the Hobby-plan max).
export const maxDuration = 60;

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
    const { responded, bounced, classifications } = await findResponders(imapConfig, emails, new Date(since));
    return NextResponse.json({ responded, bounced, classifications });
  } catch (err) {
    return NextResponse.json(
      { error: `Could not connect to inbox (${imapConfig.host}). Make sure IMAP is enabled on the account and, if 2FA is on, use an app-specific password. ${String(err)}` },
      { status: 502 }
    );
  }
}
