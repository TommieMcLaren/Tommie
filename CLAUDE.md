# Kensington Tours — Spain Destination Guide + Trip Assistant ("Jarvis")

Single-file HTML app: a Kensington Tours Spain Destination Certification guide
with an embedded AI trip-planning assistant. Built originally through
chat-based edits in claude.ai (as an "AI-powered artifact"); now developed
here in Claude Code. Read `HANDOFF.md` first — it's the field-tested record of
everything that broke and got fixed before the move here, and the "don't
relearn this the hard way" list still applies verbatim.

## Files

- `Tommie_Tours.html` — the app. ~14,000 lines, single file, no
  build step. Everything else is scaffolding around it.
- `HANDOFF.md` — history of hard-won fixes and design decisions from the
  chat-based development phase. Verified current against the file as of the
  move to Claude Code (see "Verified state" below).
- `diagnostic-tools/api-test.html` — isolated test: does this environment's
  fetch-to-Claude bridge work? No guide, no dependencies.
- `diagnostic-tools/mic-test.html` — isolated test: does microphone access +
  speech recognition work in this environment?
- `sw.js` — Client Tracker's companion service worker (see "Installable app
  + best-effort background reminders" below). Must be hosted in the same
  directory as `Tommie_Tours.html` for its registration to
  succeed; has zero effect if missing, and nothing else in this project
  depends on it being present.

GitHub Pages is enabled on this repo (Settings → Pages, deploying from this
branch), specifically so `sw.js` has a real https:// origin to register
from — see the hosted URL note in HANDOFF.md/CLAUDE.md's Pages section
once the first deploy completes.

Use the diagnostic tools FIRST whenever something in the live-AI or voice
layer breaks, before touching the 14k-line main file.

## Architecture (see HANDOFF.md for original design history)

Two deliberately separate layers:
1. **Offline rule-based engine** — structured per-city data (`QB_HOTELS`,
   `QB_RESTAURANTS`, `QB_TOURS`, dietary tagging, weather, the 16 real KT
   itineraries, the interactive route map, the Quote Builder). Instant, free,
   works with no network.
2. **Live AI layer** (`callClaudeAI`) — real Claude API calls with tools
   (`search_guide`, `get_city_data`, `find_matching_itinerary`, native
   `web_search`, Outlook/calendar via MCP). Reachable via the direct-entry
   button, escalation button, itinerary polish, and voice.

**As of Aug 2026, layer 2 is BYOK (bring-your-own-key), not the claude.ai
artifact bridge HANDOFF.md describes.** The DE pastes their own Anthropic
API key into the ⚙️ Settings panel inside the Trip Assistant; it's stored in
`localStorage` and sent as `x-api-key` directly to `api.anthropic.com` (with
`anthropic-dangerous-direct-browser-access: true`), billed to the DE's own
Anthropic account. This means the file now works as a genuinely standalone
page in **any** browser — no claude.ai chat window, no "Create AI-powered
artifacts" setting, no artifact-preview-vs-publish confusion. HANDOFF.md's
postMessage-bridge material (constraint #1 and #2 in particular) describes
the *previous* architecture; it's kept for history, but no longer describes
how `callClaudeAI`'s `fetch()` actually reaches Anthropic. See "BYOK
migration" below for what changed and why.

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

## Live-AI upgrade (this session, unverified live)

Made to answer "make Jarvis as smart and useful as possible" — all pass
`node --check` and Node-level logic tests, but **none of this has been
exercised in a real claude.ai artifact preview yet** (this environment can't
make that call itself). Verify all of it there before trusting it in front of
a client:

- **Model bumped `claude-sonnet-4-6` → `claude-opus-5`**, then **reverted
  back to `claude-sonnet-4-6`** after live testing (see "BYOK migration"
  below) — the fake-tool-call bug reproduced under both models, so this
  wasn't the fix either way. Current state: `claude-sonnet-4-6` in both
  request bodies and in `diagnostic-tools/api-test.html`, matching what's
  actually been live-tested. Revisit once BYOK is confirmed working live —
  Opus 5 may well be worth it now that tool-calling should genuinely work.
- **`web_search` tool type bumped** `web_search_20250305` →
  `web_search_20260209` (dynamic filtering, supported on Opus 5).
- **Likely root-cause fix for calendar/Outlook/Drive MCP never working
  end-to-end:** the MCP connector requires every server in `mcp_servers` to
  be paired with a matching `{type:'mcp_toolset', mcp_server_name}` entry in
  `tools`, plus the `mcp-client-2025-11-20` beta header — neither was present
  before. Without it, the API rejects the request outright rather than
  degrading gracefully, which fits HANDOFF's "TA_DRIVE_MCP never successfully
  test-called" and the personal-recommendations layer never being observed
  live. Added `buildTools()` / `buildBetaHeader()` helpers in the same
  `<script>` block as `callClaudeAI` to wire this correctly. **This is the
  single highest-priority thing to confirm live** — open the Trip Assistant
  panel, trigger the Outlook-draft or calendar follow-up path, and check it
  actually calls through instead of erroring.
- **Refusal handling added:** `stop_reason === 'refusal'` is now checked
  explicitly (a safety-classifier decline returns `content: []`, which the
  old `!data.content` check didn't catch since `[]` is truthy in JS — it
  would have silently fallen through to "I didn't have a clear answer,
  could you rephrase?"). Paired with `fallbacks: 'default'` +
  `server-side-fallback-2026-07-01`, which retries a decline on a fallback
  model server-side before giving up.
- **`max_tokens` raised 1200 → 4096** — 1200 was tight for a full day-by-day
  multi-city itinerary and risked silent truncation. **`TA_REQUEST_TIMEOUT_MS`
  raised 20000 → 30000** to give the larger model/output room without
  hanging indefinitely — this is the one value most worth tuning based on
  real observed latency once tested live.
- **System prompt / tool descriptions audited for model-4.6-era cruft after
  the Opus 5 switch, on purpose** (dated pressure language, step-by-step
  choreography, etc.) — found none worth changing. `TA_SYSTEM_PROMPT` is
  already reasoned prose (every rule carries its "because"), not emphasis
  spam, so it was left alone. One low-confidence note, not acted on: the
  "call find_matching_itinerary FIRST" instruction is stated in both the
  system prompt and that tool's own `description` — mild duplication, not
  clearly worth the regression risk of trimming without live testing.

## BYOK migration (Aug 2026) — why the bridge got dropped

Live testing (via a real claude.ai chat conversation, the only place the old
architecture could be exercised at all) surfaced a serious bug: Jarvis's
custom tools (`search_guide`/`get_city_data`/`find_matching_itinerary`)
never actually fired. The model narrated a **fake** tool call as plain text
instead — `<function_calls><invoke name="...">` once, then
`<tool_call>{"tool":...}</tool_call>` on a retry, under two different
models. A different invented notation each attempt is the tell: a real
`tool_use` block mishandled by this file's own parsing would fail the same
way every time, not reinvent its syntax — so the model was freestyling
from the tool descriptions in its own system prompt with no real
tool-calling channel open. Leading (unconfirmed, since it can't be tested
from this environment) hypothesis: the AI-powered-artifacts bridge forwards
`web_search` and `mcp_toolset` entries but silently drops this guide's own
custom tools rather than erroring.

Given a hallucinated itinerary is the single worst failure mode for a
client-facing sales tool, two things were done, in order:

1. **`looksLikeHallucinatedToolCall(text)`** — a regex safety net matching
   the observed fake-tool-call patterns, checked at both places
   `callClaudeAI()` would otherwise hand a "final" answer to the DE. If
   matched, it refuses to display the response and returns an honest error
   instead. This stays regardless of root cause — it's cheap insurance, not
   a fix.
2. **BYOK** — replaces the whole bridge with direct browser calls to
   `api.anthropic.com` using the DE's own API key (see the Architecture
   section above). This makes the custom-tool-dropping question moot: there
   is no bridge left to drop anything, and the real API demonstrably
   supports custom tools. The MCP-connector fix from the section above
   (`buildTools()`/`buildBetaHeader()` pairing `mcp_servers` with
   `mcp_toolset` entries) is **still required and unaffected** — that's a
   general Anthropic API requirement, not something specific to the old
   bridge.

**What's still unverified, in priority order:**
1. That BYOK actually works end-to-end with a real key — pending live test.
2. The exact name/behavior of `anthropic-dangerous-direct-browser-access` —
   couldn't be checked against live docs from this environment (no network
   access here). Confirm against docs.claude.com before trusting it in
   front of a client.
3. `diagnostic-tools/api-test.html` now has a second test ("Test Custom
   Tool-Calling") that isolates exactly this question — sends one custom
   tool the model is instructed to call, and reports whether a real
   `tool_use` block comes back. Run this FIRST if live-AI answers ever look
   suspicious again; it's faster than debugging the full file.

## Vision / image attach (Aug 2026, unverified live)

A 📎 button next to the input box lets the DE attach one image (hotel/room
photo, a client's Pinterest-style inspiration screenshot, a competing
agency's itinerary, a menu) and ask about it — a real Claude vision call,
not OCR or a heuristic. Deliberately scoped narrow:

- **One-off, not persisted to `convoHistory`.** A base64 image is easily
  hundreds of KB; letting that silently accumulate in the localStorage blob
  on every conversational turn was worth avoiding. Sending an image always
  goes through its own dedicated `callClaudeAI` call (see the `pendingImage`
  branch at the top of `send()`), regardless of whether Conversation Mode is
  active — the offline engine can't see images at all, so there's no
  "offline vs live" routing decision to make here.
- Image content block shape (`{type:'image', source:{type:'base64',
  media_type, data}}`) is the standard, stable Messages API format and
  wasn't flagged as a changed/drifted area anywhere I could check — but
  genuinely **could not be verified against live docs** (no network access
  in the environment this was written in). Same for the 5MB
  `TA_MAX_IMAGE_BYTES` client-side ceiling — a conservative guess, not a
  confirmed API limit. Both are the first things to check if attaching an
  image fails or a larger file gets rejected.
- Accepts PNG/JPEG/WebP/GIF via the file picker's `accept` attribute (no
  drag-and-drop or clipboard-paste yet — file picker only, keeps this
  MVP-sized).

## Proactive client memory (Aug 2026)

`searchArchive`/`presentHistorySearch` already existed as a PULL-based
lookup — the DE had to remember to ask "what did I discuss with X before."
Added `maybeSurfaceClientHistory()`, hooked into `handleResult()` right
where a client name gets extracted: when a genuinely NEW name (not just a
re-mention of the current `taState.clientName`) matches a past archived
session, Jarvis now surfaces it unprompted with a "Show me" action, instead
of the DE having to think to ask. Fires once per name per page session
(`taSurfacedHistoryFor`) so it doesn't repeat the nudge on every message.
Scoped to the offline/typed-input path only, where the name-extraction
infrastructure already lives — Conversation Mode doesn't run
`extractClientName` at all, so this doesn't fire there. Logic-tested in
Node against a synthetic archive entry: first mention finds the match,
second mention same session is correctly deduped, an unknown name correctly
finds nothing.

**Next logical step, not yet built:** the same proactive pattern applied to
the Outlook/calendar MCP connector (unanswered client emails, quotes going
stale) — deliberately held off since that connector's behavior under BYOK
(does it still carry the DE's M365 login the way it did inside the old
claude.ai bridge?) hasn't been confirmed live yet. Confirm the existing
Outlook-draft/calendar-follow-up buttons work first before building more on
that foundation.

## Trip Assistant features added (this session, same live-verification caveat)

- **SMS/text-message draft button.** Every generated draft (email, outreach,
  etc.) now has a "📱 Text version" button next to the existing Outlook-draft
  and schedule-follow-up buttons. It calls the live AI to condense that
  draft into a copy-paste SMS (~320 chars, no subject line) — no new
  integration, since there's no SMS-sending platform wired up (deliberately
  matches the Outlook button's "draft only, DE sends it themselves" rule).
  Extracted a shared `wireCopySpeak()` helper (was inline in
  `wireDraftButtons()`) so the injected SMS-result block's Copy/🔊 buttons
  work without double-binding the original draft's buttons.
- **`PERSONAL_ITINERARIES`** — an empty array, structurally parallel to
  `KT_LIVE_ITINERARIES`, for Tommie's own go-to sample itineraries (the ones
  he said he'll hand over to be added as data). Schema documented in the
  comment above the const. `find_matching_itinerary` now checks both lists
  (via the shared `scoreItinerariesByCities()` helper) and, when a personal
  itinerary matches, returns it in its own clearly-labeled section — never
  merged with the official KT results, per this guide's existing
  personal-vs-official rule. **To actually use this, add entries to
  `PERSONAL_ITINERARIES`** — behavior is unchanged today since the list is
  empty; this was pure scaffolding, logic-tested in Node against the real
  `KT_LIVE_ITINERARIES` data plus a synthetic personal entry.
- **`.catch()` backstops added to every `callClaudeAI` call site.** HANDOFF
  already documents this as the intended defense-in-depth pattern, but only
  1 of 7 sites actually had one — the other 6 (SMS/Outlook/schedule
  buttons, ask-AI fallback, itinerary polish, follow-up chip) would have
  left a button stuck disabled or a spinner running forever on any
  unexpected error inside the `.then()` body itself.

## Live testing round 2 (Aug 2026) — real bugs found and fixed, this time with actual signal

Unlike the first BYOK pass, this round happened with a real API key and a
live claude.ai chat working end-to-end, so these fixes are based on actual
observed behavior, not blind code review:

- **Retry-button audit, done properly this time.** The first fix only
  covered the typed "Just Type — Skip Voice" path. The actual microphone
  path (`convoListenOnce`'s `rec.onresult`) was untouched and had the exact
  same bug — error text saying "tap retry" with no button. Now uses
  `addErrorWithRetry` there too, plus speaks the error aloud (voice mode
  should always talk back) and stops rather than auto-looping back into
  listening on failure, so a persistent problem can't silently rack up
  repeated failed requests unseen.
- **The 30s timeout was real and reproducible** — confirmed via the
  browser's Network tab Timing panel: a full multi-city itinerary
  legitimately took ~41s to generate (three other round-trip calls in the
  same exchange were all under 3s — this was specifically the final
  synthesis call). Not a hang. Led directly to the streaming rewrite below.
- **Streaming.** `callClaudeAI`'s two fetch call sites now go through
  `streamAnthropicMessages()` (SSE, hand-parsed — no SDK available in a
  build-step-free static file) instead of a plain non-streaming fetch. The
  fixed-ceiling timeout is replaced with an IDLE timeout (`TA_REQUEST_
  TIMEOUT_MS`, still 60000): the clock only fires if no new data arrives,
  so a slow-but-flowing 41s+ response is no longer at risk of being killed,
  while a genuinely dead connection still gets caught. Also means the DE
  sees the answer being written (`updateTypingText`) instead of a static
  "thinking" animation for up to a minute. `parseSseChunk()` +
  `createStreamAccumulator()` reconstruct the same `{content, stop_reason}`
  shape a non-streaming response has, so all the downstream logic (tool
  execution, `looksLikeHallucinatedToolCall`, refusal handling) is
  unchanged — logic-tested in Node against a synthetic event stream chunked
  at deliberately awkward, mid-JSON-object boundaries (the real-world SSE
  failure mode) for both a tool-use turn and a text-only turn, plus a
  mid-stream `error` event and a `refusal`. **Known gap:** `stop_details`
  (the refusal category name) isn't populated on the streaming path — the
  refusal is still caught and blocked correctly, it just won't name why.
  The actual `fetch()`/`ReadableStream`/`AbortController` plumbing itself
  could not be tested from this environment (no live network) — this is
  the one part of this change still riding on code review, not a live run.
- **Conversation memory, two separate real gaps closed:**
  1. `convoHistory` (the actual `{role, content}` array sent to Claude —
     different from the on-screen chat bubbles, which were already being
     saved) was never persisted to `localStorage` at all. A page
     reload — including just opening a newer file version, which is what
     was actually happening between rounds of live testing — looked like
     the conversation survived (the bubbles were still there) but the
     model had no real memory of any of it. Now saved/restored alongside
     `taState` in the same `TA_STORAGE_KEY` blob.
  2. `startConversationMode()`/`startTypedConversationMode()` used to
     unconditionally reset `convoHistory = []` every time — meaning even
     within one page session, ending and restarting Conversation Mode (the
     natural thing to do after an error) wiped context. History now only
     clears on "Start new client" (`contextResetBtn`), a real topic change.
- **Voice picker.** Added a "🔊 Spoken voice" section to ⚙️ Settings — a
  dropdown over the browser's actual installed TTS voices (populated from
  `speechSynthesis.getVoices()`, handling Chrome's async `voiceschanged`
  load) plus rate/pitch sliders and a preview button, applied via a shared
  `applyVoicePrefs()` used by both Conversation Mode and the per-draft
  "🔊 Read aloud" buttons. **There is no actual celebrity voice available**
  (David Attenborough / Morgan Freeman were asked about) — browsers only
  expose their own installed voices, and cloning a real person's voice
  without consent isn't something to build regardless of feasibility. The
  settings copy says this explicitly.
- **Short spoken summaries.** Voice mode used to read full structured
  itineraries aloud verbatim (day-by-day bullets, hotel names) — mechanical
  to listen to, and redundant since the DE reads the full detail on screen.
  `convoContextNote()` now asks the model to append a `VOICE_SUMMARY: ...`
  line (one warm, conversational sentence) after any long/detailed answer;
  `splitVoiceSummary()` pulls that out so only the short summary gets
  spoken while the full answer still displays and still saves to
  `convoHistory` in full. Short conversational replies are unaffected — the
  main system prompt already keeps those brief.
  **Superseded by the chat-bubble condensing feature below** — this
  mechanism was generalized rather than kept voice-only; see that section
  for the current names (`TA_SUMMARY_NOTE`/`splitSummary`/`SUMMARY:`).

## Chat-bubble condensing + "View full details" pop-out (Aug 2026)

Direct response to live feedback: full itineraries (headers, tables, bold
text, links, day-by-day bullet lists) were landing raw in the chat bubble,
making the conversation "easy to get lost in." Wanted the bubble to read
"more like a texting platform back and forth" — a brief headline, with the
full detail available on demand rather than always dumped inline.

- **Generalized the voice-only summary mechanism instead of building a
  second one.** The `VOICE_SUMMARY:`/`splitVoiceSummary()` pair added
  earlier this session already solved almost the same problem (get the
  model to also emit a short one-line take on a long answer) — renamed to
  `TA_SUMMARY_NOTE`/`splitSummary()`/`SUMMARY:` and now serves both
  Conversation Mode's spoken reply *and* the chat bubble's displayed text,
  rather than keeping two near-identical prompt instructions and parsers in
  sync by hand. `splitSummary(text, isError)` returns `{fullText,
  summaryText}`; on error, or when no `SUMMARY:` line is present (short
  replies skip it on purpose per the prompt instruction), both fields are
  just the original text unchanged, so callers never need an `isMore`
  branch of their own.
- **`addAiAnswerMsg(summaryText, fullText)`** — the new shared display
  helper. Renders the bubble as just the summary text; only when `fullText`
  actually differs from `summaryText` does it append a "📋 View full
  details" button wired to open the pop-out modal with the full text. A
  short answer (no `SUMMARY:` line, so `fullText === summaryText`) renders
  with no button at all — nothing to expand.
- **`renderMarkdownLite(text)`** — a small hand-rolled markdown-to-HTML
  renderer for the pop-out modal only (the chat bubble itself still shows
  plain escaped summary text, unchanged from before). Escapes via
  `escapeHtml()` first, then parses on top of the escaped text: `#`/`##`/
  `###` headers, `**bold**`, `[text](url)` (http/https only — anything else,
  including `javascript:`, is left as literal escaped text, not linkified),
  `-`/`*`/numbered lists, `---` rules, GFM `|a|b|` tables, and `&gt; ` quote
  lines as note callouts. Deliberately not a full markdown implementation —
  scoped to what KT itinerary responses actually use. Logic-tested in Node
  against a representative multi-section itinerary sample (headers, a
  table, a bulleted day, a note callout, a link) and separately against an
  XSS probe (`<script>`, a `javascript:` link, a quote-breakout URL) —
  all three attack vectors came back inert; only `escapeHtml()`'s own
  output feeds the parser, so nothing it emits can introduce a tag that
  wasn't already there as literal text.
- **Modal**: `#ta-itinerary-overlay` / `#ta-itinerary-modal`, styled to
  match the existing `#stale-modal` pattern, opened via
  `openItineraryModal(fullText)` (sets `.innerHTML` from
  `renderMarkdownLite()` and toggles `.open`) and closed via the ✕ button,
  a backdrop click, or already-established `@media print` hide rules
  (added to the same hide-list as `#ta-panel`/`#stale-overlay`).
- **Wired at all three live-AI chat-bubble display sites**: the typed
  Conversation Mode path (`send()`'s `runConvoSend`), the real microphone
  voice path (`convoListenOnce`'s `runVoiceRespond`), and the "🧠 Actually
  think this through →" escalation button (`runAskAi`) — all three now call
  `splitSummary()` then `addAiAnswerMsg()` instead of dumping
  `escapeHtml(result.text)` straight into the bubble. The one-off vision/
  image-question path (the 📎 attach flow) got the same treatment for
  consistency, even though its system note doesn't currently request a
  `SUMMARY:` line — harmless no-op today (`splitSummary` returns the text
  unchanged when no tag is found), and ready if that prompt ever grows
  long-form answers. **Deliberately left alone**: the Outlook-draft/
  schedule-follow-up confirmation replies and the calendar follow-up check
  — those prompts explicitly ask the model for a short confirmation, don't
  send `convoContextNote()` (so no `SUMMARY:` tag is ever produced there
  regardless), and were already short by design; adding the pop-out
  machinery to them would be dead code, not a fix.
- Logic-tested in Node: `splitSummary` against a real multi-paragraph
  itinerary-with-`SUMMARY:`-line, a short reply with no tag, and an error
  string (all three matched expected shape). `renderMarkdownLite` against
  the markdown/XSS cases above. All edited `<script>` blocks still pass
  `node --check`.
- **Unverified live, same caveat as everything else in this section**: the
  actual modal open/close interaction, scroll behavior on a long itinerary,
  and how the "📋 View full details" button looks against the real KT
  itinerary output haven't been seen in a real browser from this
  environment — check these first if the pop-out looks or behaves oddly.
- **Confirmed broken live, root cause found and fixed (Aug 2026):** the
  button rendered fine but clicking it did nothing — no error, no modal.
  Root cause: `#ta-itinerary-overlay`'s markup lives near line 15677,
  well after the `<script>` tag (line ~11656) that looked it up via
  `document.getElementById('ta-itinerary-overlay')`. Scripts execute in
  document order, so at that script's parse time the browser hadn't
  parsed that `<div>` yet — the lookup returned `null`, and caching it
  in a top-level `const` meant it stayed `null` forever, silently
  no-opping the open button, the close button, and backdrop-click alike.
  This is the general hazard of this file's "one script tag, HTML for a
  later feature sometimes lives further down the page" layout — a
  top-level `const someEl = document.getElementById(...)` is only safe
  when that element's markup is guaranteed to already be above it in the
  file. Fixed by switching `openItineraryModal`/`closeItineraryModal` to
  look up the overlay/body fresh on every call instead of caching them,
  and deferring the close-button/backdrop-click listener wiring to
  `DOMContentLoaded` (guaranteed to fire only after the *entire*
  document has been parsed, regardless of where in the file the script
  tag sits) since those need a real element to attach a listener to, not
  just a lookup at click time. Swept the rest of the file for the same
  pattern (a top-level `const` capturing `getElementById` on an id whose
  markup appears later in the document) and found no other instances —
  the other two hits were false positives (lookups inside functions that
  only run on user interaction, well after full page load, which is
  safe). **This was the first real bug live testing actually caught in
  this feature** — everything else about it (the markdown rendering,
  the XSS discipline) checked out fine once it could actually open.

## Client Tracker panel (Aug 2026, unverified live)

Direct response to a scope conversation: rather than keep expanding Jarvis
into a full organizational assistant, the plan settled on keeping this file
as the standalone work tool it already is, and adding one narrowly-scoped
piece — a client/follow-up tracker — built from a separate mockup file the
DE provided (`clienttracker.html`, a `window.storage`-based standalone
Artifact prototype). Ported into the master doc rather than left standalone
so it's always open alongside the rest of the guide, and so it can reach
Outlook through the Trip Assistant's already-working BYOK connection
instead of needing its own.

- **New floating panel**, independent of the Trip Assistant: `#ct-btn`
  (📋, bottom-left) / `#ct-panel`, deliberately mirrored in the opposite
  corner from `#ta-btn`/`#ta-panel` (bottom-right) so the two can never
  visually collide if both happen to be open at once.
- **Storage swapped from `window.storage` to `localStorage`.** The source
  mockup used `window.storage.get/set` — that's an Artifacts-runtime-only
  capability (see the artifact-capabilities skill) that doesn't exist when
  this file is opened as a plain `file://` page, which is how this guide
  actually gets used post-BYOK-migration. Rewritten as synchronous
  `localStorage` reads/writes under `kt-client-tracker:v1`, matching this
  file's existing `kt-trip-assistant:*` key-naming convention. Async
  `loadData`/`saveData` collapsed to sync since `localStorage` doesn't need
  awaiting — the mockup's `async`/`await` was scaffolding for the Artifacts
  storage API, not a real requirement here.
- **Re-themed to this guide's own palette** (sage/gold/beige) instead of
  the mockup's navy/gold, scoped entirely under `#ct-*` ids/classes so
  nothing leaks into or collides with the rest of the file's CSS.
- **Outlook integration, push-only, reusing rather than duplicating.** Each
  card with a `nextFollowUp` date gets a "📅 Add to Outlook" button that
  creates one real calendar event via `outlook_create_event` — same MCP
  pattern and same `mcp_toolset`/beta-header requirements as the Trip
  Assistant's existing "Schedule follow-up" button (see "Live-AI upgrade"
  above for why that pairing matters). Rather than re-implement the
  fetch/streaming/auth/refusal-handling plumbing a second time in a
  separate script block, the Trip Assistant's IIFE now exports
  `window.__taCallClaudeAI` / `window.__taCalendarMcp` /
  `window.__taHasApiKey()` right before it closes, and the tracker calls
  through those — one copy of that logic, not two drifting in parallel.
  Gated the same way the rest of live-AI is: if no API key is saved yet,
  the tracker shows a message pointing at Trip Assistant's ⚙️ Settings
  rather than attempting a doomed request. This is **push only** — it
  creates a new event, never reads, modifies, or sends anything — consistent
  with this file's standing Outlook rule below.
- **`getKnownClientNames()` (used by the existing "📅 Check follow-ups due"
  calendar cross-reference) now also reads the tracker's client list**, not
  just past archived Trip Assistant sessions — so that check is grounded in
  everyone actually being tracked, not just people who've been discussed in
  a live-AI conversation before. Deliberately kept as a literal storage-key
  string in both places rather than a shared exported constant — the two
  panels are otherwise fully independent, and one string literal in two
  places is simpler than adding a load-order dependency for it.
- Logic-tested in Node: date-bucket grouping (overdue/due-this-week/
  upcoming/no-date/closed) against six synthetic clients spanning each
  bucket, and the card renderer against an XSS probe (`<script>` in a
  client name, an `onerror=` payload in notes) — both came back as inert
  escaped text, not live markup.
- **"Add to Outlook" was MCP-based, confirmed broken live, root cause now
  found and fixed (Aug 2026).** DE's actual error: `Anthropic returned an
  error (400) — Authentication error while communicating with MCP server.
  Please check your authorization token.` That pins it exactly: the
  Messages API's `mcp_servers` connector requires its own
  `authorization_token` per server (a real Microsoft OAuth access token
  for `microsoft365.mcp.claude.com`) — completely separate from the
  Anthropic API key BYOK provides. The model/header/`mcp_toolset` wiring
  (see "Live-AI upgrade" above) was correct the whole time; the missing
  piece was a token this file never had and, as a static file with no
  backend, has no real way to obtain — that would need a registered
  Azure AD app plus a hosted HTTPS OAuth redirect endpoint, neither of
  which fits "single file, no build step, no server."
  **Fixed by replacing the MCP call entirely**, not by chasing the OAuth
  token: `ctAddToOutlook()` now opens Outlook Web's own "New event"
  compose screen in a new tab via a pre-filled deep link
  (`outlook.office.com/calendar/0/deeplink/compose?...`) — subject, date/
  time (30 min, local time computed directly from `Date` getters, not
  `toISOString()`, to avoid a UTC-offset bug), and notes as the body, all
  URL-encoded via `URLSearchParams` (also closes off any XSS risk from a
  client name/notes containing markup — it's a URL, not HTML). No OAuth,
  no server, works today from `file://`. Costs one extra click (the DE
  taps Save in the opened tab) where the MCP version would've been zero —
  but that's consistent with this file's own "draft only, DE reviews
  before it's final" Outlook rule everywhere else, so it's not really a
  step down in spirit even though it's one more click in practice.
  **Unverified live**: the exact deep-link parameter names are the
  widely-used Outlook Web compose pattern, not confirmed against current
  Microsoft docs from this environment (no network access here) — if the
  tab opens to the wrong page, an error, or blank fields, that's the
  first thing to check. The Trip Assistant's own "Schedule follow-up" and
  Outlook-draft buttons hit this exact same root cause and are still
  broken — same fix pattern (a compose deep link instead of the MCP call)
  would apply there too, not yet done since it wasn't what was asked.
- **Browser-notification reminders added** as a same-tab-only stand-in
  while Outlook is broken. New 🔕/🔔/🚫 bell button in `#ct-head` —
  `Notification.requestPermission()` (must fire from the click itself, a
  real user gesture, or browsers silently ignore/block it) then
  `ctCheckDueReminders()` fires a `Notification` for every non-Closed
  client whose `nextFollowUp` is today or earlier, deduped per
  client-per-day via `localStorage['kt-client-tracker:notified:v1']` so
  reopening the panel doesn't re-fire the same reminder. Runs on panel
  open, once on page load if permission is already granted, and every 5
  minutes on a `setInterval` while the tab stays open (catches a
  follow-up going overdue, or a day rolling over, during a long session).
  **Real, load-bearing limitation, not a bug**: this is a static file with
  no server and no service worker, so these can only fire while this tab
  is open in a browser — closing the tab or the browser means no
  reminder, unlike a true push notification. Once Outlook is confirmed
  working, that's the reminder that survives the tab being closed; this
  is the gap-filler for right now. Logic-tested in Node against synthetic
  clients (mocked `Notification`/`localStorage`): overdue + due-today
  correctly notify, future/closed/no-date clients correctly don't, a
  second same-day check correctly doesn't re-fire, and permission not
  granted correctly no-ops.

## Client Tracker: bigger screen, more fields (Aug 2026, unverified live)

Direct response to feedback that the panel felt cramped and thin on
detail. Two changes, both scoped to `#ct-*`:

- **Small anchored corner box → full centered modal.** `#ct-panel` used to
  be `position: fixed` in the bottom-left corner at 420×640px — cramped
  once there's more than a couple of clients, and inconsistent with how
  every other "big tool" in this file presents itself. Restructured to
  match the existing overlay+modal pattern already used by
  `#quote-builder-overlay`/`#dashboard-overlay`/`#ta-itinerary-overlay`:
  a new `#ct-overlay` (fixed, full-screen backdrop, `z-index: 10000` —
  above `#ct-btn` and `#ta-panel`'s 9999 so the trigger button doesn't
  poke through when open) centers `#ct-panel`, now sized
  `min(1080px, 100%) × min(780px, 100%)`. Backdrop click closes it,
  same as the itinerary pop-out. `#ct-btn` (the small 📋 trigger) is
  unchanged — only what it opens changed.
- **Three new client fields**: Destination/trip, Phone, Email — real
  gaps for a travel-agency contact tracker that only had status/dates/
  notes before. Rendered as a `.ct-detail-row` of small icon-prefixed
  items on each card (🌍/📞/✉️), only showing whichever fields are
  actually filled in. Folded into search (`ctRender`'s filter) and into
  `ctAddToOutlook`'s event body (destination gets its own line) — not
  added to the Outlook Web deep link's own fields (subject/date/body
  only), since those don't have a natural home for phone/email.
- **Cards now lay out in a responsive grid** (`.ct-group-cards`,
  `repeat(auto-fill, minmax(340px, 1fr))`) inside each urgency group,
  instead of one narrow stacked column — the wider modal means 2-3 cards
  now sit side by side, which is most of what "cleaner, more detailed"
  actually meant in practice: less scrolling, more information visible
  at once, same grouping/search/filter/notify/Outlook logic untouched.
- Logic-tested in Node: the new fields' card rendering against an XSS
  probe (`<script>` in destination, an `onerror=` payload in phone, a
  stray `<script>` in email) — all three came back as inert escaped
  text via the existing `ctEscapeHtml()`, same discipline as every other
  user-entered field in this panel.
- **Unverified live, same caveat as the rest of this panel**: the modal
  sizing/backdrop/responsive-grid behavior hasn't been seen in a real
  browser at various widths from this environment — check that first,
  especially on a laptop-sized screen where `min(1080px, 100%)` matters
  most.

## Client Tracker: Itinerary dropdown + TMT Link (Aug 2026, unverified live)

Two more fields, confirmed with the DE before building (TMT is an
internal system the DE links out to, not something to invent a
placeholder for):

- **Itinerary** — a `<select>` populated from the real `KT_LIVE_ITINERARIES`
  data (plus a "Personal picks" `<optgroup>` if `PERSONAL_ITINERARIES`
  ever gets populated — see "Trip Assistant features added" above),
  built once at load via `ctPopulateItineraryOptions()`. Stores the
  itinerary's `id`, not its title, so a later title edit in
  `KT_LIVE_ITINERARIES` doesn't silently orphan what's saved — resolved
  back to the full itinerary object via `ctFindItinerary(id)` wherever
  it's displayed. Deliberately kept as a **separate field from
  Destination/trip**, not a replacement — Destination stays free text
  for clients who don't map cleanly onto one of the 16 official
  itineraries, Itinerary is the formal link to one that does.
  `KT_LIVE_ITINERARIES`/`PERSONAL_ITINERARIES` are true globals here
  (declared as top-level `const` in an earlier, non-IIFE `<script>` tag —
  see "Working in this file" below on script-tag scoping), so no
  `window.__ta*`-style export was needed to reach them from the tracker's
  own IIFE, unlike `callClaudeAI`.
- **TMT Link** — a free-typed URL to whatever internal system (booking/
  quoting tool) the DE actually uses; this file has no way to know what
  TMT is beyond "a link the DE pastes in," so it's stored and rendered
  as-is, not validated against any real TMT URL shape. Rendered as a
  "🔗 TMT" link on the card **only when it passes `ctSafeHref()`** — the
  same http(s)-only rule `renderMarkdownLite()` already applies to
  itinerary-response links — since this one field is free-typed by the
  DE rather than sourced from this file's own trusted data, and a
  pasted `javascript:` string landing in a real `href` would be a real
  XSS opening. An invalid value still displays, just as plain text
  ("not a valid link") instead of a clickable one.
- Both fields also feed `ctAddToOutlook()`'s event body (itinerary title
  and TMT link each get their own line) so the calendar event carries
  the same context the card does.
