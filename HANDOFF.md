# Spain Destination Guide + Trip Assistant — Handoff

Single-file HTML app: a Kensington Tours Spain Destination Certification guide with an
embedded "Trip Assistant" panel. Built entirely through chat-based edits to one large
HTML file (~13,000 lines). Moving to Claude Code for a saner dev loop — this doc is
everything that thread-based development discovered the hard way, so it doesn't get
re-discovered by trial and error.

## What's in this folder
- `Spain_Destination_Guide.html` — the real file. Everything else is scaffolding.
- `diagnostic-tools/api-test.html` — minimal one-button test: does this environment's
  fetch-to-Claude bridge work at all? No guide, no dependencies.
- `diagnostic-tools/mic-test.html` — minimal test: does microphone access work in this
  environment? Tests permission and speech recognition separately.

Both diagnostic tools were essential during debugging — when something in the live-AI
layer breaks, test with these FIRST before touching the main file. Isolating the
variable found three real bugs faster than debugging the full file each time.

## Architecture — two layers, deliberately separate

**Offline rule-based engine** (always available, instant, free, works even as a plain
downloaded HTML file with no network):
- `QB_HOTELS` / `QB_RESTAURANTS` / `QB_TOURS` — structured per-city data (10 cities:
  Madrid, Barcelona, Valencia, Seville, Granada, Córdoba, Marbella, Toledo, San
  Sebastián, Bilbao)
- `QB_DIET_INFO` / `QB_TOUR_DIET_INFO` — dietary tagging layer (vegetarian/vegan/
  kosher/gluten-free), confirmed-vs-heuristic, never guesses kosher (only Zerta in
  Barcelona is confirmed kosher-certified anywhere in this guide)
- `SPAIN_WEATHER` — per-city weather data from the guide's own "Weather at a Glance"
  table
- `KT_LIVE_ITINERARIES` — the 16 real, live kensingtontours.com itineraries (title,
  route, duration, price, link) — ground truth for "what does Kensington actually
  sell"
- `TRIP_PLANNER_PINS` + `qbRouteMapSvg()` — the interactive map (click cities → find
  closest official itinerary + personal recs), also reused to render inline route
  maps in chat
- Quote Builder (`runQuoteBuilder`, `qbCreateStopEl`, etc.) — the manual form-based
  itinerary builder, still fully functional
- Trip Assistant's pattern-matching (`handleResult`, `wantsScenarioBuild`, etc.) —
  free-text parsing for known patterns (multi-city scenario requests, email
  templates, guide Q&A via `SEARCH_INDEX`)

**Live AI layer** (real Claude API calls, only works under specific conditions — see
below):
- `callClaudeAI(messages, extraSystemNote, mcpServers, progressDiv)` — the core
  engine. Gives the model tools: `search_guide` (searches `SEARCH_INDEX`),
  `get_city_data` (structured ground truth — same data the offline engine uses, not
  lossy prose search), `find_matching_itinerary` (scores the real 16 KT itineraries
  by city overlap + day count), plus native `web_search`.
- Reached via: the "💬 Just Type — Skip Voice" button (direct entry, bypasses offline
  matching entirely), Conversation Mode (voice, currently non-functional — see
  below), the "🧠 Actually think this through" escalation button when offline
  matching fails, the itinerary-polish chip, the follow-ups chip (Outlook calendar).
- **Deliberately NOT the default for the plain text input** — that still runs the
  offline engine first, to keep routine matched requests free and instant. This was
  an explicit design choice after the person found the offline-first routing
  confusing; the direct-entry button exists specifically to guarantee reaching live
  AI without ambiguity.

## Critical environment constraints — learned the hard way, don't relearn these

1. **The live AI layer ONLY works when this file is viewed as a live Claude
   artifact** (rendered in-app, with "Create AI-powered artifacts" on in Settings) —
   **NOT** when downloaded and opened locally (`file://`). A downloaded copy gets a
   generic `TypeError: Failed to fetch` — no bridge, no injected credentials, dead
   end. This is not fixable in code; it's how the artifact-to-API bridge is
   architected. The offline engine works fine either way.

2. **Never attach `AbortSignal`/`AbortController` to the `fetch()` call to
   `api.anthropic.com`.** This environment relays that fetch across a `postMessage`
   bridge to a parent frame with real credentials (the artifact iframe can't call
   the API directly). `postMessage` requires structured-cloneable data, and
   `AbortSignal` isn't cloneable — attaching one breaks **every** request instantly
   with `DataCloneError: ... AbortSignal object could not be cloned`, not just slow
   ones. This was a real regression introduced while adding a timeout feature. If you
   need a timeout, use `Promise.race()` against a plain `setTimeout` promise instead
   — never touch fetch's own `signal` option.

