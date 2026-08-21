# bot-zapo

A WhatsApp bot built on [zapo-js](https://github.com/vinikjkkj/zapo) (a high-performance,
TypeScript-compiled implementation of the WhatsApp Web protocol).

This project is **plain JavaScript + ESM** (`"type": "module"`), no TypeScript build step.

## What's inside

| Concern | File | Notes |
|---|---|---|
| **create socket** | `lib/socket.js` | Builds a `WaClient` over the store and calls `client.connect()`. zapo owns the WebSocket, noise handshake, keep-alive and resume internally. |
| **upsert** | `lib/store.js` | SQLite-backed persistent store. Credentials, Signal keys, contacts and threads are upserted (`INSERT ... ON CONFLICT DO UPDATE`) so a restart reuses the existing pairing. Messages are real-time only by default (`STORE_MESSAGES=none`); set `STORE_MESSAGES=sqlite` to archive them. |
| **reconnect** | `lib/reconnect.js` | Supervisor that listens for `connection: { status: 'close' }` and calls `client.connect()` again, skipping logouts and backing off between attempts. |
| **plugin: ping** | `plugins/ping.js` | Replies `pong` to `ping` / prefixed `ping`, quoting the incoming command. |
| **plugin loader** | `plugins/loader.js` | Auto-loads every `.js` file in `plugins/`. |

## Project structure

```
bot-zapo/
├── package.json          # type: module, dependencies
├── .env.example          # copy to .env and edit
├── index.js              # entry point
├── README.md
├── .gitignore
├── lib/
│   ├── logger.js         # pino / console logger
│   ├── socket.js         # create socket (WaClient + connect)
│   ├── store.js          # upsert layer (SQLite store)
│   └── reconnect.js      # reconnect supervisor
├── plugins/
│   ├── loader.js         # auto plugin loader
│   └── ping.js           # the ping plugin
└── .auth/                # (gitignored) SQLite auth / session state
```

## Install

```bash
npm install
```

Optional extras you can add later:

```bash
npm install @zapo-js/media-utils sharp     # media thumbnails / voice notes
npm install @zapo-js/native                # Rust crypto accelerator (auto-detected)
```

## Run

```bash
cp .env.example .env   # once, then edit as needed
npm start
```

On the first run the bot prints a **QR code** in the terminal (rendered as ASCII via
`qrcode-terminal`) — scan it with WhatsApp → *Linked devices*. Credentials are
persisted to `.auth/state.sqlite`, so subsequent runs reconnect automatically
without a new QR scan.

> **Tip:** if you can't scan a QR, set `PAIRING_PHONE=<phone number>` in `.env`
> to use the 8-digit pairing-code flow instead.

Send the bot `ping` (or the configured prefix followed by `ping`, such as
`!ping`) and it replies `pong 🏓` while quoting the incoming command.

## Message storage and quote replies

Message archiving is disabled by default:

```env
STORE_MESSAGES=none
```

Incoming and outgoing messages are still processed in real time, but their
contents are not archived in SQLite. The ping plugin can still quote/reply to
the command because it passes the live incoming event directly:

```js
await client.message.send(
  to,
  { type: 'text', text: 'pong 🏓' },
  { quote: event }
)
```

Set `STORE_MESSAGES=sqlite` only when archived messages are needed for later
lookup, including quoting messages that are no longer available in memory or
after a restart. Quote replies are not globally automatic: each plugin must
explicitly pass `{ quote: event }` when sending its response.

## Private messaging base layer

The `lib/` folder ships a generic, game-agnostic foundation for sending private
messages. This is what a future game plugin (cards, secrets, DMs, tokens) will
build on top of — the base itself contains no game logic.

```
lib/
├── registry.js          # global, persistent user registry (SQLite)
├── private-message.js   # send to one or many private chats, safely
└── group-players.js     # resolve registered members of a group
```

Bot-owned data lives in `.data/bot.sqlite` (override via `BOT_DB`), which is a
separate database from zapo's auth store (`.auth/state.sqlite`). Registration is
global: register once, and the user is considered registered everywhere.

Typical usage inside a plugin:

```js
import { registerFromMessage, findByJid } from '../lib/registry.js'
import { sendPrivateMessage, sendPrivateBatch } from '../lib/private-message.js'

// 1. Register the sender (call once, e.g. in a register command handler)
registerFromMessage(event)

// 2. Send a private DM to a single user
await sendPrivateMessage({
  client,
  to: user.jid,
  content: { type: 'text', text: 'Here is your secret message.' }
})

// 3. Fan out to a group of registered players (throttled, per-user results)
const { sent, failed } = await sendPrivateBatch({
  client,
  recipients: players.map((p) => ({
    jid: p.privateJid,
    content: { type: 'text', text: 'Your cards: …' }
  }))
})
```

The `sendPrivateMessage` guard refuses to send to a group JID by accident, and
`sendPrivateBatch` returns `{ sent, failed }` so callers can react per recipient.

Run the base validation suite:

```bash
node tests/validate-private-base.js
```

## Config

Everything is driven by `.env` (see `.env.example`):

| Var | Default | Meaning |
|---|---|---|
| `SESSION_ID` | `default` | Session id (multi-session support) |
| `AUTH_PATH` | `.auth/state.sqlite` | SQLite auth/state file |
| `BOT_DB` | `.data/bot.sqlite` | Bot database (player registry) path |
| `STORE_MESSAGES` | `none` | `none` = real-time only, `sqlite` = archive all messages |
| `LOG_LEVEL` | `info` | `trace`/`debug`/`info`/`warn`/`error` |
| `PREFIX` | `!` | Command prefix, for example `!ping`, `.ping`, or `#ping` |
| `RECONNECT_DELAY_MS` | `2000` | Delay between reconnect attempts |
| `RECONNECT_MAX_ATTEMPTS` | `0` | `0` = retry forever |
| `DEVICE_BROWSER` | `Chrome` | Cosmetic device name |
| `DEVICE_OS` | `Windows` | Cosmetic OS name |
| `PAIRING_PHONE` | *(empty)* | Phone number for the pairing-code flow; leave empty to use QR |

## Adding a new plugin

Drop a new file into `plugins/`, default-export a function, and it loads
automatically on startup:

```js
// plugins/hello.js
export default function helloPlugin({ client, logger, config }) {
  client.on('message', async (event) => {
    if (event.key?.fromMe) return
    const text = event.message?.conversation?.trim().toLowerCase()
    if (text === 'hello') {
      await client.message.send(event.key.remoteJid, { type: 'text', text: 'hai 👋' })
    }
  })
}
```

## Notes on reconnect semantics

zapo-js does **not** auto-reconnect. It emits `connection: { status: 'close' }`
and expects you to call `client.connect()` again — which is exactly what
`lib/reconnect.js` does. When `isLogout` is true the supervisor deliberately does
*not* retry, because the credential was unlinked and reconnecting would fail-loop.

## Requirements

- Node.js **>= 20.9.0**
- zapo-js is published pre-built (CJS + ESM) to npm, so no TypeScript toolchain is
  needed in this project.

## License

MIT
