import { NextRequest, NextResponse } from 'next/server';

/**
 * Reads a request's JSON body, turning a malformed one into a 400 the caller can
 * return rather than an exception.
 *
 * Every API route here used to do a bare `await req.json()`. That throws on a body
 * that isn't valid JSON, and an uncaught throw inside a route handler surfaces as a
 * 500 — which claims the server is broken when what actually happened is that the
 * request couldn't be read. It also made a malformed request and a genuine fault in
 * the send path indistinguishable in logs, which is the more expensive half of the
 * problem: a 500 from /api/send is worth investigating, and one caused by a bad body
 * is not.
 *
 * Returned as a discriminated result rather than by throwing, so a route handles it
 * with a plain `if (!parsed.ok) return parsed.response;` and this helper never has to
 * know which error shape a given route uses for its own failures. `{ error: string }`
 * is what every route here already returns.
 */
export async function readJsonBody<T>(req: NextRequest): Promise<
  { ok: true; data: T } | { ok: false; response: NextResponse }
> {
  try {
    const data = (await req.json()) as T;
    return { ok: true, data };
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }),
    };
  }
}
