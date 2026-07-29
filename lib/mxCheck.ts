import { promises as dns } from 'dns';

export function domainOf(email: string): string | null {
  const at = email.lastIndexOf('@');
  if (at === -1 || at === email.length - 1) return null;
  return email.slice(at + 1).trim().toLowerCase();
}

export function isWellFormedEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

// Domain -> has-mail-capable-DNS, cached for the life of the warm serverless
// instance. A preview batch often repeats the same handful of label/management
// domains across dozens of recipients, so this turns most lookups into a cache hit
// instead of a fresh DNS round trip per address.
const mxCache = new Map<string, boolean>();

async function domainAcceptsMail(domain: string): Promise<boolean> {
  const cached = mxCache.get(domain);
  if (cached !== undefined) return cached;

  let ok = false;
  try {
    const records = await dns.resolveMx(domain);
    ok = records.length > 0;
  } catch {
    // RFC 5321 5.1: a domain with no MX record but a working A/AAAA record is still
    // valid — mail goes straight to that host. Only a domain that resolves to
    // nothing at all is a guaranteed bounce.
    try {
      await dns.resolve(domain);
      ok = true;
    } catch {
      ok = false;
    }
  }
  mxCache.set(domain, ok);
  return ok;
}

export interface MxCheckResult {
  /** Addresses that aren't even shaped like an email. */
  malformed: string[];
  /** Well-formed addresses whose domain has no usable mail DNS. */
  noMx: string[];
}

/** Screens a recipient list for addresses that are guaranteed to bounce before a send ever hits them. */
export async function checkRecipients(emails: string[]): Promise<MxCheckResult> {
  const malformed = emails.filter(e => !isWellFormedEmail(e));
  const wellFormed = emails.filter(e => isWellFormedEmail(e));

  const domains = Array.from(new Set(wellFormed.map(e => domainOf(e)).filter((d): d is string => !!d)));
  const domainOk = new Map<string, boolean>();
  await Promise.all(domains.map(async d => domainOk.set(d, await domainAcceptsMail(d))));

  const noMx = wellFormed.filter(e => {
    const domain = domainOf(e);
    return !!domain && domainOk.get(domain) === false;
  });

  return { malformed, noMx };
}
