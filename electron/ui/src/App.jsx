import React, { useEffect, useState } from "react";

// The shell chrome. Left corner = the app you're IN (logo + name, click to open the
// switcher). Arrows, then the address as subtle text. Brand rides the far right.
// Web content renders in native views the main process positions beside the chrome.
export default function App() {
  const [state, setState] = useState({ tabs: [], apps: [], activeId: null });
  const [urlDraft, setUrlDraft] = useState(null);
  const [dockOpen, setDockOpen] = useState(false);

  useEffect(() => {
    const off = window.autobot.onState(setState);
    window.autobot.tabs("state").then(setState);
    return off;
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
        <span className="brand-right"><StellarMark /> <span>autobot</span></span>
      </div>

      <AgentBubble />
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

// Placeholder for SystemView's hovering agent (lands with the IDE milestone) —
// already movable and click-to-open so the surface is familiar from day one.
function AgentBubble() {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: window.innerWidth - 76, y: 8 });
  const drag = React.useRef(null);

  const onPointerDown = (e) => {
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y, moved: false };
    e.target.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!drag.current) return;
    drag.current.moved = true;
    setPos({ x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy });
  };
  const onPointerUp = () => {
    if (drag.current && !drag.current.moved) setOpen((o) => !o);
    drag.current = null;
  };

  return (
    <>
      <div
        className="agent-bubble"
        style={{ left: pos.x, top: pos.y }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        ◍
      </div>
      {open && (
        <div className="agent-panel" style={{ left: Math.min(pos.x, window.innerWidth - 300), top: pos.y + 44 }}>
          <div className="agent-panel-title">autobot</div>
          <p>The agent moves in with the IDE milestone — SystemView's hovering pattern, full page context.</p>
        </div>
      )}
    </>
  );
}
