import { describe, it, expect } from 'vitest';
import { renderTemplate, pronounFor, escapeHtml, textToHtml } from './emailTemplate';

describe('renderTemplate', () => {
  it('substitutes known variables', () => {
    expect(renderTemplate('Hi {{managerName}}, love {{artistName}}', { managerName: 'Sam', artistName: 'Nova' }))
      .toBe('Hi Sam, love Nova');
  });

  it('leaves unknown placeholders untouched', () => {
    expect(renderTemplate('Hi {{unknown}}', {})).toBe('Hi {{unknown}}');
  });

  it('handles repeated placeholders', () => {
    expect(renderTemplate('{{x}}-{{x}}', { x: 'a' })).toBe('a-a');
  });
});

describe('pronounFor', () => {
  it('returns they for groups regardless of gender', () => {
    expect(pronounFor('MALE', 'Group')).toBe('they');
  });

  it('returns he for male solo artists', () => {
    expect(pronounFor('MALE', 'Solo')).toBe('he');
  });

  it('returns she for female solo artists', () => {
    expect(pronounFor('FEMALE', 'Solo')).toBe('she');
  });

  it('defaults to they for unknown/blank gender', () => {
    expect(pronounFor('', 'Solo')).toBe('they');
    expect(pronounFor('OTHER', 'Solo')).toBe('they');
  });
});

describe('escapeHtml', () => {
  it('escapes angle brackets and ampersands', () => {
    expect(escapeHtml('<b>A & B</b>')).toBe('&lt;b&gt;A &amp; B&lt;/b&gt;');
  });
});

describe('textToHtml', () => {
  it('wraps paragraphs and converts single newlines to <br>', () => {
    expect(textToHtml('line1\nline2\n\npara2')).toBe(
      '<p style="margin:0 0 12px 0">line1<br>line2</p><p style="margin:0 0 12px 0">para2</p>'
    );
  });

  it('escapes html inside paragraphs', () => {
    expect(textToHtml('<script>')).toBe('<p style="margin:0 0 12px 0">&lt;script&gt;</p>');
  });
});
