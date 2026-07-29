import { NextRequest, NextResponse } from 'next/server';
import { promises as dns } from 'dns';

const DKIM_SELECTORS = ['default', 'mail', 'google', 'zoho', 'dkim', 'k1', 's1', 's2', 'selector1', 'selector2'];

export async function POST(req: NextRequest) {
  const { domain } = await req.json() as { domain: string };
  if (!domain) return NextResponse.json({ error: 'Domain required' }, { status: 400 });

  const result = {
    domain,
    spf: false,
    spfRecord: '',
    dkim: false,
    dkimSelector: '',
    mx: false,
    mxRecords: [] as string[],
    dmarc: false,
    dmarcRecord: '',
    dmarcPolicy: '' as '' | 'none' | 'quarantine' | 'reject',
  };

  try {
    const txtRecords = await dns.resolveTxt(domain);
    const spfRecord = txtRecords.flat().find(r => r.startsWith('v=spf1'));
    if (spfRecord) { result.spf = true; result.spfRecord = spfRecord; }
  } catch {}

  for (const selector of DKIM_SELECTORS) {
    try {
      const records = await dns.resolveTxt(`${selector}._domainkey.${domain}`);
      if (records.length > 0) { result.dkim = true; result.dkimSelector = selector; break; }
    } catch {}
  }

  try {
    const mxRecords = await dns.resolveMx(domain);
    if (mxRecords.length > 0) { result.mx = true; result.mxRecords = mxRecords.map(r => r.exchange); }
  } catch {}

  // DMARC lives on a fixed subdomain rather than the domain itself, and tells
  // receiving servers what to do with mail that fails SPF/DKIM — Gmail and Yahoo
  // now require at least a "none" policy from bulk senders.
  try {
    const dmarcRecords = await dns.resolveTxt(`_dmarc.${domain}`);
    const dmarcRecord = dmarcRecords.flat().find(r => r.startsWith('v=DMARC1'));
    if (dmarcRecord) {
      result.dmarc = true;
      result.dmarcRecord = dmarcRecord;
      const policyMatch = dmarcRecord.match(/p=(none|quarantine|reject)/i);
      if (policyMatch) result.dmarcPolicy = policyMatch[1].toLowerCase() as 'none' | 'quarantine' | 'reject';
    }
  } catch {}

  return NextResponse.json(result);
}
