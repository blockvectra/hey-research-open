import { z } from 'zod';

import { type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { performSourceFetch } from '../http/perform';

/**
 * The Telegram Bot API (2026-09-30, docs/TELEGRAM.md): the one outbound
 * channel of HEY's Telegram bot.
 *
 * HEY calls it from the worker only — the paced alert sender and the setup
 * script. The webhook never calls it: a command's reply rides back in the
 * webhook's own HTTP response (Telegram's "reply in the webhook response"),
 * so a lookup in a chat makes no provider request at all.
 *
 * The bot token is part of the URL path (`/bot<token>/<method>`), where the
 * shared client's query-string redaction cannot see it. Every result this
 * adapter returns has the token cut out of `sourceUrl` and `errorMessage`
 * before anyone can log it.
 *
 * `inboundUpdateSchema` validates what Telegram posts to the webhook. Only the
 * three update kinds HEY answers are parsed; everything else is dropped by the
 * receiver before any validation work.
 */
export const TELEGRAM_API_BASE = 'https://api.telegram.org';

/** Telegram's own ceiling on a message's text, in UTF-16 code units. */
export const TELEGRAM_MESSAGE_MAX = 4096;

export type TelegramInlineButton = { text: string; callback_data: string } | { text: string; url: string };
export type TelegramReplyMarkup = { inline_keyboard: TelegramInlineButton[][] };

type WithToken = { token: string };

export type TelegramBotCall = WithToken &
  (
    | { method: 'sendMessage'; chatId: number; text: string; replyMarkup?: TelegramReplyMarkup }
    | { method: 'editMessageText'; chatId: number; messageId: number; text: string; replyMarkup?: TelegramReplyMarkup }
    | { method: 'deleteMessage'; chatId: number; messageId: number }
    | { method: 'setWebhook'; url: string; secretToken: string; allowedUpdates: readonly string[]; maxConnections?: number }
    | { method: 'getWebhookInfo' }
    | { method: 'setMyCommands'; commands: readonly { command: string; description: string }[]; scope?: 'default' | 'all_private_chats' | 'all_group_chats' }
    | { method: 'getMe' }
  );

export type TelegramBotMethod = TelegramBotCall['method'];

export type TelegramBotResult =
  | { method: 'sendMessage' | 'editMessageText'; messageId: number; chatId: number }
  | { method: 'deleteMessage' | 'setWebhook' | 'setMyCommands'; done: true }
  | { method: 'getWebhookInfo'; url: string; pendingUpdates: number; lastErrorAt?: Date; lastErrorMessage?: string; allowedUpdates?: string[] }
  | { method: 'getMe'; id: number; username?: string };

const TOKEN_SHAPE = /^\d{6,}:[A-Za-z0-9_-]{20,}$/;

const messageResult = z.object({ message_id: z.number().int(), chat: z.object({ id: z.number().int() }) });
const doneResult = z.literal(true);
const webhookInfoResult = z.object({
  url: z.string(),
  pending_update_count: z.number().int().nonnegative(),
  last_error_date: z.number().int().optional(),
  last_error_message: z.string().optional(),
  allowed_updates: z.array(z.string()).optional(),
});
const meResult = z.object({ id: z.number().int(), is_bot: z.boolean(), username: z.string().optional() });

/** The envelope and the one result shape each method answers with: a result of the wrong shape is an invalid response, never data. */
function envelopeFor(method: TelegramBotMethod) {
  switch (method) {
    case 'sendMessage':
    case 'editMessageText':
      return z.object({ ok: z.literal(true), result: messageResult });
    case 'deleteMessage':
    case 'setWebhook':
    case 'setMyCommands':
      return z.object({ ok: z.literal(true), result: doneResult });
    case 'getWebhookInfo':
      return z.object({ ok: z.literal(true), result: webhookInfoResult });
    case 'getMe':
      return z.object({ ok: z.literal(true), result: meResult });
  }
}

/** The body of one call, in the Bot API's own field names. Links never unfurl: HEY's messages carry their own evidence link. */
function bodyOf(call: TelegramBotCall): Record<string, unknown> {
  switch (call.method) {
    case 'sendMessage':
    case 'editMessageText':
      return {
        chat_id: call.chatId,
        ...(call.method === 'editMessageText' ? { message_id: call.messageId } : {}),
        text: call.text,
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        ...(call.replyMarkup ? { reply_markup: call.replyMarkup } : {}),
      };
    case 'deleteMessage':
      return { chat_id: call.chatId, message_id: call.messageId };
    case 'setWebhook':
      return {
        url: call.url,
        secret_token: call.secretToken,
        allowed_updates: call.allowedUpdates,
        drop_pending_updates: false,
        ...(call.maxConnections ? { max_connections: call.maxConnections } : {}),
      };
    case 'setMyCommands':
      return { commands: call.commands, ...(call.scope ? { scope: { type: call.scope } } : {}) };
    case 'getWebhookInfo':
    case 'getMe':
      return {};
  }
}

function normalize(call: TelegramBotCall, result: unknown): TelegramBotResult {
  switch (call.method) {
    case 'sendMessage':
    case 'editMessageText': {
      const message = result as z.infer<typeof messageResult>;
      return { method: call.method, messageId: message.message_id, chatId: message.chat.id };
    }
    case 'deleteMessage':
    case 'setWebhook':
    case 'setMyCommands':
      return { method: call.method, done: true };
    case 'getWebhookInfo': {
      const info = result as z.infer<typeof webhookInfoResult>;
      return {
        method: 'getWebhookInfo',
        url: info.url,
        pendingUpdates: info.pending_update_count,
        ...(info.last_error_date ? { lastErrorAt: new Date(info.last_error_date * 1000) } : {}),
        ...(info.last_error_message ? { lastErrorMessage: info.last_error_message } : {}),
        ...(info.allowed_updates ? { allowedUpdates: info.allowed_updates } : {}),
      };
    }
    case 'getMe': {
      const me = result as z.infer<typeof meResult>;
      return { method: 'getMe', id: me.id, ...(me.username ? { username: me.username } : {}) };
    }
  }
}

/** The URL with the token cut out: what a log, an error or the console may show. */
export const redactedTelegramUrl = (method: TelegramBotMethod): string => `${TELEGRAM_API_BASE}/bot<redacted>/${method}`;

function scrub(text: string | undefined, token: string): string | undefined {
  if (text === undefined) return undefined;
  return token ? text.split(token).join('<redacted>') : text;
}

export function createTelegramBotAdapter(): SourceAdapter<TelegramBotCall, TelegramBotResult> {
  return {
    name: 'telegram',
    canHandle(call) {
      if (!TOKEN_SHAPE.test(call.token)) return false;
      if ((call.method === 'sendMessage' || call.method === 'editMessageText') && (call.text.length === 0 || call.text.length > TELEGRAM_MESSAGE_MAX)) return false;
      if (call.method === 'setWebhook' && !call.url.startsWith('https://')) return false;
      return true;
    },
    async fetch(call, ctx: SourceContext): Promise<SourceResult<TelegramBotResult>> {
      const result = await performSourceFetch(
        ctx,
        {
          url: `${TELEGRAM_API_BASE}/bot${call.token}/${call.method}`,
          method: 'POST',
          conditional: false,
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(bodyOf(call)),
          maxBytes: 256 * 1024,
        },
        {
          schema: envelopeFor(call.method) as z.ZodType<{ ok: true; result: unknown }>,
          parse: (body) => JSON.parse(body) as unknown,
          cacheTtlSeconds: 0,
          normalize: (raw) => normalize(call, raw.result),
        },
      );
      const message = scrub(result.errorMessage, call.token);
      return {
        ...result,
        sourceUrl: redactedTelegramUrl(call.method),
        ...(message === undefined ? {} : { errorMessage: message }),
      };
    },
  };
}

/* ------------------------------------------------------------ inbound */

const chat = z.object({ id: z.number().int(), type: z.enum(['private', 'group', 'supergroup', 'channel']) });
const user = z.object({ id: z.number().int(), is_bot: z.boolean() });

const inboundMessage = z.object({
  message_id: z.number().int(),
  from: user.optional(),
  chat,
  date: z.number().int(),
  // Telegram's own ceiling; anything longer is not a message Telegram sent.
  text: z.string().max(TELEGRAM_MESSAGE_MAX).optional(),
});

const inboundCallback = z.object({
  id: z.string().min(1).max(128),
  from: user,
  message: z.object({ message_id: z.number().int(), chat }).optional(),
  data: z.string().max(64).optional(),
});

const memberStatus = z.object({ status: z.string().max(32) });
const inboundMember = z.object({
  chat,
  from: user,
  date: z.number().int(),
  old_chat_member: memberStatus,
  new_chat_member: memberStatus,
});

/** The update kinds HEY answers. */
export const TELEGRAM_UPDATE_KINDS = ['message', 'callback_query', 'my_chat_member'] as const;
export type TelegramUpdateKind = (typeof TELEGRAM_UPDATE_KINDS)[number];

export type TelegramInboundMessage = z.infer<typeof inboundMessage>;
export type TelegramInboundCallback = z.infer<typeof inboundCallback>;
export type TelegramInboundMember = z.infer<typeof inboundMember>;
export type TelegramChat = z.infer<typeof chat>;

export type TelegramUpdate =
  | { updateId: number; kind: 'message'; message: TelegramInboundMessage }
  | { updateId: number; kind: 'callback_query'; callback: TelegramInboundCallback }
  | { updateId: number; kind: 'my_chat_member'; member: TelegramInboundMember };

export type TelegramUpdateParse = { ok: true; update: TelegramUpdate } | { ok: false; reason: 'malformed' | 'unsupported'; updateId?: number };

const updateHead = z.object({ update_id: z.number().int().nonnegative() }).passthrough();

/**
 * One webhook body, validated. An update of a kind HEY does not answer
 * (an edited message, a channel post, an inline query, a poll…) is
 * `unsupported` before any of its fields are read; anything that does not
 * match the Bot API's shape is `malformed`.
 */
export function parseTelegramUpdate(body: unknown): TelegramUpdateParse {
  const head = updateHead.safeParse(body);
  if (!head.success) return { ok: false, reason: 'malformed' };
  const updateId = head.data.update_id;
  const raw = head.data as Record<string, unknown>;
  const kind = TELEGRAM_UPDATE_KINDS.find((candidate) => candidate in raw);
  if (!kind) return { ok: false, reason: 'unsupported', updateId };
  if (kind === 'message') {
    const message = inboundMessage.safeParse(raw.message);
    return message.success ? { ok: true, update: { updateId, kind, message: message.data } } : { ok: false, reason: 'malformed', updateId };
  }
  if (kind === 'callback_query') {
    const callback = inboundCallback.safeParse(raw.callback_query);
    return callback.success ? { ok: true, update: { updateId, kind, callback: callback.data } } : { ok: false, reason: 'malformed', updateId };
  }
  const member = inboundMember.safeParse(raw.my_chat_member);
  return member.success ? { ok: true, update: { updateId, kind, member: member.data } } : { ok: false, reason: 'malformed', updateId };
}
