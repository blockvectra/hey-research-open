import { describe, expect, it } from 'vitest';

import { readFixture, stubFetch, testContext } from '../testing';
import { createTelegramBotAdapter, parseTelegramUpdate, redactedTelegramUrl, TELEGRAM_MESSAGE_MAX } from './telegram-bot';

/**
 * The Telegram Bot API contract (2026-09-30, docs/TELEGRAM.md). Fixtures are
 * the documented response and update shapes; CI never calls Telegram
 * (CLAUDE.md architecture rule 16). The token below is a test value in the
 * Bot API's shape, never a real bot's.
 */
const TOKEN = '123456:test-token-not-a-real-bot-key-xyz';
const adapter = createTelegramBotAdapter();

describe('telegram bot adapter', () => {
  it('sends a message as HTML with previews off, and returns the message id', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('telegram-send-message.json') });
    const result = await adapter.fetch({ token: TOKEN, method: 'sendMessage', chatId: 123456789, text: '<b>AgentOS</b> shipped a release' }, testContext({ fetchImpl: stub.fetchImpl }));
    const request = stub.requests[0]!;
    expect(request.url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    expect(request.init?.method).toBe('POST');
    expect(JSON.parse(String(request.init?.body))).toEqual({
      chat_id: 123456789,
      text: '<b>AgentOS</b> shipped a release',
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    });
    expect(result.status).toBe('fresh');
    expect(result.data).toEqual({ method: 'sendMessage', messageId: 4211, chatId: 123456789 });
  });

  it('never hands the token back: the source URL and any error are redacted', async () => {
    const ok = await adapter.fetch({ token: TOKEN, method: 'getMe' }, testContext({ fetchImpl: stubFetch({ status: 200, body: readFixture('telegram-get-me.json') }).fetchImpl }));
    expect(ok.sourceUrl).toBe(redactedTelegramUrl('getMe'));
    expect(JSON.stringify(ok)).not.toContain(TOKEN);
    const refused = await adapter.fetch({ token: TOKEN, method: 'sendMessage', chatId: 1, text: 'x' }, testContext({ fetchImpl: stubFetch({ status: 403, body: readFixture('telegram-error-blocked.json') }).fetchImpl }));
    expect(JSON.stringify(refused)).not.toContain(TOKEN);
    expect(refused.errorMessage).toContain('<redacted>');
  });

  it('reports a blocked chat as a 403, never as data', async () => {
    const result = await adapter.fetch({ token: TOKEN, method: 'sendMessage', chatId: 1, text: 'x' }, testContext({ fetchImpl: stubFetch({ status: 403, body: readFixture('telegram-error-blocked.json') }).fetchImpl }));
    expect(result.status).toBe('error');
    expect(result.httpStatus).toBe(403);
    expect(result.data).toBeUndefined();
  });

  it('reports a flood refusal as rate limited, with the retry the header names', async () => {
    const stub = stubFetch({ status: 429, body: readFixture('telegram-error-flood.json'), headers: { 'retry-after': '35' } });
    const result = await adapter.fetch({ token: TOKEN, method: 'sendMessage', chatId: 1, text: 'x' }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.status).toBe('rate_limited');
    expect(result.httpStatus).toBe(429);
    expect(result.retryAfterSeconds).toBe(35);
    // A 429 is never retried inside the call: the sender's cool-off owns it.
    expect(stub.callCount()).toBe(1);
  });

  it('edits a message, and reports a message that is gone as a 400', async () => {
    const edited = await adapter.fetch({ token: TOKEN, method: 'editMessageText', chatId: 123456789, messageId: 4211, text: 'Withdrawn' }, testContext({ fetchImpl: stubFetch({ status: 200, body: readFixture('telegram-edit-message.json') }).fetchImpl }));
    expect(edited.data).toEqual({ method: 'editMessageText', messageId: 4211, chatId: 123456789 });
    const gone = await adapter.fetch({ token: TOKEN, method: 'editMessageText', chatId: 1, messageId: 9, text: 'Withdrawn' }, testContext({ fetchImpl: stubFetch({ status: 400, body: readFixture('telegram-error-not-found.json') }).fetchImpl }));
    expect(gone.status).toBe('error');
    expect(gone.httpStatus).toBe(400);
  });

  it('sets the webhook with its secret token and reads the webhook back', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('telegram-true.json') });
    const set = await adapter.fetch(
      { token: TOKEN, method: 'setWebhook', url: 'https://heyresearch.xyz/api/telegram/webhook', secretToken: 'secret-value-0123456789', allowedUpdates: ['message', 'callback_query', 'my_chat_member'] },
      testContext({ fetchImpl: stub.fetchImpl }),
    );
    expect(set.data).toEqual({ method: 'setWebhook', done: true });
    expect(JSON.parse(String(stub.requests[0]!.init?.body))).toMatchObject({ secret_token: 'secret-value-0123456789', allowed_updates: ['message', 'callback_query', 'my_chat_member'] });
    const info = await adapter.fetch({ token: TOKEN, method: 'getWebhookInfo' }, testContext({ fetchImpl: stubFetch({ status: 200, body: readFixture('telegram-webhook-info.json') }).fetchImpl }));
    expect(info.data).toMatchObject({ method: 'getWebhookInfo', url: 'https://heyresearch.xyz/api/telegram/webhook', pendingUpdates: 0, lastErrorMessage: 'Wrong response from the webhook: 404 Not Found' });
  });

  it('treats a result of the wrong shape as an invalid response', async () => {
    const result = await adapter.fetch({ token: TOKEN, method: 'sendMessage', chatId: 1, text: 'x' }, testContext({ fetchImpl: stubFetch({ status: 200, body: readFixture('telegram-true.json') }).fetchImpl }));
    expect(result.status).toBe('error');
    expect(result.errorCode).toBe('INVALID_RESPONSE');
    expect(result.data).toBeUndefined();
  });

  it('refuses a malformed token, an empty or oversized message and a plain-http webhook', () => {
    expect(adapter.canHandle({ token: 'not-a-token', method: 'getMe' })).toBe(false);
    expect(adapter.canHandle({ token: TOKEN, method: 'sendMessage', chatId: 1, text: '' })).toBe(false);
    expect(adapter.canHandle({ token: TOKEN, method: 'sendMessage', chatId: 1, text: 'x'.repeat(TELEGRAM_MESSAGE_MAX + 1) })).toBe(false);
    expect(adapter.canHandle({ token: TOKEN, method: 'setWebhook', url: 'http://heyresearch.xyz/x', secretToken: 's', allowedUpdates: [] })).toBe(false);
    expect(adapter.canHandle({ token: TOKEN, method: 'getMe' })).toBe(true);
  });
});

