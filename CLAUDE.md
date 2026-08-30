# Kensington Tours — Spain Destination Guide + Trip Assistant ("Jarvis")

Single-file HTML app: a Kensington Tours Spain Destination Certification guide
with an embedded AI trip-planning assistant. Built originally through
chat-based edits in claude.ai (as an "AI-powered artifact"); now developed
here in Claude Code. Read `HANDOFF.md` first — it's the field-tested record of
everything that broke and got fixed before the move here, and the "don't
relearn this the hard way" list still applies verbatim.

## Files

- `Spain_Destination_Guide.html` — the app. ~14,000 lines, single file, no
  build step. Everything else is scaffolding around it.
- `HANDOFF.md` — history of hard-won fixes and design decisions from the
  chat-based development phase. Verified current against the file as of the
  move to Claude Code (see "Verified state" below).
- `diagnostic-tools/api-test.html` — isolated test: does this environment's
  fetch-to-Claude bridge work? No guide, no dependencies.
- `diagnostic-tools/mic-test.html` — isolated test: does microphone access +
  speech recognition work in this environment?

Use the diagnostic tools FIRST whenever something in the live-AI or voice
layer breaks, before touching the 14k-line main file.

## Architecture (see HANDOFF.md for full detail)

Two deliberately separate layers:
1. **Offline rule-based engine** — structured per-city data (`QB_HOTELS`,
   `QB_RESTAURANTS`, `QB_TOURS`, dietary tagging, weather, the 16 real KT
   itineraries, the interactive route map, the Quote Builder). Instant, free,
   works with no network.
2. **Live AI layer** (`callClaudeAI`) — real Claude API calls with tools
   (`search_guide`, `get_city_data`, `find_matching_itinerary`, native
   `web_search`, Outlook draft creation). Only reachable via specific entry
   points (direct-entry button, escalation button, itinerary polish, voice).
   **Only works when this file is viewed as a live Claude artifact** — a
   downloaded/local copy has no API bridge and the offline engine is the only
   thing that runs.

## Verified state (last checked when this file was written)

All 14 inline `<script>` tags pass `node --check`. The following fixes/rules
described in `HANDOFF.md` are confirmed present in the code, not just
documented:
- No `AbortSignal`/`AbortController` on the `fetch()` to `api.anthropic.com`
  (would break the `postMessage` bridge — see HANDOFF §2).
- Tool-use round cap is 7 (raised from 4), with a forced final no-tools
  synthesis call when the cap is hit.
- `normalizeCitiesInput()` exists and defensively normalizes tool-call input.
- Outlook integration uses `outlook_create_draft` only; `outlook_send_draft`
  is explicitly never called, and this is stated in the system prompt.
- The three real KT tiers (Discovery, Premier, Luxe) are the only tier names
  used for actual service-tier claims; the one "Deluxe" hit in the file is a
  hotel room-category name, not an invented service tier.

**Open item worth a look:** both `Spain_Destination_Guide.html` and
`diagnostic-tools/api-test.html` hardcode `model: 'claude-sonnet-4-6'` in the
API request body. That's not a currently-documented Anthropic model ID —
confirm the correct current model string (or whether the artifact bridge
ignores/overrides it server-side) before assuming live AI calls are hitting
the intended model.

## Design decisions to preserve, not "helpfully" change

- Outlook is read+draft only, never send.
- Kosher is never inferred from "vegetarian" — only Zerta (Barcelona) is
  tagged kosher-certified; unqualified "Jewish" interest is treated as
  heritage-site interest, not a dietary assumption.
- Official KT itineraries are the anchor; personal recommendations are always
  explicitly flagged as separate, never blended in unmarked.

## Still open (from HANDOFF, unresolved as of the move here)

- Voice input (listening) is confirmed blocked in the in-app preview iframe
  (mic permission denied at the hosting-frame level). Untested: whether a
  "pop out to full tab" view gets normal top-level mic permissions.
- `TA_DRIVE_MCP` (Google Drive MCP) is wired but has never been successfully
  test-called.
- The round-cap-to-7 fix and personal-recommendations layer are logic-tested
  but not yet observed end-to-end in a live model response in the actual app.

## Working in this file

- No build step, no package.json, no tests directory — it's one HTML file.
- After any edit to a `<script>` block, syntax-check just that block in
  isolation rather than trying to lint the whole HTML file:
  `node --check` against the extracted script contents (handle the fact that
  there are 14 inline `<script>` tags and top-level `const`/`let` in one tag
  is visible to later tags on the same page).
- For logic changes (data lookups, itinerary matching, diet tagging), extract
  the function plus its real data and run it against a realistic input in
  Node before editing the live file.
- For anything touching the `fetch()` to `api.anthropic.com`, prototype the
  change in a copy of `diagnostic-tools/api-test.html` before editing the
  main file — this is how the AbortSignal regression got caught and fixed
  fast instead of becoming a multi-day mystery.
- This app can only be manually verified end-to-end (live AI layer) inside a
  live claude.ai artifact preview with "Create AI-powered artifacts" enabled;
  a local `file://` open only exercises the offline engine.
