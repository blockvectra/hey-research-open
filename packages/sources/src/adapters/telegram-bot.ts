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
 * `parseTelegramUpdate` validates what Telegram posts to the webhook. Only the
 * update kinds HEY answers are parsed (2026-10-05: also Guest Mode's
 * `guest_message`, `inline_query` and `chosen_inline_result`); everything else
 * is dropped by the receiver before any validation work.
 */
export const TELEGRAM_API_BASE = 'https://api.telegram.org';

/** Telegram's own ceiling on a message's text, in UTF-16 code units. */
export const TELEGRAM_MESSAGE_MAX = 4096;

/**
 * A button as HEY draws it: a callback HEY validates, a link, or (2026-10-05)
 * Telegram's own "switch to inline" — pressing it puts `@<bot> <query>` back in
 * the reader's input field (Bot API `switch_inline_query_current_chat`).
 */
/**
 * And (2026-10-06, the Mini App) a `web_app` button: "Available only in private
 * chats between a user and the bot" (Bot API `InlineKeyboardButton.web_app`),
 * opening the HTTPS Web App it names. Groups, inline cards and Guest Mode use
 * the Mini App's t.me direct link as an ordinary `url` button instead.
 */
export type TelegramInlineButton =
  | { text: string; callback_data: string }
  | { text: string; url: string }
  | { text: string; switch_inline_query_current_chat: string }
  | { text: string; web_app: { url: string } };
export type TelegramReplyMarkup = { inline_keyboard: TelegramInlineButton[][] };

type WithToken = { token: string };

export type TelegramBotCall = WithToken &
  (
    /** `replyToMessageId` (2026-10-09): sent as a reply to that message, and still sent if it was deleted (`allow_sending_without_reply`). */
    | { method: 'sendMessage'; chatId: number; text: string; replyMarkup?: TelegramReplyMarkup; replyToMessageId?: number }
    | { method: 'editMessageText'; chatId: number; messageId: number; text: string; replyMarkup?: TelegramReplyMarkup }
    | { method: 'deleteMessage'; chatId: number; messageId: number }
    | { method: 'setWebhook'; url: string; secretToken: string; allowedUpdates: readonly string[]; maxConnections?: number }
    | { method: 'getWebhookInfo' }
    | { method: 'setMyCommands'; commands: readonly { command: string; description: string }[]; scope?: TelegramCommandScope }
    | { method: 'setMyDescription'; description: string }
    | { method: 'setMyShortDescription'; shortDescription: string }
    /** The admins of a group the bot is in (2026-10-05): who may change the group's watch. Read at change time, never stored. */
    | { method: 'getChatAdministrators'; chatId: number }
    | { method: 'getMe' }
    /**
     * The bot's menu button in private chats (2026-10-06): `MenuButtonWebApp` opens the Mini App by
     * its HTTPS URL; `MenuButtonCommands` opens the bot's command list (2026-10-07: what HEY sets,
     * so the commands stay one press away); `MenuButtonDefault` hands the button back to Telegram's
     * default. Without a `chat_id` it is the default for every private chat.
     */
    | { method: 'setChatMenuButton'; menuButton: TelegramMenuButton }
    | { method: 'getChatMenuButton' }
  );

/** The menu buttons HEY sets (Bot API `MenuButtonWebApp`, `MenuButtonCommands`, `MenuButtonDefault`). */
export type TelegramMenuButton = { type: 'web_app'; text: string; url: string } | { type: 'commands' } | { type: 'default' };

/** The command-menu scopes HEY sets (Bot API `BotCommandScope`): everyone, private chats, every group, and every group's admins. */
export type TelegramCommandScope = 'default' | 'all_private_chats' | 'all_group_chats' | 'all_chat_administrators';

export type TelegramBotMethod = TelegramBotCall['method'];

