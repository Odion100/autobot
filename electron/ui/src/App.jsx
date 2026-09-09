import React, { useEffect, useState } from "react";
import sendIcon from "./assets/send.png";
import { marked } from "marked";

// Chat markdown, SystemView-style: escape raw HTML, then let marked draw the rest.
function MdHtml({ text }) {
  const html = React.useMemo(() => {
    const esc = String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return marked.parse(esc, { breaks: true, async: false });
  }, [text]);
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

// ```bars fences render as REAL bars — the meter language, not console art (his
// call: "you're in the HTML browser"). One row per line: label|percent|note.
// Same weather as everything else: green, amber past 75, red past 90.
function Bars({ src }) {
  const rows = src.trim().split("\n").map((l) => {
    const [label, pct, note] = l.split("|").map((s) => s?.trim());
    return { label, pct: Math.max(0, Math.min(100, parseFloat(pct))), note };
  }).filter((r) => r.label && !isNaN(r.pct));
  if (!rows.length) return null;
  return (
    <div className="chat-bars">
      {rows.map((r, i) => (
        <div key={i} className="chat-bar-row">
          <span className="chat-bar-label" title={r.label}>{r.label}</span>
          <span className="chat-bar-track">
            <span
              className={`chat-bar-fill${r.pct > 90 ? " due" : r.pct > 75 ? " warn" : ""}`}
              style={{ width: `${r.pct}%` }}
            />
          </span>
          <span className="chat-bar-pct">{Math.round(r.pct)}%</span>
          {r.note && <span className="chat-bar-note">{r.note}</span>}
        </div>
      ))}
    </div>
  );
}

function Md({ text }) {
  const parts = React.useMemo(() => String(text).split(/```bars\n([\s\S]*?)```/g), [text]);
  return (
    <div className="chat-md">
      {parts.map((p, i) => (i % 2 ? <Bars key={i} src={p} /> : p.trim() ? <MdHtml key={i} text={p} /> : null))}
    </div>
  );
}

// The shell chrome. Left corner = the app you're IN (logo + name, click to open the
// switcher). Arrows, then the address as subtle text. Brand rides the far right.
// Web content renders in native views the main process positions beside the chrome.
export default function App() {
  const [state, setState] = useState({ tabs: [], apps: [], activeId: null, agentsOpen: false });
  const [urlDraft, setUrlDraft] = useState(null);
  const [dockOpen, setDockOpen] = useState(false);
  const [agentCount, setAgentCount] = useState(0);

  useEffect(() => {
    const off = window.autobot.onState(setState);
    window.autobot.tabs("state").then(setState);
    return off;
  }, []);

  // theme — SystemView's convention: sv-dark stamped on the root, one override block
  const [dark, setDark] = useState(() => localStorage.getItem("theme") !== "light");
  useEffect(() => {
    document.documentElement.classList.toggle("sv-dark", dark);
    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);

  // the strip light: how many agents are alive, whether or not the panel is open
  useEffect(() => {
    const poll = () => window.autobot.agents.list().then((l) => setAgentCount(l.length)).catch(() => {});
    poll();
    const t = setInterval(poll, 5000);
    return () => clearInterval(t);
  }, []);

  const toggleDock = (open = !dockOpen) => {
    setDockOpen(open);
    window.autobot.tabs("dock", { open });
  };

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "b") { e.preventDefault(); toggleDock(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const active = state.tabs.find((t) => t.id === state.activeId);
  const webs = state.tabs.filter((t) => t.kind !== "app");

  const host = (url) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } };
  const isHome = (url) => url?.startsWith("file:") && url?.endsWith("home.html");
  const cornerName = !active ? "autobot" : active.kind === "app" ? active.title : isHome(active.url) ? "autobot" : host(active.url) || active.title;

  const go = (e) => {
    e.preventDefault();
    if (urlDraft == null || !active) return;
    let url = urlDraft.trim();
    if (!/^[a-z]+:\/\//i.test(url)) url = url.includes(" ") || !url.includes(".")
      ? `https://www.google.com/search?q=${encodeURIComponent(url)}`
      : `https://${url}`;
    window.autobot.tabs("navigate", { id: active.id, url });
    setUrlDraft(null);
  };

  const pick = (fn) => { fn(); setUrlDraft(null); toggleDock(false); };

  return (
    <div className={`chrome ${dockOpen ? "" : "dock-closed"}`}>
      <div className="dock">
        <div className="dock-label">apps</div>
        {state.apps.map((a) => (
          <div
            key={a.id}
            className={`card app ${a.tabId != null && a.tabId === state.activeId ? "active" : ""} ${a.tabId == null ? "closed" : ""}`}
            onClick={() => pick(() => window.autobot.tabs("openApp", { appId: a.id }))}
          >
            {a.favicon ? <img className="card-logo" src={a.favicon} /> : <span className="app-dot" />}
            <span className="card-title">{a.title}</span>
            {a.tabId == null && <span className="card-hint">open</span>}
            {a.tabId != null && (
              <span className="card-close" onClick={(e) => { e.stopPropagation(); window.autobot.tabs("close", { id: a.tabId }); }}>✕</span>
            )}
          </div>
        ))}

        <div className="dock-label">web</div>
        {webs.map((t) => (
          <div
            key={t.id}
            className={`card ${t.id === state.activeId ? "active" : ""}`}
            onClick={() => pick(() => window.autobot.tabs("switch", { id: t.id }))}
            title={t.url}
          >
            {t.favicon ? <img className="card-logo" src={t.favicon} /> : <span className="web-dot" />}
            <span className="card-title">{t.title || "…"}</span>
            <span className="card-close" onClick={(e) => { e.stopPropagation(); window.autobot.tabs("close", { id: t.id }); }}>✕</span>
          </div>
        ))}
        <div className="card new" onClick={() => pick(() => window.autobot.tabs("create", {}))}>
          + new tab
        </div>
      </div>

      <div className="top-strip">
        <span className="app-corner" onClick={() => toggleDock()} title="switch app / tabs (⌘B)">
          {active?.favicon ? <img className="corner-logo" src={active.favicon} /> : <StellarMark />}
          <span className="corner-name">{cornerName}</span>
        </span>

        <button disabled={!active?.canGoBack} onClick={() => window.autobot.tabs("back", { id: active.id })}><ArrowIcon /></button>
        <button disabled={!active?.canGoForward} onClick={() => window.autobot.tabs("forward", { id: active.id })}><ArrowIcon flip /></button>
        <button disabled={!active} onClick={() => window.autobot.tabs("reload", { id: active.id })}><ReloadIcon /></button>

        <span className="strip-tabs">
          {state.tabs.map((t) => (
            <span
              key={t.id}
              className={`strip-tab ${t.id === state.activeId ? "active" : ""}`}
              onClick={() => { setUrlDraft(null); window.autobot.tabs("switch", { id: t.id }); }}
              title={t.url}
            >
              {t.kind === "app" && <span className="app-dot mini" />}
              {t.kind === "app" ? t.title : isHome(t.url) ? "new tab" : host(t.url) || t.title || "…"}
            </span>
          ))}
        </span>
        <button className="new-tab" title="new tab" onClick={() => window.autobot.tabs("create", {})}>+</button>

        <form className="url-form" onSubmit={go}>
          <input
            className="url-input"
            value={urlDraft ?? (isHome(active?.url) ? "" : active?.url ?? "")}
            onChange={(e) => setUrlDraft(e.target.value)}
            onBlur={() => setUrlDraft(null)}
            placeholder="search or enter address"
            spellCheck={false}
          />
        </form>

        <span className="spacer" />
        {active?.loading && <span className="loading">•</span>}
        <button className="theme-btn" title={dark ? "light mode" : "dark mode"} onClick={() => setDark((d) => !d)}>
          {dark ? "☀" : "☾"}
        </button>
        <button
          className={`agents-btn ${state.agentsOpen ? "active" : ""} ${agentCount ? "lit" : ""}`}
          title="agents"
          onClick={() => window.autobot.tabs("agents", { open: !state.agentsOpen })}
        >◍{agentCount ? <span className="agents-count">{agentCount}</span> : null}</button>
        <span className="brand-right"><StellarMark /> <span>autobot</span></span>
      </div>

      {state.agentsOpen && <AgentsPanel width={state.agentsWidth || 380} />}
    </div>
  );
}

// SystemView's cooking words, verbatim (siblings share): a SPECIFIC status shows
// as-is — truth over theater — and only the generic wait earns the show.
const COOKING = [
  "thinking", "cooking", "in the lab", "stirring the pot", "working on it",
  "chewing on it", "letting it simmer", "crunching", "putting it together",
  "still at it", "almost plated",
];

// Long text folds — his ask: no big-ass blocks in the scrollback. Anything over
// ~420 chars shows its head with "show more"; the toggle is per message.
function Clamp({ text, at = 420 }) {
  const [open, setOpen] = useState(false);
  const t = String(text ?? "");
  if (t.length <= at) return t;
  return (
    <>
      {open ? t : t.slice(0, at).replace(/\S*$/, "") + "…"}
      <span className="show-more" onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}>
        {open ? "show less" : "show more"}
      </span>
    </>
  );
}

// "2m" / "3h" / "aug 21" — the cue that separates today's conversation from last week's
function relTime(ms) {
  if (!ms) return "";
  const d = Date.now() - ms;
  if (d < 90e3) return "now";
  if (d < 3600e3) return `${Math.round(d / 60e3)}m`;
  if (d < 86400e3) return `${Math.round(d / 3600e3)}h`;
  return new Date(ms).toLocaleDateString([], { month: "short", day: "numeric" }).toLowerCase();
}

// One tool call as a receipt line — a thing that HAPPENED, not something said.
// Click opens the raw input and result. (The component the blank-panel crash was
// missing: the render referenced it before it existed.)
// The WORK, on screen by default — the code that changed, the command that ran,
// the file that was read ("in my previous experience, I will see a display. I
// want that"). Click the summary line to collapse; click again to reopen — the
// set tracks COLLAPSED cards. Raw JSON is the last resort, not the display.
function ToolCard({ ev, res, open, toggle }) {
  const inp = ev.input || {};
  const detail = () => {
    switch (ev.name) {
      case "Edit":
        return (
          <>
            {inp.old_string && <pre className="code del">{String(inp.old_string).slice(0, 900)}</pre>}
            {inp.new_string && <pre className="code add">{String(inp.new_string).slice(0, 900)}</pre>}
          </>
        );
      case "Write":
        return <pre className="code add">{String(inp.content || "").slice(0, 1200)}</pre>;
      case "Bash":
        return (
          <>
            <pre className="code">$ {String(inp.command || "")}</pre>
            {res?.detail && <pre className="code out">{String(res.detail).slice(0, 900)}</pre>}
          </>
        );
      case "Read":
      case "Grep":
      case "Glob":
        return res?.detail ? <pre className="code out">{String(res.detail).slice(0, 1200)}</pre> : null;
      default:
        return (
          <>
            {Object.keys(inp).length > 0 && <pre className="code">{JSON.stringify(inp, null, 2).slice(0, 900)}</pre>}
            {res?.detail && <pre className="code out">{String(res.detail).slice(0, 900)}</pre>}
          </>
        );
    }
  };
  return (
    <div className={`act tool-card ${res ? (res.ok ? "" : "failed") : "running"}`} onClick={toggle}>
      <span className="tool-summary">{ev.summary || ev.name}</span>
      <span className="tool-state">{res ? (res.ok ? "" : "✕") : "…"}</span>
      {open && <div className="tool-detail" onClick={(e) => e.stopPropagation()}>{detail()}</div>}
    </div>
  );
}

function ArrowIcon({ flip = false }) {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" style={flip ? { transform: "scaleX(-1)" } : undefined}>
      <path d="M10.2 3 L5 8 L10.2 13" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ReloadIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14">
      <path d="M13 8 A5 5 0 1 1 11.6 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M11.2 1.6 L11.9 4.8 L8.7 5.4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// The Stellar spark — Odion's mark from the Stellar Assistant days, in the shell's blue.
function StellarMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 100 100" className="stellar-mark">
      <g fill="#7cc4ff" transform="rotate(18 50 50)">
        <path d="M50 2 C56 36 64 44 98 50 C64 56 56 64 50 98 C44 64 36 56 2 50 C36 44 44 36 50 2 Z" />
        <path d="M78 6 C80 16 84 20 94 22 C84 24 80 28 78 38 C76 28 72 24 62 22 C72 20 76 16 78 6 Z" opacity="0.85" />
        <path d="M20 68 C21.5 74 24 76.5 30 78 C24 79.5 21.5 82 20 88 C18.5 82 16 79.5 10 78 C16 76.5 18.5 74 20 68 Z" opacity="0.7" />
      </g>
    </svg>
  );
}

