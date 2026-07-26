import { ImapFlow } from 'imapflow';

export interface ImapConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
}

/**
 * Zoho's IMAP host mirrors its SMTP host (smtp.zoho.com -> imap.zoho.com) under
 * the same account credentials, so we derive it instead of asking for a second
 * set of settings. Falls back to the smtp host itself for any other provider.
 */
export function resolveImapConfig(smtpHost: string, user: string, pass: string): ImapConfig {
  const host = smtpHost.replace(/^smtp\./, 'imap.');
  return { host, port: 993, user, pass };
}

/**
 * Checks which of `emails` have sent a message to this mailbox since `since`.
 * One IMAP SEARCH per address rather than fetching+parsing the whole inbox.
 */
export async function findResponders(config: ImapConfig, emails: string[], since: Date): Promise<string[]> {
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: true,
    auth: { user: config.user, pass: config.pass },
    logger: false,
  });

  await client.connect();
  const responded: string[] = [];
  try {
    await client.mailboxOpen('INBOX', { readOnly: true });
    for (const email of emails) {
      const uids = await client.search({ from: email, since });
      if (uids && uids.length > 0) responded.push(email);
    }
  } finally {
    await client.logout();
  }
  return responded;
}
