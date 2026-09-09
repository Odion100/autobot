// THE SSRF GUARD, AS ASSERTIONS INSTEAD OF A COMMENT.
//
// Why this file exists, precisely: systemview-test found this exact class — a value
// off the wire deciding where the next request goes — in SystemLynx's MCP during a
// dogfood, wrote the lesson into RFC-055 as prose, and then shipped the same bug
// here three weeks later. The comment above the fix in services.cjs already names
// the class and cites the earlier find. That artifact has now failed once. Prose
// has a half-life; an assertion doesn't.
//
// WHAT IS BEING PROTECTED: `attach()` reads a service's catalog and that RESPONSE
// BODY carries `serviceUrl`, which becomes the base for every MCP handshake and
// every later `call()`. Trust it and the whitelist pins the door but not the
// destination — a compromised or merely mistaken entry redirects all subsequent
// traffic, and nothing looks wrong. The guard is that `serviceUrl` may refine the
// whitelisted address but may not leave its origin.
//
// THE TEST READS THE SHIPPED FUNCTION OUT OF THE SOURCE FILE. A retyped copy tests
// the copy — and would keep passing after someone "simplified" the real one.
//
// Run: npm run smoke:origin
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// SRC is overridable so this file can be mutation-tested: point it at a weakened
// copy and every assertion below must FAIL. A guard test that has never been shown
// to fail is decoration.
const SRC = process.env.SAME_ORIGIN_SRC || path.join(here, "..", "electron", "agents", "services.cjs");
const src = fs.readFileSync(SRC, "utf8");

let pass = 0;
const ok = (name) => { pass++; console.log(`  ok  ${name}`); };

// ---- extract the real function -------------------------------------------------
const m = src.match(/function sameOrigin[\s\S]*?\n}/);
assert.ok(m, "sameOrigin() is gone from services.cjs — the SSRF guard was removed or renamed");
const sameOrigin = eval("(" + m[0] + ")");
ok("sameOrigin() still exists and was loaded from the shipped source");

const TRUSTED = "http://localhost:6420/workbench";

// ---- THE TWO THAT CARRY THIS FILE ----------------------------------------------
// Both of these START WITH the trusted string. Any `startsWith`, `indexOf` or regex
// "simplification" of sameOrigin passes them — and then every MCP handshake and
// every call() goes to evil.com. These are the cases the bug's own author said he
// would not have thought to write, which is the whole argument for a second reader.
assert.equal(sameOrigin("http://localhost:6420@evil.com/", TRUSTED), false,
  "USERINFO BYPASS: 'localhost:6420@evil.com' has hostname evil.com — a prefix check would allow it");
ok("userinfo bypass rejected (http://localhost:6420@evil.com)");

assert.equal(sameOrigin("http://localhost:6420.evil.com/", TRUSTED), false,
  "SUFFIX BYPASS: 'localhost:6420.evil.com' is a different host that begins with the trusted string");
ok("subdomain-suffix bypass rejected (http://localhost:6420.evil.com)");

// ---- a service may refine its own address --------------------------------------
// The guard must not be so tight that honest services break; that is how a security
// control gets removed rather than fixed.
assert.equal(sameOrigin("http://localhost:6420/workbench/v2", TRUSTED), true, "a deeper path is a refinement");
assert.equal(sameOrigin("http://localhost:6420/", TRUSTED), true, "the origin root is a refinement");
ok("honest refinements of the same origin are allowed (path may change)");

// ---- every axis of the origin ---------------------------------------------------
assert.equal(sameOrigin("http://attacker.example.com/pwned", TRUSTED), false, "different host");
assert.equal(sameOrigin("http://localhost:6499/trap", TRUSTED), false, "different port");
assert.equal(sameOrigin("https://localhost:6420/x", TRUSTED), false, "different protocol");
ok("host, port and protocol are each enforced");

