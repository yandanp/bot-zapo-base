# bot-zapo

A WhatsApp bot built on [zapo-js](https://github.com/vinikjkkj/zapo) (a high-performance,
TypeScript-compiled implementation of the WhatsApp Web protocol).

This project is **plain JavaScript + ESM** (`"type": "module"`), no TypeScript build step.

## What's inside

| Concern | File | Notes |
|---|---|---|
| **create socket** | `socket.js` | Builds a `WaClient` over the store and calls `client.connect()`. zapo owns the WebSocket, noise handshake, keep-alive and resume internally. |
| **upsert** | `store.js` | SQLite-backed persistent store. Credentials, Signal keys, contacts, threads and the message archive are upserted (`INSERT ... ON CONFLICT DO UPDATE`) so a restart reuses the existing pairing. |
| **reconnect** | `reconnect.js` | Supervisor that listens for `connection: { status: 'close' }` and calls `client.connect()` again, skipping logouts and backing off between attempts. |
| **plugin: ping** | `plugins/ping.js` | Replies `pong` to `ping` / `!ping`. |
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

Send the bot `ping` (or `!ping`) and it replies `pong 🏓`.

## Config

Everything is driven by `.env` (see `.env.example`):

| Var | Default | Meaning |
|---|---|---|
| `SESSION_ID` | `default` | Session id (multi-session support) |
| `AUTH_PATH` | `.auth/state.sqlite` | SQLite auth/state file |
| `LOG_LEVEL` | `info` | `trace`/`debug`/`info`/`warn`/`error` |
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
`src/reconnect.js` does. When `isLogout` is true the supervisor deliberately does
*not* retry, because the credential was unlinked and reconnecting would fail-loop.

## Requirements

- Node.js **>= 20.9.0**
- zapo-js is published pre-built (CJS + ESM) to npm, so no TypeScript toolchain is
  needed in this project.

## License

MIT
