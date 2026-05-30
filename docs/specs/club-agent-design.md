---
title: Club Agent — Design Spec
date: 2026-05-27
aliases: [club-agent-spec, kruzhki-finder-spec]
---

# Club Agent — Design Spec

**Version:** v1
**Date:** 2026-05-27
**Repo:** github.com/vill10/club-agent
**Status:** Locked.

---

## 1. Product

Club Agent is an authless public web app that helps parents in Astana find children's кружки (sport, art, music, language, coding, dance, chess, etc.) by deploying a research agent across public data sources. The user describes what they want in natural language; an agent extracts structured intent, reconnoiters across Tavily web search + 2GIS + Google Places, drafts personalized outreach messages for top candidates, and produces a shareable run URL.

**Target user:** an Astana parent or older sibling looking for activities for a child.

**Pitch:** "Tell it what you're looking for, watch the agent do the work, walk away with a sourced shortlist and ready-to-send outreach drafts."

**Scope:**
- **IN:** Astana only · children's кружки (all categories) · public-source recon · per-club confidence-annotated fields · draft-message handoff via `tg://` / `wa.me` deep links · shareable persistent run URLs
- **OUT:** auth · accounts · favorites · multi-city · UI language toggle · real Telegram bot outbound · MTProto cold-DM · photo extraction · 2GIS review summarization · BullMQ · custom skills · replay timeline scrubber

---

## 2. User flow

```
Landing
  └─ Big query box · turnstile (invisible) · daily budget meter

POST /api/runs (Turnstile + IP rate-limit + daily budget gate)
  └─ Haiku 4.5 call: extract intent → {category, age, district?, budget?, schedule?, hard_requirements[]}
  └─ Create run row in SQLite → return run id
  └─ Redirect to /runs/<id>

/runs/<id> (the main experience)
  ├─ Header: budget meter · share button
  ├─ Left:   original query + intent chips (read-only on run page; editable on landing)
  ├─ Center: SSE activity stream (auto-scroll, scroll-lockable)
  ├─ Right:  candidate cards (skeleton on creation, fields fill in as extracted, confidence badges)
  └─ Live tail of EventEmitter + replay from run_events table

Per-card actions
  ├─ Hover field → source-snippet popover
  ├─ "Send via Telegram" → tg://resolve?domain=X&text=<encoded>
  ├─ "Send via WhatsApp" → https://wa.me/X?text=<encoded>
  └─ Fallback: copy to clipboard

Run persists
  └─ /runs/<id> renders forever from SQLite (live tail or static replay)
```

### 2.1 Intent extraction with required-vs-optional

**Required (run blocked until filled):** `category`, `age`.
**Optional (improves quality):** `district`, `budget`, `schedule`, `hard_requirements[]`.

Each field returns from Haiku as `{value, present: bool, confidence}`.

- All required present → chips render filled, "Run it" enabled.
- Required missing → chip renders empty with placeholder; one-line nudge above chip row ("I need a couple more things: child's age"); "Run it" disabled until filled.
- Optional missing → chip renders as `+ Add district` (clickable, skippable).

Fundamentally underspecified queries (e.g., just "find a club") get a single conversational nudge instead of empty chips.

---

## 3. Architecture

```
┌──────────────────────────────────────────────────────────────┐
│ Browser                                                       │
│  Next.js App Router · shadcn/ui + Tailwind · EventSource(SSE) │
└──────────────────────────────────────────────────────────────┘
                            ▲
                            │ HTTPS via Cloudflare Free (L3/L4/L7 DDoS)
                            │ Turnstile token on POST /api/runs
                            ▼
┌──────────────────────────────────────────────────────────────┐
│ Hetzner CAX11 (ARM, ~$4/mo) · club-agent.duckdns.org          │
│  Caddy (auto-TLS) → Node server (Next.js, systemd-managed)    │
│    Routes:                                                     │
│      /                       landing                          │
│      /runs/[id]              run page (SSR + hydrate)         │
│      /api/runs               POST: create run, spawn agent    │
│      /api/runs/[id]/stream   GET:  SSE (replay + live tail)   │
│      /api/runs/[id]          GET:  run snapshot (JSON)        │
│    Agent loop:                                                 │
│      In-process async function spawned on POST.                │
│      Persists events to SQLite.                                │
│      Fans out via per-run EventEmitter.                        │
│  better-sqlite3 → /var/data/club-agent.sqlite                  │
└──────────────────────────────────────────────────────────────┘
                            │
                            ▼
   Anthropic API · Tavily · Google Places · 2GIS · fetch(url)
```

