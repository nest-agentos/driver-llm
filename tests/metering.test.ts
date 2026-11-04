import { describe, expect, it } from 'vitest';
import { addMetered, mergeTokenUsage, meterUsage } from '../src/metering';
import type { TokenUsage } from '../src/types';

/** Cached prompt tokens must leave the full-rate input bucket for every protocol. */
describe('meterUsage', () => {
    it('cached OpenAI prompt tokens are not billed as full-rate input', () => {
        const usage: TokenUsage = {prompt_tokens: 1000, completion_tokens: 200, cached_tokens: 800};
        expect(meterUsage(usage, 'openai-chat')).toEqual({
            inputTokens: 200, outputTokens: 200, cacheReadTokens: 800, cacheWriteTokens: 0, reasoningTokens: 0,
        });
    });

    it('cached Gemini prompt tokens are not billed as full-rate input', () => {
        const usage: TokenUsage = {prompt_tokens: 1000, completion_tokens: 100, cached_tokens: 600};
        expect(meterUsage(usage, 'gemini-generate')).toMatchObject({inputTokens: 400, cacheReadTokens: 600});
    });

    it('Gemini bills thoughts at the output rate without dropping them from completion', () => {
        const usage: TokenUsage = {prompt_tokens: 500, completion_tokens: 100, thinking_tokens: 40};
        expect(meterUsage(usage, 'gemini-generate')).toMatchObject({outputTokens: 140, reasoningTokens: 40});
    });

    it('OpenAI already folds reasoning into completion, so it is not added twice', () => {
        const usage: TokenUsage = {prompt_tokens: 500, completion_tokens: 100, details: {reasoning_tokens: 40}};
        expect(meterUsage(usage, 'openai-chat')).toMatchObject({outputTokens: 100, reasoningTokens: 40});
    });

    it('Anthropic splits prompt into uncached, cache read and cache write buckets', () => {
        const usage: TokenUsage = {
            prompt_tokens: 1000, completion_tokens: 300, cached_tokens: 700,
            details: {cache_creation_input_tokens: 100, reasoning_tokens: 50},
        };
        expect(meterUsage(usage, 'anthropic-messages')).toEqual({
            inputTokens: 200, outputTokens: 300, cacheReadTokens: 700, cacheWriteTokens: 100, reasoningTokens: 50,
        });
    });

    it('buckets always sum back to the vendor prompt total', () => {
        for (const protocol of ['openai-chat', 'openai-responses', 'anthropic-messages', 'gemini-generate'] as const) {
            const usage: TokenUsage = {
                prompt_tokens: 1200, completion_tokens: 10, cached_tokens: 500, details: {cache_creation_input_tokens: 200},
            };
            const metered = meterUsage(usage, protocol)!;
            expect(metered.inputTokens + metered.cacheReadTokens + metered.cacheWriteTokens).toBe(1200);
        }
    });

    it('inconsistent vendor totals never produce a negative input bucket', () => {
        const usage: TokenUsage = {prompt_tokens: 100, cached_tokens: 500};
        expect(meterUsage(usage, 'openai-chat')!.inputTokens).toBe(0);
    });

    it('absent usage stays absent instead of metering zeros as a real report', () => {
        expect(meterUsage(undefined, 'openai-chat')).toBeUndefined();
    });
});

describe('mergeTokenUsage', () => {
    it('accumulates the Anthropic split between message_start and message_delta', () => {
        const merged = mergeTokenUsage(
            {input_tokens: 100, cache_read_input_tokens: 900},
            {output_tokens: 250},
        );
        expect(merged).toEqual({input_tokens: 100, cache_read_input_tokens: 900, output_tokens: 250});
    });

    it('later frames override cumulative counters', () => {
        expect(mergeTokenUsage({completion_tokens: 10}, {completion_tokens: 42})).toEqual({completion_tokens: 42});
    });

    it('merges nested detail counters instead of replacing them', () => {
        const merged = mergeTokenUsage({details: {reasoning_tokens: 5}}, {details: {cache_creation_input_tokens: 7}});
        expect(merged.details).toEqual({reasoning_tokens: 5, cache_creation_input_tokens: 7});
    });

    it('ignores absent and non-numeric frames', () => {
        expect(mergeTokenUsage(undefined, {prompt_tokens: 3}, {prompt_tokens: 'x' as never})).toEqual({prompt_tokens: 3});
    });
});

describe('addMetered', () => {
    it('sums buckets across entries and skips absent reports', () => {
        const first = meterUsage({prompt_tokens: 10, completion_tokens: 2}, 'openai-chat');
        expect(addMetered(first, undefined, first)).toEqual({
            inputTokens: 20, outputTokens: 4, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0,
        });
    });
});
