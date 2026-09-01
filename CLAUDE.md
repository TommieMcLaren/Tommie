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
- `TA_DRIVE_MCP` (Google Drive MCP) is wired and now structurally correct
  (see "Live-AI upgrade" below) but still never successfully test-called live.
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
  **Still broken, and can't be fixed with this same trick**: the
  "📅 Check follow-ups due" chip's `runFollowUpCheck()` also calls
  `TA_CALENDAR_MCP` (to *read* the calendar via `outlook_calendar_search`,
  not create anything) and hits the identical auth error — but a deep
  link can only open a compose screen, it can't read data back out of
  Outlook, so this one has no equivalent workaround. Fixing it for real
  needs the actual OAuth infrastructure (Azure AD app + hosted redirect
  endpoint) described above.

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
