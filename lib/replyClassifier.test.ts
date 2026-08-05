import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The Anthropic SDK client is mocked wholesale — same pattern as nodemailer in
// lib/mailSend.test.ts — so these tests never make a real network call. Vitest's
// vi.mock hoisting only lets a factory reference outer variables whose names are
// prefixed `mock`, which is why this is named mockCreate rather than something
// else.
const mockCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  // `new` requires a real function/class implementation, not an arrow function —
  // an arrow-backed mockImplementation isn't a valid constructor and `new
  // Anthropic(...)` in replyClassifier.ts would throw before ever reaching
  // messages.create.
  default: vi.fn(function AnthropicMock() {
    return { messages: { create: (params: unknown) => mockCreate(params) } };
  }),
}));

import { isAiClassifierConfigured, classifyRepliesWithAI, BATCH_SIZE, MAX_BATCHES } from './replyClassifier';

function jsonResponse(classifications: { id: number; label: string }[]) {
  return { content: [{ type: 'text', text: JSON.stringify({ classifications }) }] };
}

/** Counts how many <reply id="..."> blocks a given classifyBatch request actually sent, so batching tests can echo back exactly one classification per item without hardcoding batch sizes. */
function echoUnclassifiedForEachReply(params: unknown) {
  const content = (params as { messages: { content: string }[] }).messages[0].content;
  const count = (content.match(/<reply id="\d+">/g) ?? []).length;
  return Promise.resolve(jsonResponse(Array.from({ length: count }, (_, i) => ({ id: i, label: 'unclassified' }))));
}

describe('isAiClassifierConfigured', () => {
  const original = process.env.ANTHROPIC_API_KEY;
  afterEach(() => {
    if (original === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = original;
  });

  it('is false when ANTHROPIC_API_KEY is unset', () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(isAiClassifierConfigured()).toBe(false);
  });

  it('is true when ANTHROPIC_API_KEY is set', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-key';
    expect(isAiClassifierConfigured()).toBe(true);
  });
});

describe('classifyRepliesWithAI', () => {
  const original = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-key';
    mockCreate.mockReset();
  });

  afterEach(() => {
    if (original === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = original;
  });

  it('returns nothing and never calls the API when no key is configured (no-API-key fallback)', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const result = await classifyRepliesWithAI([{ key: '1', text: 'Sounds great, send it over!' }]);
    expect(result).toEqual({});
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns nothing and never calls the API for an empty batch', async () => {
    const result = await classifyRepliesWithAI([]);
    expect(result).toEqual({});
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('maps a successful response back to the caller-supplied keys (successful classification)', async () => {
    mockCreate.mockResolvedValue(jsonResponse([
      { id: 0, label: 'interested' },
      { id: 1, label: 'pass' },
    ]));

    const result = await classifyRepliesWithAI([
      { key: 'uid-10', text: 'We would love to hear the stems first.' },
      { key: 'uid-11', text: 'Not for us right now, thanks.' },
    ]);

    expect(result).toEqual({ 'uid-10': 'interested', 'uid-11': 'pass' });
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('sends replies as a structured, delimited prompt rather than one concatenated blob', async () => {
    mockCreate.mockResolvedValue(jsonResponse([{ id: 0, label: 'unclassified' }]));
    await classifyRepliesWithAI([{ key: '1', text: 'Hello there' }]);

    const params = mockCreate.mock.calls[0][0];
    expect(params.model).toBe('claude-haiku-4-5');
    expect(params.messages[0].content).toContain('<reply id="0">');
    expect(params.messages[0].content).toContain('Hello there');
    // Structured output constrains the model to the fixed {id, label} schema —
    // part of the prompt-injection defense described in replyClassifier.ts.
    expect(params.output_config.format.type).toBe('json_schema');
    expect(params.output_config.format.schema.properties.classifications.items.properties.label.enum)
      .toEqual(['interested', 'pass', 'unclassified']);
    // Haiku rejects `effort` outright — sending it would fail every call and
    // silently drop every batch to the keyword fallback, which is exactly the
    // kind of failure this module is designed to make invisible. Pin it so a
    // well-meaning re-add can't ship without also changing the model.
    expect(params.output_config.effort).toBeUndefined();
  });

  it('falls back to nothing for a batch whose request throws (API-failure fallback)', async () => {
    mockCreate.mockRejectedValue(new Error('network error'));
    const result = await classifyRepliesWithAI([{ key: '1', text: 'hello' }]);
    expect(result).toEqual({});
  });

  it('falls back to nothing when the response is not valid JSON', async () => {
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text: 'not json at all' }] });
    const result = await classifyRepliesWithAI([{ key: '1', text: 'hello' }]);
    expect(result).toEqual({});
  });

  it('falls back to nothing when the response has no text block at all', async () => {
    mockCreate.mockResolvedValue({ content: [] });
    const result = await classifyRepliesWithAI([{ key: '1', text: 'hello' }]);
    expect(result).toEqual({});
  });

  it('drops individual entries whose id or label is outside the expected shape, keeping the rest', async () => {
    mockCreate.mockResolvedValue(jsonResponse([
      { id: 0, label: 'extremely-interested' } as unknown as { id: number; label: string }, // invalid label
      { id: 1, label: 'pass' },
    ]));

    const result = await classifyRepliesWithAI([
      { key: 'a', text: 'one' },
      { key: 'b', text: 'two' },
    ]);

    expect(result).toEqual({ b: 'pass' });
  });

  it('splits a batch larger than BATCH_SIZE into multiple requests rather than one call per reply', async () => {
    mockCreate.mockImplementation(echoUnclassifiedForEachReply);
    const replies = Array.from({ length: BATCH_SIZE * 2 + 5 }, (_, i) => ({ key: `k${i}`, text: `reply body ${i}` }));

    const result = await classifyRepliesWithAI(replies);

    // ceil((BATCH_SIZE*2+5) / BATCH_SIZE) = 3 requests, not one per reply
    expect(mockCreate).toHaveBeenCalledTimes(3);
    expect(Object.keys(result)).toHaveLength(replies.length);
  });

  it('caps total AI-classified replies at BATCH_SIZE * MAX_BATCHES, leaving the remainder for the keyword fallback', async () => {
    mockCreate.mockImplementation(echoUnclassifiedForEachReply);
    const cap = BATCH_SIZE * MAX_BATCHES;
    const replies = Array.from({ length: cap + 50 }, (_, i) => ({ key: `k${i}`, text: `reply body ${i}` }));

    const result = await classifyRepliesWithAI(replies);

    expect(mockCreate).toHaveBeenCalledTimes(MAX_BATCHES);
    expect(Object.keys(result)).toHaveLength(cap);
    // The first `cap` keys were classified; anything past the cap simply isn't
    // in the result, which is exactly what a caller needs to fall back on.
    expect(result['k0']).toBeDefined();
    expect(result[`k${cap}`]).toBeUndefined();
  });
});
