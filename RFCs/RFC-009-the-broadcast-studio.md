# RFC-009 — The Broadcast Studio

**Status: draft, for discussion**

An OBS-class streaming studio as a harness app — **sports-first, built for buAPI**. The
compositing engine runs on the **broadcaster's machine**: the FFmpeg scene builder Odion built
(and test-bedded inside buAPI while building the streaming service — it was always headed for a
local app) becomes this app's engine. buAPI's servers never composite a frame; they do what
distribution servers should do — ingest the finished program, fan it out, record it. The
integration is the product: stats, images and identity flow *down* from buAPI into the overlay;
the program streams *up*. Eventually, sponsorships ride the same rails.

Named **BUStudio** (`~/BUStudio`) — his call, 2026-09-18.

---

## 1 · What exists, and what is portable (read from the code)

| Piece | Where | Verdict for local use |
|---|---|---|
| **The scene compiler** | `buAPI/Media/Broadcasts/utils/ffmpegSceneBuilder.js` (2,294 lines) + `ffmpegSceneBuilder.md` (the spec) | **Pure.** Depends on `child_process` and its own `evaluateStringFunctions`. Moves whole. |
| String functions | `evaluateStringFunctions.js` — `countdown/stopwatch/count/clock/blink` compiled into FFmpeg expressions | Moves with the compiler. Sports-native already. |
| **Live text** | `updateLiveText.js` — ZMQ to `tcp://127.0.0.1:<zmqPort>`, text nodes by `id`, no scene rebuild | **Pure** (`zeromq` only). Moves. This is the scoreboard's write path. |
| Preview stills | `generateScreenshot.js` (fs/path/spawn) | Moves. |
| Launchers | `launchFFmpegScene.js`, `createFFmpegStage.js` | **Stay behind** — entangled with mediasoup (`createInternalProducers`, `resolveMediasoupTransport*`, `writeSceneSdp`, SFU constants). The studio writes its own thin local launcher (§4); the SFU-coupled path is buAPI's world. |
| RTMP ingest | `buAPI/Media/rtpm-server.js` — node-media-server, port 1935, app `live`, auth at `prePublish`, per-stream **recording and HLS already built** | The studio's upstream target. Nothing to build server-side for v1. |
| Sessions & viewers | `Media/Broadcasts` module — `startBroadcast/endBroadcast`, mediasoup SFU, admins/contributors | Unchanged. Distribution stays buAPI's. |
| Sports data | `Basketball/`, `gameEngine/` | The overlay's read path (§10). |

**The sceneSpec is the studio's document format.** Canvas → components → inputs with nesting,
auto-layout, animation (`scale/position/opacity/enable`), audio mix — a layout language that a
visual editor emits naturally. OBS builds scenes by dragging boxes; the box language is built.

## 2 · The stance

- **Local engine.** The app owns ffmpeg processes on the broadcaster's machine. Encoding cost
  lands on the broadcaster — the only way broadcasts scale without the server bill scaling.
- **buAPI distributes.** The studio pushes `rtmp://<host>:1935/live/<key>`; ingest already
  authenticates at `prePublish` and records + HLS-transcodes for free.
- **The builder moves, it does not fork.** No shared package, no dual dependency: buAPI was the
  workbench, the studio is the home. The copy in `Media/Broadcasts/utils` retires on Odion's
  schedule once the studio is standing (the SFU launchers keep only what they import).
- **Integration is the moat.** Identity, stats, profile imagery, sponsorship — the studio is a
  buAPI client first, a generic streamer second.

## 3 · The project — `~/BUStudio`

```
BUStudio/
  Studio/                  # the SystemLynx service (local process, own port ~3400)
    index.js               # createApp(server).startService({route:"studio/api", ...})
    Scenes/                # scene CRUD — specs on disk, a scene library
    Engine/                # the moved compiler + the local launcher
      ffmpegSceneBuilder.js
      evaluateStringFunctions.js
      updateLiveText.js
      generateScreenshot.js
      launch.js            # NEW: spawn/monitor/stop ffmpeg from builder output (§4)
    Live/                  # broadcast lifecycle: start/stop/status, ZMQ text, data bindings
    common/                # per the folder philosophy: shared across this service's modules
  app/                     # the face — React, built (src/ -> dist/ served by the process)
  components/              # travelling components (a program-monitor tile, later)
  scenes/                  # the user's scene documents
```

