// @file: driver-llm/metering/usage.ts

/**
 * Disjoint billing buckets — the single authoritative metering shape.
 *
 * Every prompt token falls into exactly ONE input bucket, so a rate table can price
 * each bucket independently without double counting:
 *
 * - `inputTokens`        uncached prompt tokens (full input rate)
 * - `cacheReadTokens`    prompt tokens served from cache (cache read rate)
 * - `cacheWriteTokens`   prompt tokens written into cache (cache write rate)
 * - `outputTokens`       completion tokens, INCLUDING reasoning tokens
 * - `reasoningTokens`    informational subset of `outputTokens`, never added again
 *
 * Invariants:
 * - inputTokens + cacheReadTokens + cacheWriteTokens === the vendor's total prompt tokens
 * - outputTokens >= reasoningTokens
 *
 * Reasoning carries no dedicated rate slot, so it is billed inside `outputTokens`;
 * `reasoningTokens` exists only so hosts can report it without re-pricing it.
 */
export interface MeteredTokens {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    reasoningTokens: number;
}

/** Metering vocabulary for non-token billing units (image/audio/character). */
export type MeteringUnit =
    | 'million-tokens'
    | 'image'
    | 'million-characters'
    | 'ten-thousand-characters'
    | 'second'
    | 'minute';
