import { describe, it, expect } from 'vitest';
import { computeSpamScore } from './spamScore';

describe('computeSpamScore', () => {
  it('scores clean text as low risk with no issues', () => {
    const result = computeSpamScore('Hi there, hope you enjoy this new single.');
    expect(result.score).toBe(0);
    expect(result.risk).toBe('low');
    expect(result.issues).toHaveLength(0);
  });

  it('flags spam-trigger phrases', () => {
    const result = computeSpamScore('Click here for a guaranteed free prize, act now!');
    expect(result.score).toBeGreaterThan(0);
    expect(result.issues.some(i => i.includes('spam-trigger'))).toBe(true);
  });

  it('flags excessive exclamation marks', () => {
    const result = computeSpamScore('Wow!!! Amazing!!! Buy!!!');
    expect(result.issues.some(i => i.includes('exclamation'))).toBe(true);
  });

  it('flags a high ratio of all-caps words', () => {
    const result = computeSpamScore('THIS IS A REALLY GREAT AMAZING DEAL FOR YOU TODAY');
    expect(result.issues.some(i => i.includes('ALL CAPS'))).toBe(true);
  });

  it('flags multiple currency symbols', () => {
    const result = computeSpamScore('Only $5 today, normally $50, save $45!');
    expect(result.issues.some(i => i.includes('currency'))).toBe(true);
  });

  it('caps score at 100 and marks high risk for egregious text', () => {
    const spammy = 'FREE FREE FREE!!! GUARANTEED WINNER!!! CLICK HERE NOW!!! ACT NOW!!! $$$ CASH $$$';
    const result = computeSpamScore(spammy);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.risk).toBe('high');
  });
});
