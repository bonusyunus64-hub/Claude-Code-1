export interface TestEmailPanelProps {
  testEmailTo: string;
  setTestEmailTo: (value: string) => void;
  setTestEmailResult: (result: 'success' | 'error' | null) => void;
  handleTestEmail: () => void;
  testEmailSending: boolean;
  selectedAccountId: string;
  testEmailResult: 'success' | 'error' | null;
  testEmailError: string;
}

export function TestEmailPanel(props: TestEmailPanelProps) {
  const {
    testEmailTo, setTestEmailTo, setTestEmailResult, handleTestEmail, testEmailSending,
    selectedAccountId, testEmailResult, testEmailError,
  } = props;

  return (
    <div className="pt-3 mt-1 border-t border-zinc-800 space-y-2">
      <p className="text-xs text-zinc-500">Happy with it? Send yourself a test with the real subject, template and merge fields filled in before sending to everyone.</p>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="email"
          value={testEmailTo}
          onChange={e => { setTestEmailTo(e.target.value); setTestEmailResult(null); }}
          placeholder="your-own-email@example.com"
          className="flex-1 rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition"
        />
        <button
          onClick={handleTestEmail}
          disabled={!testEmailTo || testEmailSending || !selectedAccountId}
          className="rounded-lg bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 px-4 py-2 text-sm font-semibold text-white transition sm:shrink-0"
        >
          {testEmailSending ? 'Sending…' : 'Send test email'}
        </button>
      </div>
      {testEmailResult === 'success' && <p className="text-xs text-green-400">Test email sent. Check your inbox.</p>}
      {testEmailResult === 'error' && <p className="text-xs text-red-400">{testEmailError}</p>}
      {!selectedAccountId && <p className="text-xs text-amber-500">Add and select an email account in the Account tab first.</p>}
    </div>
  );
}