**Decoupling pattern:** POST `/api/runs` returns 202 + run id immediately. Async agent function persists events. Multiple SSE clients can connect to `/api/runs/<id>/stream`; they get replay of past events + tail of live ones via the per-run EventEmitter. Solves tab-close, page-refresh, and multi-viewer cases in one mechanism.

### 3.1 Tech stack lock

| Layer | Choice | Rationale |
|---|---|---|
| Framework | Next.js (App Router) | MIT, runs anywhere, RSC support |
| UI primitives | shadcn/ui + Tailwind | Non-Vercel, source-owned components |
| Agent loop | Anthropic Agent SDK (TS) | Built-in tool loop, hooks, subagents, MCP, prompt caching |
| DB | better-sqlite3 (sync API) | Solo MVP, file on disk, identical SQL to libSQL for future migration |
| Telegram | (none) | Draft + tg:// deep-link handoff. No bot needed. |
| Web search | Tavily | 1000 free credits/mo, no card, LLM-friendly output, student-tier eligible |
| POI data | Google Places + 2GIS demo key | Dual provider; Google for breadth, 2GIS for Astana depth |
| Web server | Caddy | Auto-TLS via Let's Encrypt, one config file |
| Process mgr | systemd | No extra dep |
| Host | Hetzner CAX11 (ARM, €3.79/mo) | 2 vCPU / 4 GB / 40 GB NVMe / 20 TB traffic; abuse-protection headroom |
| CDN/WAF | Cloudflare Free | L3/L4/L7 DDoS; required for public authless app |
| Bot mitigation | Cloudflare Turnstile | Free, gates expensive endpoints |
| DNS | DuckDNS | Free subdomain `club-agent.duckdns.org`, Let's Encrypt-compatible |
| Orchestrator model | Sonnet 4.6 | Planning, ranking, match-reason writing |
| Worker model | Haiku 4.5 | Intent extraction, field extraction, message drafting |

---

## 4. Data model (SQLite)

```sql
-- One row per query
CREATE TABLE runs (
  id              TEXT PRIMARY KEY,         -- nanoid
  created_at      INTEGER NOT NULL,         -- unix seconds
  raw_query       TEXT NOT NULL,
  intent_json     TEXT NOT NULL,            -- {category, age, district, budget, schedule, hard_requirements[]}
  status          TEXT NOT NULL,            -- running | complete | failed | budget_exhausted
  finished_at     INTEGER,
  cost_usd        REAL,                     -- accumulated Anthropic cost
  client_ip_hash  TEXT NOT NULL             -- sha256(ip + daily_salt). Raw IP never stored.
);

-- Append-only event log; source of truth for replay
CREATE TABLE run_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id          TEXT NOT NULL REFERENCES runs(id),
  ts              INTEGER NOT NULL,
  kind            TEXT NOT NULL,            -- tool_call | tool_result | thinking | message | card_update | final | error
  payload_json    TEXT NOT NULL
);
CREATE INDEX run_events_by_run ON run_events(run_id, id);

-- Denormalized snapshot of each candidate; rebuilt from events
CREATE TABLE cards (
  id              TEXT PRIMARY KEY,
  run_id          TEXT NOT NULL REFERENCES runs(id),
  name            TEXT NOT NULL,
  district        TEXT,
  address         TEXT,
  contacts_json   TEXT,                     -- [{channel, value, confidence, source}]
  schedule_json   TEXT,
  price_range     TEXT,
  age_range       TEXT,
  match_reason    TEXT,
  draft_message   TEXT,
  rank            INTEGER,
  fields_json     TEXT NOT NULL             -- {field: {value, confidence, source_snippet}}
);
CREATE INDEX cards_by_run ON cards(run_id, rank);

-- Daily budget counter (one row per UTC day)
CREATE TABLE budget_ledger (
  day             TEXT PRIMARY KEY,         -- YYYY-MM-DD UTC
  cost_usd        REAL NOT NULL DEFAULT 0,
  runs_count      INTEGER NOT NULL DEFAULT 0
);

-- Per-IP-hash rate-limit counter
CREATE TABLE ip_ledger (
  ip_hash         TEXT NOT NULL,
  day             TEXT NOT NULL,
  hour            INTEGER NOT NULL,
  count           INTEGER NOT NULL,
  PRIMARY KEY (ip_hash, day, hour)
);
```

