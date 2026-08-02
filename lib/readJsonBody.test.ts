import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { readJsonBody } from './readJsonBody';

function reqWithBody(body: string): NextRequest {
  return new NextRequest('https://example.com/api/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
}

describe('readJsonBody', () => {
  it('returns the parsed body when it is valid JSON', async () => {
    const parsed = await readJsonBody<{ trackTitle: string }>(reqWithBody('{"trackTitle":"Test"}'));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.data.trackTitle).toBe('Test');
  });

  // The whole point of the helper: before it, each of these threw out of the route
  // handler and Next surfaced them as a 500.
  it.each([
    ['truncated JSON', '{"trackTitle":'],
    ['a bare string that is not JSON at all', 'not json'],
    ['an empty body', ''],
  ])('turns %s into a 400 rather than throwing', async (_label, body) => {
    const parsed = await readJsonBody(reqWithBody(body));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.response.status).toBe(400);
      expect(await parsed.response.json()).toEqual({ error: 'Invalid JSON' });
    }
  });

  // JSON's top level doesn't have to be an object, and `null`/`[]`/`"x"` all parse
  // cleanly. Routes do their own shape validation, so the helper deliberately passes
  // these through as `ok` rather than second-guessing what a given route wants — the
  // failure it exists to catch is unparseable input, not an unexpected shape.
  it('passes through valid JSON that is not an object, leaving shape checks to the route', async () => {
    for (const body of ['null', '[]', '"just a string"', '42']) {
      const parsed = await readJsonBody(reqWithBody(body));
      expect(parsed.ok).toBe(true);
    }
  });
});
