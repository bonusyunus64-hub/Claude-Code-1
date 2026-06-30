export interface SpamScoreResult {
  score: number;
  risk: 'low' | 'medium' | 'high';
  issues: string[];
}

const SPAM_PHRASES = [
  'free', 'guarantee', 'guaranteed', 'click here', 'act now', 'limited time',
  'no obligation', 'urgent', 'congratulations', 'winner', 'cash', 'buy now',
  'order now', 'risk-free', 'risk free', 'no cost', 'instant', 'miracle',
  'amazing', '100% free', 'don\'t delete', 'apply now', 'be your own boss',
  'cancel at any time', 'double your', 'earn extra cash', 'get paid',
  'increase sales', 'lower your', 'no fees', 'once in a lifetime',
  'satisfaction guaranteed', 'this isn\'t spam', 'why pay more',
];

export function computeSpamScore(text: string): SpamScoreResult {
  const issues: string[] = [];
  let score = 0;

  const lower = text.toLowerCase();
  const matchedPhrases = SPAM_PHRASES.filter(p => lower.includes(p));
  if (matchedPhrases.length > 0) {
    score += matchedPhrases.length * 8;
    issues.push(`Contains spam-trigger phrase${matchedPhrases.length !== 1 ? 's' : ''}: ${matchedPhrases.slice(0, 5).map(p => `"${p}"`).join(', ')}`);
  }

  const exclamations = (text.match(/!/g) || []).length;
  if (exclamations > 2) {
    score += (exclamations - 2) * 6;
    issues.push(`Excessive exclamation marks (${exclamations})`);
  }

  const words = text.match(/[A-Za-z]{3,}/g) || [];
  const capsWords = words.filter(w => w === w.toUpperCase());
  const capsRatio = words.length > 0 ? capsWords.length / words.length : 0;
  if (capsWords.length >= 3 && capsRatio > 0.1) {
    score += Math.round(capsRatio * 40);
    issues.push(`${Math.round(capsRatio * 100)}% of words are in ALL CAPS`);
  }

  const dollarSigns = (text.match(/\$/g) || []).length;
  if (dollarSigns > 1) {
    score += dollarSigns * 4;
    issues.push(`Multiple currency symbols ($${dollarSigns})`);
  }

  score = Math.min(100, score);
  const risk: SpamScoreResult['risk'] = score >= 50 ? 'high' : score >= 20 ? 'medium' : 'low';

  return { score, risk, issues };
}