**Notes:**
- `client_ip_hash = sha256(ip + daily_salt)`. `daily_salt` rotates UTC midnight via env-var secret; cross-day correlation impossible.
- No `users` table. Authless.
- Events are durable; cards are a denormalized projection rebuilt on write for fast SSR.

---

## 5. Agent loop

### 5.1 Two-tier model routing

- **Orchestrator (Sonnet 4.6):** plans, ranks, writes match-reasons, decides finalization. Sees full conversation + tool results.
- **Workers (Haiku 4.5) dispatched as subagents:** intent extraction, per-club field extraction from raw HTML, outreach drafting. Cheap, parallel, isolated context.

Per-subagent `model:` field set explicitly. No Opus.

### 5.2 Tools exposed to orchestrator

| # | Tool | Purpose |
|---|---|---|
| 1 | `search_web(query)` | Tavily; top-10 results + snippets |
| 2 | `query_2gis(category, district?)` | 2GIS Places by rubric, Astana lat/lng locked |
| 3 | `query_google_places(query)` | Google Places text search, Astana bbox |
| 4 | `fetch_url(url)` | HTML → clean markdown via Mozilla Readability; length-capped 2MB |
| 5 | `extract_fields(html_or_text, card_id)` | Haiku subagent → `{field: {value, confidence, source_snippet}}` |
| 6 | `draft_outreach(card_id)` | Haiku subagent → 2–3 sentence Russian DM personalized to club + intent |
| 7 | `emit_card_update(card_id, partial)` | Persists card delta to SQLite + fires SSE event |

### 5.3 Recon playbook (system prompt procedure)

```
1. Read intent. Build 2-3 search queries combining category + Astana + age band.
2. Parallel: search_web + query_2gis + query_google_places.
3. Deduplicate candidates by name + address fuzzy match. Target 10-15 unique.
4. For each candidate in parallel batches of 3:
   a. fetch_url(primary site or 2GIS profile)
   b. extract_fields → partial card persisted, SSE event fired
   c. If contacts missing, search_web "<name> Astana telegram instagram"
   d. Re-extract if richer sources found
5. Score + rank by intent match (age, district, schedule, budget, contact-channel availability).
6. Pick top 5-8.
7. For each: draft_outreach.
8. Emit final ranked list with match-reasons. Done.
```

### 5.4 Prompt caching layout

```
[cached]  Tool definitions       (largest, never mutates)
[cached]  System prompt + playbook
[cached]  Intent JSON for this run
[live]    Streaming conversation
```

Cache prefix ordered tools → system → messages. Immutable across turns. Rides 5-minute TTL. Cache reads cost 10% of base.

### 5.5 Budget guards (Anthropic SDK hooks)

- **PreToolUse hook:** if `budget_ledger[today].cost_usd >= daily_cap` → kill the run with `status='budget_exhausted'`. Finalize whatever cards exist. Render banner on `/runs/<id>` page.
- **PostToolUse hook:** accumulate Anthropic usage headers into `runs.cost_usd` and `budget_ledger.cost_usd`.
- **Per-run token safety stop (not a budget):** if the **sum of tokens across the orchestrator and all subagents dispatched within a single run** exceeds **200k**, finalize early with a "safety stop reached" banner. Circuit breaker against pathological runs.
- **Daily global cap (env-configurable):** start at **$3 USD/day**. Soft warning rendered on landing at 70%. Hard stop at 100% returns "Daily budget reached" page for new POSTs. In-flight runs not killed.

### 5.6 Failure handling

- Tool error → orchestrator decides retry vs. skip. Logged as `error` event.
- Anthropic 5xx → one backoff retry, then `status='failed'`.
- 2GIS rate-limit → fall back to Google Places, log warning event.

