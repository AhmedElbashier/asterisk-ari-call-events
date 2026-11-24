# Asterisk ARI Call Events + IVR

[![CI](https://github.com/AhmedElbashier/asterisk-ari-call-events/actions/workflows/ci.yml/badge.svg)](https://github.com/AhmedElbashier/asterisk-ari-call-events/actions/workflows/ci.yml)
![Node 22](https://img.shields.io/badge/node-22-339933)
![License: MIT](https://img.shields.io/badge/license-MIT-green)

A small **TypeScript / Node.js** service that plugs into **Asterisk** through the
**Asterisk REST Interface (ARI)**. It:

1. receives live **call events** (`StasisStart`, `ChannelDtmfReceived`, `ChannelStateChange`, `ChannelHangupRequest`, `StasisEnd`),
2. runs a **config-driven IVR** (welcome → menu → DTMF routing, invalid-input and timeout retries, operator fallback, business hours by timezone),
3. hands the caller back to the dialplan (queue / extension) with `continue`,
4. exposes **live call state** over a small HTTP API and a **Server-Sent Events** stream for dashboards / CRMs.

It has a **mock mode**: a fake ARI client plus a call simulator, so the service runs, demos and
is fully tested **without** a PBX. A `docker-compose.yml` brings up a real Asterisk 22 with ARI for
end-to-end testing with a softphone.

## Architecture

```
 Softphone / SIP trunk
        │  SIP
        ▼
 ┌───────────────┐   ARI WebSocket (events)     ┌──────────────────────────────┐
 │   Asterisk    │ ───────────────────────────► │  call-events service (Node)  │
 │ Stasis(app)   │ ◄─────────────────────────── │  HttpAriClient / MockAri     │
 │  dialplan     │   ARI REST (answer, play,    │  IvrEngine (state machine)   │
 └───────────────┘   continue, hangup)          │  CallStore ──► /calls /stats │
                                                │                └─► /events SSE│
                                                └──────────────────────────────┘
```

```
src/
  ari/types.ts            ARI event + command types (subset)
  ari/http-ari-client.ts  real client: fetch + ws, basic auth, auto-reconnect
  ari/mock-ari-client.ts  in-memory Asterisk stand-in used by tests and mock mode
  ivr/config.ts           JSON IVR config, validation, business-hours check (IANA timezone)
  ivr/ivr-engine.ts       per-call state machine
  call-store.ts           live/recent calls + change events
  http/server.ts          GET /health /calls /calls/:id /stats /events (SSE)
  simulator.ts            sample calls for mock mode
config/ivr.example.json   menu: 1 Sales, 2 Support, 0 Operator, 9 Repeat
asterisk/conf/            http.conf, ari.conf, pjsip.conf, extensions.conf for the lab
```

### IVR flow

```
StasisStart ─► answer ─► closed? ──yes──► play closed message ─► hangup
                           │no
                           ▼
                 play welcome + menu ─► wait for DTMF (timeout)
                     ▲          │ valid digit ─► route (continue to queue/extension)
                     │          │ 9          ─► repeat menu
                     └─ retry ◄─┤ invalid / timeout (retries left)
                                └ retries exhausted ─► fallback (operator)
```

## Run it

### 1. Mock mode (no Asterisk needed)

```bash
npm install
npm run build
ARI_MODE=mock npm start          # simulator places a sample call every 5 s
curl localhost:3001/stats
curl localhost:3001/calls
curl -N localhost:3001/events    # live stream of call changes
```

### 2. Against a real Asterisk (Docker, Linux host)

```bash
docker compose up --build
```

Register a softphone (Zoiper, Linphone, MicroSIP) to `127.0.0.1:5060` as user `6001` /
password `local-dev-6001`, dial **100**, and press 1 / 2 / 0. Watch `curl -N localhost:3001/events`.

> The credentials in `asterisk/conf/` are for a local lab only. Change them, restrict
> `allowed_origins`, and put ARI behind TLS before using this anywhere else.

To point at an existing PBX instead, enable ARI there and set
`ARI_URL`, `ARI_USERNAME`, `ARI_PASSWORD`, `ARI_APP`, then send calls to `Stasis(<ARI_APP>)` in your dialplan.

### Configuration

| Variable | Default | |
|---|---|---|
| `ARI_MODE` | `ari` | `mock` uses the fake client + simulator |
| `ARI_URL` | `http://localhost:8088` | Asterisk HTTP server |
| `ARI_USERNAME` / `ARI_PASSWORD` | `ari` / empty | from `ari.conf` |
| `ARI_APP` | `call-events` | Stasis application name |
| `PORT` | `3001` | HTTP API port |
| `IVR_CONFIG` | `config/ivr.example.json` | menu, prompts, retries, business hours |
| `SIM_INTERVAL_MS` | `5000` | mock mode call rate |
| `SIM_RESPECT_HOURS` | `false` | mock mode ignores business hours unless `true` |

Prompts use Asterisk's stock sounds as placeholders; replace them with your own recordings
(`sound:custom/welcome`, etc.).

## Tests

```bash
npm test
```

17 tests, all against the mock ARI client (no PBX required):
routing by digit, invalid input then success, repeat key, silence → retries → operator fallback,
after-hours message + hangup, caller hang-up mid-IVR (timer cleanup, no late routing),
concurrent calls, config validation, timezone-aware business hours, exact ARI REST URLs + auth
header, error handling, HTTP API and SSE stream.

## Ideas to extend

- Push `CallStore` changes to a CRM webhook (screen-pop) or a WebSocket dashboard.
- Bridge to agents directly with ARI bridges instead of dialplan queues.
- Persist call records to PostgreSQL; add Prometheus metrics.

## License

MIT © Ahmed Elbashier