**The face is React, with a real build** — a scene editor (drag-resize canvas, nested
component trees, live panels) is state-heavy UI, and there is no plain-HTML rule for an app's
own page (only *travelling* components must be framework-free custom elements, and those may
bundle React internally). `npm run app` builds then serves, the harness-chrome pattern. React
also lines the studio up with **BUApp (React Native)**: the phone side of §9 — the camera
contribution client — lives there, and the two share component design where it pays (feed
health, go-live state, scoreboard widgets), web and native as two faces of one product.

The Blink pattern exactly: registered in `~/.autobot/apps.json` with a `start` entry
(`{cwd:"~/BUStudio", cmd:"npm run app"}`), capabilities `["systemlynx"]` (+ `files:read` if the
editor browses local media through the harness rather than its own service). The UI reaches its
own service via `Client.loadService(location.origin + "/studio/api")` — and reaches buAPI the
same way, because that is the whole point of `window.systemlynx`.

Moved code is CJS (`require`) inside an ESM-standard project: `Engine/` stays CJS via
`createRequire` or the files keep `.cjs` — port, don't rewrite; 2,294 working lines are not a
refactor opportunity.

## 4 · The local launcher (the one new engine piece)

`launchFFmpegScene`/`createFFmpegStage` stay behind because what they add over the compiler is
mediasoup plumbing. Locally the need is smaller and different:

- `launch(spec)` → `ffmpegSceneBuilder(spec)` → spawn from `args`, hold the child, surface
  stderr (parsed progress: fps, bitrate, drops) as service events.
- **Local capture inputs**: on macOS, camera and screen are avfoundation devices — an input
  `src` form for devices (`device:camera:0`, `device:screen:1`) that the launcher resolves to
  `-f avfoundation -i` with the right flags. The compiler itself doesn't change; device
  resolution is a launcher concern.
- **Program + preview from one process**: the scene outputs RTMP up *and* a local preview leg
  (tee muxer or a second scaled output) the UI can show — v0 preview can be
  `generateScreenshot` polling; real motion preview is the tee.
- Crash discipline: ffmpeg dies → event with the last stderr lines → UI shows it plainly;
  auto-relaunch is a setting, never a silent default.

## 5 · The studio UI (the OBS face)

- **Scene editor** — the visual editor over sceneSpec: drag components, nest them, bind inputs
  (camera, screen, files, images, remote streams), set padding/borders/animations. Emits the
  spec; the spec is the save file (`scenes/*.json` — documents, diffable, agent-editable).
- **The deck** — scenes as cards; CUT switches the live program (v1: relaunch into the same
  output; the gap is honest — a beat of black or a stinger. The switching ladder is §8).
- **Program monitor** — the preview leg (§4).
- **Live text panel** — every `text.id` in the live scene listed with its current value;
  editable by hand, or **bound** (§10).
- **Go live** — pick destination: buAPI (default — key from the session handshake), any RTMP
  URL (YouTube/Twitch — the builder already infers FLV for `rtmp://`), or local `.mp4` record.

## 6 · The buAPI handshake

Going live to buAPI is a session, not just a URL: the studio (as the signed-in user, via the
systemlynx client) calls `Media.Broadcasts.startBroadcast(...)` to open the session and derive
the stream key `prePublish` will accept, pushes RTMP, and `endBroadcast` closes it. Viewers,
HLS, recording — all existing buAPI behavior, untouched. What buAPI may eventually want is a
`streamKey`-issuing method if the current prePublish contract expects something the client
cannot derive — flagged as the one possible server-side touch, to be confirmed against
`methods.js` when building.