---

## 6. UX patterns

### 6.0 Design system (visual identity)

**Direction:** Warm-minimal, dark-first, violet accent. Clean modern structure (generous whitespace, clear hierarchy, subtle motion) softened with warmth (rounded corners, soft violet-tinted glows instead of hard borders, friendly microcopy). 2026 AI-product feel, approachable rather than cold.

**Decisions:** mood = clean-modern + warm-friendly (combined) · accent = violet/purple · type = geometric sans · theme = dark default.

These concrete tokens are the source for `DESIGN.md` and the Tailwind config. All colors OKLCH, no pure black/white, single accent ≤10% of screen (impeccable rules).

#### Color tokens (OKLCH)

```
/* Surfaces — near-black with a violet warmth, never pure black */
--bg              oklch(0.18 0.02 290)   /* app background */
--surface         oklch(0.22 0.025 290)  /* cards, panels */
--surface-raised  oklch(0.26 0.03 290)   /* popovers, modals, raised cards */
--border          oklch(0.32 0.02 290)   /* hairlines (use sparingly; prefer glow/elevation) */

/* Text — off-white, never pure white */
--text            oklch(0.96 0.01 290)   /* primary */
--text-muted      oklch(0.72 0.015 290)  /* secondary, captions */
--text-faint      oklch(0.55 0.015 290)  /* dim activity-stream rows, timestamps */

/* Accent — violet, the single signature color (≤10% of screen) */
--accent          oklch(0.62 0.19 295)   /* primary buttons, active states, links */
--accent-hover    oklch(0.68 0.19 295)
--accent-subtle   oklch(0.30 0.08 295)   /* tinted backgrounds, active chip fill */
--accent-glow     oklch(0.62 0.19 295 / 0.25) /* soft glow on raised/active surfaces */

/* Semantic — desaturated to sit on dark */
--success         oklch(0.70 0.15 150)
--warning         oklch(0.78 0.14 75)
--error           oklch(0.65 0.18 25)
```

#### Typography

- **Family:** Plus Jakarta Sans (geometric, subtly warm, OFL-licensed via Google Fonts). Non-Vercel — deliberately avoids Geist to honor the no-Vercel constraint. Fallback stack: `"Plus Jakarta Sans", system-ui, sans-serif`.
- **Headings:** tighter tracking (-0.01em to -0.02em), weight 600–700.
- **Body:** line-height 1.6, weight 400–500.
- **Numerals:** tabular-nums for the budget meter and any counts.

#### Spacing — 7-step scale (impeccable)

`8 · 16 · 24 · 32 · 48 · 80 · 120` px. The 4px step is intentionally omitted. Density is comfortable/airy, not Linear-compact — fits the approachable side of the mood.

#### Radius — the primary "warmth" lever

```
--radius-pill     9999px   /* intent chips, contact badges, tags */
--radius-card     14px     /* candidate cards, panels */
--radius-control  10px     /* buttons, inputs */
```

Generous rounding is what keeps an otherwise modern dark layout from reading cold.

#### Elevation & depth

Prefer **soft, diffuse, low-opacity violet-tinted shadows/glows** over hard borders to separate surfaces on dark. Active and hovered elements get a subtle `--accent-glow`. Borders only where a hairline genuinely aids scanning.

#### Motion

- **transform + opacity only.** No layout-shifting animation. `prefers-reduced-motion: reduce` honored everywhere (impeccable mandatory).
- **3 named easings:** `ease-out` (entrances), `ease-in-out` (state changes), `ease-in` (exits). No bounce.
- **Signature motion — activity stream:** each new SSE event row slides+fades in (translateY 8px → 0, opacity 0 → 1, 240ms ease-out). This is the visual centerpiece; it should feel calm and continuous, not janky.
- **Cards:** skeleton shimmer on creation → field values fade in (160ms) as extraction completes.

#### Theme

Dark default. Light theme is **out of scope for v1** (deferred to v2 per §9) — ship dark only, do not build a toggle. (The token structure above supports a light override set later with no structural change.)

### 6.1 Three-panel run-page layout