// ---- PINNED PROPERTY 1: 127.0.0.1 is NOT localhost ------------------------------
// This looks like a bug to someone tidying up ("they're the same machine!"). It is
// deliberate: origin comparison is textual by definition, and loosening it to
// resolve names re-opens the door this guard exists to close. If this assertion
// ever fails, the loosening was intentional and needs a decision, not a patch.
assert.equal(sameOrigin("http://127.0.0.1:6420/", TRUSTED), false,
  "127.0.0.1 must remain a DIFFERENT origin from localhost — strictness is the feature");
ok("PINNED: 127.0.0.1 is a different origin from localhost");

// ---- PINNED PROPERTY 3: multi-origin services are refused BY POLICY --------------
// Odion's call, 2026-09-09, when asked whether the guard breaks load-balanced
// SystemLynx deployments. It does — and that is fine, because THE BROWSER'S POLICY
// IS TO CONNECT DIRECTLY. A SystemLynx service may advertise other origins in its
// connectionData (legitimately: a load balancer, modules split across hosts), but
// we go past all of that and talk to the service itself, and a direct connection
// always returns that service's own connection. So an off-origin serviceUrl is not
// a topology we need to follow; it is a redirect with no reason to exist.
//
// This case therefore documents a DECISION, not a discovered behaviour. Whoever
// wants multi-origin support later should change it deliberately — the mechanism
// would be whitelisting the second origin too, so the human still names every
// address — rather than concluding this assertion was an oversight.
//
// KNOWN WART, deliberately not fixed today (his "keep it in mind, not right now"):
// on mismatch attach() keeps entry.url SILENTLY. If a service ever genuinely needed
// another origin, calls would go to the whitelisted address instead and nothing
// would error — the write-succeeds/read-disagrees shape. Making the mismatch
// visible is the follow-up; it needs no behaviour change, only a voice.
assert.equal(sameOrigin("http://lb.internal:6420/workbench", TRUSTED), false,
  "a load balancer on another origin is refused — the browser connects to the service directly");
assert.equal(sameOrigin("http://modules.internal:6420/workbench", TRUSTED), false,
  "modules advertised on another host are refused for the same reason");
ok("PINNED: multi-origin redirection refused by policy (browser connects directly)");

// ---- garbage in, false out (never a throw, never true) --------------------------
for (const bad of [null, undefined, "", "//evil.com/x", "javascript:alert(1)", "file:///etc/passwd",
                   "not a url at all", { url: TRUSTED }, 42, [], "http://"]) {
  assert.equal(sameOrigin(bad, TRUSTED), false, `must reject: ${JSON.stringify(bad)}`);
}
ok("malformed, non-string and hostile-scheme inputs all return false without throwing");

// ---- PINNED PROPERTY 2: a mismatch KEEPS the whitelisted URL, it does not throw --
// Asserted against the source, because the behaviour lives in one expression inside
// attach() and reproducing attach() here would test the reproduction. A mismatch
// must fall back to the address the human whitelisted, so an honest service with a
// sloppy serviceUrl degrades to WORKING rather than failing closed for no reason.
const guard = src.match(/const\s+serviceUrl\s*=\s*([^\n;]+);/);
assert.ok(guard, "the serviceUrl resolution line is gone from attach()");
const expr = guard[1].replace(/\s+/g, " ");
assert.ok(/sameOrigin\s*\(\s*conn\.serviceUrl\s*,\s*entry\.url\s*\)/.test(expr),
  `serviceUrl is no longer guarded by sameOrigin(conn.serviceUrl, entry.url) — found: ${expr}`);
assert.ok(/\?\s*conn\.serviceUrl\s*:\s*entry\.url/.test(expr),
  `the fallback must be entry.url (the whitelisted address), not a throw or a default — found: ${expr}`);
ok("PINNED: serviceUrl is guarded, and a mismatch falls back to the whitelisted URL");

// ---- the whitelist itself still refuses a URL as a name -------------------------
// The property systemview-test designed for: agents pass a NAME, never a URL.
assert.ok(/is not a whitelisted service/.test(src),
  "attach() no longer rejects unknown names — loadService(anyUrl) would become a privilege-escalation primitive");
ok("attach() still refuses anything not in the whitelist by name");

console.log(`\n${pass} claims held — the same-origin guard (SSRF class)\n`);
