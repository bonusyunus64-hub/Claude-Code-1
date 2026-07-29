import type { SendResultEntry, BatchProgress } from './types';

export function getTodayDateStr(): string {
  return new Date().toISOString().slice(0, 10);
}

// Send routes page through recipients (offset/limit) instead of one long request, so a
// large batch can't hit a serverless function timeout. This loops until the server
// reports no more pages, reporting live progress as each page comes back.
export async function sendInBatches(
  endpoint: string,
  payload: Record<string, unknown>,
  onProgress: (progress: BatchProgress) => void
): Promise<{ ok: true; results: SendResultEntry[]; total: number } | { ok: false; error: string }> {
  let offset = 0;
  const allResults: SendResultEntry[] = [];
  let total = 0;
  for (;;) {
    let res: Response;
    let data: { error?: string; results?: SendResultEntry[]; total?: number; nextOffset?: number | null };
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, offset }),
      });
      data = await res.json();
    } catch {
      return { ok: false, error: 'Network error. Please try again.' };
    }
    if (!res.ok) return { ok: false, error: data.error || 'Failed to send.' };
    allResults.push(...(data.results ?? []));
    total = data.total ?? allResults.length;
    onProgress({
      sent: allResults.filter(r => r.success).length,
      failed: allResults.filter(r => !r.success).length,
      total,
    });
    if (data.nextOffset == null) break;
    offset = data.nextOffset;
  }
  return { ok: true, results: allResults, total };
}

export function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows.map(row => row.map(csvEscape).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function parseContactsCsv(text: string): { artistName: string; managerName: string; managerEmail: string }[] {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const out: { artistName: string; managerName: string; managerEmail: string }[] = [];
  for (const line of lines) {
    const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    if (cols.length < 2) continue;
    const [artistName, managerName, managerEmail] = cols.length >= 3
      ? [cols[0], cols[1], cols[2]]
      : [cols[0], '', cols[1]];
    if (!artistName || !managerEmail || !managerEmail.includes('@')) continue;
    if (artistName.toLowerCase() === 'artist' && managerEmail.toLowerCase().includes('email')) continue;
    out.push({ artistName, managerName, managerEmail });
  }
  return out;
}

export function renderTemplateClient(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

export function pronounForClient(gender: string, type: string): string {
  if (type === 'Group') return 'they';
  if (gender === 'MALE') return 'he';
  if (gender === 'FEMALE') return 'she';
  return 'they';
}