export type TelegramBotResult =
  | { method: 'sendMessage' | 'editMessageText'; messageId: number; chatId: number }
  | { method: 'deleteMessage' | 'setWebhook' | 'setMyCommands' | 'setMyDescription' | 'setMyShortDescription' | 'setChatMenuButton'; done: true }
  /** What the menu button is now: its type and, for a Web App, its text and URL (both HEY's own). */
  | { method: 'getChatMenuButton'; type: string; text?: string; url?: string }
  | { method: 'getWebhookInfo'; url: string; pendingUpdates: number; lastErrorAt?: Date; lastErrorMessage?: string; allowedUpdates?: string[] }
  /** The user ids of the group's creator and administrators, and nothing else about them. */
  | { method: 'getChatAdministrators'; adminUserIds: number[] }
  | {
      method: 'getMe';
      id: number;
      username?: string;
      /** What BotFather is set to (2026-10-05): each is reported only when Telegram says it, never assumed. */
      canJoinGroups?: boolean;
      /** True means group privacy is OFF. HEY wants it ON (false). */
      canReadAllGroupMessages?: boolean;
      supportsInlineQueries?: boolean;
      /** Bot API 10.0 Guest Mode, switched on in BotFather's Mini App. */
      supportsGuestQueries?: boolean;
    };

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
const meResult = z.object({
  id: z.number().int(),
  is_bot: z.boolean(),
  username: z.string().optional(),
  can_join_groups: z.boolean().optional(),
  can_read_all_group_messages: z.boolean().optional(),
  supports_inline_queries: z.boolean().optional(),
  supports_guest_queries: z.boolean().optional(),
});
/** A MenuButton: its type, and a Web App's text and URL. */
const menuButtonResult = z.object({
  type: z.string().max(32),
  text: z.string().max(256).optional(),
  web_app: z.object({ url: z.string().max(2048) }).optional(),
});
/** A ChatMember: only its status and its user's id are read. */
const adminsResult = z.array(z.object({ status: z.string().max(32), user: z.object({ id: z.number().int(), is_bot: z.boolean() }) })).max(500);