- Logic-tested in Node: a valid itinerary + valid TMT link both render
  as real anchors; a `javascript:alert(1)` TMT link renders as inert
  text with no `href="javascript:` anywhere in the output; an unknown/
  stale `itineraryId` (e.g. after an itinerary is removed from
  `KT_LIVE_ITINERARIES`) renders nothing for that field rather than
  throwing.
- **Unverified live**: the itinerary `<select>` actually populating
  correctly in a real browser, and how a genuine TMT URL looks/behaves
  once clicked, haven't been seen outside this environment.

## Client Tracker: click-to-open profile view (Aug 2026, unverified live)

Direct response to the first real screenshot of the panel: with
destination/itinerary/TMT/phone/email/notes/actions all stacked on every
card at once (from the two features above), the list read as cluttered.
Fix was a list/detail split, not a slimmer version of the same crowded
card:

- **`ctCardHTML()` cut back to three things**: name, status/overdue
  flags, and the one line that actually drives the urgency grouping
  (last contact · next follow-up). Everything else — destination,
  itinerary, TMT link, phone, email, notes, and every action button —
  moved off the card entirely.
- **New profile view (`ctRenderDetail()` / `#ct-detail`)**, opened by
  clicking anywhere on a card (`data-open` on the whole card, one
  listener in `ctRender()`'s wiring instead of three separate
  data-edit/data-delete/data-outlook ones). Shows the full record in
  labeled sections (Trip, Contact, Follow-up, Notes) plus real actions:
  📞 phone and ✉️ email are live `tel:`/`mailto:` links, the itinerary
  and TMT link open in a new tab (through the same `ctSafeHref()` gate
  as before — TMT is still free-typed by the DE), and "📅 Add to
  Outlook" moved down here from the old inline card button. A header
  row above the profile carries "← Back to list", "✏️ Edit", and
  "🗑️ Delete" — Edit still opens the existing `#ct-form-panel` (now
  re-renders the profile after save so it reflects the edit immediately
  rather than needing a re-open), Delete closes the profile and returns
  to the list.
- Toolbar (search/filter/+Add) hides while a profile is open — a
  deliberate drill-down feel (list screen vs. profile screen) rather
  than search/filter controls sitting uselessly above a single client's
  detail. Closing the whole panel (✕ or backdrop click) now also resets
  back to list view, so reopening the tracker later doesn't land on
  whatever profile was last open.
- Logic-tested in Node (a stubbed `document.getElementById` returning
  fake elements, since this needed real DOM mutation rather than a pure
  string-return function like `ctCardHTML`): a full profile render with
  every field populated (itinerary + TMT links present as real anchors,
  phone/email as `tel:`/`mailto:`), an XSS probe across every field at
  once (`<script>` in name, `onerror=` in destination, an SVG-onload
  payload in notes, `<script>` fragments in phone/email, a `javascript:`
  TMT link) — all inert, and an unknown/stale `ctDetailId` correctly
  falls back to `ctCloseDetail()` instead of throwing.
- **Unverified live, same as the rest of this panel**: the actual
  click-to-open feel, the hover affordance on cards, and how the
  section-based profile layout reads in a real browser haven't been
  seen outside this environment — check those first.

## Client Tracker: real intake questionnaire, lead-temp tabs, TMT sync flag (Aug 2026, unverified live)

Three asks that landed close together, all extending the profile view
rather than the compact card (keeping the earlier declutter work intact):

- **Client intake fields, ported from the DE's own script verbatim** —
  the exact questions the DE asks new clients (Client Details, Trip
  Vision, Hotel Preferences, Transfers, Restaurants, Other — ~24 fields
  in total), not a paraphrase. In the Add/Edit form these live in
  `<details>`/`<summary>` collapsible sections (`.ct-form-section`)
  rather than one long flat form — plain HTML disclosure widgets, no
  JS framework needed, and each section's `<summary>` gets a live
  "N filled" badge (`ctUpdateSectionBadges()`) computed from whichever
  client is being edited, so the DE can see what's already been asked
  without opening every section on a partially-interviewed client. In
  the profile view, each section (built via the small `ctRow()`/
  `ctSection()` helpers) only renders at all if at least one of its
  fields has something in it, and within a rendered section only the
  filled fields show as rows — same "don't show what's empty"
  discipline as the rest of this panel. Stored as flat keys on the
  client object (`travelerAges`, `flexibleDates`, `hotelStyle`, etc.),
  matching this file's existing convention rather than nesting a
  sub-object — keeps `|| ''` fallbacks working the same way everywhere.
- **Lead-temperature tabs** — Hot Lead / Warm Lead / Check Back Later /
  Cold Lead (the fourth added as the natural complement to the three
  the DE asked for), as a `#ct-tabs` row of pill buttons above the
  list, independent of the existing Status dropdown filter. Deliberately
  a **second filter axis, not a replacement**: Status is where a client
  sits in the booking pipeline (Inquiry → Booked → Closed), lead temp is
  how urgently they're worth chasing right now — a client can be
  "Quote sent" and "Hot Lead" at the same time. Tab counts reflect the
  search/status filter already applied (not a fixed total), so they
  answer "how many of what I'm looking at right now are Hot." Shown as
  a colored flag on both the card and the profile header, next to the
  existing status flag.
- **TMT-sync checkbox** — "I've updated TMT with the latest notes"
  next to the TMT Link field, stored as `tmtUpdated`. Shown in the
  profile's Trip section as a small ✓/⚠ note next to the TMT link
  itself ("notes synced" vs. "notes not yet synced") rather than its
  own section — it's a status *of* the TMT link, not a separate fact
  about the client, so it reads better attached to that row.
- Logic-tested in Node: `ctUpdateSectionBadges()` against a synthetic
  client with a mix of filled/empty fields per section (counts came
  back correct, including that a "No" answer still counts as filled —
  it means the DE asked and got an answer, same as a "Yes" would);
  `ctRow()`/`ctSection()` against an XSS probe (`<script>` in a select
  value, an `onerror=` payload in a text field) — inert; the tab-count
  computation against four synthetic clients; and a full profile render
  with every new field populated plus the two dedicated XSS payloads
  above, all still inert in the combined output.
- **Unverified live**: the `<details>` disclosure styling (the ▸/▾
  marker, badge placement), how ~24 additional fields feel to fill out
  in one form even when collapsed, and the tab row's wrapping behavior
  on a narrower window — none of this has been seen in a real browser
  from this environment.
- **Confirmed broken live, root cause found and fixed (Aug 2026):** the
  Edit form got visibly cut off partway through the "Client Details"
  section with no scrollbar — the underlying page was visible below the
  panel instead. Root cause: `#ct-panel` is a fixed-height
  (`min(780px, 100%)`) flex column with `overflow: hidden`.
  `#ct-form-panel` had no scroll of its own and wasn't a `flex: 1`
  child, so once the six new intake sections made its natural content
  taller than the space left after the header/toolbar/tabs, it just
  overflowed the column and `#ct-panel`'s `overflow: hidden` clipped it
  — no scrollbar anywhere, content silently unreachable below the fold.
  `#ct-list`/`#ct-detail` each having their own `flex: 1` +
  `overflow-y: auto` didn't help, since the form panel was a sibling,
  not something either of them wrapped. Fixed by wrapping
  `#ct-form-panel`/`#ct-list`/`#ct-detail` together in one new
  `#ct-body` region (`flex: 1; min-height: 0; overflow-y: auto;`) that's
  the actual scrolling area now, regardless of which of the three is
  showing. The `min-height: 0` matters — a flex item's default
  `min-height: auto` can otherwise block it from shrinking below its
  content's natural size, which would silently defeat the scroll fix.
  **Unverified live**: the actual scroll behavior with this fix in a
  real browser — check that the Edit form (with a section or two
  expanded) now scrolls all the way to the Save/Cancel buttons.

## Trip Assistant: rebuilt as one always-conversational surface (Aug 2026, unverified live)

Direct response to explicit feedback that the panel was "so cluttered" and
a request to make it "more of a Google Assistant" — talk to it, pull up
the to-do list, action it, draft emails/SMS, get recommendations without
over-explaining. Deliberately a redesign of the *interaction model and
UI*, not a rewrite of the underlying engine — the BYOK auth, streaming,
real tool-calling, retry handling, and the hallucination safety net were
already confirmed working live this session (see "Trip Assistant panel"
above) and are untouched here; throwing that away and rebuilding it would
have reintroduced already-fixed bugs for no benefit, since none of it was
what anyone called cluttered.

- **One input, always live, no mode toggle.** Removed `#ta-chips` (the
  five quick-fill buttons) and `#ta-convo-bar` ("Start Conversation" /
  "Just Type — Skip Voice"). Previously, plain typed input defaulted to
  the offline pattern-matcher (`handleResult` — keyword matching,
  template drafts, itinerary lookup tables) and reaching the live AI
  needed an explicit toggle; HANDOFF/CLAUDE.md have called this
  "deliberately not the default... confusing" since the very first
  version of this file. `send()` no longer branches on that at all —
  every message (after the small local fast-paths below) goes straight
  to the live AI, unconditionally. `handleResult()` and everything it
  called (`wantsScenarioBuild`, `buildScenarioPlan`,
  `scoreAllItineraries`, `renderItineraryChoices`, `buildDraftsFromText`,
  `searchGuideKnowledge`'s presentation layer, `detectAdjustment`/
  `applyDraftAdjustment`, the "🧠 Actually think this through" escalation
  button) are now **unreachable dead code** — deliberately left in place
  rather than physically deleted in this pass (verifying every one of
  those ~250 lines has no other caller, with no way to test live from
  this environment, was judged higher-risk than leaving unreachable code
  behind for a follow-up cleanup once the new flow is confirmed working
  well in practice).
- **Kept as cheap local fast-paths** (instant, free, no API round trip):
  history search ("what did I discuss with X before"),
  Quote-Builder-prefill, and the "new client" reset phrase. These are
  navigational shortcuts, not answers — not the kind of "clutter" the
  feedback was about, and worth keeping fast.
- **Retired, not replaced**: the "Polish an itinerary → email" chip's
  Google-Drive-doc-by-name lookup (`pendingItineraryPolish` +
  `TA_DRIVE_MCP`) and the "📅 Check follow-ups due" chip. Both are still
  reachable in spirit — paste an itinerary and ask conversationally, or
  (once calendar OAuth exists — see "Still open" below, Calendar MCP is
  confirmed broken under BYOK regardless) ask about follow-ups — but
  neither has a dedicated one-click entry point anymore. The ambient
  once-a-day background check (`maybeRunDailyFollowUpCheck`) is
  untouched and still runs on panel open.
- **Mic unified into one button.** `#ta-mic` used to be a simple
  dictate-into-the-textbox button, separate from the "Start
  Conversation" voice loop. Now tapping it *is* the loop: listen → send
  to the live AI → speak the reply → listen again, until tapped again or
  a stop phrase is said — reusing the existing, already-tested
  `convoListenOnce`/`speakText`/error-recovery machinery, just renamed
  off `convoBtn` onto `micBtn` (`.listening` red pulse, new `.speaking`
  gold state). Typed messages never auto-speak the reply (matches normal
  chat expectations); voice-loop replies always do (the whole point of
  using the mic). `convoVoiceBlocked` and the separate "conversation
  (typed)" quasi-mode were dropped — moot now that typed input always
  reaches the live AI anyway, so a blocked mic just ends the loop
  cleanly with an explanation instead of degrading into a second mode.
- **To-do list, read + propose-then-confirm write.** Two new tools,
  `get_todo_list` and `propose_todo_update`, alongside the existing
  `search_guide`/`get_city_data`/`find_matching_itinerary`. Confirmed
  with the DE before building: **propose, never apply directly** — same
  "draft only, DE confirms" rule this file already uses for every
  Outlook action. `get_todo_list` reads the Client Tracker (a separate
  script/IIFE) via a new `window.__ctGetTodoSummary()` export, reusing
  its own `ctGroupClients()` bucketing rather than duplicating date
  logic. `propose_todo_update` resolves the named client via a new
  `window.__ctFindClientByName()` export (exact match, falling back to
  substring) and returns a proposed field patch — never writes anything.
  The actual write only happens through a new `addPendingActionCard()`
  Confirm/Cancel card rendered under the AI's reply, wired to a third
  export, `window.__ctApplyPatch(id, fields)` (a plain field-merge, same
  shape `ctHandleSave()` already writes, plus a live re-render). All
  three exports follow the same "call fresh inside a handler invoked
  much later, never cache at parse time" rule the itinerary-modal
  DOM-lookup bug taught earlier this session — safe despite the Trip
  Assistant's script running before the Client Tracker's.
- **Draft detection, so "draft an email/text" still gets its buttons.**
  The system prompt now tells the model to write a ready-to-send email
  as literally `Subject: <line>\n\n<body>` — the same shape the old
  offline template system produced. A new `renderAiReply()` helper
  (replacing direct `addAiAnswerMsg()` calls at every live-AI display
  site) checks every reply for that shape; a match routes through the
  existing `renderAndTrackDrafts()`/`wireDraftButtons()` machinery
  (Outlook draft, schedule follow-up, text-message condense — all
  unchanged), so those buttons still show up on an AI-drafted email
  exactly like they did on a template-drafted one. Anything else is the
  normal condensed chat bubble.
- **Tone**: added an explicit system-prompt rule against restating the
  question or narrating "let me check that" before answering — the
  concrete complaint behind "recommend without over-explaining itself."
  Works alongside the existing `SUMMARY:`/chat-bubble-condensing
  mechanism rather than replacing it.
- Logic-tested in Node: `runGetTodoListTool()`/`runProposeTodoUpdateTool()`
  against a mocked `window.__ct*` (found client with valid changes,
  unknown client, no-actual-changes, and Client-Tracker-not-loaded for
  both tools); the real `window.__ctGetTodoSummary`/
  `__ctFindClientByName`/`__ctApplyPatch` implementations against
  synthetic `ctClients` (Closed correctly excluded from the to-do
  buckets, partial-name match, a successful patch merge, and an unknown
  id correctly returning `false`); `renderAiReply()`'s Subject: detection
  against a real draft, a normal answer, and a decoy that merely
  mentions the word "subject" mid-sentence (correctly not triggering);
  and `addPendingActionCard()` against an XSS probe in a proposed change
  description — inert. Full div-tag balance re-verified after the HTML
  changes (1,661 opens / 1,661 closes across the whole file). All 16
  `<script>` blocks pass `node --check`.
- **Unverified live, and this is the big one**: none of `send()`'s new
  unconditional live-AI routing, the merged mic/voice loop, the to-do
  tools actually firing end-to-end against a real Client Tracker, the
  Confirm/Cancel card's real click behavior, or the draft-detection
  regex against genuine model output has been exercised in a real
  browser from this environment. This is a bigger behavioral change than
  anything else this session — test it thoroughly before trusting it in
  front of a client: ask about the to-do list, ask it to draft an email,
  propose and confirm an update, and try both typed and voice input.

## Three live bugs from the rebuilt Trip Assistant, fixed (Aug 2026, unverified live)

All three surfaced from the DE actually using the just-rebuilt "always
conversational" Trip Assistant (see previous section) — real feedback, not
speculative hardening.

- **Raw markdown dumped straight into the chat bubble, and read aloud
  character-for-character.** Confirmed via a screenshot of a
  `get_todo_list` answer showing literal `###`, `**bold**`, `-` bullets,
  `⚠️` emoji, and `---` in the bubble, plus "she reads every line of text
  including the emojis." Root cause: `splitSummary()` only ever shortened a
  reply when the model appended an explicit `SUMMARY:` line (see
  `TA_SUMMARY_NOTE`), and the model judged this particular answer "not
  long" — each individual line was short, even though the overall
  structure (headers, a numbered list, nested bullets) very much needed
  condensing. No `SUMMARY:` line meant `fullText === summaryText`, so the
  raw markdown landed straight in the escaped bubble (never routed through
  `renderMarkdownLite()`, which only runs inside the "View full details"
  pop-out) and was passed as-is to `speakText()`, which only strips
  `[*_#>`]` — not emoji, not `-`, not `---`.
  **Fix**: a new deterministic backstop, `looksLikeStructuredMarkdown(text)`
  (2+ lines matching a heading/bullet/numbered/table/rule pattern), checked
  in `splitSummary()` whenever the model didn't provide a `SUMMARY:` line.
  When it fires, the reply's own leading non-structural sentence becomes the
  summary (falling back to a generic "tap to view the details" line if there
  isn't one) — same "always show a short line first" contract as an explicit
  `SUMMARY:`, just derived locally instead of trusting the model to remember
  every time. Because `convoListenOnce`'s voice path already speaks
  `result.text` (the `summaryText` `convoRespond()` returns, not the full
  text), this fixes the read-aloud half for free — no separate speech-layer
  change needed. Logic-tested in Node against the actual screenshot text
  (correctly falls back to the generic line, since that dump had no leading
  sentence), a variant with a leading sentence (correctly extracts it), a
  short unstructured reply (unaffected), an explicit `SUMMARY:` tag (still
  takes priority), and an error string (passthrough unchanged).
- **Mic permission prompt reappearing on every listen cycle, even mid-
  conversation.** Root cause: `convoListenOnce()` built a brand new
  `SpeechRecognition()` instance on every call, and the conversation loop
  calls it repeatedly (after every reply, after every retry) — so this was
  a fresh recognition session, and fresh mic acquisition, every few
  seconds. **Fix**: `getConvoRec()` now creates the `SpeechRecognition`
  instance once (event handlers wired once) and caches it in `convoRec`;
  `convoListenOnce()` just calls `.start()` on the same cached instance for
  the rest of the page's lifetime. **Two things worth checking live if
  prompts still reappear after this**: (1) if Chrome's prompt ever offers
  a persistent "Allow" vs. a one-time "Allow this time" choice, the
  persistent option should be picked; (2) this file's mic-permission
  persistence is already known to be weaker on `file://` origins than on a
  real `https://` origin (see "Still open" below and HANDOFF.md) — serving
  it via a local HTTP server (`python3 -m http.server`, then open
  `http://localhost:8000/...`) instead of double-clicking the file directly
  would very likely resolve this more permanently, since Chrome has a real
  origin to remember the grant against. Not done here since it's a hosting
  change, not a code change — worth doing as a follow-up if the code fix
  alone isn't enough.
- **"Easier navigator... rather than having to scroll the entire chat."**
  Surfaced via a screenshot plus "What could you do to upgrade" — the chat
  bubble list had no way back to the latest message besides manual
  scrolling, and every new bot reply/typing-indicator update force-scrolled
  the DE to the bottom even if they'd scrolled up to reread something. A
  literal top/bottom nav bar isn't the right shape for a chat (it's not a
  document with sections), so this is the standard chat-app pattern
  instead: **smart conditional auto-scroll + a floating "↓ New messages"
  pill**. New `#ta-msgs-wrap` (`position: relative`) now wraps `#ta-msgs`
  so the pill (`#ta-jump-latest`) can float, absolutely positioned, over
  the scrollable message list without being wiped by `restoreState()`'s
  `msgsEl.innerHTML = ''` on reload. `scrollMsgsToBottom(force)` replaces
  every unconditional `msgsEl.scrollTop = msgsEl.scrollHeight`: force-
  scrolls only when the DE was already within 60px of the bottom (or
  `force` is explicitly true), otherwise leaves their scroll position alone
  and reveals the pill instead. `addMsg()` always force-scrolls for the
  DE's own just-sent message (they were just at the input box, at the
  bottom, by definition) but only conditionally for a bot/sys message;
  `showTyping()`/`updateTypingText()` (the streaming-answer path) are
  always conditional, so a long itinerary streaming in doesn't repeatedly
  yank a DE back down mid-read. A `scroll` listener on `#ta-msgs` keeps the
  pill in sync with manual scrolling too, not just new messages; clicking
  it scrolls to bottom and hides itself. Deliberately did NOT add a
  symmetric "jump to top" button — chats grow downward, jump-to-latest is
  what matters, and the whole prior redesign of this panel was explicitly
  about decluttering it. `restoreState()`'s own scroll-to-bottom (on
  initial page load) is left as an unconditional force-scroll — landing at
  the bottom on open is the expected behavior there, not something to
  second-guess against a scroll position that doesn't exist yet.
- All three fixes verified via `node --check`-equivalent syntax parsing of
  all 15 `<script>` blocks (all pass) and a full div-tag balance recount
  (1,662 opens / 1,662 closes). **Unverified live, same caveat as
  everything else in this file**: the jump-pill's actual appearance/
  positioning over the message list, whether the mic-permission fix
  actually stops the repeat prompts in a real browser, and whether the
  markdown/speech fix reads naturally on a variety of real model replies
  (not just the one screenshot text) — none of this has been seen outside
  this environment. Test all three live before trusting them in front of a
  client: trigger a to-do-list answer and check both the bubble and the
  spoken reply, run a full voice conversation with several back-and-forth
  turns and watch whether the permission prompt reappears, and scroll up
  mid-conversation to confirm the "↓ New messages" pill appears and works.

## Proactive hot-lead nudge (Aug 2026, unverified live)

Direct follow-up to a "what's the next big upgrade" conversation: real
Outlook/Calendar read access was the obvious next step, but it needs an
Azure AD app registration (this DE confirmed no admin rights on the KT
tenant) plus real `https://` hosting (OAuth redirect URIs can't be
`file://`) — both true architecture changes, not something to build
speculatively without them. Picked the no-dependency alternative instead:
lean harder on Client Tracker data that's already local, rather than reach
for Outlook again.

- **`maybeSurfaceHotLeadNudge()`**, called alongside the existing
  `maybeRunDailyFollowUpCheck()` every time the Trip Assistant panel opens.
  Same once-a-day, stay-silent-on-a-clean-day pattern (`localStorage`-gated
  via `TA_HOTLEAD_CHECK_KEY`, dated to today so it won't repeat until
  tomorrow) — but where the calendar check needs a live AI round trip (and
  is broken under BYOK regardless, see "Still open"), this is pure local
  filtering over `window.__ctGetTodoSummary()` (the same Client Tracker
  export the `get_todo_list` tool already uses) — instant, free, no API
  call, same spirit as the rest of this file's offline rule-based engine.
- **Deliberately narrow trigger, not the full to-do list unprompted.** Only
  clients tagged `Hot Lead` get surfaced, and only when there's an actual
  reason: their follow-up is overdue, due within the week, or they've gone
  `TA_HOTLEAD_STALE_DAYS` (5) days with no logged contact and no follow-up
  date set to explain the silence. A Hot Lead already flagged as overdue/
  due-this-week isn't also counted under the stale-contact check (a
  `alreadyFlaggedNames` set prevents double-listing the same person two
  ways). Warm/Cold/Check Back Later leads are never included — the point is
  calling out what's actually urgent among the leads worth chasing hardest,
  not re-surfacing everything already visible in the Client Tracker.
  Message caps at 5 names before switching to "+N more" so a bad day
  doesn't produce a wall of text in the chat bubble.
- Logic-tested in Node against a mocked `window.__ctGetTodoSummary`: an
  overdue Hot Lead, a due-this-week Hot Lead, and a stale-contact (8 days)
  Hot Lead all correctly flagged together in one message; a Hot Lead
  contacted only 1 day ago correctly NOT flagged (under the 5-day
  threshold); a Warm Lead correctly never flagged regardless of staleness;
  a clean day (nothing to report) correctly produces no message at all;
  calling the function twice in the same day correctly fires only once
  (dedup); a missing `window.__ctGetTodoSummary` (Client Tracker script not
  loaded) correctly no-ops instead of throwing; and the same client
  appearing in both the overdue bucket and the noDate bucket correctly
  gets listed once, not twice. All 15 `<script>` blocks still pass
  `node --check`; div-tag balance unchanged (1,662/1,662).
- **Unverified live**: whether 5 days is the right staleness threshold in
  practice, and whether the nudge's tone/timing feels genuinely useful
  versus intrusive, haven't been tested against real Client Tracker data
  in a real browser — the threshold especially is a reasonable-sounding
  guess, not something tuned against real usage patterns. Worth adjusting
  `TA_HOTLEAD_STALE_DAYS` after living with it for a week or two.

## Dead code removal — the old chip-based routing (Aug 2026)

Follow-up to "what would help next" alongside the hot-lead nudge above.
The "Trip Assistant: rebuilt as one always-conversational surface" section
had already flagged `handleResult()` and everything it exclusively called
as unreachable once `send()` started routing every message straight to the
live AI — left in place at the time since verifying ~250 lines had truly
no other caller, with no way to run this live, was judged riskier than a
later, more careful pass. This was that pass.

- **Verified via grep, not guesswork**: every candidate function's total
  reference count across the whole file, confirming each one's only
  caller(s) were themselves inside the same dead chain rooted at
  `handleResult()` (which `send()` never calls). Where a function like
  `searchGuideKnowledge`, `scoreSearchEntry`, or `cleanSearchText` turned
  out to have a second, live caller (`runSearchGuideTool`, the real
  `search_guide` tool handler used by the live AI) it was kept — only the
  functions with zero live callers left were removed.
- **Removed**: `handleResult`, `wantsScenarioBuild`, `buildScenarioPlan`,
  `presentScenarioDraft`, `wantsItinerary`, `scoreAllItineraries`,
  `renderItineraryRecommendation`, `renderItineraryChoices`,
  `presentRecommendation`, `wireRecommendationActions`,
  `buildDraftsFromText`, `extractCities`, `extractDayCount`,
  `extractDietaryNeeds`, `extractTravelerType`, `extractMonth`,
  `detectIntents`, `hasTemplateSignal`, `wireJumpLinks`,
  `presentKnowledgeAnswer`, `renderKnowledgeAnswer`,
  `extractRelevantSnippet`, `STALE_PATTERN`, `detectAdjustment`,
  `applyDraftAdjustment` — 933 lines net. Also removed the now-orphaned
  `lastKnowledgeContext` variable (its only reader was inside
  `handleResult`, its only writer inside the also-removed
  `presentKnowledgeAnswer`).
- **Deliberately left alone**: `lastDraftContext` and `pendingResume` are
  still declared and reset in live code (`renderAndTrackDrafts` still
  writes `lastDraftContext`) even though nothing reads either one
  meaningfully anymore — they're inert, not unreachable, and touching them
  isn't part of what this pass was scoped to. Also left alone: the
  "🧠 Actually think this through" escalation button's fallback path,
  which lives inside `handleResult` and was removed along with it — the
  panel's actual fallback-to-live-AI behavior is unaffected since `send()`
  already routes everything to the live AI directly and never had its own
  copy of that escalation button.
- Verified via the same method as every other change this session: every
  removed name greps to zero remaining references; every kept name (the
  ones above plus `send`, `convoRespond`, `foldLower`,
  `extractClientName`/`Destination`/`Tier`/`Occasion`/`Vibes`, and the
  three live search functions) still greps to its expected count; all 15
  `<script>` blocks parse via `node --check`-equivalent syntax parsing;
  div-tag balance shrank symmetrically (1,662/1,662 → 1,610/1,610 opens/
  closes) since the removed functions built HTML template strings, not
  just logic. No behavior change for the DE — this is pure removal of code
  that `send()` was already never calling.

## Installable app + best-effort background reminders (Aug 2026, unverified live)

The other half of "what would help next" alongside the dead-code cleanup
above. CLAUDE.md's "Still open" already named this gap explicitly: the
Client Tracker's browser-notification reminders only fire while the tab
is actually open — no service worker meant no way to check for due
follow-ups with the tab or browser closed. Real OAuth-backed Outlook read
access remains blocked (DE has no admin rights on the KT tenant, see the
hot-lead-nudge section above) — this is the other, no-admin-rights-needed
way to close part of that gap, though it's a narrower fix than Outlook
would be.

- **New file: `sw.js`**, hosted alongside `Tommie_Tours.html`.
  This is the one piece of this project that couldn't be inlined into the
  single HTML file no matter what — browsers refuse to register a service
  worker from a `data:`/`blob:` URL, only a real same-origin `.js` file
  works. Its own header comment carries the full explanation; short
  version: it reads a lightweight IndexedDB mirror of Client Tracker
  follow-up dates (service workers can't read `localStorage`, a different
  storage world) and calls `registration.showNotification()` for anything
  overdue or due today, deduped per-client-per-day the same way the
  existing same-tab `ctCheckDueReminders()` already does.
- **Installability**: a base64-encoded Web App Manifest is now linked from
  `<head>` via a `data:application/manifest+json;base64,...` URL — unlike
  the service worker, browsers do accept a data-URI manifest, so this
  stayed inline. Lets the DE "Install" the guide as a standalone app (own
  window, own icon, no browser chrome) where the browser supports it.
  Silently does nothing if the browser doesn't support installable web
  apps or ignores a data-URI icon.
- **`ctMirrorRemindersToIndexedDb()`** writes just `{id, name, status,
  nextFollowUp}` — not the full client record — into IndexedDB every time
  `ctSaveData()` runs, so the service worker has something current to read
  independent of whether any tab is open. `ctRegisterServiceWorker()`
  registers `./sw.js` on load; `ctTryEnableBackgroundSync()` asks for
  Periodic Background Sync after notification permission is granted.
