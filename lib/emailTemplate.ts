export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

/** Groups have no gender in the roster data, so they default to "they" alongside OTHER/UNKNOWN/blank. */
export function pronounFor(gender: string, type: string): string {
  if (type === 'Group') return 'they';
  if (gender === 'MALE') return 'he';
  if (gender === 'FEMALE') return 'she';
  return 'they';
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function textToHtml(text: string): string {
  return text
    .split('\n\n')
    .map(p => `<p style="margin:0 0 12px 0">${p.split('\n').map(escapeHtml).join('<br>')}</p>`)
    .join('');
}