```
┌─ Header (sticky) ─────────────────────────────────────────┐
│  logo  ·  daily budget meter  ·  share button             │
├─────────────┬───────────────────────┬─────────────────────┤
│ Intent      │ Activity stream       │ Candidate cards     │
│ (left)      │ (center)              │ (right)             │
│             │                       │                     │
│ Original    │ Live SSE events:      │ Skeleton on create, │
│ query +     │  🔍 Searching 2GIS    │ fields fill in as   │
│ read-only   │  📍 14 candidates     │ extraction completes│
│ chips       │  🌐 Fetching X...     │ Confidence badges   │
│             │  💬 Drafting outreach │ inline. Source      │
│             │  ✅ Run complete      │ snippets on hover.  │
└─────────────┴───────────────────────┴─────────────────────┘
```

Mobile <768px: single column. Stream collapses to sticky bottom drawer. Cards stack. Breakpoints 320 / 375 / 414 / 768 per impeccable rule set.

### 6.2 SSE event taxonomy → UI rows

| Event kind | Render | Style |
|---|---|---|
| `tool_call` | `🔍 Searching 2GIS` | dim, italic, spinner badge |
| `tool_result` | `📍 14 candidates found` | normal, count badge |
| `card_update` | `🌐 Extracted contact for Olymp Swim Club` | clickable, scrolls to card |
| `thinking` | `🤔 Ranking by district fit` | dim, low-key |
| `error` | `⚠️ 2GIS rate-limited, falling back` | amber, persistent |
| `final` | `✅ Run complete — 7 clubs found` | green, anchored at top |

**Mandatory:** every active `tool_call` shows a spinner-tagged in-flight row until its `tool_result` arrives. Missing spinner = UI looks frozen.

### 6.3 Candidate card

```
┌───────────────────────────────────────────────────────────┐
│  [rank #3]  Olymp Swim Club                        ⓘ ⋮    │
│  📍 Saryarka district · Тауелсіздік даңғ. 17              │
│                                                            │
│  ⏰ Mon/Wed/Fri 18:00–19:30   [low confidence: inferred]  │
│  💰 ≈ 25 000 ₸/month                                       │
│  👶 Ages 6–14                                              │
│                                                            │
│  Match: Indoor Olympic-size pool, left bank, evening       │
│  schedule fits the after-school window you mentioned.      │
│                                                            │
│  Contacts:                                                 │
│    📞 +7 700 123 4567   [Send WhatsApp →]                  │
│    💬 @olymp_swim_astana [Send Telegram →]                 │
│                                                            │
│  ▼ Draft outreach (click to expand)                        │
│                                                            │
│  Sources: 2gis.kz/astana/firm/123 · instagram.com/...      │
└───────────────────────────────────────────────────────────┘
```

- **Confidence badges** appear for any field with `confidence < high`. Hover → popover shows the extracted source snippet.
- **Send buttons:** `<a href="tg://resolve?domain=X&text=Y">` and `<a href="https://wa.me/X?text=Y">`. Pure deep links. No bot account.
- **Sources:** clickable URLs to the actual pages the agent visited.
- **Skeleton state:** name + district appear first (from search), other fields fade in as extraction completes.

### 6.4 Intent chips

- **Landing page (pre-run):** chips editable inline. Click → input replaces chip → enter to commit. Required-empty renders red dot. Run-it disabled until required filled.
- **Run page (post-run):** chips render as static read-only pills.

### 6.5 Design discipline files (project root)

| File | Purpose |
|---|---|
| `DESIGN.md` | Google Labs spec: YAML design tokens (color OKLCH, spacing, type, motion) + Markdown rationale. Drives Tailwind config. |
| `STYLE.md` | Banned words / structures for UI copy: no "seamless", "load-bearing", "robust", "elevate", "empower", "delve", "tapestry"; no em-dashes; no triadic lists in marketing strings; no negation pivots. |
| `impeccable.md` | Excerpt of the 106 design rules: OKLCH-only colors, no pure black/white, single accent ≤10% of screen, 7-step spacing 8/16/24/32/48/80/120, transform+opacity-only animations, prefers-reduced-motion mandatory, 3 named easings. |
| `.hallmark/log.json` | Slop-test gates run pre-emit on generated UI components. Pre-emit 6-axis score (Philosophy/Hierarchy/Execution/Specificity/Restraint/Variety) must be ≥3 per axis. |