- **Genuinely best-effort, stated as such everywhere it's surfaced** —
  this is the honest ceiling of what's achievable with zero backend and
  zero admin rights, not a corner that was cut. Periodic Background Sync:
  only implemented in Chrome/Chromium (not Firefox/Safari), only wakes a
  service worker for an *installed* app, and even then only if Chrome's
  own site-engagement heuristics judge the app "used enough" — there's no
  manual override for that, the DE can't just toggle it on. And none of
  this works at all over `file://` — service workers require a real
  `https://` or `http://localhost` origin, a hard browser restriction, so
  on `file://` (this guide's typical usage) `ctRegisterServiceWorker()`
  fails immediately and silently, and the same-tab-only reminders that
  already existed remain the only ones — nothing regresses. `sw.js` not
  being hosted next to the HTML file (e.g. only the HTML got copied
  somewhere) fails the same way, same silently. `ctRefreshNotifyUI()`'s
  own copy reflects this honestly — it says "possibly in the background
  too... not guaranteed either way," never "on."
- Logic-tested in Node: `sw.js`'s core due-date decision (extracted and
  run against synthetic clients — overdue, due today, closed, future, and
  already-notified-today all resolved correctly, matching
  `ctCheckDueReminders()`'s same rule). `node --check sw.js` passes
  standalone. All 15 `<script>` blocks in the main file still pass syntax
  parsing; div-tag balance unchanged (1,610/1,610).
- **Unverified live, and unusually hard to verify from this environment
  even in principle**: everything about the actual service worker
  lifecycle (registration succeeding, `periodicsync` actually firing,
  `showNotification()` actually displaying) needs a real https-hosted
  origin, an installed PWA, and enough real usage for Chrome's engagement
  heuristics to grant the permission — none of which can be faked or
  fast-forwarded. Test the parts that CAN be checked first: confirm the
  install prompt/option appears when hosted over https, confirm
  `sw.js` registers without error in DevTools' Application panel, confirm
  the IndexedDB `kt-reminders` store actually populates after saving a
  client with a follow-up date. Whether Periodic Background Sync itself
  ever fires is realistically a "live with it for a while and see" thing,
  not a same-day test.

## Qualifying Call mode for the Client Tracker (Aug 2026, unverified live)

Direct request: a call-friendly presentation of the same client-intake
questions (Client Details, Trip Vision, Hotel Preferences, Transfers,
Restaurants, Other — see "Client Tracker: real intake questionnaire..."
above) for reading down live while on a call, that still saves as a real
Client Tracker record rather than a disconnected scratch pad.

- **Reuses the existing Add-client form and fields wholesale — not a
  second, parallel intake form.** The `<details>`-collapsed sections
  added earlier this session are exactly the right question set already;
  what made them awkward mid-call was the collapsing itself, not the
  questions or the schema. Building a second form with its own field IDs
  would mean two schemas to keep in sync with `ctHandleSave()` forever;
  instead, a new **"🎯 Qualifying Call"** button next to "+ Add client" in
  the toolbar calls `ctOpenQualifyingCall()`, which calls the existing
  `ctOpenForm(null)` (same as a plain Add) and then just changes how it's
  presented: force-opens every `.ct-form-section` and adds a `.ct-call-mode`
  class. Saving goes through the exact same `ctHandleSave()` as every
  other Add/Edit — a call-qualified lead is a completely normal Client
  Tracker record, nothing about it is tagged or stored differently.
- **`.ct-call-mode` styling** — bigger label/input font sizes (13.5px→15px)
  for glancing at while listening to a client, more spacing between
  sections, and each section's `▸` toggle arrow and click-to-collapse
  disabled (`pointer-events: none`) so an accidental click mid-call can't
  re-collapse a section that's supposed to stay visible. A gold banner
  ("📞 On a call — ask down the page in order...") appears at the top of
  the form only in this mode, so it's visually distinct from a routine
  edit at a glance.
- **`ctCloseForm()` resets section open/closed state back to the normal
  default** (only "Client Details" open, matching a plain Add/Edit)
  whenever the form closes — via Cancel, via Save, or via starting a
  Qualifying Call and later closing it — so call mode's "everything open"
  state never bleeds into a later ordinary Add or Edit.
- Deliberately did **not** pre-select a Lead category or reorder the
  question sections — the existing Client Details → Trip Vision → Hotel
  Preferences → Transfers → Restaurants → Other order already reads as a
  natural call flow (who/when/budget, then what they want, then the
  specifics), and guessing a lead temperature before the call has actually
  happened would be backwards. Status still defaults to "Inquiry," which
  was already correct for a brand-new lead.
- Logic-tested in Node (the section open/closed boolean logic, isolated
  from the DOM): force-open sets every section's `open` to `true`; the
  close-time reset correctly restores only `ct-sec-client` to `open` and
  every other section to `false`, matching the form's normal default.
  All 15 `<script>` blocks still pass syntax parsing; div-tag balance
  incremented by exactly one (the new banner `<div>`), from 1,610/1,610 to
  1,611/1,611.
- **Unverified live**: whether the forced font-size bump and the disabled
  section-collapse actually feel right while on a real call — that's a
  "use it on the next few calls and see" judgment, not something
  checkable from here. If the banner or the larger text feels like too
  much, both are scoped entirely under `.ct-call-mode` in the CSS and
  easy to tune independently of the normal Add/Edit form.

## Append-only call log + Enter-to-advance in the Client Tracker form (Aug 2026, unverified live)

Two follow-ups to the Qualifying Call feature above, picked as the next
things worth tightening for "a clean, well-oiled document": Notes was a
single field every call silently overwrote, and moving between fields
mid-call needed the mouse since there's no real `<form>` element here for
Enter to do anything with by default.

- **Notes are now append-only and dated, without becoming a new schema
  field.** The Add/Edit form's old single "Notes" textarea is now two
  things: `#ct-f-newnote` ("Add a note for this call," always empty when
  the form opens, whether adding or editing) and a read-only
  `#ct-f-notes` showing accumulated history (hidden entirely when there
  isn't any yet). `ctHandleSave()` only ever reads the new-note box; if
  it has text, `ctTimestampedNote()` stamps it (`[Sep 1, 2026 · 3:45 PM]
  ...`) and stacks it on top of whatever notes already existed for that
  client (read fresh from `ctClients` via `ctEditingId`, not from the
  read-only textarea, so the two can't drift). **Deliberately kept
  `client.notes` as a single string** rather than introducing a
  structured array field — the alternative would have meant updating
  every existing consumer (search's substring filter, the Outlook
  deep-link event body, `propose_todo_update`'s own note-adding, and
  `__ctGetTodoSummary`) to a new shape; a plain dated-line-prefix keeps
  all of those working exactly as they did, since they still just see one
  string. `propose_todo_update`'s `noteToAdd` handling got the same
  date-stamped, newest-first treatment (previously it appended un-dated
  text to the *end* of `notes` — now it matches the manual path exactly:
  a small, deliberate duplication of the one-line stamp format across the
  two scripts rather than a cross-IIFE export for something this trivial,
  same call this file already makes elsewhere).
- **The profile view now renders notes as an actual log**, not one
  run-together paragraph — `ctRenderNotesLog()` splits on `\n` and shows
  each dated line as its own entry (a left border + a small gold date
  chip), falling back to a plain line for any note saved before this
  feature existed (no `[date]` prefix to parse). Replaced the old
  `.ct-profile-notes` single-paragraph CSS, now dead, with
  `.ct-notes-log`/`.ct-note-entry`/`.ct-note-date`/`.ct-note-text`.
- **`__ctGetTodoSummary()` (the `get_todo_list` tool's data source) now
  sends only the latest note line**, via a new `ctLatestNoteLine()`
  helper, instead of the full accumulated history — a compact "what's on
  my plate" to-do glance is the one place showing the whole call log
  back to the model would just be noise; the full history is still one
  tap away in the Client Tracker's own profile view. Nothing else that
  reads `client.notes` directly (search, the Outlook deep-link body) was
  touched — they're supposed to see the full string.
- **Enter-to-advance**: a single `keydown` listener on `#ct-form-panel`
  moves focus to the next visible field when Enter is pressed in a
  single-line input/select — there was no `<form>` element for Enter to
  do anything with before this, so it was previously just a dead key
  mid-call. Explicitly does not hijack Enter inside a `<textarea>` (has
  to stay a literal newline, matters most for the new "add a note" box)
  or a `readonly` field. `ctFormFocusables()` filters to
  `el.offsetParent !== null`, which — for free, since it's how the
  browser already treats content inside a closed `<details>` — means
  Enter only walks the fields actually visible: just the top-level fields
  plus whichever one section starts open in a normal Add/Edit, or the
  entire form end-to-end in Qualifying Call mode (see above), where every
  section is force-open. Reaching the last field moves focus to the Save
  button instead of doing nothing, so the whole form is fillable and
  submittable without the mouse.
- Logic-tested in Node: the timestamp-and-prepend behavior across two
  simulated calls (each note lands newest-first, dated, previous entries
  untouched); `ctLatestNoteLine()` against the resulting log (correctly
  returns only the most recent entry) and against an old undated note
  (returns the whole string unchanged); an XSS probe
  (`<script>alert(1)</script>` inside a note) through the full
  timestamp-and-render path (came back fully escaped, no raw tag in the
  output); an empty new-note save correctly leaves existing history
  untouched; and the Enter-to-advance index-walk logic in isolation
  (advances to the next field, reaching the last one targets Save, and a
  field that isn't in the focusable list — e.g. a readonly or hidden one
  — correctly no-ops rather than throwing). All 15 `<script>` blocks
  still pass syntax parsing; div-tag balance incremented by exactly 4
  (the new history-textarea wrapper plus the notes-log renderer's own
  template markup), from 1,611/1,611 to 1,615/1,615.
- **Unverified live**: whether the date-stamp format reads naturally at a
  glance, whether Enter-to-advance's field order actually matches how the
  DE tabs through a real call (top-level fields first, then each intake
  section in order — not reordered specifically for call flow), and
  whether disabling a section's click-to-collapse in Qualifying Call mode
  combines well with Enter-to-advance walking through all of them, are
  all "try it on the next few calls" questions, not checkable from here.

## Match Itinerary — background suggestion on the client card (Aug 2026, unverified live)

Direct request: a "Match Itinerary" button/feature on the client card that
runs while typing and re-suggests when the destination changes, so
picking the right official (or personal) itinerary doesn't need a trip to
the Trip Assistant chat.

- **Reuses the live AI tool's own scoring, not a second copy of it.**
  `find_matching_itinerary`'s real logic is `scoreItinerariesByCities()`
  inside the Trip Assistant's IIFE — exported as
  `window.__taMatchItinerary(cities, days)` (returns raw scored
  `{official, personal}` objects, not the markdown string the tool
  hands the model) so a client-card suggestion and a chat answer can
  never disagree about which itinerary a set of cities matches. City
  extraction from the free-text Destination field
  (`ctExtractCities()`) is new, small, Client-Tracker-local code — a
  direct city-name substring check against `QB_CITY_ORDER` (a true
  global, same as `KT_LIVE_ITINERARIES`/`PERSONAL_ITINERARIES`, so no
  export needed for that part).
- **Entirely local/instant — no live-AI call.** "Runs in the background
  while typing" only works believably if it's free and has no latency;
  city-overlap matching already is exactly that, so there was no reason
  to reach for the model here. `ctScheduleItineraryMatch()` debounces the
  Destination field's `input` event by 700ms so it fires once typing
  pauses, not on every keystroke — visually "always working," never a
  real per-keystroke cost.
- **Suggests, never auto-applies.** Confirmed as the right call against
  the alternative floated in the request (silently swapping the
  Itinerary dropdown when a new city is typed): this file's standing rule
  — Outlook, `propose_todo_update` — is propose, DE confirms, and an
  itinerary silently swapped by a small wording tweak with no visible
  confirmation is a worse failure mode than just asking. `#ct-itinerary-
  suggest` shows up to 2 official + 1 personal match as small cards with
  their own "Apply" button (`ctRenderMatchOption()`), each just writing
  `ct-f-itinerary`'s value when tapped — the DE always makes the actual
  choice.
- **Also runs once on opening an existing client** that already has a
  destination but no itinerary picked yet (`ctOpenForm()`'s new check),
  not just on typing — covers a client card someone else filled in, or
  one from before this feature existed, without needing to retype
  anything to trigger a match. A brand-new blank Add form has nothing to
  match yet, so this just clears any suggestion left over from whichever
  client was open last.
- **"🎯 Match Itinerary" button** next to the Itinerary label runs the
  same match immediately, for a destination that's already been sitting
  there un-typed-into (paste, or a value set before this button existed)
  — the debounced auto-trigger only fires on new typing, not on a value
  that's simply present.
- Logic-tested in Node: `ctExtractCities()` against multi-city text,
  single-city text, no-match text, and empty input; the shared scoring
  logic (mirrored from `scoreItinerariesByCities`) against three
  synthetic itineraries with a multi-city request, confirming the
  highest-overlap itinerary sorts first. All 15 `<script>` blocks still
  parse; div-tag balance stayed even (opens === closes) after the new
  markup.
- **Unverified live**: whether 700ms feels responsive or laggy while
  actually typing, whether showing up to 3 suggestion cards is the right
  amount versus just the single best match, and whether the "Apply"
  button placement reads clearly at a glance — none of this has been
  tried in a real browser from this environment.

## Draft outreach button + AI-assisted itinerary matching (Aug 2026, unverified live)

Two direct follow-ups to Match Itinerary, picked from "what would help
next": matching an itinerary was a dead end (nothing happened after), and
the offline city-only matcher had no answer when Destination didn't
contain a recognized Spain city name.

- **"✉️ Draft outreach" in the profile view** (`ctDraftOutreach()`) sends
  a request into the Trip Assistant's own chat exactly as if the DE had
  typed it — opens the panel (`#ta-btn.click()`), fills `#ta-input` from
  the client's name, matched itinerary (or destination if none is set
  yet), trip vision, budget, traveler ages, dietary needs, and special
  occasion, then clicks `#ta-send`. Deliberately drives the real UI
  instead of duplicating Trip Assistant's drafting/streaming/draft-
  detection/Outlook-and-SMS-button logic a second time here — same
  pattern `prefillQuoteBuilder()` already uses for its own handoff into
  the Quote Builder. Closes `#ct-overlay` first — it's a full-screen
  `z-index: 10000` backdrop, above `#ta-panel`'s `9999`, so Trip
  Assistant would otherwise open invisibly behind it. A free side effect:
  `send()`'s own `extractClientName()`/`extractDestination()` calls run
  on whatever text is in the input box, so they naturally pick this
  client's name/destination out of the constructed message — Trip
  Assistant's context bar ends up reflecting this client too, with no
  extra wiring for that specifically. Always visible in the profile view
  (not conditional on having a matched itinerary) — the model already
  handles "no clear KT match" gracefully via `find_matching_itinerary`'s
  own custom-trip fallback, so even a bare client card can still produce
  something useful.
- **AI-assisted matching, opt-in only, when the free local matcher comes
  up empty.** The offline city-only matcher (`ctRunItineraryMatch()`)
  can't reason about Trip Vision, budget, or traveler details — teaching
  it that nuance would mean re-implementing judgment a model already has.
  Instead, both empty cases (`ctNoMatchHtml()`: no recognized city in
  Destination at all, or recognized cities that scored zero official/
  personal matches) now show an inline "🧠 Ask AI to match" button rather
  than just a dead-end message. Only fires on an explicit click, never
  automatically — unlike the free instant local matcher, this is a real
  API call with real latency and cost, so it stays opt-in the same way
  every other live-AI action in this file does. `ctRunAiItineraryMatch()`
  builds a prompt from Destination/Trip Vision/Budget/Traveler ages/
  Dietary needs, sends it through the already-exported
  `window.__taCallClaudeAI` with a note asking for just an itinerary
  title on the first line (`find_matching_itinerary`, same tool, same
  data, richer input), then tries to resolve that title against
  `KT_LIVE_ITINERARIES`/`PERSONAL_ITINERARIES` — a confident match gets
  the same "Apply" button as a local match card; anything else still
  shows the AI's one-line reasoning as plain text so the attempt wasn't
  wasted even without a clean auto-detected title.
- Local-match "Apply" wiring was pulled out into a shared
  `ctWireMatchApplyButtons()` (both the local-match render path and the
  AI-match render path call it) rather than two copies of the same three
  lines.
- Logic-tested in Node: the outreach prompt built correctly across three
  cases (itinerary set, destination-only, bare-minimum client with just a
  name); the AI-match title-detection regex-free substring match against
  an exact title, a title with trailing text, and a genuine "no match"
  response (correctly returns nothing to auto-apply in that last case).
  All 15 `<script>` blocks parse; div-tag balance stayed even.
- **Unverified live**: whether the drafted email actually reads well
  when built from this specific bit of client-card context (versus how
  it reads when typed conversationally in chat), whether opening Trip
  Assistant on top of a just-closed Client Tracker feels smooth or
  jarring, and whether the AI-match fallback's title-detection ever
  mis-fires on a real model response shaped slightly differently than
  expected — none of this has been tried in a real browser.

## Itinerary document export + Draft-outreach context-bleed fix (Aug 2026, unverified live)

Two follow-ups from "what's the biggest Trip Assistant improvement":
turning an AI itinerary answer into an actual client-ready document, and
fixing a real correctness risk flagged in the same conversation —
"Draft outreach" (see the section above) could land a new client's
request in the middle of an unrelated client's conversation history.

- **"📄 Download as document"** on the "View full details" pop-out
  (`taDownloadItineraryDoc()`) re-renders the same markdown already shown
  there through `taBuildItineraryDocHtml()` — a standalone, branded HTML
  document (Georgia serif, sage/gold accents) matching the Quote
  Builder's own `qbBuildDocumentHtml()` styling — and downloads it via
  the exact same trick `qbDownloadDoc()` already uses: a `Blob` typed
  `application/msword` with a `.doc` extension, which Word opens directly
  since it's well-formed HTML, no real format conversion needed.
  **Deliberately the smaller of two possible builds** — the bigger
  version would parse the AI's free-text answer back into the Quote
  Builder's own structured data (hotels/days/tours objects) to reuse its
  exporter outright; that means teaching this file to reverse-engineer
  structure out of prose reliably, a real project on its own. This
  version just re-skins already-rendered markdown, so it ships today with
  much less risk, at the cost of not being able to do anything
  structure-aware (city-by-city breakdowns, editable line items) a real
  Quote Builder document can. `openItineraryModal()` now also stashes the
  raw markdown in `lastItineraryModalText`, since the modal body only
  ever held the rendered HTML before — nothing to rebuild a document from.
- **Draft-outreach context bleed, fixed.** Flagged as a real risk in the
  conversation that led to building "Draft outreach" in the first place:
  clicking it while Trip Assistant already had an unrelated client's
  conversation open would send the new request into that same
  `convoHistory` — the model could blend two different clients' details
  in one thread. `contextResetBtn`'s inline reset logic was pulled out
  into `resetClientContext()` (used by both the button and the new path,
  instead of two copies of the same six lines), and a new
  `window.__taEnsureClientContext(name)` export runs it automatically
  whenever `ctDraftOutreach()` is about to send a request for a client
  whose name doesn't match whichever client Trip Assistant's `taState`
  currently has active. **Deliberately a no-op when the conversation is
  already about the same client, or about nobody yet** — resetting there
  would just lose real context (something the DE said earlier in the same
  call, for instance) for no reason.
- Logic-tested in Node: the document builder against a normal client
  name, a not-yet-set client name (falls back to "Prospective Client"),
  and an XSS probe in the client name (escaped, no raw tag in the
  output); the context-reset decision against all four cases (different
  client → reset, same client → no reset, no active client yet → no
  reset, no name given → no reset). All 15 `<script>` blocks parse;
  div-tag balance incremented by exactly one (the new download button).
- **Unverified live**: whether a `.doc`-extension HTML file actually
  opens cleanly in whatever version of Word the DE has, and whether the
  reset genuinely feels invisible when switching between clients versus
  jarring — both need a real browser/Word combination to check, not
  something this environment can confirm.

## Clickable client names in Trip Assistant answers (Aug 2026, unverified live)

Direct response to a screenshot: a to-do answer's "View full details"
pop-out showed a table with a client's name ("Amanda Jackson") sitting
there as inert text — the only way to actually act on it was to close
the modal and go find that client by hand in the Client Tracker.

- **`wireClientProfileLinks()`** runs right after `openItineraryModal()`
  sets the pop-out's HTML, turning any real Client Tracker client's name
  — wherever it appears in the rendered answer, a table cell, bold text,
  a plain sentence — into a click that jumps straight to their actual
  profile. Walks real text nodes with a `TreeWalker` rather than string-
  replacing the rendered HTML, so a match can never land inside a tag or
  attribute by accident. Sorts candidate names longest-first before
  matching, so "Tom Reyes Jr." isn't cut short by a partial hit on
  "Tom Reyes" landing first.
- **New minimal exports**: `window.__ctListClients()` (just `{id, name}`
  pairs — text-matching is all this needs, no reason to expose full
  records for it) and `window.__ctOpenClientProfile(id)` (opens the
  Client Tracker panel and jumps straight to that client's profile,
  skipping the list view — the same two taps a DE would make by hand,
  triggered programmatically). Clicking a linked name closes the
  itinerary pop-out first, then calls this — the same "drive the real
  UI, don't rebuild it" pattern `ctDraftOutreach()`/
  `prefillQuoteBuilder()` already use in the other direction.
- Only wraps the first match per text node (a name repeated twice in one
  line is rare, and matching it once is already actionable) — kept
  simple rather than handling every repeat occurrence.
- Logic-tested in Node: the longest-name-first matching decision against
  an exact single match, a name that's a substring of a longer client's
  name (correctly prefers the longer one), a name with no longer
  conflicting name present (still matches correctly), no match at all,
  and an empty client list — all resolved as expected. All 15
  `<script>` blocks parse; div-tag balance unchanged (no new `<div>`s,
  only buttons/text nodes).
- **Unverified live**: the actual click-and-jump behavior, and whether
  the button styling reads clearly inline within a table cell versus a
  plain sentence, haven't been seen in a real browser from this
  environment.

## Qualifying Call save lands on the new profile (Aug 2026, unverified live)

Self-directed follow-up connecting two features built earlier this
session that hadn't actually been wired together yet: Qualifying Call
mode (a call-friendly intake form) and "✉️ Draft outreach" (lives on the
profile view). Saving a fresh Qualifying Call used to drop the DE back on
the plain client list — finding the card they just created and tapping
into it was still a manual step between "call just ended" and "send them
something."

- **`ctHandleSave()` now opens the new client's own profile
  (`ctOpenDetail(newId)`) immediately after a Qualifying Call save**,
  landing the DE exactly where "✉️ Draft outreach" already lives instead
  of the list view. Scoped tightly: a new `ctIsQualifyingCall` flag is
  set only by `ctOpenQualifyingCall()` and reset by `ctCloseForm()` (so
  it can't leak into a later ordinary Add/Edit), and the jump only fires
  when the save is BOTH a Qualifying Call AND a genuinely new client
  (`!ctEditingId`) — editing an existing client through any path still
  lands back on whatever view was already open, unchanged.
- No new UI at all — this is purely smarter navigation reusing the
  profile view and Draft-outreach button that already existed.
- Logic-tested the four-case decision table in isolation (fresh
  Qualifying Call save → jump; a Qualifying-Call-flagged save that's
  somehow editing an existing client → no jump; a normal Add → no jump; a
  normal Edit → no jump) — all four resolved correctly. All 15
  `<script>` blocks parse; div-tag balance unchanged (no new markup).
- **Unverified live**: whether landing straight on the profile after
  Save feels like a natural continuation of the call or an unexpected
  jump — worth noticing on the next few Qualifying Calls.

## Daily Brief — consolidating two ambient checks into one (Aug 2026, unverified live)

Direct response to "what's the biggest upgrade to really make this a
right hand," followed immediately by "I just want Jarvis to be a master
at what it already does vs doing too much" — which reshaped the answer
from a new capability into a consolidation: two existing ambient checks
were overlapping and one of them was silently wasting a live API call
every day for a feature that can't work yet. No new UI was added here on
purpose, in line with that steer.

- **Removed the calendar-based ambient check entirely** —
  `runFollowUpCheck()`, `maybeRunDailyFollowUpCheck()`,
  `TA_FOLLOWUP_CHECK_KEY`, `getKnownClientNames()`, and the
  `TA_CALENDAR_MCP`/`TA_DRIVE_MCP` constants that fed them. This wasn't
  ever going to succeed: Outlook MCP is confirmed broken under BYOK (no
  OAuth path without an Azure AD app registration this DE has no admin
  rights for — see "Still open"), so every single day, opening the Trip
  Assistant panel was firing one real, guaranteed-to-fail live API call
  for zero benefit — pure cost and latency with no upside until that's
  fixed for real. The general MCP connector plumbing
  (`buildTools()`/`buildBetaHeader()`) is untouched and still correct —
  only the two dead constants that used to feed it, and the one feature
  that called them, are gone.
- **`maybeSurfaceHotLeadNudge()` folded into a new
  `maybeSurfaceDailyBrief()`**, which now also covers overdue and
  due-this-week follow-ups (previously only ever mentioned obliquely, via
  the broken calendar check) — one consolidated "☀️ Here's what's worth
  knowing today" message instead of what used to be up to two separate
  ones. Same rules as before for what counts as a Hot Lead worth flagging
  (overdue, due this week, or `TA_HOTLEAD_STALE_DAYS` days with no
  contact and nothing scheduled) — a name can legitimately appear in both
  the overdue line and the hot-lead line, since "this is late" and "this
  is also hot" are two different facts worth stating, not a duplicate.
- **Fires from whichever panel opens first, not just Trip Assistant.**
  This was a real, if quiet, gap in what already existed: the old
  hot-lead nudge only ever fired if the DE happened to open the Trip
  Assistant panel that day — a day spent entirely in the Client Tracker
  meant it silently never ran. `window.__taMaybeSurfaceDailyBrief()` is a
  new minimal export the Client Tracker's own panel-open handler now
  calls too, sharing the exact same once-a-day dedup key
  (`TA_DAILY_BRIEF_KEY`) so it only ever actually posts once regardless
  of which button gets tapped first — the message itself always lands in
  Trip Assistant's chat log either way, ready to read whenever that panel
  is actually opened.
- Logic-tested the consolidated line-building in Node against four cases:
  a mix of overdue/due-soon/stale-hot-lead all present at once (including
  the deliberate double-listing of one name), a fully clean day
  (correctly produces zero lines), a hot-lead-only day with nothing
  overdue or due soon, and a list past 5 names truncating to "+N more."
  All 15 `<script>` blocks parse; div-tag balance unchanged (pure
  function/wiring changes, no new markup).
- **Unverified live**: whether the consolidated message reads better than
  the two separate ones did, and whether firing from the Client Tracker's
  open button feels natural or surprising the first time it happens
  there instead of in Trip Assistant — worth noticing over the next few
  days of actual use.

## Daily Brief: real greeting + clickable names (Aug 2026, unverified live)

Direct request: "Hello, here is your day at a glance," plus wanting the
brief's items directly actionable. Small, tightly-scoped follow-up to the
Daily Brief consolidation above — reuses two things that already existed
rather than building anything new.

- **Real chat bubble, not a quiet system aside.** The brief used to post
  as a `sys`-role message (small italic gray text, easy to skim past) —
  now posts as a normal `bot` bubble opening with "Hello — here's your
  day at a glance," reading like an assistant actually greeting the DE
  rather than a log line.
- **Every name in the brief is clickable**, reusing
  `wireClientProfileLinks()` exactly as built for the itinerary pop-out —
  no new matching/linking logic, just called on the brief's own message
  div right after `addMsg()` returns it. Tapping a name jumps straight to
  that client's real profile, same as everywhere else this now works.
- Logic-tested the HTML-building + escaping in Node: a normal two-line
  brief renders as expected, and an XSS probe embedded in what would be a
  flagged line (`<script>alert(1)</script>`) comes back fully escaped, no
  raw tag in the output. All 15 `<script>` blocks parse; div-tag balance
  unchanged (no new markup, just a different `addMsg` call).
- **Unverified live**: whether `.ta-client-link`'s pill styling (a
  `--ct-gold-soft`/`#f3ead9` fill) stays visually distinct against the
  bot bubble's own near-identical background color, or reads as flatter
  than it does inside the itinerary pop-out's lighter background — the
  gold border should still make it readable as a button either way, but
  this hasn't been seen in a real browser.

## Three deepening upgrades: brief quick-actions, a real welcome, live captions (Aug 2026, unverified live)

Direct response to "what would be some upgraded assistant features" —
all three chosen specifically to deepen existing capability rather than
add new surface area, matching the "master what it already does" steer
from the Daily Brief work above.

- **Daily Brief quick actions.** Each flagged client's name was already
  clickable (jumps to their profile); now there's also a small "✉️ Draft"
  button right in the brief for every flagged client (overdue, due-soon,
  or hot for any reason), deduped by id so a client flagged three
  different ways only gets one row, capped at 5. Reuses `ctDraftOutreach`
  entirely — a new minimal export, `window.__ctDraftOutreachById(id)`,
  resolves the id to a real client record inside the Client Tracker and
  calls the existing function, so the Trip Assistant side never needs the
  full record itself (same "resolve internally, act, don't leak data
  across the boundary" shape as `__ctApplyPatch`/`__ctOpenClientProfile`).
- **A welcome message that actually says what Jarvis can do.** The
  original "Hi — just ask..." bubble predates most of what's since been
  built (Match Itinerary, voice, image attach, the Daily Brief itself).
  Rewritten to mention what's actually there today — not a new
  capability, just making already-shipped ones discoverable instead of
  quietly accumulating underneath a stale first message.
- **Live captions while listening.** `interimResults` was `false` on the
  conversation-mode `SpeechRecognition` instance, so `onresult` only ever
  fired once per utterance, with nothing shown until the DE finished
  talking. Now `true`, with `onresult` checking each result's `isFinal`
  flag: an interim result updates a small caption bar (`#ta-voice-
  caption`, shown only while actively listening) via
  `updateVoiceCaption()`; only a final result runs the existing
  send-to-AI flow, via `clearVoiceCaption()` first. `resetConvoUI()`
  (already the shared cleanup for both an explicit stop and a fatal mic
  error) also clears the caption, so nothing lingers once voice mode
  ends. **Deliberately left the guide's own separate Ctrl+K voice-search
  feature untouched** — a completely different `SpeechRecognition`
  instance in an unrelated part of the file that happened to share the
  same `interimResults` setting name; changing it would have been
  unrelated scope, not a deepening of anything.
- Logic-tested in Node: the quick-action dedup (a client flagged three
  ways → one row; a clean day → zero rows; the same client appearing
  in two source buckets → still one row) and the interim/final caption
  branching (two interim updates shown, only the final result committed
  as the actual transcript) — both matched expected behavior. All 15
  `<script>` blocks parse; div-tag balance held (opens === closes) after
  all three changes.
- **Unverified live**: whether the Draft buttons read clearly stacked
  inside an already-busy brief bubble, whether the caption bar's
  placement/timing feels natural while actually talking (there's no way
  to test real speech recognition from this environment), and whether
  the new welcome message is now too long — all worth a first look before
  trusting them in front of a client.

## Two real live bugs caught and fixed (Aug 2026) — first genuine regression this session

Surfaced by an actual live test (a real client-detail message that
triggered the `search_guide`/`find_matching_itinerary` tools): a hard
error, `ITIN_STOPWORDS is not defined`, shown in the chat with a Try
Again button. Both bugs traced back to the same root cause: the earlier
dead-code cleanup pass verified every function's *callers* carefully but
didn't check every *constant* a kept function depended on.

- **`ITIN_STOPWORDS` was deleted along with genuinely dead code sitting
  right next to it**, but `scoreSearchEntry()` — part of the live
  `search_guide` tool path — also depended on it. The dead-code sweep
  checked function names exhaustively but missed this one shared
  constant. Restored `const ITIN_STOPWORDS = new Set([...])` right next
  to its one remaining real caller, with a comment explaining exactly
  why it disappeared and came back.
- **A second, independent bug found while verifying the fix, not by
  guessing**: `runSearchGuideTool()` (the actual `search_guide` tool
  handler) read `r.title`/`r.text` off `searchGuideKnowledge()`'s
  results, but that function returns `{entry, score}` pairs — `r.entry
  .title`/`r.entry.text` is correct, `r.title`/`r.text` is `undefined`.
  Every real `search_guide` tool call would have hit this immediately
  after the `ITIN_STOPWORDS` crash was fixed, handing the model a wall of
  "### undefined\nundefined" instead of actual guide content. This
  predates this session's changes — not something introduced by the
  cleanup, just never caught because `search_guide` apparently hadn't
  actually been exercised live before this test.
- **How this was actually caught**: not static review — a Node test
  harness that evaluates the real Trip Assistant `<script>` block with
  stubbed browser globals (`document`, `localStorage`, `window`, mock
  `SEARCH_INDEX`/`KT_LIVE_ITINERARIES`/etc.) and genuinely *calls*
  `runSearchGuideTool`, `runGetTodoListTool`, `runProposeTodoUpdateTool`,
  `runFindMatchingItineraryTool`, `runGetCityDataTool`, and a dozen other
  live functions end-to-end, not just `node --check`-style syntax
  parsing. This is a stronger verification method than anything used
  earlier this session for pure-logic testing — worth reusing before any
  future cleanup pass that touches shared constants, since exactly this
  kind of shape/reference mismatch is invisible to `node --check` and
  easy to miss in a manual reference-count sweep.
- Confirmed via that same harness, post-fix: `runSearchGuideTool` now
  returns real guide content; `scoreSearchEntry`/`searchGuideKnowledge`
  no longer throw; `runGetTodoListTool`/`runProposeTodoUpdateTool`/
  `runFindMatchingItineraryTool`/`runGetCityDataTool`/`extractClientName`/
  `extractDestination`/`extractTier`/`extractOccasion`/`extractVibes`/
  `splitSummary`/`renderMarkdownLite`/`isNewClientSignal` all execute
  cleanly against realistic inputs. All 15 `<script>` blocks still pass
  syntax parsing; div-tag balance unchanged (both fixes were pure logic,
  no markup touched).

## Daily Brief client-link click reported broken live — defensive fix + a real double-wrap bug (Aug 2026, unverified live)

Reported live: a client-name pill in the brief's "hot lead" line
(styled correctly, `.ta-client-link`'s hover look) did nothing on click.
Static review of `wireClientProfileLinks()`/`__ctOpenClientProfile()`
didn't turn up a conclusive reason two structurally-identical pills in
the same message would behave differently — genuinely can't rule out a
timing/state issue that only shows up live, not from reading the code —
so this pass made the failure mode itself visible instead of guessing
blind, and fixed one real bug found along the way:

- **Every `.ta-client-link` click is now wrapped in try/catch with a
  real chat message on failure** — "Couldn't open that client: ..." (or
  a "hasn't loaded yet" message if `window.__ctOpenClientProfile` isn't
  even defined) instead of silently doing nothing. Same treatment for
  the Daily Brief's "✉️ Draft" buttons. This doesn't identify the root
  cause on its own, but it turns "nothing happens" into an actual error
  message the DE can report back — the single biggest blocker to
  debugging this further from an environment with no browser access.
- **A real, confirmed double-wrap bug found while investigating,
  independent of whatever the original report turns out to be**:
  `wireClientProfileLinks(div)` was called on the ENTIRE brief message,
  including the `.ta-brief-actions` block — meaning each action row's own
  `<span>${name}</span>` also got its text node replaced with a *second*,
  nested `<button class="ta-client-link">` sitting right next to that
  row's "✉️ Draft" button. Redundant at best (two ways to reach the same
  profile inches apart) and fragile DOM nesting at worst (a button
  effectively doubled up beside another button). Fixed by wrapping just
  the summary lines in their own `<span class="ta-brief-lines">` and
  scoping `wireClientProfileLinks()` to that span only — the action rows'
  names stay plain text now, which is correct since they already have
  their own dedicated action (Draft) right there.
- Logic-tested: `maybeSurfaceDailyBrief()` still runs end-to-end without
  throwing against a mocked `__ctGetTodoSummary`/`__ctListClients`, even
  with `__ctOpenClientProfile` deliberately mocked to throw (confirming
  the build path is unaffected — the try/catch only matters at actual
  click time, which a DOM-stubbed Node harness can't fully exercise).
  All 15 `<script>` blocks parse; div-tag balance held.
- **Still genuinely unverified**: whether the double-wrap fix was the
  actual cause of the reported click failure, or a real-but-separate bug
  from it. Ask for the exact wording of any new "Couldn't open that
  client..." message next time this is tested — that's the fastest path
  to the real root cause if the problem persists after this fix.

## Clickable client names extended to every chat reply (Aug 2026, unverified live)

Follow-up to the previous entry, and turned out to be the real fix for
what looked like a regression: reported live that a client name
mentioned in a normal conversational reply ("what does my day look
like?") showed as plain text with no way to act on it. This wasn't a
regression from the double-wrap fix above — `wireClientProfileLinks()`
had only ever been wired into two specific places (the Daily Brief, the
itinerary "View full details" pop-out), never into `addAiAnswerMsg()`,
the shared bubble every OTHER live-AI reply funnels through (Conversation
Mode, the "Actually think this through" escalation, typed chat, the
image-question path). The DE reasonably expected the same behavior
everywhere Jarvis mentions a client, not just in the two spots it
happened to be built first.

- **One line added**: `wireClientProfileLinks(div)` inside
  `addAiAnswerMsg()`, right after the bubble is created. Because this
  function is the single shared rendering path for every non-draft
  live-AI reply, this one change makes client names clickable
  everywhere consistently, not just in the Daily Brief and the pop-out.
- **Deliberately not wired into drafted emails/texts**
  (`renderAndTrackDrafts`) — that content is meant to be copy-pasted or
  sent as-is to the client; embedding an interactive "jump to profile"
  button inside what's supposed to read as plain email text would be
  visually wrong there, unlike a DE-facing chat bubble.
- Logic-tested in Node: `addAiAnswerMsg()` still runs end-to-end without
  throwing against a mocked `__ctListClients`/DOM (including
  `NodeFilter.SHOW_TEXT`, needed since this exercises the real
  `wireClientProfileLinks()` TreeWalker path this time, not just a
  build-only check). All 15 `<script>` blocks parse; div-tag balance
  unchanged (one function call added, no new markup).

## Profile task sidebar + card quick-notes (Aug 2026, unverified live)

Two direct requests from the same conversation: the wide profile modal
left roughly half its width blank once the info column hit its
`max-width: 520px` reading cap, and adding a fast way to jot a note on a
client without opening the full form.

- **Two-column profile view.** `ctRenderDetail()`'s template now wraps
  the existing info sections in `.ct-detail-main` and adds a new
  `.ct-detail-sidebar` (`grid-template-columns: 1fr 300px`, collapsing to
  one column under the existing 700px mobile breakpoint) using the space
  that used to sit empty. The sidebar holds, top to bottom: a new task
  callout, the action buttons (Draft outreach / Add to Outlook — moved up
  from the very bottom, now visible without scrolling past a long
  profile), and the call-notes log (also moved up for the same reason).
- **`ctBuildTaskCallout()`** answers "why does this client need me right
  now" — the same overdue/due-within-7-days/hot-and-stale-contact rules
  the Daily Brief already uses (`5` days duplicated as a literal here
  rather than importing `TA_HOTLEAD_STALE_DAYS` across the IIFE
  boundary for one number, same call this file already makes elsewhere).
  Unlike the Daily Brief, which stays silent on a clean day, this always
  shows something — a calm "✓ Nothing urgent right now" state when
  there's genuinely nothing flagged, since this is a profile someone
  opened on purpose, not a repeating ambient nudge; reassurance reads
  better than a blank space here. Never shown for a Closed client.
- **Quick note on the card itself** (`ct-card-note-btn`, a small 📝 in the
  card's name row) toggles an inline textarea + Save/Cancel right in the
  card, via a new `ctQuickNoteOpenId` render-flag (same state-driven-
  redraw pattern `ctActiveTempTab`/`ctDetailId` already use — at most one
  card's note panel open at a time). Saving reuses `ctTimestampedNote()`
  directly — the exact same append-only, dated-and-stacked mechanism the
  full Edit form's own "Add a note for this call" box already uses — so
  this is a faster door into the same one note system, not a second one.
  `e.stopPropagation()` on the toggle button, the panel itself, and both
  action buttons is load-bearing: the whole card is already a click
  target for "open profile," so without it every click meant for the
  note (including just clicking into the textarea to type) would also
  open the full profile underneath. The `<textarea>` is explicitly
  `.focus()`ed right after the re-render that creates it, rather than
  relying on a static `autofocus` attribute, which mostly doesn't fire
  reliably for content injected via `innerHTML` after initial page load.
- Logic-tested in Node: the task-callout decision tree across seven
  cases (Closed → nothing shown, overdue, due-in-2-days, due-today, a
  genuinely stale Hot Lead, a Hot Lead contacted recently correctly
  falling through to "clean" rather than staying flagged, and a plain
  clean day); the quick-note save computation (a real note stacks
  correctly above existing history, an empty/whitespace-only note is a
  no-op rather than adding a blank entry, and a client's very first note
  renders without a stray leading newline). All 15 `<script>` blocks
  parse; div-tag balance held (opens === closes) after the new markup.
- **Unverified live**: whether 300px is the right sidebar width at
  various window sizes, whether the task callout's four states read
  clearly at a glance, and whether the quick-note textarea's focus
  behavior and stopPropagation actually prevent the profile from
  accidentally opening underneath it — none of this has been tried in a
  real browser from this environment.

## Profile sidebar: sticky positioning, an always-visible Notes section, and a real draft system (Sep 2026, unverified live)

Two follow-ups from the sidebar shipped above, reported together from one
screenshot: a large blank area below the task callout/action buttons as
the page scrolled, and "I do not see the note section either" — a client
with no notes yet had no Notes section at all.

- **Sticky sidebar.** `.ct-detail-sidebar` was `display:flex` with no
  positioning — CSS Grid's `align-items:start` on the parent
  `.ct-detail-columns` stops the sidebar from being stretched to the
  taller left column's height, but it doesn't stop the *row* itself from
  being that tall, so a short sidebar just sat at the top with visual
  blank space below it as the page scrolled. Now `position: sticky; top:
  0; max-height: calc(100vh - 220px); overflow-y: auto;` — it stays in
  view (and scrolls internally if it's ever taller than the viewport)
  instead of being stranded.
- **Notes section is now always visible.** `ctRenderNotesLog(notes)` used
  to return a whole wrapped `<div class="ct-profile-section"><h4>Call
  notes</h4>...</div>` or `''` when there were no notes — the entire
  section vanished for any client without existing notes. Refactored to
  return just the `.ct-note-entry` rows (confirmed via grep to have
  exactly one caller), with `ctRenderDetail()` now building its own
  always-present header (`+ Add` toggle button) and an explicit "No notes
  yet." empty state around it. A new `ctDetailNoteOpen` flag (same
  state-driven-redraw pattern as `ctQuickNoteOpenId` on the cards) gates
  an inline quick-note form — reuses the card quick-note's own
  `.ct-card-quicknote` textarea/button styling via a second
  `.ct-sidebar-quicknote` class that only overrides the margin/border, so
  this isn't a second visual language for the same action. Saving goes
  through the same `ctTimestampedNote()` append-newest-first mechanism
  every other note-entry point in this file already uses. Reset on both
  `ctOpenDetail()`/`ctCloseDetail()` so the form never carries over onto
  a different client or a re-open of the same one.
- **`renderDrafts()`/`wireDraftButtons()` were completely undefined —
  a real, confirmed live bug, not the UX complaint it first looked like.**
  While building the above, `renderAndTrackDrafts()` (the Trip
  Assistant's only draft-rendering path — called by `renderAiReply()`
  whenever a live-AI reply is shaped like `Subject: ...\n\n<body>`) turned
  out to call two functions, `renderDrafts()` and `wireDraftButtons()`,
  that don't exist anywhere in this file (confirmed by grepping the whole
  file for their definitions — zero matches). This is the same failure
  pattern as the `ITIN_STOPWORDS` regression earlier this session: an
  earlier dead-code cleanup pass deleted the old small-bubble draft
  renderer without noticing this still-live caller. Any AI-drafted email
  would have thrown inside `renderAiReply()`'s `.then()` — caught by that
  call site's `.catch()` backstop as a generic "something unexpected
  broke" error, not the small-bubble rendering the user's own bug report
  described. (The report — "the draft outreach... too small in the
  assistant bubble" — most likely reflects a reply that didn't match the
  `Subject: ...` regex and fell through to the normal condensed
  `addAiAnswerMsg()` bubble instead, which is a real, separate gap: that
  path has no drafting-specific affordances at all, just the generic
  "View full details" pop-out.)
- **Rebuilt rather than restored**, since the old behavior was also the
  complaint. `renderAndTrackDrafts()` now:
  1. Builds a compact confirmation bubble (subject line + an "📋 Open
     draft" button) instead of dumping the full email inline.
  2. Immediately opens a new pop-out modal (`#ta-draft-overlay`/
     `#ta-draft-modal`, `openDraftModal()`/`closeDraftModal()`) — same
     overlay/backdrop-click/DOMContentLoaded-deferred-close-wiring
     pattern as the existing itinerary pop-out (`openItineraryModal`),
     including the same "look up the element fresh on every call, never
     cache the DOM node at parse time" discipline that fixed that
     feature's own real live bug earlier this session. Two actions live
     in the modal: **📋 Copy** (subject + body to the clipboard) and
     **📧 Open in Outlook** (a `outlook.office.com/mail/deeplink/compose`
     deep link in a new tab, prefilled — same pattern already used
     elsewhere in this file for the calendar-compose deep link, and
     explained to the DE if `window.open` comes back `null` from a popup
     blocker). Text-message condensing was deliberately **not** rebuilt
     here — it wasn't part of either request, and re-adding it would have
     meant guessing back a live-AI round-trip whose original
     implementation is equally gone; flagged below as a possible follow-up
     if the DE actually wants it back.
  3. **Saves the draft onto the actual client record** — direct answer to
     "make it so the drafts save in the client card. Like a profile
     environment." A new `window.__ctSaveDraft(name, {subject, body})`
     export (Client Tracker side, same fuzzy exact-then-substring name
     match `__ctFindClientByName` already uses) appends a `{id, subject,
     body, createdAt}` entry to that client's new `drafts` array (newest
     first, capped at 20) and re-renders both the card list and an open
     profile if that client's the one currently showing. Fires whenever
     `taState.clientName` is already set — which it reliably is by this
     point, since `send()` runs `extractClientName()` on every typed
     message before the reply is rendered, and `ctDraftOutreach()` (the
     card's own "✉️ Draft outreach" button) explicitly calls
     `window.__taEnsureClientContext(client.name)` before sending. No
     client name known yet → skips silently, same "best-effort, never
     block on it" spirit as `maybeSurfaceClientHistory`. The profile
     sidebar gets a new "Drafts" section (above Notes) listing up to 5,
     newest first, each row reopening the same pop-out via a new
     `window.__taOpenDraftModal` export rather than re-implementing the
     modal a second time in the Client Tracker script.
  4. A true new **browser tab/window** was considered and deliberately
     not used — it risks a popup blocker eating it silently and it can't
     carry this panel's own state, where an in-page modal is guaranteed
     to open and matches how every other "show this bigger" moment in
     this file already works (the itinerary pop-out, the Client
     Tracker's own overlay+modal panels).
- Verified two ways: real Node execution-harness tests against the
  actual extracted `ctRenderDetail()`/`renderAndTrackDrafts()` source
  (not paraphrased copies) — sticky-sidebar markup, the Notes
  section's four states (empty, form-open, populated, XSS-probed
  subject/notes all inert), a real draft row's click wiring firing
  `window.__taOpenDraftModal` with the right subject, the save/no-save/
  save-throws branches of `renderAndTrackDrafts()`, the Copy button's
  clipboard text, and the Outlook deep link's encoded subject — all as
  designed. All 16 `<script>` blocks still parse; div-tag balance held
  (1,652/1,652).
- **Unverified live, same caveat as everything else in this session**:
  the sticky sidebar's actual scroll feel, whether `calc(100vh - 220px)`
  is a reasonable cap on a real laptop-sized window, the inline add-note
  form's focus/stopPropagation behavior in the sidebar (same mechanism as
  the card version, not yet re-verified in this new location), and the
  draft modal/Outlook-deep-link/clipboard-copy path end to end — none of
  this has been exercised in a real browser from this environment. Test
  next: draft an outreach email from a client's card, confirm the modal
  opens with the full text readable, confirm it shows up under that
  client's Drafts in their profile afterward, and try Copy and Open in
  Outlook from the modal.
- **Confirmed still broken live immediately after shipping the above**:
  the DE reported "Draft outreach" still landed in the normal chat bubble
  (Drafts still showed "No drafts yet"), meaning `renderAiReply()`'s
  `Subject: ...` detection never matched at all — `renderAndTrackDrafts()`
  (and therefore the modal and the client-record save) never even ran.
  Root cause: the regex was anchored to the *literal first character* of
  the reply with zero tolerance for anything else. Models routinely
  markdown-bold the label (`**Subject:**`) or add a one-line lead-in
  ("Here's a draft:") even when explicitly told not to (see the system
  prompt rule right above `renderAiReply`) — either deviation alone was
  enough to miss the match. Fixed by scanning the first 3 lines for a
  `Subject:` line (optionally bolded) instead of demanding it be the very
  first character, treating anything before it as a discardable lead-in —
  still anchored to the *start of a line*, not "subject" appearing
  anywhere mid-sentence, so a reply that merely mentions the word (e.g.
  "the subject of budget flexibility") still doesn't misfire, and a
  `Subject:`-looking line past line 3 (too deep to plausibly be the real
  draft header) still doesn't either. Verified with a real Node
  execution-harness test against the actual extracted `renderAiReply()`
  source (not a paraphrased copy) across ten cases: the original exact
  format, a bolded label, a one-line preamble, leading/trailing
  whitespace, the mid-sentence decoy, a too-deep `Subject:` line, a
  normal short reply, an empty body, multiple blank lines between subject
  and body, and an XSS probe through the extraction (confirmed the raw
  text passes through unmangled for `openDraftModal`'s own `escapeHtml()`
  to actually escape downstream) — all as designed. All 16 script blocks
  parse; div-tag balance unchanged (pure logic change, no new markup).
  **Still unverified**: whether this is now the true root cause or the
  DE's actual reply took some other shape this fix doesn't cover — ask
  for the literal bubble text next time if this doesn't resolve it, since
  that's the fastest way to see the real shape without guessing blind.
- **It wasn't enough — confirmed by the actual bubble text this time,
  not another guess.** The DE's screenshot showed the real reply: a
  multi-paragraph note about a data caveat ("One important note before
  the email lands: **Zerta in Barcelona is the only kosher-certified
  restaurant**... Here's the full draft:"), then a `---` separator, THEN
  the `Subject:` line — all despite the system prompt's explicit "no
  preamble" instruction. The model apparently felt it owed the DE a
  heads-up about a flagged data gap (a genuinely reasonable instinct)
  and said so before the draft, which put `Subject:` on line 5+, past
  the 3-line cap the previous fix imposed. The takeaway: a model won't
  reliably follow a "no preamble" instruction under all conditions, so
  detection has to tolerate deviation rather than assume it away. Fixed
  by removing the line cap entirely — `renderAiReply()` now scans the
  WHOLE reply for a `Subject:` line (still optionally bolded, still
  anchored to the start of a line) and discards everything before it,
  whatever it contains, as a lead-in. Verified against the DE's exact
  reported text (copied verbatim into the test) plus the same XSS/decoy/
  whitespace cases as before, run as a real Node execution-harness test
  against the actual extracted `renderAiReply()` source — the real-world
  case now correctly extracts the true subject and a body starting at
  "Hi Amanda," with neither the caveat paragraph nor the `---` separator
  leaking into it. All 16 script blocks parse; div-tag balance unchanged.

## Streaming: a real 400 crash traced to a web_search content block miscategorized as text (Sep 2026, unverified live)

Reported live, unrelated to any client — a plain "what's the most kosher
Friendly restaurant" conversation, followed by "yeah can you give me any
information you have on them to contact them" (a request that plausibly
triggers a live `web_search`). The exact error: `Anthropic returned an
error (400) — messages.12.content.2.text._rawInput: Extra inputs are not
permitted.` A genuine crash, not a misunderstanding of a Settings key or
a rate limit — pinned down and fixed, not just retried past.

- **Root cause, found by reading `createStreamAccumulator()`
  (`callClaudeAI`'s streaming-event accumulator) directly**:
  `content_block_start` only ever special-cased
  `evt.content_block.type === 'tool_use'` — anything else, including a
  live `web_search` call's own `server_tool_use` content block, fell
  into the generic `{ type: 'text', text: '' }` bucket. But a
  `server_tool_use` block streams its input the same way a custom
  `tool_use` block does — via real `input_json_delta` events — so that
  miscategorized block still received them, stamping a stray
  `_rawInput` property onto what this code now believed was a plain text
  block. `content_block_stop`'s cleanup (deleting `_rawInput` once the
  JSON was parsed) only ever ran for `type === 'tool_use'`, so on a
  `server_tool_use` block that property was never removed. That corrupted
  block then got pushed into `convo` (`callClaudeAI`'s own request array,
  not the persisted `convoHistory`) via `convo.push({ role: 'assistant',
  content: data.content })` right before the NEXT round of the same
  tool-use loop — and Anthropic's API rejects a `text`-typed content
  block carrying an extra `_rawInput` field outright, surfacing as a 400
  on that later message index, exactly matching the reported error shape.
  **Confirmed this doesn't need a data-migration or a "clear your
  history" fix**: `convo` is rebuilt fresh from `data.content` on every
  `callClaudeAI` call — nothing persisted to `localStorage`/
  `convoHistory` carries a raw content-block array, only the final text —
  so the corruption never survived past the one broken request. The code
  fix alone is the complete fix.
- **Fixed by generalizing rather than special-casing a second type
  name.** `content_block_start` now preserves whatever real block type
  Anthropic actually sent (a shallow clone) for anything that isn't
  literally `'tool_use'` or `'text'`, instead of guessing every non-
  `tool_use` block must be text. The `_rawInput` accumulate/finalize/
  delete steps in `content_block_delta`/`content_block_stop` now key off
  "this block actually received an `input_json_delta` event" (checking
  `_rawInput !== undefined`) rather than off `type === 'tool_use'`
  specifically — so a `server_tool_use` block, or any other tool-like
  block type Anthropic adds later, gets the same JSON reconstruction and
  the same guaranteed cleanup a custom `tool_use` block already got,
  without this file needing to hardcode every possible type name up
  front. A `web_search_tool_result` block (delivered whole via
  `content_block_start`, no delta at all) simply passes through
  unmodified under the new generic branch — it never receives
  `input_json_delta`, so `_rawInput` is never set on it and there's
  nothing to clean up.
- Verified with a real Node execution-harness test against the actual
  extracted `createStreamAccumulator()` source (not a paraphrase),
  simulating the exact failure shape: a text block followed by a
  `server_tool_use` block streaming `input_json_delta` events for a
  `web_search` call. Confirmed the `server_tool_use` block keeps its real
  type, its input parses correctly, and — the actual bug — **no block in
  the result carries a leftover `_rawInput` property at all**. Also
  covered: a `web_search_tool_result` block passes through with its
  `content` intact; a normal custom `tool_use` call (e.g. `search_guide`)
  still works exactly as before; a plain streamed text-only reply is
  unaffected; malformed `input_json_delta` JSON still falls back to `{}`
  without throwing; a mid-stream `error` event is still captured; and a
  final check that the resulting text block's own keys are exactly
  `{type, text}` — nothing extra that would fail Anthropic's own content-
  block validation the way the original bug did. All 16 script blocks
  parse; div-tag balance unchanged (pure logic fix, no markup touched).
- **Unverified live**: whether a real `web_search` call (as opposed to
  the simulated event sequence in the test above) reproduces this exact
  fix cleanly end-to-end — the simulated events match Anthropic's
  documented streaming shape for a server tool call, but this couldn't be
  run against a live key from this environment. Ask "can you give me any
  information you have on them to contact them" again (or any other
  question likely to trigger a live web search) to confirm the 400 is
  actually gone.

## Client Tracker backup/restore + a real Text version for drafts (Sep 2026, unverified live)

Two features picked from "what's missing" — a real risk (no way to back
up the Client Tracker) and a quick win (an SMS option orphaned by the
draft-renderer rebuild earlier this session).

- **Backup/restore.** Every client record, note, and draft lives only in
  this browser's `localStorage` — no backend, by design, so a cleared
  cache or a new machine wiped the whole CRM with zero recovery. Two new
  icon buttons in `#ct-head` (📥/📤, styled to match the existing 🔕/✕
  circular buttons) call `ctExportBackup()`/`ctImportBackup(file)`.
  Export is the same `Blob`+`<a download>` trick already used for the
  Quote Builder and itinerary document exports, just `application/json`
  instead of `.doc` — downloads `ctClients` as-is, pretty-printed, named
  `kensington-tours-clients-backup-<today>.json`. Import reads the picked
  file via `FileReader`, validates it's actually an array, then **adds
  rather than replaces**: a client whose `id` already exists is skipped,
  not overwritten, and one with a new or missing `id` is added (a
  missing one gets a fresh `ctUid()`). Deliberately non-destructive by
  construction — on the actual "I cleared my browser, restore
  everything" case this exists for, `ctClients` starts empty so
  everything in the backup is simply added; the skip path only matters
  if a backup gets re-imported by mistake, where silently skipping
  duplicates is much safer than a wholesale replace that could nuke
  newer data. A hidden `#ct-import-file` input (`accept="application/
  json,.json"`) is triggered by the 📤 button rather than shown directly,
  and its value is reset after each pick so re-selecting the same file
  still fires `change`. Status (added/skipped/unreadable counts, or a
  clear rejection for invalid JSON or a non-array file) reports through
  the existing `ctSetStatus()` toast.
- **Draft "📱 Text version".** CLAUDE.md's own history names this as a
  feature that existed before the big draft-rendering rebuild (`renderDrafts`/
  `wireDraftButtons`, deleted as dead code, are gone along with whatever
  SMS-condensing they had) — this is a fresh build inside the new
  `#ta-draft-modal`, not a restore of lost code. A third button next to
  Copy/Open-in-Outlook calls the live AI (`callClaudeAI`, same call this
  file already makes everywhere else) with the draft's subject+body and
  an instruction to condense it into a ~320-character SMS with no
  preamble. Real network latency unlike the other two buttons, so it's
  opt-in on click only, disables itself and shows "Condensing…" while in
  flight (guards against a double-click firing two requests), and
  re-enables afterward either way. Result renders into a new
  `#ta-draft-sms-result` block below the action row, with its own
  "📋 Copy text version" button — a genuine network/model error surfaces
  inline there rather than crashing, matching this file's
  `.catch()`-backstop discipline everywhere else `callClaudeAI` is
  called. Cleared on every `openDraftModal()` call so a stale condensed
  text from a previously-viewed draft can never look like it belongs to
  whichever draft is open now.
- Verified with real Node execution-harness tests against the actual
  extracted `ctExportBackup()`/`ctImportBackup()`/`wireDraftModalActions()`/
  `openDraftModal()` source (not paraphrased copies): export against a
  normal client list, an empty list, and singular/plural wording; import
  against a fresh restore into an empty tracker, a re-import that's
  entirely skipped as duplicates, a mixed batch (one new, one colliding
  id, one invalid entry with no name), a record with no `id` at all,
  invalid JSON, valid-but-non-array JSON, no file selected, an unreadable
  file, and an XSS probe in an imported name; the SMS button's happy
  path, an AI-returned error, a rejected promise, the double-click guard,
  sms-result clearing on reopening with a different draft, an XSS probe
  in the model's own condensed reply, and a regression check that Copy
  still works unchanged. All 16 script blocks parse; div-tag balance
  held (1,652/1,652 → 1,655/1,655, matching the new static markup added).
- **Unverified live**: the actual file-picker/download flow in a real
  browser (particularly on `file://`, where downloads and file input
  behave slightly differently than over `https://`), whether 320
  characters is the right SMS length target in practice, and whether the
  condensed text's tone reads naturally — none of this has been tried
  outside this environment. Test next: export a backup, clear the
  browser's site data (or open in a different browser) and import it
  back, then draft a message and tap "Text version" to see what the
  model actually produces.

## ElevenLabs text-to-speech, a second voice provider (Sep 2026, unverified live)

Direct follow-up to "is there a way to enhance the assistant's voice? More
human like" — browser `speechSynthesis` (the only option until now) is
free but robotic; this adds a real second provider, ElevenLabs, wired
behind the exact same `speakText(text, onDone)` interface every call site
already used, so Conversation Mode and every "🔊 Read aloud" button needed
zero changes.

- **New BYOK key, same discipline as the Anthropic one.** A second
  password-type input in ⚙️ Settings (`ta-elevenlabs-key-input`), stored
  under its own `kt-trip-assistant:elevenlabs-key:v1` localStorage key —
  deliberately separate from the Anthropic key's storage key, and from
  `TA_VOICE_STORAGE_KEY` (the voice *preferences* blob), so clearing one
  key can never accidentally touch the other. Billed to the DE's own
  ElevenLabs account, entirely independent of Anthropic usage.
- **Voice provider is a real toggle, not an either/or rebuild.**
  `TA_VOICE_STORAGE_KEY`'s stored shape gained two fields —
  `provider: 'browser' | 'elevenlabs'` and `elevenLabsVoiceId` — with
  `getStoredVoicePrefs()` defaulting both when absent, so a prefs blob
  saved before this feature existed still loads cleanly as `'browser'`
  with no voice id (verified in the Node harness against exactly that
  old-shape case). Picking "ElevenLabs" in the new `#ta-voice-provider`
  select swaps which settings block is visible
  (`#ta-elevenlabs-settings` vs. the renamed `#ta-voice-browser-settings`
  wrapping the existing browser voice/rate/pitch controls) — the rate/
  pitch sliders are deliberately kept browser-only for this first pass;
  ElevenLabs's own pacing controls (stability/similarity/speed) are a
  different knob set and adding a second slider language for them was
  judged not worth the complexity until this is confirmed working at all.
- **Voice list is fetched from the DE's real account, not hardcoded.**
  A "🔄 Load voices" button calls `GET /v1/voices` with the saved key and
  populates `#ta-elevenlabs-voice-select` from the response — keeps this
  in sync with whatever voices the account actually has (including any
  separately licensed) without this file needing to know voice ids in
  advance. On demand only (button tap), not fetched automatically on
  every Settings open, since it's a real network call this file has no
  reason to make until asked. A previously-saved voice id is preserved as
  the selection if the freshly-loaded list still contains it; otherwise
  the first voice in the list becomes the default.
- **`speakText()` now routes by provider, `stopSpeaking()` generalizes
  cancellation.** The function kept its exact original signature
  (`speakText(text, onDone)`) — internally it now checks
  `getStoredVoicePrefs().provider`, and only takes the ElevenLabs path
  when a key AND a chosen voice id are both actually present; otherwise
  (or on any ElevenLabs failure) it falls through to the original browser
  `speechSynthesis` code, now split out as `speakTextBrowserAudio()`. A
  new `stopSpeaking()` replaces the two places that used to call
  `window.speechSynthesis.cancel()` directly (the top of `speakText()`
  itself, and `resetConvoUI()`'s Conversation-Mode-ending cleanup) —
  it now also aborts an in-flight ElevenLabs fetch via `AbortController`
  and pauses/resets any currently-playing ElevenLabs `Audio` element, so
  switching providers mid-session or ending Conversation Mode can't leave
  the old provider still talking in the background. Deliberately left
  the guide's own separate pronunciation "Listen" buttons (Spanish word
  audio, an unrelated `speechSynthesis` usage elsewhere in the file)
  untouched — same call CLAUDE.md already made when the voice picker was
  first built.
- **Failure is visible, not silently degraded — but only once per
  session.** If the ElevenLabs call fails (bad key, quota, network,
  CORS), `speakText()` falls back to the browser voice automatically
  (so Conversation Mode never just goes silent) and posts one `sys` chat
  message naming the failure and pointing at ⚙️ Settings — gated by a
  new `elevenLabsFallbackWarned` flag so a bad key doesn't post the same
  warning on every single conversational turn, only the first one that
  session. This matches this file's standing rule (the hallucinated-
  tool-call safety net, the retry-button audit) that a real failure
  degrading a client-facing feature should never happen invisibly.
- **New isolated test, matching this project's own established
  methodology** ("For anything touching the fetch() to
  api.anthropic.com, prototype the change in a copy of
  diagnostic-tools/api-test.html before editing the main file" — same
  discipline applied here to a brand-new external API this file has
  never called before). `diagnostic-tools/api-test.html` gained a third
  test: paste an ElevenLabs key, and it calls `GET /v1/voices` then
  `POST /v1/text-to-speech/{voice_id}` in sequence, playing the result
  through a real `<audio>` element — isolates key validity, CORS support,
  and the exact request/response shape from the rest of the 14,000-line
  file. Run this FIRST if the voice picker's "Load voices" or spoken
  replies ever look broken.
- Verified with real Node execution-harness tests against the actual
  extracted source for all four pieces: `speakText`/`stopSpeaking`/
  `speakTextBrowserAudio`/`speakTextElevenLabsAudio` (browser-provider
  happy path, ElevenLabs happy path, ElevenLabs failure → fallback + a
  single warning message + a second failure NOT re-warning,
  empty-text no-op, `stopSpeaking()` aborting an in-flight fetch and
  cancelling `speechSynthesis`, markdown-character stripping, and
  ElevenLabs working even when `speechSynthesis` is entirely
  unsupported); `getStoredVoicePrefs`/`setStoredVoicePrefs`/
  `getStoredElevenLabsKey`/`setStoredElevenLabsKey` (defaults, round-
  tripping, the old-shape-blob backward-compatibility case, key trim/
  clear, corrupted JSON); and the "🔄 Load voices" button's handler (no-
  key guard, the happy path with prior-selection preservation, a 401,
  a network rejection, a zero-voices account, and an XSS probe in a
  voice name from the API response) — all as designed. All 16 script
  blocks in the main file parse, `diagnostic-tools/api-test.html`'s
  script block parses standalone, and div-tag balance held (1,655/1,655
  → 1,658/1,658, matching the new static markup added).
- **Unverified live, and unusually so — genuinely couldn't check the
  exact ElevenLabs API shape against live docs from this environment**:
  the endpoint paths (`/v1/voices`, `/v1/text-to-speech/{voice_id}`), the
  header name (`xi-api-key`), the request body shape (`text`/`model_id`),
  and — the biggest unknown — **whether ElevenLabs's API even allows a
  direct browser fetch at all (CORS)**, the way `api.anthropic.com` does
  with its `anthropic-dangerous-direct-browser-access` header. If CORS
  is blocked, this whole feature can't work as built from a static
  file with no backend, full stop — no code fix would help, it would
  need a proxy this project deliberately doesn't have. This is exactly
  why the new diagnostic-tools test exists and should be run FIRST, with
  a real key, before trusting anything about this feature in front of a
  client. The model id `eleven_turbo_v2_5` (chosen for lower latency in
  a live conversational assistant) is also an unverified guess at a
  currently-valid model name.

## ElevenLabs: confirmed live end-to-end, two real bugs found along the way (Sep 2026)

The DE actually walked "Load voices" through a real failure to success —
genuine signal, not speculation. Two real bugs found and fixed:

- **The biggest unverified question from above is now answered: CORS is
  NOT a problem.** A direct browser fetch to `api.elevenlabs.io` works —
  confirmed by the DE getting real HTTP 401 and 400 responses back (not
  a generic "Failed to fetch"/CORS-shaped error), and finally a clean
  `✓ Loaded 23 voices.` once the key was right. The endpoint paths,
  `xi-api-key` header, and `GET /v1/voices` response shape are all now
  confirmed correct against a live account.
- **Bug 1 (real, fixed): the "Load voices" error handler only showed a
  bare HTTP status code, not ElevenLabs' own explanation.** The DE's
  first error (401) turned out to actually be masking a more specific
  400 with a real `detail.message` once actually surfaced — the status
  code alone was not enough to diagnose it, and `speakTextElevenLabsAudio`
  already captured the response body on failure while this handler
  didn't. Fixed by adding the same `resp.text()` capture here (see the
  code comment right at the fix) — this is what actually let the DE see
  ElevenLabs' real message (`"API key ID used as API key - only valid
  for..."`) instead of a bare, undiagnosable "400."
- **Root cause of the DE's actual failure, once visible: not a code bug
  at all.** ElevenLabs' key-management UI only ever lets you copy a
  key's **ID** from the list view after creation (confirmed via the
  DE's own screenshot of the "..." menu — Edit / Copy Key ID / Delete,
  no way to get the real secret back) — the actual secret value is only
  shown once, at creation time. The DE had copied the ID, not the
  secret, which is what `invalid_api_key` / "API key ID used as API
  key" meant. Separately, ElevenLabs' newer **restricted/scoped API
  keys** default every endpoint to "No Access" — the DE's fresh key
  needed **Text to Speech: Access** and **Voices: Read** explicitly
  turned on (everything else correctly left at "No Access," matching
  least-privilege practice) before it worked. Both of these are
  ElevenLabs account/dashboard facts, not something fixable in this
  file — worth knowing before troubleshooting a future ElevenLabs key
  issue as if it were a code problem first.
- **Bug 2 (real, fixed): `#ta-settings-panel` was silently clipped, not
  scrollable.** Once past the key issue, the DE reported "I do not see
  [Preview voice]" — the new ElevenLabs block (key input, status,
  actions, voice select) made the settings panel taller than it used to
  be, and `#ta-panel` is a fixed-height flex column with
  `overflow: hidden` (see its own CSS comment). `#ta-settings-panel` had
  no `flex-shrink: 0` or scroll of its own, so the flex container's
  default `flex-shrink: 1` let it be squeezed shorter than its actual
  content with no scrollbar — the same exact bug shape (and same fix
  shape) as the Client Tracker's `#ct-form-panel` clipping bug fixed
  earlier this session, recurring independently in a different panel.
  Fixed by giving `#ta-settings-panel` its own `max-height: 46vh;
  overflow-y: auto;` — bounded well under `#ta-panel`'s own height so
  the message list and input row underneath stay usable while Settings
  is open, rather than Settings eating the whole panel.
- Both fixes verified: syntax-checked all 16 script blocks (the error-
  body fix, already covered by a Node execution-harness test against
  the real extracted handler source in the previous session entry) and
  the CSS clipping fix (pure CSS, no script/div changes — div-tag
  balance unaffected, 1,658/1,658).
- **Still open, confirmed unverified**: whether 46vh is a good cap on a
  real laptop-sized window (too short would just create a NEW, smaller
  clipped/scrolled area rather than fixing the underlying issue; too
  tall could crowd out the message list) — worth a look next time
  Settings is open with the ElevenLabs block visible. The actual sound
  of a chosen ElevenLabs voice via "🔊 Preview voice" and in a real
  conversation is still the one thing genuinely unverified from this
  environment — ask what it sounds like next.
- **Confirmed the first attempt at the clipping fix above was not
  enough** — the DE reported "no way to scroll to see if it's there"
  even after `max-height: 46vh; overflow-y: auto;` shipped. Root cause
  of THAT: `overflow-y: auto` only ever produces a real scrollbar once
  an element's rendered height is actually less than its content height
  — and without `flex-shrink: 0`, flexbox's default shrink behavior
  could still compress `#ta-settings-panel` below its own `max-height`
  before that comparison ever happens, silently squeezing it with no
  scrollbar, same visible symptom as the original bug. Added
  `flex-shrink: 0` alongside the existing `max-height`/`overflow-y`
  pair — this is what actually locks the element to `min(content
  height, 46vh)` as a genuinely fixed height rather than a soft cap
  flexbox could still override, which is what makes the scrollbar
  reliably show up once content exceeds it. **Not yet re-confirmed
  live** — ask the DE to reload and check Settings again after this
  ships; if it's STILL clipped, the next thing to check is whether
  `#ta-inputrow`/other flex siblings also need `flex-shrink: 0` to stop
  the compression from just relocating there instead.

## "Open Amanda Jackson's lead card" — a local UI command (Sep 2026, unverified live)

Request: "build the assistant the abilities to open the lead cards and
other files it generates," with "please open Amanda Jackson's lead
card" as the example phrasing. Confirmed as a real gap via the DE's own
screenshot: asked over voice "do you have the capabilities to open up
the lead card," and the live AI correctly answered no — it genuinely
can't, since none of its tools (`search_guide`/`get_city_data`/
`find_matching_itinerary`/`get_todo_list`/`propose_todo_update`) do
anything with the UI.

- **A local fast-path, not a new AI tool.** Opening a panel is a pure
  client-side action with no data to reason about — routing it through
  the live API would mean asking the model to describe an action it
  fundamentally cannot perform. Handled the same way the three existing
  fast-paths (history search, Quote Builder prefill, "start new client")
  already are: checked before the live-AI call, not instead of a tool.
- **Wired into BOTH the typed path (`send()`) and Conversation Mode's
  voice loop** (`getConvoRec()`'s `onresult`), unlike the three existing
  fast-paths, which are typed-only. This is a deliberate difference: the
  original report happened over voice, and "pull up so-and-so's card"
  is exactly the kind of hands-free command worth saying mid-call rather
  than typing — the single most compelling use case for this feature.
  `handleOpenClientCard()` returns the plain-text outcome specifically
  so the voice path can speak it back via `speakText()`, matching voice
  mode's "always talk back" rule, then resumes listening the same way
  every other successful voice turn does.
- **Two phrasings recognized**, via `extractOpenClientCardMatch()`:
  possessive ("open Amanda Jackson's lead card") and prepositional
  ("show me the lead card for Amanda Jackson") — both accept "lead
  card," "client card," "profile," "card," "latest draft," "last
  draft," or "draft" as the target. A real bug was caught while writing
  tests, not guessed at: the possessive form's regex, when the
  possessive `'s` was made optional, let a one-word name capture
  swallow "lead" itself in "show me the lead card for Amanda Jackson"
  (extracting a nonexistent client named "lead" instead of "Amanda
  Jackson"). Fixed by requiring the literal `'s` in the possessive form
  and adding the prepositional form as an explicit second pattern —
  this also covers a voice transcript that drops the apostrophe
  entirely, since that case now falls through to the "for" phrasing
  instead of silently misparsing.
- **"Card" opens the Client Tracker profile; "draft"/"latest draft"/
  "last draft" opens that client's most recent saved draft** (via the
  existing `openDraftModal()` — a plain in-IIFE function call, not a
  `window.__ta*` export, since this code lives in the same Trip
  Assistant script) — reuses `window.__ctFindClientByName` (fuzzy
  exact-then-substring match, already used by `propose_todo_update`)
  and `window.__ctOpenClientProfile`, no new Client Tracker exports
  needed. A client with no saved drafts yet gets a clear "doesn't have
  any saved drafts yet" message rather than a silent no-op or an error.
- Verified with a real Node execution-harness test against the actual
  extracted source (24 cases): both phrasings across several keyword
  variants, case-insensitivity, an unrelated normal question and an
  unrelated command ("open the quote builder") correctly NOT matching,
  the regression case that exposed the "lead"-as-name bug (now fixed),
  opening a profile, fuzzy name matching, opening the newest of several
  drafts (not an old one), a client with zero drafts, an unknown client
  name, the Client Tracker not being loaded yet, `__ctOpenClientProfile`
  throwing unexpectedly (caught, not an unhandled error), and an XSS
  probe in a client's name — all as designed. All 16 script blocks
  parse; div-tag balance unaffected (pure JS change, no new markup).
- **Deliberately not built**: opening anything other than a client's
  profile/latest draft (e.g. a specific older draft by description, an
  itinerary document, the Quote Builder for a named client) — scoped to
  exactly what was asked and what the DE actually tested live. Worth
  revisiting once this base version is confirmed working.
- **Unverified live**: whether the two recognized phrasings actually
  match what the DE naturally says (both typed and via a real
  microphone transcript, which can drop words/punctuation Web Speech
  API's dictation doesn't always render as expected), and whether
  speaking the confirmation back feels right mid-conversation versus
  intrusive. Test next: say "please open Amanda Jackson's lead card"
  and "open Amanda Jackson's latest draft" both typed and over voice.

## Real "Read aloud" button on every chat reply (Sep 2026, unverified live)

Surfaced right after the lead-card fix, same session: the DE typed
"would you be able to read those to me" and got "I'm not able to do
text-to-speech directly — that's outside what I can do in this app...
use a screen reader." An honestly-wrong answer, not a lie — this app
genuinely does have real TTS (`speakText`, either ElevenLabs or the
browser voice), the model just has no way to know that from its own
text generation, since only the mic/Conversation Mode loop currently
auto-speaks a reply. A typed question has never had a way to be read
back on demand.

- **Fixed with a real button, not a smarter prompt.** Telling the
  system prompt about `speakText`/the mic loop wouldn't actually solve
  this — the model still can't trigger a UI action, it could only
  describe one, which is the same category of problem the
  "open lead card" fix above was about. `addAiAnswerMsg()` (the one
  shared bubble-rendering function every non-draft live-AI reply
  already funnels through — Conversation Mode, the escalation button,
  typed chat, the image-question path) now always renders a
  "🔊 Read aloud" button, not just when there's a "📋 View full
  details" pop-out — a short reply is just as worth hearing as a long
  one. Wired to the existing `speakText(fullText, onDone)`, so it
  automatically gets whichever voice provider (browser or ElevenLabs)
  is currently selected in Settings, with no separate wiring needed.
  Disables itself and shows "🔊 Reading…" while speaking, restoring to
  normal once `speakText`'s `onDone` fires — same disable/relabel
  pattern already used by the SMS "Condensing…" button and the draft
  Copy button.
- **Reads the full text, not the condensed summary shown in the
  bubble** — matches what "View full details" already shows, so
  clicking either one (read or view) gets the DE the complete answer,
  not just the one-line teaser.
- **Known small gap, not fixed this pass**: `speakText()` internally
  calls `stopSpeaking()` on every new call, so clicking a SECOND
  bubble's Read-aloud button while a FIRST one is still speaking
  correctly cancels the first and starts the second — but the first
  button's own label stays stuck on "🔊 Reading…" forever, since its
  `onDone` callback never fires (the speech it was waiting on got
  cancelled, not completed). Cosmetic only — clicking that stuck button
  again just re-triggers it correctly — not worth a global "which
  button is active" tracker for a first pass, but worth fixing if it
  turns out to look broken in practice.
- **Deliberately not added to drafted emails/texts** (`renderAndTrackDrafts`'s
  pop-out) — same reasoning CLAUDE.md already gives for why client-name
  links are skipped there: that content is meant to be copy-pasted or
  sent as-is, and this specific report was about a normal chat answer,
  not a draft.
- Verified with a real Node execution-harness test against the actual
  extracted `addAiAnswerMsg()` source (not a paraphrase), across six
  cases: a short reply still gets the button (and correctly gets no
  "View full details" button, since there's nothing extra to show); a
  long reply gets both buttons; clicking Read aloud passes the FULL
  text (not the summary) to `speakText`, and the button disables/
  relabels while speaking and restores after; "View full details"
  still opens the modal with the full text (regression guard);
  `wireClientProfileLinks` is still called on the bubble (regression
  guard); and an XSS probe in the summary text still comes back
  escaped (regression guard). All 16 script blocks parse; div-tag
  balance unaffected (pure JS change, one new button per bubble, no
  structural markup change).
- **Unverified live**: how the new button actually reads against the
  chat bubble's existing "View full details" button visually (crowding
  a short reply's action row), and whether reading a full itinerary
  answer aloud (headers, bullet lists, a table) sounds reasonable once
  `speakText`'s markdown-stripping runs on it versus something that
  needs its own summarization pass — worth trying on a genuinely long
  multi-day itinerary answer, not just a short one-line reply.

## Short structured lists were being condensed too, right after the Read-aloud fix (Sep 2026, unverified live)

Reported immediately after the Read-aloud button shipped, from a real
screenshot: asked "top three restaurants in Barcelona," got "No
problem! Top three restaurants in Barcelona:" in the bubble with only a
"📋 View full details" button — the actual three restaurant names were
hidden behind the pop-out. The DE's own framing of why this mattered:
"if I am having a conversation with it I want to be able to narrow
down the right information before exporting it" — a quick back-and-
forth needs the actual content inline, with the pop-out reserved for
something genuinely long enough to be document-like.

- **Root cause: `looksLikeStructuredMarkdown()`'s "2+ structural
  lines" threshold had no length component.** A 3-item bulleted list —
  three short restaurant recommendations, well under what anyone would
  call "a wall of text" — has 3 bullet lines, comfortably over the old
  "≥2" bar, so the deterministic backstop (see the entry two sections
  up on why this backstop exists at all — a real earlier bug where raw
  markdown landed in the bubble) fired and hid it, exactly backwards
  from what a short conversational list needs.
- **Fixed by adding a length gate**: `structural >= 2 && text.length >
  500`. Structure alone is no longer sufficient — now it also has to be
  long enough that condensing is actually worth it. 500 characters was
  picked as a rough middle ground (a short list easily clears it as
  "not condensed"; the original to-do-list bug case this backstop was
  built to catch — headers, multiple bulleted client entries — clears
  it the other way, correctly still condensed). Nothing else about the
  mechanism changed: an explicit model-provided `SUMMARY:` line still
  takes priority regardless of length, and error text still bypasses
  this logic entirely.
- Verified with a real Node execution-harness test against the actual
  extracted `looksLikeStructuredMarkdown()`/`splitSummary()` source,
  using the DE's own reported wording as one of the cases: the 3-item
  Barcelona restaurant list (231 characters) now correctly stays
  inline (`summaryText === fullText`, nothing hidden); a synthetic
  version of the original to-do-list bug case (559 characters) still
  correctly gets condensed to a short summary, confirming no
  regression; an explicit `SUMMARY:` tag still wins regardless of
  length; a short plain (non-structured) reply is unaffected as
  before; and two boundary cases just above/below the 500-character
  cutoff land on the correct side. All 16 script blocks parse; div-tag
  balance unaffected (pure logic change, no markup touched).
- **Unverified live**: whether 500 characters is actually the right
  cutoff in practice — it's a reasonable-sounding number picked from
  one real example and one synthetic regression case, not tuned
  against a range of real DE questions. Worth revisiting if a
  medium-length answer (a top-5 or top-10 list, say) still gets
  condensed when it shouldn't, or conversely if a short-looking answer
  with long descriptions per bullet slips through uncondensed when it
  probably should collapse.

## Auto-play typed replies and always-auto-scroll (Sep 2026, unverified live)

Two more requests from the same live-testing thread, right after the
condensing fix above:

1. On a reply that still had a "View full details" button (a top-two
   fine-dining pick, apparently long enough to clear the new 500-char
   gate): **"it never opened the file and read it. I don't want to
   click read aloud, can it not just action that? I also want the
   info to show as they are reading it. Don't remove the View full
   detail buttons though."**
2. **"can it be programmed to show me the new info without clicking
   new message, like it just automatically scrolls to the new
   info"** — the `#ta-jump-latest` pill from earlier this session.

- **Typed replies now auto-open and auto-read, with no click.**
  `addAiAnswerMsg(summaryText, fullText, opts)` gained an `opts.
  autoPlay` flag: when true, it opens the "View full details" pop-out
  first (only if there is one — a short reply with nothing extra has
  nothing to open) and then immediately starts reading the FULL text
  aloud via the same `speakText()`/button-disable/relabel machinery
  the manual button already used — refactored into a shared
  `startReading()` closure so the click handler and the auto-fire path
  are the exact same code, not two copies. The manual "🔊 Read aloud"
  and "📋 View full details" buttons are both still rendered and still
  work afterward (for replay, or if autoplay is ever off) — nothing
  was removed, per the explicit "don't remove the button" ask.
- **Deliberately scoped to the TYPED paths only — Conversation Mode is
  unaffected on purpose.** `renderAiReply(summaryText, fullText,
  autoPlay)` threads the flag through to `addAiAnswerMsg`; `send()`'s
  `runSend` and the 📎 image-question path (`runImageQuestion`) both
  now pass `true`. Voice mode's `runVoiceRespond` deliberately passes
  nothing (`renderAiReply(replyText, full)`, no third argument) — it
  already calls `speakText(replyText, ...)` itself, right after this
  call, but with `replyText` (the SHORT summary) specifically, not the
  full text, and then resumes listening. That's a real, tested design
  choice from earlier this session (don't read a whole itinerary aloud
  character-by-character in a live phone call) — auto-playing the
  full text here too would have both double-spoken the reply and
  quietly undone that choice. Confirmed via a Node test that
  `renderAiReply` without a third argument leaves `opts.autoPlay`
  falsy, so voice mode's existing behavior is untouched.
- **Always auto-scroll to new content — the earlier conditional
  design is explicitly overridden, not refined.** The "Three deepening
  upgrades" entry earlier in this file describes a deliberate choice:
  only force-scroll when the DE was already near the bottom, otherwise
  leave their scroll position alone and show the `#ta-jump-latest`
  pill instead, specifically so a new reply wouldn't yank someone away
  from re-reading something they'd scrolled up to see. That tradeoff
  is now explicitly not what's wanted — `addMsg()`, `showTyping()`,
  and `updateTypingText()` (the streaming-answer path) all now call
  `scrollMsgsToBottom(true)` unconditionally instead of the old
  near-bottom check. **Real tradeoff, stated plainly**: scrolling up
  mid-conversation to reread something no longer "sticks" — the next
  incoming message (or even the next streamed chunk of the current
  one) will pull the view back to the bottom regardless. The pill and
  its own manual-scroll listener are left in place, not removed, since
  they're harmless and still respond to a manual scroll between
  messages — they just won't stay in the "pill shown, scrolled up"
  state once anything new arrives.
- Verified with real Node execution-harness tests against the actual
  extracted source: `addAiAnswerMsg`'s `autoPlay` behavior across six
  cases (a long reply auto-opens AND auto-speaks with the full text,
  not the summary; a short reply auto-speaks but doesn't try to open a
  nonexistent pop-out; `autoPlay` omitted entirely — the voice path's
  exact call shape — auto-fires nothing while the manual click still
  works; `autoPlay: false` explicitly also auto-fires nothing; the
  button's label correctly resets once the auto-started speech's
  `onDone` fires; `wireClientProfileLinks` is still called regardless)
  and `renderAiReply`'s pass-through (three cases: `autoPlay: true`
  reaches `addAiAnswerMsg`'s opts, an omitted third argument is falsy
  there, and a draft-shaped reply still routes to
  `renderAndTrackDrafts` instead of `addAiAnswerMsg` regardless of the
  flag). All 16 script blocks parse; div-tag balance unaffected (pure
  JS logic changes, no new markup).
- **Unverified live**: whether opening the pop-out AND starting speech
  simultaneously feels smooth or like too much happening at once for
  a typed question, and whether always-scrolling ever feels
  disorienting mid-read — both are exactly what was asked for, but
  worth a genuine "does this feel right after a day of real use"
  check rather than assuming the literal request is automatically the
  best long-term feel.

## Consistent open/close transitions across every modal (Sep 2026, unverified live)

Direct request: "I would like a more seamless and fluid interface
experience," narrowed via a follow-up question to three concrete pain
points — "Panels snap open/closed," "Overlapping panels feel
disjointed," and "Loading/waiting feels dead." This entry covers the
first one.

- **Only `#ta-panel` and `#ct-overlay` had a real open/close
  transition before this.** Both already used a fade + a slight
  rise-and-scale on the inner box (`opacity` on the overlay,
  `transform: translateY(14px) scale(0.98)` on the panel/modal,
  triggered via `classList.add('open')` then, next animation frame,
  `classList.add('shown')` — the two-step is required because you
  can't transition FROM `display:none`, there's nothing to animate).
  Every other modal in this file — the itinerary pop-out, the draft
  pop-out, the Quote Builder, the Working Dashboard, the stale-content
  list, "Tell Me More," the quiz, and the random-tip modal — just
  hard-toggled `display:none`/`flex` with zero transition, so half the
  app felt smooth and the other half snapped.
- **One shared CSS recipe instead of eight copies.** Added a single
  comma-selector rule block (right before the itinerary-modal CSS)
  applying the exact same opacity/transform timing to all eight
  remaining overlay/modal id pairs at once, rather than pasting the
  same few lines eight times.
- **Every affected open() function** now does `classList.add('open')`
  then `requestAnimationFrame(() => el.classList.add('shown'))`;
  **every close path** now does `classList.remove('shown')` then
  `setTimeout(() => el.classList.remove('open'), 180)` (180ms matching
  the CSS transition duration) instead of removing `'open'`
  immediately — removing it immediately would have skipped the
  fade-out entirely, since `display:none` applies instantly and there'd
  be nothing left on screen to animate. Several modals had multiple
  close sites (a close button, a backdrop click, an Escape key, a
  "jump to this section" link that closes-then-scrolls) — pulled each
  into one shared `close*()` function (`closeQuoteBuilderOverlay`,
  `closeStaleOverlay`, `closeTmmOverlay`, `closeQuizOverlay`,
  `closeTipModal`) so there's one place per modal that knows how to
  close it correctly, not four copies of the same two-line dance that
  could drift out of sync.
- **Deliberately left untouched**: the map/lightbox overlays, the
  guide's inline search-results dropdown, the quick-search overlay,
  the "why-bubble" explainer, and the Client Tracker's own internal
  `#ct-form-panel`/`#ct-detail` view-swap — none of these are the
  "modal popping up over the app" pattern this pass targeted; they're
  either inline dropdowns or a state swap inside an already-open panel,
  a different interaction shape that a fade-in wouldn't obviously
  improve.
- Verified via static analysis rather than a Node harness (this is
  pure CSS + trivial DOM class toggling, nothing meaningfully
  executable in Node): confirmed every `classList.add('open')` site in
  the file now has a paired `requestAnimationFrame(...'shown')` call
  immediately after it, and every `classList.remove('open')` site
  removes `'shown'` first and defers `'open'` by 180ms — checked by
  grepping every remaining bare `classList.add/remove('open')` call in
  the file and confirming each one belongs to a deliberately-excluded
  element above, not a missed modal. All 16 script blocks still parse;
  div-tag balance unaffected (pure CSS + JS logic, no new markup); the
  same camelCase-filtered orphaned-reference sweep from the file-health
  check earlier this session still comes back with only the same 8
  known false positives (parameter names and object-method shorthand),
  nothing new.
- **Unverified live, and this is real CSS/animation behavior no static
  check can confirm**: whether 180ms actually feels smooth rather than
  sluggish once seen in a real browser, whether the fade-out timing
  lines up cleanly with the 180ms `setTimeout` on slower devices (a
  late-firing timeout would flash the modal back to full opacity for a
  frame before hiding), and whether eight modals now animating
  consistently actually reads as "seamless" the way the request meant
  it. Test next: open and close the itinerary pop-out, a draft, the
  Quote Builder, and the Working Dashboard, and see whether they now
  feel like part of one coherent app instead of some snapping and
  others fading.

## Client Tracker toolbar/header facelift (Sep 2026, unverified live)

Direct follow-up request: "clean up the tool bar. Same idea, clean
organized, easy to navigate. Can give it a face lift in appearance."
The only place literally called a "toolbar" in this file is `#ct-toolbar`
(the Client Tracker's search/filter/add-client/qualifying-call row) —
targeted that plus its `#ct-head` icon-button row directly above it,
since both had grown crowded this session (`#ct-head` picked up two
more icon buttons for backup/restore on top of the existing notify and
close buttons).

- **`#ct-head`'s four icon buttons (🔕/📥/📤/✕) now visually group into
  three clusters** instead of one undifferentiated row: the persistent
  🔕 reminder toggle, the one-shot 📥/📤 backup actions, and ✕ dismiss
  — separated by two thin `.ct-head-divider` rules. Wrapped in a new
  `#ct-head-actions` container so the gap between buttons comes from
  one flex `gap` instead of each button carrying its own
  `margin-left`. The divider is deliberately scoped as `#ct-head
  .ct-head-divider` (id + class) rather than a bare class — the
  existing `#ct-head span` rule is itself an id selector and would
  otherwise win the specificity fight, forcing the subtitle's
  `display:block` styling onto what's supposed to be a 1px vertical
  line.
- **`#ct-toolbar` now wraps** (`flex-wrap: wrap; row-gap: 10px`)
  instead of only ever being one rigid row — on a narrow window the
  controls now drop to a second line cleanly instead of squeezing or
  overflowing.
- **"+ Add client" and "🎯 Qualifying Call" are now grouped** in a new
  `#ct-toolbar-actions` wrapper with a tighter 8px gap between them
  (vs. the toolbar's own 10px), so the two "start a new client" paths
  read as a related pair instead of just the last two items in a flat
  row of otherwise-unrelated controls. Because it's `flex-shrink: 0`
  and not `flex: 1`, the pair wraps to a new line together as one unit
  if the toolbar runs out of room, never splitting mid-group.
- **Search field gets a real icon** — `placeholder="🔍 Search by
  name..."`, matching the exact convention the Working Dashboard's own
  search field already established elsewhere in this file (an emoji
  baked into the placeholder text, not a separately-positioned icon
  overlay) rather than inventing a second pattern for the same idea.
- **Small hover polish across the board** — the head's icon buttons
  now scale up slightly on hover (`transform: scale(1.08)`), the two
  toolbar action buttons lift slightly (`translateY(-1px)`), and the
  search field/status filter now transition their focus outline
  in (`.12s ease`) instead of snapping — small, low-risk additions in
  the same "fluid" spirit as the modal-transition work above, without
  changing any layout or behavior.
- Verified via static analysis (this is CSS + trivial DOM structure,
  nothing meaningfully executable in Node): the camelCase-filtered
  orphaned-reference sweep and the `getElementById`-vs-real-`id`
  cross-check from the file-health pass earlier this session both
  still come back clean (same 8 known false positives, zero missing
  ids). All 16 script blocks parse; div-tag balance held (1,658/1,658
  → 1,660/1,660, matching the two new wrapper `<div>`s added).
- **Found, not caused, while re-running that health check**: the
  file's `<span>` tags are off by one (one more open than close)
  confirmed via `git show HEAD:Tommie_Tours.html` to already be true
  in the last commit, before any of today's edits. Harmless in
  practice — browsers auto-close an unclosed inline element like
  `<span>` with no visible effect — and not worth a disproportionate
  hunt through 14,000 lines for a single missing closing tag that's
  evidently caused zero reported problems through many prior sessions.
  Flagged here rather than silently ignored; worth a "search line-by-
  line for the exact spot" pass if it's ever convenient, but not
  urgent.
- **Unverified live**: whether the divider lines are visible enough
  against the gold gradient header background to actually read as
  grouping (vs. just adding visual noise), and whether the toolbar's
  new wrap behavior looks clean or awkward on an actual narrow window
  — neither can be judged without a real browser. Test next: resize
  the Client Tracker panel narrow and confirm the toolbar wraps
  cleanly rather than overlapping or clipping.

## Trip Assistant button now toggles open/closed (Sep 2026, unverified live)

Direct request: "Can you make it open and close the bubble as a
function" — the ✨ `#ta-btn` launcher used to only ever open the panel;
closing required a separate tap on the ✕ `#ta-close` button or a
backdrop click. Wanted the launcher itself to act as a toggle, the way
a typical chat-bubble launcher does (tap to open, tap again to close).

- **`openTripAssistant()`/`closeTripAssistant()`** — the two existing
  inline click-handler bodies were pulled out into named functions
  (no behavior change on their own), and a new `toggleTripAssistant()`
  checks `panel.classList.contains('open')` to decide which one to
  call. `#ta-btn`'s own click listener is now `toggleTripAssistant`;
  `#ta-close` still calls `closeTripAssistant` directly (unchanged
  behavior — the ✕ button should always close, never toggle).
- **A real correctness risk this needed to account for**: three other
  places in this file open the Trip Assistant programmatically by
  calling `document.getElementById('ta-btn').click()` — Client
  Tracker's "✉️ Draft outreach" (`ctDraftOutreach`), the quick-access
  ✨ shortcut, and the Working Dashboard's "Resume in Trip Assistant"
  button. Under the old always-open handler, a stray `.click()` while
  the panel happened to already be open was harmless (`classList.add`
  on an already-present class is a no-op). Under the new toggle
  handler, that same `.click()` would have silently CLOSED the panel
  those three features are trying to open. Fixed by exporting
  `window.__taOpenPanel = openTripAssistant` (same cross-IIFE export
  pattern as `__taCallClaudeAI`/`__taMatchItinerary`/etc. right above
  it) and switching all three call sites to call that directly
  (falling back to the old `.click()` only if the export isn't present
  yet, matching this file's existing defensive-export-check style).
- Verified with a real Node execution-harness test simulating the
  actual classList/timer sequence: click 1 opens (open+shown both
  true, Daily Brief fires); click 2 starts closing (shown removed
  immediately, open removed only after the 180ms close timer, matching
  the existing fade-out timing from the modal-transition work);
  click 3 reopens correctly; Daily Brief fires exactly on the two opens
  and not on the close. All 16 script blocks still parse; div-tag
  balance unaffected (pure JS logic change, no new markup) — held at
  1,660/1,660, and the pre-existing 775/774 span imbalance (documented
  in the toolbar-facelift entry above, confirmed unrelated to any of
  today's changes) is unchanged.
- **Unverified live**: whether tapping ✨ to close feels natural next
  to the ✕ button still being there too (both now do the same thing
  when the panel's open — not a conflict, just two ways to close it),
  and whether the toggle ever gets triggered unexpectedly by a rapid
  double-tap mid-animation (the logic is idempotent and re-tested for
  that case in the harness above, but hasn't been tried against a real
  double-tap in a real browser).

## Daily Brief "Draft" button — real root cause found: restored bubbles have dead buttons (Sep 2026)

Reported live via screenshot: "the draft button doesn't work" (the Daily
Brief's "✉️ Draft" quick-action). Root-caused this time with a real
end-to-end Node execution harness (not just static reading) that actually
simulates the DOM — creates real elements, parses the HTML this file
generates via `innerHTML`, and fires a real click event through the whole
chain across BOTH the Trip Assistant and Client Tracker `<script>` blocks —
built specifically because static review alone couldn't distinguish "this
code is broken" from "this code is fine and something else is going on."

- **The actual bug: it only ever breaks after a page reload, never on the
  very first render.** `persistState()` saves a message bubble's rendered
  `innerHTML` (button markup included) into `localStorage` so the chat log
  survives a reload; `restoreState()` reconstructs it via
  `addMsgRaw()`/`span.innerHTML = html`. That correctly rebuilds the
  MARKUP — but a click listener is a JS-side attachment, never part of the
  HTML itself, so nothing about the restored button is actually wired to
  anything. It looks pixel-identical to the original and is silently,
  permanently dead. Since `maybeSurfaceDailyBrief()` only creates a FRESH
  brief once per day (its own dedup key), any panel reopen after the first
  page load of the day is showing a `restoreState()`-reconstructed bubble —
  which is most real usage, not an edge case. The harness proved this
  directly: a "session 1" fresh click sent a message correctly; a "session
  2" simulated reload (same `localStorage`, brand-new in-memory DOM/JS
  state, exactly like a real browser refresh) reproduced the reported
  symptom exactly — click, nothing happens, no error, no message sent.
- **The same root cause silently breaks the "jump to client profile" name
  links too** (`wireClientProfileLinks`, used by the Daily Brief's own
  summary lines and by every AI reply bubble via `addAiAnswerMsg` — see
  "Clickable client names extended to every chat reply" above) — same
  persist/restore gap, not something newly introduced, just not yet
  reported. Confirmed via the harness: fresh links work, restored links
  didn't (pre-fix), for the identical reason.
- **Fix**: split both `wireClientProfileLinks` and the Daily Brief's inline
  Draft-button wiring into a "build the markup" half and a "just attach
  listeners" half — `wrapClientNamesInText()`/`wireClientLinkClicks()`, and
  a standalone `wireBriefDraftButtons()`. The text-to-button DOM rewriting
  in `wrapClientNamesInText` must only ever run ONCE per name (re-running
  it against already-wrapped text would wrap the button's own label a
  second time, nesting a button inside a button — a real risk this pass
  checked for directly, see below) — but attaching a click listener is
  safe to redo any number of times on the same button, since the button's
  own `data-client-id`/`data-client-id`-equivalent attributes are already
  baked into the persisted markup and need no extra state to re-wire from.
  `restoreState()` now calls `wireBriefDraftButtons(msgsEl)` and
  `wireClientLinkClicks(msgsEl)` (the listener-only halves) once across the
  whole restored message list right after reconstructing it — safe to call
  even on bubbles that have neither kind of button, since both just no-op
  via `querySelectorAll` finding nothing. `wireClientProfileLinks` itself
  is now a two-line wrapper calling both halves, so every existing call
  site (the itinerary pop-out, `addAiAnswerMsg`, the Daily Brief) is
  unchanged.
- Verified with a real Node execution-harness test that goes further than
  anything else this session: a small custom DOM (real element tree,
  `classList`/`dataset`, a working `innerHTML` fragment parser AND
  serializer — the serializer had to read the LIVE mutated tree, not a
  cached string, since `wrapClientNamesInText` mutates via `replaceChild`
  rather than reassigning `.innerHTML` — and a real `TreeWalker` over text
  nodes) loads the actual extracted Trip Assistant and Client Tracker
  `<script>` blocks together via `new Function`, seeds a synthetic client
  in `localStorage` matching the reported screenshot (Amanda Jackson, Hot
  Lead, due this week), and runs two full "sessions": a fresh load (brief
  created live, button click correctly sends a draft message) and a
  simulated reload (brand-new DOM/JS state, same `localStorage` — the
  actual bug scenario), confirming the restored button was broken before
  this fix and works after it, and separately that restored client-name
  links now correctly open the right profile too, with no button-nested-
  in-a-button double-wrap regression (checked explicitly: the restored
  link count matches the fresh render's own count, and zero
  `.ta-client-link .ta-client-link` matches exist in the output either
  way). All 16 script blocks still parse; div-tag balance held at
  1,660/1,660 (pure JS refactor, no new markup) and the pre-existing
  775/774 span imbalance is unrelated and unchanged.
- **Worth building later, not done here**: the "🔊 Read aloud"/"📋 View
  full details" buttons on a normal AI reply bubble (`addAiAnswerMsg`)
  have the exact same root cause and are likely ALSO dead after a reload —
  but unlike the Draft button and the client-name links, those buttons'
  behavior depends on the full/summary text captured in a JS closure at
  creation time, not just data already sitting in the DOM as an attribute,
  so re-wiring them on restore needs a small design decision (most likely:
  also persist the full text per message, e.g. as a `data-full` attribute
  baked into the bubble's own HTML, so it travels through
  persistState/restoreState for free) rather than the same drop-in fix
  used here. Not built now since it wasn't what was reported — flagged
  here so it doesn't get "discovered" a second time.

## Full-file health check (Sep 2026) — one real bug found, one false alarm corrected

Direct request: "make sure all other functions are operating correctly,"
prompted by the Draft-button investigation above finding a real,
previously-undiscovered bug. Ran the full battery of static checks this
project already uses, specifically hunted for other instances of the same
persist/restore bug class, and re-ran the real function-level Node
execution harness against the current file.

- **Syntax**: all 16 `<script>` blocks still parse. **Tag balance**: div
  1,660/1,660 (clean); button 408/406 raw-grep but both "extra opens" are
  false positives from two prose comments literally containing the text
  `<button>`/`<span>` as example notation (confirmed via a real sequential
  depth-scanner, not just a flat grep count) — not unclosed markup.
- **Correction to an earlier finding this session**: the "pre-existing
  `<span>` tag imbalance (775/774)" flagged during the toolbar-facelift
  work was investigated further here and turns out to be the SAME kind of
  false alarm, not a real missing closing tag — a single comment (right
  above `maybeSurfaceDailyBrief`'s HTML-building code) reading "*a
  `<button>` inside a `<span>` right beside another button*" contains a
  literal, un-closed `<span>` substring as prose, which is the entire
  source of the 775-vs-774 discrepancy (confirmed via the same sequential
  scanner: final depth 1, the one "still open" tag pointing exactly at that
  comment line, nothing else). There is no actual unclosed `<span>` in this
  file's real markup. Retracting the earlier "worth a line-by-line hunt
  someday" note — there's nothing to hunt for.
- **Orphaned-reference sweep, redone properly this time**: an earlier pass
  this session's methodology (bare-call extraction, camelCase filter) still
  let through a lot of English-prose noise from comments/strings (a naive
  regex can't tell "the `<button>`s" in a comment from a real function
  call). Tightened the filter to bare calls (not `.method()` calls) that
  are genuine camelCase (an internal capital letter, which real function
  names in this file always have and English words never do) — 23
  candidates, all resolved as known false positives: JS/DOM builtins my
  filter list missed (`setTimeout`, `parseInt`, `requestAnimationFrame`,
  etc.), the already-documented parameter-name/shorthand cases
  (`onDone`/`onEvent`/`retryFn`/`noteRecent`/`toggleTripPin`), and — newly
  checked one by one — `clientProfile`/`getVoices`/`innerHTML`/
  `replyText`/`requestPermission`/`stopPropagation`, which turned out to
  all be comment-text mentions, not real code. Zero genuine dead/missing
  references found.
- **`getElementById` cross-check**: all 246 distinct string-literal ids
  requested via `document.getElementById(...)` resolve to a real `id="..."`
  somewhere in the document. Zero misses.
- **`window.__ta*`/`window.__ct*` cross-IIFE export audit**: all 19 defined
  exports are referenced from at least one other call site (no dead
  exports), and the only two "referenced but never defined" hits were
  comment text (`window.__ct*`/`window.__ta*` used generically in prose to
  describe the pattern, not real code).
- **Specifically hunted for other instances of the Draft-button bug class**
  (rendered HTML persisted to `localStorage`, then reconstructed via raw
  `innerHTML` injection on a later load WITHOUT re-running whatever wired
  its listeners) — confirmed there is exactly one function shaped like this
  in the whole file, `restoreState()`, and it's the one already fixed
  above. Every other `localStorage`-backed UI in this file (sidebar
  bookmarks/recently-viewed `renderGroup()`, the Client Tracker's
  `ctRender()`, the dashboard's `renderDashResume()`) rebuilds its markup
  AND wires its listeners together in the same function call, every time
  it runs — including on initial page load — which is exactly what makes
  those safe: there's no split between "how it was first built" and "how
  it gets reconstructed later" for the bug to hide in.
- **A second real, confirmed bug found and fixed**: `extractClientName()`'s
  one pattern for "for NAME" required a literal trailing COMMA
  (`/for\s+(...)\s*,/`) — but the exact message `ctDraftOutreach()` builds
  (`"Draft an outreach email for Amanda Jackson. They're interested in
  ..."`) ends the name with a PERIOD, not a comma. This directly
  contradicts what this file's own "Itinerary document export..." section
  above explicitly documents as a benefit: "`send()`'s own
  `extractClientName()`... naturally pick[s] this client's name... out of
  the constructed message... with no extra wiring needed." It didn't —
  confirmed via the real Node harness that `extractClientName` returned
  `null` on the actual generated text, every time, meaning `taState.
  clientName` (and therefore the context bar, and anything depending on it
  being set for a client the DE hasn't already been mid-conversation with)
  silently never got set from a first "Draft outreach" click on a fresh
  conversation. Fixed by widening that one pattern to accept a period OR a
  comma (`\s*[.,]`) — the minimal change that matches the real generated
  text without broadening the pattern's matching surface any further than
  necessary (still requires trailing punctuation immediately after the
  name, same specificity as before, just tolerant of both common
  sentence-enders instead of only one).
- Verified with a real Node execution-harness test (8 cases): the exact
  real `ctDraftOutreach`-generated string now correctly extracts "Amanda
  Jackson"; the original comma-terminated case still works (regression
  guard); a name with NO trailing punctuation at all still correctly
  returns `null` (this fix is deliberately about tolerating punctuation
  that's present, not about removing the requirement for punctuation
  entirely, which would have risked false-positiving on ordinary sentences
  mentioning a capitalized word after "for"); and all other existing
  patterns (`client name is X`, `client X wants...`, `for the Xs`, `Mr. and
  Mrs. X`, a plain question with no name) still resolve exactly as before.
  Re-ran the full Draft-button/client-link reload harness from the section
  above against the updated file and confirmed no regression there either.
  All 16 script blocks parse; div-tag balance unaffected (pure regex
  change, no markup touched).
- **Everything else checked came back clean**: re-ran the established
  real-function Node harness (`runSearchGuideTool`, `runGetCityDataTool`,
  `runFindMatchingItineraryTool`, `runGetTodoListTool`,
  `runProposeTodoUpdateTool`, `extractDestination`, `extractTier`,
  `extractOccasion`, `extractVibes`, `isNewClientSignal`, `splitSummary`,
  `looksLikeStructuredMarkdown`, `renderMarkdownLite`) against the current
  file — all still execute cleanly against realistic inputs, matching
  their last-verified shapes from earlier this session with no
  regressions from any of today's edits (the toggle-button change, the
  Draft-button reload fix, or this `extractClientName` fix).
- **Not exhaustive, stated plainly**: this covers everything checkable
  from static analysis plus real function-level execution in Node —
  it does not and cannot substitute for the still-outstanding "test this
  live in a real browser" caveat that applies to nearly every feature
  documented above. A genuinely complete check would also need a real
  browser pass (mouse/touch interaction, real speech recognition, real
  ElevenLabs/Anthropic network calls) that this environment has never been
  able to do.

## Loading/waiting states + an overlapping-panels z-index audit (Sep 2026, unverified live)

Direct follow-up: asked to do "all of it" from the earlier three-part
"more seamless and fluid" list — the modal-transition work already
covered "panels snap open/closed"; this covers the other two, "loading/
waiting feels dead" and "overlapping panels feel disjointed."

- **Shared spinner.** One CSS recipe, `.ta-spinner` (a small rotating
  ring using `border: 2px solid currentColor; border-right-color:
  transparent;`, so it automatically matches whatever text color the
  button or status text it's dropped into already has — no per-site
  color tuning needed) plus a `@keyframes ta-spin`, placed right after
  the existing typing-dots CSS. Every button/status-text spot in the
  Trip Assistant and Client Tracker that disables itself and shows a
  static "X…" label while waiting on a REAL network/AI call now prepends
  `<span class="ta-spinner"></span>` to that label: the error-retry
  button, the "🔊 Read aloud" button, the draft pop-out's "📱 Text
  version" SMS-condense button, the ⚙️ Settings "🔄 Load voices"
  (ElevenLabs) status line, and the Client Tracker's "🧠 Asking the AI to
  match an itinerary…" placeholder. Also gave `#ta-mic.speaking` (silent
  since it was built — `animation: none`) the same gentle pulse
  `#ta-mic.listening` already uses, just slower (1.8s vs. 1s) so it
  reads as calm rather than urgent — the mic button used to go fully
  static while actually speaking a reply aloud, the single longest wait
  state in the whole panel on a long answer.
- **Deliberately NOT touched**: `addPendingActionCard`'s Confirm/Cancel
  buttons (line up like a loading state — disable, relabel — but the
  underlying `window.__ctApplyPatch` call is synchronous local
  `localStorage` I/O with no real network wait, so a spinner there would
  just flash uselessly for a frame), and the guide's own separate OCR/
  quick-search voice loading text (a different, non-assistant part of
  this file, outside what "the assistant" scoping was actually about).
- Verified with real Node execution-harness tests against the actual
  extracted `addAiAnswerMsg`/`addErrorWithRetry` source (not
  paraphrases): the read-aloud button shows the spinner immediately on
  click, disables correctly, and cleanly restores to its plain label
  with the spinner gone once `speakText`'s `onDone` fires; the retry
  button shows the spinner and disables on click, and the wrapped
  `retryFn` still actually fires. The SMS/ElevenLabs/AI-match sites are
  the identical one-line pattern (a static `.textContent =`/`.innerHTML
  =` assignment gets a `<span class="ta-spinner">` prefix, restored the
  same way it always was) and weren't separately harnessed beyond a
  syntax check, given how mechanically identical and low-risk the change
  is once the pattern's been proven twice. All 16 script blocks parse;
  div-tag balance unaffected (1,660/1,660); span count moved from
  775/774 to 780/779 — the +5/+5 exactly matches the five new
  self-contained `<span class="ta-spinner"></span>` pairs added, so the
  underlying 1-off (the known false-alarm comment, see the full-file
  health check above) is unchanged and unrelated.
- **z-index audit, done properly rather than guessed at.** Built the
  complete table of every overlay/panel z-index value tied to the
  assistant/dashboard/guide-tools system and checked each pair that
  could plausibly ever be open at once for whether the code that opens
  the second one actually accounts for the first still being open.
  Found the architecture is largely already sound: every full-screen
  overlay (Dashboard, Quote Builder, Quiz, Exam Mode, Random Tip) that
  can be launched from a button living INSIDE another already-open
  overlay explicitly calls that overlay's own close function first
  (`closeDashboard()` before `quoteBuilderBtn.click()`, etc.) — so there
  is no live double-backdrop for any of those, despite some of them
  sharing or even inverting raw z-index numbers (e.g. Quote Builder's
  3000 is actually LOWER than Dashboard's 3100 — harmless only because
  Dashboard is always closed first, not because of the numbers
  themselves). The sidebar's own "Quick access" buttons (✨ Assistant /
  🔍 Search / ⏱️ What's Stale) turned out NOT to be a live risk either,
  even though none of their handlers close the Dashboard first — `
  #sidebar` itself carries no explicit z-index (0 on desktop, 1000 on
  the mobile drawer), well under any full-screen overlay's z-index, so
  the whole sidebar — quick-access buttons included — is already
  visually buried and unclickable behind ANY open full-screen overlay,
  making a "click Search from the sidebar while Dashboard is open"
  double-backdrop scenario unreachable in the first place, not
  reachable-but-lucky. `#ta-panel`/`#ct-overlay` deliberately outrank
  every full-screen overlay (9999/10000, vs. every one of the above
  topping out at 3100) specifically because Trip Assistant and Client
  Tracker are meant to be persistent floating utilities, not exclusive
  modal dialogs — confirmed the ONE real cross-panel handoff between
  them (`ctDraftOutreach`, Client Tracker → Trip Assistant) already
  explicitly closes Client Tracker's overlay first; the reverse
  direction (opening Client Tracker while Trip Assistant is already
  open) intentionally lets Client Tracker's full-screen overlay cover
  Trip Assistant rather than closing it, matching the pattern
  `#ta-itinerary-overlay`/`#ta-draft-overlay` already use for "opened
  from within, stays on top, reveals what was underneath when closed."
- **One real fragility found and hardened, though not a confirmed live
  bug**: `#dashboard-overlay` and `#stale-overlay` shared the literal
  same z-index (3100/3100) — coincidental, not deliberate — with no
  actual reachable path found that opens both at once (the only button
  that could have triggered this, `quickAccessStaleBtn`, is itself one
  of the sidebar buttons just established to be unreachable while any
  full-screen overlay is open). Bumped `#stale-overlay` to 3150 anyway,
  with a comment explaining the intended "opened from within, stays on
  top" relationship explicitly — equal z-index between two
  independently-triggerable overlays is fragile by construction even
  when today's code happens to never exercise it, and the fix costs
  nothing to make explicit rather than accidentally-correct.
- **Net honest conclusion**: the "overlapping panels feel disjointed"
  complaint most likely was NOT about a stacking/z-index bug — the
  audit didn't find one that's actually reachable. It's much more
  likely about the visual/motion language (now addressed by the modal-
  transition work earlier this session) or something that only shows up
  in actual use that this kind of static audit can't surface. Worth
  asking directly what specifically felt disjointed, if it still does,
  next time this comes up live.
- **Unverified live, same caveat as everything else**: whether the
  spinner's motion/timing/sizing looks right against each button's real
  styling (especially the tiny 10.5px AI-match button and the
  ElevenLabs status line, both smaller text than the chat-bubble
  buttons), and whether the slower `.speaking` pulse reads as intended
  rather than distracting during a long spoken reply — none of this has
  been seen in a real browser from this environment.

## Read-aloud / View-full-details buttons fixed for the same reload bug (Sep 2026, unverified live)

Direct follow-up: this was flagged as a known-but-unfixed gap the moment
the Daily Brief Draft button's reload bug was found and fixed — "worth
building later, not done here." Closed now.

- Same root cause, same fix shape as the Draft button: `persistState()`
  saves a bubble's rendered HTML, but `restoreState()`'s reconstruction
  never re-attached any click listeners. The Draft/client-link buttons
  were fixable straight from the DOM (their data was already sitting in
  attributes); these two buttons were harder because the answer text
  they need only ever lived in a JS closure at creation time — a
  restored bubble's HTML had the buttons but nothing for them to speak
  or pop open.
- **Fixed by baking the answer text into the HTML itself.**
  `addAiAnswerMsg` now writes `data-full="..."` (escaped the same way
  every other attribute in this file is) onto the `.ta-rec-actions`
  wrapper div, so the text travels with the persisted HTML for free —
  no separate bookkeeping needed. Split the wiring logic out into
  `wireAiAnswerButtons(container, opts)`, which reads the answer text
  from that attribute instead of a function parameter — identical
  behavior at creation time (a fresh bubble has exactly one
  `.ta-rec-actions`) and now also callable across the whole restored
  `#ta-msgs` list in `restoreState()`, same shape as the Draft-button
  fix's `wireBriefDraftButtons`/`wireClientLinkClicks`. `opts` (the
  `autoPlay` flag) is only ever passed at creation time — `restoreState()`
  calls this with none, so a restored message can never auto-speak or
  auto-pop-open the pop-out modal on page load, which would have been a
  real regression, not a fix.
- Verified with a Node execution-harness test simulating a full reload
  (fresh session creates the bubble via a realistic persisted-HTML
  shape, then a second, completely separate session loads with the same
  `localStorage` and confirms `restoreState()` reconstructs AND
  re-wires both buttons — clicking them post-reload no longer no-ops).
  Also unit-tested `addAiAnswerMsg`/`wireAiAnswerButtons` directly
  against the real extracted source: `data-full` carries the exact full
  text, both buttons fire with the correct text, `autoPlay` still works
  at creation time, a short reply (no pop-out) still omits the
  view-full button while still setting `data-full` for read-aloud to
  use, and an XSS probe in the answer text comes back fully escaped
  inside the attribute (confirmed no live `<script>`/`<img>` tag reaches
  the rendered HTML either way). All 16 script blocks parse; div-tag
  balance unaffected (pure JS refactor, no new markup — the buttons'
  own HTML shape didn't change, just where the wiring code reads its
  data from).
- **Unverified live**: same caveat as always — the actual reload
  behavior in a real browser hasn't been seen, only simulated.

## Structure-aware itinerary document cards (Sep 2026, unverified live)

Direct progress on a gap named explicitly in this file's own history:
"a full structured-data export... would need the model's free-text
answer parsed back into [Quote Builder's] shape — a real project on its
own," deliberately not attempted when "Download as document" first
shipped. Built the safely-achievable slice of that, not the whole
thing.

- **What's actually hard vs. actually easy, worked out first.** The
  Quote Builder's own document (`qbBuildDocumentHtml`) is built from
  real structured objects (`qbCollectItinerary()` — hotel/restaurant/
  tour records selected via its own UI, pulled from `QB_HOTELS`/
  `QB_RESTAURANTS`/`QB_TOURS`). Reconstructing THAT shape from an AI
  reply would mean matching hotel/restaurant/tour names the model
  mentions against this guide's real data with no guarantee the model
  used the exact same names — genuinely fragile, no reliable ground
  truth. A real city-by-city, day-by-day BREAKDOWN, on the other hand,
  doesn't need any of that — KT itinerary answers already reliably
  come back with the model's own markdown headers per day/city (`###
  Day 1: Madrid`, etc.), which `renderMarkdownLite` already parses
  today, just not as document-level structure.
- **`taSplitItineraryByDay(text)`** — finds every `#`/`##`/`###` header
  line and treats each as a section boundary, returning `{ intro, days
  }` (days = `{ heading, body }` pairs). Text before the first header
  becomes `intro` (a client-facing lead-in like "Here's a 3-day
  itinerary:" isn't discarded). A header with nothing under it before
  the next one — a decorative title like `## Your Itinerary` sitting
  above the real day headers — is filtered out rather than becoming its
  own near-empty card, so it doesn't clutter the output with a stray
  blank section.
- **`taBuildItineraryDocHtml` now renders each day as its own bordered
  `.itin-day-card`** (matching the guide's own beige/gold card
  language) instead of one continuous flowing document — genuinely
  closer to how a real itinerary document should read, city by city.
  **Only when there are 2+ real sections** — `taSplitItineraryByDay`
  finding 0 or 1 falls all the way back to the exact previous behavior
  (`renderMarkdownLite(fullText)` as one flowing block). This is the
  load-bearing safety net: a short reply, a non-itinerary answer, or
  one the model didn't happen to format with headers renders exactly as
  it always did — zero regression risk for anything that doesn't
  cleanly split into real day sections.
- **`taFormatDayHeading(heading)`** — headings come from raw,
  unescaped text (`taSplitItineraryByDay` operates before
  `renderMarkdownLite`'s own internal escaping happens), so this
  duplicates `renderMarkdownLite`'s own `escapeHtml` + `**bold**` +
  `[link](url)` handling for the one place (day-card headings) that
  needs it outside that function — a small, deliberate duplication
  rather than exporting `inlineFormat` out of `renderMarkdownLite`'s
  closure for one caller, matching this file's own established
  "sometimes three similar lines beats a new export" calls elsewhere.
- Verified with a real Node execution-harness test against the actual
  extracted `taSplitItineraryByDay`/`taFormatDayHeading`/
  `taBuildItineraryDocHtml` source (22 checks): a realistic 3-day
  itinerary correctly splits into 3 day cards with the intro text
  preserved and the client's name in the title; a short no-header reply
  and a single-header reply both correctly fall back to the old
  flowing render (checked by looking for an actual `<div
  class="itin-day-card">` in the output, not just the CSS rule's own
  mention of the class name, which is always present regardless); a
  decorative empty-bodied title above real day headers is correctly
  skipped rather than becoming its own card; an XSS probe in both a day
  heading and a day's body comes back fully escaped with no live
  `<script>`/`<img>` tag reaching the output; bold text and a markdown
  link inside a day heading render correctly as `<strong>`/`<a href>`;
  a missing client name falls back to "Prospective Client" as before;
  and a KT-shaped realistic example (bold hotel names, a note callout,
  a trailing "happy to adjust" line with no header after it) preserves
  all of that correctly inside the right cards. All 16 script blocks
  parse; div-tag balance incremented by exactly one (the new
  `.itin-day-card` div pattern in the template, itself balanced), spans
  unaffected.
- **Deliberately not attempted**: matching mentioned hotels/restaurants/
  tours against this guide's real `QB_HOTELS`/`QB_RESTAURANTS`/
  `QB_TOURS` data to enrich or verify them — that's still the
  genuinely bigger, riskier build flagged when this feature first
  shipped, and nothing about today's work changes that risk
  assessment. This is real, additive progress toward "structure-aware,"
  not a replacement for it.
- **Unverified live**: whether real KT itinerary answers reliably use
  `#`/`##`/`###` headers per day the way the test cases assume (this
  session's own screenshots of real model output show 3-hash headers
  used for OTHER structured answers — to-do lists — which is the basis
  for that assumption, but no real ITINERARY answer's exact header
  shape has actually been seen), and how the bordered day cards
  actually look/print in Word once opened from a real `.doc` download —
  neither can be confirmed without a real browser and a live model
  response.

## GitHub Pages hosting — verified what's checkable from here (Sep 2026)

Direct follow-up to "host over HTTPS" as a recommended next step (it
unlocks mic-permission persistence and the service worker's background
reminders, both silently inert on `file://`). What this environment
could and couldn't confirm:

- **Confirmed**: `sw.js` and `Tommie_Tours.html` are both committed at
  the repo root (`git ls-files` — required for `sw.js`'s own
  `./sw.js`-relative registration to resolve once hosted), and every
  recent push's "pages build and deployment" GitHub Actions run
  completed with `conclusion: success` — the deploy pipeline itself is
  healthy and current.
- **Could NOT confirm from this environment**: whether the live
  `https://tommiemclaren.github.io/Tommie/...` URL actually serves the
  page correctly, registers the service worker without error, or
  behaves as expected — this sandbox's network egress proxy blocks
  `*.github.io` outright (`EGRESS_BLOCKED`), and there's no GitHub API
  tool available here that exposes the Pages configuration itself
  (custom domain, HTTPS enforcement, build source) to double-check
  independent of fetching the live URL.
- **One real thing worth knowing**: there's no `index.html` in this
  repo, so the bare root URL (`.../Tommie/`) almost certainly 404s or
  shows a directory listing — the real working URL is very likely
  `https://tommiemclaren.github.io/Tommie/Tommie_Tours.html` specifically
  (the exact hostname assumes the standard `<owner>.github.io/<repo>/`
  GitHub Pages URL shape for a project page with no custom domain,
  itself not independently confirmed from here). Worth bookmarking the
  direct file URL rather than the bare repo root, and worth adding a
  one-line redirect `index.html` later if the bare root URL is ever
  wanted to work too — not done here since it wasn't asked for and
  isn't blocking anything.
- **Net honest status**: this is as far as static-analysis-plus-Actions-
  API verification can take it. Confirming the URL actually works,
  `sw.js` registers, and the mic-permission/background-reminder
  improvements are real needs a real browser hitting the real hosted
  URL — genuinely the one item on this list that only a live check
  outside this environment can close out.

## Client Tracker: an "All Clients" view, grouped by status (Sep 2026, unverified live)

Direct request: "a real gap is not having an area in the client tracker
for all existing clients... store and organize that nicely. Be able to
filter and scroll through all leads... and what status they are in. A
drop down feature to switch statuses would be good too."

- **What was actually already there vs. the real gap.** The default list
  already shows every client (`ctGroupClients` buckets everyone into
  Overdue/Due this week/Upcoming/No date/Closed — that IS the full
  roster, nothing was hidden) — but always organized by follow-up
  urgency, never by where someone actually sits in the booking pipeline.
  A client with no near-term follow-up date quietly sits in "No
  follow-up date" regardless of whether they're a fresh Inquiry or
  sitting at Quote Sent — the real gap wasn't visibility, it was a
  roster-shaped VIEW of it.
- **New `#ct-view-toggle`** — two pills, "📅 Follow-up" (the existing
  behavior, unchanged, still the default) and "📇 All Clients" (new).
  Deliberately a toggle rather than a replacement: "who needs me next"
  is still the more useful default for a DE opening the panel
  day-to-day, this just adds the roster-shaped alternative alongside it.
  Reuses the search box, the status filter dropdown, and the lead-temp
  tabs unchanged in both views — only the GROUPING changes.
- **`ctGroupByStatus(list)`** — same shape as the existing
  `ctGroupClients` (an object of arrays, alphabetically sorted within
  each) but bucketed by the real six-value pipeline status
  (`CT_STATUSES`, newly pulled out as one shared constant) instead of
  follow-up urgency. A client whose stored status somehow isn't one of
  the six (a hand-edited `localStorage` value, an odd import) falls into
  its own "Other" bucket rather than silently vanishing from the list.
- **Inline status dropdown, "All Clients" view only.** `ctCardHTML(c,
  opts)` now takes an options param — with `{ statusSelect: true }` it
  renders a real `<select>` (styled to match the existing status badge's
  color language) instead of the plain static badge; every other view
  (including the default urgency one) passes no options and renders
  exactly as before, zero visual change there. Changing the dropdown
  calls the same `window.__ctApplyPatch` the AI-driven `propose_
  todo_update` confirm flow already uses — one save path, not a second
  one — which re-renders the whole list immediately, so picking a new
  status visibly moves the card into its new group right away.
  `stopPropagation()` on both the select's `click` and `change` — without
  it, opening the dropdown's own option list already counts as a click on
  the card underneath (the whole card is a click target for "open
  profile"), popping the profile open before the actual selection even
  registers.
- **A real bug caught before it shipped, not after**: `items.map(
  ctCardHTML)` — the existing call site for the default view — would
  have silently broken once `ctCardHTML` gained a second parameter.
  `Array.prototype.map` calls its callback with `(item, index, array)`,
  so the array INDEX would have leaked into `opts` for every card past
  the first one; by luck this wouldn't have visibly broken anything
  (`opts.statusSelect` on a number is always `undefined`, still falsy),
  but it's exactly the kind of fragile-by-accident code this file's own
  audits keep finding. Fixed by making both call sites explicit (`items.
  map(c => ctCardHTML(c, cardOpts))`) rather than relying on that luck.
- **Also caught before shipping**: the new view-toggle buttons could not
  reuse the existing `.ct-tab` class, even though they're visually
  styled the same way — two places in this file already do an unscoped
  `document.querySelectorAll('.ct-tab')` to wire up the lead-temp tabs,
  and reusing that class would have made the new buttons ALSO fire the
  lead-temp click handler (setting `ctActiveTempTab` to `undefined`,
  since the new buttons use `data-view` not `data-temp`). Given a
  distinct class, `.ct-view-tab`, instead.
- `#ct-view-toggle` is hidden/shown alongside `#ct-toolbar`/`#ct-tabs` in
  `ctOpenDetail`/`ctCloseDetail` (the profile drill-down already hides
  the other list-level controls; this one needed the same treatment or
  it would have kept floating above an open profile).
- Verified with a real Node execution-harness test loading the actual
  extracted Client Tracker script and seeding five synthetic clients
  across four different statuses: the default view still shows static
  badges and zero dropdowns (regression guard); switching views shows
  one dropdown per client and zero static badges; the status groups
  render in the correct `CT_STATUSES` order with correct counts; a
  two-client group sorts alphabetically; changing a dropdown actually
  persists the new status to `localStorage`, calls `stopPropagation`,
  and the list visibly re-renders with the client now in its new group
  (count grew from 2 to 3 in the target group); and an XSS probe in a
  client name comes back fully escaped with no live `<script>` tag in
  the rendered list. Also had to extend the test harness itself with a
  generic event-`trigger()` method (previously only `click()` existed)
  to fire the dropdown's real `change` listener rather than reaching
  into its internals. All 16 script blocks parse; div/button tag
  balance incremented by exactly the new static markup added (one
  `#ct-view-toggle` div, two `.ct-view-tab` buttons), select-tag balance
  held.
- **Deliberately not built**: bulk status changes (select multiple
  clients, change all at once) and a true virtualized/paginated scroll
  for a very large roster — the existing `#ct-body` container is already
  a real scrollable region (`overflow-y: auto`, fixed from an earlier
  session's clipping-bug fix), so "scroll through all leads" is already
  satisfied by the browser's native scrolling for any roster size this
  file is realistically used at; a custom virtual-scroll implementation
  would be solving a problem that doesn't exist yet.
- **Unverified live**: how the inline dropdown's custom arrow icon and
  color-coding actually look against each status (especially "Traveling"
  and "Follow-up needed," which don't have their own distinct color the
  way Booked/Closed do — they inherit the default gold badge look,
  matching what the static badge already did for those two statuses),
  and whether switching between the two views feels smooth or jarring in
  a real browser — none of this has been seen outside this environment.

## "All Clients" view, cleaned up after real live feedback (Sep 2026, unverified live)

The DE sent a real screenshot of the just-shipped "All Clients" view
working — first live confirmation it actually renders — with "clean this
up. Make [it] more fluid and organize it a bit better." Reading the
screenshot directly rather than guessing blind:

- **The actual problem, diagnosed from the screenshot, not assumed**:
  `#ct-view-toggle` and `#ct-tabs` used identical styling and identical
  padding (`.ct-view-tab`/`.ct-tab` were both plain white pills, both
  `padding: 12px 26px 0`) — stacked directly on top of each other they
  read as one long, repetitive row of near-identical buttons, not two
  different controls. Made worse by color: the view toggle's active
  state was gold, the tab row's active state (visible in the screenshot,
  "Hot Lead") was dark green — two different accent colors on two rows
  of the same-looking pill button reads as visually competing, not
  intentional.
- **Fixed by making them different SHAPES, not just different colors.**
  `#ct-view-toggle` is now a real segmented control — one bordered/
  beige track with `padding: 3px`, the active segment a raised white
  pill with a soft shadow inside it (the familiar iOS-style switch
  pattern) — immediately reads as "this changes a mode" at a glance,
  distinct from the plain pill row of filter tabs below it, which still
  reads as "these narrow a list." The color clash resolves itself once
  the shapes no longer look like the same control repeated.
- **Tightened the vertical rhythm**: `#ct-tabs`'s top padding dropped
  from 12px to 8px specifically so it reads as connected to the toggle
  above it (one toolbar area: mode switch, then its filters) rather than
  a second independently-floating row.
- **Group headers got more visual weight** — `.ct-group-title` (e.g.
  "INQUIRY 1" in the screenshot) gained a gold left-accent bar and bumped
  from 700 to 800 weight, matching the gold-accent-bar language already
  used for headings elsewhere in this file (Quote Builder/itinerary
  documents' `h2`) — was plain small-caps gray text with comparatively
  little presence against the now-more-polished toolbar above it.
- **A real fade transition on re-render**, not just the toolbar restyle
  — direct response to "more fluid," matching this session's established
  vocabulary from the earlier modal-transition work. New
  `ctSetListHtml(list, html)` replaces every direct `list.innerHTML =`
  assignment in `ctRender()` (three call sites: the two empty-states and
  the real grouped-cards render) — drops `#ct-list`'s opacity to 0,
  updates the content synchronously (so the very next line's
  `querySelectorAll` wiring still finds real elements immediately, no
  timing gap), then restores opacity to 1 on the next animation frame.
  `#ct-list` already needed a `transition: opacity .15s ease` rule added
  for this to actually animate rather than snap. Fires on every
  `ctRender()` call — switching views, typing a search, changing the
  status filter, picking a new status from the inline dropdown — so the
  whole panel feels like one consistently fluid surface, not just the
  one toggle that prompted the complaint.
- Verified with the existing real Node execution-harness test (the one
  built for the "All Clients" view itself) re-run against the restyled/
  re-rendered source — confirmed zero functional regression (view
  switching, status grouping/counts/sort order, the inline dropdown's
  save-and-re-render, the XSS probe all still pass exactly as before,
  since this pass was pure CSS plus one small rendering helper, no
  logic changes). Added one new targeted check for the fade mechanic
  itself: opacity drops to 0 synchronously, the new content is already
  queryable before the animation frame fires (proving the wiring calls
  right after `ctSetListHtml` aren't racing the fade), and opacity
  restores to 1 once the queued `requestAnimationFrame` callback runs.
  All 16 script blocks parse; div-tag balance unaffected (pure CSS +
  one JS helper, no new markup).
- **Unverified live**: whether the segmented-control restyle, the
  tightened spacing, and the fade actually read as "fluid and organized"
  in a real browser the way they're intended to — this round shipped in
  direct response to a real screenshot, but the fix itself hasn't been
  seen live yet. Worth a look at the actual result next time the panel's
  open.

## Client Tracker: fixed getting stuck in the Add/Edit form (Sep 2026, unverified live)

Direct report: "if I accidentally click qualify call or add client, I
can't move to all clients or follow up."

- **Root cause, confirmed by reading `ctOpenForm()` directly**: it adds
  `.open` to `#ct-form-panel` but never touches `#ct-list`, and neither
  the view-toggle's nor the lead-temp tabs' click handlers ever closed
  the form — they just called `ctRender()`, which rebuilds `#ct-list`'s
  content whether or not anything is actually visible. With the form
  open, `#ct-list` was still sitting in the DOM (not hidden — a second,
  separate gap found while investigating, see below), just positioned
  below the form in normal document flow — so clicking "All Clients" or
  a lead-temp tab silently re-rendered content the DE couldn't see
  without scrolling past the whole form. From the DE's side: tap the
  button, nothing visibly happens, genuinely stuck.
- **Fixed at the two click handlers**: both `.ct-tab` and `.ct-view-tab`
  now call `ctCloseForm()` before doing their normal filter/view-switch
  work — a no-op if the form wasn't open, the same reset the Cancel
  button already triggers otherwise. Tapping either row now always
  genuinely returns to the list, whether or not the form happened to be
  open.
- **A second, related gap found while investigating and fixed
  alongside it**: `ctOpenForm()`/`ctCloseForm()` never hid/showed
  `#ct-list` at all — unlike `ctOpenDetail()`/`ctCloseDetail()` (the
  profile view), which already does this correctly. `#ct-list` now
  hides when the form opens and restores when it closes (by Cancel,
  Save, or the new close-on-navigate fix above), matching the profile
  view's own established pattern instead of leaving the full card list
  rendered out of view underneath the form.
- Verified with a real Node execution-harness test reproducing the
  exact reported scenario end-to-end: opening "+ Add client" now
  correctly hides the list (confirming the second gap was real);
  clicking "All Clients" while stuck in the form now closes it, shows
  the list again, switches the view, and a real client card is visible
  — the literal fix for what was reported; the same check repeated for
  a lead-temp tab; and a regression guard confirming the existing
  Cancel button still closes the form and restores the list exactly as
  before. All 16 script blocks parse; div-tag balance unaffected (pure
  JS logic change, no new markup).
- **Unverified live**: whether this is the complete fix or the DE hits
  the same "stuck" feeling somewhere else not covered here (e.g. the
  search box or status filter dropdown, deliberately left untouched
  this pass since neither was named in the report and losing in-
  progress form data just from typing a search feels like a different,
  less obvious tradeoff than a dedicated navigation button) — worth
  confirming next time the form is open and something else gets tapped
  by accident.

## Daily Tasks — a new checkable checklist bubble, with full Trip Assistant access (Sep 2026, unverified live)

Direct request, quoted in full since the exact wording defined the
scope: "another use tool would be a Daily Tasks bubble. Something I can
just check off that it is done and actioned. I would also like the
follow up due that day in the tab in client tracker to add to this
list. So the Daily Checklist - Check emails. Check Leads. In TMT. Look
at what meetings I have. Update Follow Up's from TMT. Make sure all
notes are updated in TMT. Update Calendly. End of day tasks - Update
any notes or files. Make sure no outstanding follows. Any other helps
tabs you think to add." Followed, mid-build, by: "The Assistant should
have complete access to this."

- **A third floating panel**, independent of Trip Assistant and Client
  Tracker: `#dt-btn` (✅, teal to distinguish it from the sage/gold Trip
  Assistant and Client Tracker buttons) placed at `bottom: 88px; left:
  24px` — directly above `#ct-btn`, reusing vertical space on the left
  side that four older right-side buttons (`#random-tip-btn`/`#tell-
  me-more-btn`/`#quickSearchBtn`/`#why-reopen-btn`, retired to `display:
  none !important` during the earlier Trip Assistant redesign) freed up,
  rather than inventing a fourth screen corner for one more button.
  `#dt-overlay`/`#dt-modal` follow the exact same centered-overlay
  pattern (and the shared open/close fade-transition CSS recipe) every
  other modal in this file already uses.
- **The checklist items are the DE's exact wording, not a paraphrase** —
  split into the two sections named in the request (`Daily Checklist`:
  Check emails / Check leads in TMT / Look at what meetings I have /
  Update follow-ups from TMT / Make sure all notes are updated in TMT /
  Update Calendly; `End of Day`: Update any notes or files / Make sure
  there are no outstanding follow-ups). Stored as a fixed `DT_STATIC_
  ITEMS` array, checked state keyed by item id in `localStorage`
  (`kt-daily-tasks:v1`).
- **Today's follow-ups pulled in exactly as asked, with zero duplicate
  logic.** `dtGetDueFollowUps()` reuses the Client Tracker's own already-
  exported `window.__ctGetTodoSummary()` (the same data source
  `get_todo_list`/the Daily Brief already use) — combines its `overdue`
  array with whatever in `dueThisWeek` has `nextFollowUp === today`, so
  this can never disagree with what the Client Tracker itself considers
  due. No new Client Tracker code was needed for this part at all.
- **"Any other helps tabs you think to add" — answered narrowly, on
  purpose.** The one thing added beyond exactly what was asked is a
  small ad-hoc "Today's Extra Tasks" list (`dt-add-input`/`dt-add-task-
  btn`) — a free-text box to jot down something specific to today that
  isn't part of the fixed routine (a one-off errand, a reminder to call
  someone back). Chosen specifically because it's the one gap a purely
  fixed checklist can't cover on its own, and because it's the same
  "propose a task, no confirm needed, cheap to undo" shape as everything
  else in this feature. Deliberately did NOT add a second recurring
  checklist (weekly/monthly tasks), a real Calendly/TMT API integration,
  or a due-time/reminder system for custom tasks — none of those were
  asked for, and each is a genuinely bigger, riskier build (TMT/Calendly
  in particular have no API access from a static file with no backend,
  the same category of gap already documented for Outlook/Calendar
  elsewhere in this file) that shouldn't be guessed into existence.
- **Reset semantics, chosen deliberately rather than defaulting to
  "clear everything daily" or "keep everything forever."**
  `dtLoadState()` resets ALL checked state on a new day (the fixed
  checklist and today's follow-ups are meant to be freshly earned each
  day — carrying yesterday's checkmarks forward would make the checklist
  meaningless) but CARRIES FORWARD any still-unchecked custom task (it's
  still genuinely open work) while dropping any checked one (it's done,
  no reason to keep it around). A completed follow-up isn't itself
  tracked as "done" anywhere outside this panel — checking it off here
  only marks it done in Daily Tasks' own local state, it does NOT write
  anything back to the Client Tracker record; this was a deliberate
  scope boundary, not an oversight, since conflating "I acknowledged
  this in my daily list" with "this client's follow-up is actually
  resolved" would be a real correctness risk for a CRM record.
- **Full Trip Assistant AI access, per the explicit "complete access"
  ask** — three new tools, `get_daily_tasks`/`complete_daily_task`/
  `add_daily_task`, added to `TA_TOOLS` alongside the existing
  `get_todo_list`/`propose_todo_update` pair, each backed by a new
  `window.__dt*` export (`__dtGetSummary`/`__dtCompleteTask`/
  `__dtAddTask`/`__dtOpenPanel`) — same cross-IIFE pattern as every other
  Trip-Assistant-reads-Client-Tracker integration in this file.
  `__dtCompleteTask(query)` does a fuzzy match (exact, then substring
  either direction) across all three sources at once — the fixed
  checklist, today's follow-ups, and custom tasks — so "check off Amanda
  Jackson" and "check off checking emails" both work through one tool.
- **Deliberately DIRECT-ACTION, not propose-then-confirm — a real
  divergence from `propose_todo_update`'s pattern, reasoned explicitly
  rather than copied by default.** `propose_todo_update` never writes
  directly because it touches a real client record — a wrong AI-driven
  edit there is a real CRM data-integrity risk. The Daily Tasks list is
  the DE's own personal, disposable checklist with no client-facing
  blast radius at all: the worst case of a wrong `complete_daily_task`
  call is a DE re-checking a box, which is a strictly smaller and more
  recoverable failure than a bad client-record patch. `complete_daily_
  task`/`add_daily_task` apply immediately with no confirm card, which
  is also simply what "complete access" and "check something off for
  me" actually mean as a request — a confirm-card round trip for
  checking off "check emails" would be friction for its own sake.
- Verified with real Node execution-harness tests (not paraphrased
  copies) against the actual extracted Daily Tasks script: a fresh load
  with no Client Tracker present (8 items across the 2 correct sections,
  all undone, badge shows 8, zero follow-ups since `__ctGetTodoSummary`
  doesn't exist yet); completing a fixed item and a custom item both by
  fuzzy match; a genuinely unmatched query correctly returning `null`;
  adding a custom task and seeing it reflected in both the summary and
  the badge count; empty/whitespace-only input correctly rejected by
  `__dtAddTask`; an XSS probe in a custom task's text stored raw but
  rendered fully escaped with no live `<script>` tag reaching the DOM;
  state surviving a simulated same-day reload; and the new-day reset
  scenario specifically (checked items reset, a checked custom task
  dropped, an unchecked custom task carried forward and starting
  unchecked in the new day). Separately verified the Client Tracker
  follow-up integration (overdue + due-today correctly combined and
  deduplicated, upcoming/no-date entries correctly excluded) and the
  three new Trip Assistant tool handlers end-to-end (found-and-applied,
  not-found, and Client-Tracker-not-loaded-yet cases for all three), plus
  a full regression pass confirming every pre-existing Trip Assistant
  tool (`search_guide`/`get_city_data`/`find_matching_itinerary`/
  `get_todo_list`/`propose_todo_update`) still dispatches correctly after
  the tool-list/filter/dispatch-mapping changes. All 17 `<script>` blocks
  parse; div-tag balance held even (opens === closes) after the new
  markup.
- **Unverified live, same caveat as everything else in this file**: the
  panel's actual look/placement next to the Client Tracker button, the
  checkbox interaction feel, whether the fixed checklist's exact wording
  matches how the DE actually thinks about the routine day to day, and
  whether the AI tools' fuzzy matching holds up against how a DE
  naturally phrases "check that off" in a real conversation — none of
  this has been seen in a real browser from this environment. Test next:
  open the Daily Tasks panel, check a few items off, add a custom task,
  then ask Jarvis (typed or voice) "what's left on my daily list today"
  and "check off checking emails" and confirm both work end-to-end.

## Client Tracker: multiple follow-ups per client, and a clickable follow-up notification (Sep 2026, unverified live)

Direct request, from the screenshot of a client's profile sidebar
showing the "📅 Follow-up due in 2 days" callout: "Can you make it so I
can add additional follow ups, and click on the exsisting follow up
notification to edit or see the information. Please make sure this
works with the task list and updates in the appropriate places."

- **The real gap**: a client had exactly one scheduled follow-up —
  `client.nextFollowUp`, a single date string — with no way to have a
  second one on the books (e.g. "call Tuesday, then check in again in
  three weeks") and no way to act on the sidebar's own callout beyond
  reopening the whole Edit form to change that one date.
- **`client.followUps`** — a new array of `{id, date, note}` entries is
  the new source of truth for scheduling. `client.nextFollowUp` is
  deliberately KEPT, not replaced, as a DERIVED "soonest upcoming date"
  field — `ctSyncNextFollowUp()` is the only thing that writes it now,
  called after every add/edit/delete. This was the one design choice
  that made the whole feature low-risk: every existing consumer of
  `nextFollowUp` (`ctGroupClients`'s urgency buckets, `ctCardHTML`'s card
  text, the Daily Brief, `__ctGetTodoSummary` → Daily Tasks' due-today
  pull, the Outlook deep link, the `propose_todo_update` AI tool) reads
  that one field and needed ZERO changes to keep working correctly —
  satisfying "make sure this works with the task list and updates in the
  appropriate places" essentially for free, by construction, rather than
  by touching Daily Tasks/Daily Brief/the card code directly.
- **Backward compatible with every client saved before this feature
  existed.** `ctFollowUpsFor(client)` synthesizes a single legacy entry
  from `nextFollowUp` on the fly for DISPLAY when `followUps` doesn't
  exist yet — no migration write happens until the DE actually adds,
  edits, or deletes a follow-up through the new UI, at which point
  `ctMaterializeFollowUps()` creates the real array (folding the legacy
  date in as its first entry so it isn't lost).
- **New "Follow-ups" section in the profile sidebar** (`ctRenderFollowUps
  Section`, next to Notes/Drafts, same "+ Add" toggle + inline editor
  pattern the Notes section already established). Every entry shows its
  date (formatted the same "in N days"/"N days ago" way the card already
  does), an optional note, and its own ✏️ button; the soonest entry gets
  a gold "Next" badge since that's the one every other part of this file
  actually keys off.
- **The task callout itself is now a real `<button>`, per the explicit
  "click on the exsisting follow up notification to edit" ask** — CSS
  reset to still read as the same soft colored banner, just clickable,
  plus a small "Tap to edit"/"Tap to schedule a follow-up" hint line.
  `data-followup-open` names WHICH entry it's about: the soonest one
  when the callout is showing an overdue/due-within-7-days state (since
  that's the actual entry driving the banner), or the literal `'new'`
  when it isn't (the hot-lead-staleness and "nothing urgent" states
  aren't about any particular scheduled date — clicking those opens the
  add form instead). Deliberately wired through the exact same
  `[data-followup-open]` click handler the Follow-ups section's own ✏️
  buttons use — one code path for both, not two.
- **`__ctApplyPatch` (the `propose_todo_update` AI tool's write path)
  updated to stay consistent with the new list.** Without this, an
  AI-driven `nextFollowUp` change would set the top-level field directly
  while leaving `followUps` untouched — then the next manual add/edit/
  delete in the sidebar would call `ctSyncNextFollowUp()` and silently
  overwrite the AI's change back to whatever the list's own soonest date
  was. Now folds the patched date into the list as its soonest entry (or
  drops the soonest entry if the AI cleared it) and re-syncs
  `nextFollowUp` from the result — so clearing the soonest follow-up
  correctly bumps a later-scheduled one up instead of leaving the field
  stuck empty.
- Verified with a real Node execution-harness test against the actual
  extracted Client Tracker source (not a paraphrase) — including finding
  and fixing a gap in this session's own test-harness fidelity along the
  way: the harness's `document.getElementById` had always been a flat
  id→element cache (fine for this file's static, pre-existing form
  inputs, which earlier tests exclusively exercised) but wrong for these
  new date/note inputs, which are rendered fresh into innerHTML on every
  re-render the way a real browser's DOM actually works — replaced with
  a real tree search so the harness matches actual `getElementById`
  semantics. With that fixed, 20 checks all passed: a legacy client with
  only `nextFollowUp` opens correctly synthesized as one entry; adding a
  follow-up materializes the array and syncs `nextFollowUp`; adding a
  SECOND one keeps `nextFollowUp` on the truly soonest date (not the
  latest-added) and badges it "Next"; clicking the task callout opens
  that exact entry's inline editor; editing an entry's date/note
  persists and re-syncs; deleting the soonest entry correctly bumps the
  next one up; deleting the last one clears `nextFollowUp` entirely and
  the callout falls back to "nothing urgent" rather than a stale banner;
  a >7-day-out remaining follow-up correctly does NOT drive the callout
  (confirming that's by design, not a gap found mid-test); Cancel/empty-
  date submissions are safe no-ops; the `__ctApplyPatch` AI-patch sync
  (set, clear-with-a-later-entry-surviving) behaves as designed; an XSS
  probe in a follow-up's note comes back fully escaped; and
  `__ctGetTodoSummary()` (Daily Tasks/Daily Brief's actual data source)
  still correctly surfaces a due-today follow-up added through the new
  UI — the concrete proof that "works with the task list" holds. Also
  re-ran both of this session's pre-existing Client Tracker Node
  harness tests (the "All Clients" view, and the stuck-in-the-form fix)
  against the updated source with zero regressions. All 17 `<script>`
  blocks parse; div-tag balance held (1680/1680) — two new comments
  written for this feature briefly introduced literal `<button>`/`<div>`
  substrings into their own prose, which would have shown up as false
  "unclosed tag" noise in this file's own grep-based balance check the
  next time someone runs it; reworded them before committing so that
  check stays clean.
- **Deliberately not built**: a "done"/completed flag per follow-up
  entry (deleting one is how a follow-up gets removed once it's been
  actioned — matches the pre-existing model, which never had a
  completion flag on the single `nextFollowUp` field either) and letting
  the card itself (not just the profile) show more than one upcoming
  date — the compact card's one-line "Follow-up in N days" already
  correctly reflects the soonest scheduled date via `nextFollowUp`,
  and a card-level multi-date display wasn't part of what was asked.
- **Unverified live**: the inline editor's actual click/type/save feel
  in a real browser, whether the "Next" badge and the callout's new
  "Tap to edit" hint read clearly at a glance, and whether the
  `__ctApplyPatch` AI-sync behavior (letting the list's own soonest date
  win over a stale AI-set one) ever produces a confusing moment in
  practice — none of this has been seen outside this environment. Test
  next: open a client with an existing follow-up, add a second one for
  a different date, click the sidebar's follow-up notification to
  confirm it opens the right entry, edit and delete a follow-up, and
  confirm the client's card/urgency grouping and the Daily Tasks panel
  all reflect whichever follow-up is now soonest.

## TMT screenshot import — drag/drop a follow-up list, review, apply (Sep 2026, unverified live)

Started as a feasibility question — "is it possible to add a drag & drop
feature where the client tracker and/or the assistant scans the photo
and pulls the information from it... new client... into the new client
fields" — then reshaped entirely by two real screenshots the DE sent of
their own TMT (Kensington's internal system): NOT a single client detail
card as first assumed, but TMT's own to-do/follow-up list, grouped by
section (To Dos/Post Sale/Pre Sale) and then by client-name header (a
blue link, sometimes with a small count badge), with plain task rows and
`DD/MM/YY` dates nested under each. The DE also confirmed one of the
header names in their screenshot ("Tommie McLaren") was their own test
profile, not a grouping label — settling that the header rows really are
client names, one section can contain the SAME client's name more than
once (multiple bookings/threads), and most individual task rows (TMT's
own cadence-step labels like "First Engagement Attempt") carry NO name
of their own at all — only the group header does. Mid-build, the DE
added: "The client tracker, assistant and Task list will all need to
work in unison to talk to each other as well for this."

- **Reuses the Trip Assistant's already-working vision call
  (`window.__taCallClaudeAI`) rather than a second image pipeline** —
  same BYOK key, same call this file already makes for AI itinerary
  matching (`ctRunAiItineraryMatch`, built earlier this session). One
  vision call per import, asking for a strict JSON array —
  `{client, task, date}` per row — with an explicit instruction that TMT
  dates are day-first (`22/08/26` → `2026-08-22`, not the American
  reading) since getting that backwards would silently mis-schedule
  every imported follow-up by weeks. `ctParseScanJson()` tolerates a
  stray code fence or leading sentence around the JSON (models don't
  always follow "respond with ONLY..." exactly, same lesson this file
  already learned from the draft-detection regex earlier this session)
  before giving up and showing an error.
- **A real multi-row review screen, not ctOpenForm's single-client
  prefill.** A batch of a dozen to-do rows has no one form to pre-fill —
  this is the propose-then-confirm pattern's natural next shape: every
  extracted row gets its own checkbox, a client-choice dropdown
  (pre-selected to a matched existing client via the same fuzzy
  `window.__ctFindClientByName` logic this file already uses elsewhere,
  or to "+ New client: <name>" when the row's own name doesn't match
  anyone tracked, or to "— Skip —" when no name was extracted at all),
  and — only when "+ New client" is selected — an editable name field.
  Nothing is written to `ctClients` until the DE hits Apply; Cancel (or
  the ✕/backdrop) discards everything extracted.
- **Multiple rows for the same not-yet-tracked name merge into ONE new
  client, not one per row** — a `Map` keyed by the lowercased typed name,
  built fresh per Apply call, so three cadence-step rows all under the
  DE's own "Tommie McLaren" test-profile header (or any real client with
  several open to-dos) land as three follow-ups on a single new client
  record, matching how the DE actually thinks about "this is all the
  same person."
- **A row with a name but no visible date still creates the client, just
  with no follow-up scheduled** — rather than being silently dropped.
  TMT's own cadence-label rows sometimes have no date rendered in the
  screenshot at all; losing the name entirely in that case would throw
  away real information the DE could still use (a client worth adding
  even before knowing when to follow up).
- **Works in unison, per the explicit ask, largely by construction, not
  new plumbing.** Because applied follow-ups go through the exact same
  `ctAddFollowUp()` built earlier this session (which keeps
  `nextFollowUp` synced as the derived soonest date), everything that
  already reads that field — the card, urgency grouping, the Daily
  Brief, and Daily Tasks' `dtGetDueFollowUps()` (via
  `window.__ctGetTodoSummary()`) — picks up an imported follow-up with
  zero additional wiring. The one genuinely NEW integration point: the
  Trip Assistant's existing 📎 image-attach preview gained a second
  button, "📇 Import to Client Tracker," next to the existing Remove —
  reuses whatever image is already attached there (no second file
  picker) and hands it straight to Client Tracker's own pipeline via a
  new `window.__ctImportFromImage` export, the same "resolve internally,
  act, don't leak data across the boundary" shape as every other
  `window.__ct*`/`window.__ta*` export in this file, just reached from
  the opposite direction. The image is "spent" either way (asking a
  vision question about it, or importing it), so clicking either button
  clears `pendingImage` and hides the preview the same way sending
  a caption already did.
- **Drag-and-drop is real, not just a picker button** — dragging any
  file over the open Client Tracker panel (`#ct-panel`) shows a dashed-
  border highlight (`#ct-dropzone-overlay`, tracked via a drag-depth
  counter so a drag over a CHILD element inside the panel doesn't
  flicker the overlay on/off — a real gotcha with nested `dragenter`/
  `dragleave` events); dropping a non-image file shows a plain status
  message instead of attempting extraction. The toolbar's own
  "📷 Scan TMT" button (next to Add client/Qualifying Call, a distinct
  blue accent so it doesn't read as a third variant of those two) opens
  the same file picker + pipeline for anyone who'd rather click.
- **A real review-modal pop-out** (`#ct-scan-overlay`/`#ct-scan-modal`),
  added to the same shared open/close fade-transition CSS list every
  other "opened from within" pop-out in this file already uses, with a
  z-index (10500) above both `#ta-panel` (9999) and `#ct-overlay`
  (10000) since it can be triggered from either one and needs to sit on
  top regardless of which panel is actually open underneath.
- **Two real bugs caught by testing, not guessed at, both fixed before
  shipping.** (1) A new client created from a date-less row was pushed
  onto `ctClients` in memory but never actually persisted or re-rendered
  — `ctAddFollowUp()` is the only thing that calls `ctSaveData()`/
  `ctRender()`, and it's never reached for a row with no date, so the
  one remaining save path for "client created, nothing scheduled yet"
  was simply missing. Fixed by calling `ctSaveData()`/`ctRender()` once
  after the whole batch when at least one client was created but no
  follow-up was ever added (a no-op, cheap check, on any batch that DID
  add a follow-up, since `ctAddFollowUp` already covered that case).
  (2) The "+ New client" `<option>` was never actually marked `selected`
  even when it was meant to be the row's default choice — every row
  with no existing-client match was silently defaulting to "— Skip —"
  (the first option) instead of "+ New client" as designed, since
  nothing else in that row's `<select>` ever carried the `selected`
  attribute either. Fixed by threading the same `defaultIsNew` flag
  already computed for the checkbox/name-input visibility into the
  option-building function too.
- **A real test-harness gap found and fixed along the way, not an app
  bug**: this session's Node execution-harness (`dom_harness.js`) had
  always given `<select>`/`<input>` elements a plain, construction-time
  `value`/`checked`/`hidden`/`disabled` property — fine for this
  project's earlier tests (which only ever read those AFTER setting them
  directly via JS), but wrong here, where the review modal's rows are
  rendered fresh via `innerHTML` with `selected`/`checked`/`hidden`
  already baked into the markup string. `parseFragment()` calls
  `makeElement(tag)` FIRST (empty attributes) and only calls
  `setAttribute()` for each parsed attribute AFTERWARD — so a plain data
  property read at construction time can never see what the markup
  actually said. Replaced with live attrs-backed getter/setters for all
  four properties (matching real DOM semantics much more closely) —
  this is a general improvement to the shared test harness, not
  something specific to this feature, and the existing All-Clients-view/
  stuck-form/multi-follow-up Node harness tests were all re-run
  afterward with zero regressions.
- Verified with a real Node execution-harness test (23 checks) against
  the actual extracted Client Tracker source, using a fresh in-process
  session per scenario (also found and fixed a related harness-only
  gotcha: reusing the SAME static button object across multiple
  in-process IIFE reloads accumulates one click listener per reload,
  since nothing in this harness models real page unmount — switched to
  one clean session per scenario instead of chasing that down further,
  since it's not how a real browser page load ever behaves): the
  realistic multi-row TMT extraction end-to-end (matched/unmatched-with-
  name/no-name rows all defaulting correctly); the "new" option
  reveal-on-select wiring; Apply creating a follow-up on a matched
  client AND a brand-new client from the same batch; two rows for one
  not-yet-tracked name merging into a single client; a name-only/no-date
  row still creating the client; an unchecked row and a Cancel both
  correctly applying nothing; a code-fenced JSON response, a prose/
  unparseable response, an empty `[]` response, a missing API key, a
  thrown fetch error, and a `result.error` from the API — all handled
  with a clear message rather than a crash; an XSS probe across both the
  extracted name and task fields coming back fully inert; a malformed
  non-ISO date treated as "no date" rather than silently mis-scheduling
  something; and the concrete "works in unison" proof — an imported
  due-today follow-up showing up in `__ctGetTodoSummary()`, the exact
  data source Daily Tasks and the Daily Brief both already read. All 17
  `<script>` blocks parse; div-tag balance held (opens === closes) after
  the new markup.
- **Deliberately not built**: reading anything back OUT of TMT (this is
  one-way — screenshot in, tracker updated, nothing round-trips to
  TMT itself, consistent with this file's standing "no real TMT/
  Calendly API access from a static file with no backend" limitation
  documented elsewhere) and auto-detecting import intent from a caption
  typed alongside an attached image in Trip Assistant (a dedicated
  button was simpler and more predictable than guessing at free-text
  intent, and matches the "propose, don't guess" spirit everywhere else
  in this file).
- **Unverified live, and unusually so — this is the first AI extraction
  pipeline in this file whose entire value depends on how well Claude's
  vision actually reads a specific, real internal tool's UI**: whether
  the model reliably distinguishes a client-name header from a plain
  task row on a REAL TMT screenshot (as opposed to the two the DE
  already shared, which this session's prompt was written against),
  whether the `DD/MM/YY`→ISO conversion holds up across edge cases
  (single-digit days, a year boundary), how the drag-and-drop highlight
  actually feels in a real browser, and whether reviewing a dozen real
  rows in the modal is fast enough to be worth using over just manually
  adding follow-ups — none of this can be confirmed without a real
  screenshot, a real key, and a real click-through. Test next: drag a
  real TMT to-do screenshot onto the Client Tracker, check whether the
  extracted rows and matched clients look right, Apply a small batch,
  and confirm the result shows up correctly in both the client's own
  Follow-ups section and the Daily Tasks panel.

## Paste-to-attach for images (Sep 2026, unverified live)

Direct follow-up to the TMT import feature, once the DE saw the "Scan
TMT"/drag-drop screenshot in the Client Tracker: "the idea was to be
able to screenshot the information and then paste it with out having to
save it as a file" — explicitly asking for the same Ctrl/Cmd+V-to-attach
mechanic Claude's own chat box already has, rather than requiring
Save-as-file → pick-that-file first.

- **Trip Assistant's 📎 image attach**: the file-input `change` handler's
  FileReader logic was pulled out into a shared `attachImageFile(file,
  sourceLabel)` (used by both the file picker and the new paste path —
  one copy of the read/size-check/preview logic, not two). A `paste`
  listener on `#ta-input` checks `e.clipboardData.items` for an image
  MIME type; if none is present, does nothing and lets a normal text
  paste proceed completely untouched. A pasted image has no filename, so
  the preview label falls back to "Pasted image."
- **Client Tracker's TMT import**: same mechanic, reusing the already-
  built `ctReadImageFile`/`ctOpenScanReview` pipeline. Unlike Trip
  Assistant, there's no single obvious element to attach a `paste`
  listener to for "paste anywhere on this panel" (no dedicated input
  box) — listens on `document` instead, gated by checking
  `#ct-overlay.classList.contains('open')` before acting, matching the
  same "don't interfere with anything outside this panel" discipline the
  drag-and-drop drop-zone already uses.
- **Deliberately not built**: paste support inside the scan-review modal
  itself (e.g. pasting a second screenshot while reviewing the first) —
  wasn't asked for, and the modal is already a review-then-Apply step
  for one extraction at a time.
- Verified via syntax parsing (all 17 `<script>` blocks) and a full
  regression run of every existing Client Tracker Node harness test
  (TMT import, All-Clients-view, stuck-in-the-form fix, multi-follow-up)
  against the updated source — zero regressions, since this was pure
  event-listener wiring with no changes to any function signature those
  tests exercise. Div-tag balance unaffected (no new markup, only JS).
- **Unverified live, and genuinely can't be fully checked from here**:
  whether `document`-level `paste` actually fires in a real browser when
  nothing in the Client Tracker panel currently has keyboard focus (a
  real, known browser quirk — some browsers only dispatch `paste` to a
  focused, editable element) — if pasting silently does nothing, that's
  the first thing to check, and the fix would likely be focusing some
  element (or adding a `tabindex` to the panel itself) when it opens.
  Trip Assistant's version is lower-risk here since `#ta-input` is a
  real, commonly-focused textarea. Test next: copy a screenshot
  (Win+Shift+S / Cmd+Shift+4) and paste directly into both the Trip
  Assistant input box and the open Client Tracker panel.

## TMT import: a real paste conflict fixed, a wider prompt, and a Daily Tasks hookup (Sep 2026, unverified live)

Direct follow-up after the DE actually tried the paste feature: clicking
"📷 Scan TMT" opened a native OS file-browser dialog (a screenshot of
that dialog was sent) with "I need to be able to paste. Can this be
re-worked." A round of clarifying questions established the real ask —
"the new client card would be created or it locates an existing client
card and updates it... a prompt should pop up saying 'Do you wish to
update existing file'... if there is a task/to do associated with it,
add that to the follow up section and task list" — alongside a genuine
parsing failure the DE hit (a "Couldn't make sense of that image"
error), both addressed here.

- **A real, confirmed conflict bug, not a guess**: this guide already
  has its own page-wide "paste a screenshot to search" feature
  (`#guideSearchHint`'s `document.addEventListener('paste', ...)`,
  built long before Client Tracker existed) — global, unconditional, and
  registered EARLIER in the file than Client Tracker's own paste
  listener. Since listeners on the same target fire in registration
  order, and `preventDefault()` only blocks the browser's native paste-
  insert (not OTHER listeners on the same event), pasting a TMT
  screenshot while Client Tracker was open got claimed by the guide's
  own OCR search FIRST — likely why paste looked like it silently didn't
  work, pushing the DE toward the file-browser button instead. Fixed
  with a `ctPanelWantsPaste()` guard added to the guide's paste/drag/drop
  listeners (skip entirely when `#ct-overlay` is open) — establishing
  the rule that whichever surface is actually open owns paste, and the
  page-wide search shortcut is the fallback, not an automatic first
  claim. Trip Assistant's own paste-to-attach (`#ta-input`) gets the
  same protection a different way — `e.stopPropagation()` — since that
  listener fires in the event's target phase before ever reaching
  `document`.
- **Paste reliability**: `#ct-btn`'s click handler now focuses `#ct-search`
  the moment the panel opens — the one already-flagged real risk in the
  previous entry (some browsers only dispatch `paste` to a focused,
  editable element) now has a concrete, harmless target the instant the
  panel is open, not just whenever the DE happens to click into the
  search box first.
- **Discoverability**: the "📷 Scan TMT" button's tooltip now explicitly
  says "Paste (Ctrl+V), drop, or click to pick," and a new small
  `#ct-scan-hint` line under the toolbar ("📋 Tip: paste (Ctrl+V) a TMT
  screenshot anywhere in here to import it") advertises the gesture the
  same way the guide's own `#guideSearchHint` already does — paste was
  real but effectively invisible before this, with nothing on screen
  suggesting it existed.
- **The extraction prompt only ever described ONE TMT screen shape** (a
  to-do list grouped under client-name headers) — a screenshot of a
  SINGLE client's own profile/detail page (no list of separate task
  rows at all, which is what the DE's "couldn't make sense" screenshot
  was almost certainly showing) had no shape for the model to recognize,
  so it correctly-but-unhelpfully returned `[]`. Widened the same note
  to explicitly cover both cases — a to-do list (one row per task, as
  before) or a single client's profile page (exactly one row: `client`
  from the page's own name/title, `task` as a short one-line summary of
  whatever's relevant, `date` from any follow-up date shown) — while
  keeping the exact same `{client, task, date}` JSON schema, so none of
  the matching/review/Apply code needed to change at all, just what the
  model is told to look for.
- **Matched rows now read as an explicit update, not just a highlighted
  row** — direct answer to "a prompt should pop up saying 'Do you wish
  to update existing file'": rather than adding a second, separate
  confirm-dialog UI, the existing review row (which already IS the
  confirm step — nothing writes until Apply) now says "✓ matches
  existing client — will update their file" in its meta line when
  `matchedId` is set, instead of the more passive "mentioned: X." Same
  underlying flow, clearer that ticking Apply on that row means
  updating a real existing record.
- **Every applied row now also lands on the Daily Tasks checklist, per
  the explicit "add that to the follow up section AND task list" ask** —
  not just implicitly, via a due-today follow-up surfacing through
  `__ctGetTodoSummary()` (which already worked, but only for follow-ups
  due today specifically). `ctApplyScanReview()` now calls the already-
  exported `window.__dtAddTask()` for every row that actually resulted
  in a change (matched an existing client OR created a new one),
  labeled `"<client name>: <task text>"`, regardless of whether that row
  had a date — a skipped row, or one Daily Tasks hasn't loaded yet for
  (`window.__dtAddTask` missing), no-ops safely, same "best-effort,
  never block on it" spirit as this file's other cross-panel exports.
  The Apply summary toast now reports this count too ("Added 2 follow-
  ups. Created 1 new client. Added 3 to Daily Tasks.").
- **A second real bug found by testing this combination specifically,
  not the first attempt's fix**: the previous session's fix for "a
  date-less new client never gets saved" (`ctAddFollowUp` is the only
  thing that calls `ctSaveData()`/`ctRender()`, and it's skipped for a
  row with no date) only re-saved when `clientsCreated && !followUpsAdded`
  — meaning a MIXED batch (one row with a date, one without) could still
  lose the date-less client: the dated row's own `ctAddFollowUp` call
  saves `ctClients` at THAT moment, which can be before a later row has
  even pushed its new client onto the array, and the narrow `!followUpsAdded`
  condition then skips the catch-up save entirely since the batch
  clearly "did" add a follow-up (just not for the right row). Fixed by
  removing the narrow condition — `ctSaveData()`/`ctRender()` now run
  once, unconditionally, whenever `clientsCreated || followUpsAdded` (a
  cheap, idempotent call, skipped only when nothing changed at all).
- Verified with a real Node execution-harness test (9 new checks) against
  the actual extracted source, added to the existing 36-check scan-
  import suite (45 total, all passing): the matched-row copy change; the
  Daily Tasks push firing for both a matched-with-date row AND a new-
  client-with-no-date row in the SAME batch (the exact scenario that
  caught the save bug above — confirmed the client-side effects still
  happened correctly alongside the Daily Tasks push, not instead of it);
  a skipped/unchecked row correctly never reaching Daily Tasks;
  `window.__dtAddTask` missing entirely being a graceful no-op rather
  than a crash; and a single-object (profile-page-shaped) response
  correctly rendering as one real, matched row through the unchanged
  parsing/matching/render pipeline. Also re-ran the full pre-existing
  regression suite (All-Clients-view, stuck-in-the-form, multi-follow-up)
  with zero failures. All 17 `<script>` blocks parse; div-tag balance
  held (+1, the new `#ct-scan-hint` div).
- **Unverified live, same caveat as the paste-to-attach entry above,
  now narrower**: whether the widened prompt actually gets a real model
  to correctly tell a to-do list apart from a single client's profile
  page on genuine TMT screenshots (only tested here via the parsing
  pipeline with a hand-written stand-in response, not a real vision
  call), and whether the paste-conflict fix actually resolves what the
  DE hit — ask them to try Ctrl+V again with Client Tracker open, and
  separately confirm the guide's own "paste to search" feature still
  works normally when Client Tracker is closed (that path is
  unaffected, but worth a quick check since the same listener was
  touched).

## Three upgrades + two new features: editable scan rows, wider search, follow-up done state, bulk status, pipeline stats (Sep 2026, unverified live)

Direct follow-up to "can you give me a list of 3 upgrades to exsisting
functions and a 2 new features that would be great," then "okay great,
can you action all of that in appropriate order" — all five built,
tested, and shipped together in the order proposed.

- **1. Editable TMT scan-review rows.** The scan-import review modal
  (see the TMT-screenshot-import entries above) used to show each
  extracted row's task/date as plain static text — if the model read a
  task description or a date slightly wrong, there was no way to fix it
  short of cancelling the whole import and re-typing it manually later.
  `ctRenderScanRows()` now renders the task as a real text input
  (`data-row-task`) and the date as a real `<input type="date">`
  (`data-row-date`), both pre-filled from what the model extracted, both
  freely editable before Apply. `ctScanRowMeta()` no longer needs to
  describe the date in prose ("no date detected," etc.) since the date
  is now a real editable field, not narrated text — it only reports
  match status now ("✓ matches existing client — will update their
  file" / "mentioned: X"). `ctApplyScanReview()` reads the (possibly
  corrected) values straight from these inputs at Apply time instead of
  the original, unedited extraction — a malformed/non-ISO date the
  model got wrong now just renders as an empty date field the DE can
  fill in correctly, rather than silently carrying a bad date through
  to a real follow-up.
- **2. Follow-up "done" state, separate from delete.** Every follow-up
  entry (see the multi-follow-up feature above) previously had exactly
  one way to leave the list: delete it — meaning "I called them, we're
  done" and "I made a mistake entering this" were the same action, with
  no record either way. Each `client.followUps` entry gained a `done`
  boolean; a small ✓/↺ toggle button next to each entry's existing ✏️
  edit button (`ctToggleFollowUpDone`) flips it without removing the
  entry — a done entry shows struck-through and sorts to the bottom
  (`ctFollowUpsFor`'s sort now puts open entries first, then by date),
  so the list still reads "what's actually still open" at a glance
  without losing the history of what was scheduled and completed.
  `ctSyncNextFollowUp()` (the function that keeps the derived
  `client.nextFollowUp` field in sync — see the multi-follow-up entry
  above for why that field has to stay correct for the card/urgency
  grouping/Daily Brief/Daily Tasks to keep working) now only considers
  OPEN entries when picking the soonest date, so marking the current
  soonest follow-up done correctly promotes whichever open entry is
  next, exactly like deleting used to, without actually removing
  anything. `window.__ctApplyPatch` (the `propose_todo_update` AI tool's
  write path) was updated the same way — it now only ever touches the
  soonest OPEN entry when patching `nextFollowUp`, so the AI tool can't
  silently un-complete a follow-up the DE already marked done just by
  proposing a new date.
- **3. Client Tracker search widened.** The search box already matched
  name/notes/destination/phone/email; now also matches the TMT link
  field and the linked itinerary's title (when one is set) — a DE
  typing part of a TMT URL or an itinerary name they remember now finds
  the right client instead of coming up empty.
- **4. Bulk status change (new).** The "All Clients" view (grouped by
  pipeline status — see that entry above) gained a "☑️ Select" toggle,
  visible only in that view (hidden and reset the moment the DE
  switches back to the default follow-up-urgency view, since bulk
  selection is a roster-shaped operation with no clear meaning against
  an urgency grouping). Turning it on adds a checkbox to every card
  (`ctCardHTML`'s existing `opts` param gained a second flag,
  `bulkSelect`, alongside the pre-existing `statusSelect`); checking any
  card reveals a small floating bar (`#ct-bulk-bar`) showing the
  selected count, a status dropdown, and an "Apply to N" button.
  `ctApplyBulkStatus()` writes the new status to every selected client
  in one pass, saves once, and re-renders — same single-save-then-
  rerender shape as every other batch operation in this file (the TMT
  import's own Apply, for instance), not N separate saves. Selection
  resets on Apply, on switching away from "All Clients," and on
  toggling bulk mode off — never silently carries over into a state
  where it doesn't make sense.
- **5. Pipeline snapshot / stats view (new).** A new "📊" button in
  `#ct-head` opens a small read-only modal (`#ct-stats-overlay`) — total
  clients tracked, a tile grid of counts by pipeline status
  (`CT_STATUSES`), a tile grid of counts by lead temperature (Hot/Warm/
  Check Back Later/Cold, plus a "Not set" tile for anyone without one),
  and three "This Week" numbers reusing data this file already computes
  elsewhere rather than inventing new logic: overdue follow-ups and due-
  this-week follow-ups (via the same `ctGroupClients()` bucketing the
  default list view already uses) and a new "contacted this week" count
  (clients whose `lastContact` falls within the last 7 days). Read-only
  by design — a health-check glance at the whole book, not an editable
  view; clicking a tile does nothing, matching the request's own framing
  ("a lightweight pipeline/stats snapshot view," not a second way to
  filter). Added to the shared modal open/close fade-transition CSS
  list and the `@media print` hide-list, same as every other "opened
  from within" pop-out in this file.
- Verified with a real Node execution-harness test
  (`test_five_upgrades.js`, 40+ checks) against the actual extracted
  Client Tracker source, covering all five features together: editable
  scan-row task/date correction actually changing what gets applied,
  a corrected/cleared date correctly skipping the follow-up rather than
  applying a bad one; the widened search matching on TMT link and
  itinerary title (plus a regression check that email search still
  works, and that an empty search still shows everyone); the follow-up
  done toggle (marking done re-sorts and re-syncs `nextFollowUp` to the
  next open entry, reopening reverses it, the "Next" badge only ever
  lands on the first OPEN entry not just the first entry, and
  `__ctApplyPatch` correctly leaves a done entry alone rather than
  reopening it via a stale AI-proposed date); bulk status change (the
  Select toggle's visibility gated to the All Clients view, checkboxes
  rendering only in bulk mode, the bulk bar appearing/showing the right
  count, Apply updating only the selected clients and leaving everyone
  else untouched, and selection/mode resetting on a view switch); the
  pipeline stats modal's counts across a multi-status/multi-temp
  synthetic roster, the empty-roster message, and open/close; and an
  XSS probe across the new editable scan-row inputs (a `<script>` in a
  corrected task description, an `onerror=` payload in a corrected date
  field) coming back fully inert. Also re-ran every pre-existing Client
  Tracker Node harness test (TMT import — including the "malformed date"
  case updated to check the new editable date input comes back empty
  rather than the old prose message, which no longer exists — All-
  Clients-view, stuck-in-the-form, multi-follow-up, Daily Tasks, and the
  tabs-visibility check) with zero regressions caused by today's
  changes. All 17 `<script>` blocks parse; div-tag balance held exactly
  at 1724/1724, with span/button/select/label unchanged from their
  established baselines (the permanent 1-off span gap and 2-off button
  gap are both pre-existing prose false positives documented earlier in
  this file, not something today's work touched).
- **Deliberately not built**: a completion timestamp or "who marked this
  done" on a follow-up (this file doesn't track DE identity anywhere
  else either, so that would be new scope beyond what was asked); bulk
  operations beyond status (bulk delete, bulk lead-temp change) — not
  requested, and status was the one explicitly named; and any drill-
  down/filtering from the stats tiles themselves — it's a snapshot, not
  a second navigation surface, matching how the request itself framed
  it ("a lightweight... snapshot view").
- **Unverified live**: whether the editable scan-row inputs are obvious
  enough to actually notice and use mid-review (versus just accepting
  whatever the model extracted, the old default behavior), whether the
  done/reopen toggle's icon and strikethrough styling reads clearly at
  a glance next to the existing edit button, whether bulk-selecting and
  applying a status change to several clients at once feels smooth in a
  real browser, and how the pipeline stats tiles actually look/scan at
  a glance — none of this has been tried in a real browser from this
  environment. Test next: open a TMT scan review and correct a task/date
  before applying, mark a follow-up done and confirm the client's
  urgency grouping updates, switch to "All Clients," select a few
  clients and bulk-change their status, and open the new 📊 pipeline
  snapshot button.

## A real per-open greeting: "continuing, or something new?" (Sep 2026, unverified live)

Direct request: "open the assitant. Can it greet me with a nice message
and ask if its a new request or continuing on with a previous request?"

- **Deliberately a separate concern from `maybeSurfaceDailyBrief()`**,
  not a merge into it. The Daily Brief is a once-a-day WORK SUMMARY keyed
  off Client Tracker data (overdue/due-soon/hot leads) — it answers "what
  needs my attention today." This is a lightweight CONVERSATIONAL
  orientation keyed off the Trip Assistant panel's own persisted
  `convoHistory`/`taState` — it answers "are we still talking about the
  same thing?" Different question, different data source, so a second
  small function (`maybeGreetOnOpen()`) rather than reshaping the
  already-tested Daily Brief to do double duty.
- **Fires once per PAGE LOAD, not once per day.** A plain in-memory flag
  (`taGreetedThisLoad`), not a `localStorage` date key like the Daily
  Brief — opening and closing the panel repeatedly in one sitting
  (the ✨ button is a real open/close toggle, see the entry above) would
  make a "continuing or new?" question feel like a broken record if it
  re-asked every time; but a genuine page reload is exactly the moment
  it's honestly ambiguous whether the DE is picking up a thread or about
  to start something else, so a fresh load always asks again.
- **Time-of-day-aware, and the fork only appears when there's something
  to fork.** `new Date().getHours()` picks "Good morning!"/"Good
  afternoon!"/"Good evening!". Whether the greeting continues into the
  continue-or-new question is gated on `convoHistory.length > 0` — a
  genuinely fresh session (nothing said yet, matching the static welcome
  bubble already baked into the page) gets a plain "What can I help with
  today?" with no buttons, since asking someone to choose between "new"
  and "continue" when there's nothing to continue is just friction. When
  there IS prior conversation, the message names the active client if
  one's known (`taState.clientName`) and falls back to generic wording
  ("Continue where we left off") when a conversation happened but no name
  was ever extracted from it.
- **Two real buttons, not just a suggestion to type "new" or
  "continue."** "↩️ Continue [with Name]" simply posts a short
  acknowledgement ("Great — go ahead, I remember where we left off.") —
  no state change needed, since the persisted context is already active;
  it exists purely to close the loop the question opened. "🆕 Start
  something new" calls the exact same `resetClientContext()` the
  existing "Start new client" link in the context bar already uses (not
  a second copy of that reset logic) and confirms with "Starting fresh —
  who are we planning for?" Both buttons disable each other on click
  (matching `addPendingActionCard`'s existing Confirm/Cancel pattern),
  so a bubble can't be actioned twice in two different directions.
- **Restore-safe by construction, applying the lesson this file's own
  history already paid for.** The Daily Brief's Draft button and the
  client-name links were both found live-broken after a page reload
  because `persistState()` saves a bubble's rendered HTML but click
  listeners are JS-side attachments that don't travel with markup — the
  fix pattern (split "build the markup" from "wire the listeners," call
  the wiring half again across the whole restored list) is documented
  above and reused here verbatim: `wireGreetingButtons(container)` finds
  every `.ta-greet-actions` block in whatever container it's given and
  attaches listeners without touching the DOM, safe to call at creation
  time (one bubble) or from `restoreState()` (the whole restored list,
  including bubbles with neither kind of button — a no-op via
  `querySelectorAll` finding nothing). A stale greeting bubble surviving
  from a PREVIOUS page load is still genuinely clickable after a reload,
  not a dead leftover — clicking it is harmless even if stale (worst
  case: a redundant acknowledgement, or a context reset that's harmless
  to trigger twice).
- Verified with a real Node execution-harness test (`test_open_greeting.js`,
  loading the actual extracted Trip Assistant `<script>` block, not a
  paraphrase) across seven scenarios: a brand-new session gets the plain
  no-fork greeting with zero `.ta-greet-actions` rendered; opening the
  panel three times in one page load greets exactly once; a session
  restored with real prior `convoHistory` and a known client name asks
  the fork question, names the client, and clicking Continue disables
  both buttons and posts the acknowledgement; a session with prior
  `convoHistory` but no extracted client name still forks with the
  generic "Continue where we left off" wording; clicking Start Something
  New actually calls the real `resetClientContext()` (confirmed via the
  context bar losing its `shown` class, not by checking now-irrelevant
  stale text under a hidden element — `updateContextBar()`'s own
  pre-existing behavior only ever WRITES the context text when there's
  something to show, a real detail caught while writing this test, not a
  bug it introduced); an XSS probe (a `<script>` tag as the stored client
  name) renders fully escaped with no live tag reaching the DOM; and the
  restore-safety scenario itself — a real two-session simulated reload
  (matching this file's own established pattern for this exact bug
  class) confirming a persisted greeting bubble's Continue button still
  fires correctly after a reload, AND that the new page load still
  greets fresh on its own separate `__taOpenPanel()` call. Also re-ran
  every pre-existing Trip Assistant/Client Tracker Node harness test in
  the suite with zero regressions caused by this change. All 17
  `<script>` blocks parse; div-tag balance held (+1, matching the new
  `.ta-greet-actions` wrapper), button balance moved +2/+2 (the two new
  buttons), matching the established gaps exactly with no new imbalance.
- **Deliberately not built**: merging this into the Daily Brief's own
  opening line to avoid two "hello"-shaped bubbles appearing back to
  back on the first open of the day (this greeting, then separately the
  Daily Brief's own "Hello — here's your day at a glance") — that
  coupling would mean touching the Daily Brief's already-tested logic
  for a style nit rather than what was actually asked, and it's not
  fully clear yet whether that reads as redundant or just as two
  distinct, useful things being said in sequence.
- **Unverified live**: whether seeing two greeting-shaped bubbles in a
  row (this one, then the Daily Brief) on the first open of the day
  feels natural or repetitive, whether the time-of-day wording lands
  right, and whether the Continue/Start-something-new buttons read
  clearly at a glance next to each other — none of this has been seen in
  a real browser from this environment. Test next: reload the page after
  a real conversation with a named client, open the assistant, and
  confirm it asks the right question and both buttons do what they say;
  also check what it feels like on a totally fresh browser profile with
  no prior conversation at all.

## Auto-open on page refresh + today's Daily Tasks folded into the Daily Brief (Sep 2026, unverified live)

Direct follow-up to the per-open greeting above: "can we give the
assistant the ability to open when the page refreshes and ask how it can
help. Look at todays task, heres the follow ups for today, any helpful
information."

- **The panel now opens itself on every page load, no ✨ click needed.**
  `openTripAssistant()` itself is completely unchanged — the only new
  code is a `document.addEventListener('DOMContentLoaded', () =>
  openTripAssistant())` call right after the button's own click wiring.
  Reusing the exact same function a manual tap already calls means
  there is exactly one "what happens when this panel opens" code path,
  not a second parallel one to keep in sync — the "ask how it can help"
  half of the request is just `maybeGreetOnOpen()` (built in the
  previous session entry) firing on page load instead of on a click.
- **Deferred to `DOMContentLoaded`, not fired at script-eval time, for a
  real reason, not just caution.** This file is one long HTML document
  with 17 inline `<script>` tags executing in document order as the
  parser reaches them. The Trip Assistant's own script tag comes FIRST,
  well before the Client Tracker and Daily Tasks script tags further
  down — but `openTripAssistant()` → `maybeSurfaceDailyBrief()` reads
  `window.__ctGetTodoSummary`/`window.__dtGetSummary`, both exported by
  those LATER scripts. Calling `openTripAssistant()` directly at the
  point this script itself evaluates would run before either export
  exists — `maybeSurfaceDailyBrief()` already no-ops gracefully when an
  export is missing, so this wouldn't crash, it would just silently show
  an empty/greeting-only open on every single page load, which is
  exactly the "looks fine in the simple case, quietly wrong in the real
  one" failure shape this file's own history keeps warning about (see
  the itinerary-modal DOM-lookup bug and the Draft-button reload bug
  elsewhere in this file). `DOMContentLoaded` is guaranteed to fire only
  once the ENTIRE document — every inline script included — has run,
  regardless of where in the file the listener was registered, so by the
  time this fires both exports are guaranteed to already exist.
- **"Look at todays task" — the real gap this closed**: the Daily Brief
  already covered Client Tracker follow-ups (overdue/due-this-week/hot
  leads) but had zero awareness of the separate Daily Tasks checklist
  (Check emails, Check leads in TMT, etc. — see "Daily Tasks" above) even
  though that panel already existed. `maybeSurfaceDailyBrief()` now also
  builds a `☑️ N on today's checklist` line from
  `window.__dtGetSummary()` — the fixed routine items plus any ad-hoc
  custom task, both filtered to `!done` — using the same `listLine()`
  helper (and the same 5-name-then-"+N more" truncation) the existing
  overdue/due-soon/hot-lead lines already use, so it reads as one more
  line in the same format, not a bolted-on second block. Independently
  gated on `window.__dtGetSummary` existing (try/caught separately from
  the top-level `window.__ctGetTodoSummary` gate) so a Daily Tasks
  script that hasn't loaded degrades this one line, not the whole brief.
- **Deliberately does NOT re-list today's follow-ups a second time under
  the checklist heading**, even though Daily Tasks' own panel already
  has its own "Follow-ups Due Today" section
  (`dtGetDueFollowUps()` — overdue + due-exactly-today). That bucket
  overlaps with (is a subset of) the Daily Brief's existing overdue/
  due-this-week lines; re-listing the same names under a second heading
  in the same message would just be the same information twice, not new
  information. "Here's the follow-ups for today" is already answered by
  the lines that were already there.
- **The "clean day, stay silent" rule now genuinely considers the
  checklist too, not just follow-ups** — the early return moved to after
  the checklist line is built and folded into the same `lines` array, so
  a day with zero flagged clients but real open checklist items still
  shows the brief (this is now the common case on most days, since the
  checklist resets every morning), and a day where literally everything
  — follow-ups AND the whole checklist — is clear correctly stays
  silent, unchanged from before.
- **"Any helpful information"** is handled by the brief's existing
  closing line, lightly reworded to mention the new capability: "Just
  ask, and I can draft a message, pull up anyone's details, or check
  something off your list" — not a new data source, since the brief
  already surfaces everything this file currently has ambient data for
  (follow-ups, hot leads, and now the daily checklist); anything beyond
  that is already reachable by just asking, which is the whole point of
  this panel being conversational.
- Verified with a real Node execution-harness test
  (`test_autoopen_refresh.js`, loading the actual extracted Trip
  Assistant, Client Tracker, AND Daily Tasks `<script>` blocks together,
  in real file order, with a working `document.addEventListener`/manual
  `DOMContentLoaded` fire — the earlier reload tests' `addEventListener`
  stub was a true no-op, which doesn't exercise this feature at all, so
  this test file upgrades that piece specifically) across 15 checks: the
  panel is confirmed still CLOSED immediately after script evaluation
  and only opens once `DOMContentLoaded` is actually fired (proving the
  defer is real, not a no-op); both the greeting and the daily brief
  post with no simulated click at all; the brief shows up on an
  otherwise-clean follow-up day purely because of open checklist items,
  and names a real checklist item; checking off every fixed item AND
  having no custom tasks correctly goes silent again; an ad-hoc custom
  task added earlier still surfaces by name; Daily Tasks' script being
  entirely absent doesn't throw and the rest of the brief (a real
  overdue follow-up) still renders correctly with no checklist line;
  and an XSS probe through a custom task's text comes back fully
  escaped. Re-ran the full pre-existing test suite (all-clients-view,
  form-unstick, followups, scan-import, tabs-visibility, daily-tasks,
  five-upgrades, draft-reload, readaloud-reload, draft-button, and the
  per-open-greeting test from the previous entry) with zero regressions
  caused by this change — the same two pre-existing test-harness
  artifacts already documented above (`test_tabs_visibility.js`'s two
  known non-bugs, `test_draft_button.js`'s one known async-timing
  assertion) are unchanged and unrelated. All 17 `<script>` blocks
  parse; tag balance unchanged from the previous entry (no new markup —
  this was pure JS logic plus one wording tweak in an existing template
  string).
- **Deliberately not built**: any way to opt out of the auto-open (a
  "don't do this again" setting, or only auto-opening once per day
  instead of every refresh) — not asked for, and adding a toggle for
  behavior that was requested outright would be solving a problem that
  hasn't actually been reported yet.
- **Unverified live, and this is a real behavioral change worth watching
  closely**: whether auto-opening a full panel over the guide on every
  single page load feels right in practice, especially during normal
  browsing/reloading that has nothing to do with the assistant, versus
  feeling intrusive; whether the checklist line reading "☑️ 8 on today's
  checklist: Check emails, Check leads in TMT, ..." every single morning
  (since the checklist starts fully unchecked each day) becomes visual
  noise once the novelty wears off; and whether DOMContentLoaded
  reliably fires the auto-open cleanly in a real browser against the
  real 14,000-line file's real load order — none of this has been seen
  outside this environment. Test next: do a genuine hard refresh of the
  page and confirm the panel opens on its own, greets appropriately, and
  the brief correctly reflects both today's follow-ups and today's
  checklist; also worth deliberately checking off a few checklist items,
  refreshing again, and confirming the brief's checklist line shrinks to
  match.

## Design decisions to preserve, not "helpfully" change

- Outlook is read+draft only, never send. The Client Tracker's "Add to
  Outlook" button follows the same rule in its push-only form: it only
  ever creates a new event, never reads, edits, or sends.
- Kosher is never inferred from "vegetarian" — only Zerta (Barcelona) is
  tagged kosher-certified; unqualified "Jewish" interest is treated as
  heritage-site interest, not a dietary assumption.
- Official KT itineraries are the anchor; personal recommendations are always
  explicitly flagged as separate, never blended in unmarked.
- The live AI never writes to the Client Tracker directly — `propose_todo_update`
  only ever prepares a change; the DE's explicit Confirm tap on the card
  it produces is the only thing that actually calls `window.__ctApplyPatch`.
  Same "draft only, DE confirms" principle as the Outlook rule above,
  extended to the one other place this file lets an AI touch real data.

## Still open (from HANDOFF, unresolved as of the move here)

- Voice input (listening) is confirmed blocked in the in-app preview iframe
  (mic permission denied at the hosting-frame level). Untested: whether a
  "pop out to full tab" view gets normal top-level mic permissions.
- `TA_DRIVE_MCP` (Google Drive MCP) — removed (Aug 2026, see "Daily Brief"
  above) once it was confirmed to have zero remaining callers: the
  "Polish an itinerary → email" chip it belonged to was already retired
  in the conversational redesign, and nothing else in the file ever used
  it. If Drive access is wanted again later, it needs to be rebuilt from
  scratch (the MCP connector pairing pattern is still documented above,
  just not the constant itself anymore).
- The round-cap-to-7 fix and personal-recommendations layer are logic-tested
  but not yet observed end-to-end in a live model response in the actual app.
- **Root cause of the Outlook MCP failures confirmed (Aug 2026)**: the
  DE's actual error — `Authentication error while communicating with MCP
  server. Please check your authorization token.` — confirmed the `mcp_
  servers` connector needs its own Microsoft OAuth `authorization_token`,
  which this file has no way to obtain without a hosted OAuth redirect
  endpoint. Client Tracker's "Add to Outlook", the Trip Assistant's
  "Schedule follow-up" button, and its "Draft in Outlook" button are all
  now fixed the same way — a pre-filled Outlook Web compose deep link
  (`/calendar/.../compose` or `/mail/.../compose`) opened in a new tab
  instead of the broken `outlook_create_event`/`outlook_create_draft`
  MCP calls. No OAuth, no server, one extra click (Save/Send stays with
  the DE) where the MCP version would've been zero. Each site now shows
  a `addMsg('bot', ...)` confirmation naming the popup-blocked case
  explicitly (`window.open` returns `null` if a popup blocker ate it)
  instead of silently doing nothing. Logic-tested in Node: the schedule
  button's date math (day offset, month-boundary crossing, "0 days" =
  today not tomorrow) and both deep-link URLs' encoding — all correct.
  **Reading the calendar has no equivalent workaround, and is no longer
  attempted at all.** A deep link can only open a compose screen — it
  can't read data back out of Outlook, unlike the *write* actions above.
  The "📅 Check follow-ups due" chip that used to attempt this was
  already retired in the conversational redesign; its ambient
  once-a-day equivalent (`runFollowUpCheck()`/`TA_CALENDAR_MCP`) was
  removed for real in the Daily Brief consolidation (Aug 2026, see
  above) once it was confirmed to be a guaranteed-to-fail live API call
  every single day for zero benefit. Fixing calendar *read* access for
  real still needs the actual OAuth infrastructure (Azure AD app +
  hosted redirect endpoint) described above — nothing shortcuts that.

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
- As of the BYOK migration, the live-AI layer can be tested by opening the
  file directly in any browser (`file://` is fine) and entering a real
  Anthropic API key via the Trip Assistant's ⚙️ Settings panel — the old
  "must be a live claude.ai artifact" requirement no longer applies. Never
  put a real key in a git commit, a chat message, or anywhere other than
  that Settings input.