3. **Microphone access is blocked in the in-app preview iframe** (`NotAllowedError:
   Permission denied` on `getUserMedia`). This is a permission-delegation issue at
   the hosting-frame level, not fixable from inside the HTML. Speech *output*
   (`speechSynthesis`) is a separate, unrelated API and works fine — so Conversation
   Mode has a typed fallback (`convoVoiceBlocked` state) that still reasons with live
   AI and speaks the reply aloud, just without listening. Untested: whether a
   "pop out to full tab" view (if the hosting interface offers one) would get normal
   top-level mic permissions and actually fix voice input — worth trying before
   assuming it's a permanent ceiling.

4. **Tool call inputs from the model don't reliably match the declared JSON schema.**
   A `cities: {type: 'array'}` parameter was sent as a bare string at least once,
   crashing `.filter()`/`.map()` calls downstream. Always normalize tool inputs
   defensively (see `normalizeCitiesInput()`) rather than trusting the schema.

5. **Wrap the ENTIRE tool-use round in try/catch, not just the fetch call.** An
   uncaught exception in tool-dispatch code (after the network call succeeds) causes
   a silent, permanent hang — the promise never resolves or rejects usefully, no
   error shown, typing indicator frozen forever. This is worse than a visible error.
   Every code path in `callClaudeAI` should return `{text, error}`, never throw past
   its own boundary. Callers should also have `.catch()` backstops as defense in
   depth.

6. **Multi-tool requests can legitimately need more round trips than expected.**
   Building a real itinerary can require `find_matching_itinerary` +
   `get_city_data` + occasionally a retry variant + `search_guide` — the round cap
   was raised from 4 to 7 after a well-specified request legitimately exhausted 4.
   When the cap IS hit, don't just discard everything and blame the user's phrasing
   — force one final no-tools call that synthesizes an answer from whatever was
   already gathered (see the fallback at the end of `callClaudeAI`).

7. **AI-powered artifacts don't carry separate per-call billing** — they draw on the
   viewer's existing Claude.ai plan usage limits, not metered API tokens. Relevant if
   usage/cost questions come up again.

## Design decisions worth preserving, not "helpfully" changing

- **Outlook integration is deliberately read+draft only, never send.** Uses
  `outlook_create_draft`, explicitly never `outlook_send_draft`, in both the system
  prompt and the tool-use instructions. Recipients are left blank for the person to
  fill in and review before sending. Don't "improve" this into auto-send.
- **Kosher is never inferred from "vegetarian."** Only Zerta (Barcelona) is tagged
  kosher-certified anywhere in the data. "Jewish" mentioned without "kosher" is
  treated as a heritage-site interest (Toledo's/Córdoba's Judería), not a dietary
  assumption — and the AI is instructed to say so explicitly rather than silently
  picking an interpretation.
- **Official Kensington itineraries are the anchor for any recommendation, personal
  picks are layered on top and explicitly flagged** ("💡 Personal Recommendation —
  not part of the official itinerary"). This applies both in the offline map tool
  and the live AI. Don't blend them together unmarked.
- **The three real Kensington tiers are Discovery, Premier, Luxe.** The model
  invented "Deluxe" once — it's not real. The system prompt now states the three
  real names explicitly.

## Known open items / where this thread left off

- The round-cap fix (4→7) plus the "force a final answer instead of giving up" fallback
  was just made and syntax-verified, but not yet tested against a live scenario in
  the actual app.
- Voice input (listening) is confirmed non-functional in the in-app preview due to
  mic permission blocking. Worth testing a "pop out to full tab" view if the hosting
  interface has one — untested, might resolve it.
- Google Drive MCP integration (`TA_DRIVE_MCP`) is wired but was never successfully
  test-called the way Outlook/Calendar was (no Drive tool was available to test with
  directly in the prior chat environment) — verify it actually works before relying
  on it.
- Personal recommendations layer (`get_city_data`, `find_matching_itinerary`) has been
  logic-tested in Node against real data (confirmed correct output), but not yet
  observed end-to-end through an actual live model response in the app.
- Latency is inherent to the multi-round-trip architecture (2-3+ real API calls per
  rich itinerary request) — a real cost of genuine reasoning vs. the offline engine's
  instant pattern matching, not something to chase away entirely. The offline engine
  remains available as an explicit fast path.

## How to verify changes before shipping (the discipline that caught every real bug
## in this thread)

1. Syntax-check the specific `<script>` tag you edited in isolation with
   `node --check` — this file has 18 script tags; extract precisely (handle
   `<script type="...">` variants, don't assume `<script>` with no attributes).
2. For logic changes, extract the relevant function + its real data dependencies and
   run it against a realistic input in Node before touching the actual file — this
   caught the diet-tagging logic, the itinerary-matching logic, and the
   cities-as-bare-string bug, all before they reached the person.
3. For anything touching the fetch-to-Claude call itself, test with
   `diagnostic-tools/api-test.html` (or a deliberately modified copy testing the
   specific new pattern) BEFORE editing the main file. This is exactly how the
   AbortSignal regression was caught and fixed same-session instead of becoming a
   multi-day mystery.