CI gate: `npx @google/design.md lint` on `DESIGN.md`.

---

## 7. Abuse protection

Defense in depth, cheapest first.

| Layer | Mechanism | Catches |
|---|---|---|
| 1 | Cloudflare Free in front | L3/L4 floods, L7 garbage, country block if abused |
| 2 | Turnstile on POST `/api/runs` | Headless bots, scripted abuse |
| 3 | Per-IP-hash rate limit | Single-IP loops |
| 4 | Daily USD budget cap | Aggregate cost runaway |
| 5 | Per-run 200k token safety stop | Pathological single-run cost |
| 6 | Input validation | Injection, oversized payloads, SSRF |
| 7 | Kill switch env var | Operator halt |

### 7.1 Per-IP rate limits (env-configurable)

- **3 runs / hour per ip_hash**
- **8 runs / day per ip_hash**
- Hit limit → 429 + `Retry-After` header + friendly UI message.

### 7.2 Turnstile

- Renders invisibly on landing page.
- Token sent with POST `/api/runs`.
- Server verifies via Cloudflare `/siteverify` with secret.
- No token = 403.

### 7.3 Input validation (POST `/api/runs`)

```
raw_query:        string, 3 ≤ length ≤ 500, control-char sanitized
turnstile_token:  string, verified against /siteverify
```

### 7.4 SSRF protection on `fetch_url`

- Whitelist `https://` only.
- Block private IP ranges (RFC1918), localhost, link-local (169.254/16), cloud metadata (169.254.169.254).
- Resolve DNS first; check resolved IP against blocklist before fetching.
- 10s timeout, 2 MB response cap.
- Identifying User-Agent.

### 7.5 Telegram / WhatsApp deep-link sanitization

- Message text `encodeURIComponent`'d before insertion into `tg://` or `wa.me`.
- No HTML, no JS in deep-link payload.
- Drafted message visible to user in UI before they tap "Send".

### 7.6 Kill switch

- Env var `APP_DISABLED=true` → all POST endpoints return 503 with operator message. GET `/runs/[id]` still renders (read-only).
- Toggle via SSH: `sudo systemctl set-environment APP_DISABLED=true && sudo systemctl reload club-agent`. Under 30 seconds.

### 7.7 Logging discipline

- Access logs: 24h retention, IP-hashed only.
- Agent-loop event logs: persisted with run, scoped to run-internal data.
- Anthropic API bodies: never persisted beyond what's already in `run_events.payload_json`.

### 7.8 Explicit non-defenses

- Sophisticated distributed bot networks running real browsers + solving Turnstile. If this happens at portfolio-demo scale, raise cap or take offline.
- API key abuse from outside the deployed app. Mitigated by key being deployed-only and never committed to git.

---

## 8. Public repo discipline

**Repo:** github.com/vill10/club-agent · public · MIT.

### 8.1 Secrets policy

- `.gitignore` excludes `.env`, `.env.local`, `*.sqlite`, `node_modules`, `.next`, `*.key`, `*.pem`.
- `.env.example` committed with placeholder values for every required variable.
- **Pre-commit hook running `gitleaks`** scans for accidentally-committed secrets. Configured day-0.
- All runtime secrets live in `/etc/club-agent.env` on Hetzner, sourced by systemd. Never on a dev machine outside `.env.local`.

### 8.2 Required env vars (placeholders in `.env.example`)

```
ANTHROPIC_API_KEY=
TAVILY_API_KEY=
GOOGLE_PLACES_API_KEY=
TWOGIS_API_KEY=
TURNSTILE_SITE_KEY=
TURNSTILE_SECRET_KEY=
DAILY_BUDGET_USD=3
PER_IP_RUNS_PER_HOUR=3
PER_IP_RUNS_PER_DAY=8
IP_HASH_DAILY_SALT=
APP_DISABLED=false
DATABASE_PATH=/var/data/club-agent.sqlite
```

### 8.3 README structure