describe('inbound updates', () => {
  const parse = (name: string) => parseTelegramUpdate(JSON.parse(readFixture(name)) as unknown);

  it('parses a private /start, a group command, a button press and a block', () => {
    const start = parse('telegram-update-start.json');
    expect(start).toMatchObject({ ok: true, update: { updateId: 900000001, kind: 'message', message: { chat: { id: 123456789, type: 'private' }, text: '/start abcDEF0123456789abcDEF0123456789' } } });
    expect(parse('telegram-update-group-hey.json')).toMatchObject({ ok: true, update: { kind: 'message', message: { chat: { type: 'supergroup' } } } });
    expect(parse('telegram-update-callback.json')).toMatchObject({ ok: true, update: { kind: 'callback_query', callback: { data: 'bind:0f8e3c5a9b2d4e6f8a1b3c5d7e9f0a2b', from: { id: 123456789 } } } });
    expect(parse('telegram-update-blocked.json')).toMatchObject({ ok: true, update: { kind: 'my_chat_member', member: { new_chat_member: { status: 'kicked' } } } });
  });

  it('keeps nothing it does not need: no username or first name survives the parse', () => {
    const group = parse('telegram-update-group-hey.json');
    expect(JSON.stringify(group)).not.toContain('member_name');
    expect(JSON.stringify(group)).not.toContain('Robinhood Chain builders');
  });

  it('drops an update kind HEY does not answer, and refuses a malformed one', () => {
    expect(parse('telegram-update-edited.json')).toEqual({ ok: false, reason: 'unsupported', updateId: 900000005 });
    expect(parseTelegramUpdate({ message: {} })).toEqual({ ok: false, reason: 'malformed' });
    expect(parseTelegramUpdate({ update_id: 5, message: { chat: { id: 'x' } } })).toEqual({ ok: false, reason: 'malformed', updateId: 5 });
    expect(parseTelegramUpdate('nonsense')).toEqual({ ok: false, reason: 'malformed' });
  });
});

