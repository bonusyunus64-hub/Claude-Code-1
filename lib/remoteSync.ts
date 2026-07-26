// Mirrors the app's localStorage settings (email accounts, templates, presets,
// campaign history, etc.) to a small server-side store, so switching devices
// doesn't mean redoing setup. localStorage stays the fast local cache; every
// write is also pushed to the server, and hydrateFromRemote() pulls the
// latest copy down on load so a second device catches up.

const SYNCED_KEYS = [
  'tp_email_accounts', 'tp_selected_account',
  'tp_sign_off', 'tp_sign_off_image',
  'tp_email_template', 'tp_email_subject',
  'tp_followup_template', 'tp_followup_subject',
  'tp_radio_template', 'tp_radio_subject',
  'tp_playlist_template', 'tp_playlist_subject',
  'tp_demos_templates', 'tp_followup_templates', 'tp_radio_templates', 'tp_playlist_templates',
  'tp_demos_presets', 'tp_radio_presets', 'tp_playlist_presets',
  'tp_campaigns', 'tp_blacklist', 'tp_failed_emails', 'tp_custom_contacts',
  'tp_send_delay', 'tp_daily_cap', 'tp_sends_today',
];

export async function hydrateFromRemote(): Promise<void> {
  try {
    const res = await fetch('/api/state');
    if (!res.ok) return;
    const { state } = await res.json() as { state: Record<string, string> };
    for (const key of SYNCED_KEYS) {
      const value = state[key];
      if (typeof value === 'string') localStorage.setItem(key, value);
    }
  } catch {
    // Offline or sync store unavailable — fall back to whatever's already in localStorage.
  }
}

function pushToRemote(key: string, value: string): void {
  fetch('/api/state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value }),
  }).catch(() => {});
}

function removeFromRemote(key: string): void {
  fetch(`/api/state?key=${encodeURIComponent(key)}`, { method: 'DELETE' }).catch(() => {});
}

// Drop-in replacement for the localStorage.setItem/removeItem calls this app already made —
// same signature, plus a fire-and-forget push to the server.
export const syncStorage = {
  setItem(key: string, value: string): void {
    localStorage.setItem(key, value);
    pushToRemote(key, value);
  },
  removeItem(key: string): void {
    localStorage.removeItem(key);
    removeFromRemote(key);
  },
};
