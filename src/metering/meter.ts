// @file: driver-llm/metering/meter.ts
import type { ApiProtocol } from '../types/connection';
import type { TokenUsage } from '../types/response';
import type { MeteredTokens } from './usage';

/** Read a non-negative finite counter; anything else meters as zero. */
function count(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function cachedOf(usage: TokenUsage): number {
    return count(usage.cached_tokens);
}

function cacheWriteOf(usage: TokenUsage): number {
    return count(usage.details?.cache_creation_input_tokens);
}

function reasoningOf(usage: TokenUsage): number {
    return count(usage.thinking_tokens) || count(usage.details?.reasoning_tokens);
}

/**
 * Reduce a vendor usage payload into disjoint billing buckets.
 *
 * Cache bucketing is protocol knowledge, not catalog data:
 * - OpenAI chat/responses report `cached_tokens` INSIDE `prompt_tokens`
 * - Gemini reports `cachedContentTokenCount` INSIDE `promptTokenCount`
 * - Anthropic reports `cache_read_input_tokens`/`cache_creation_input_tokens` OUTSIDE
 *   `input_tokens`, but the Anthropic provider normalizes `prompt_tokens` to their sum
 *
 * So the subtraction below is uniform: cached and cache-write tokens always leave the
 * full-rate input bucket. Doing this anywhere but here requires re-deriving vendor
 * semantics from a payload that no longer records them.
 *
 * Gemini bills `thoughtsTokenCount` at the output rate while keeping it out of
 * `candidatesTokenCount`; every other protocol already folds reasoning into completion.
 */
export function meterUsage(usage: TokenUsage | undefined, protocol: ApiProtocol): MeteredTokens | undefined {
    if (!usage) return;
    const prompt = count(usage.prompt_tokens);
    const completion = count(usage.completion_tokens);
    const cacheReadTokens = cachedOf(usage);
    const cacheWriteTokens = cacheWriteOf(usage);
    const reasoningTokens = reasoningOf(usage);
    const uncached = Math.max(0, prompt - cacheReadTokens - cacheWriteTokens);
    return {
        inputTokens: uncached,
        outputTokens: protocol === 'gemini-generate' ? completion + reasoningTokens : completion,
        cacheReadTokens,
        cacheWriteTokens,
        reasoningTokens,
    };
}

/**
 * Merge cumulative usage frames across a stream.
 *
 * Vendors spread terminal totals over different events (Anthropic splits prompt into
 * `message_start` and output into `message_delta`; OpenAI sends one terminal frame;
 * Gemini repeats cumulative metadata), so the merge is "last defined value per field".
 * Only the transport knows that, which is why accumulation lives beside the SSE parsers.
 */
export function mergeTokenUsage(...frames: Array<Record<string, unknown> | undefined>): TokenUsage {
    const merged: TokenUsage = {};
    for (const frame of frames) {
        if (!frame || typeof frame !== 'object') continue;
        for (const [key, value] of Object.entries(frame)) {
            if (key === 'details') {
                if (value && typeof value === 'object') merged.details = { ...merged.details, ...value as Record<string, unknown> };
                continue;
            }
            // Only counters accumulate; transport-only fields stay out of the metered view.
            if (typeof value === 'number' && Number.isFinite(value)) merged[key] = value;
        }
    }
    return merged;
}

/** Sum buckets that measure the same run; used for session and per-entry rollups. */
export function addMetered(...values: Array<MeteredTokens | undefined>): MeteredTokens {
    const total: MeteredTokens = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 };
    for (const value of values) {
        if (!value) continue;
        total.inputTokens += value.inputTokens;
        total.outputTokens += value.outputTokens;
        total.cacheReadTokens += value.cacheReadTokens;
        total.cacheWriteTokens += value.cacheWriteTokens;
        total.reasoningTokens += value.reasoningTokens;
    }
    return total;
}