/** The envelope and the one result shape each method answers with: a result of the wrong shape is an invalid response, never data. */
function envelopeFor(method: TelegramBotMethod) {
  switch (method) {
    case 'sendMessage':
    case 'editMessageText':
      return z.object({ ok: z.literal(true), result: messageResult });
    case 'deleteMessage':
    case 'setWebhook':
    case 'setMyCommands':
    case 'setMyDescription':
    case 'setMyShortDescription':
    case 'setChatMenuButton':
      return z.object({ ok: z.literal(true), result: doneResult });
    case 'getChatMenuButton':
      return z.object({ ok: z.literal(true), result: menuButtonResult });
    case 'getChatAdministrators':
      return z.object({ ok: z.literal(true), result: adminsResult });
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
        ...(call.method === 'sendMessage' && call.replyToMessageId !== undefined ? { reply_parameters: { message_id: call.replyToMessageId, allow_sending_without_reply: true } } : {}),
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
    case 'setMyDescription':
      return { description: call.description };
    case 'setMyShortDescription':
      return { short_description: call.shortDescription };
    case 'getChatAdministrators':
      return { chat_id: call.chatId };
    case 'setChatMenuButton':
      return { menu_button: call.menuButton.type === 'web_app' ? { type: 'web_app', text: call.menuButton.text, web_app: { url: call.menuButton.url } } : { type: call.menuButton.type } };
    case 'getWebhookInfo':
    case 'getMe':
    case 'getChatMenuButton':
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
    case 'setMyDescription':
    case 'setMyShortDescription':
    case 'setChatMenuButton':
      return { method: call.method, done: true };
    case 'getChatMenuButton': {
      const button = result as z.infer<typeof menuButtonResult>;
      return { method: 'getChatMenuButton', type: button.type, ...(button.text ? { text: button.text } : {}), ...(button.web_app ? { url: button.web_app.url } : {}) };
    }
    case 'getChatAdministrators': {
      const members = result as z.infer<typeof adminsResult>;
      // The creator and the administrators; a restricted or left member is never one, whatever else it says.
      return { method: 'getChatAdministrators', adminUserIds: members.filter((member) => member.status === 'creator' || member.status === 'administrator').map((member) => member.user.id) };
    }
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
      return {
        method: 'getMe',
        id: me.id,
        ...(me.username ? { username: me.username } : {}),
        ...(me.can_join_groups === undefined ? {} : { canJoinGroups: me.can_join_groups }),
        ...(me.can_read_all_group_messages === undefined ? {} : { canReadAllGroupMessages: me.can_read_all_group_messages }),
        ...(me.supports_inline_queries === undefined ? {} : { supportsInlineQueries: me.supports_inline_queries }),
        ...(me.supports_guest_queries === undefined ? {} : { supportsGuestQueries: me.supports_guest_queries }),
      };
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
      // Telegram opens only an HTTPS Web App; a menu button's text is one short label.
      if (call.method === 'setChatMenuButton' && call.menuButton.type === 'web_app' && (!call.menuButton.url.startsWith('https://') || call.menuButton.text.length === 0 || call.menuButton.text.length > 64)) return false;
      // Telegram's own ceilings (setMyDescription 512, setMyShortDescription 120).
      if (call.method === 'setMyDescription' && call.description.length > 512) return false;
      if (call.method === 'setMyShortDescription' && call.shortDescription.length > 120) return false;
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

/** Telegram's ceiling on a caption. */
const CAPTION_MAX = 1024;

/**
 * The message a reader replied to (2026-10-05): read only for an explicit
 * request that replies to it (`/hey` as a reply, a Guest Mode mention as a
 * reply), and only its text or caption. Never stored.
 */
const repliedMessage = z.object({
  message_id: z.number().int(),
  from: user.optional(),
  text: z.string().max(TELEGRAM_MESSAGE_MAX).optional(),
  caption: z.string().max(CAPTION_MAX).optional(),
});

const inboundMessage = z.object({
  message_id: z.number().int(),
  from: user.optional(),
  /** Set when an anonymous group admin speaks as the group itself (`sender_chat.id === chat.id`), or a channel posts in its linked group. */
  sender_chat: chat.optional(),
  chat,
  date: z.number().int(),
  // Telegram's own ceiling; anything longer is not a message Telegram sent.
  text: z.string().max(TELEGRAM_MESSAGE_MAX).optional(),
  reply_to_message: repliedMessage.optional(),
  /** A message sent through a bot's inline mode, HEY's own cards included: never a request to HEY. */
  via_bot: user.optional(),
  /** Group → supergroup migration (service messages): the chat's id changes, and HEY's group record follows it. */
  migrate_to_chat_id: z.number().int().optional(),
  migrate_from_chat_id: z.number().int().optional(),
});

/**
 * A Guest Mode summons (Bot API 10.0, 2026-05-08): a reader mentioned the bot
 * in a chat it is not a member of, or replied to one of its guest answers.
 * `guest_query_id` is what `answerGuestQuery` answers; the chat's id is
 * Telegram's for that summons and "may not coincide with other existing bot
 * chats sharing the same identifier", so HEY never treats it as a group it is in.
 */
const inboundGuest = inboundMessage.extend({ guest_query_id: z.string().min(1).max(256) });

const inboundCallback = z.object({
  id: z.string().min(1).max(128),
  from: user,
  message: z.object({ message_id: z.number().int(), chat }).optional(),
  /** A press on a message sent through inline mode or as a guest answer: it carries no chat. */
  inline_message_id: z.string().max(256).optional(),
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

/** An inline query (`@<bot> <query>` typed in any chat). The text is at most 256 characters, Telegram's own ceiling. */
const inboundInline = z.object({
  id: z.string().min(1).max(256),
  from: user,
  query: z.string().max(256),
  offset: z.string().max(64),
  chat_type: z.enum(['sender', 'private', 'group', 'supergroup', 'channel']).optional(),
});

/** One inline result a reader picked and sent (only while BotFather's inline feedback is on). */
const inboundChosen = z.object({
  result_id: z.string().min(1).max(64),
  from: user,
  query: z.string().max(256),
  inline_message_id: z.string().max(256).optional(),
});

/** The update kinds HEY answers. */
export const TELEGRAM_UPDATE_KINDS = ['message', 'callback_query', 'my_chat_member', 'guest_message', 'inline_query', 'chosen_inline_result'] as const;
export type TelegramUpdateKind = (typeof TELEGRAM_UPDATE_KINDS)[number];

export type TelegramInboundMessage = z.infer<typeof inboundMessage>;
export type TelegramInboundGuest = z.infer<typeof inboundGuest>;
export type TelegramInboundCallback = z.infer<typeof inboundCallback>;
export type TelegramInboundMember = z.infer<typeof inboundMember>;
export type TelegramInboundInline = z.infer<typeof inboundInline>;
export type TelegramInboundChosen = z.infer<typeof inboundChosen>;
export type TelegramChat = z.infer<typeof chat>;

export type TelegramUpdate =
  | { updateId: number; kind: 'message'; message: TelegramInboundMessage }
  | { updateId: number; kind: 'callback_query'; callback: TelegramInboundCallback }
  | { updateId: number; kind: 'my_chat_member'; member: TelegramInboundMember }
  | { updateId: number; kind: 'guest_message'; guest: TelegramInboundGuest }
  | { updateId: number; kind: 'inline_query'; inline: TelegramInboundInline }
  | { updateId: number; kind: 'chosen_inline_result'; chosen: TelegramInboundChosen };

export type TelegramUpdateParse = { ok: true; update: TelegramUpdate } | { ok: false; reason: 'malformed' | 'unsupported'; updateId?: number };

const updateHead = z.object({ update_id: z.number().int().nonnegative() }).passthrough();

/**
 * One webhook body, validated. An update of a kind HEY does not answer
 * (an edited message, a channel post, a poll…) is `unsupported` before any of
 * its fields are read; anything that does not match the Bot API's shape is
 * `malformed`.
 */
export function parseTelegramUpdate(body: unknown): TelegramUpdateParse {
  const head = updateHead.safeParse(body);
  if (!head.success) return { ok: false, reason: 'malformed' };
  const updateId = head.data.update_id;
  const raw = head.data as Record<string, unknown>;
  const kind = TELEGRAM_UPDATE_KINDS.find((candidate) => candidate in raw);
  if (!kind) return { ok: false, reason: 'unsupported', updateId };
  const bad: TelegramUpdateParse = { ok: false, reason: 'malformed', updateId };
  switch (kind) {
    case 'message': {
      const message = inboundMessage.safeParse(raw.message);
      return message.success ? { ok: true, update: { updateId, kind, message: message.data } } : bad;
    }
    case 'callback_query': {
      const callback = inboundCallback.safeParse(raw.callback_query);
      return callback.success ? { ok: true, update: { updateId, kind, callback: callback.data } } : bad;
    }
    case 'my_chat_member': {
      const member = inboundMember.safeParse(raw.my_chat_member);
      return member.success ? { ok: true, update: { updateId, kind, member: member.data } } : bad;
    }
    case 'guest_message': {
      const guest = inboundGuest.safeParse(raw.guest_message);
      return guest.success ? { ok: true, update: { updateId, kind, guest: guest.data } } : bad;
    }
    case 'inline_query': {
      const inline = inboundInline.safeParse(raw.inline_query);
      return inline.success ? { ok: true, update: { updateId, kind, inline: inline.data } } : bad;
    }
    case 'chosen_inline_result': {
      const chosen = inboundChosen.safeParse(raw.chosen_inline_result);
      return chosen.success ? { ok: true, update: { updateId, kind, chosen: chosen.data } } : bad;
    }
  }
}