// The browser's own agent surface — real sessions on the harness (RFC-002). A fixed
// right column: the main process INSETS the native tab views around it (tabs draw
// over the chrome, so floating chrome below the strip is invisible — the lesson of
// the old bubble). Every project the shell can host, live sessions with what
// they're doing, sticky ones from previous runs, and a working conversation.
// The fold icon: two chevrons pressing toward a center line — the conversation
// compressed onto its boundary. Drawn, not a unicode glyph (his call, 2026-08-24).
function CompactIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 1.5 L8 5 L12 1.5" />
      <path d="M2.5 8 H13.5" />
      <path d="M4 14.5 L8 11 L12 14.5" />
    </svg>
  );
}

// Model switcher (his ask, 2026-08-24). The menu is the SDK's own list — never a
// hardcoded one drifting across repos. setModel is a REQUEST: truth arrives as the
// next turn's re-init (same-sdk-id session.started), so the select trusts the feed
// and holds the choice only as a pending hint until the feed confirms it.
function ModelPick({ tr, model }) {
  const [menu, setMenu] = useState(null);
  const [pending, setPending] = useState(null);
  useEffect(() => {
    setPending(null);
    if (tr.models) tr.models().then(setMenu).catch(() => setMenu(null));
    else setMenu(null); // transport predates the wire (stale preload) — hide, don't break
  }, [tr]);
  useEffect(() => { if (pending && model === pending) setPending(null); }, [model, pending]);
  if (!menu?.length) return null;
  const items = menu.map((m) => typeof m === "string"
    ? { id: m, label: m }
    : { id: m.model || m.id || m.value, label: m.displayName || m.name || m.model || m.id });
  const value = pending || model || "";
  return (
    <select
      className="model-pick"
      title={pending ? "switching — takes effect next turn" : "switch model — takes effect next turn"}
      value={value}
      onChange={(e) => { const v = e.target.value; setPending(v); tr.setModel(v).catch(() => setPending(null)); }}
    >
      {value && !items.some((i) => i.id === value) && <option value={value}>{value}</option>}
      {items.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
    </select>
  );
}

function AgentsPanel({ width }) {
  const [live, setLive] = useState([]);
  // drag-to-resize: local width follows the pointer, the main process re-insets
  // the native views to match; double-click the edge resets
  const [w, setW] = useState(width);
  const dragW = React.useRef(null);
  const startResize = (e) => {
    dragW.current = { x: e.clientX, w };
    e.target.setPointerCapture(e.pointerId);
  };
  const moveResize = (e) => {
    if (!dragW.current) return;
    // no invented ceiling — drag it wherever you want; the window edge is the only limit
    const next = Math.max(180, Math.min(window.innerWidth - 160, dragW.current.w + (dragW.current.x - e.clientX)));
    setW(next);
    if (!moveResize.pending) {
      moveResize.pending = true;
      requestAnimationFrame(() => {
        moveResize.pending = false;
        window.autobot.tabs("agents", { open: true, width: next });
      });
    }
  };
  const endResize = () => { dragW.current = null; };
  const resetResize = () => { setW(380); window.autobot.tabs("agents", { open: true, width: 380 }); };

  // the SystemView voice flow: words paint while you talk, pauses commit into the
  // input, the mic stays hot across sends
  const [micOn, setMicOn] = useState(false);
  const [preview, setPreview] = useState("");
  const micRef = React.useRef(null);
  const toggleMic = async () => {
    if (micRef.current) {
      const ctl = micRef.current;
      micRef.current = null;
      setMicOn(false); setPreview("");
      await ctl.stop().catch?.(() => {});
      return;
    }
    const ctl = await window.autobot.dictation.listen({
      onDraft: (t) => setPreview(t),
      onSegment: (t) => { setDraft((d) => (d ? d.replace(/\s+$/, "") + " " : "") + t); setPreview(""); },
    });
    micRef.current = ctl;
    setMicOn(true);
  };
  useEffect(() => () => { micRef.current?.cancel(); }, []);
  const [resumable, setResumable] = useState([]);
  const [current, setCurrent] = useState(null); // { projectCode, tr }
  const [feed, setFeed] = useState([]); // RFC-048 events for the current session
  const [draft, setDraft] = useState("");
  const feedRef = React.useRef(null);
  const offRef = React.useRef(null);

  const [onDisk, setOnDisk] = useState([]);
  const [defs, setDefs] = useState([]); // RFC-003 agent definitions (not runs)
  // HIS CALL, 2026-08-25: "it should just be open and could be open further."
  // The configuration is not a secret behind a chevron — it is what the row IS.
  // So: always shown, and `expanded` reveals the FULL lists instead of the first
  // few, because 28 tools in a 380px rail is a wall, not information.
  const [expanded, setExpanded] = useState(null); // agent id whose lists are shown in full
  // the strip above the chat: one row by default, expandable to see them all, and
  // the expanded height is his to drag ("resizable to show more if necessary").
  // Both remembered — a control you re-open every time is a control you resent.
  const [stripOpen, setStripOpen] = useState(() => localStorage.getItem("agent:strip") === "open");
  const [stripH, setStripH] = useState(() => +localStorage.getItem("agent:stripH") || 108);
  const dragS = React.useRef(null);
  const startStripResize = (e) => {
    dragS.current = { y: e.clientY, h: stripH };
    e.target.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const moveStripResize = (e) => {
    if (!dragS.current) return;
    const next = Math.max(44, Math.min(420, dragS.current.h + (e.clientY - dragS.current.y)));
    setStripH(next);
  };
  const endStripResize = () => {
    if (!dragS.current) return;
    dragS.current = null;
    try { localStorage.setItem("agent:stripH", String(stripH)); } catch {}
  };
  const toggleStrip = () => {
    const next = !stripOpen;
    setStripOpen(next);
    try { localStorage.setItem("agent:strip", next ? "open" : "shut"); } catch {}
  };
  const refresh = async () => {
    const l = await window.autobot.agents.list();
    const r = await window.autobot.agents.resumable();
    setLive(l);
    setResumable(r);
    try { setDefs(await window.autobot.agents.defs()); } catch {}
    // conversations saved on disk — including ones OTHER apps or a terminal started.
    // The newest few per project that aren't already live or sticky here.
    try {
      const projects = await window.autobot.agents.projects();
      const seen = new Set([...l, ...r].flatMap((s) => [s.sessionId, s.sdkSessionId]).filter(Boolean));
      const per = await Promise.all(
        projects.map((pc) =>
          window.autobot.agents.transcripts(pc)
            .then((ts) => ts.filter((t) => !seen.has(t.sessionId)).slice(0, 2).map((t) => ({ ...t, projectCode: pc })))
            .catch(() => [])
        )
      );
      setOnDisk(per.flat().sort((a, b) => b.lastActive - a.lastActive).slice(0, 8));
    } catch {}
  };
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, []);

  // sticky scroll — the solved behavior: the feed only follows the bottom if
  // you're AT the bottom. Scroll up to read and it leaves you alone; come back
  // down and it follows again. Nothing yanks.
  const stickRef = React.useRef(true);
  useEffect(() => {
    if (stickRef.current) feedRef.current?.scrollTo(0, feedRef.current.scrollHeight);
  }, [feed]);

  const attach = async (projectCode, sessionId, resume, agentId) => {
    offRef.current?.();
    // agentId opens a RUN OF A DEFINITION (RFC-003): the definition supplies the
    // assignment, tools, skills and gating; anything passed here still wins.
    const tr = await window.autobot.agents.open({ projectCode, ...(sessionId ? { sessionId } : {}), ...(resume ? { resume } : {}), ...(agentId ? { agentId } : {}) });
    setCurrent({ projectCode, tr });
    stickRef.current = true;
    setFeed(tr.initialEvents || []);
    offRef.current = tr.onEvent((ev) => setFeed((es) => [...es.slice(-600), ev]));
    // a shell restart (the dev runner restarts on backend saves) must not cost
    // the conversation — remember where he is; only a deliberate leave clears it
    try { localStorage.setItem("agent:last", JSON.stringify({ projectCode, sessionId })); } catch {}
    refresh();
  };

  // …and when the shell comes back, walk him right back in, replay on screen
  useEffect(() => {
    try {
      const last = JSON.parse(localStorage.getItem("agent:last") || "null");
      if (last?.projectCode && last?.sessionId) attach(last.projectCode, last.sessionId);
    } catch {}
  }, []);

  const taRef = React.useRef(null);
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 110) + "px";
  }, [draft]);

  const send = (e) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !current) return;
    current.tr.send(text);
    setDraft("");
    setPreview("");
    // SEND STOPS THE RECORDER — the solved behavior: the message goes, the mic goes
    // quiet, and any words still in the air land in the input for next time.
    if (micRef.current) {
      const ctl = micRef.current;
      micRef.current = null;
      setMicOn(false);
      ctl.stop();
    }
  };

  // the way BACK — detaches the view only; the session keeps running and its row
  // stays in the list to re-attach. Nothing about opening a chat is one-way.
  const detach = () => {
    if (!current) return;
    if (micRef.current) { micRef.current.cancel(); micRef.current = null; setMicOn(false); setPreview(""); }
    offRef.current?.();
    current.tr.dispose();
    setCurrent(null);
    setFeed([]);
    try { localStorage.removeItem("agent:last"); } catch {} // deliberate leave — don't walk him back in
    refresh();
  };

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") detach(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const endSession = async (key, s) => {
    if (current && key === current.tr.key) { offRef.current?.(); setCurrent(null); setFeed([]); }
    await window.autobot.agents.kill(key);
    // one ✕ means GONE: a non-live session's transcript row must not resurface
    // in "saved conversations" after the sticky record is forgotten
    if (s && !live.some((l) => l.key === key))
      await window.autobot.agents.dismiss?.(s.projectCode, s.sessionId).catch?.(() => {});
    refresh();
  };

  // remove a saved conversation from the list — the transcript on disk is Claude
  // Code's history, not ours to burn; dismissal is a list decision, not a delete
  const dismiss = async (projectCode, sessionId) => {
    await window.autobot.agents.dismiss?.(projectCode, sessionId);
    refresh();
  };

  // What the feed shows: the conversation, with activity woven between the turns.
  // working = a prompt is in flight and nothing has closed the turn yet.
  const lastIdx = (pred) => { for (let i = feed.length - 1; i >= 0; i--) if (pred(feed[i])) return i; return -1; };
  // a turn closes on the run RECEIPT (usage without snapshot) / session end — a
  // snapshot:true usage is a mid-turn ruler tick and must not read as finished,
  // or the cooking line dies while the agent is still working — or on a
  // compaction verdict, which
  // arrives with no result message (a failed compact must not leave "working" stuck)
  const working = current &&
    lastIdx((e) => e.kind === "user.prompt" && !e.replay) >
    lastIdx((e) => (e.kind === "usage" && !e.snapshot) || e.kind === "session.ended" || (e.kind === "status" && e.compactResult));
  const typing = (() => {
    let t = "";
    for (let i = feed.length - 1; i >= 0; i--) {
      const ev = feed[i];
      if (ev.kind === "assistant.text" && ev.done) break;
      if (ev.kind === "user.prompt") break;
      if (ev.kind === "assistant.text") t = ev.delta + t;
    }
    return t;
  })();
  // their cooking rule: a specific status (the tool at work) shows verbatim; the
  // generic wait cycles the cooking words so a working agent never reads as dead
  const [cookIdx, setCookIdx] = useState(0);
  useEffect(() => {
    if (!working) return;
    const t = setInterval(() => setCookIdx((i) => i + 1), 2600);
    return () => clearInterval(t);
  }, [working]);
  const cooking = (() => {
    if (!working) return null;
    for (let i = feed.length - 1; i >= 0; i--) {
      const ev = feed[i];
      if (ev.kind === "tool.call") return ev.summary;
      // compaction narrates itself — the SDK's own status signal, not a guess
      // from the prompt text ("a cooking message not really connected to anything")
      if (ev.kind === "status" && ev.status === "compacting") return "compacting";
      if (ev.kind === "user.prompt") return ev.text?.trim().startsWith("/compact") ? "compacting" : COOKING[cookIdx % COOKING.length];
    }
    return COOKING[cookIdx % COOKING.length];
  })();
  const [openTools, setOpenTools] = useState(() => new Set());
  const toggleTool = (id) =>
    setOpenTools((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const resultOf = (id) => feed.find((e) => e.kind === "tool.result" && e.id === id);
  const stamp = (ts) => (ts ? new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "");

  const rows = feed.filter((ev) =>
    ev.kind === "user.prompt" || (ev.kind === "assistant.text" && ev.done) ||
    (ev.kind === "assistant.thinking" && ev.done && ev.text) ||
    ev.kind === "tool.call" || ev.kind === "permission.request" ||
    ev.kind === "compaction" || (ev.kind === "status" && ev.compactResult === "failed") ||
    ev.kind === "session.ended"
  );
  // the fill: last turn's real context (fresh + cached input) — or, right after a
  // compaction, the post-compaction number the harness itself reported.
  // A compaction ALWAYS stops the walk: everything before the boundary is the old
  // conversation, and showing its number is how the meter kept screaming "full"
  // at a freshly-compacted session. No postTokens yet → no number (honest fresh),
  // until the first real usage after the boundary fills it in.
  const lastCtx = (() => {
    for (let i = feed.length - 1; i >= 0; i--) {
      const e = feed[i];
      if (e.kind === "usage" && e.contextTokens) return e.contextTokens;
      if (e.kind === "compaction") return e.postTokens || null;
    }
    return null;
  })();
  // the ruler: the model's REAL window, learned from the session itself. The
  // 200k-era guess pegged red at 457k of real context on a 1M-window model and
  // screamed "compact" at a healthy conversation — the bar grew 5× too fast.
  // fable/opus/sonnet 5-family = 1M; haiku and pre-4.6 = 200k. Unknown model:
  // fall back to a ruler that grows past anything already sailed past.
  const model = (() => { for (let i = feed.length - 1; i >= 0; i--) if (feed[i].model) return feed[i].model; return null; })();
  const maxSeen = feed.reduce((m, e) => Math.max(m, e.contextTokens || e.preTokens || 0), 0);
  // the harness now ships contextWindow on session.started + usage — that number
  // wins (single source of truth; d2 reads it too). The regex stays only as the
  // fallback for replayed feeds recorded before the harness shipped it.
  const shippedWindow = (() => { for (let i = feed.length - 1; i >= 0; i--) if (feed[i].contextWindow) return feed[i].contextWindow; return null; })();
  // Unknown model: assume the BIG window, never a grown one. The old grow-past-
  // maxSeen ruler (×1.15) capped the fill ratio at 1/1.15 = 0.87 — structurally
  // below the 0.90 red line, a gauge that could warn but never alarm (d2 shipped
  // the same shape and caught it). max(1M, seen) can actually reach red, and a
  // too-big guess under-warns instead of crying wolf — same call as the 200k fix.
  const ctxWindow = shippedWindow ?? (model
    ? (/haiku|-3-|sonnet-4-5|opus-4-5/.test(model) ? 200000 : 1000000)
    : Math.max(1000000, maxSeen));
  const ctxPct = lastCtx != null ? Math.min(100, Math.round((lastCtx / ctxWindow) * 100)) : null;

  // ONE LIST, TWO PLACES. His ask: "when I go into a conversation I don't want to
  // have to go back to switch." The list view and the chat view were mutually
  // exclusive — {!current && list} / {current && chat} — so switching meant leaving.
  // Same rows, derived once here, rendered as a strip above the chat too. attach()
  // already swaps a live view cleanly (it detaches first), so switching in place
  // needs no new machinery — only somewhere to click that isn't behind a back button.
  // what a session is ABOUT: the transcript list already carries the ai-title, and
  // a resumed session's sessionId IS its transcript id — so the name is a lookup,
  // not something we have to invent or store.
  const aboutOf = (s) => {
    const t = onDisk.find((d) => d.sessionId === s.sessionId || d.sessionId === s.sdkSessionId);
    return t?.about ? t.about.slice(0, 26) : "";
  };
  const sameProject = (s) =>
    [...live, ...resumable].filter((x) => x.projectCode === s.projectCode).length > 1;
  // ONE LIST. His correction, 2026-08-25: "there are no more conversations" —
  // that category only existed to carry the transfer off the old harness. Every
  // conversation IS an agent; the six running right now are agents SystemView
  // defined implicitly, which is why a separate "definitions" section sat empty
  // while six real agents ran below it. State (running / idle / saved) is a
  // PROPERTY of an agent, not a section it lives in.
  //
  // Nothing is hidden: a defined agent with no run, a run with no definition, and
  // a transcript on disk are all agents here, each saying which it is.
  const byAgentId = new Map(defs.map((d) => [d.id, d]));
  const runs = [...live, ...resumable];
  const seenSession = new Set();
  const agentList = [];

  for (const s2 of runs) {
    seenSession.add(s2.sessionId);
    const d = s2.agentId ? byAgentId.get(s2.agentId) : null;
    agentList.push({
      id: s2.key,
      kind: "run",
      state: live.some((l) => l.key === s2.key) ? "running" : "idle",
      name: d?.name || (s2.projectCode === "browser"
        ? `browser · ${new Date(s2.startedAt || s2.lastActive).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
        : s2.projectCode),
      projectCode: s2.projectCode,
      cwd: s2.cwd,
      sessionId: s2.sessionId,
      resume: null,
      agentId: s2.agentId || null,
      def: d?.def || null,
      // an implicit agent is one nothing here configured — SystemView started it.
      // It is REAL and must show as real; what it lacks is a definition we hold.
      implicit: !s2.agentId,
      permissionMode: s2.permissionMode,
      capabilities: s2.capabilities || null,
      worklist: s2.worklist || [],
      usedBy: s2.usedBy || [],
      about: "",
      lastActive: s2.startedAt || s2.lastActive || 0,
      sessionKey: s2.key,
    });
  }
  // defined agents with nothing running — the ones you can start
  for (const d of defs) {
    if (runs.some((r) => r.agentId === d.id)) continue;
    agentList.push({
      id: `def:${d.id}`,
      kind: "def",
      state: "defined",
      name: d.name,
      projectCode: d.projectCode,
      cwd: d.cwd,
      sessionId: null,
      resume: null,
      agentId: d.id,
      def: d.def || {},
      implicit: false,
      permissionMode: d.permissionMode,
      about: d.def?.description || "",
      lastActive: d.updatedAt || 0,
    });
  }
  // conversations on disk that aren't running here — history, still resumable
  for (const t of onDisk) {
    if (seenSession.has(t.sessionId)) continue;
    agentList.push({
      id: `disk:${t.projectCode}:${t.sessionId}`,
      kind: "disk",
      state: "saved",
      name: t.projectCode,
      projectCode: t.projectCode,
      cwd: null,
      sessionId: t.sessionId,
      resume: t.sessionId,
      agentId: null,
      def: null,
      implicit: true,
      permissionMode: null,
      about: t.about || "",
      lastActive: t.lastActive || 0,
    });
  }
  const RANK = { running: 0, idle: 1, defined: 2, saved: 3 };
  agentList.sort((a, b) => (RANK[a.state] - RANK[b.state]) || (b.lastActive - a.lastActive));

  // the strip above the chat rides the SAME list — one derivation, two places
  const convs = agentList.map((a) => ({
    id: a.id,
    projectCode: a.projectCode || "browser",
    sessionId: a.sessionId,
    resume: a.resume,
    agentId: a.kind === "def" ? a.agentId : null,
    live: a.state === "running",
    disk: a.state === "saved",
    label: a.name,
  }));

  // the chip that is ON must be findable after a resume, when the row's id was a
  // disk id and the session's key is now projectCode:sessionId
  const isCurrentConv = (c) =>
    current?.tr?.key === c.id ||
    (current && current.projectCode === c.projectCode && current.tr?.key === `${c.projectCode}:${c.sessionId}`);

  return (
    <div className="agent-column" style={{ width: w }}>
      <div
        className="agent-resize"
        onPointerDown={startResize}
        onPointerMove={moveResize}
        onPointerUp={endResize}
        onDoubleClick={resetResize}
        title="drag to resize · double-click to reset"
      />
      <div className="agent-panel-title">
        agents
        <span className="agent-panel-sub">{live.length ? `${live.length} running` : "none running"}</span>
        <span className="spacer" />
        <span
          className="agent-setup"
          title="setup — sign-in, keys, projects"
          onClick={() => window.autobot.tabs("openSetup", {})}
        >⚙</span>
      </div>

          {!current && <div className="agent-sessions">
            {/* ONE LIST — every agent, whatever state it is in. Sections used to
                split "conversations" from "runs" from "definitions", which put
                six real agents under three headings and left the heading called
                "agents" empty. State is a dot and a word, not a category. */}
            <div className="agent-section-label">
              agents
              <span className="agent-section-note">{agentList.filter((a) => a.state === "running").length} running · {agentList.length} total</span>
            </div>

            {agentList.map((a) => {
              const t = a.def || {};
              const axes = [
                t.tools?.length ? `${t.tools.length} tools` : t.disallowedTools?.length ? "limited tools" : "",
                t.skills?.length ? `${t.skills.length} skills` : "",
                t.mcpServers?.length ? `${t.mcpServers.length} mcp` : "",
              ].filter(Boolean);
              const isFull = expanded === a.id;
              const cap = a.capabilities;
              const show = (arr, n) => (isFull ? arr : arr.slice(0, n));
              const active = a.worklist?.find((i) => i.state === "active");
              const done = a.worklist?.filter((i) => i.state === "done").length || 0;
              return (
                <div key={a.id} className={`agent-card${isFull ? " full" : ""}${current?.tr?.key === a.id ? " current" : ""}`}>
                  {/* THE HEAD. The card does NOT open a conversation — his call:
                      "I don't want to click into the conversation in the row, I
                      want to click an icon." So the whole card is safe to touch,
                      read and manage; only ▸ enters. */}
                  <div className="card-head">
                    <span className={`agent-state ${a.state === "running" ? "on" : a.state === "idle" ? "sticky" : a.state === "defined" ? "def" : ""}`} />
                    <span className="card-name">{a.name}</span>
                    <span className={`card-state ${a.state}`}>{a.state}</span>
                    <span className="spacer" />
                    <span
                      className="card-enter"
                      title="open this conversation"
                      onClick={() => attach(a.projectCode || "browser",
                        a.kind === "def" ? `${a.agentId}-${Date.now().toString(36)}` : a.sessionId,
                        a.resume,
                        a.kind === "def" ? a.agentId : null)}
                    >▸</span>
                    <span
                      className="card-x"
                      title={a.kind === "def" ? "forget this agent — its conversations are untouched"
                        : a.kind === "disk" ? "remove from this list — the transcript stays on disk"
                        : "end this agent"}
                      onClick={() => {
                        if (a.kind === "def") window.autobot.agents.removeDef(a.agentId).then(refresh);
                        else if (a.kind === "disk") dismiss(a.projectCode, a.sessionId);
                        else endSession(a.sessionKey, a);
                      }}
                    >✕</span>
                  </div>

                  {/* USED BY — the line he actually asked for. Not where it runs:
                      WHICH APPLICATION in this browser is using it. An agent can
                      work on the autobot repo while being used by SystemView, and
                      that sentence was unsayable before. */}
                  <div className="card-usedby">
                    {a.usedBy?.length ? (
                      <>used in {a.usedBy.map((u) => <span key={u.id} className="app-chip">{u.title}</span>)}</>
                    ) : (
                      <span className="cfg-none">not open in any application</span>
                    )}
                  </div>

                  {/* the worklist, on the face of the card */}
                  {a.worklist?.length > 0 && (
                    <div className="card-work">
                      <span className="work-count">{done}/{a.worklist.length}</span>
                      <span className="work-now">{active ? active.text : "no active step"}</span>
                    </div>
                  )}

                  <div className="card-facts">
                    <span className="fact"><b>on</b> {a.projectCode || "—"}</span>
                    <span className="fact"><b>in</b> {a.cwd ? a.cwd.replace(/^\/Users\/[^/]+/, "~") : "—"}</span>
                    <span className="fact"><b>gating</b> {a.permissionMode === "default" ? "asks" : "open"}</span>
                    {(a.def?.model || a.model) && <span className="fact"><b>model</b> {a.def?.model || a.model}</span>}
                  </div>

                  {cap ? (
                    <>
                      <div className="card-list">
                        <div className="card-list-k">skills <b>{cap.skills.length}</b></div>
                        <div className="card-list-v">
                          {cap.skills.length === 0 ? <span className="cfg-none">none</span> : <>
                            {show(cap.skills, 6).map((t) => <span key={t} className="chip skill">{t}</span>)}
                            {!isFull && cap.skills.length > 6 && <span className="chip more">+{cap.skills.length - 6}</span>}
                          </>}
                        </div>
                      </div>
                      <div className="card-list">
                        <div className="card-list-k">tools <b>{cap.tools.length}</b></div>
                        <div className="card-list-v">
                          {show(cap.tools, 6).map((t) => (
                            <span key={t} className={`chip${t.startsWith("mcp__") ? " mcp" : ""}`}>{t.replace(/^mcp__/, "")}</span>
                          ))}
                          {!isFull && cap.tools.length > 6 && <span className="chip more">+{cap.tools.length - 6}</span>}
                        </div>
                      </div>
                      <div className="card-list">
                        <div className="card-list-k">mcp <b>{cap.mcpServers.length}</b></div>
                        <div className="card-list-v">
                          {cap.mcpServers.length === 0 ? <span className="cfg-none">none</span> :
                            cap.mcpServers.map((m) => (
                              <span key={m.name} className={`chip ${m.status === "connected" ? "ok" : "bad"}`} title={m.status}>{m.name}</span>
                            ))}
                        </div>
                      </div>
                      {isFull && cap.agents?.length > 0 && (
                        <div className="card-list">
                          <div className="card-list-k">subagents <b>{cap.agents.length}</b></div>
                          <div className="card-list-v">{cap.agents.map((t) => <span key={t} className="chip">{t}</span>)}</div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="card-list">
                      <div className="card-list-k">tools</div>
                      <div className="card-list-v cfg-none">not reported yet — an agent lists what it has when it starts</div>
                    </div>
                  )}

                  <div className="cfg-more" onClick={() => setExpanded(isFull ? null : a.id)}>
                    {isFull ? "less" : "open further"}
                  </div>
                </div>
              );
            })}

            {agentList.length === 0 && (
              <div className="agent-row muted-row">no agents yet — start one below</div>
            )}
            <div className="agent-row new" onClick={() => attach("browser", `chat-${Date.now().toString(36)}`)}>
              <span className="agent-state" />
              <span className="agent-name">+ new agent</span>
            </div>
          </div>}

          {current && (
            <div className="agent-chat">
              {/* THE OTHER CONVERSATIONS, WITHOUT LEAVING THIS ONE. Collapsed it is one
                  scrollable row; open it wraps and the height drags. Clicking a chip
                  swaps the view in place — the session you came from keeps running,
                  exactly as it does behind the back button. */}
              <div className={`conv-strip${stripOpen ? " open" : ""}`}>
                <div className="conv-strip-rows" style={stripOpen ? { height: stripH } : undefined}>
                  {convs.map((c) => (
                    <span
                      key={c.id}
                      className={`conv-chip${isCurrentConv(c) ? " on" : ""}${c.live ? " live" : c.disk ? " disk" : " sticky"}`}
                      title={`${c.projectCode}${c.disk ? " — saved conversation" : c.live ? " — running" : " — idle"}\nclick to switch; this one keeps running`}
                      onClick={() => { if (!isCurrentConv(c)) attach(c.projectCode, c.sessionId, c.resume); }}
                    >
                      <span className={`agent-state ${c.live ? "on" : c.disk ? "" : "sticky"}`} />
                      {c.label}
                    </span>
                  ))}
                  <span
                    className="conv-chip new"
                    title="start another conversation"
                    onClick={() => attach("browser", `chat-${Date.now().toString(36)}`)}
                  >+ new</span>
                </div>
                <button
                  className="conv-strip-more"
                  title={stripOpen ? "show fewer" : `show all ${convs.length} conversations`}
                  onClick={toggleStrip}
                >{stripOpen ? "⌃" : "⌄"}{!stripOpen && convs.length > 1 ? <span className="conv-count">{convs.length}</span> : null}</button>
                {stripOpen && (
                  <div
                    className="conv-strip-grip"
                    title="drag to show more"
                    onPointerDown={startStripResize}
                    onPointerMove={moveStripResize}
                    onPointerUp={endStripResize}
                  />
                )}
              </div>
              <div className="agent-chat-head">
                <button className="chat-back" title="back to the list — the session keeps running (Esc)" onClick={detach}>←</button>
                <span>{current.projectCode}</span>
                <span className="agent-cwd" title="where this session lives">{(([...live, ...resumable].find((l) => l.key === current.tr.key) || {}).cwd || "").replace(/^\/Users\/[^/]+/, "~")}</span>
                <span className="spacer" />
                {/* SAVE AS AGENT — the authoring path that isn't a blank form
                    (RFC-003 §4). The run already knows where it lives and how it
                    is gated; he supplies the name and, later, the assignment. */}
                <button
                  className="save-agent"
                  title="save this conversation's setup as an agent you can run again"
                  onClick={async () => {
                    const name = prompt("Name this agent", current.projectCode);
                    if (!name) return;
                    await window.autobot.agents.defFromSession(current.tr.key, { name });
                    refresh();
                  }}
                >save as agent</button>
                <ModelPick tr={current.tr} model={model} />
                {ctxPct != null && (
                  <button
                    className={`compact-btn${ctxPct > 90 ? " due" : ctxPct > 75 ? " warn" : ""}${cooking === "compacting" ? " busy" : ""}`}
                    title={cooking === "compacting" ? "compacting…" : `compact — ${ctxPct}% full`}
                    disabled={cooking === "compacting"}
                    onClick={() => current.tr.send("/compact")}
                  ><CompactIcon /></button>
                )}
                {!working && <span className="idle-tag">idle</span>}
                {working && <button className="stop" onClick={() => current.tr.interrupt()} title="stop">■</button>}
              </div>
              {/* SystemView's fullness meter, verbatim shape — a hairline under the header:
                  how close this conversation is to the context mark. Amber = compact soon,
                  red = compact now. */}
              {ctxPct != null && (
                <div className="meter" title={`context ${Math.round(lastCtx / 1000)}k of ~${Math.round(ctxWindow / 1000)}k — ${ctxPct > 90 ? "compact NOW" : ctxPct > 75 ? "compact soon" : "healthy"}`}>
                  <div
                    className={`meter-fill${ctxPct > 90 ? " due" : ctxPct > 75 ? " warn" : ""}`}
                    style={{ width: `${ctxPct}%` }}
                  />
                </div>
              )}
              <div
                className="agent-feed"
                ref={feedRef}
                onScroll={(e) => {
                  const el = e.currentTarget;
                  stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
                }}
              >
                {rows.map((ev, i) => {
                  // WHO SAID THIS is three answers, not two (his call: a subscribed
                  // visitor "looks like it's coming from you"). A visitor's line
                  // arrives as a user turn stamped "[name]: …" by the hub, so it
                  // rendered in the human's own bubble — indistinguishable from him
                  // typing. Parse the stamp: the name becomes the attribution and
                  // only the remainder is the message. `from` on the event still
                  // wins when the emitter sets it.
                  const stamped = ev.kind === "user.prompt" && /^\s*\[([^\]\n]{1,40})\]:\s/.exec(ev.text || "");
                  const speaker = ev.from || (stamped ? stamped[1] : null);
                  const vis = speaker && speaker !== "you" && speaker !== current.projectCode;
                  if (ev.kind === "user.prompt") return (
                    <div key={i} className={`msg ${vis ? "msg--agent msg--visitor" : "msg--you"}`}>
                      {vis && <span className="visitor-tag">{speaker}</span>}
                      <Clamp text={stamped ? ev.text.slice(stamped[0].length) : ev.text} />
                      <span className="msg-time">{stamp(ev.ts)}</span>
                    </div>
                  );
                  if (ev.kind === "assistant.text") return (
                    <div key={i} className={`msg msg--agent ${vis ? "msg--visitor" : ""}`}>
                      {vis && <span className="visitor-tag">{ev.from}</span>}
                      <Md text={ev.text} />
                      <span className="msg-time">{stamp(ev.ts)}</span>
                    </div>
                  );
                  if (ev.kind === "assistant.thinking") return (
                    <div key={i} className={`thought ${openTools.has("t" + i) ? "open" : ""}`} onClick={() => toggleTool("t" + i)}>
                      <span className="thought-mark">✳</span>
                      {openTools.has("t" + i) ? ev.text : ev.text.split("\n").find(Boolean)?.slice(0, 90) + "…"}
                    </div>
                  );
                  if (ev.kind === "tool.call") return (
                    <ToolCard key={i} ev={ev} res={resultOf(ev.id)} open={!openTools.has(ev.id)} toggle={() => toggleTool(ev.id)} />
                  );
                  if (ev.kind === "permission.request") return (
                    <div key={i} className="perm">
                      {ev.title}
                      <button onClick={() => current.tr.answerPermission(ev.id, true)}>allow</button>
                      <button onClick={() => current.tr.answerPermission(ev.id, false)}>deny</button>
                    </div>
                  );
                  {/* compaction is a visible event with a receipt — the harness's own
                      numbers, so "did it work?" is never a mystery again */}
                  if (ev.kind === "compaction") {
                    // no postTokens in the metadata → the receipt stays OPEN
                    // ("compacted — from 908k") and the first usage after the
                    // boundary finishes it — the same number the meter snaps to.
                    // "fresh" was a guess; this is the measurement.
                    const post = ev.postTokens ?? (() => {
                      const fi = feed.indexOf(ev);
                      for (let j = fi + 1; j < feed.length; j++)
                        if (feed[j].kind === "usage" && feed[j].contextTokens) return feed[j].contextTokens;
                      return null;
                    })();
                    return (
                      <div key={i} className="compact-mark">
                        <span className="compact-line" />
                        <span className="compact-chip">
                          <CompactIcon />
                          {post != null
                            ? `compacted · ${Math.round((ev.preTokens || 0) / 1000)}k → ${Math.round(post / 1000)}k`
                            : `compacted · from ${Math.round((ev.preTokens || 0) / 1000)}k`}
                          <span className="compact-time">{stamp(ev.ts)}</span>
                        </span>
                        <span className="compact-line" />
                      </div>
                    );
                  }
                  {/* a failed compaction says WHY, in the feed — never a silent drop */}
                  if (ev.kind === "status") return (
                    <div key={i} className="compact-mark failed">
                      <span className="compact-line" />
                      <span className="compact-chip"><CompactIcon /> compaction failed — {ev.compactError || "unknown reason"}</span>
                      <span className="compact-line" />
                    </div>
                  );
                  if (ev.kind === "session.ended") return <div key={i} className="act end">session {ev.reason}</div>;
                  return null;
                })}
                {typing && <div className="msg msg--agent typing"><Md text={typing} /></div>}
                {working && (
                  <div className="sv-status">
                    {cooking || "cooking"}
                    <span className="sv-dots"><i /><i /><i /></span>
                  </div>
                )}
              </div>
              {micOn && (
                <div className="interim">
                  <span className="interim-dot" />
                  {preview || "listening…"}
                </div>
              )}
              <form className="agent-input" onSubmit={send}>
                <textarea
                  ref={taRef}
                  className="agent-textarea"
                  rows={1}
                  value={draft}
                  placeholder={`ask the ${current.projectCode} agent`}
                  spellCheck={false}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(e); }
                  }}
                />
                <button
                  type="button"
                  className={`mic-btn ${micOn ? "on" : ""}`}
                  title={micOn ? "Stop listening" : "Dictate — speech goes into the input"}
                  onClick={toggleMic}
                >🎙</button>
                <button type="submit" className="send-btn" title="Send" disabled={!draft.trim() && !micOn}>
                  <img src={sendIcon} alt="send" />
                </button>
              </form>
            </div>
          )}
    </div>
  );
}
