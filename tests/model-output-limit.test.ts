import {expect, it, vi} from 'vitest';
import {LLMDriver} from '../src/core/driver';

it.each([{protocol: 'anthropic-messages', limit: undefined, expected: 262144}, {protocol: 'anthropic-messages', limit: 16384, expected: 16384}, {protocol: 'openai-chat', limit: undefined, expected: undefined}] as const)('uses declared output capacity only when the protocol requires a limit ($protocol, explicit=$limit)', async ({protocol, limit, expected}) => {
    const fetch = vi.fn(async (_url: RequestInfo | URL, _options?: RequestInit) => new Response(JSON.stringify(protocol === 'anthropic-messages'
        ? {id: 'reply', type: 'message', role: 'assistant', content: [{type: 'text', text: 'done'}], stop_reason: 'end_turn', usage: {input_tokens: 1, output_tokens: 1}}
        : {id: 'reply', choices: [{message: {role: 'assistant', content: 'done'}, finish_reason: 'stop'}], usage: {prompt_tokens: 1, completion_tokens: 1}}), {headers: {'content-type': 'application/json'}}));
    const driver = new LLMDriver({provider: 'fixture', model: 'large', apiKey: 'fixture', protocol, fetch,
        customProviderDefaults: {fixture: {id: 'fixture', name: 'Fixture', implementation: 'openai-compatible', baseURL: 'https://fixture.invalid',
            models: [{id: 'large', name: 'Large', maxOutput: 262144}, {id: 'small', name: 'Small', maxOutput: 16384}]}}});
    try {
        await driver.chat.create({model: 'large', messages: [{role: 'user', content: 'example'}], ...(limit ? {maxTokens: limit} : {})});
        expect(JSON.parse(String(fetch.mock.calls[0][1]?.body)).max_tokens).toBe(expected);
    } finally {await driver.dispose();}
});