## 7 · Output modes & latency tiers

The engine is not RTMP-only — the compiler already infers the container from the output URL
(`rtmp://` → FLV, `srt://`/`udp://`/`rtp://` → MPEG-TS, `.mp4` → file), and ffmpeg's tee muxer
lets ONE encode feed several destinations at once. What "Go live" really chooses is a
**latency tier**, because the mode decides the experience:

| Tier | Path | Glass-to-glass | For |
|---|---|---|---|
| Broadcast | RTMP → ingest → HLS | 3–15s | big passive audiences; recording/VOD free; CDN-cheap |
| Contribution | SRT up, any distribution after | sub-second uplink | a reliable feed over the public internet |
| Real-time | RTP/SRT → mediasoup stage → WebRTC | <500ms | the interactive tier: see the chat, answer it live |

The real-time path is buAPI's OWN architecture brought to bear: `createFFmpegStage` +
`writeSceneSdp` already push a composited ffmpeg scene into mediasoup as RTP for browsers to
consume sub-second over WebRTC. (FFmpeg 8 also ships a native WHIP muxer, so standard WebRTC
ingest is possible without mediasoup in the middle.) The trade-off to design around: WebRTC
fan-out costs the server per viewer; HLS is nearly free at scale. So the **design target is
hybrid**: one encode, tee'd — the interactive tier rides WebRTC, the crowd rides HLS — surfaced
in the studio as a mode choice, not a config file.

## 8 · Sources & switching

**An input `src` is already network-agnostic** — the spec says "video, image, audio, or
stream." So remote sources are v1-free: another broadcast live on buAPI (HLS off the ingest,
port 8000), or any RTMP/SRT/RTP URL anywhere, drops into a scene as an input under the local
overlay. WebRTC-native sources (a producer living in mediasoup) are the one medium-cost kind:
someone must consume the producer into RTP and hand ffmpeg an SDP — the trick `writeSceneSdp`
and the transport resolvers already perform server-side. §9 turns that into a product.

**Two switching products, not one.** Today the backend pushes multiple scenes to the SFU and
the *client picks* which to show — N encodes, every viewer switching alone. That stays: it is a
real feature (multi-angle viewing). The studio adds the other product: **one program, cut
before distribution** — everyone sees the same cut at the same moment. Television, not
channel-surfing.

The switching ladder, built as we go:

1. **Relaunch-cut** — new spec, same output; an honest beat of black (or a stinger). Ships first.
2. **The live mega-scene** — every scene loaded in one graph; ffmpeg's ZMQ command filter (the
   same channel live text already rides) flips visibility/position at runtime. Real cuts, one
   process; the cost is every input staying decoded while off-air.
3. **The stage model** — per-scene processes feeding a switcher over local RTP —
   `createFFmpegStage`'s architecture, brought home. The endgame.

## 9 · The cloud-camera broadcast (the headline)

The strongest configuration has **zero local cameras**. Local sports, next level: every camera
is a phone on a sideline streaming up to buAPI; the desktop is the **director's console** — it
pulls the feeds down, cuts between them, lays the scoreboard over, and pushes one directed
program out. Three phones and a laptop in the stands is a multi-camera broadcast. The floor is
a phone, and the studio makes the floor look professional; better equipment only raises the
ceiling.

The ladder for getting phone feeds into the local scene:

1. **Day one:** phones stream RTMP to the existing 1935 ingest; the studio pulls each back as a
   stream input. Zero new plumbing, ~1–3s per camera.