describe('the viral-loop surface (2026-10-05): Guest Mode, inline mode, groups', () => {
  const parse = (name: string) => parseTelegramUpdate(JSON.parse(readFixture(name)) as unknown);

  it('parses a Guest Mode summons with the message it replied to, and keeps no name or title', () => {
    const guest = parse('telegram-update-guest.json');
    expect(guest).toMatchObject({
      ok: true,
      update: {
        kind: 'guest_message',
        guest: { guest_query_id: 'AAHdF6IQAAAAAN0XohDhrOrc', text: '@HeyResearchBot research this', reply_to_message: { text: 'anyone looked at 0xa0a0000000000000000000000000000000000001 ?' } },
      },
    });
    const json = JSON.stringify(guest);
    for (const kept of ['reader_name', 'Reader', 'Some trading chat', 'Other']) expect(json).not.toContain(kept);
  });

  it('parses an inline query and a chosen inline result, without the reader’s name or language', () => {
    expect(parse('telegram-update-inline.json')).toEqual({
      ok: true,
      update: { updateId: 900000011, kind: 'inline_query', inline: { id: '4815162342', from: { id: 333333333, is_bot: false }, query: '$AOS', offset: '', chat_type: 'supergroup' } },
    });
    expect(parse('telegram-update-chosen-inline.json')).toMatchObject({ ok: true, update: { kind: 'chosen_inline_result', chosen: { result_id: 'p:agentos', query: '$AOS' } } });
    // Telegram's own ceilings: a query over 256 characters is not one Telegram sent.
    expect(parseTelegramUpdate({ update_id: 9, inline_query: { id: '1', from: { id: 1, is_bot: false }, query: 'x'.repeat(257), offset: '' } })).toEqual({ ok: false, reason: 'malformed', updateId: 9 });
  });

  it('parses the bot being added to a group, and a group becoming a supergroup', () => {
    expect(parse('telegram-update-group-added.json')).toMatchObject({ ok: true, update: { kind: 'my_chat_member', member: { chat: { type: 'supergroup' }, old_chat_member: { status: 'left' }, new_chat_member: { status: 'member' } } } });
    expect(parse('telegram-update-migrate.json')).toMatchObject({ ok: true, update: { kind: 'message', message: { chat: { id: -4012345678, type: 'group' }, migrate_to_chat_id: -1004012345678 } } });
  });

  it('reads a group’s admins as user ids only, and BotFather’s settings from getMe', async () => {
    const admins = await adapter.fetch({ token: TOKEN, method: 'getChatAdministrators', chatId: -1001234567890 }, testContext({ fetchImpl: stubFetch({ status: 200, body: readFixture('telegram-chat-administrators.json') }).fetchImpl }));
    expect(admins.data).toEqual({ method: 'getChatAdministrators', adminUserIds: [222222222, 555555555] });
    expect(JSON.stringify(admins.data)).not.toMatch(/first_name|"Admin"|"Mod"|can_delete/);
    const me = await adapter.fetch({ token: TOKEN, method: 'getMe' }, testContext({ fetchImpl: stubFetch({ status: 200, body: readFixture('telegram-get-me-guest.json') }).fetchImpl }));
    expect(me.data).toEqual({ method: 'getMe', id: 7000000001, username: 'HeyResearchBot', canJoinGroups: true, canReadAllGroupMessages: false, supportsInlineQueries: true, supportsGuestQueries: true });
    // An older getMe says nothing of Guest Mode: unknown stays absent, never false.
    const old = await adapter.fetch({ token: TOKEN, method: 'getMe' }, testContext({ fetchImpl: stubFetch({ status: 200, body: readFixture('telegram-get-me.json') }).fetchImpl }));
    expect(old.data).not.toHaveProperty('supportsGuestQueries');
  });

  it('sets the descriptions within Telegram’s ceilings', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('telegram-true.json') });
    const set = await adapter.fetch({ token: TOKEN, method: 'setMyShortDescription', shortDescription: 'Research any Robinhood Chain project.' }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(set.data).toEqual({ method: 'setMyShortDescription', done: true });
    expect(JSON.parse(String(stub.requests[0]!.init?.body))).toEqual({ short_description: 'Research any Robinhood Chain project.' });
    expect(adapter.canHandle({ token: TOKEN, method: 'setMyShortDescription', shortDescription: 'x'.repeat(121) })).toBe(false);
    expect(adapter.canHandle({ token: TOKEN, method: 'setMyDescription', description: 'x'.repeat(513) })).toBe(false);
  });
});