1. Hero gif / screenshot
2. Live link → `https://club-agent.duckdns.org`
3. Three reference run URLs ("see what the agent did here")
4. One-paragraph product pitch
5. Architecture ASCII diagram (from §3)
6. Stack list with rationale (from §3.1)
7. Local dev setup
8. License: MIT

---

## 9. Non-goals (out of scope for v1)

| Out of scope | Reason | When to revisit |
|---|---|---|
| Auth / accounts / profiles | Authless by design | Never for this app |
| Saved searches / favorites | User model adds complexity | v2 if traffic warrants |
| Inbound reply notifications | No bot, replies happen in user's personal Telegram | v2 (would need bot + auth) |
| Multi-city | Astana only | v2 |
| Russian + Kazakh + English UI toggle | Russian-only UI | v2 |
| Direct bot-mediated Telegram outbound | Telegram bot ToS / cold-DM blocker | Permanent OUT |
| MTProto user-account autoposting | Ban risk on public portfolio | Permanent OUT |
| Photo extraction | Failure rate too high | v2 |
| 2GIS review summarization | Out of medium-card scope | v2 |
| BullMQ + Redis | In-process async sufficient at MVP scale | When concurrent runs > ~5 |
| Replay timeline scrubber | UI cost too high | v2 |
| Custom skills written for this project | Skill-creation ROI negative on a short build window | If patterns emerge in v2/v3 |
| Photo / OG-card preview for shared runs | Nice-to-have | v2 — easy add |

---

## 10. Open decisions deferred to implementation

Decisions sized small enough to lock during writing-plans / day-0 setup rather than spec rewrites:

| Decision | Default |
|---|---|
| Domain name | `club-agent.duckdns.org` (DuckDNS free subdomain) |
| Anthropic model exact versions | Sonnet 4.6 latest, Haiku 4.5 latest |
| Web search provider | Tavily |
| Web search fallback if Tavily blocks | Brave Search ($5/mo free credit, requires card) |
| Daily salt rotation source for IP hash | UTC midnight + 32-byte env-var secret |
| Telegram deep-link fallback when no handle found | Instagram DM web link + copy-to-clipboard for phone |
| nanoid length for run ids | 10 chars (≈59 bits entropy) |

---

## 11. Success criteria for v1

- Live at `https://club-agent.duckdns.org` with valid TLS.
- A reviewer (no prior context) can land, type "плавание для 8-летнего", and get a run page with ≥5 ranked candidates inside 3 minutes.
- Each card has at minimum: name, district, ≥1 contact channel, match-reason, source citation.
- "Send via Telegram" and "Send via WhatsApp" buttons open the user's native app with the message pre-filled.
- The shareable `/runs/<id>` URL replays the full agent activity for anyone with the link.
- Daily budget cap enforced; 429s served past per-IP rate limits.
- Public GitHub repo readable, gitleaks pre-commit installed, no secrets in history.
- README sells the project clearly enough that a school-application reviewer understands the work.

---

## 12. Risks and mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| 2GIS demo key gets rate-limited or expires mid-demo | M | Fall back to Google Places only; log warning event |
| Tavily 1000/mo credit insufficient during virality spike | L | Apply for Tavily student tier; brave-search fallback |
| Anthropic API spend exceeds $3/day | L | Hard daily cap; in-flight runs not killed; banner shown |
| Hetzner instance compromised | L | Cloudflare in front; SSH key-only auth; UFW firewall to ports 22/80/443; fail2ban; gitleaks pre-commit; PAT-rotation policy |
| Telegram deep-link payload XSS | L | `encodeURIComponent` on user-controllable text; CSP headers |
| SQLite write contention under load | L | Single Node process; sync better-sqlite3 fine for solo MVP; tiny serialization queue if needed |
| DuckDNS service outage | L | Stable subdomain w/ refresh cron; can swap to alternative free DDNS in 5 min if needed |

---

## 13. Build budget

- **Claude Code Max plan** for build-time work.
- **Estimated production API spend during build:** $5–15 across testing and demo runs.
- **Recurring ops cost post-launch:** Hetzner €3.79/mo + Anthropic API pay-per-token (capped at $3/day = max $90/mo at full saturation; realistic ~$5–20/mo at portfolio-demo traffic).

---

_End of spec._