2. **The right version:** phones do WebRTC to mediasoup as designed, and buAPI exposes each
   producer as a pullable **SRT relay** (a small per-producer relay — the plainTransport/RTP
   utils are most of it). SRT is built for contribution over the public internet:
   loss-tolerant, sub-second. This is the main server-side engineering item the vision adds
   (beside §6's possible streamKey method).
3. **Later:** true WebRTC consumption at the studio. The ladder means shipping never waits on it.

Physics to design around, neither a blocker: **bandwidth** — the director pulls N feeds and
pushes one program (four cameras ≈ 8–15 Mbps down, ~5 up), so feed health belongs in the UI —
and **latency skew** — feeds arriving seconds apart make a cut jump time, which is the reason
rung 2 exists (SRT shrinks the skew to negligible).

## 10 · Data into the overlay — the sports moat

The inversion that makes this not-OBS: **video up, data down.**

- The studio subscribes (systemlynx events) to game state — Basketball/gameEngine — and maps
  events onto ZMQ text ids: `score.home`, `score.away`, `clock`, `period`. The scoreboard keeps
  itself while the broadcaster watches the game, not the overlay.
- **Bindings live in the scene document**: a text node carries `bind: "basketball.game(<id>).homeScore"`
  (shape to be settled against the real event vocabulary) — so a scene is portable and
  re-bindable to next week's game.
- Profile imagery and stats are just inputs/texts whose sources are buAPI URLs — team logos,
  player headshots, season stat lines — fetched at scene load, cached locally.
- **Scorekeeping in the studio is optional.** buAPI owns the score — gameEngine already
  supports multiple scorekeepers per game (BUApp, the website). Usually a dedicated scorekeeper
  is on one of those surfaces and the studio just consumes the events; but the studio CAN keep
  score too, as one more gameEngine client — same calls, a desktop layout — for the solo
  operator directing and scoring at once. Either way the score lives in buAPI, never in the
  broadcast.
- **Sponsorships (later, designed-for now)**: an ad slot is a component with
  `animate.enable` windows — the machinery for "this lower-third shows 0:00–0:15 each rotation"
  already exists in the compiler. Sponsor content + schedules come down from buAPI like stats
  do; proof-of-play (slot actually rendered, minutes on screen) reports back up. That
  reporting is the only new server surface sponsorship needs at first.

## 11 · Events, jobs, agents

The Studio service emits: `launched`, `stats` (fps/bitrate), `died`, `live`, `ended`,
`textChanged`. Which means, for free by now-familiar mechanics: the jobs system can watch a
broadcast ("if fps drops under 24 for 30s, alert"), agents can drive scenes through service
methods (build a scene from a prompt; swap the halftime graphic), and specs/tests document the
service in SystemView.

## 12 · Implementation order

1. **Project skeleton** — `~/BUStudio` service+app on 3400, registry entry, harness tab opens.
2. **Engine moves** — compiler + text/screenshot utils in `Engine/`, `launch.js` with
   file/image inputs only; a hardcoded test scene renders to `.mp4`. (The builder's own test
   fixtures — game film, logos — come along as `Engine/tests/`.)
3. **Local capture** — avfoundation device inputs; camera+screen composite proves the studio.
4. **Scene editor v1** — components/inputs/geometry on a canvas; save/load `scenes/*.json`;
   the deck with relaunch-cut.
5. **Go live** — RTMP out to buAPI ingest end-to-end (handshake per §6); program monitor.
6. **Live text** — ZMQ panel; then **game bindings** (§7): the self-updating scoreboard is
   the demo that matters.
7. **Profile/stat inputs**, then the sponsorship slot machinery.
8. **Cloud cameras** — phone feeds as scene inputs: RTMP pull-back first, then the per-producer
   SRT relays on buAPI; the Go-live latency modes (§7) land here with the hybrid tee.

## 13 · Open questions

- **ffmpeg binary**: assume system ffmpeg v1 (his machine has it — `/usr/local/bin/ffmpeg` is
  even hardcoded in rtpm-server) vs. bundling per-platform binaries when this reaches other
  broadcasters' machines. Bundle eventually; not first.
- **Remote guests** — a co-host's camera entering the local scene means the mediasoup path
  comes back (consume remote producer → local RTP input via SDP, which `writeSceneSdp` already
  knows how to describe). Explicitly out of v1.
- **Binding vocabulary** — the `bind:` shape needs writing against gameEngine's actual event
  names before §7 lands.
- **When buAPI's utils copy retires** — his call, after the studio stands.
