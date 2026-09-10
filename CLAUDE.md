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

## Client Tracker: passport info + additional travelers (Sep 2026, unverified live)

Direct request: "Can you add in a spot in a client profile to add their
passport information and a + 'Add Additional Traveler' so I can add all
their information as well."

- **Primary client's own passport fields are direct fields on the client
  record** (`passportName`, `passportDob`, `passportNationality`,
  `passportNumber`, `passportExpiry`) — same convention as phone/email/
  destination elsewhere on the record, not a nested object. Lives in a
  new collapsible `<details class="ct-form-section" id="ct-sec-passport">`
  (🛂 Passport & Travelers) in the Add/Edit form, placed right after
  Client Details — same `.ct-form-section`/`.ct-section-badge` pattern
  every other intake section already uses, so it inherits Qualifying
  Call mode's force-open behavior and the normal open/collapse reset in
  `ctCloseForm()` for free, no special-casing needed.
- **`client.travelers`** — an array of `{id, name, dob, nationality,
  passportNumber, passportExpiry}` for everyone ELSE on the booking
  (spouse, kids, whoever). Kept as a genuinely separate array rather than
  folding the primary client in as "traveler #1" — the primary client's
  own fields already have a stable home (direct fields, matching every
  other single-value field on the record), and a client record always
  represents one primary contact either way; travelers are the "also
  booking with them" list.
- **"+ Add Additional Traveler" appends a blank row** (name/DOB/
  nationality/passport number/expiry, plus a ✕ remove button), rendered
  by `ctRenderTravelerFormRows()` from a new `ctFormTravelers` buffer —
  seeded from `client.travelers` when the form opens, read back into the
  saved record on Save. **The one real correctness risk this design had
  to account for, and did**: re-rendering the traveler list (on add or
  remove) rebuilds the DOM from `ctFormTravelers`, which would silently
  revert every OTHER row to stale data if the DE had just typed into one
  without that row's edits being captured first. `ctSyncTravelersFromDom()`
  reads the live `.value` of every existing row's inputs back into the
  buffer immediately before any add/remove-triggered re-render — verified
  directly in testing (see below), not just reasoned about.
- **A blank row added by accident (clicked "+ Add," never filled in) is
  dropped on Save**, not persisted as a junk traveler record — `ctHandleSave()`
  filters `ctFormTravelers` to rows where at least one field has real
  content, matching this file's standing "don't save what's empty"
  discipline (the same rule the intake questionnaire's optional fields
  already follow).
- **Profile view**: the primary client's passport rows render via the
  existing `ctRow()`/`ctSection()` helpers (only filled fields show, the
  whole section vanishes if there's nothing at all — for either the
  primary client or every traveler); each additional traveler gets its
  own `.ct-traveler-block` sub-heading (the traveler's name, or a
  numbered "Traveler N" fallback if the name was left blank) with its
  own filtered rows underneath. Dates render through the same
  `ctFormatDate()` every other date field in this profile already uses,
  not the raw ISO string.
- **Section badge is a special case, not the generic field-count
  reducer** the other intake sections use — Passport & Travelers has two
  different kinds of "filled" (the primary client's own fields, and how
  many traveler records exist), so `ctUpdateSectionBadges()` computes it
  separately: "5 filled · 2 travelers" rather than trying to force both
  numbers through one counter.
- Verified with a real Node execution-harness test
  (`test_passport_travelers.js`, 33 checks) against the actual extracted
  Client Tracker source: opening an existing client with saved passport
  info and one traveler correctly populates every field, including the
  dynamically-rendered traveler row's inputs (this required upgrading
  the test's own `getElementById` stub to search the real rendered tree
  rather than a flat registry — a flat-registry stub can't find elements
  created via `innerHTML`, which is exactly how the traveler rows
  render, and would have silently masked a real bug behind a fake
  "element not found" reading); adding a second traveler after editing
  the first one's DOB proves the sync-before-rerender fix actually works
  (the edit survives); removing a blank third row leaves the other two
  intact; Save persists the primary passport fields and every real
  traveler correctly, including an edited value; a blank accidental
  traveler row is dropped on Save while a genuine new client with real
  data still saves correctly; a client with zero passport/traveler data
  opens cleanly with an empty badge and an explicit "No additional
  travelers yet" state; the profile view renders both the primary
  client's passport rows and each traveler's own block, including the
  "Traveler N" fallback heading for a traveler saved with no name; and
  an XSS probe across the primary passport nationality field AND a
  traveler's own name/nationality fields (`<script>`, an `onerror=`
  payload) comes back fully inert in the rendered profile, with the
  form correctly still round-tripping the raw stored value back into a
  real `.value` (not re-injected as HTML) when reopened for editing.
  Full pre-existing regression suite re-run with zero failures caused by
  this change. All 17 `<script>` blocks parse; div/span/button/select/
  label tag balance moved by exactly the new static + templated markup
  added, each maintaining its previously-established gap (span's
  permanent 1-off, button's permanent 2-off) with no NEW imbalance.
  Along the way, added a `details`/`summary` tag-balance check to this
  project's own health-check routine for the first time (this session
  added a new `<details>` section, worth verifying) — it surfaced one
  pre-existing false positive (a code comment mentioning "a `<details>`
  section" in prose, the same false-positive shape already documented
  for `<span>`/`<button>` elsewhere in this file's history), reworded
  away rather than left as new noise for a future health check to
  re-discover.
- **Deliberately not built**: any validation on passport number format
  or expiry-date warnings (e.g. "expires within 6 months of travel") —
  not asked for, and this file has no authoritative source for what a
  valid passport number looks like across the nationalities a KT client
  might hold; a wrong validation rule would be worse than none. Also not
  built: exporting passport/traveler info into the itinerary document or
  Outlook deep links — those already have their own established field
  sets (see the itinerary-document-export and Outlook-deep-link entries
  above) and weren't part of what was asked here.
- **A note on sensitivity, not a blocker**: passport numbers and DOBs
  are meaningfully more sensitive than the phone/email/notes this file
  already stores, but they land in the exact same place — this browser's
  `localStorage`, unencrypted, same as everything else in the Client
  Tracker (see the existing backup/restore feature's own plain-JSON
  export for the same fact stated about the whole record). Nothing new
  about this file's security posture was introduced; worth knowing
  before typing in a real passport number, not a reason to have built
  this differently without being asked to.
- **Unverified live**: the collapsible section's field layout, the
  traveler row's remove-button placement, and — most worth checking —
  the actual add/remove-then-retype interaction feel in a real browser
  (the sync-before-rerender fix is logic-tested thoroughly above, but
  hasn't been felt out by an actual DE clicking through it) haven't been
  seen outside this environment. Test next: open a client, add two
  additional travelers, fill in real passport info for each, remove one,
  and confirm the remaining one's data is intact before and after Save.

## Client Tracker: navigating, tracking, and storing client information (Sep 2026, unverified live)

Direct follow-up to "suggest a really seamless function for navigating,
tracking and storing client information... be thorough," then "go ahead
and action all of this." Seven pieces, built in the priority order
proposed: storage safety first (trash/undo, backup reminder), then
tracking (status history + a unified activity timeline, tags), then
navigation (recently viewed, keyboard nav, a global quick-switcher).

- **Trash / undo.** `ctHandleDelete()` no longer drops a client outright
  — it moves the record into a separate `kt-client-tracker:trash:v1`
  array (stamped `deletedAt`), leaving `ctClients` itself exactly as
  clean as it always was (search, grouping, every AI tool needed zero
  changes). A new 🗑️ button in the header opens a "Recently Deleted"
  modal listing each trashed client with a real "↺ Restore" and a
  "Delete permanently" (behind its own confirm), plus how many of the 30
  days are left before `ctPurgeOldTrash()` — run on every load — removes
  it for good, silently, with nothing to confirm (that's the whole point
  of the window already having passed). The delete confirm dialog still
  says "This can't be undone" on purpose — a 30-day safety net is
  insurance for a mistake, not a feature to lean on, so Delete should
  still feel final in the moment.
- **Backup reminder.** `ctExportBackup()` now stamps
  `kt-client-tracker:last-backup:v1` with today's date every time it
  actually runs. A new `ctMaybeNudgeBackup()` — checked once whenever the
  panel opens, same once-a-day dedup shape as this file's other ambient
  checks — shows a dismissible gold banner ("It's been N days since your
  last backup...") once there's real data at risk (at least one client
  on file) and either nothing's ever been exported or it's been more
  than 14 days. "📥 Back up now" runs the real export and clears the
  banner immediately; dismissing just hides it for today without
  resetting the clock, so a real 14-day gap still gets flagged tomorrow.
  An empty roster never nudges — there's nothing to lose yet.
- **Status-change history + a unified activity timeline.** The real gap
  named in the original proposal: a card only ever showed the CURRENT
  status, with no record of when it got there. `ctHandleSave()` now
  appends `{status, changedAt}` to a new `client.statusHistory` array
  whenever the status field actually changes on an edit (not on every
  save — editing an unrelated field shouldn't fabricate a status-change
  event), and seeds a first entry plus a real `createdAt` timestamp when
  a client is created. A new "📜 Activity" button in the profile header
  opens a READ-ONLY modal merging status changes, drafts, notes, and
  follow-ups into one chronological feed — genuinely the single most
  valuable piece of this whole batch, since a client's history used to
  be split across three separate sidebar sections with no single place
  that read "here's everything, in order." Deliberately does NOT touch
  or replace the existing Notes/Follow-ups/Drafts sections — those stay
  exactly as they are, since they're what the DE actually acts through
  (add a note, mark a follow-up done, reopen a draft); the timeline is
  purely "show me everything," so none of that already-tested
  interactive UI had to be rebuilt or put at risk. Two disclosed,
  real limitations rather than silently-assumed correctness: a follow-up
  has no separate "added at" timestamp, so its own scheduled/target date
  is used as its timeline position; and a note's timestamp comes from
  `ctTimestampedNote()`'s `toLocaleString()` text (not a real ISO
  string), re-parsed via `new Date(label)` to sort it — reliable in the
  real browsers this file targets, not a spec-guaranteed round trip. An
  event whose date can't be parsed at all sorts to the bottom rather than
  crashing or vanishing.
- **Tags.** A plain comma-separated `Tags` field next to Lead Category in
  the Add/Edit form — the simplest UI that stores the real shape,
  matching this file's own established call elsewhere rather than a
  dedicated pill-input widget. Parsed into `client.tags[]` on save,
  trimmed, and deduped case-insensitively (so "VIP" and "vip" typed on
  two different calls collapse to one tag, keeping whichever casing was
  seen first). Rendered as small pills on both the card and the profile
  header; folded into the existing search box rather than a second
  filter control, so typing a tag fragment finds the right client the
  same way typing part of a phone number already does.
- **Recently viewed.** A short, most-recent-first row of up to 5 names
  above the list (`kt-client-tracker:recent:v1`), shown only once the
  roster is bigger than 3 clients — a tiny book has no real need for a
  shortcut back to something already one glance away. Updates on every
  `ctOpenDetail()`; re-viewing an already-recent client moves it to the
  front rather than duplicating it. Correctly hides while a profile is
  open (nothing to jump to from inside a profile) and — a real bug
  caught while testing, not by inspection alone — correctly REBUILDS
  itself on "← Back to list," not just re-shows whatever it held before;
  the first implementation only restored visibility on close without
  re-rendering content, so the client just viewed would silently never
  appear until some unrelated list re-render happened to run first.
- **Keyboard nav in the list.** Arrow keys move a highlighted card
  (`.ct-kbd-focus`), Enter opens it — scoped tightly to when the panel is
  open, the list itself (not the form, a profile, or the quick-switcher)
  is showing, and focus isn't actually inside a text input/select, so
  typing in the search box is never hijacked.
- **Global quick-switcher (Ctrl+Shift+K).** Jump to any client's profile
  from anywhere in the app, not just from inside an already-open Client
  Tracker — Ctrl+K and `j`/`k` are already the guide's own full-text-
  search/section-nav bindings, so this deliberately uses a different
  chord rather than fighting over an existing one. Fuzzy-matches
  (name-starts-with ranked above name-contains, capped at 8), arrow keys
  move the active result, Enter opens it via the same
  `window.__ctOpenClientProfile` every other "jump to this client" entry
  point in this file already uses (opens the panel and the profile in
  one call), Escape or a backdrop click closes it.
- **A real, shared test-harness bug found and fixed while building this**
  — not an app bug, but worth recording since it could have silently
  masked one: `dom_harness.js`'s `classList.toggle(class)` only ever
  supported the one-argument flip form. This file's own real app code
  (the keyboard-nav highlight, the lead-temp tab active state, and now
  several new features) uses the standard two-argument
  `toggle(class, force)` form, where `force` means "ensure present/
  absent," not "flip." Ignoring that second argument produced correct-
  looking output for a single toggle call but corrupted state across a
  loop of several — confirmed directly: a second ArrowDown in the
  keyboard-nav test left BOTH cards without the highlight class instead
  of moving it, exactly the failure shape a caller of the real two-arg
  API would hit. Fixed in the shared harness so this file's own test
  suite doesn't keep re-discovering the same underlying bug shape by
  accident, one feature at a time.
- Verified with a real Node execution-harness test
  (`test_nav_track_store.js`, 60+ checks) against the actual extracted
  Client Tracker source: the full trash lifecycle (delete → moves to
  trash, not gone → restore puts it back → permanent purge removes it
  for good → an entry older than 30 days auto-purges on load → cancelling
  the delete confirm leaves the client untouched); the backup nudge's
  full decision table (no clients, never backed up, backed up today,
  backed up 20 days ago, the once-a-day dedup, "Back up now" actually
  stamping a fresh date and hiding the banner, dismiss hiding it without
  touching the date); tags (parse/dedupe/trim, card and profile pills,
  search-by-tag, round-tripping back into the form on edit); status
  history (createdAt + a seeded first entry on creation, no duplicate
  entry on an unrelated-field edit, a real entry on an actual status
  change) and the activity timeline (merges status/follow-up/note events,
  an empty-state message, the title naming the client); recently viewed
  (shows only past 3 clients, hides while a profile is open, re-viewing
  moves to front without duplicating, caps at 5, a chip actually opens
  the right client, and the reported-shape "Back to list doesn't refresh
  it" bug specifically); keyboard nav (ArrowDown highlights and clamps at
  the last card rather than wrapping, Enter opens the highlighted card,
  and it correctly does nothing while typing in search or while a
  profile/form is open); and the quick-switcher (opens from a closed
  panel, startsWith-ranked matching, the alphabetical empty-query list,
  the no-matches message, Enter opening the active result and closing
  the switcher, both uppercase/lowercase K, Escape). XSS probes across a
  trashed client's name, a tag, and a timeline-rendered note all came
  back fully escaped. Full pre-existing regression suite re-run with
  zero failures caused by this change (the same two known-baseline
  artifacts — `test_tabs_visibility.js`'s two non-bugs,
  `test_draft_button.js`'s one async-timing check — are unchanged and
  unrelated). All 17 `<script>` blocks parse; div/span/button/select/
  label/details tag balance moved by exactly the new markup added, with
  the established span/button false-positive gaps unchanged and no new
  imbalance.
- **Deliberately not built**: bulk restore from trash, exporting trash
  alongside the regular backup (a backup represents the active roster;
  recently-deleted is a separate, shorter-lived net — conflating the two
  would make an old backup accidentally resurrect something meant to
  stay gone), tag-click-to-filter as a second UI beyond the search box,
  and a "who changed this status" identity on status-history entries
  (this file doesn't track DE identity anywhere else either). None of
  these were part of what was asked, and each is a real, separable
  follow-up if wanted later.
- **Unverified live, and this is a lot of new surface area at once**:
  whether 14 days is the right backup-nudge threshold and 30 the right
  trash window in practice, how the activity timeline reads against a
  real client with months of mixed history, whether Ctrl+Shift+K is
  discoverable without documentation (there's no on-screen hint for it
  yet, unlike Ctrl+K's own placeholder text), and whether keyboard nav's
  highlight ring is visible enough at a glance — none of this has been
  seen in a real browser from this environment. Test next: delete and
  restore a client, let the backup nudge appear (or force it by editing
  `kt-client-tracker:last-backup:v1` in dev tools), add a tag and search
  for it, open a client's Activity timeline, change a client's status a
  couple of times and confirm the timeline reflects it, and try
  Ctrl+Shift+K from outside the Client Tracker entirely.

## Three new "brain" tools: full client-profile read, real-data grounding check, honest price reference (Sep 2026, unverified live)

Direct follow-up to "what function do you believe is missing" — the
answer, on reflection, wasn't more UI, it was reasoning capability: the
live AI's tool set could read a to-do-shaped client summary and propose
narrow patches, but couldn't answer a detail question about a client
grounded in the real record, couldn't check a specific hotel/restaurant/
tour name against real data before stating it, and had no way to answer
a pricing question with a real number. Three new tools close those three
gaps, all read-only (or reference-only), no new write paths.

- **`get_client_profile`** — reads a client's FULL Client Tracker record
  (trip vision, budget, hotel/dining/transfer prefs, dietary
  restrictions, tags, linked itinerary resolved to its real title, most
  recent note) instead of the todo-shaped summary `get_todo_list`
  returns. Reuses the already-exported `window.__ctFindClientByName`
  (already returns the full client object — no new Client Tracker export
  needed) rather than building a second lookup path. **Deliberately
  excludes passport numbers, dates of birth, and every additional
  traveler's own passport details** — it only ever reports whether
  passport info is on file and how many travelers, never the actual
  sensitive values. There's no legitimate reason for the model to hold a
  real passport number in its context (it can't act on it, and repeating
  it back in a chat reply or a drafted email would be a real exposure),
  so this is enforced by the tool itself rather than trusted to a system
  prompt instruction alone.
- **`verify_recommendation`** — the tool that actually answers the
  original "what's missing" conversation's stated #1 worry. The existing
  `looksLikeHallucinatedToolCall` safety net only catches the model
  narrating a FAKE tool call as text; it does nothing for a hallucinated
  hotel/restaurant/tour name recalled from general training data and
  presented inside an otherwise-real, successful response. This tool
  lets the model self-check a specific name against the real
  `QB_HOTELS`/`QB_RESTAURANTS`/`QB_TOURS` data for a city before stating
  it as confirmed — the system prompt now explicitly instructs it to
  call this for any name that didn't come directly from a `get_city_data`
  result earlier in the same turn. Matching is deliberately tolerant
  (case-insensitive, substring either direction) so a minor paraphrase
  doesn't false-flag a real match — the point is catching a genuinely
  invented name, not penalizing imperfect wording.
- **`get_price_reference`** — answers "roughly what would this cost"
  with REAL numbers instead of a guess or a punt. There is no per-hotel/
  per-night pricing table anywhere in this file (`QB_HOTELS` only has
  `name`+`tier`, no dollar amounts) — so a literal computed quote was
  never an honest thing to build. What DOES exist is real per-person
  pricing on every actual bookable `KT_LIVE_ITINERARIES`/
  `PERSONAL_ITINERARIES` entry, already partially surfaced by
  `find_matching_itinerary` when there's a good match. This tool answers
  the pricing-shaped question directly, reusing the exact same
  `scoreItinerariesByCities` scoring `find_matching_itinerary` already
  uses (so the two tools can never disagree about which itineraries
  count as similar), explicitly framed in both the tool description and
  its own output as REFERENCE pricing from real comparable trips, never
  a computed total for the specific request. When nothing shares real
  city overlap, falls back to day-count proximity across every priced
  itinerary — honestly disclosed as "not comparable by destination" —
  rather than returning nothing at all.
- All three are wired the same way the existing tools are: added to
  `TA_TOOLS`, `TA_ROUND_LABELS` (so the "thinking" status names what's
  actually happening — "Looking up their file…", "Double-checking
  that's a real option…", "Pulling real comparable pricing…"), the
  client-tool-use filter list, and the dispatch chain — each with its
  own explicit `if (tu.name === ...)` branch rather than falling through
  to the `search_guide` default, which would have silently misrouted
  them.
- Verified with a real Node execution-harness test
  (`test_brain_tools.js`, 30+ checks) against the actual extracted Trip
  Assistant source, loaded alongside this file's OWN real
  `QB_HOTELS`/`QB_RESTAURANTS`/`QB_TOURS`/`KT_LIVE_ITINERARIES` data
  (extracted verbatim from the guide's own top-level data script, not a
  synthetic stand-in) — so `verify_recommendation`/`get_price_reference`
  were checked against the DE's actual Madrid/Barcelona hotel and
  restaurant names and real itinerary prices, not invented test
  fixtures. Covers: fuzzy client-name matching, every profile field
  rendering correctly including the resolved itinerary title, the latest
  note only (not the full log), and — the specific thing that mattered
  most to get right — confirming passport number/DOB/traveler-passport
  values never appear anywhere in the tool's output while the
  "on file" fact still does; a real hotel and a real restaurant name
  both verifying, a genuinely invented name correctly flagged, case-
  insensitive matching, multiple names in one call each getting their
  own verdict, an unknown city, an empty names array, and a model
  sending a bare string instead of an array (tolerated via the existing
  `normalizeCitiesInput` reuse); a real city+day match returning a real
  on-file price with the "not a computed quote" framing present, the
  day-count-only fallback firing and honestly disclosing itself, a
  multi-city match, and the fully-empty-input case; and a direct check
  that all three tools are actually wired into `TA_TOOLS`/the filter
  list/the dispatch chain/`TA_ROUND_LABELS`/the system prompt, not just
  defined and orphaned. Full pre-existing regression suite re-run with
  zero failures caused by this change (the same two known-baseline
  artifacts are unchanged and unrelated). All 17 `<script>` blocks
  parse; tag balance held exactly (pure logic change, no new markup).
- **Deliberately not built**: an automatic post-hoc scanner that parses
  a finished reply for proper nouns and checks all of them — considered
  and rejected as unreliable (no clean way to tell "a recommended hotel"
  from "a hotel mentioned in passing" from free text without a lot of
  false positives/negatives). The opt-in, model-initiated
  `verify_recommendation` tool is the more honest, buildable version of
  the same goal — asking the model to check itself is coachable via the
  system prompt; getting a regex/heuristic scanner's precision right on
  arbitrary prose is a much bigger and shakier project.
- **Unverified live, and this is the first thing to actually check**:
  whether the model reliably calls `verify_recommendation` when it
  should (the system prompt instructs it to, but nothing forces it — a
  model that's confident-but-wrong could still just not call it), and
  whether it correctly uses `get_client_profile` instead of guessing
  from conversation history when asked a client-detail question. Test
  next: ask about a client's stored dietary restrictions or budget by
  name, ask for a hotel recommendation in a city and see whether
  verification fires for anything not pulled from `get_city_data`, and
  ask "roughly what would a week in Seville and Granada cost" and check
  that the answer cites real comparable itinerary prices rather than a
  made-up number.

## Seven Trip Assistant UX upgrades: chips, copy, undo, a step trace, history, help, dark mode (Sep 2026, unverified live)

Direct follow-up to "Lets start a list of how the assistant can be more
helpful from a user experience" (a collaborative brainstorm, not
implemented yet at that point) then "yeah go ahead and action all of
this" — all 7 items from that list, built together. Mid-build, a
screenshot of the plain "Good evening! What can I help with today?"
greeting (zero buttons) came with a direct refinement: **"can it give
some clickable ideas when asking? Maybe stuff that hasn't been looked at
or actioned"** — this reshaped item #1 specifically (see below) before
any of it was implemented, not after.

- **1. Suggestion chips — real, unaddressed work first, generic prompts
  only to fill remaining slots.** `taBuildSuggestionChips()` checks
  `window.__ctGetTodoSummary()` for an overdue-or-hot-lead client to
  draft outreach for, then `window.__dtGetSummary()` for an unchecked
  Daily Task, before ever reaching for a handful of generic
  capability-discovery prompts (match an itinerary, get a price
  reference, "what's on my plate today") — so a chip is never just a
  canned suggestion when there's something real to point at instead, and
  never blank on a clean day either. Each chip is `{label, prompt}`;
  clicking one (`wireChipButtons`) disables every chip in that bubble and
  calls a new `taSendPrompt(text)` helper (`input.value = text; send();`)
  — reuses the entire existing send pipeline, so a chip can never do
  anything a typed message couldn't. Rendered via a shared
  `taBuildChipsHtml()` in exactly two places: under every AI answer
  (`addAiAnswerMsg`) and — the literal ask from the screenshot — under
  the plain no-fork greeting (`maybeGreetOnOpen`'s "nothing to continue"
  branch). Deliberately NOT added to the fork branch (real prior
  conversation, "continue or start something new?") — that bubble's own
  two buttons are already the action being asked for; a third row of
  suggestions there would compete with, not support, the actual question.
- **2. Copy-to-clipboard on every reply.** A drafted email already had
  its own Copy button in its pop-out; a plain chat answer (a
  recommendation, a piece of guide info) never did. `addAiAnswerMsg` now
  always renders a 📋 Copy button alongside Read-aloud/View-full-details,
  wired in `wireAiAnswerButtons` via `navigator.clipboard.writeText`
  against the same `data-full` attribute those two buttons already read
  from — a flash-to-confirm label ("✓ Copied") the same pattern the
  draft modal's own Copy button already established, falling back to a
  plain "Copy not supported here" message if the Clipboard API isn't
  available rather than failing silently.
- **3. A real Undo on context reset, matching the existing
  confirm-before-delete precedent.** Deleting a Client Tracker record
  already asks first; resetting an entire conversation's context ("Start
  something new" on the greeting fork, or the context bar's own "Start
  new client") used to happen instantly with no way back.
  `taContextSnapshot` is a plain in-memory variable (deliberately NOT
  persisted to `localStorage` — the existing session archive only ever
  stored DISPLAY text, not real Claude-API-shaped history, so there's no
  faithful way to resurrect a snapshot across an actual page reload; see
  "Restore-safe by construction" below for why that's the honest choice,
  not a gap). `resetClientContextWithUndo()` snapshots `taState`/
  `convoHistory`/`pendingResume`/`lastDraftContext` immediately before
  calling the real `resetClientContext()`; `undoContextReset()` restores
  all four and consumes the snapshot (a second undo attempt correctly
  reports nothing left to restore, not a silent double-restore). Both
  reset call sites now post a bubble with a "↺ Undo" button instead of a
  plain confirmation, wired via `wireUndoButtons`.
- **4. A visible step trace instead of one overwritten status line.**
  `updateTypingStatus(div, text)` used to replace a single
  `.ta-typing-status` line every tool-call round — a multi-tool answer
  read as one long, unexplained wait with no record of what already
  happened. Now appends a growing `.ta-trace-line` to a new
  `.ta-typing-trace` container each round, marking the PREVIOUS line done
  (✓ prefix, spinner removed) before adding the next one — reuses the
  `.ta-spinner` CSS class already established earlier this session for
  every other loading state in this file, rather than inventing a new
  one. A final call with no text (the round-cap forced-synthesis path)
  just marks the last line done without adding a new one.
- **5. A browsable Recent Conversations list**, not just the existing
  pull-based `searchArchive`/`presentHistorySearch` ("what did I discuss
  with X before" — still there, unchanged). New 🕘 header button
  (`taOpenHistoryList`) opens a pop-out reading the exact same
  `TA_ARCHIVE_KEY` data `archiveCurrentSession()` already writes — no new
  storage — newest-first, each row opening a read-only transcript
  (`taOpenHistoryDetail`) with a "← Back to list" button.
  **Deliberately view-only, not resumable** — the archive only ever
  stored display text (`{role, text}` pairs), never the real
  Claude-API-shaped `convoHistory` a genuine "resume this" action would
  need, so building a Resume button here would have meant either
  silently doing nothing useful or quietly misleading the DE about what
  it actually restores. An empty archive shows a clear "saved here
  automatically" message instead of a blank pop-out.
- **6. A first-use help reference.** New ❓ header button (`taOpenHelp`/
  `taCloseHelp`) opens a static pop-out with six short sections (About a
  client, Itineraries & pricing, Drafting, Daily Tasks, Voice & photos,
  Shortcuts) — plain reference content, no new logic, matching the "what
  can I ask" framing directly.
- **7. Dark mode — deliberately scoped to the Trip Assistant panel and
  its own pop-outs only, stated explicitly rather than silently
  narrowed.** New 🌙/☀️ header toggle (`applyDarkMode`), persisted via
  `kt-trip-assistant:dark-mode:v1` and applied automatically on load.
  Implemented as a `body.ta-dark-mode` class — the panel and its modals
  are DOM siblings, not nested inside one shared container, so the
  toggle state needs to live on a real ancestor of all of them — with
  every dark-mode CSS rule scoped via a `body.ta-dark-mode #specific-id`
  descendant selector, so the class on `<body>` can never leak an effect
  onto anything outside those specific ids. Covers `#ta-panel` itself,
  its message bubbles/input/settings, and its four pop-out modals
  (itinerary, draft, the two new ones — history, help). **Explicitly NOT
  the Client Tracker, NOT Daily Tasks, and NOT the guide's own 14,000+
  lines of fixed light-theme content** — a genuinely complete dark
  reskin of the whole file was judged too large a scope to guarantee
  correctness on on top of the other six items in the same pass; this is
  real, additive progress, not a full answer to "dark mode" as a
  file-wide feature.
- **Restore-safe by construction, same discipline as every other
  interactive bubble this session's own history keeps re-learning the
  hard way.** Two of the seven items — chips and the Undo button — add
  new clickable markup to a chat bubble, and `persistState()` only ever
  saves a bubble's rendered `innerHTML`; a click listener is a JS-side
  attachment that doesn't travel with it. Both got the same
  "build-markup vs. wire-listeners" split already established for the
  Daily Brief's Draft button, client-name links, and the Read-aloud/
  View-full-details pair — `wireChipButtons`/`wireUndoButtons` are both
  safe to call at creation time OR across the whole restored `#ta-msgs`
  list, and both got added to `restoreState()`'s existing chain right
  alongside those four. This is also exactly why the Undo snapshot is
  deliberately in-memory-only (see item #3) — a restored Undo button
  after a REAL reload correctly and honestly reports nothing left to
  restore, rather than either silently failing or (worse) resurrecting
  stale data from a previous browser session that has nothing to do with
  whatever's on screen now.
- Verified with a real Node execution-harness test (`test_ux_batch.js`,
  67 checks) against the actual extracted Trip Assistant source (not a
  paraphrase), using the same `__expose`-injection pattern
  `test_brain_tools.js` established for reaching closure-private
  functions: real-data-first chip ordering (a mocked overdue Hot Lead
  client and an unchecked Daily Task both appear before any generic
  chip), the clean-day all-discovery fallback, an XSS probe through a
  malicious client name reaching a chip label, real click wiring
  (a chip click sends a message and disables itself, input clears), the
  fresh-session greeting carrying chips and the fork-branch greeting
  deliberately NOT carrying them; the Copy button sending the full
  (not summary) text to the clipboard and flashing a confirmation; the
  full undo lifecycle (reset → snapshot captured → undo restores
  taState/convoHistory → snapshot consumed → a second undo honestly
  reports nothing to restore), the real button click path including the
  "not available" message, and a simulated-reload session confirming a
  restored Undo button never resurrects stale data; the step trace
  across three rounds (first line marked done when the second starts,
  a final null call closing out the last line without adding a new one);
  Recent Conversations (list rendering newest-first, an XSS probe across
  both a malicious client name and a malicious message body coming back
  fully inert, detail view + Back button, the close animation's two-stage
  class removal, and the empty-archive state); the Help modal's open/
  close animation; dark mode (default-light, the toggle function, icon
  swap, a stored preference applying automatically on load, and the real
  header button's click-and-persist round trip); and — the concrete
  proof the restore-safety claim above actually holds — a simulated
  reload with a persisted bubble containing both a chip and an Undo
  button, confirming both are still genuinely clickable (not silently
  dead) afterward, with the restored Undo correctly reporting nothing to
  restore. Also re-ran the full pre-existing regression suite (14 other
  test files) with zero regressions caused by this batch — the same two
  known pre-existing baseline artifacts (`test_tabs_visibility.js`'s two
  non-bugs, `test_draft_button.js`'s one no-API-key-configured check)
  are unchanged and unrelated. All 17 `<script>` blocks parse; tag
  balance held at the same established baseline (div 1789/1789 clean;
  span/button carry their pre-existing, previously-documented 1-off/
  2-off false-positive gaps from prose comments elsewhere in the file,
  unchanged by this batch).
- **Deliberately not built**: a true "resume" action for a past
  conversation (see item #5 — the data this would need was never
  captured), a second, file-wide dark theme covering the Client Tracker/
  Daily Tasks/the guide itself (see item #7), and multi-level undo (only
  the single most recent context reset is recoverable, matching the
  scope of what was actually asked — "a real Undo," not an undo stack).
- **Unverified live, and this is a genuinely large batch landing
  together**: whether the suggestion chips read as helpful or as visual
  clutter under every single reply once the novelty wears off, whether
  the step trace's growing list feels informative or just busier than
  the single status line it replaced on a fast answer, how the dark-mode
  palette actually looks against real content (especially the itinerary/
  draft pop-out tables, which carry their own light-theme-oriented
  border/background colors), and whether Recent Conversations' read-only
  framing is clear enough that a DE doesn't expect a "resume" action that
  isn't there — none of this has been seen in a real browser from this
  environment. Test next: open the panel fresh and confirm the greeting
  shows real chips, tap through a full multi-tool question and watch the
  step trace build, reset context and hit Undo, browse Recent
  Conversations end to end, open Help, and toggle dark mode against a
  real itinerary answer.

## Client Tracker: Sales Status, Sale Amount, and a real "excel style" Sales tab (Sep 2026, unverified live)

Direct request: "I need to be able to track my sales and status of the
client. Sales status - Quoting, Requote, Final Touches, Sold. Also a
column to track my sales. So I am thinking like some kind of excel style
tab... but I am happy to hear your thoughts. This needs to work with the
existing functions of the client tracker and assistant already has."
Mid-build, a direct correction: **"change Sold to Booked"** — the fourth
Sales Status value shipped as `Booked`, not `Sold`.

- **A genuinely separate axis, not a rename of the existing Status
  field.** `CT_SALES_STATUSES = ['Quoting', 'Requote', 'Final Touches',
  'Booked']`, stored as `client.salesStatus` — deliberately distinct from
  `CT_STATUSES` (Inquiry → Booked → Closed, the overall relationship
  pipeline) the same way Lead Temp is already its own independent axis
  from Status. "Quoting" isn't quite "Quote sent," and a client can stay
  "Traveling" long after their sale is "Booked" — folding this into the
  existing field would have meant one dropdown trying to answer two
  different questions.
- **`client.saleAmount` is stored as a real number, not a formatted
  string** — `ctParseCurrency()`/`ctFormatCurrency()` are the only two
  new helpers this needed: parsing tolerates "$4,200", "4200", or
  " 4,200.50 " identically (a DE typing a dollar figure shouldn't have to
  think about exact formatting), and formatting only ever happens for
  display. Storing the real number (not a display string) is what makes
  the summable totals below possible without a second parse step
  scattered across every consumer.
- **A real "💰 Sales" tab — a genuine `<table>`, not the card-grid the
  other two views use.** Third segmented button on `#ct-view-toggle`
  (Follow-up / All Clients / Sales), rendered by a new
  `ctRenderSalesTable()`: Client / Status / Sales Status / Sale Amount /
  Destination / Last Contact, one row per client, sorted by Sales Status
  pipeline order (Quoting → Requote → Final Touches → Booked, unset
  last) then name — same-stage clients cluster together the way a sorted
  spreadsheet column would, with no separate group-header rows needed to
  break up the grid. A summary strip of 4 tiles (count + total $ per
  Sales Status) sits above the table, reusing `.ct-stats-tile`'s own
  visual language rather than inventing a second "totals" look.
- **Both status columns and the amount are inline-editable, writing
  through the exact same `window.__ctApplyPatch` every other inline edit
  in this panel already uses** (the "All Clients" view's own status
  dropdown, `propose_todo_update`'s Confirm card) — one write path, not
  a second one just for this view. Same `stopPropagation()` discipline
  as the existing inline status dropdown: without it, clicking into any
  of these cells' own controls would also count as a click on the row
  underneath, opening the profile before the edit registers.
- **Bulk select extends to the Sales tab**, applying Sales Status instead
  of pipeline Status from that view (`ctApplyBulkSalesStatus`, mirroring
  `ctApplyBulkStatus`'s own "one save/render pass, not N" shape) — the
  more relevant field to bulk-change from this specific screen. The bulk
  toggle button is now shown for both "All Clients" and "Sales," and
  switching to any other view still drops both the mode and whatever was
  selected, same rule as before.
- **Status-change history, same pattern as the existing `statusHistory`,
  same scope decision.** `client.salesStatusHistory` only appends via
  `ctHandleSave()` (the form save) — matching the existing (if
  imperfect) precedent that `status` changes via the inline dropdown or
  an AI patch don't get logged either. Extending that inconsistency to a
  second field, rather than fixing it only for the new one, was the
  deliberate call — no bug was reported about inline status-history
  logging, and fixing it here but not there would have been a new,
  unasked-for asymmetry. Folded into `ctBuildActivityTimeline()` (a new
  💰 event type) so a client's sales history reads in the same
  chronological feed as everything else.
- **Works with what already exists, per the explicit ask, mostly by
  construction:**
  - **Card + profile**: a small sales badge (status + amount, color-coded
    per stage) appears next to the existing status/lead-temp/overdue
    flags on both the card and the profile header, only when
    `salesStatus` is actually set. A new Sales section in the profile's
    main column (`ctRow`/`ctSection`, same "only render what's filled"
    discipline as every other section there).
  - **Pipeline Stats modal**: a new Sales section reusing
    `ctBuildSalesSummaryHtml()`'s own tiles (not a third near-identical
    tile-builder) plus two extra tiles — total booked $ and total tracked
    value across every client with an amount on file, regardless of
    status.
  - **`get_client_profile` (Trip Assistant tool)**: now reports Sales
    status and a formatted Sale amount — a small, deliberate duplication
    of `ctFormatCurrency`'s formatting logic (this tool lives in a
    different `<script>` block; no cross-IIFE export exists for a
    one-line formatter, same call this file already makes for
    `ctTimestampedNote`'s format elsewhere in this tool).
  - **`propose_todo_update` (Trip Assistant tool)**: extended to accept
    `salesStatus`/`saleAmount`, so "mark Amanda's deal as Booked at
    $8,000" can flow through the exact same propose-then-confirm
    Confirm/Cancel card every other AI-driven Client Tracker write
    already uses — never applied directly, same as status/leadTemp/notes.
  - **Backup/restore**: no code change needed — both new fields are
    plain properties on the same client object the existing JSON
    export/import already round-trips as-is.
- Verified with a real Node execution-harness test (`test_sales_tab.js`,
  44 checks) against the actual extracted Client Tracker AND Trip
  Assistant source (not paraphrases): the full Add/Edit save round-trip
  (a new client's salesStatus/saleAmount persist correctly, an edit that
  actually changes salesStatus appends exactly one history entry, a
  re-save with no real change doesn't fabricate a duplicate one); six
  currency parse/format edge cases plus the format-on-reopen round-trip
  (a real amount reopens as "$4,200," a zero amount reopens as a blank
  field, not "$0"); the Sales tab's real `<table>` rendering, its sort
  order across all four pipeline stages plus unset, and the summary
  tiles' counts/totals; inline sales-status and amount edits actually
  persisting via `__ctApplyPatch`; bulk sales-status apply updating only
  the selected clients (caught and fixed a real test-authoring mistake
  along the way — three same-rank clients sort alphabetically, not by
  id, so positional checkbox selection was silently selecting the wrong
  two clients; fixed by selecting checkboxes by client id instead); the
  profile/card badge and Sales-section rendering, including that a
  client with nothing set shows neither; the activity timeline including
  both sales-status history entries in the right order; the Pipeline
  Stats modal's Sales section totals; an XSS probe sending a malicious
  `salesStatus` string through `__ctApplyPatch` (the same path
  `propose_todo_update` would use) coming back fully inert in the
  rendered profile; and `get_client_profile`/`propose_todo_update`
  correctly reading/writing the two new fields end-to-end, including a
  static check that `TA_TOOLS`' own schema documents both. Re-ran the
  full pre-existing regression suite — and, having noticed several of
  those test files were quietly loading STALE extraction snapshots from
  earlier sessions (`/tmp/ct_block2.js`/`ct_block3.js`/`ct_block4.js`,
  some from Sep 2–3, predating today's — and several other sessions'
  — changes entirely), refreshed all of them to the current file's real
  extracted source before re-running, so this was a genuine regression
  check against today's actual code, not an old snapshot silently
  passing against itself. Zero regressions caused by this batch — the
  same two known pre-existing baseline artifacts
  (`test_tabs_visibility.js`'s two non-bugs, `test_draft_button.js`'s
  one no-API-key-configured check) are unchanged and unrelated. All 17
  `<script>` blocks parse; tag balance held at the established baseline
  (div/select/label/details clean; span/button carry their pre-existing,
  previously-documented 1-off/2-off false-positive gaps from prose
  comments elsewhere in the file — plus one NEW same-shape false positive
  caught before it shipped: a comment describing the new table as "a real
  `<table>`" briefly threw off the `<table>` tag count too, reworded
  before committing so that check stays clean, same discipline this
  file's own history already establishes for `<button>`/`<span>`/
  `<details>`).
- **Deliberately not built**: validation on the Sale Amount field beyond
  numeric parsing (no currency selector, no negative-amount guard — not
  asked for, and this file has no authoritative source for what a
  travel-agency sale amount "should" look like); exporting Sales Status/
  Sale Amount into the Outlook deep link or the itinerary document (those
  already have their own established field sets and this wasn't part of
  the request); and search-by-sales-status in the toolbar's search box
  (the Sales tab's own sort/grouping already answers "who's at what
  stage" without needing the same fact searchable a second way).
- **Unverified live**: whether the summary tiles' four-color palette
  reads clearly at a glance, whether the inline amount input's width
  (90px) is comfortable to type into against a real dollar figure, how
  the table's `overflow-x: auto` wrapper behaves on a genuinely narrow
  window, and whether sorting by Sales Status (rather than, say, name or
  amount) is actually the most useful default order in practice — none
  of this has been seen in a real browser from this environment. Test
  next: add a Sales Status and Sale Amount to a couple of clients, open
  the 💰 Sales tab and confirm the table/summary tiles look right, edit a
  status and amount inline, try a bulk Sales Status change, and open
  Pipeline Stats to confirm the new totals look correct.

## Sales-tab summary tiles are now clickable filters (Sep 2026, unverified live)

Direct follow-up, immediately after seeing the Sales tab's summary tiles
in a screenshot: "Can these tabs be clickable to bring me to correct
section. The thought is, I will have 100s of leads so really want to
keep everything a neat and easy to navigate as possible."

- **A filter, not a scroll-to-section** — the deliberate call given the
  stated scale. The Sales tab is one continuous sorted table with no
  group-header rows breaking it up (see the entry above for why); once a
  roster is genuinely in the hundreds, scrolling to "the right part" of
  one long table doesn't actually reduce clutter, narrowing the table
  down to just that stage does. Tapping a tile now sets
  `ctSalesStatusFilter` to that Sales Status and re-renders
  `ctRenderSalesTable()` with only matching rows; tapping the
  already-active tile again clears it back to everyone — same toggle
  shape the lead-temp tabs already use elsewhere in this panel, so it
  isn't a new interaction pattern to learn.
- **The tiles themselves keep showing the FULL overview, not the
  narrowed count** — built from the same `filtered` (search/lead-temp
  already applied) set regardless of which tile is active, so all four
  numbers stay a stable "where does everything stand" glance even while
  the table underneath is zoomed into one stage. Only the table rows
  narrow.
- **The Pipeline Stats modal's copy of these same tiles had to stay
  genuinely read-only** — that modal was explicitly built as "a
  lightweight snapshot, not a second navigation surface... clicking a
  tile does nothing" (see the five-upgrades entry above), and this
  follow-up reuses `ctBuildSalesSummaryHtml()` for both places. Rather
  than fork a second tile-builder, it now takes an `opts.clickable` flag:
  `true` (Sales tab only) renders each tile as a real `<button>` with
  `data-sales-filter`; omitted (the Stats modal's own call site) renders
  the exact same plain, inert markup as before — one function, two
  call sites, the interactive behavior opt-in and scoped to where it was
  actually asked for.
- **Resets when leaving the Sales tab.** `ctSalesStatusFilter` clears
  alongside `ctBulkMode` in the view-toggle's own click handler whenever
  the DE switches to a different view — a filter left silently active
  from a forgotten earlier visit hiding clients on a later one would be
  exactly the kind of surprising behavior "neat and easy to navigate"
  was asking to avoid.
- **A clear empty state for a stage with zero matches** — "No one's
  'Requote' — Tap the tile again to see everyone" — rather than a bare
  "No matches" that reads like the search box is broken.
- Verified with a real Node execution-harness test extension (10 new
  checks added to `test_sales_tab.js`, 54 total) against the actual
  extracted Client Tracker source: the four tiles render as real
  clickable buttons with none active by default; clicking one narrows
  the table to exactly the matching clients; the clicked tile gets the
  `active` class; the summary tiles' own text still shows every stage's
  numbers while the table is narrowed (confirming the "overview stays
  full" design decision actually holds); clicking the same tile again
  restores all clients and clears the active state; a stage with zero
  clients shows the dedicated empty-state message rather than crashing;
  switching to "All Clients" and back to "Sales" resets the filter; and
  — the concrete proof the read-only Stats-modal decision wasn't
  silently broken — opening Pipeline Stats afterward confirms its own
  Sales tiles still render with zero `data-sales-filter` buttons in the
  output. Re-ran the full pre-existing regression suite (16 other test
  files) with zero regressions caused by this change — the same two
  known baseline artifacts are unchanged and unrelated. All 17
  `<script>` blocks parse; div/select/label/details tag balance held
  clean, span/button unchanged from their established 1-off/2-off
  baseline (two new comments briefly introduced their own literal
  `<button>`/`<div>` false positives while drafting — caught before
  committing and reworded, same discipline this file's own history
  already establishes for this exact class of noise).
- **Unverified live**: whether the tile's active-state border (a
  2px sage ring) reads clearly enough at a glance against each tile's
  own background color, and whether the toggle interaction (tap to
  narrow, tap again to clear) is discoverable without being told —
  neither can be judged without a real browser. Test next: open the
  Sales tab with a real mixed roster, tap a tile and confirm the table
  narrows while the tiles themselves keep showing every stage's totals,
  tap it again to clear, and confirm Pipeline Stats' own Sales tiles are
  still inert.

## Three Client Tracker upgrades: sales-stage staleness, sortable Sales-tab columns, CSV export (Sep 2026, unverified live)

Direct follow-up to "seeing all the functions and how I will be tracking
and using this, what would be the biggest upgrades" — a recommendation
(sales-stage staleness alerts, sortable columns, CSV export), then
"Lets go ahead and action all of this." All three built together, aimed
at the same stated goal: a roster that's about to grow into the
hundreds, staying navigable.

- **1. Sales-stage staleness alerts** — the real gap named in the ask:
  the existing Hot Lead nudge watches CONTACT recency, not pipeline
  MOVEMENT, so a lead can be dutifully followed up on schedule and still
  be quietly stuck at Quoting for weeks with nothing flagging that
  specifically. `ctIsSalesStale(client)`/`ctSalesStageDays(client)`
  (`CT_SALES_STALE_DAYS = 7`) answer "how long has this client been in
  its CURRENT sales stage" from the most recent `salesStatusHistory`
  entry that actually matches the current `salesStatus` — Booked is
  never flagged (nothing left to stall in once a deal is done), and a
  client with a `salesStatus` set but no matching history entry
  (predates the feature, hand-edited, an odd import) is correctly left
  un-flagged rather than assigned a fabricated "0 days" or
  "since account creation" guess.
  - **A real data-quality fix this feature needed to be honest, not
    scope creep for its own sake**: `salesStatusHistory` previously only
    ever appended via the form save (`ctHandleSave`) — a deliberate,
    documented gap at the time (matching `statusHistory`'s own same
    limitation, with no feature yet depending on it being complete). A
    staleness feature that only saw form-save changes would have been
    silently wrong for most real edits, since the inline Sales-tab
    dropdown, bulk apply, and an AI-confirmed `propose_todo_update`
    patch are all more likely ways a DE actually changes Sales Status
    day to day. Factored into one shared `ctAppendSalesStatusHistory()`
    helper, now called by all three write paths
    (`ctHandleSave`/`window.__ctApplyPatch`/`ctApplyBulkSalesStatus`) —
    one accurate history, not three separately-tracked, partially-blind
    ones.
  - **Surfaced two ways**, reusing established mechanisms rather than
    building a new alert channel: a new "📉 N stalled in the pipeline:
    Name (Stage, Nd)..." line in the Trip Assistant's existing Daily
    Brief (same once-a-day ambient-check shape as the Hot Lead nudge,
    via a new `window.__ctGetStaleSalesLeads()` export, independently
    gated/try-caught so a Client Tracker without it yet just skips this
    one line), AND a small ⏳ badge directly on the affected row in the
    Sales tab table itself (an amber left border, distinct from
    `.ct-card.overdue`'s pink/red, which means a FOLLOW-UP is overdue —
    a different fact) — so a stalled lead is visible both proactively
    once a day and at a glance while actually working the pipeline, not
    just one or the other.
- **2. Sortable Sales-tab columns.** Every header (Client / Status /
  Sales Status / Sale Amount / Destination / Last Contact) is now a real
  click target — click once to sort by that column (▲), click the SAME
  one again to reverse (▼), click a different one to switch. No explicit
  sort chosen (`ctSalesSortKey === null`) keeps the exact original
  default (pipeline order, then name) — clicking never happens
  automatically, so nothing about the table's look changes for a DE who
  never touches a header. Resets to the default whenever the DE leaves
  the Sales tab, same "don't let stray view state silently carry over"
  rule the tile filter already established.
- **3. CSV export of the roster.** A new "📈 Export CSV" button, shown
  only in the Sales tab (same static-button-toggled-by-view pattern as
  the existing "☑️ Select" bulk toggle right next to it — wired once,
  not rebuilt on every render). **Exports exactly what's currently ON
  SCREEN** — search, the lead-temp tab, the clickable tile filter, and
  whatever column sort is active, all re-applied via the same
  `ctMatchesSearchAndStatus`/`ctSalesSortRows` helpers the table itself
  uses — not a second "always full roster" export; the full roster
  already has its own dedicated export (the 📥 JSON backup button),
  which serves a different purpose (data preservation, not spreadsheet
  analysis). A DE who filters to "Booked this quarter" before exporting
  gets exactly that in the file, matching how export normally behaves in
  a real spreadsheet tool. Real CSV escaping (`ctCsvEscape`) — a client
  named "Smith, John" or a destination like "Barcelona, Spain" gets
  properly quoted, not silently misaligning every column after it — plus
  a leading BOM so Excel reliably reads accented characters instead of
  guessing the wrong encoding. Sale Amount exports as a plain number
  (not a formatted "$4,200" string), so it stays usable as a real number
  once opened in Excel. An empty (filtered-to-nothing) view shows a clear
  "nothing to export" message instead of downloading a useless
  header-only file.
- Verified with real Node execution-harness test extensions against the
  actual extracted Client Tracker AND Trip Assistant source (not
  paraphrases): `test_sales_tab.js` grew from 54 to 87 checks — cross-path
  `salesStatusHistory` tracking (the inline dropdown and bulk apply both
  now log a real entry, re-applying the same value is still a no-op, not
  a duplicate); the full staleness decision table (a genuinely 10-day-
  stalled lead flagged, a 2-day-fresh one correctly not, Booked never
  flagged regardless of age, a `salesStatus` with no matching history
  entry correctly left un-flagged rather than guessed at, and results
  sorting longest-stalled first with real day counts) plus the Sales
  tab's own ⏳ badge/row-highlight rendering only on genuinely stale rows;
  sortable columns (default order unchanged, ascending/descending toggle
  on the same header, switching headers, the arrow indicator, and the
  reset on leaving/re-entering the tab); and CSV export (a real blob's
  content captured via the same `FakeBlob`/`URL`-stub pattern
  `test_export_backup.js` already established, header row correctness,
  comma-containing fields correctly quoted, tags joined with a semicolon
  instead of a column-breaking comma, the amount exported as a plain
  number, the export respecting an active tile filter, and the empty-
  result "nothing to export" case). A separate extension to
  `test_autoopen_refresh.js` (loading the real Trip Assistant, Client
  Tracker, AND Daily Tasks scripts together, exactly like every other
  Daily Brief test) confirmed the staleness line live end-to-end: a
  brief appearing purely because of a stalled lead (Daily Tasks
  checklist deliberately cleared first, to isolate the one new signal),
  the real client name still auto-linked via the existing
  `wireClientProfileLinks()` (same as every other name in the brief),
  the stage/day-count text present, and a 2-day-fresh lead correctly not
  triggering the line. Re-ran the full pre-existing regression suite (16
  other test files, using freshly re-extracted `/tmp/dt_block.js` too,
  not just the Client Tracker/Trip Assistant ones already refreshed last
  session) with zero regressions — the same two known baseline artifacts
  are unchanged and unrelated. All 17 `<script>` blocks parse; div/
  select/label/details/table/th tag balance held exactly at the
  established baseline (span/button carry their same pre-existing 1-off/
  2-off gaps, unchanged by this batch — this time from real balanced
  markup additions, not a new prose false positive).
- **Deliberately not built**: per-stage staleness thresholds (one shared
  `CT_SALES_STALE_DAYS = 7` for all three non-Booked stages, not a
  separate tunable number for Quoting vs. Requote vs. Final Touches —
  reasonable-sounding but unproven guesses at three numbers instead of
  one weren't worth the added complexity before living with the single
  threshold for a while); multi-column sort (clicking a header replaces
  the sort entirely, matching a plain spreadsheet's default click
  behavior, not a shift-click-to-add-a-secondary-sort convention); and
  an Excel-formula-aware `.xlsx` export (a real CSV, opened directly by
  Excel/Sheets/Numbers, was judged the right scope for "excel style" —
  generating an actual `.xlsx` binary would be a meaningfully bigger,
  riskier build for marginal benefit over a CSV a DE can already open
  and immediately work with).
- **Unverified live**: whether 7 days is the right staleness threshold
  in practice (a reasonable-sounding guess, same caveat as the original
  5-day Hot Lead threshold when it first shipped), whether the ⏳ badge
  and amber row border read clearly at a glance against the table's
  other colors, whether clicking through several column sorts feels
  responsive on a roster actually in the hundreds, and whether the
  exported CSV opens cleanly with correct columns/encoding in the DE's
  actual copy of Excel — none of this has been seen in a real browser
  from this environment. Test next: let a lead sit in Quoting for a
  week and confirm both the Daily Brief line and the Sales-tab badge
  appear, click through a few column sorts, and export a filtered view
  to CSV and open it in real Excel.

## Sales Analytics dashboard — a real reporting layer over the Sales tab (Sep 2026, unverified live)

Direct follow-up to "do you know the CRM Hubspot, would that make sense
to build something similar to that?" then, after being talked through
what's actually buildable within this file's single-HTML/no-backend
architecture (a full HubSpot equivalent needs a multi-user backend, real
sync, and automation this project doesn't have and isn't going to grow):
**"what would make the most sense? I dont want to cut corners because
this is going to be a daily go to for everything customer related."**
The two options on the table were a kanban-style drag-and-drop pipeline
board and a real reporting/analytics dashboard — recommended the
dashboard first, because a kanban board mostly re-presents data the
Sales tab already shows (a nicer way to look at the same slice), while a
dashboard answers questions that weren't answerable at all before this:
conversion rate, average days-to-book, revenue trend, which destinations
actually close. Also only honestly buildable now — `salesStatusHistory`
only became accurate across every write path (form save, inline dropdown,
bulk apply, AI patch) in the immediately preceding staleness-tracking
work, so the time-series data this needs is finally real, not
approximate. User agreed and asked to build it, with a link to their old
real HubSpot deals pipeline for reference (a private, login-gated URL
this environment can't fetch — used as a general "here's the category of
tool" pointer, not a page actually read).

- **A genuinely separate concern from Pipeline Stats (`ctBuildStatsHtml`,
  the existing 📊 modal), not a rebuild of it.** Pipeline Stats answers
  "where does everything stand right now" — a point-in-time snapshot,
  explicitly documented elsewhere in this file as staying that way on
  purpose. This answers a structurally different question a snapshot
  can't: how is the pipeline actually PERFORMING over time. New 📈
  header button (`ct-analytics-btn`, next to the existing 📊), its own
  wider modal (`#ct-analytics-overlay`/`#ct-analytics-modal`, 900px vs.
  Pipeline Stats' 640px — enough room for a trend chart and several
  sections without feeling cramped), same overlay/modal open/close
  fade-transition pattern as every other pop-out in this file, added to
  the shared CSS lists (opacity/transform/`@media print` hide) alongside
  them.
- **`ctBuildSalesAnalytics()`** — pure data computation, deliberately
  split from its HTML renderer (`ctBuildAnalyticsHtml`) so it's directly
  Node-testable against real `ctClients` data with no DOM involved, same
  split this file already uses for `ctGroupClients` vs. its own render
  callers. Computes:
  - **Open pipeline value / booked-all-time value** — straightforward
    sums, reusing `ctParseCurrency`.
  - **Win rate** — booked count ÷ everyone who ever had a Sales Status
    set. **Deliberately disclosed as imperfect, not silently accepted as
    exact**: there's no "Lost" stage tracked (`CT_SALES_STATUSES` is
    exactly the four values asked for — Quoting/Requote/Final Touches/
    Booked, no fifth status invented to make this metric cleaner), so a
    lead that goes cold without ever being marked Booked stays counted
    as "open" here forever, not "lost." A footnote on the dashboard
    itself says this in plain language rather than presenting a
    seemingly-precise percentage with a hidden asterisk.
  - **Avg. days to book** — first real `salesStatusHistory` entry to the
    entry where Sales Status became Booked, averaged across clients
    where that's an honestly measurable journey. A client whose FIRST
    ever logged entry is already "Booked" (no earlier stage was ever
    tracked — a legacy record, a hand-created one, or one booked before
    this feature existed) is correctly excluded rather than counted as a
    fabricated "0-day" close — caught and fixed during testing, not
    assumed correct from the start (see the Verified section below).
  - **Pipeline funnel** — count + value at each of the four stages right
    now, rendered as hand-rolled CSS horizontal bars (no charting
    library — this file has no build step and no external dependency
    anywhere else in it, so this doesn't start being the first one).
  - **Avg. time in stage** — reuses `ctSalesStageDays()` (the exact same
    function the Sales tab's own stale-badge and the Daily Brief's
    staleness line already use) averaged per open stage — one
    definition of "how long has this been sitting here," not a second
    one just for this dashboard.
  - **6-month booking trend** — a small vertical CSS bar chart (count +
    value per month, read straight from every client's own
    `salesStatusHistory` 'Booked' entries, no separate log needed) plus
    a this-month-vs-last-month comparison line.
  - **Top destinations (booked)** — grouped by `client.destination`
    among Booked clients, ranked by value then count, rendered as the
    same horizontal-bar language as the funnel.
  - **At-risk deals** — the exact same `ctIsSalesStale`/staleness rule
    already powering the Sales tab's badge and the Daily Brief's line,
    not a second threshold invented for this view.
  - **Recent pipeline activity** — every `salesStatusHistory` entry
    across the whole roster, flattened, newest-first, capped to a
    readable handful.
  - Every at-risk/activity row is a real click target
    (`data-an-open-client`) — clicking one closes the analytics modal
    and calls `ctOpenDetail(id)` directly (a plain internal function,
    not a `window.__ct*` export — this button only ever exists while
    the Client Tracker panel itself is already open, since it lives
    inside `#ct-head`), same "drive the real UI, don't make the DE hunt
    for the client by hand" pattern as every other name-links-to-profile
    spot in this file.
- **A real bug caught by testing, not assumed correct from the start**:
  the first version of the avg-days-to-book calculation counted a
  client whose entire `salesStatusHistory` was a single "Booked" entry
  as a 0-day close (first entry = last entry = the Booked entry itself).
  That's not a real measured duration, it's the absence of one — fixed
  by explicitly excluding any client whose earliest logged entry is
  already 'Booked' from the average, rather than letting a silent "0"
  quietly drag the real average down. Caught while writing the Node
  harness test below, before this ever reached the live file's git
  history as a bug to later find and fix.
- Verified with a real Node execution-harness test (`test_sales_
  analytics.js`, 43 checks) against the actual extracted Client Tracker
  source (not a paraphrase), using a realistic 7-client synthetic roster
  spanning multiple months/stages/destinations: every core metric
  (pipeline value, booked value, win rate, avg. days to book excluding
  the no-journey legacy client, the funnel's per-stage counts/values,
  avg. time in stage, the 6-month trend's this-month/last-month buckets,
  top destinations ranked correctly across three Barcelona bookings vs.
  one Madrid booking, at-risk correctly flagging only the genuinely
  stale lead, activity capped and sorted); the same edge cases on a
  completely empty roster (win rate/avg-days-to-book correctly `null`,
  not `NaN`/`0`, totals correctly `0`, list fields correctly empty
  arrays); the HTML renderer's empty state and every section actually
  appearing with real data; an XSS probe across both a client name and a
  destination field (confirmed the ESCAPED text is what's present, not
  a naive raw-substring check that would have wrongly flagged
  `ctEscapeHtml`'s own correctly-escaped output — checked specifically
  for the absence of a live, parseable `<img onerror=...>` tag, not just
  the substring "onerror=" which legitimately still appears as inert
  escaped text); and the real click-through from an at-risk row to that
  client's actual profile, including that dom_harness's `click()`
  doesn't bubble (a harness limitation, not an app one — worked around
  by triggering the delegated listener directly with a `target`
  override, the same way a real browser's bubbling would reach it).
  Re-ran the full pre-existing regression suite (17 other test files)
  against freshly re-extracted source with zero regressions — the same
  two known baseline artifacts (`test_tabs_visibility.js`'s two
  non-bugs, `test_draft_button.js`'s one no-API-key-configured check)
  are unchanged and unrelated. All 16 inline `<script>` blocks parse;
  tag balance held at the established baseline (div/select/label/
  details/table/th clean; span/button carry their pre-existing,
  previously-documented 1-off/2-off false-positive gaps from prose
  comments elsewhere in the file, unaffected by this addition).
- **Deliberately not built**: a "Lost" pipeline stage (would clean up
  the win-rate math, but wasn't asked for — `CT_SALES_STATUSES` stays
  exactly the four values the DE specified, with the win-rate limitation
  disclosed instead of silently worked around by inventing scope); a
  kanban-style drag-and-drop board (the other option on the table —
  recommended second specifically because it's a UI-feel upgrade over
  data the Sales tab already surfaces, not new capability, and dragging
  a card would need to trigger the exact same `ctAppendSalesStatusHistory`
  path every other Sales Status change does or it silently reopens the
  staleness feature's own just-fixed data-quality gap); per-rep or
  per-source reporting (this file has no lead-source field and tracks a
  single DE, not a team — HubSpot's own multi-rep reporting has no
  equivalent data to report on here); and exporting the dashboard itself
  (the CSV export already covers "get this data into a spreadsheet," and
  the roster-level Sales tab is closer to what's actually exportable
  row-by-row).
- **Unverified live, and this is the first genuinely new chart-shaped UI
  in this file**: whether the hand-rolled CSS bar charts (both the
  horizontal funnel/destination bars and the vertical 6-month trend)
  render cleanly and read clearly at a glance in a real browser, whether
  900px is the right modal width on a real laptop-sized window, whether
  the win-rate footnote is noticed/understood rather than skipped past,
  and whether clicking through from an at-risk/activity row to a
  client's profile feels like the right shortcut in practice — none of
  this has been seen outside this environment. Test next: open the 📈
  Sales Analytics button with a real roster that has a few months of
  booking history, confirm the funnel and trend chart look right, check
  that the win-rate footnote reads clearly, and click through an
  at-risk row to confirm it lands on the right client's profile.

## Client Tracker header buttons: labeled instead of icon-only, and a real styling bug fixed (Sep 2026, unverified live)

Direct follow-up, from a screenshot of `#ct-head`'s icon row: "can you
clean up the buttons and make them a bit cleaner to tell what the
functions actually do." The screenshot itself made the sharpest part of
the complaint visible directly, not just implied: the export (📥) and
import (📤) icons render as near-identical blue trays at this size — a
DE would have to hover both to tell them apart, exactly the "can't tell
what it does" problem being reported.

- **Every `.ct-head-group` button except ✕ now shows a real, always-
  visible text label next to its icon**, not just a hover tooltip —
  `<span class="ct-head-icon">`/`<span class="ct-head-label">` inside
  each button: 🔕 **Alerts**, 📊 **Snapshot**, 📈 **Analytics**, 💾
  **Backup**, 📂 **Restore**, 🗑️ **Deleted**. The `title` attribute
  stays too (a fuller sentence for anyone who does hover), but the
  visible label is what actually answers "what does this do" without
  hovering at all. ✕ close is deliberately left unlabeled and visually
  separate — it's dismissal, not a labeled action, and "Close" text
  next to six real action labels would compete with them for no benefit
  (✕ reads on sight already).
- **Export/Import swapped off the confusable 📥/📤 pair** — confirmed
  hard to tell apart directly from the reported screenshot, not just a
  guess — to 💾 (Backup) and 📂 (Restore): a floppy disk and a folder are
  two genuinely different glyphs at a glance, unlike two near-identical
  trays differing only in arrow direction.
- **A real, confirmed styling bug found and fixed while touching this
  CSS, not caused by this pass**: `.ct-head-group` had been applied as a
  class on all six buttons in the markup since the header facelift
  earlier this session — but the CSS rule underneath it had silently
  stayed an ID list (`#ct-close, #ct-notify-btn, #ct-export-btn,
  #ct-import-btn`) written before `#ct-stats-btn`/`#ct-analytics-btn`/
  `#ct-trash-btn` even existed. Confirmed via grep: zero CSS rules
  anywhere in the file actually selected `.ct-head-group` as a class
  before this fix — three of the six buttons had never once received
  this panel's own circular-icon-button treatment (background, hover
  scale, sizing), silently rendering with default browser button chrome
  the whole time this session. Fixed at the root: `.ct-head-group` is
  now the real styling hook (a pill shape wide enough for icon+label,
  consistent hover treatment across all six), so any future button
  added with that class is correctly styled without needing its id
  appended to a growing selector list again — the same failure shape
  that let this gap open in the first place.
- **Narrow panels fall back to icon-only** (`@media (max-width: 700px)`,
  the same breakpoint the sidebar's own two-column-to-one-column
  collapse already uses) — six labeled pills plus the subtitle and ✕
  would crowd a narrow window, so labels hide and buttons shrink back to
  30px circles there; the `title` tooltip still carries the full
  description regardless of width.
- **A real bug this rework would have introduced, caught before it
  shipped**: `ctRefreshNotifyUI()` used to do `btn.textContent = '🔕'`
  directly on the whole button — safe when the button held nothing but
  an emoji, but `textContent` replaces every child with a single text
  node, so unchanged that line would have silently deleted the new
  "Alerts" label every time notification-permission state changed
  (page load, granting/denying permission, or the toggle click).
  Fixed by reaching `.querySelector('.ct-head-icon')` and setting only
  that span's text, leaving the label span untouched.
- Verified with a real Node execution-harness test (`test_header_
  buttons.js`, 25 checks) against the actual extracted Client Tracker
  source AND the live file's raw markup (not paraphrases): every button
  carries the exact expected icon+label pair, read straight out of the
  real `Tommie_Tours.html` `#ct-head` block; `.ct-head-group` is
  confirmed to exist as a real CSS class rule with the icon+label flex
  layout (the actual regression test for the styling bug found above);
  export/import are confirmed to no longer contain the old 📥/📤
  glyphs; ✕ close is confirmed to carry no label; and
  `ctRefreshNotifyUI()` is exercised against all four real permission
  states (unsupported, granted, denied, default) with the label checked
  to survive every single one — catching along the way a genuine bug in
  the test's OWN first draft, not the app: the app's real guard is
  `'Notification' in window` (the window OBJECT's own property), while
  `.permission` is read off a separately-injected top-level identifier
  — a test session that passes a fake `Notification` constructor only
  as that separate identifier without also attaching it to `window`
  never actually reaches the granted/denied branches, silently testing
  the unsupported branch three extra times instead. Fixed by attaching
  `Notification` onto the window object itself in the test, matching
  what the app genuinely checks. Also verified the click wiring for
  Snapshot/Analytics/Deleted/Backup still fires correctly through the
  restructured markup (a real click-through, not just a listener-
  attached check). Re-ran the full pre-existing regression suite (18
  other test files) against freshly re-extracted source — this surfaced
  a widespread but shallow breakage across 15 of those files (all
  crashed identically, `Cannot set properties of null (setting
  'textContent')`, inside `ctRefreshNotifyUI()`): every one of them
  builds its own synthetic `#ct-notify-btn` via a generic single-node
  fallback with no children, so once `ctRefreshNotifyUI()` started
  reaching for a real `.ct-head-icon` child that fallback never had,
  every test session that runs the Client Tracker script at all hit the
  same null-pointer at load time — confirmed this is a test-harness/
  real-markup mismatch, not a live bug: the Client Tracker's own
  `<script>` tag sits AFTER its own HTML in the file (this file's
  established document-order convention), so a real browser always has
  the genuine nested-span markup already parsed before this function
  ever runs. Fixed by pre-seeding each affected test's `registry['ct-
  notify-btn']` with the real icon/label structure before the script
  executes, applied identically across all 15 files via a small script
  rather than by hand, to avoid missing one. All 16 inline `<script>`
  blocks parse; div/select/label/details/table/th tag balance held
  clean; span moved +12/+12 (six buttons × two new spans each),
  matching the file's established 1-off false-positive gap exactly with
  no new imbalance.
- **Deliberately not built**: a dropdown/overflow menu consolidating
  these six actions behind a single "⋯ More" button — considered, since
  the row has grown from two buttons to six across this session and
  could keep growing, but a labeled-pill row directly answers "make it
  cleaner to tell what the functions do" (the actual ask) with far less
  new UI risk (no click-outside-to-close, no keyboard nav, no z-index/
  animation to get right) than building a real menu component; worth
  revisiting if a seventh action ever gets added and the row stops
  fitting even with the mobile fallback.
- **Unverified live**: whether the pill shape and 12px label text read
  clearly at a glance against the gold gradient header (matching every
  other "does this actually look right" caveat in this panel's own
  history), whether six labeled buttons feel crowded or clean on a
  real laptop-sized window before the 700px fallback kicks in, and
  whether 💾/📂 read as "Backup"/"Restore" without needing to look at
  the label at all — none of this has been seen in a real browser from
  this environment. Test next: open the Client Tracker and confirm all
  six header buttons read clearly with their labels, resize the panel
  narrow and confirm they collapse to icon-only cleanly, and tap
  Alerts through its states to confirm the label never disappears.

## Client Tracker: duplicate detection, lead source, a Smart Priority view, bulk outreach (Sep 2026, unverified live)

Direct follow-up to the header-button cleanup above: "okay great. Now
focusing on the client tracker, what can we do for upgrades and smarter
functions?" Proposed four candidates (duplicate detection/merge,
referral/lead-source tracking, a smart priority sort, and bulk
communication), recommending duplicate detection as the place to start —
the DE's own reply was **"yeah build all 4,"** so all four shipped
together rather than one at a time.

- **Duplicate detection — high-confidence only, on purpose.** Once a
  roster is genuinely heading into the hundreds (TMT-screenshot imports
  and manual entry both add clients independently — see the TMT-import
  entries above), nothing stopped the same person being tracked twice.
  `ctFindPossibleDuplicates(candidate, excludeId)` flags only an exact
  normalized-name match, an exact email match, or an exact digits-only
  phone match (7+ digits, guarding against two blank values both
  normalizing to `''` and matching each other by accident) — deliberately
  **no fuzzy/Levenshtein name scoring**. A near-miss ("Tom" vs "Tommy")
  is deliberately NOT flagged: a wrong guess here would train the DE to
  ignore the warning entirely, which is worse than occasionally missing a
  real duplicate. Checked two ways:
  1. **Save-time**, inside `ctHandleSave()` — before a new/edited record
     is written, checked against everyone except the record currently
     being edited (so editing a client never flags itself). A match shows
     `ctShowDuplicateWarning()`, a banner (`#ct-dup-warning`) right above
     Save/Cancel — not a blocking `confirm()` — listing each candidate's
     name and reason, with a "Merge into this record" button per
     candidate and a "Save as new anyway" fallback (sets
     `ctDupAcknowledged`, which the save re-run then respects so the same
     match isn't re-flagged a second time).
  2. **A manual "🔍 Duplicates" scan** (`ctOpenDuplicatesModal`) —
     `ctFindAllDuplicateGroups()` applies the same exact-match rule
     pairwise across the whole roster, for duplicates that predate this
     feature or that a TMT import's own fuzzy client-name matching
     missed. Each group shows every member with a "Merge into
     `<primary>`" button on every entry but the first.
  - **`ctMergeRecordData(base, incoming)`** is the one merge
    implementation both paths share (`ctMergeFormIntoExisting` for the
    save-time path, `ctMergeExistingRecords` for the scan path) — pure,
    never touches `ctClients` itself. Every scalar field: base wins
    unless it's empty, in which case incoming fills the gap. Every
    list-shaped field (notes, tags, travelers, drafts, statusHistory,
    salesStatusHistory, followUps) is **unioned, never overwritten** — a
    merge can never lose real history from either side. A legacy
    single-date follow-up on either side gets resolved through
    `ctFollowUpsFor()` first and re-stamped with a fresh id if it was
    `'legacy'`, so two legacy entries from each side can't collide under
    the same literal id once combined. The losing record is always
    trashed (30-day recoverable trash, same as every other delete in
    this panel), never dropped outright — even for a merge the DE
    themselves triggered.
- **Lead source tracking.** A plain free-text field (`client.leadSource`,
  "Referred by Amanda Jackson," "Instagram ad," matching this file's own
  established "simplest UI that stores the real shape" call rather than
  a dedicated dropdown of invented source categories this file has no
  authority to define) — added to the Add/Edit form right after Tags,
  folded into the existing search box (so typing part of a referral
  source finds the right client the same way a phone-number fragment
  already does), shown in the profile's Trip section, and added as its
  own column to the Sales tab's CSV export. `ctBuildSalesAnalytics()`
  also computes `topLeadSources` (booked-only, ranked by value then
  count) mirroring the existing `topDestinations` computation exactly,
  and `ctBuildAnalyticsHtml()` renders it as a new "Top Lead Sources
  (Booked)" section right after "Top Destinations (Booked)" in the Sales
  Analytics dashboard — reusing the exact same horizontal-bar rendering,
  not a second chart language.
- **Smart Priority view.** `ctComputeLeadScore(client)` is the one
  scoring function — returns `null` for a Closed client (nothing to
  prioritize once a relationship is over) and otherwise a `{score,
  reasons}` pair built from: lead temperature (Hot 40 / Warm 25 / Check
  Back Later 10 / Cold 0 / unset 5), follow-up urgency (+30 overdue, +20
  due within 7 days, or +15 for a Hot Lead with 5+ days of no logged
  contact and nothing scheduled — the same staleness threshold
  `maybeSurfaceHotLeadNudge`/the Daily Brief already use), and — the one
  genuinely new signal, not reused from elsewhere — a stalled or
  sizeable open deal (+15 if `ctIsSalesStale()` says the Sales Status
  hasn't moved, plus up to +20 scaled from `saleAmount`). New "⭐
  Priority" tab on `#ct-view-toggle`: a single flat queue (not grouped,
  unlike the other two views — the whole point is "who's most worth
  chasing right now," not a bucketed browse), sorted score-descending
  then name, each card showing a `⭐ N` badge (`ctCardHTML`'s new
  `opts.showPriority`) whose hover title spells out the actual reasons
  ("🔥 hot lead, overdue 3d") — same "explain why, don't just show a bare
  number" call this file already makes for `ctBuildTaskCallout`. A
  search/filter combination that leaves nothing scoreable (everyone
  matching is Closed) shows a dedicated "Nothing to prioritize" empty
  state rather than a silently blank list.
- **Bulk outreach queue** — the Priority view's own bulk action,
  reachable once "☑️ Select" is toggled and at least one card is checked:
  a "✉️ Draft outreach for N" bar button (in place of the "All Clients"
  view's status-apply bar) opens a step-through review queue
  (`#ct-outreach-overlay`), not an automatic multi-send blast — this
  file's standing "draft only, DE confirms/sends" rule (Outlook,
  `propose_todo_update`) applies here too. Each queued row's own "✉️
  Draft outreach" button drives the **exact same single-client
  `ctDraftOutreach()`** flow already used everywhere else in this panel
  (close the Client Tracker overlay, open Trip Assistant, prefill,
  send) — one client at a time, never a batch call. A drafted row shows
  ✓/"Drafted" and disables itself; the header gains a new "📋 Outreach"
  button (hidden until a queue is actually in progress) so the DE can
  come back and resume the rest after reviewing/sending the first one
  from Trip Assistant, without re-selecting anyone. `ctOpenBulkOutreachQueue(ids)`
  is deliberately dual-purpose: called with a real id array (from the
  bulk bar) it starts a FRESH queue; called with no usable array at all
  (the header button's own click listener passes the click `Event`
  itself, which fails `Array.isArray`) it RESUMES whatever's already in
  progress instead of silently wiping it — the tooltip says exactly
  this ("Resume drafting outreach to the rest of your selected
  clients"). The header button hides itself again
  (`ctSyncOutreachQueueBtn`) the moment nothing's left to resume.
- Verified with a real Node execution-harness test
  (`test_ct_four_upgrades.js`, 59 checks) against the actual extracted
  Client Tracker source (not a paraphrase): the full save-time warning
  lifecycle (blocked save, the real reason shown, "Save as new anyway"
  genuinely creating a second record, the warning clearing after);
  merging from the save-time warning (destination filled from the empty
  side, name kept from the non-empty side, tags unioned, note history
  preserved); a near-miss name correctly NOT flagged; editing a record
  through the real `#ct-detail-edit-btn` → re-save path correctly never
  self-flagging; the manual scan modal (flags a real duplicate group,
  leaves an unrelated client out of the output entirely, scan-merge
  reduces the roster by exactly one and keeps the right merged data);
  lead source searchability and profile display; the Priority view's
  card count, its exclusion of Closed clients, its badge count, and —
  the actual scoring-order proof — that an overdue Hot Lead sorts before
  both an untouched Cold Lead and a merely-due-soon Warm Lead in the
  rendered HTML; the empty state when every match is Closed; and the
  full bulk-outreach lifecycle end to end (bulk-select two clients, the
  bar shows the outreach action rather than a status dropdown, the queue
  modal lists both, drafting one closes the overlay and genuinely drives
  Trip Assistant's real send flow with that client's name in the
  prefilled message, reopening via the header button resumes with the
  first shown as done and the second still actionable, drafting the
  second hides the header button since nothing's left) — one real bug
  caught and fixed while writing this exact check: an early draft of the
  test used a `:not([disabled])` CSS selector this project's own Node
  DOM-harness selector engine doesn't actually support (its regex-based
  attribute matcher reads `:not([disabled])` as requiring `[disabled]`
  to be present, not absent — the opposite of `:not`'s real meaning),
  which was silently selecting the WRONG row (the already-drafted one)
  and still happened to produce a passing-looking count; rewritten to
  filter in plain JS instead of leaning on a selector the harness can't
  parse. XSS probes across the save-time warning, the scan modal, and
  the priority queue's own card rendering all came back fully inert. Re-
  ran the full pre-existing regression suite (39 other test files, all
  refreshed against freshly re-extracted `/tmp/ct_block.js`/`ta_block.js`/
  `dt_block.js`) with zero regressions — the same two known baseline
  artifacts (`test_tabs_visibility.js`'s two non-bugs, `test_draft_
  button.js`'s one no-API-key-configured check) are unchanged and
  unrelated. All 17 `<script>` blocks parse; div/select/label/details
  tag balance held clean; span/button carry their pre-existing,
  previously-documented 1-off/2-off false-positive gaps from prose
  comments elsewhere in the file, unaffected by this batch.
- **Deliberately not built**: fuzzy/near-match duplicate detection (see
  above — a deliberate scope boundary, not an oversight); a dedicated
  lead-source dropdown of preset categories (free text was judged the
  right call — this file has no authority to define KT's real referral
  taxonomy); auto-applying the top-scored Priority card's suggested
  action (propose-then-confirm via the outreach queue, never an
  automatic send, matching this file's standing rule everywhere else);
  and true bulk SENDING (the queue is a review aid for stepping through
  several drafts faster, not a way to skip the per-client Outlook/SMS
  review this file has enforced from the very first Outlook button
  onward).
- **Unverified live**: whether the priority score's exact weights (40/
  25/10/0 for lead temp, +30/+20/+15 for urgency, up to +20 scaled from
  deal size) actually rank clients the way a DE's own gut feel would,
  whether the `⭐ N` badge and its hover-title reasons read clearly at a
  glance, whether the duplicate-detection banner's placement and copy
  are noticed rather than dismissed on a real save, and whether stepping
  through the outreach queue one client at a time (closing/reopening
  Client Tracker between each) feels efficient or tedious in practice —
  none of this has been seen in a real browser from this environment.
  Test next: create a client with the same name as an existing one and
  confirm the save-time warning appears and both "Merge" and "Save as
  new anyway" work, run the manual "🔍 Duplicates" scan against a real
  roster, add a lead source and search for it, switch to "⭐ Priority"
  and confirm the ordering feels right, and select a few Priority-view
  clients to run through the bulk outreach queue end to end.

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

## Portugal build-out begins: Lisbon, treated the same way as a Spain city (Sep 2026, unverified live)

Direct request: "I am going to switch to adding in the Portugal section, I wanted
treated the exact same as the Spain section with how the information is being
built. Maps, restaurants, city highlights, hotels and anything else." Confirmed
up front this would be a unified Spain+Portugal map/city system (not two
separate ones — see below) and that content would arrive sporadically,
section by section, pasted directly (mostly as raw text, some as screenshots),
to be placed diligently rather than assumed.

- **Lisbon promoted to a full top-level `<h3>` city section**, mirroring
  Madrid/Barcelona's exact structure and subsection order: pronunciation flip
  (`Lisboa`, `pt-PT`), Orientation, Key Neighborhoods table, Airport (official
  name/IATA/terminals/facilities), Airport→City Center Options table, Getting
  Around table, a Bonus (Tram 28), Brief History (`<ol>`, condensed from the
  DE's own 5-era paste — Roman/Phoenician founding, Moorish rule, the Age of
  Discovery, the 1755 earthquake, the Carnation Revolution — exam-tagged on
  the earthquake since it directly explains the Baixa's grid layout already
  documented above it), Climate & Best Time to Visit, Key Attractions (an
  11-row table, not the media-gallery flip-card format Madrid uses — see
  below for why), Food & Culture, Events & Festivals, Nightlife, Day Trips
  (Sintra/Cascais & Estoril/Óbidos), and Hotels. Previously Lisbon was a
  single `<h4>` paragraph block nested inside "Portugal — Key Locales
  Overview" alongside Porto/Sintra/Douro Valley/Algarve; those four stay
  there, unchanged, until their own richer content arrives and they get the
  same promotion — the Key Locales Overview intro paragraph now just notes
  Lisbon's full write-up is below.
- **Key Attractions deliberately built as a table, not Madrid's media-gallery
  flip-cards.** Madrid's cards use real Wikimedia Commons image URLs; this
  environment has no network access (confirmed by an actual failed fetch —
  see below) and no way to verify a guessed Commons filename would resolve.
  A broken image in a client-facing sales tool is worse than no image, so
  Key Attractions here is Attraction/Why it matters/Practical info (address,
  hours, website) instead — same information, no unverified image risk.
  Worth building the real flip-cards later if/when real image URLs are
  sourced and can be checked.
- **`QB_RESTAURANTS.Lisbon`** — 20 real entries (12 restaurants, 8 cafés),
  added in the exact same `{name, vkind, stars, addr, price, blurb}` shape
  Spain's cities use, live in the Quote Builder immediately (no other code
  changes needed — `QB_RESTAURANTS[city] || []` already handles a new key
  safely everywhere it's read). Verified by extracting and `JSON.parse`-ing
  the live object out of the file after each edit, not just eyeballing it.
  **Price tier (€–€€€€) and `vkind` (fine/classic/tapas/lunch/cafe) were
  inferred from how the DE described each place** (venue type, positioning,
  cuisine style) — none were explicitly given as exact figures. Flagged to
  the DE directly rather than silently presented as confirmed; worth a
  spot-check before quoting off any of them, same discipline this file
  already applies to unconfirmed specifics elsewhere.
- **Bars/nightclubs deliberately kept as guide-prose only, not added to
  `QB_RESTAURANTS`.** Spain's own data has no equivalent structured
  "nightlife venue" QB category either (nightlife only ever appears as a
  `tags` value on a bookable `QB_TOURS` experience, like a flamenco show) —
  injecting bars/clubs into the restaurant picker's `vkind` list would put
  a nightclub in the same dropdown a DE uses to pick a client's dinner
  spot, a real UI mismatch. Built as its own "Nightlife" table instead,
  matching the Key Attractions table's shape.
- **Passport & visa content was pasted for Portugal but deliberately NOT
  turned into a new section.** It read as generic Schengen boilerplate
  (matching Spain's own Section 1.2 almost exactly), but its ETIAS framing
  — "as of 2025... citizens... are required to have an ETA" — directly
  conflicts with Spain's own already-verified section, which explicitly
  states ETIAS is **not yet in effect** as of Aug 2026 (2027 now more
  likely). Since Portugal is Schengen and the guide already cross-
  references Spain's section for identical rules ("Portugal — Must-Know
  Numbers & Rules" table), duplicating a Portugal-specific version with
  the older/conflicting ETIAS claim would have introduced a real
  contradiction into the guide rather than resolved one. Left the existing
  cross-reference as-is and flagged the conflict to the DE directly instead
  of silently picking a version.
- **Confirmed, not assumed: this environment cannot reach
  kensingtontours.com or any other live site.** Asked directly whether
  Spain's own `KT_LIVE_ITINERARIES` data had been pulled the same way —
  checked via `git log -S` rather than guessing, and confirmed it hadn't:
  the very first commit in this repo is a bulk import of the whole file
  from the original claude.ai chat-based development phase, itineraries
  included. A live `WebFetch` attempt against the Portugal tours page in
  this session returned `EGRESS_BLOCKED` for `kensingtontours.com`
  specifically — a real, first-time-encountered limitation for this
  project, not a regression from prior working behavior. Portugal's own
  live-itinerary listings still need to be pasted in by the DE the same
  way everything else in this section was.
- **The interactive map's real coordinate system, verified properly rather
  than guessed at.** `qbRouteMapSvg()`'s city pins come from
  `TRIP_PLANNER_PINS` — hand-placed x/y points inside a 560×520 SVG,
  plotted against a hand-traced `QB_LANDMASS_PATH` polygon the code's own
  comment describes as "real Spain outline (traced from Natural Earth
  geographic data)... cities placed at their true relative positions."
  Fit a least-squares affine transform from real (lng, lat) → (x, y) using
  7 of Spain's own known cities (Madrid, Barcelona, Seville, Bilbao,
  Valencia, Granada, Marbella) against their actual `TRIP_PLANNER_PINS`
  coordinates — the fit came back essentially exact (≤0.1px residual on
  every point), confirming this really is a precise geographic projection,
  not an artist's approximation. Applied that same transform to Lisbon,
  Porto, Sintra, and Faro's real coordinates, then ran a point-in-polygon
  test against the actual `QB_LANDMASS_PATH` — **all four land outside the
  currently-drawn shape**, confirming the polygon traces Spain's political
  border specifically, not the whole Iberian Peninsula's coastline.
  Extending it to include Portugal is a real, doable next step now that
  the exact transform is known (any new Portugal reference point's real
  lat/lng converts straight to the right x/y), but it's real path-surgery
  worth doing as its own careful, verifiable pass — not squeezed in
  alongside a large content-integration turn — so it's deliberately not
  done yet. **Confirmed with the DE directly**: wait until more Portugal
  city data is in before extending the shape, and this specific Lisbon
  batch was committed as its own checkpoint rather than held for a larger
  combined commit later.
- Verified via the project's established discipline: all 17 `<script>`
  blocks parse (`new Function`), `QB_RESTAURANTS` re-extracted and
  `JSON.parse`-d successfully after each edit (not just visually
  eyeballed), the full 39-file pre-existing Node execution-harness
  regression suite re-run against freshly re-extracted source with zero
  failures, and div/table/th tag balance held exactly (span/button's
  pre-existing, previously-documented false-positive gaps unchanged, no
  new imbalance).
- **Unverified live, same caveat as everything else in this file**: none
  of the new Lisbon content (Airport/transit facts, restaurant hours/
  addresses, event dates) has been checked against a live source from
  this environment — it's transcribed faithfully from what the DE pasted,
  not independently confirmed. The inferred restaurant price tiers/
  categories especially are worth a real spot-check. Next: Porto, Sintra,
  Douro Valley, and Algarve each need the same full-section treatment
  Lisbon just got, and the map extension is still pending more city data.

## Lisbon build-out continues: Shopping, Currency & Practical Money Tips, Culture & Etiquette, Insider Travel Tips — plus a real duplicate-id bug fixed (Sep 2026, unverified live)

Direct continuation of the Lisbon build-out above, from a further batch of
sporadically-pasted content (per the DE's own "diligent" instruction):
"Neighborhoods Worth Exploring" (flip-card-style neighborhood descriptions),
"Currency," "Culture and Etiquette" (Lesson 6 of 9), "Travel Tips" (Lesson 7
of 9), and a "Shopping, Neighborhoods, and Currency" (Lesson 5 of 9) batch
whose Shopping half arrived first and was placed in the same pass.

- **A real bug found and fixed before any new content was added**: Lisbon's
  own `<h3 id="17-lisbon">` (from the original Lisbon promotion, see above)
  collided with Valencia's pre-existing `<h3 id="17-valencia">` — Spain's
  city sections are numbered `1`+sequential-index (`15-madrid`,
  `16-barcelona`, `17-valencia`, `18-seville`, ... `121-qualifying-
  questions`), and Lisbon's promotion from a plain `<h4>` to a full `<h3>`
  reused the literal string "17" without checking it against that existing
  sequence. A duplicate `id` means `<a href="#17-valencia">`-style anchors
  and any `getElementById`/`querySelector('#...')` lookup can only ever
  reach the FIRST matching element in the document (Valencia, which comes
  first) — Lisbon's own id was silently unreachable by anchor the whole
  time this session, though nothing in this file's live JS actually tried
  to jump to it yet (confirmed via grep — only Valencia's id has real
  callers, at the food/wine city-jump feature and the interactive map's
  color-by-city lookup). Fixed by renaming Lisbon's id to `p1-lisbon` — a
  fresh `p`-prefixed sequence for Portugal's own cities, guaranteed to
  never collide with Spain's `1`-prefixed numbers as Portugal grows.
  Verified via a full duplicate-id sweep across every `id="..."` in the
  file: zero Lisbon-related duplicates remain (the sweep did surface four
  pre-existing, unrelated duplicate ids in the Client Tracker's bulk-action
  bar — `ct-bulk-bar`/`ct-bulk-status`/`ct-bulk-apply`/`ct-bulk-clear-btn`
  — confirmed pre-existing and untouched by this session's work, not
  something introduced here; flagged for a future pass, not fixed now
  since it's outside this batch's scope).
- **Key Neighborhoods table enriched, not duplicated.** The newly-pasted
  "Neighborhoods Worth Exploring" flip-card content (Alfama, Bairro Alto,
  Chiado, Belém, LX Factory) overlaps with the Key Neighborhoods table
  already built in the previous Lisbon pass — rather than adding a second,
  redundant neighborhoods section, the existing table was updated in place:
  the combined "Bairro Alto & Chiado" row was split into two real rows
  (the new content described them distinctly enough to warrant it — Bairro
  Alto's "bohemian by day, nightlife hub after dark" character specifically
  contradicts the prior row's flatter "quiet by day" phrasing, so the newer,
  more specific pasted description won), and a new **LX Factory** row was
  added (a genuinely new neighborhood not in the original table — a
  converted industrial complex, street-art hub, artistic studios/quirky
  shops/trendy eateries). Baixa and Avenidas Novas were left untouched —
  neither was mentioned in the new paste, so there was nothing to reconcile.
  Same reasoning as Key Attractions' table-not-flip-card decision (see
  above): the "Click to flip" flip-card format in the DE's source material
  implies real photos, which this network-less environment has no way to
  source or verify — enriching the existing table's text captures the same
  information without the unverified-image risk.
- **Shopping** (`<h4 id="shopping-lisbon">`) — mirrors Madrid's/Barcelona's
  established Shopping structure (a "Key Shopping Spots" table with
  Spot/Notes/Hours columns and a 📍 `venue-map-link` Google-Maps-search
  icon per row, same `class="venue-map-link"` markup Madrid's own Shopping
  table already uses). A short cross-reference line replaces what would
  otherwise be a duplicate "Shopping Districts" table — the pasted content's
  own Baixa/Chiado neighborhood recaps added nothing the Key Neighborhoods
  table above didn't already cover, so rather than re-describe those two
  areas a second time, the section just points back to it. Seven real
  venues from the paste: El Corte Inglés, Fátima Lopes, Fábrica Sant'Anna,
  Centro Colombo, Centro Amoreiras, A Vida Portuguesa, and the Feira da
  Ladra flea market (given the same ⚠️ pickpocket-risk caution Madrid's own
  El Rastro flea market entry carries, since both are the same kind of
  venue with the same real risk). No Currency-specific content had
  actually arrived yet when Shopping was built (despite the "Lesson 5 of 9:
  Shopping, Neighborhoods, and Currency" title implying all three) — it
  landed in a later message and was placed separately, see below.
- **Currency & Practical Money Tips** (`<h4 id="currency-practical-money-
  tips-lisbon">`) — built as Lisbon's own full section, matching Madrid's
  complete version (Currency/Credit Cards/Exchange Rates & Payment/Tipping
  as separate `<ul>` blocks) rather than Barcelona's short "same as
  Madrid, see that section" cross-reference — the DE's pasted Lisbon
  content was itself full, original prose covering all four of those exact
  topics, not a one-line "same as Spain" note, so condensing it into a
  cross-reference the way Barcelona's does would have thrown away real
  content the DE specifically provided. The substance matches Spain's own
  guidance almost exactly (same currency, same card-issuer travel-notice
  tip, same cash-only-shops caveat) since Portugal shares the Euro and the
  same practical realities — expected, not a copy-paste error.
- **Culture & Etiquette** (`<h4 id="culture-etiquette-lisbon">`) — the
  single largest addition this pass, matching Madrid's/Barcelona's full
  structure exactly: topical `<p><strong>Topic</strong></p><ul>` blocks
  (Fado, Food & Wine, Sports, Street Art — pulled from the "Lesson 6 of 9"
  paste's own section headers), a General Etiquette table (Topic/Key
  Points, built from the paste's own 7-point "Cultural Etiquette" numbered
  list — Greetings, Dining, Respect for History & Traditions, Time &
  Punctuality, Dress Code, Street Safety, Language), a Common Portuguese
  Phrases table (Phrase/Pronunciation/Meaning, using the paste's own
  flashcard pronunciations for Bom dia/Obrigado(a)/Por favor/Desculpe/
  Quanto custa?/Onde fica...?), and a Traveler-Specific Notes list
  (LGBTQ+/Solo Female Travelers/Traveling with Children, using the paste's
  own real facts — Portugal's 2010 same-sex marriage legalization, Bairro
  Alto/Príncipe Real as the LGBTQ+-friendly neighborhoods, Alfama/Bairro
  Alto's stroller-unfriendly cobblestones vs. Parque das Nações' smooth
  paths). The paste's own photo captions ("Museu Do Fado," "Pastéis de
  Nata," "Douro," "Estádio da luz," "Cascais," a street-art photo caption)
  were dropped — they're image labels from the DE's own source slides with
  no standalone informational content once the real prose around them is
  captured, same treatment the earlier Key Attractions pass already gave
  to similar slide-caption fragments. The Bertrand Bookstore fact (world's
  oldest continuously-operating bookshop, since 1732, in Chiado) was kept
  and exam-tagged, matching this file's own "exam-likely" convention for
  a specific, quotable, date-anchored fact — the same shape as Madrid's
  own tapas-bar-etiquette and bullfighting-dates exam tags nearby it.
- **Insider Travel Tips** (`<h4 id="insider-travel-tips-lisbon">`) —
  matches Madrid's plain-`<ul>` structure exactly (no table, unlike the
  sections above it). Five off-the-beaten-path picks from the "Lesson 7 of
  9" paste (Alfama's quieter miradouros — Portas do Sol, Senhora do Monte;
  Chapitô; Jardim Botto Machado; Rua Nova do Carvalho/"Pink Street";
  Campo de Ourique Market) plus the paste's own "Bonus Tip" (GIRA bike
  share, ~€0.10–0.15/min) — explicitly framed as the same kind of
  eco-friendly short-trip option Madrid's own BiciMAD bullet already is,
  since the two really are the same category of civic bike-share system.
- Verified via this project's established non-script-content discipline
  (this was pure HTML/table/list markup, no `<script>` content touched, so
  the Node execution-harness regression suite doesn't apply here — the
  Client Tracker/Trip Assistant/Daily Tasks logic none of this batch came
  near): a full tag-balance recount across the whole file (div/table/tr/
  td/th/thead/tbody/ul/li/h3/h4 all exactly even, opens === closes) and a
  file-wide duplicate-`id` sweep (confirmed zero Lisbon-related duplicates
  post-fix; the four pre-existing Client Tracker ones noted above are
  unrelated and unchanged), plus all 17 `<script>` blocks re-verified via
  `new Function()` syntax parsing (unaffected by this batch, checked
  anyway since it's this project's own standing discipline after any edit
  to the file).
- **Unverified live, same caveat as the rest of this Portugal build-out**:
  none of this batch's specific facts (venue hours/addresses, the exact
  Portuguese phrase pronunciations, the GIRA per-minute pricing, the LGBTQ+
  neighborhood names) have been checked against a live source from this
  environment — transcribed faithfully from what the DE pasted, not
  independently confirmed. The `venue-map-link` 📍 icons on the new
  Shopping table haven't been clicked in a real browser to confirm the
  Google Maps search queries resolve to the right real-world venues, and
  the split Bairro Alto/Chiado neighborhood rows haven't been read back by
  the DE to confirm the merge correctly reconciled the two source
  descriptions. The "Lesson 5 of 9" title's "and Currency" half was
  confirmed genuinely absent when Shopping itself was placed — it arrived
  in its own later, separate message and was folded into the Currency &
  Practical Money Tips section described above rather than treated as a
  second, disconnected paste. Porto, Sintra, Douro Valley, and Algarve still
  need this same full treatment, and the map's `QB_LANDMASS_PATH`
  extension to include Portugal remains deferred per the DE's own earlier
  "wait for more cities" choice.

## Lisbon build-out: cross-referenced against an official Lisbon PDF guide, real gaps filled (Sep 2026, unverified live)

The DE uploaded a 33-page official-looking Lisbon destination PDF
("lisbon_en.pdf") and said simply "this is the lisbon guide" — treated as
source material to cross-check against everything already built, not a
replacement for it.

- **PDF text extraction needed a real fix, not a workaround.** This
  environment's `pdftoppm`/`poppler-utils` binary (the tool this project's
  own PDF-reading path normally uses) isn't installed, and `apt-get
  install` failed (`404` from the package mirror — a real, first-time-
  encountered gap in this environment, not a regression). Installed
  `pdfminer.six` via `pip3` instead, which itself first failed on a
  broken system `cryptography` package (`ModuleNotFoundError:
  _cffi_backend`, a pyo3/rust binding mismatch between the apt-installed
  and pip-installed copies) — fixed by `pip3 install --ignore-installed
  cffi cryptography` to get a working pip-managed pair shadowing the
  broken system one. Once that worked, extraction was clean text, not an
  OCR guess.
- **Cross-referenced every fact against what's already in the guide
  before adding anything — the PDF's own text layout made this
  necessary, not just prudent.** The extracted text interleaves
  photo-caption paragraphs and address blocks in a jumbled column order
  (a known PDF-extraction artifact from a two-column source layout) —
  several `Address:` blocks in the raw extraction sit next to the WRONG
  venue name once cross-checked (e.g. an address block that reads
  correctly as Get Stoked/surfing's meeting point ended up positioned
  right after the "Escape Hunt Experience" heading in the raw text).
  Rather than trust positional adjacency, every fact added below was
  verified against an address, phone number, or website that
  unambiguously named the real venue (a website matching the venue's own
  domain, an address matching a known real location) — anything that
  couldn't be pinned down this way (Escape Hunt Experience's own address,
  specifically) was left out rather than guessed at.
- **Genuinely new content added, nothing already-correct overwritten:**
  - **9 new Key Attractions rows**: Miradouro das Portas do Sol, Praça do
    Comércio (Terreiro do Paço, with the Monument to King José I), Lisbon
    Zoo, Lisbon Oceanarium, Gulbenkian Foundation, National Museum of
    Ancient Art, Museum of the Orient, Pavilion of Knowledge, and
    Monsanto Forest Park — none were in the table built in the prior
    Lisbon pass. Lisbon Zoo's address (Praça Marechal Humberto Delgado)
    looked wrong at first glance for a zoo — verified it's actually
    correct (that's the real, official Jardim Zoológico de Lisboa
    address) before trusting it, rather than dropping it on suspicion.
  - **2 new Day Trips rows**: National Palace of Queluz (~15 min,
    positioned as a quick add-on/alternative to Sintra) and a Setúbal
    wine-region day trip (Moscatel de Setúbal, artisanal cheeses).
  - **5 new Shopping rows**: Armazéns do Chiado, Luvaria Ulisses, Cork &
    Co, Centro Vasco da Gama, and Freeport Lisboa Fashion Outlet (flagged
    honestly as "a real trek outside the city," with the real shuttle
    detail — two daily departures from Marquês de Pombal Square and
    Martim Moniz — since that's the only thing that makes it practical to
    suggest at all).
  - **`QB_RESTAURANTS.Lisbon` gained one new entry, Ler Devagar** — a
    bookshop-café inside LxFactory, listed in the PDF under BOTH its
    Cafés and Shopping sections. Added once, as a `vkind: 'cafe'` Quote
    Builder entry (matching how every other café in this list is
    categorized), and cross-referenced from the Shopping table's own new
    row rather than duplicated as a second, disconnected shopping entry.
    JSON-parsed and re-counted after the edit (21 Lisbon entries total,
    up from 20) to confirm the object is still well-formed, not just
    eyeballed.
  - **Airport → City Center Options enriched, not replaced**: the
    existing Aerobus row now names its two real lines (Line 1 to Cais do
    Sodré, Line 2 to Avenida José Malhoa, both ~7:30am–11pm, buses every
    20–25 min) instead of just "a shuttle." The Getting Around table's
    Taxi row now carries the real official tariff structure (€3.25 base
    + €0.47/km + €14.80/hour waiting, nighttime a bit higher) and the
    real named apps (Uber, Bolt, Free Now, Cabify) instead of just a
    fare-range guess.
  - **A new `<h4 id="practical-info-lisbon">Practical Info & Quick
    Facts</h4>` table** — population, electricity (220V/50Hz, Type F),
    the emergency number (112, same as Spain), phone country/area code,
    shop hours, pharmacy rotation, the main post office, the Turismo de
    Lisboa tourist-info office contact, and local newspapers.
    **Deliberately checked for a Spain-city precedent before building
    this, and found none** — Madrid/Barcelona have no equivalent
    "quick facts" block, so this isn't mirroring an established pattern,
    it's new structure. Checked it wouldn't duplicate the existing
    "Portugal — Must-Know Numbers & Rules" table first (that table only
    covers Schengen/currency/flight-time cross-references, nothing about
    population, electricity, or a tourist office contact) before adding
    it — placed right after Currency & Practical Money Tips, before
    Culture & Etiquette, since it's the same cluster of "logistics a DE
    might need mid-call" content.
- **Deliberately NOT added**: two paid tour products mentioned only by
  name and a booking link (Best of Lisbon Guided Walking Tour, Lisbon
  Food & Wine Tour) and the Sunset Cruise on the Tagus — none carry the
  kind of standalone, address-anchored fact this guide's other entries
  are built from, and this file has no established "bookable tour
  product" section to slot them into the way Madrid/Barcelona's
  itinerary/tour data does; worth a "Tours & Activities" pass later if
  wanted, not invented here on a guess. Bars/nightlife/restaurants/cafés
  in the PDF all matched what was already in the guide exactly — zero
  new entries needed there, a good independent confirmation the earlier
  Lisbon batch got those right.
- Verified via this project's established non-script-content discipline:
  full tag-balance recount (div/table/tr/td/th/thead/tbody/ul/li/h3/h4
  all exactly even after the new rows), a file-wide duplicate-`id` sweep
  (zero new duplicates — the same 4 pre-existing, unrelated Client
  Tracker bulk-action ids from the previous entry are unchanged), a
  `QB_RESTAURANTS` re-extract-and-`JSON.parse` after the Ler Devagar
  addition, and all 17 `<script>` blocks re-verified via `new Function()`
  parsing (unaffected — this batch was pure HTML/table/data content, no
  script logic touched).
- **Unverified live, same caveat as the rest of this Portugal build-out**:
  none of this batch's specific facts (the new attractions' hours/
  addresses, the Aerobus line numbers, the real taxi tariff, the
  Freeport shuttle schedule, the tourist-office phone number) have been
  checked against a live source from this environment beyond the PDF
  itself — transcribed faithfully from the PDF's text, not independently
  re-confirmed. Whether the new "Practical Info & Quick Facts" table
  reads as a natural fit for this guide (versus feeling like a bolted-on
  new pattern, given it has no Spain-city precedent) is also genuinely
  unverified — worth a look next time the Lisbon section is reviewed.

## The Azores — a brand-new Portugal destination, built from a second official PDF (Sep 2026, unverified live)

The DE uploaded a second official-looking PDF ("azores_en.pdf," 17 pages)
with no accompanying instruction beyond the file itself — read the same
way the Lisbon PDF was: as source material to build a new, full
destination section from, matching this guide's established structure as
closely as the content shape allows. Unlike the Lisbon PDF, this wasn't
enriching an existing section — the Azores didn't exist anywhere in this
guide before this pass (confirmed via a zero-match grep first).

- **PDF extraction worked cleanly this time** — the `pdfminer.six` +
  `cffi`/`cryptography` fix from the Lisbon PDF session carried over
  (already installed in this environment), so no repeat troubleshooting
  was needed.
- **The same jumbled-column extraction artifact from the Lisbon PDF
  showed up again, worse** — this PDF's address blocks were frequently
  positioned next to the WRONG venue heading, to the point where several
  initial name→address pairings, on first read, would have been outright
  wrong (e.g. an address block sitting right after "Tony's Restaurant"
  in the raw text turned out — confirmed by its own website domain,
  `restaurantecais20.pt` — to actually belong to Cais 20 Restaurant).
  **A new, more reliable cross-check was used this pass, worth reusing
  on future Portugal PDFs**: the Azores' own Practical Info section gives
  three real telephone area codes by island group (São Miguel &amp;
  Santa Maria: 296 · Terceira, Graciosa &amp; São Jorge: 295 · Pico,
  Faial, Flores &amp; Corvo: 292) — cross-referencing every phone number
  against which island its stated address claims, on top of matching
  domain names/emails to venue names and matching body-text place-name
  mentions (e.g. "Angra do Heroísmo Bay," "Furnas," "the island of
  Faial") against known island geography, resolved every dining/nightlife/
  shopping venue with real confidence. One fact ("Aguas Quentes, cauldrons
  of boiling sulphurous water... rivers leading to a tranquil waterfall")
  couldn't be confidently attributed to any specific named attraction
  after this process and was left out entirely rather than guessed onto
  the nearest heading — same "don't guess" discipline as the Escape Hunt
  Experience omission from the Lisbon pass.
- **Structured as a new top-level `<h3 id="p2-azores">`**, positioned
  right after Lisbon's `<h4 id="hotels-lisbon">` and before Porto's
  compact `<h4 id="porto-city">` block — giving the Azores the same full
  "city-level" treatment Lisbon got (this PDF was just as rich a source
  as Lisbon's), rather than the lighter Porto/Sintra/Douro-Valley/Algarve
  format those four still have pending their own richer source material.
  Continues the `p`-prefixed id sequence established for Portugal
  (`p1-lisbon`, now `p2-azores`) specifically to avoid ever colliding
  with Spain's `1`-prefixed city ids, per the duplicate-id bug found and
  fixed in the first Lisbon pass.
- **Adapted the subsection list for an archipelago rather than copying
  Lisbon's city subsections verbatim** — no single "Key Neighborhoods"
  table makes sense for nine separate islands, so it became **"The
  Islands — One Location, Nine Unique Worlds"** (a table of all 9
  islands' character, matching the PDF's own framing line), a real
  **Airports** table (5 islands have their own international airports:
  PDL/HOR/TER/SMA/PIX), and an **Inter-Island Travel &amp; Getting
  Around** section (SATA domestic flights, Atlanticoline/Transmaçor
  ferries, which islands have bus/taxi/rental cars, two named rent-a-car
  companies, per-island taxi phone numbers) — none of which exist in any
  form for Lisbon, since Lisbon is a single city with no inter-location
  transport question to answer.
- **Key Attractions**: 13 rows, each explicitly tagged with its island
  (Whale Watching, Pico's Volcanic Landscape/UNESCO vineyard landscape,
  Lagoa das Sete Cidades, Lagoa do Fogo, Capelinhos Volcano + its
  Interpretation Center, Algar do Carvão, Furna do Enxofre, Rocha dos
  Bordões, Caldeirão, Fajã da Caldeira do Santo Cristo, Museu Carlos
  Machado, Santana Astronomical Observatory) plus a "worth knowing" scuba
  diving note — every one resolved via the area-code/domain/place-name
  cross-check described above, not positional guesswork.
- **`QB_RESTAURANTS.Azores`** — a genuinely new city key (the Quote
  Builder already handles a missing key safely everywhere via
  `QB_RESTAURANTS[city] || []`, same as when Lisbon was first added) —
  13 entries (8 restaurants, 5 cafés), each `addr` naming the specific
  island so a DE building a quote can tell at a glance which island a
  recommendation is actually on. Same disclosed caveat as Lisbon's
  restaurant data: `vkind`/price tier were inferred from how each place
  was described, not given as exact figures — worth a spot-check before
  quoting. **Not added to `QB_CITY_ORDER`** — same deliberate deferral as
  Lisbon, consistent behavior rather than a new inconsistency.
- **Bars &amp; Nightlife and Shopping built as guide-prose tables**,
  matching Lisbon's pattern exactly (not folded into `QB_RESTAURANTS`,
  same reasoning as Lisbon's nightlife section — a UI mismatch with the
  restaurant/dinner picker). Peter Café Sport's own real "if you sail to
  Horta and you don't visit Peter's, you have not actually been to
  Horta" line was kept verbatim — a genuinely well-known, quotable fact
  worth a DE having ready for a Faial-bound client.
- **Food &amp; Culture**: led with Cozido das Furnas (the volcanic-heat-
  cooked stew near Furnas Lake, ~5–6 hours, needs advance booking) as the
  single most distinctive, client-differentiating fact in the whole
  section — a genuinely unique experience with no mainland-Portugal
  equivalent, flagged as worth building into any São Miguel itinerary.
- **A new `<h4 id="practical-info-azores">` table**, matching the pattern
  just established for Lisbon (population, electricity, emergency
  number, phone codes, shop/pharmacy hours, tourist info line, local
  newspapers) rather than inventing a third variant — now a real,
  repeatable pattern across two Portugal destinations.
- **Passport &amp; Visa**: same cross-reference-to-Spain's-section
  treatment as Lisbon, for the identical reason — this PDF repeats the
  same "ETIAS required starting late 2025" framing that conflicts with
  the guide's own verified "not yet in effect as of Aug 2026" section,
  so no new, second conflicting passport/visa section was created.
- **Deliberately not built**: a "Best Time to Visit" or "Brief History"
  subsection — unlike the Lisbon PDF, this source material contained no
  explicit seasonal-recommendation or historical-era content to draw
  from, and the Azores' actual climate (Atlantic, wetter/cooler
  year-round than mainland Portugal) is different enough from Lisbon's
  that reusing Lisbon's own climate guidance would have been a real
  guess dressed up as fact — left out entirely rather than fabricated,
  consistent with this project's own "don't guess" discipline stated
  everywhere else in this file.
- Verified via this project's established non-script-content discipline:
  full tag-balance recount (div/table/tr/td/th/thead/tbody/ul/li/h3/h4
  all exactly even after the new section), a file-wide duplicate-`id`
  sweep (zero new duplicates — the same 4 pre-existing, unrelated Client
  Tracker bulk-action ids are unchanged), a `QB_RESTAURANTS`
  re-extract-and-`JSON.parse` confirming both the new `Azores` key (13
  entries) and the untouched `Lisbon` key (still 21) are well-formed,
  and all 17 `<script>` blocks re-verified via `new Function()` parsing
  (unaffected — pure HTML/table/data content, no script logic touched).
- **Unverified live, same caveat as the rest of this Portugal build-out,
  and unusually so given how much cross-referencing this pass needed**:
  none of this section's specific facts (venue hours/addresses/phone
  numbers, the area-code-to-island-group mapping itself, the airport
  distances, the ferry season dates) have been checked against a live
  source beyond the PDF text and the area-code cross-validation
  described above — transcribed and reconciled, not independently
  re-confirmed. The venue-to-address resolutions specifically are worth
  a DE spot-check before quoting anything from this section to a
  client, given how much reconciliation work the raw PDF extraction
  needed to get right.

## Porto promoted from a compact summary to a full city section, built from a third official PDF (Sep 2026, unverified live)

A third PDF ("porto_en.pdf") arrived immediately after the Azores build,
with no accompanying instruction — same pattern as the previous two:
treated as source material to build out against this guide's established
structure. Unlike Lisbon (a fresh `<h4>` promoted to `<h3>`) and the
Azores (a genuinely new destination), **Porto already existed** as a
compact `<h4 id="porto-city">` block (six short paragraphs: Why clients
love it / Getting there / Signature sites / Food &amp; culture / Best
time to visit / Hotels) from earlier Portugal work — this PDF was rich
enough to justify promoting it to the same full `<h3>` treatment Lisbon
and the Azores already have, rather than just patching the compact
version.

- **Kept the exact same `id="porto-city"`** when promoting the tag from
  `<h4>` to `<h3>` — deliberately, not by accident. A live JS color-map
  object (`'porto-city': '#722f37'`, feeding the interactive route map's
  city-coloring) references this id by string, and ids are what
  `getElementById`/CSS/anchors key off, not tag names — so changing the
  tag while preserving the id kept that reference (and any other latent
  one) working with zero JS changes needed. This is the opposite lesson
  from the `17-lisbon`→`p1-lisbon` duplicate-id fix earlier in this
  build-out: that bug was fixed by CHANGING an id; this one was kept
  correct by deliberately NOT changing an id that didn't need to.
- **Adapted the subsection list for a real city (unlike the Azores),
  closer to Lisbon's own shape** — Airport, Getting Around, Best Time to
  Visit, Key Attractions, Day Trips, Food &amp; Culture, Bars &amp;
  Nightlife, Shopping, Practical Info &amp; Quick Facts, Hotels. All the
  old compact section's real content (the "tripeiros" nickname, the
  francesinha, the Port wine style differences, the Ribeira/Livraria
  Lello/Dom Luís I Bridge highlights) survives inside the new structure —
  nothing was thrown away, just expanded into the same real-venue,
  real-hours, real-address shape Lisbon and the Azores already use.
- **17 Key Attractions rows** — Ribeira, Porto Cathedral, Clérigos Tower,
  Livraria Lello, Dom Luís I Bridge, São Bento Railway Station, Bolhão
  Market, Port Wine Caves at Vila Nova de Gaia (folding in Taylor's, once
  a phone/website mismatch was resolved — see below), Stock Exchange
  Palace, Monument Church of St Francis, Church of Santa Clara, Soares
  dos Reis National Museum, Serralves Museum of Contemporary Art, Estádio
  do Dragão, Portuguese Centre of Photography, Jardins do Palácio de
  Cristal, and the Tower of Dom Pedro Pitões — the last one doubling as a
  useful cross-reference, since it turns out to literally BE the Porto
  Tourism Office building named separately in the Practical Info table.
- **A real resolved mismatch, caught by domain-name cross-checking**:
  a phone number and `www.taylor.pt` sat next to an unrelated address
  block (`Rua do Carmo 17` — actually Garrafeira do Carmo, a bottle shop,
  confirmed by its own domain `garrafeiracarmo.com` appearing elsewhere)
  in the raw extraction. Since Porto's phone numbers all share one area
  code ((0)22), the area-code cross-check that resolved the Azores PDF's
  jumbling doesn't work here — instead, the domain name itself
  (`taylor.pt`, unmistakably Taylor's Port) was the deciding signal,
  paired with Taylor's own real address (Rua do Choupelo 250, Vila Nova
  de Gaia — already confirmed separately in the raw text) to reconstruct
  the correct entry and leave Garrafeira do Carmo's own listing without
  a phone number rather than assign it someone else's.
- **`QB_RESTAURANTS.Porto`** — a new city key, 10 entries (7 restaurants,
  3 cafés): Chez Lapin, ODE Porto Wine House, Yeatman's Restaurant (2
  Michelin stars, 2017 — the one `stars` value set to 1 in this
  session's Portugal data, matching how Madrid/Barcelona already encode
  a Michelin star count), Mauritânia, Cafeína, Mal Cozinhado, Praia Da
  Luz (a restaurant/beachside-café hybrid — the PDF listed it twice,
  once under Dining and once again under Bars &amp; Nightlife with
  identical address/phone; added once), Café Majestic, Café Guarany, and
  Tavi — Confeitaria da Foz (positioned under the PDF's "BARS &amp;
  NIGHTLIFE" heading in the raw text, but its own body text is
  unambiguously café-shaped — "gorgeous cafe and restaurant serving
  sweet and savoury pastries" — so classified by content, not by section
  heading, same discipline the Lisbon pass already established for
  Pôr Do Sol/Canto Da Doca in the Azores build). **Not added to
  `QB_CITY_ORDER`** — confirmed it still only lists the 10 Spain cities,
  so Porto joins Lisbon and the Azores in the same deliberate deferral,
  not a new inconsistency.
- **9 Bars &amp; Nightlife venues** built as a guide-prose table
  (Plano B, The Wall Bar, Baixa Bar, Hot Five Jazz &amp; Blues Club, Pipa
  Velha Petisqueira, Passos Manuel, Bar Labirintho, Café Candelabro,
  Lais de Guia) — Café Candelabro is explicitly a café-winebar-bookshop
  hybrid but was kept here rather than in Dining, since its own body
  text foregrounds the winebar/bohemian-bar identity over the café one
  (the reverse judgment call from Tavi above, made the same way — by
  what the venue's own description actually emphasizes).
- **7 Shopping venues plus the 3 open-air markets already named in
  prose** (Mercado do Bolhão cross-referenced to its own Key Attractions
  entry rather than duplicated, Mercado Porto Belo, Vandoma Fleamarket) —
  Centro Comercial Via Catarina, Arcádia, A Pérola do Bolhão, Portosigns,
  Casa Da Guitarra, Garrafeira do Carmo, Mercado Bom Sucesso — plus a
  jewellery note (David Rosas, Pedro A Baptista) matching the "worth
  knowing, not a full listing" bullet-note pattern this guide already
  uses for things like Lisbon's surfing mention.
- **A genuinely stale search-index entry found and fixed, not just
  content added elsewhere.** This file has an internal `SEARCH_INDEX`
  array (used by the guide's own in-page search) with a `"porto-city"`
  entry whose `text` field was still a compressed summary of the OLD
  six-paragraph compact section — confirmed Lisbon and the Azores have
  NO search-index entries at all (a pre-existing, accepted gap for both,
  not something this pass needs to fix), but Porto's entry existed and
  would have been actively misleading once the real page content moved
  far past it. Rewrote the `text` field to name the real new content
  (all 17 attractions, the day trips, the dining/nightlife/shopping
  sections' existence, the festival names) at the same "compressed
  summary, not full page text" density the field already used — a
  targeted fix for a real regression this promotion would otherwise have
  quietly caused, not a new feature.
- Verified via this project's established non-script-content discipline:
  full tag-balance recount (div/table/tr/td/th/thead/tbody/ul/li/h3/h4
  all exactly even after the new section), a file-wide duplicate-`id`
  sweep (zero new duplicates — the same 4 pre-existing, unrelated Client
  Tracker bulk-action ids are unchanged, and `porto-city` itself
  confirmed to still resolve to exactly one element), a
  `QB_RESTAURANTS` re-extract-and-`JSON.parse` confirming the new
  `Porto` key (10 entries) alongside the untouched `Azores` (13) and
  `Lisbon` (21) keys, and all 17 `<script>` blocks re-verified via
  `new Function()` parsing (unaffected — pure HTML/table/data/search-
  index-string content, no script logic touched).
- **Unverified live, same caveat as the rest of this Portugal build-out**:
  none of this section's specific facts (venue hours/addresses/phone
  numbers, the festival names, the Taylor's/Garrafeira do Carmo
  reconciliation specifically) have been checked against a live source
  beyond the PDF text and the domain-name cross-check described above.
  Whether the promoted `<h3>` Porto section now visually/structurally
  matches Lisbon and the Azores as intended, and whether the interactive
  map's `porto-city` color-coding still renders correctly with the tag
  change, haven't been seen in a real browser from this environment.

## DMCs in Portugal — filled from the official Job Aid, no more guessing (Sep 2026, unverified live)

The Portugal section has had a placeholder `<h3 id="portugal-dmcs">` stub
since it was first scaffolded, explicitly flagged (both there and in the
Portugal "Must-Know Numbers & Rules" table) as "unconfirmed — confirm the
correct vendor(s) via TMT/Job Aid before quoting." This pass replaces that
placeholder with real, sourced content — a mix of a pasted "Local DMCs /
Lesson 1 of 4" write-up, several screenshots of the underlying Job Aid
slides, and finally the official `Job_Aid_Portugal.xlsx` itself, which
resolved the one genuine ambiguity the screenshots left open.

- **The screenshots initially left a real attribution question
  unresolved, and the xlsx settled it rather than requiring a guess.**
  Two DMC cards (Explore Portugal, Lusanova) each showed a "Communication"
  subsection; a third screenshot titled "Individual Strengths and
  Considerations" (large-group rates, full customization, no last-minute
  high-season bookings) had no DMC name attached to it, so which DMC it
  belonged to was genuinely ambiguous from the images alone. The
  `5 - DMCs` sheet in the xlsx Job Aid answered this directly: Explore
  Portugal and Lusanova have **identical** Strengths/Considerations/
  Customization text in the source table — the "Individual Strengths"
  screenshot applies to both equally, not one specific DMC. The only real
  difference between the two vendors is their Communication row (Explore
  Portugal: email only, no online portal; Lusanova: email plus a real
  online portal for hotel rates/availability) — confirmed by the
  screenshots and the xlsx agreeing exactly.
- **Built to mirror `<h3 id="116-dmcs-in-spain">DMCs IN SPAIN</h3>`'s
  established structure** (checked directly before writing anything, per
  this build-out's own standing discipline): an Overview, an
  exam-tagged "must select one, cannot be mixed" key rule, then a real
  DMC/Strengths/Considerations/Customization/Communication comparison
  table — same five columns Spain's own Liberty Spain/Spaintop table
  uses. The `Considerations` column also carries two facts from the xlsx
  that weren't visible in any screenshot: Portugal DMCs need **full
  passport details to book train tickets**, and neither allows an
  "optional" itinerary change within 30 days of travel (on top of the
  already-screenshotted 30-day high-season booking cutoff).
- **The Lusanova portal login is included, sourced from the xlsx's own
  `5 - Tariff or Portal` sheet** (`KensingtonTours` / `kensington`) —
  treated the same way this guide already treats any other real,
  DE-facing operational credential from an official KT source document,
  not customer PII; flagged with a note to confirm it's still current in
  TMT/Teams before relying on it, the same "shared vendor login can
  rotate" caveat any such credential deserves.
- **Dynamic vs. Kensington Contracted rate types were NOT re-documented
  from scratch** — a general `<h3 id="vendors-and-sourcing-rates">`
  section already exists (company-wide, not Spain-specific — confirmed by
  reading it directly before deciding this) covering exactly this
  distinction. The new Portugal DMC section links to it and adds only the
  two Portugal-specific facts from the DE's own pasted "Lesson 1" text:
  Dynamic rates' instant-booking advantage matters more here because
  Portugal hotel availability is often tight (especially weekends), and
  Kensington Contracted rates are separately worth checking too — not a
  duplicate rate-type explainer, just the destination-specific color the
  general section can't provide.
- **The stale cross-reference fixed too, not just the section it pointed
  to.** The Portugal "Must-Know Numbers & Rules" table had a
  `⚠️ DMC — unconfirmed` row pointing at "Section 'DMCs in Portugal'
  below" — updated to name the two real DMCs now that they're actually
  documented, while still honestly flagging that tour/tariff-level
  pricing itself isn't in this guide yet (confirm rates in TMT), since
  the xlsx's DMC sheet documents vendor comparison, not pricing.
- **A false-positive tag-balance alarm investigated and correctly ruled
  out, not worked around by editing content that didn't need it.** This
  edit's own verification pass initially showed h3/h4 counts off by
  several (81/78 and 223/221) — investigated rather than dismissed, and
  traced to the pre-existing `SEARCH_INDEX` JS array: several of its
  `"text"` field values end mid-tag with a literal, un-terminated `<h3`
  or `<h4` substring (an artifact of however that index's text was
  originally extracted from the real page, unrelated to Portugal or this
  session's own edits — the same false-positive shape this file's own
  history already documents for `<button>`/`<span>`/`<table>`/`<details>`
  mentions inside prose comments, just not this exact spot before). A
  regex tag-count that doesn't exclude `<script>` content picks these up
  as if they were real opening tags. Re-run excluding all `<script>...
  </script>` blocks: h3 77/77, h4 204/204, and every other tracked tag
  exactly balanced — confirming the real rendered markup is fine and this
  was a pre-existing quirk in search-index data, not something this
  edit broke. Worth remembering for any future balance check on this
  file: exclude script content first, or a `SEARCH_INDEX` string can
  produce a phantom mismatch that has nothing to do with the actual page.
- Verified via this project's established non-script-content discipline:
  the corrected (script-excluded) tag-balance recount above, a file-wide
  duplicate-`id` sweep (zero new duplicates — the same 4 pre-existing,
  unrelated Client Tracker bulk-action ids are unchanged; this edit added
  no new `id` attributes at all, only a table/list/paragraph and a link
  to the already-existing `#vendors-and-sourcing-rates` anchor), and all
  17 `<script>` blocks re-verified via `new Function()` parsing
  (unaffected — pure HTML/table content, no script logic touched).
- **The xlsx Job Aid is much bigger than just the DMCs sheet — flagged
  here rather than acted on speculatively.** `Job_Aid_Portugal.xlsx` also
  contains `6 - Top Itineraries`, `7 - Arrivals and Transfers`,
  `8 - Top Tours`, `8 - Popular Attractions`, `Pronounciation`, and
  `9 - Top Hotels` sheets — real, substantial source material (the Tours
  and Hotels sheets alone are each ~25–32K characters of raw extracted
  data) that hasn't been read or placed into the guide yet. Its `KEY`
  sheet also names two Portugal regions/destinations this guide hasn't
  touched at all yet: **Madeira** (alongside the already-partially-built
  Porto & North / Lisbon & Central / South & Algarve / Azores groupings).
  Deliberately not acted on in this same pass — the DE has been working
  through this material as a paced "Lesson X of 4" sequence, and jumping
  ahead to Tours/Attractions/Hotels/Transfers/Pronunciation without being
  asked would get ahead of that pacing rather than diligently follow it.
  Raw sheet dumps are saved at
  `scratchpad/xlsx_*.txt` for when those lessons/sections come up.
- **Unverified live, same caveat as the rest of this Portugal build-out**:
  none of this section's facts have been checked against a live source
  beyond the Job Aid xlsx/screenshots/pasted text themselves — transcribed
  faithfully from official KT source material, not independently
  re-confirmed. Whether the DMC comparison table reads clearly against
  Spain's own parallel section, and whether the Lusanova portal
  credentials are still current, are both worth a DE spot-check.

## Two real KT practice-exam screenshots confirm the Portugal DMC content, added to Quiz Mode (Sep 2026, unverified live)

Right after the DMCs-in-Portugal section shipped, the DE sent two
screenshots of an official KT practice-quiz UI (numbered "01/03"/"02/03",
multiple-choice with a marked correct answer) — no accompanying text, same
"treat this as source material" pattern as the PDF uploads earlier in this
build-out.

- **Read as independent confirmation first, not just new content.** Both
  questions' correct answers line up exactly with what the DMC section
  already states: Q1 ("last-minute Portugal trip for a family of 7, multi-
  city, needs a driver AND guide throughout") is answered "Use Explore
  Portugal OR Lusanova for the entire trip" — the marked-wrong distractor
  option ("use Lusanova for touring and Explore Portugal for transfers")
  is exactly the "mixing them" trap the guide's own Key Rule already warns
  against. Q2 ("confirm hotel availability over a weekend for a price-
  conscious client") is answered "Use Dynamic to search for rates and book
  instantly" — matches the guide's own "Dynamic rates offer instant
  booking... especially valuable over weekends, since hotel availability
  is often a challenge in Portugal" line word-for-word in substance. No
  content correction was needed — this was a genuine independent check
  that the DMC section built from the xlsx/screenshots/pasted text got it
  right, not a new source correcting an error.
- **Found this guide's own Quiz Mode is a fixed flashcard deck
  (`QUIZ_CARDS`), not the multiple-choice format in the screenshots** —
  confirmed by reading the actual quiz code (`startQuiz`/`showQuizCard`)
  before assuming anything: `QUIZ_CARDS` is a static JS array of
  `{section_id, section_title, fact}` objects, shown one at a time as
  "What's the key fact here?" / reveal / Got it / Review again. The
  screenshots are from a *different*, official KT-made multiple-choice
  quiz tool, not this guide's own feature — so there was no live quiz UI
  to directly cross-check, only the underlying facts.
- **Added two new `QUIZ_CARDS` entries for `portugal-dmcs`**, mirroring
  the exact pattern the existing three `116-dmcs-in-spain` entries already
  establish (the Key Rule, the "cannot be mixed" fact, and the DENIR-
  naming trap) — one card for the "cannot be mixed, even for a large
  multi-city trip needing both a driver and guide" scenario Q1 tested, one
  for the "Dynamic = instant weekend booking" scenario Q2 tested. Both
  worded as scenario-shaped exam-likely facts (matching how the Spain
  cards phrase theirs), not just restating the section's prose verbatim.
- Verified via this project's established non-script-content discipline
  (this was one JS array-literal edit inside an existing `<script>` block,
  so both syntax parsing and the script-excluded HTML tag-balance check
  applied): all 17 `<script>` blocks re-verified via `new Function()`
  parsing (confirms `QUIZ_CARDS`' array literal is still syntactically
  valid — the two new objects didn't break the array), a full tag-balance
  recount with `<script>` content excluded (div/table/tr/td/th/thead/
  tbody/ul/li/h3/h4 all exactly even, unaffected — pure JS data, no HTML
  markup touched), and the duplicate-id sweep (unchanged from baseline —
  no `id` attributes were touched by this edit at all).
- **Unverified live**: whether Quiz Mode actually surfaces these two new
  cards in a real shuffle/session, and whether the phrasing reads clearly
  as a flashcard prompt-then-reveal (versus the multiple-choice format the
  screenshots themselves used) — hasn't been seen in a real browser from
  this environment. Test next: open 🧠 Quiz from the study-tools row and
  click through enough cards to confirm one of the two new Portugal DMC
  facts appears and reveals correctly.

## Portugal Key Locales: a nights/alternatives/add-ons quick-reference table (Sep 2026, unverified live)

Direct continuation of the Portugal build-out, this time a "Key Locales /
Lesson 1 of 5" paste — a Portugal-overview intro paragraph, a map
screenshot pinning Lisbon and Porto, and two structured locale cards
(Porto, Lisbon) each with a short description, a Recommended # of Nights,
Alternatives, and Typical Add-Ons.

- **Checked for a matching Spain pattern first, and found there isn't
  one** — Spain's own `<h3 id="13-spain-key-locales-overview">` covers
  regional structure and a site↔locale matching table, nothing shaped like
  "how many nights / what else could substitute / what add-ons pair with
  it." This is genuinely new structure, not a mirror of an existing
  pattern — added as its own `<h4 id="locale-planning-quick-reference-
  portugal">Locale Planning Quick Reference</h4>` table (Locale/
  Recommended Nights/Alternatives/Typical Add-Ons) right inside the
  existing `portugal-key-locales-overview` section, populated with the two
  rows this lesson provided (Lisbon: 4 nights; Porto: 3 nights). Framed
  explicitly as a fast itinerary-sketching reference distinct from the
  full destination write-ups below it (orientation/hotels/attractions),
  not a replacement for them.
- **The map screenshot was read for its facts, not treated as an asset to
  embed.** Same standing rule from the earlier Lisbon Key-Attractions
  decision (real Wikimedia image URLs vs. this network-less environment's
  inability to verify a guessed one) — a screenshot pinning Lisbon/Porto
  on a map of Portugal confirms geography already correctly reflected in
  this guide's prose (Porto north, Lisbon central-west coast), so nothing
  needed correcting; no attempt was made to recreate or embed the image
  itself.
- **The existing intro paragraph was extended, not replaced**, to work in
  the new framing without losing anything already there: kept the
  original "four mainland/near-mainland areas" list (Lisbon/Porto/Sintra/
  Algarve) and the Douro Valley/Azores notes verbatim, and added two new,
  genuinely new facts from this lesson's own text — naming **Albufeira**
  and **Cascais** specifically as the Algarve/coastal locales referenced
  only generically before, and naming **Madeira** for the first time
  anywhere in this guide's prose (previously only known from the xlsx
  Job Aid's own `KEY` sheet region list, flagged but not yet acted on in
  the DMCs-in-Portugal entry above). Madeira is explicitly flagged as "a
  real KT-sold destination... don't treat its absence here as 'Kensington
  doesn't sell it'" — stating plainly that the guide's own coverage gap
  isn't a fact about what Kensington offers, matching this project's
  standing "don't let an absence read as a false negative" discipline.
- **Porto's UNESCO claim cross-checked against the guide's own existing
  content before being accepted**, not assumed correct just because it
  was pasted: confirmed via grep that Porto's Ribeira district (the
  historic riverside quarter, already documented in Porto's own Key
  Attractions table) is the real UNESCO-inscribed "Historic Centre of
  Porto" — the new blurb's UNESCO claim is consistent with what's already
  there, not a new fact needing its own citation.
- Verified via this project's established non-script-content discipline
  (pure HTML — one revised paragraph, one new `<h4>`, one new 2-row
  table, no `<script>` content touched): all 17 `<script>` blocks
  re-verified via `new Function()` parsing (unaffected), a full
  script-excluded tag-balance recount (div/tr/td/th/thead/tbody/ul/li/h3
  all held exactly even; table 142→143 and h4 204→205, matching the one
  new table and one new `<h4>` added, both internally balanced), and the
  duplicate-id sweep (unchanged from baseline — the two new ids,
  `locale-planning-quick-reference-portugal` and nothing else, are both
  genuinely new, non-colliding strings).
- **Deliberately not built**: rows for Albufeira, Cascais, Sintra, the
  Algarve generally, the Azores, or Madeira in the new quick-reference
  table — this lesson only provided Nights/Alternatives/Add-Ons data for
  Lisbon and Porto specifically ("Lesson 1 of 5" implies four more
  installments likely cover the rest); adding placeholder or guessed rows
  for the others would contradict this session's own "don't guess, place
  diligently as it arrives" discipline stated from the very start of the
  Portugal build-out.
- **Unverified live, same caveat as the rest of this Portugal build-out**:
  none of the two nights/alternatives/add-ons figures have been checked
  against a live source beyond the DE's own pasted lesson text — worth a
  spot-check that "4 nights for Lisbon, 3 for Porto" reads as the right
  recommendation once seen against real client scenarios. Whether the new
  quick-reference table's placement (right at the top of Key Locales
  Overview, before the full city write-ups) reads clearly at a glance in
  a real browser also hasn't been seen outside this environment.

## Locale Planning Quick Reference: Albufeira and Cascais added (Sep 2026, unverified live)

Direct continuation — "Key Locales / Lesson 2 of 5" by implication (the
DE's own "Albufeira & Cascais" map screenshot plus two matching locale
cards, same exact shape as Lisbon/Porto's Lesson 1 cards).

- **Two new rows added to the existing `Locale Planning Quick Reference`
  table** (built in the previous entry): Albufeira (3 nights; alternative
  Cascais; add-ons: extend beach time or explore inland/coastal villages,
  or extend into Seville, Spain) and Cascais (2 nights; alternatives the
  Algarve for beachgoers or Évora for a wine alternative; add-ons: a
  Sintra day trip or hiking the Sintra-Cascais Natural Park). Table
  reordered alphabetically (Albufeira, Cascais, Lisbon, Porto) now that
  it's not just a two-row list — easier to scan than arrival order once
  it's genuinely a reference table, and nothing about the previous two
  rows' content changed, only their position.
- **A short comparison paragraph added under the table**, not a full
  destination write-up — contrasts Albufeira (beach-resort/adventure base)
  against Cascais (a quieter, relaxing coastal town, not primarily a
  beach-resort base) directly, since the two are easy to conflate as "the
  same kind of Portugal coastal stop" without a client-facing distinction
  actually spelled out. Kept brief and cross-referencing rather than
  duplicating the individual card blurbs already captured in the table's
  Add-Ons/Alternatives cells.
- **The "extend into Seville, Spain" add-on is worth flagging, not
  quietly absorbed** — the first genuinely cross-border Spain+Portugal
  itinerary fact to land in this Portugal build-out (matching the very
  first instruction at the top of this whole build-out: "a unified
  Spain+Portugal map/city system," confirmed up front, not two separate
  ones). No corresponding note was added to Spain's own Andalusia/Seville
  content pointing back the other way — that would be inventing a fact
  this lesson didn't actually provide, not transcribing one; worth adding
  if/when a future lesson states it from the Spain side too.
- **Neither locale exists as its own full destination section yet** (only
  Lisbon, the Azores, and Porto have been promoted to full `<h3>` write-
  ups so far) — these two rows are deliberately scoped to what this
  lesson actually gave (the quick-reference fields), not stretched into
  a premature full section the source material doesn't support yet,
  consistent with how Sintra/Douro Valley/Algarve are still waiting on
  their own richer material.
- Verified via this project's established non-script-content discipline:
  all 17 `<script>` blocks re-verified via `new Function()` parsing
  (unaffected — pure HTML), a full script-excluded tag-balance recount
  (div/th/thead/tbody/ul/li/h3/h4 all held exactly even; table unchanged
  at 143/143 since no new table was added, only rows to the existing one;
  tr and td incremented by exactly the two new rows' worth, both
  internally balanced), and the duplicate-id sweep (unchanged from
  baseline — no new `id` attributes were added by this edit).
- **Unverified live**: whether "3 nights for Albufeira, 2 for Cascais"
  reads as the right recommendation against real client scenarios, and
  whether the new comparison paragraph's Albufeira-vs-Cascais framing
  actually helps a DE choose between them at a glance — neither has been
  checked outside this environment. Test next: read the Locale Planning
  Quick Reference table in a real browser and confirm the four rows scan
  cleanly together now that it's grown past two entries.

## Azores Locale Planning Quick Reference: Faial, São Miguel, Terceira (Sep 2026, unverified live)

Direct continuation of the Key Locales lesson series — this batch covers
the Azores specifically (Faial, Terceira, then São Miguel arrived
mid-turn as a follow-up), the same nights/alternatives/add-ons card shape
as every locale in this series so far.

- **Given its own quick-reference table inside the Azores section, not
  folded into the mainland one.** The Azores' own `<h3 id="p2-azores">`
  section already states explicitly that it's "a genuinely different
  sell... worth positioning that way to clients rather than folding it
  into a standard Lisbon-Porto-Algarve itinerary" — mixing archipelago
  islands into the mainland `Locale Planning Quick Reference` table under
  `portugal-key-locales-overview` would have quietly contradicted that.
  Added a new, parallel `<h4 id="locale-planning-quick-reference-
  azores">Locale Planning Quick Reference</h4>` right after the existing
  "The Islands — One Location, Nine Unique Worlds" table (the natural
  spot — same placement logic as the mainland version sitting right after
  its own section's overview), with three rows: Faial (3 nights;
  alternatives Pico for hiking or São Jorge for coastlines; add-on a Pico
  day trip), São Miguel (4 nights; alternatives other Azores islands or
  Madeira; add-on combining with Terceira or Faial for island hopping),
  and Terceira (3 nights; alternative São Miguel for a more "well-rounded"
  stay; add-on Faial or São Jorge for continued exploration).
- **São Miguel's alternative — "other Azores islands, or Madeira" — is
  the second cross-Portugal-region itinerary fact in this lesson series**
  (after Albufeira's "extend into Seville, Spain" in the previous entry),
  and specifically the first one connecting the Azores to Madeira, a
  region this guide still has zero built-out content for (flagged as a
  real gap in both the DMCs-in-Portugal entry and the mainland Key
  Locales entry above). Transcribed as given — not expanded into
  anything about Madeira itself, since nothing about Madeira has actually
  arrived yet.
- **A real, useful new fact folded into the existing "The Islands" table
  rather than only living in the new quick-reference row**: Terceira's
  "Lilac Island" nickname (from this batch's own description paragraph)
  wasn't in the guide anywhere before — checked via grep to confirm, then
  added directly into Terceira's existing Character cell in "The Islands
  — One Location, Nine Unique Worlds" (built during the original Azores
  PDF pass), alongside its already-documented Angra do Heroísmo/UNESCO
  fact, rather than only appearing once in the new table's own prose.
  São Miguel's new blurb (hot springs, tea plantations, dramatic cliffs)
  was judged additive detail on an already-adequately-descriptive existing
  row, not corrective — left the existing "The Islands" row for São
  Miguel unchanged rather than editing a row that wasn't wrong.
- **Only the three islands this lesson actually covered got rows** —
  Santa Maria, Pico, São Jorge, Graciosa, Flores, and Corvo (all already
  named in "The Islands" table from the earlier PDF-sourced pass) still
  have no Locale Planning Quick Reference row, since no nights/
  alternatives/add-ons data has arrived for them yet. Same "don't guess,
  place diligently as it arrives" discipline as every other quick-
  reference table in this lesson series.
- Verified via this project's established non-script-content discipline:
  all 17 `<script>` blocks re-verified via `new Function()` parsing
  (unaffected — pure HTML), a full script-excluded tag-balance recount
  (div/th/thead/tbody/ul/li/h3 all held exactly even; table 143→144 and
  h4 205→206, matching the one new table and one new `<h4>` added, both
  internally balanced), and the duplicate-id sweep (unchanged from
  baseline — the new id, `locale-planning-quick-reference-azores`, is
  genuinely new and non-colliding).
- **Unverified live**: whether "4 nights for São Miguel, 3 each for Faial
  and Terceira" matches real client itineraries, and whether having two
  same-named "Locale Planning Quick Reference" sections in one guide (one
  under mainland Portugal, one under the Azores) reads as a clear,
  intentional parallel structure or as confusingly repeated in a real
  browser — neither has been checked outside this environment.

## Portugal — Top Itineraries (Job Aid): three real KT itineraries, correctly kept out of KT_LIVE_ITINERARIES (Sep 2026, unverified live)

"Top Itineraries / Lesson 2 of 5" — three named Kensington Portugal
itineraries (Best of Lisbon, Porto & the Algarve; Portugal Island Gems —
The Azores; Portugal Revealed: City to Coast), each with a KT tier, a
locale/nights breakdown, included transfers, and a client-facing
description, plus a map confirming geography already correct in the guide.

- **Checked whether this belonged in `KT_LIVE_ITINERARIES` before writing
  anything, and confirmed it doesn't — this was the real judgment call in
  this pass, not just placement.** Read the actual consuming code first:
  `KT_LIVE_ITINERARIES` entries are rendered with `` `Price: ${it.price}` ``
  and `` `Link: ${it.link}` `` **unconditionally** (no null-guard) inside
  the live `find_matching_itinerary` tool's official-results branch, and
  the offline Quote Builder's route-planner UI does the same
  (`` `${s.itin.duration} · from ${s.itin.price}` ``) — every existing
  entry in that array carries a real kensingtontours.com price and link,
  because it's populated from the live, bookable website (see Spain's own
  parallel `119-spain-itineraries-live-website-listings` section, which
  states exactly this). This lesson's three itineraries have neither a
  price nor a public link — they're internal training-deck content, not
  live site listings. Adding them to `KT_LIVE_ITINERARIES` with fabricated
  placeholder values would have been dishonest; adding them with `null`
  would have literally rendered "Price: null" / "Link: null" into the live
  AI's tool output and the Quote Builder's own UI — a real, self-inflicted
  bug, not just an aesthetic gap.
- **Spain already has the exact right structural home for this, so it was
  mirrored rather than invented**: `<h3 id="118-spain-top-itineraries-
  job-aid">SPAIN — TOP ITINERARIES (Job Aid)</h3>` is explicitly Spain's
  own training-deck itinerary content (Days/KT Level/Client Segment/
  Locales & Nights/Why this combo/Add-ons/Key caveats), kept structurally
  separate from `119-spain-itineraries-live-website-listings` (the real,
  priced, linked section that actually feeds `KT_LIVE_ITINERARIES`) — the
  two sections' own text states this relationship explicitly. Built the
  new `<h3 id="portugal-top-itineraries-job-aid">PORTUGAL — TOP
  ITINERARIES (Job Aid)</h3>` as the direct Portugal parallel, placed
  right before the existing `portugal-tmt-itineraries` placeholder,
  matching Spain's own Job-Aid-before-live-listings ordering.
- **Table columns adapted to what this lesson actually gave, not forced
  into Spain's exact column set.** Spain's Job Aid table has a "Client
  Segment" and "Key caveats" column this Portugal lesson didn't provide
  data for, and Portugal's own lesson gave an "Included transfers" field
  Spain's table doesn't have — kept the columns that map to real given
  data (Days/KT Level/Locales & Nights/Best for/Included transfers) rather
  than either inventing Spain-shaped fields with no content or renaming
  Portugal's real fields to force a cosmetic match.
- **The Azores itinerary's routing-logic note (why it starts in São
  Miguel and ends in Terceira) kept as its own exam-tagged callout**,
  matching this file's established convention for a specific, quotable,
  reasoning-carrying fact — mirrors the shape of Spain's own itinerary
  "Route logic" bullets in its Job Aid detail paragraphs.
- **The day-count/night-sum mismatches were left exactly as given, not
  "corrected."** Best of Lisbon/Porto/Algarve sums to 10 nights across an
  "11 Days" itinerary (consistent with a day trip or transit day not
  broken out as its own overnight), and Portugal Revealed sums to exactly
  7 nights for "7 Days" (no travel-day buffer) — transcribed faithfully
  rather than second-guessed, since this file has no authority to decide
  which convention Kensington's own itinerary titles use.
- Verified via this project's established non-script-content discipline
  (this was pure HTML — one new `<h3>`, one intro paragraph, one 5-row
  comparison table, one exam-tagged callout, no `<script>` content
  touched, and no changes to `KT_LIVE_ITINERARIES` or any consuming JS at
  all despite the investigation): all 17 `<script>` blocks re-verified via
  `new Function()` parsing (confirms `KT_LIVE_ITINERARIES` itself is
  byte-for-byte unchanged, not just syntactically valid), a full
  script-excluded tag-balance recount (div/th/thead/tbody/ul/li/h4 all
  held exactly even; table 144→145, tr/td incremented by exactly the new
  table's rows, h3 77→78, all internally balanced), and the duplicate-id
  sweep (unchanged from baseline — the new id,
  `portugal-top-itineraries-job-aid`, is genuinely new and non-colliding).
- **Deliberately not built**: no attempt to guess a price or a
  kensingtontours.com link for any of the three itineraries so they could
  be added to `KT_LIVE_ITINERARIES`/surfaced by `find_matching_itinerary`
  — that would require the same real live-website source Spain's own
  Section 119 was built from, which this environment still can't reach
  (`EGRESS_BLOCKED` for kensingtontours.com, confirmed earlier in this
  Portugal build-out). If Portugal ever gets its own live-website-listings
  pass, these three job-aid itineraries are the natural candidates to
  cross-reference against real listings the way Spain's "Live-listing
  equivalent" row already does.
- **Unverified live**: whether the map's Douro Valley/Algarve/Azores pins
  reveal anything beyond confirming geography already correct in the
  guide (nothing new was found), and whether the new table's column
  choices read clearly next to Spain's own differently-shaped Job Aid
  table if a DE compares the two side by side — neither checked outside
  this environment.

## Portugal Top Itineraries: a Client Segment row filled in, the exact field deliberately left out the previous pass (Sep 2026, unverified live)

Direct follow-up, arriving mid-turn while the section above was being
committed: client-type fit for each of the three Portugal itineraries —
framed by the DE as "client profiles don't rigidly fit... but it's useful
to know which types of clients these itineraries are generally a good fit
for," styled as tabs in the source material (one per itinerary).

- **This is precisely the field the previous pass named as deliberately
  missing, not a new ask.** The prior entry explicitly noted Spain's Job
  Aid table has a "Client Segment" column this Portugal lesson hadn't
  provided data for yet, and that Portugal's own table was built with only
  the columns real data existed for. This message supplies exactly that
  missing data — added as a new `<strong>Client Segment</strong>` row,
  positioned right after "KT Level" and before "Locales & Nights," matching
  Spain's own row ordering exactly (checked directly, not assumed from
  memory) now that both tables carry the same field.
- **Kept genuinely distinct from the existing "Best for" row**, not
  merged or duplicated — "Best for" already captured trip STYLE (the
  city/beach/wine/culture blend each itinerary offers); this new row
  captures client TYPE (couples/honeymooners/retirees; active/nature
  travelers; well-traveled repeat visitors) — the same who-vs-why split
  Spain's own table already draws between its "Client Segment" and "Why
  this combo" rows, so this isn't inventing a new distinction, just
  filling in the Portugal side of one that already existed structurally.
- **The DE's own framing caveat — profiles are directional, not rigid —
  was preserved as a real sentence, not dropped as throat-clearing.**
  Added as its own italic line right above the table: "Although client
  profiles don't rigidly fit any one itinerary, it's useful to know which
  types of clients each one is generally a good fit for" — the same
  "directional, not a guarantee" honesty this file already applies
  elsewhere (e.g. the Accessibility & Mobility section's own "this is a
  call the hotel/DMC to confirm situation" caveat).
- Verified via this project's established non-script-content discipline
  (pure HTML — one new table row plus one new intro sentence, no
  `<script>` content touched): all 17 `<script>` blocks re-verified via
  `new Function()` parsing (unaffected), a full script-excluded
  tag-balance recount (div/table/thead/tbody/th/ul/li/h3/h4 all held
  exactly even — no new table or heading was added, only a row; tr/td
  incremented by exactly the one new row's worth, internally balanced),
  and the duplicate-id sweep (unchanged from baseline — no new `id`
  attributes were added by this edit).
- **Unverified live**: whether the new row reads clearly positioned
  between KT Level and Locales & Nights in a real browser at the table's
  actual column widths, and whether the client-segment framing (couples/
  honeymooners/retirees vs. active/nature travelers vs. well-traveled
  repeat visitors) matches how a DE would actually describe these three
  itineraries to a colleague — neither checked outside this environment.

## Five real practice-exam scenarios confirm the Portugal itineraries content, added to Quiz Mode (Sep 2026, unverified live)

Five more KT practice-quiz screenshots, same pattern as the earlier DMC
ones — scenario-based multiple-choice questions matching a client
description to one of the three Portugal Top Itineraries (or, for one
question, to a specific Azores island).

- **Read as confirmation first, again, not as new content to transcribe
  wholesale.** Every marked-correct answer lines up exactly with the
  Client Segment data just added: couple wanting beaches/culture/food →
  Best of Lisbon, Porto & the Algarve; multigenerational family with mixed
  beach/museum/food interests → the same itinerary; nature-lover/hiking
  client wanting volcanic scenery and hot springs → **São Miguel in the
  Azores specifically** (not "the Azores" generically, and not Lisbon/
  Algarve/Porto — a real, useful distinction the quiz draws that the
  guide's own Client Segment row doesn't spell out at the island level);
  solo traveler avoiding crowds, wanting dramatic landscapes and outdoor
  adventure → Portugal Island Gems – The Azores; and a well-traveled
  repeat client with one week who's already done Lisbon and Porto,
  wanting a deeper cultural trip → Portugal Revealed: City to Coast. No
  content correction was needed anywhere.
- **One real, worth-flagging apparent tension resolved by reading the
  quiz's own framing, not by editing the guide.** Portugal Revealed:
  City to Coast itself still includes 4 nights in Lisbon — at first
  glance an odd recommendation for a client who "has already been to
  Lisbon and Porto." Resolved by matching this against the itinerary's
  own Client Segment text already in the guide ("well-traveled or repeat
  visitors who want to dive deeper into Portugal's cultural and natural
  offerings") — the quiz is testing recognition of that depth-for-repeat-
  visitors framing, not a rule about avoiding previously-visited cities.
  Captured as an explicit exam-likely trap in the new flashcard below
  rather than left as a silent point of confusion for a future reader.
- **Four new `QUIZ_CARDS` entries added for `portugal-top-itineraries-
  job-aid`**, matching this lesson series' now-established pattern (the
  DMC scenarios got the same treatment in the previous Quiz Mode entry):
  the couple/family → Best of Lisbon/Porto/Algarve match, the São-Miguel-
  specifically trap, the solo-traveler → Azores match, and the repeat-
  visitor → Portugal Revealed trap (with its own "still includes Lisbon"
  caveat spelled out in the card's own text, not left implicit).
- Verified via this project's established non-script-content discipline
  (one JS array-literal edit inside an existing `<script>` block, so both
  syntax parsing and the script-excluded HTML tag-balance check applied):
  all 17 `<script>` blocks re-verified via `new Function()` parsing
  (confirms `QUIZ_CARDS`' array literal is still syntactically valid), a
  full script-excluded tag-balance recount (unaffected — pure JS data, no
  HTML markup touched), and the duplicate-id sweep (unchanged — no `id`
  attributes were touched).
- **Unverified live**: whether Quiz Mode actually surfaces these four new
  cards in a real shuffle/session, and whether the "still includes Lisbon"
  trap phrasing reads clearly as a flashcard reveal rather than needing
  the full multiple-choice framing the screenshots themselves used —
  hasn't been seen in a real browser from this environment.

## Portugal — Arrivals & Transfers (Job Aid): Flights module built, mirroring Spain's exact structure (Sep 2026, unverified live)

"Flights / Lesson 1 of 6" — a genuinely new lesson SERIES (distinct from
both "Local DMCs" and "Key Locales"/"Top Itineraries"), covering
arrivals/M&Gs, private-transfer drive times, domestic flights, booking
tips, and upgrades for Portugal.

- **Found the exact Spain section to mirror before writing anything, not
  assumed from the DMC/itinerary precedent alone.** Spain's own
  `<h3 id="117-spain-arrivals-transfers-job-aid">SPAIN — ARRIVALS &amp;
  TRANSFERS (Job Aid)</h3>` sits between DMCs (116) and Top Itineraries
  (118) — exactly where this lesson's content belongs relative to the two
  Portugal sections already built. Its own `<h4 id="flights-expanded-
  module-detail">Flights — Expanded Module Detail</h4>` subsection has the
  identical shape this lesson's paste follows almost point-for-point:
  Arrivals, a private-transfer drive-time table, Domestic Flights,
  booking tips/DMC capabilities, and a business-class upgrade tip — strong
  independent confirmation this Portugal lesson is following the same
  official KT training-material template Spain's own content came from.
- **Built as a new `<h3 id="portugal-arrivals-transfers-job-aid">
  PORTUGAL — ARRIVALS &amp; TRANSFERS (Job Aid)</h3>`**, inserted between
  `portugal-dmcs` and `portugal-top-itineraries-job-aid` — the same 116→
  117→118 ordering Spain uses, not appended at the end where it would've
  broken that established sequence. Its own Flights H4 uses id
  `flights-expanded-module-detail-portugal` — deliberately suffixed,
  since Spain's own `flights-expanded-module-detail` id already exists
  and a bare reuse would have been an immediate duplicate-id bug, the
  exact class of mistake the `17-lisbon`/`17-valencia` collision earlier
  in this build-out already taught a lesson about.
- **The M&amp;G-location trap kept as its own exam-tagged callout, not
  buried in a bullet list**: an airport arrival gets an airport M&amp;G,
  but a client arriving overland from Spain (the lesson's own named
  example: a private transfer from Seville to Albufeira) gets a
  **Hotel M&amp;G instead** — a real, specific booking-logic distinction
  worth flagging the same way Spain's own M&amp;G rule is exam-tagged in
  its parallel section.
- **The Ryanair/Porto-Faro fact kept as its own exam-tagged trap too**:
  the ONE direct Porto↔Faro route is Ryanair-operated and must be
  self-booked by the client — neither KT Air nor the DMC can book it,
  the single Portugal domestic route where neither of the guide's usual
  two booking channels apply. Paired with the separate, more general
  Azores/Madeira "TAP or Azores Airlines only, not Ryanair, not bookable
  by KT Air" rule as its own callout, since the two are related but
  distinct facts (one about which CARRIER, one about which BOOKING
  CHANNEL) that would be easy to conflate into one imprecise bullet.
- **Deliberately did not build the Trains/Private-Transfers/Accessibility
  H4s Spain's parallel section also has** — this lesson ("1 of 6")
  covered only Flights; adding placeholder Portugal versions of Spain's
  other H4s with no real source content would be exactly the kind of
  guessing this Portugal build-out has avoided from the start. They're
  the natural next installments in this 6-lesson series.
- Verified via this project's established non-script-content discipline
  (pure HTML — one new `<h3>`, one new `<h4>`, an intro paragraph, five
  bullet lists, one 6-row table, no `<script>` content touched): all 17
  `<script>` blocks re-verified via `new Function()` parsing (unaffected),
  a full script-excluded tag-balance recount (div/thead/tbody/th all held
  exactly even; table/tr/td/ul/li/h3/h4 all incremented by exactly this
  section's own new markup, internally balanced), and the duplicate-id
  sweep (unchanged from baseline — confirmed specifically that the new
  `flights-expanded-module-detail-portugal` id does NOT collide with
  Spain's existing `flights-expanded-module-detail`, the one real risk
  this edit had to guard against).
- **Unverified live**: whether the new section reads clearly as a
  Portugal-specific parallel to Spain's own Arrivals & Transfers Job Aid
  rather than a confusing near-duplicate section name, and whether the
  drive-time table's six rows scan cleanly at actual column widths in a
  real browser — neither checked outside this environment. Expect Lessons
  2–6 of this series to cover Trains/Private Transfers/other ground-
  services detail, matching Spain's own H4 breakdown.

## Portugal Arrivals & Transfers: Trains module added (Sep 2026, unverified live)

"Trains / Lesson 2 of 6," arriving right on schedule per the previous
entry's own prediction — built as a second H4 inside the same
`portugal-arrivals-transfers-job-aid` section, right before the Top
Itineraries section, matching where Spain's own `trains-expanded-module-
detail` H4 sits relative to its Flights H4.

- **`<h4 id="trains-expanded-module-detail-portugal">Trains — Expanded
  Module Detail</h4>`** — same Portugal-suffixed-id discipline as the
  Flights H4, guarding against the exact same Spain-id-collision risk
  (`trains-expanded-module-detail` already exists for Spain). Covers: The
  Train Experience (Alfa Pendular/Intercidades trains; Conforto/first-
  class vs. Turística/second-class, from the two carousel-slide
  screenshots), Popular Routes (Lisbon↔Porto and Lisbon↔Faro at 2.5–3
  hrs; the Porto↔Faro 5+ hr trap; station precision in Lisbon/Porto, each
  with two named stations), Booking and Accessibility Considerations
  (DMC-booked tickets, no porter service, mobility-assistance arranged in
  advance, older-town drop-off limitations), and Rail Disruptions
  (occasional strikes, confirm plans closer to travel, keep a backup
  transfer plan).
- **The Porto↔Faro rail trap explicitly cross-referenced to the Flights
  module's own Ryanair rule, not left as a coincidental repeat.** Both
  lessons independently name the same underlying fact from two angles —
  Flights: "the only direct Porto-Faro flight is Ryanair, unbookable by
  KT Air or the DMC"; Trains: "Porto-Faro is 5+ hours by train, not
  time-effective, and flight options here are limited/low-cost-carrier."
  Rather than present these as two disconnected facts a DE might not
  connect, the Trains bullet explicitly says "ties to the Ryanair-only
  Porto–Faro flight rule in the Flights module above" — the real
  takeaway being that Porto↔Faro is a genuinely awkward route by every
  mode (train too slow, the only direct flight is a carrier KT won't
  book), which is worth a DE knowing as one coherent fact, not two
  separately-memorized trivia points.
- **The train-class images (Conforto/Turística interior photos) were
  read for their caption facts, not treated as assets to embed** — same
  standing rule as every other screenshot in this Portugal build-out;
  the two class names and their one-line descriptions were transcribed,
  the photos themselves were not recreated.
- Verified via this project's established non-script-content discipline
  (pure HTML — one new `<h4>`, an intro paragraph, four bullet lists, no
  `<script>` content touched): all 17 `<script>` blocks re-verified via
  `new Function()` parsing (unaffected), a full script-excluded
  tag-balance recount (div/table/thead/tbody/th/h3 all held exactly even
  — no new table or heading added, only one H4 and its lists; ul/li/h4
  incremented by exactly this section's own new markup, internally
  balanced), and the duplicate-id sweep (unchanged from baseline —
  confirmed `trains-expanded-module-detail-portugal` doesn't collide with
  Spain's existing `trains-expanded-module-detail`).
- **Unverified live**: whether the Conforto/Turística class descriptions
  and the two named stations per city read clearly as reference material
  in a real browser — hasn't been seen outside this environment. Expect
  Lessons 3–6 to cover Private Transfers and other ground-services
  detail, continuing to match Spain's own H4 breakdown.

## Portugal Arrivals & Transfers: Private Transfers/Drivers module — a real discrepancy found against this guide's own general table, flagged not silently resolved (Sep 2026, unverified live)

Continues the same lesson series, arriving without an explicit "Lesson N
of 6" label this time but clearly the next installment — "Drivers in
Portugal," four driver/guide role screenshots (Tourism Driver, Driver +
Guide, Driver-Guide, Assistant), each with a description, TMT label, and
tip.

- **Built as `<h4 id="private-transfers-expanded-module-detail-
  portugal">Private Transfers — Expanded Module Detail</h4>`**, same
  Portugal-suffixed-id discipline as Flights/Trains, placed as the third
  H4 in `portugal-arrivals-transfers-job-aid` (right after Trains, right
  before Top Itineraries) — matching where Spain's own
  `private-transfers-expanded-module-detail` H4 sits in its own section.
  Rendered as a Role/TMT Label/What's Included/Tip table rather than
  Spain's Overview+Add-Ons+car-capacity-table shape, since this lesson
  gave role-taxonomy detail Spain's own version doesn't have (four named
  driver/guide roles with distinct TMT labels) and no car-class/passenger-
  capacity data — adapted to the real data again, not forced into Spain's
  exact shape.
- **A genuine discrepancy found against this file's own existing
  content, and flagged rather than silently picked one side of.** This
  guide's pre-existing, general (company-wide, not Spain- or Portugal-
  specific) `<h3 id="driverguide-combinations-exam-likely-know-these-
  distinctions">Driver/Guide Combinations</h3>` table lists "Vehicle/
  Driver-Guide (Vehicle/Tourism Driver)" as ONE combined row — treating
  those two TMT labels as equivalent, both meaning "one person does
  both roles." This Portugal lesson draws a real, explicit distinction
  between them instead: a **Tourism Driver** handles transportation ONLY
  and cannot accompany clients into sites at all (not even basic guiding
  — TMT label `Vehicle/Tourism Driver`), while a **Driver-Guide** is one
  person who genuinely DOES provide basic guiding alongside driving (TMT
  label `Vehicle/Driver-Guide`) — two different service levels, not
  synonyms. Rather than edit the general table (which may still be a
  reasonable simplified framework for other destinations, and this file
  has no authority to declare it simply wrong company-wide off one
  destination's training deck), added an explicit exam-tagged callout
  in the new Portugal section naming the discrepancy directly and stating
  the Portugal-specific rule to actually use. Matches this build-out's
  own established discipline for a real conflict (see the ETIAS-framing
  conflict flagged rather than silently resolved in the earlier Lisbon
  PDF pass).
- **The Tourism Driver tip's English-language caveat cross-checked
  against Spain's own parallel fact, and found consistent, not
  contradictory** — Spain's Private Transfers H4 states "Spain's driver
  fleet typically does not speak conversational English... not acting as
  tour guides, just ensuring on-time point A→B transport" as its own
  exam-tagged fact; Portugal's new tip says essentially the same thing
  for transfer-only drivers specifically. No correction needed — this is
  the same real-world pattern repeating across both destinations, not a
  coincidence worth flagging as new.
- Verified via this project's established non-script-content discipline
  (pure HTML — one new `<h4>`, two paragraphs, one 4-row table, one
  exam-tagged callout, no `<script>` content touched): all 17 `<script>`
  blocks re-verified via `new Function()` parsing (unaffected), a full
  script-excluded tag-balance recount (div/thead/tbody/h3 all held
  exactly even; table/tr/td/th/h4 incremented by exactly this section's
  own new markup, internally balanced), and the duplicate-id sweep
  (unchanged from baseline — confirmed `private-transfers-expanded-
  module-detail-portugal` doesn't collide with Spain's existing
  `private-transfers-expanded-module-detail`).
- **Unverified live**: whether the Tourism-Driver-vs-Driver-Guide
  distinction actually matters in practice the way this pass assumed
  (i.e., whether DEs booking Portugal ground services need to know this
  nuance, or whether it's a training-deck-level detail that rarely
  changes a real booking decision) — worth a DE spot-check. The four-
  role table's readability against the general Driver/Guide Combinations
  table elsewhere in the guide also hasn't been seen in a real browser.
  Expect Lessons 4–6 (or whatever remains of this series) to round out
  Accessibility/Mobility or other ground-services detail, matching
  Spain's own H4 breakdown.

## Private Transfers module completed: Transfer Tours + Selecting the Right Car (Sep 2026, unverified live)

Direct continuation, arriving mid-turn while the driver-roles commit was
still landing — the two remaining pieces of Spain's own Private Transfers
H4 shape (Available Add-Ons, Selecting the Right Car) that this section
didn't have yet, now filled in with real Portugal data.

- **"Transfer Tours" added right after the driver-roles table**, the
  Portugal equivalent of Spain's "Available Add-Ons → local guide met en
  route" idea (Spain: a Seville→Granada transfer can stop for a Córdoba
  day tour) but richer — Portugal names seven real waypoint towns/regions
  (Coimbra, Aveiro, Nazaré, Fátima, Óbidos, Évora, the Alentejo wine
  region) reachable as curated stops on the Lisbon↔Porto and
  Lisbon↔Algarve routes, explicitly framed as a Premier/Luxe upsell.
- **A real, useful cross-reference caught and made explicit, not left
  implicit**: this lesson's own line — "drivers alone cannot provide
  entry or explanation at tourist sites" — is the exact same fact as the
  Tourism Driver definition documented in the previous commit (cannot
  accompany clients into sites, provides context from outside only). The
  new exam-tagged bullet says so directly ("ties directly to the Tourism
  Driver vs. Driver-Guide distinction above"), so a DE reading this
  section top-to-bottom sees the connection instead of two separately-
  memorized facts that happen to say the same thing.
- **"Selecting the Right Car" added as its own table**, matching Spain's
  own section heading exactly but with Portugal's real, different fleet:
  <strong>Mercedes Class GLE</strong> (sedan, 2 passengers, with Class S
  as a luxury upgrade in some locales), <strong>Mercedes Class V</strong>
  (minivan, 3–5 passengers), and a <strong>Basic Vehicle</strong> (e.g.
  Ford) used for Algarve transfers. **Deliberately transcribed as given,
  not "corrected" to match Spain's Class E/S/V naming** — Portugal's own
  lesson names GLE, not E, and these are legitimately different
  destinations' vehicle fleets/contracts, not a typo to reconcile.
- **Two genuinely new, specific facts neither Spain's parallel section
  nor Portugal's own earlier content had**: a 13-seater-van routing
  restriction naming four specific regions (Douro Valley, parts of Évora,
  Madeira, and the Azores) where narrow/winding roads make large vans
  impossible, and — the most concrete, actionable new fact in this
  batch — Porto's own municipal **congestion charge (€7.50–15)** for
  vehicle drop-offs/tours at hotels on Rua das Flores or in Ribeira,
  something a DE would need to actually flag to a client's cost
  expectations, not just general color. Spain's own parallel fact (Gothic
  Quarter drivers can't drop off directly at the hotel) only covers the
  walking-distance inconvenience, not a real added cost — Portugal's
  version is more specific and more consequential, kept as its own
  distinct bullet rather than merged into the walking-distance note.
- Verified via this project's established non-script-content discipline
  (pure HTML — two new paragraphs/lists, one new table, no `<script>`
  content touched): all 17 `<script>` blocks re-verified via
  `new Function()` parsing (unaffected), a full script-excluded
  tag-balance recount (div/thead/tbody/h3 all held exactly even;
  table/tr/td/th/ul/li incremented by exactly this addition's own new
  markup, internally balanced), and the duplicate-id sweep (unchanged
  from baseline — no new `id` attributes were added by this edit).
- **Unverified live**: whether the €7.50–15 Porto congestion-charge
  figure and the four-region van restriction read as clearly actionable
  to a DE mid-quote as intended, and whether the "Selecting the Right
  Car" table's three rows (one with an em-dash passenger count for the
  Basic Vehicle, since none was given) look reasonable in a real browser
  — neither checked outside this environment.

## Popular Attractions lesson series: Azores practicalities + Terra Nostra Park, then a large multi-city drop (Madeira, Lisbon, Sintra, Évora, Porto, Douro Valley) plus a new Top Tours section (Sep 2026, unverified live)

"Portugal's Popular Attractions / Lesson 1 of 5" opened with an Azores
Overview slide (general travel-practicality notes) plus two attraction
cards (Sete Cidades, Terra Nostra Park). Before that could be committed,
a much larger batch of screenshots arrived mid-turn covering several
destinations at once — Madeira (Toboggan Ride), Lisbon (Overview,
St. George's Castle, Fado Evening Experience, Tile Painting Workshop),
Sintra (Quinta da Regaleira), Évora (Chapel of Bones), Porto (Overview,
Livraria Lello, Porto Cathedral, Aveiro & Moliceiro Boat Tour), and Douro
Valley (Overview, a Douro Valley excursion card) — plus, separately,
"Portugal's Top Tours / Lesson 2 of 5" with a Kensington Tour Levels
framework. All of it placed in one pass, following this build-out's
standing "diligently place what's given, never guess" discipline.

- **Azores**: a new `<h4 id="planning-practicalities-azores">Planning &amp;
  Practicalities</h4>` list captures the Overview slide's five general
  facts (weather unpredictability/pack layers and waterproof gear;
  rugged/muddy trails/sturdy footwear; remoteness → limited services on
  smaller islands; whale-watching/geothermal-bathing reservations
  advised in peak season; narrow winding roads → a smaller rental
  vehicle, cross-referenced to the existing 13-seater van restriction
  under Arrivals &amp; Transfers) — no such general-practicalities section
  existed for the Azores before this (confirmed absent earlier this
  session). The existing "Lagoa das Sete Cidades" Key Attractions row was
  enriched in place (renamed to lead with "Sete Cidades," matching the
  lesson card's own title) with the new activity-level/terrain-
  communication considerations, rather than duplicated. **Terra Nostra
  Park is a genuinely new row** — description (botanical beauty, a
  naturally heated iron-rich mineral pool) plus its own considerations
  (uneven paths near the pools; the mineral water can stain swimwear;
  recommend dark-colored suits and water shoes) — since the existing
  3-column table (Attraction/Why it matters/Practical info) has no
  dedicated Considerations column, new cautions for both rows were folded
  into "Why it matters"/"Practical info," matching the pattern already
  established for São Jorge Castle elsewhere in this file.
- **Madeira — the first real content this guide has ever had for it.**
  Confirmed via the existing Key Locales Overview intro that Madeira "is
  a real KT-sold destination... doesn't have its own section in this
  guide yet" — this pass didn't try to fabricate a full destination
  profile from one attraction card. Added a minimal, honestly-scoped
  `<h4 id="madeira-region">🚡 MADEIRA</h4>` stub right after the Algarve
  block: an explicit disclosure that this is partial content, a
  "Getting there" line reusing the already-documented Funchal Airport
  (FNC) transfer time rather than inventing new arrival detail, and the
  one real signature experience given — the Toboggan Ride (a handcrafted
  wicker sled down Monte's steep roads, steered by two traditionally
  dressed drivers) — with its own considerations (not suitable for
  mobility concerns; only offered in Monte).
- **Lisbon**: enriched the existing "São Jorge Castle" Key Attractions
  row with the new practical considerations (steep paths/stairs; entry
  fees plus possible shuttle/guide costs; best visited early or late to
  avoid crowds and heat), and added its English name inline since the
  new lesson card used "St. George's Castle." Added a new
  `<h4 id="experiences-lisbon">Experiences</h4>` table (Experience/What it
  is/Considerations — a genuinely new column shape for this one section,
  since these are bookable experiences rather than fixed sites) for the
  two new cards: Fado Evening Experience (cross-referenced to the
  existing Food &amp; Culture Fado paragraph rather than duplicating it) and
  Tile Painting Workshop, each with the considerations given (limited
  Sunday dinner availability / melancholic tone; multi-day tile firing /
  minimum age or group size). Added a new **Évora** row to the existing
  "Day Trips from Lisbon" table — Évora itself has no full section in
  this guide (only named before as a Locale Planning alternative and a
  Transfer Tours waypoint), so rather than build a premature full
  destination profile, its one given attraction (Chapel of Bones —
  Capela dos Ossos) became the row's own highlight, with the private-
  guide/uneven-flooring/somber-tone considerations folded in.
- **Sintra**: the existing Quinta da Regaleira mention (inside the
  Sintra "Signature sites" paragraph) was enriched in place with the new
  lesson's specific considerations — an extensive park with uneven
  terrain and stairs throughout, not ideal for clients who prefer
  minimal walking, recommend a slower pace and comfortable footwear —
  rather than duplicated as a separate entry, since Sintra doesn't have
  its own dedicated attractions table (a compact `<h4>` write-up, same as
  Douro Valley/Algarve pre-promotion).
- **Porto**: no `orientation-porto` H4 existed before this (only an
  intro paragraph) — added one, mirroring Lisbon's own `orientation-
  lisbon` structure, to hold the new Overview slide's practicalities
  (hilly terrain/comfortable footwear, cross-referenced to the existing
  Guindais Funicular note; variable weather/pack layers; river cruises
  popular but may sell out in peak season; dining reservations
  recommended at riverside spots). Enriched the existing "Porto
  Cathedral" and "Livraria Lello" Key Attractions rows in place with
  each card's new considerations (wheelchair accessible but a hillside
  walk / possible entry fees; extremely popular with narrow staircases
  and tight spaces / VIP skip-the-line tickets should be included in the
  quote) rather than creating duplicate rows — both attractions already
  existed with real hours/address/website data. Enriched the existing
  "Aveiro" Day Trips row with the Moliceiro Boat Tour specifics (private/
  shared options, boarding may be challenging for some, the Costa
  Nova/oyster-farm/porcelain add-ons already named generically in the
  lesson card).
- **Douro Valley**: the existing `douro-valley-region` compact write-up
  was enriched across all four of its paragraphs — Getting There gained
  the narrow/winding-roads-private-driver-guide caution; Signature
  Experiences gained the river-cruises-may-have-limited-winter-schedules
  and tastings-need-reservations notes; Best Time to Visit gained the
  summer-heat/rural-accommodation-rustic-charm color; and a new exam-
  tagged closing note captures the separate Douro Valley excursion
  card's own facts (a guided day tour typically bundles transportation
  plus winery visits and runs a full ~9 hours; the winding roads may not
  suit clients prone to motion sickness) — kept as its own paragraph
  since it describes a specific bookable day-tour product, not the
  region generally.
- **A new `<h3 id="portugal-top-tours-job-aid">PORTUGAL — TOP TOURS (Job
  Aid)</h3>` section**, mirroring Spain's own parallel
  `113-spain-top-tours-by-locale-job-aid` structure (found by reading it
  directly before writing anything — same "Tour Categories"/"KT Tour
  Levels" framing this Portugal lesson turned out to match closely).
  Placed right before `portugal-dmcs`, matching Spain's own tours-before-
  DMCs-and-transfers ordering. Only the "Kensington Tour Levels" content
  has arrived so far (Premier tours are the most popular/typically
  private, sometimes with car transfers; price-conscious clients get a
  Tourism Driver — cross-referenced to the real Portugal-specific role
  already documented under Arrivals &amp; Transfers, not Spain's own
  small-group-tour framing, since Portugal's lesson named a different
  price-conscious option; Luxe clients get exclusive vineyard access,
  private-hire of the historic Tram 28, and Michelin dining) — the intro
  paragraph says explicitly that per-locale tour listings will be filled
  in as they arrive, matching this build-out's established partial-fill
  convention (e.g. the Locale Planning Quick Reference table's own
  disclosure).
- Verified via this project's established non-script-content discipline:
  all 17 `<script>` blocks re-verified via `new Function()` parsing
  (unaffected — this entire batch was pure HTML/table/list content, no
  `<script>` logic touched), a full script-excluded tag-balance recount
  (div/table/tr/td/th/thead/tbody/ul/li/h3/h4 all exactly even across the
  whole file after every edit in this batch), and the duplicate-id sweep
  (unchanged from baseline — the same 4 pre-existing, unrelated Client
  Tracker bulk-action ids; every new id added this pass —
  `planning-practicalities-azores`, `madeira-region`,
  `experiences-lisbon`, `orientation-porto`,
  `portugal-top-tours-job-aid` — confirmed genuinely new and
  non-colliding).
- **Unverified live, same caveat as the rest of this Portugal build-out,
  and an unusually large batch to land in one pass**: none of this
  batch's specific facts (the Toboggan Ride's Monte-only availability,
  the Fado/Tile-Painting-Workshop specifics, Porto Cathedral's wheelchair
  accessibility claim, the Moliceiro boat add-ons, the ~9-hour Douro day
  tour duration, the Tram 28 private-hire Luxe upsell) have been checked
  against a live source beyond the lesson screenshots themselves —
  transcribed faithfully, not independently confirmed. Whether folding
  each new consideration into the existing table cells (rather than
  adding a dedicated Considerations column, which several other Spain/
  Portugal tables also lack) reads clearly in a real browser, and whether
  the new Madeira stub's honesty-about-being-incomplete framing lands
  right rather than reading as unfinished, are both worth a look next
  time these sections are reviewed. More installments are expected in
  both the Popular Attractions (4 more) and Top Tours (4 more) lesson
  series — place them the same way as they arrive.

## Portugal cleanup pass: pronunciation flip-cards + a real interactive-map extension, scoped honestly (Sep 2026, unverified live)

Direct request: "clean up these sections. Use the Spain section as your
blueprint. So proper subsections, everything neatly laid out, tap to
flip sections, pronunciation voice. Interactive map. Make sure
everything is working as it should. I will upload more information
tomorrow." Four distinct asks bundled together — worked through each
one, but deliberately did NOT treat all four as equally buildable
tonight; one of them (attraction-level "tap to flip" cards with real
photos) carries a real risk this build-out has flagged and avoided
since its very first entry, so it's called out explicitly below rather
than silently built or silently skipped.

- **Pronunciation voice / "tap to flip" — the safely-buildable half of
  that ask, built for real.** Checked directly and found Lisbon already
  had its own `.title-pron-wrap` city-name flip-card (built during the
  original Lisbon promotion) — Porto and the Azores, both since promoted
  to full `<h3>` sections, did NOT (confirmed via grep, zero matches).
  Added the identical flip-card to both — `<button class="speak-btn"
  data-text="Porto" data-lang="pt-PT">`/"POR-too" for Porto, `"Açores"`/
  "ah-SOR-esh" for the Azores — plus one for the Madeira stub
  ("Madeira"/"muh-DAY-ruh") for consistency even though that section is
  still a deliberately partial placeholder. **These genuinely work with
  zero JS changes** — confirmed by reading the wiring code directly:
  `document.querySelectorAll('.speak-btn').forEach(...)` runs in a
  later `<script>` block that queries the WHOLE document after
  everything above it has already been parsed (this file's own
  document-order execution model, the same one that caused and then
  fixed the itinerary-modal DOM-lookup bug earlier this session) — so
  new buttons added to earlier HTML are picked up automatically, no
  export or extra wiring needed.
- **The interactive map — deferred since the very first Lisbon commit
  ("wait until more Portugal city data is in"), and now built for
  real.** The affine transform from earlier this session (fit from 12
  Spain pins' real lat/lng → their real x/y positions, ≤1px residual on
  11 of 12 points) was recomputed fresh in this pass (nothing from the
  earlier analysis was saved to a file) and applied to four real
  Portugal cities: Lisbon (41.5, 326.1), Porto (62.1, 182.4), Sintra
  (31.8, 321.3), and Faro (89.5, 426.5) — the four with genuine guide
  depth behind them (full `<h3>` sections for the first two, a
  richly-documented day trip for Sintra matching Toledo's existing role
  under Madrid, and Faro as the Algarve's real named airport gateway,
  matching Bilbao/San Sebastián's role as a non-`<h3>` satellite pin).
  Added all four to `TRIP_PLANNER_PINS`, plus four road connections
  (Lisbon–Seville, matching the real "Epic Iberian Journey" itinerary's
  route; Lisbon–Sintra; Lisbon–Porto; Lisbon–Faro) to
  `TRIP_PLANNER_ROADS`.
- **`QB_LANDMASS_PATH` extended with a westward Portugal bulge** —
  real "path-surgery," done for the first time after two sessions of
  explicitly deferring it. The old western boundary (the stretch of
  points tracing Spain's actual Portugal border, ~x=104–130) was
  replaced with 13 new points bulging out to ~x=24–56, built from the
  four cities' own projected coordinates plus reasonable coastal
  padding (Cabo da Roca near Sintra, the Algarve's southwestern tip
  near Sagres, etc.) — **explicitly a first-pass approximation, not a
  traced coastline the way Spain's own shape is** (that one comes from
  real Natural Earth geographic data; this one is hand-built from four
  anchor points). Verified geometrically, not just visually assumed: a
  real point-in-polygon test (ray-casting) run in Node against the
  extracted path confirms all four new pins — Lisbon, Porto, Sintra,
  Faro — land genuinely INSIDE the new landmass shape, not floating
  outside it.
- **"Proper subsections, everything neatly laid out" — already
  substantially true, checked rather than assumed.** Lisbon, Porto, and
  the Azores (the three full-`<h3>` Portugal destinations) already
  follow a consistent subsection pattern matching Spain's own city
  blueprint (Orientation → Airport/Getting There → Key Attractions →
  Food & Culture → Day Trips/practicalities → Hotels, adapted per
  destination's real shape — the Azores' own archipelago-specific
  subsections in place of a single-city "Key Neighborhoods" table are a
  deliberate, already-documented adaptation, not an inconsistency).
  Sintra, Douro Valley, Algarve, and Madeira remain intentionally
  compact `<h4>` stubs, exactly as flagged in every prior entry — not
  broken, just still waiting on the richer source material a full
  promotion needs, per the DE's own paced "Lesson X of N" delivery.
- **Deliberately NOT built: real photo-based "tap to flip" cards for
  individual attractions (Spain's `.media-card`/`card-flip-front`
  pattern with a real Wikimedia Commons `<img>`).** This is the one
  piece of the request not treated as done tonight, and it's called out
  here rather than silently skipped. This build-out's very first entry
  established why: this environment has no network access to verify a
  guessed Commons file-path URL would actually resolve, and a broken
  image in a client-facing sales tool is worse than no image — which is
  exactly why Portugal's Key Attractions have been tables (Attraction/
  Why it matters/Practical info) instead of Madrid's photo cards from
  the start, a decision restated and held every time it came up since.
  Nothing about tonight's request changes that constraint — building
  ~50+ real flip-cards across Lisbon/Azores/Porto with guessed image
  URLs would risk exactly the failure mode this guide has avoided on
  purpose. The pronunciation flip-cards built above use the *same* tap-
  to-flip mechanic (their JS/CSS is even the same shared `.title-pron`/
  `.pron-mini` classes Spain's photo cards use for their own
  pronunciation badges) but never need an image, so they were safe to
  build broadly; the photo-card conversion is a separate, larger
  decision worth putting to the DE directly rather than guessing at —
  either source real, verified image URLs and do it properly, or
  accept the table format as final for Portugal.
- Verified via this project's established non-script-content discipline
  plus one new geometric check specific to this pass: all 17 `<script>`
  blocks re-verified via `new Function()` parsing (confirms the new
  `TRIP_PLANNER_PINS`/`TRIP_PLANNER_ROADS`/`QB_LANDMASS_PATH` array/
  string literals are syntactically valid, not just visually plausible),
  a full script-excluded tag-balance recount (div 1601→1622, matching
  the three new title-pron-wrap blocks' own internally-balanced markup
  exactly; every other tracked tag unchanged), the duplicate-id sweep
  (unchanged from baseline — the same 4 pre-existing, unrelated Client
  Tracker bulk-action ids; no new `id` attributes were added by the map
  changes, and the title-pron blocks reuse Lisbon's exact existing CSS
  classes rather than inventing new ids), and the Node ray-casting
  point-in-polygon test described above (all four new pins confirmed
  genuinely inside the extended landmass shape).
- **Unverified live, and this is the item most worth a real look**: the
  Portugal landmass bulge's actual visual shape in a real browser — it's
  built from four anchor points plus estimated coastal padding, not a
  traced coastline, so it may look noticeably cruder than Spain's own
  smoother shape up close, even though the geometry checks out
  correctly (pins land inside it). Also unverified: whether the three
  new pronunciation flip-cards' phonetics read naturally when spoken by
  a real browser's `pt-PT` voice (no `pt-PT` voice may even be
  installed in every browser — same caveat this file's voice-picker
  work already documents generally), and whether the four new map pins/
  roads look proportionate against the existing Spain pins once actually
  rendered. Test next: open the Interactive Trip Planner Map and confirm
  Lisbon/Porto/Sintra/Faro appear as real clickable pins sitting on
  visible landmass (not floating in blank ocean), tap each new
  pronunciation card in Porto/Azores/Madeira and confirm the flip and
  the spoken audio both work, and take a general look at whether the
  Portugal bulge's shape looks reasonable at a glance — flag anything
  that looks visually wrong so it can be adjusted against real feedback
  rather than guessed at twice.

## Not client-facing — a real image-sourcing method unlocked, plus a full pass through the Job Aid xlsx (Sep 2026, unverified live)

Direct correction: "This is not a client facing tool. So use pictures and
information you can gather from wikipedia, google etc." This overturns
the standing reasoning behind every earlier "no unverified images" call
in this build-out (Lisbon's original Key Attractions table, the Azores
PDF pass, etc.) — those were all reasoned from "client-facing sales
tool," which this session confirmed is not the actual constraint. Also:
"Continue going through the Portugal Guide excel file and extract all
the important data."

- **A real, higher-confidence image-sourcing method, tested and confirmed
  before relying on it.** `WebFetch` is still hard-blocked for
  `en.wikipedia.org` and `commons.wikimedia.org` specifically (confirmed
  by testing both directly — `EGRESS_BLOCKED`), so a Commons image URL
  still can't be fetched-and-rendered to double-check from this
  environment. But `WebSearch` genuinely works, and a
  `site:commons.wikimedia.org "<name>"` query reliably returns real,
  currently-indexed Commons **File:** page titles — not a guess at a
  filename pattern, an actual confirmed-to-exist file. Every image URL
  added this session used a filename pulled directly from a real search
  hit, built as `https://commons.wikimedia.org/wiki/Special:FilePath/
  <exact filename>` — the same URL shape Madrid's own existing flip-cards
  already use. This is meaningfully more reliable than blind guessing,
  though it still isn't a render-and-confirm check — flagged as the one
  remaining unverified piece below.
- **Lisbon's 19-row Key Attractions table rebuilt as real tap-to-flip
  photo cards**, matching Madrid's `.media-gallery`/`.media-card`
  structure exactly (front: real Commons photo + "Tap to flip" caption;
  back: title, a 📍 Map button, the enriched practical/considerations
  text already built this session, and a Learn More link to Wikipedia,
  the venue's own site, or — for two viewpoints with no standalone
  Wikipedia article — their real Commons category page). All 19 images
  were sourced via the method above: São Jorge Castle, Jerónimos
  Monastery, Belém Tower, Carmo Convent, Cristo Rei, Church of São Roque,
  Parque das Nações, National Tile Museum, Fronteira Palace, São Pedro de
  Alcântara, Miradouro das Portas do Sol, Praça do Comércio, Lisbon Zoo,
  Lisbon Oceanarium, the Gulbenkian Foundation, National Museum of
  Ancient Art, Museum of the Orient, Pavilion of Knowledge, and Monsanto
  Forest Park. **Deliberately did not add individual pronunciation
  flip-badges (`.pron-mini`) to all 19 cards** — the city-level
  pronunciation cards (Lisbon/Porto/Azores/Madeira) already answer the
  "pronunciation voice" ask, and 19 more one-off Portuguese phonetic
  guesses, unsourced from any authoritative pronunciation reference,
  would have been a second, less-confident layer of guessing stacked on
  top of an already-large batch of new content — worth adding later
  specifically sourced from the real "Pronounciation" xlsx sheet's own
  word list (see below) rather than improvised here.
- **A real, thorough pass through the previously-unread "9 - Top Hotels"
  xlsx sheet** — genuinely the highest-value single piece of data still
  missing from this guide. Built full Hotels sections (replacing the
  "⚠️ No Kensington-preferred property list confirmed yet" placeholders)
  for Lisbon (5 real hotels, plus the source's own detailed neighborhood-
  selection guidance), Porto (4 hotels, plus the Rua das Flores/Ribeira
  congestion-charge hotel list cross-referenced to the charge already
  documented under Arrivals &amp; Transfers), and the Azores (5 hotels
  across São Miguel/Terceira/Faial, plus the Furnas/Rabo de Peixe
  pickup-supplement note). Added shorter hotel paragraphs to Douro
  Valley, Algarve, and Madeira's still-compact write-ups from the same
  source, rather than leaving genuinely real hotel data out just because
  those locales haven't been promoted to full sections yet.
- **A real cross-check pass through "8 - Popular Attractions"** — this
  sheet is the actual source behind the earlier "Popular Attractions"
  lesson-screenshot content, and turned out to carry substantially richer
  booking-logic detail (KT way of visiting, qualifying considerations,
  quoting alerts, managing-expectations language) than the screenshots
  alone conveyed. Enriched, in place, rather than duplicated: Jerónimos
  Monastery (private-guide requirement), Belém Tower (river-cruise
  pairing, interior/exterior mobility split), St. George's Castle
  (elevator), Fado (the "don't eat during the first song" etiquette, plus
  a real late-start timing warning), Tile Painting Workshop (per-venue
  capacity), Óbidos (the real Fátima/Nazaré combo-tour product), Pena
  Palace (shuttle-ticket/first-entry-time booking logic, the Monday-
  closure trap), Port wine cellars (a genuine Fado + dinner-in-cellar
  product), Douro Valley (the real touring-variety list — honey/olive-oil
  tastings, hiking, cruises), Aveiro (Vista Alegre named specifically),
  Whale Watching (transfers NOT included in the base cost — a real
  quoting gap this closes), Évora (its own vineyard day-trip product, the
  Chapel-of-Bones-plus-Cathedral combo), and Madeira (the Monte &amp; Wine
  Lodge tour, a genuine alternative/pairing to the Toboggan Ride). Two
  genuinely new rows added, not just enrichment: **Furnas** as its own
  Azores Key Attractions entry (previously only known as the Cozido
  location, not documented as a bookable full-day tour with its own
  mobility/staining considerations), and **Coimbra** as a real Day Trips
  from Porto row (the Biblioteca Joanina, previously only named generically
  as a day-trip-worthy town with zero actual attraction detail).
- **A full, real "8 - Top Tours" xlsx pass — the previously-placeholder
  "PORTUGAL — TOP TOURS (Job Aid)" section now has actual tours in it.**
  16 real, named, bookable Kensington tours transcribed by locale —
  Albufeira (3), the Azores (2), Lisbon (5), Lisbon/Cascais (1),
  Lisbon/Évora (1), Porto (2), Porto/Douro (1) — each with its real tour
  category, KT level, duration, a genuine "wow moment" line, KT value
  (why book this with Kensington specifically), and the real qualifying/
  quoting/expectations-management alerts, mirroring Spain's own "Tour
  Category | KT Level noted per tour" bullet format exactly (checked
  directly before writing, matching this build-out's own standing
  discipline). This is a substantial, previously-completely-missing
  piece of real booking knowledge, not a light touch-up.
- **Deliberately not yet done, named here rather than silently
  skipped**: Porto's and the Azores' own Key Attractions tables were NOT
  converted to photo flip-cards this pass — Lisbon alone (19 real
  attractions, each individually searched and sourced) was already a
  large, careful undertaking, and stretching the same discipline across
  Porto (17 rows) and the Azores (13+ rows) in the same pass risked
  rushing the sourcing quality that made Lisbon's conversion trustworthy
  in the first place. The exact same method (confirmed via
  `site:commons.wikimedia.org` search, never guessed) is ready to reuse
  directly for both the next time this comes up. The "6 - Top
  Itineraries" and "7 - Arrivals and Transfers" xlsx sheets were not
  re-read this pass either — both were already the direct source behind
  earlier lesson-screenshot content built out extensively this session,
  and a fresh read turned up nothing this session's own time was better
  spent re-confirming versus moving forward with the two sheets
  (Attractions, Hotels) that had never been touched at all. The
  "Pronounciation" sheet (just a checklist of words needing a
  pronunciation demonstration — Alentejo, Coimbra, Cascais, Jerónimos
  Monastery, Óbidos, Quinta da Regaleira, Moliceiro boat, Sete Cidades,
  Funchal, Terceira, Almendres Cromlech, and more — with no actual
  phonetics provided) is worth a real pass later specifically to source
  authoritative pronunciations for the individual attraction/hotel
  flip-cards' pron-mini badges, rather than improvising 19+ phonetic
  guesses as part of this already-large batch.
- Verified via this project's established non-script-content discipline:
  all 17 `<script>` blocks re-verified via `new Function()` parsing after
  every edit in this batch (unaffected — pure HTML/table/card content, no
  script logic touched), a full script-excluded tag-balance recount after
  the final edit (div/table/tr/td/th/thead/tbody/ul/li/h3/h4/p all exactly
  even; `<img>` counted separately as the void element it is, not held to
  an open/close balance), and the duplicate-id sweep (unchanged from
  baseline — the same 4 pre-existing, unrelated Client Tracker bulk-action
  ids; this batch added zero new `id` attributes).
- **Unverified live, and this is a real, stated limitation, not a
  formality**: none of the 19 Commons image URLs has actually been
  rendered and looked at from this environment — `WebFetch` being blocked
  for `commons.wikimedia.org` means the confirmation stops at "a search
  result really points to a File: page with this exact name," not "this
  URL definitely renders a real photo in a browser." A wrong Commons
  redirect quirk, a since-deleted file, or an encoding mismatch in one of
  the accented filenames could still show a broken image for any single
  card despite the sourcing discipline above being real, not guessed.
  Test next, in priority order: open the Lisbon Key Attractions gallery
  in a real browser and scan for any broken image icons (the single most
  useful thing to check first); confirm the Hotels tables read clearly
  for Lisbon/Porto/Azores; and confirm the new Top Tours bullets render
  correctly given their dash-prefixed inline-paragraph format (copied
  exactly from Madrid's own established, if slightly unusual, pattern).
  More Job Aid xlsx sheets and more image-flip-card conversions (Porto,
  the Azores) are natural next installments whenever more time/material
  arrives.

## Full-file health check, round two — the Weather section specifically checked, everything came back clean (Sep 2026)

Direct request: "run a full scan. Make sure you are including the weather
section as well" — the same battery of checks used in the earlier "Full-
file health check (Sep 2026)" entry, re-run after this session's large
Portugal batch (Hotels xlsx, Popular Attractions xlsx cross-check, Top
Tours xlsx, the Lisbon flip-card conversion, the map extension), with the
Weather section explicitly named as something not to skip.

- **Script structure re-verified from scratch, not assumed.** The file
  now has 17 real `<script>` tags total: 1 external (`leaflet@1.9.4`,
  `src=`), 10 tiny self-contained city-map IIFEs (Madrid/Barcelona/
  Valencia/Seville/Granada/Córdoba/Marbella/Toledo/San Sebastián/Bilbao —
  each a single-line `<script>` immediately after that city's `.city-map-
  wrap` div), and 6 large logic blocks. A raw `<script` substring count
  first came back 21, 4 over the real total — all 4 were prose comments
  that literally contain the text `<script>` as an example (e.g. "...a
  separate `<script>` tag..."), the exact same false-positive shape this
  file's own history already documents for `<button>`/`<span>`/`<table>`/
  `<details>` mentions in comments — confirmed by reading each of the 4
  lines directly, not just assumed. All 16 real inline (non-`src`) script
  blocks extracted and `node --check`ed individually: all pass.
- **Tag balance recount, script content excluded first** (the
  established discipline — the file's own `SEARCH_INDEX` array contains
  literal un-terminated `<h3`/`<h4` substrings in its `"text"` fields
  that create phantom mismatches otherwise): div/table/tr/td/th/thead/
  tbody/ul/li/h3/h4/p/button/span/select/label/details/summary/a/strong/
  em all came back exactly balanced — including span and button, which
  have historically carried a permanent 1-off/2-off gap from prose
  comments describing this exact false-positive class; those comments
  live inside `<script>` blocks, so excluding script content this pass
  excluded the false positives right along with them, and there's
  nothing left unbalanced to explain away.
- **Duplicate-id sweep**: 782 total `id` attributes, 776 unique — the
  duplicates are exactly the same 4 pre-existing, unrelated Client
  Tracker bulk-action-bar ids this file's history has flagged every time
  this check has run (`ct-bulk-bar` ×3, `ct-bulk-status` ×2, `ct-bulk-
  apply` ×2, `ct-bulk-clear-btn` ×3) — zero new duplicates from this
  session's Portugal work, confirming the `p`-prefixed/`-portugal`-
  suffixed id conventions established throughout this build-out held.
- **`getElementById` cross-check**: all 331 distinct string-literal ids
  requested via `document.getElementById(...)` resolve to a real
  `id="..."` somewhere in the document. Zero misses.
- **Orphaned-reference sweep**: 31 bare camelCase-call candidates
  surfaced by the regex sweep, all resolved as false positives on
  inspection — most were real functions my sweep's own definition-
  pattern list didn't recognize (one-line arrow functions like `const
  cellsOf = row => ...` with no `function`/`async`/parenthesized-param
  keyword my regex was looking for, and object-literal method shorthand
  like `getResult() {`), and two (`renderDrafts`, `wireDraftButtons`)
  are the exact functions this file's own history already documents as
  found-dead-and-removed — they only surface here because the fix's own
  commit message is quoted verbatim inside a code comment
  ("...called `renderDrafts()`/`wireDraftButtons()`, which don't exist
  anywhere in this file...") — confirmed via a direct grep that these
  two names have exactly those 2 occurrences, both inside that one
  comment, zero real calls.
- **Cross-IIFE `window.__ta*`/`window.__ct*`/`window.__dt*` export
  audit**: 20 real exports defined; 19 have at least one real call site
  elsewhere. The one exception, `window.__dtOpenPanel = dtOpenOverlay`
  (Daily Tasks), has never been called from anywhere in the file —
  genuinely unused scaffolding, not a bug (nothing breaks by it existing
  unused), pre-existing from an earlier session's Daily Tasks build, not
  introduced by this session's Portugal work. Flagged here rather than
  removed, since removing an export nobody asked about wasn't in scope
  for a health-check pass — worth wiring up (e.g. a future "open Daily
  Tasks" voice command, matching the existing "open Amanda Jackson's
  lead card" pattern) or removing, whichever comes up first.
- **The Weather section, checked specifically as asked, not just
  assumed fine because nothing recently touched it.** Spain's
  `<h3 id="114-spain-weather-by-locale">` (~line 6466) is structurally
  intact: 6 real flip-cards (`#weather-city-cards`, Madrid/Barcelona/
  Valencia/Seville/Granada/Córdoba) with annual-avg/summer-high/winter-
  low/rain-season/shoulder-season figures, followed by a real sortable
  comparison table (`#spain-weather-at-a-glance-sortable-comparison`).
  Confirmed the "click column headers to sort" claim in the section's
  own intro text is real, not aspirational: `makeSortableTable()` (~line
  23088) wires real click-to-sort listeners onto every `<th>`, and a
  separate loop at line 23120 explicitly finds this exact heading id,
  walks forward through its siblings (a `<p>`, then the `<table>` — 2
  hops, well inside the function's own 5-hop search limit) and confirms
  it's a real `<table>` before wiring it — genuinely functional, not
  dead code. Also found and traced two separate JS data layers that back
  this section and feed OTHER features from it: `SPAIN_WEATHER` (~line
  10582 — summer-high/winter-low/rainiest-month/shoulder-season per
  city, explicitly commented as "pulled from this guide's own Spain
  Weather at a Glance table," feeding `qbWeatherWarnings()`, the
  function that adds a heat/cold warning banner to both the Quote
  Builder's draft itinerary AND the Trip Assistant's scenario drafts —
  confirmed via the comment stating both consumers share this one
  source so they can't disagree) and `window.__WX` (~line 12398 — full
  monthly high-temp/rain-%/season-code arrays, feeding a separate
  seasonal-caveat note inside the itinerary-recommendation engine's own
  `RULES`/`SIGNALS` matcher). Both layers came back internally
  consistent with the HTML section itself (the 6 cities with precise
  data in `SPAIN_WEATHER` match the 6 flip-cards/table rows exactly; the
  4 cities with only qualitative "shoulder" notes — Marbella/Toledo/San
  Sebastián/Bilbao — correctly have no card/table row, matching the
  section's own scope) and the sortable-table wiring — no drift, no
  stale data found anywhere in this section.
- **One real, worth-disclosing gap found in the Weather section's own
  data layers, not a bug — flagged rather than silently left implicit or
  silently "fixed" without being asked.** Both `SPAIN_WEATHER` and
  `window.__WX` are keyed only by the 10 `QB_CITY_ORDER` Spain cities —
  zero entries exist for any Portugal city (Lisbon, Porto, the Azores,
  etc.), consistent with the many already-documented, deliberate
  decisions elsewhere in this file to keep Portugal out of
  `QB_CITY_ORDER` for now. This is **not a crash risk** — both
  `qbWeatherWarnings()` and the `__WX`-based seasonal-caveat logic guard
  every lookup with `if (w && ...)` / equivalent, so a missing Portugal
  entry just silently produces zero warnings rather than throwing — but
  it does mean that if a Portugal city is ever explicitly quoted through
  the Quote Builder (via `qbExplicitStops`, the path the Trip Assistant
  uses when a scenario names explicit cities — this is possible today
  even though the normal city-dropdown auto-pick path stays Spain-only),
  the resulting draft would silently carry no summer-heat or winter-cold
  warning for that city, unlike every Spain city. Worth a real Portugal
  weather-data pass (a `PORTUGAL_WEATHER` object mirroring `SPAIN_WEATHER`'s
  shape, likely fed by the same per-city "Climate & Best Time to Visit"
  prose already built for Lisbon/Porto/the Azores this session) once
  Portugal's own build-out reaches the point where quoting a Portugal-
  only or mixed Spain+Portugal trip through the Quote Builder is a real,
  expected use case — not built speculatively here, since it wasn't
  what was asked and the current behavior fails safe (silent, not
  broken).
- **Net result: no real bugs found this pass.** Unlike the two earlier
  full-file health checks this file's history documents (which each
  found and fixed a real, previously-undiscovered bug —
  `ITIN_STOPWORDS`/`runSearchGuideTool`'s wrong field access, and
  `extractClientName`'s comma-vs-period gap), this scan came back clean:
  every check (syntax, tag balance, duplicate ids, `getElementById`
  cross-reference, orphaned-reference sweep, cross-IIFE export audit)
  confirmed correct, and the Weather section specifically holds up under
  direct inspection of both its HTML and its two backing JS data layers.
  The one finding worth acting on later is the Portugal-weather-data gap
  above — a scope gap, not a defect.

## Portugal weather gap closed, and the sidebar's Portugal section rebuilt to match Spain's (Sep 2026, unverified live)

Direct follow-up to the health check above: "okay well lets close that gap
and make sure the weather is accurate," then, mid-turn, a second real
gap: "I am not seeing the subsections for each city and other titles.
Make sure the side bar is updated with all relevant info and functions as
the Spain section does."

- **`PORTUGAL_WEATHER`** — a new object, same shape as `SPAIN_WEATHER`
  (`summerHighC`/`winterLowC`/`rainiest`/`shoulder`/`note`), added right
  after it. Covers exactly the three Portugal city keys this file's JS
  data model already treats as real — `Lisbon`/`Porto`/`Azores` — matching
  `QB_RESTAURANTS`' own established key set rather than inventing a
  fourth (Algarve/Faro, Sintra, Douro Valley, and Madeira have no
  `QB_RESTAURANTS` entry either, so weren't given one here). Figures are
  real published climate normals, not fabricated: Lisbon (28°C/82°F
  summer high, 8°C/46°F winter low, wettest in November); Porto (25°C/
  77°F, 5°C/41°F, wettest in December — genuinely cooler and wetter than
  Lisbon, especially in winter); Azores (24°C/75°F, 12°C/54°F — the
  mildest, narrowest swing of anywhere in this guide, with rain spread
  fairly evenly year-round rather than a real dry season). Same epistemic
  status as the original Spain figures already in this file: real
  general/published climate knowledge, not independently re-fetched live
  from this network-less environment — flagged the same honest way.
- **`qbWeatherWarnings()` updated to check both dictionaries**
  (`SPAIN_WEATHER[city] || PORTUGAL_WEATHER[city]`) rather than
  `SPAIN_WEATHER` alone — the one-line fix that actually closes the gap.
  Verified in a real Node test against the extracted logic: Madrid still
  correctly triggers a summer-heat warning (34°C), Lisbon/Porto/Azores
  correctly do NOT (all genuinely below the 33°C threshold — an honest
  reflection that Portugal doesn't get as brutally hot as inland Spain,
  not a gap), and Porto/Azores' winter lows correctly don't trigger the
  ≤4°C cold warning either (5°C and 12°C, both genuinely milder than that
  threshold). An unrecognized city (Sintra, still not in either dict)
  safely returns no warning rather than throwing.
- **This is still a correctness fix for a path that isn't reachable
  today, stated plainly rather than overclaimed.** `qbWeatherWarnings()`
  is called with `cities` from either `qbStopsForDays()` (the normal
  auto-pick path, which only ever draws from the Spain-only
  `QB_CITY_ORDER`) or `qbExplicitStops` (the Trip-Assistant-driven
  explicit-city path) — and a grep confirms `qbExplicitStops` is only
  ever READ in this file, never actually WRITTEN anywhere; nothing
  currently populates it. So no live code path hands a Portugal city
  name to `qbWeatherWarnings()` today. The fix is real and correct
  regardless — it makes the data honest and ready for whenever that path
  (or a future Portugal-inclusive `QB_CITY_ORDER`) is wired up, rather
  than leaving a silent, undiscovered gap sitting there for someone to
  hit later.
- **The three existing Portugal Climate sections enriched with the same
  real figures, so the visible guide text and the JS data layer can't
  drift apart.** Lisbon's `<h4 id="climate-best-time-lisbon">` and
  Porto's `<h4 id="best-time-to-visit-porto">` both had only vague,
  qualitative language before ("hot, dry," "mild by northern-European
  standards") — added the same precise summer-high/winter-low/rainiest-
  month figures now backing `PORTUGAL_WEATHER`, matching the precision
  Spain's own city Climate sections already use. **The Azores had NO
  Climate/Best-Time-to-Visit section at all** — flagged as a deliberate,
  honest gap in an earlier session ("this source material contained no
  explicit seasonal-recommendation... content... left out rather than
  fabricated") — closed now with a real new
  `<h4 id="climate-best-time-azores">`, since real climate data is now
  actually in hand rather than being guessed to fill the gap. Framed
  explicitly as an exam-likely inversion of the mainland's own logic:
  Spain/Lisbon/Porto's seasonal advice is about avoiding HEAT, while the
  Azores' real seasonal factor is RAIN, not temperature — worth a DE
  knowing that's a genuinely different kind of seasonal reasoning, not
  just a footnote.
- **The sidebar's Portugal section — a second, independent real gap,
  reported directly by the DE mid-turn, not found by static review.**
  `#toc-nav`'s Portugal `nav-sec-body` (`id="navgrp20"`) turned out to
  still be the version from BEFORE this whole session's Portugal
  build-out — nine flat, non-expandable entries (Must-know numbers,
  Key locales, Lisbon, Porto, Sintra, Douro Valley, Algarve, DMCs, TMT
  Itineraries), zero subsections, zero mention of the Azores or any of
  the Top Tours/Arrivals & Transfers/Top Itineraries (Job Aid) sections
  built this session — while every Spain city has real, toggleable
  `nav-h4-list` subsection dropdowns. **A second, real bug found while
  fixing this**: the existing "Lisbon" sidebar link pointed at
  `#lisbon-city`, an id that no longer exists anywhere in the document —
  confirmed via grep, zero matches. That id was orphaned back when Lisbon
  was promoted and its real id changed to `p1-lisbon` (to fix the
  `17-lisbon`/`17-valencia` collision, an earlier session's own
  documented fix) — the sidebar link was never updated to follow, so
  clicking "Lisbon" in the nav has done nothing this entire time.
- **Rebuilt the whole Portugal `nav-sec-body` from the file's own real
  heading structure**, not guessed — extracted every real Portugal `h3`/
  `h4` id and its heading text directly from the document (a Python
  script over the actual file, not memory) before writing a single line
  of nav markup, the same "verify against the real file first" discipline
  this whole Portugal build-out has used throughout. Now mirrors Spain's
  exact markup shape (`nav-h3-item` → `nav-h3-row` + `nav-toggle` +
  `nav-h4-list` of `nav-subitem` links for anything with real
  subsections; plain `nav-item-solo` for anything without) for all 14
  top-level Portugal entries, in real document order: Must-know numbers
  (solo), Key locales overview (1 subsection), **Lisbon (20
  subsections)**, **The Azores (12 subsections, including the brand-new
  Climate section above)**, **Porto (11 subsections)**, Sintra/Douro
  Valley/Algarve/Madeira (solo — genuinely no subheadings exist inside
  these compact `<h4>` stubs yet, confirmed by the same extraction, not
  assumed), Top Tours (Job Aid) (solo), DMCs in Portugal (solo),
  Arrivals & Transfers (Job Aid) (3 subsections — Flights/Trains/Private
  Transfers), Top Itineraries (Job Aid) (solo), TMT Itineraries (solo).
  The dead `#lisbon-city` link is fixed to point at the real `#p1-lisbon`
  id. New toggle target ids (`navsubP1`–`navsubP5`) follow this whole
  build-out's own `P`-suffix/prefix collision-avoidance convention,
  confirmed via the duplicate-id sweep to be genuinely new, non-colliding
  strings.
- **Zero new JS was needed for any of this to actually work** — confirmed
  by reading the wiring code directly rather than assuming. The sidebar's
  toggle/accordion behavior (`toggleNavDropdown`/`closeAllH3Dropdowns`)
  is a single delegated listener over `document.querySelectorAll('#toc-
  nav .nav-h2-row, #toc-nav .nav-h3-row')` keyed purely by each button's
  own `data-target` attribute against a real element id — genuinely
  generic, with no hardcoded list of sections anywhere to update. The
  same is true of the `tocSearch` filter-as-you-type box (queries
  `.nav-h3-item`/`.nav-h4-list`/`.nav-subitem` generically) and the
  scroll-spy heading collector (`#main h2[id], h3[id], h4[id], h5[id]`,
  also fully generic). Using the exact same class names Spain's markup
  already uses was what made this "just work" — confirmed by testing the
  actual node counts match the exact expected math (14 `nav-h3-item`, 5
  `nav-toggle`, 47 `nav-subitem` — 1+20+12+11+3 — after the edit),
  not just that it looked plausible.
- **`portugalMapBtn` re-enabled, and wired to the real unified map.** The
  sidebar's own "Interactive maps" row still had a `disabled` Portugal
  Map button titled "Coming soon — once Portugal's locale sections are
  built out" — stale on two counts: Portugal's locale sections ARE now
  built out, and (per this build-out's very first entry) Spain and
  Portugal were always meant to share ONE unified interactive map, not
  two separate ones — confirmed the map itself already carries real
  Lisbon/Porto/Sintra/Faro pins from an earlier session's map-extension
  pass. Rather than build (or fake) a second, separate "Portugal-only"
  map, the button now does exactly what `spainMapBtn` does — scrolls to
  the same `#120-spain-interactive-trip-planner-map` section — since
  that's the honest, correct behavior for a genuinely shared map, not a
  workaround.
- Verified via this project's established non-script-content discipline
  plus a fresh syntax pass on the one small JS change: all 16 real inline
  `<script>` blocks re-extracted and `node --check`ed individually (all
  pass — confirms the `PORTUGAL_WEATHER` object literal and the new
  `portugalMapBtn` listener are syntactically valid, not just visually
  plausible); a full script-excluded tag-balance recount (div/table/tr/
  td/th/thead/tbody/ul/li/h3/h4/p/button/span/select/label/details/
  summary/a/strong/em all held exactly even — h3 unchanged at 80/80 since
  no new h3 was added, only one new h4 for the Azores Climate section and
  the nav's own new div/button/a markup, all internally balanced); the
  duplicate-id sweep (unchanged from the established baseline — the same
  4 pre-existing, unrelated Client Tracker bulk-action ids; all 5 new
  `navsubP*` ids and the Azores Climate section's own new id are
  genuinely new, non-colliding strings); a `getElementById` cross-check
  (332 distinct string literals now, all resolving to a real `id="..."`,
  zero misses — confirms `portugalMapBtn` and everything else the JS
  touches is real); and the real Node test against the extracted
  `qbWeatherWarnings()` logic described above.
- **Unverified live, same caveat as the rest of this Portugal build-out**:
  the sidebar's actual expand/collapse feel with Portugal's now-much-
  longer Lisbon/Azores/Porto dropdowns (20/12/11 subsections respectively,
  noticeably longer than most Spain cities' own lists), whether the
  `tocSearch` filter box surfaces the new Portugal subsections cleanly
  when typed into, and whether clicking the re-enabled Portugal Map
  button actually scrolls to and highlights the right pins in a real
  browser — none of this has been seen outside this environment. Test
  next: open the sidebar, expand Lisbon/Azores/Porto and confirm every
  subsection link actually jumps to the right heading, click the
  previously-dead "Lisbon" link (now fixed) and confirm it lands on
  `p1-lisbon`, type a Portugal-specific term into the "Filter contents"
  box and confirm matching subsections surface, and tap the Portugal Map
  button and confirm it lands on the interactive map with the real
  Lisbon/Porto/Sintra/Faro pins visible.

## Interactive map: a real bug found in the Portugal coastline, the west coast redrawn with more detail, Portugal's own mountain + river added (Sep 2026, unverified live)

Direct request, from a screenshot of the Interactive Trip Planner Map
showing Lisbon/Sintra/Porto/Faro's pins sitting oddly close to (and
outside) the green landmass edge, with "Sintra"/"Lisbon" labels visibly
overlapping: "combine it, make it a neutral location... make Portugal
more detailed like Spain, use landscapes and land marks on the map."

- **A real, previously-undiscovered bug, found by testing rather than
  assumed from the screenshot alone.** This file has always carried TWO
  independent copies of the landmass shape — `QB_LANDMASS_PATH` (feeds
  the Quote Builder's own small route-map SVG) and a second, separately
  hardcoded `d="..."` on `<path id="tp-landmass">` inside
  `renderTripPlanner()` (feeds the actual Interactive Trip Planner Map —
  the one in the screenshot). An earlier session's own "Interactive map"
  entry above extended `QB_LANDMASS_PATH` with a rough Portugal bulge but,
  confirmed via a real point-in-polygon test run against both paths
  directly, **never touched `#tp-landmass`'s own separate copy** — it
  silently stayed the old Spain-only shape. All four Portugal pins were
  floating genuinely outside the shape actually being drawn on screen —
  exactly what the screenshot shows, not a labeling nit.
- **Fixed at the root, not patched around**: `#tp-landmass`/`#tp-island`
  no longer carry their own hardcoded `d="..."` — they now read
  `d="${QB_LANDMASS_PATH}"`/`d="${QB_ISLAND_PATH}"` directly inside
  `renderTripPlanner()`'s own template literal (confirmed this is legal —
  the constants are real top-level `const`s declared in an earlier
  `<script>` tag, and this file's own scripts already share global scope
  in document order). One shape now feeds both maps; this exact class of
  bug (two copies of the same data silently drifting apart) can't recur
  here again.
- **The west coast itself redrawn with real detail, not just repaired.**
  Replaced the old single crude "bulge" with 17 points forming an actual
  coastline: an Algarve stretch sweeping south past **Cabo de São
  Vicente** (the real SW tip of mainland Europe), a Tagus-estuary inlet
  at Lisbon, a westward point near **Cabo da Roca** (mainland Europe's
  real westernmost point, right by Sintra), and a Douro-estuary notch at
  Porto — comparable in point-density to how Spain's own ~30-point
  coastline is drawn, not a rough approximation anymore. Spain's own
  boundary (everything between the two shared anchor points) was left
  completely untouched, per this build-out's standing rule that it's
  traced from real geographic data and shouldn't be redrawn.
- **The Sintra/Lisbon label collision fixed at its actual cause.** The
  two pins sat only ~11px apart in a 560-wide viewBox — genuinely too
  close for two 12px-font labels to ever not overlap, regardless of the
  landmass fix. Moved Sintra to a real, plausible position near Cabo da
  Roca (Sintra's real-world location, WNW of Lisbon) — confirmed via
  real distance/point-in-polygon/margin-to-coastline checks in Python
  before touching the file, not eyeballed: now ~44px from Lisbon with a
  real margin inside the new coastline. The one road segment connecting
  them (`TRIP_PLANNER_ROADS`) was updated to match — confirmed via grep
  that no other data in the file referenced Sintra's old coordinates.
- **Landscape parity with Spain, using the exact same categories Spain
  already has — no new marker type invented.** Added **Serra da
  Estrela** (mainland Portugal's real highest range) to
  `TRIP_PLANNER_MOUNTAINS` and the **Douro** (the real river that starts
  in Spain as the "Duero" and reaches the sea at Porto) to
  `TRIP_PLANNER_RIVERS` — both rendered through the exact same triangle-
  glyph/polyline code Spain's own mountains and rivers already use, no
  new SVG element type added. **Deliberately did not invent a separate
  "landmark" icon category** for Portugal — Spain's own map has no
  marker type beyond city pins/roads/mountains/rivers, so a Portugal-
  only landmark icon would have been asymmetric in the other direction
  rather than genuine parity; Cabo de São Vicente and Cabo da Roca are
  real landmarks, but are represented as coastline shape (where they
  physically are), not as a new icon this map has never had for any
  country.
- Verified via this project's established non-script-content discipline
  plus real geometry checks specific to this pass: all 16 inline
  `<script>` blocks re-verified via `node --check` (confirms the new
  path literal and the `${QB_LANDMASS_PATH}`/`${QB_ISLAND_PATH}`
  template interpolation are syntactically valid); a full script-
  excluded tag-balance recount (all tracked tags held exactly at the
  established baseline — pure JS-data and template-literal changes, no
  HTML markup touched); and, the real check that mattered most here, a
  Python point-in-polygon test confirming **every one of the 16 city
  pins** (Spain's 12 plus Portugal's 4) and **every mountain/river
  point**, including the two new Portugal additions, now genuinely sits
  inside its correct shape (mainland vs. the separate Mallorca island
  path) — re-run against the final, actually-committed file content, not
  just the drafted coordinates.
- **Unverified live, and this is real visual/rendering work no static
  check can confirm**: whether the redrawn west coast actually reads as
  a natural-looking coastline once rendered in a real browser (point-in-
  polygon containment confirms correctness, not that it looks good), and
  whether the Sintra/Lisbon label separation is now visually comfortable
  at the map's real on-screen size — none of this has been seen outside
  this environment. Test next: open the Interactive Trip Planner Map and
  confirm all four Portugal pins now sit clearly inside the green
  landmass with visible margin, that Sintra's and Lisbon's labels no
  longer overlap, and that the coastline's new detail (the Algarve
  sweep, the Lisbon inlet, the Porto notch) reads as a plausible map
  rather than jagged or odd at actual rendered size.

## Interactive map: a real country border added, and the map enlarged/centered to use the space it was wasting (Sep 2026, unverified live)

Direct follow-up, from a screenshot of the just-fixed map: "we need to
see the border between the two countries. You can centered and largen
the map as well, a lot of wasted space on the right hand side. More
detail and realism."

- **A real Spain–Portugal border line, not implied by color alone.**
  The landmass is (deliberately, per this build-out's very first entry)
  one single merged polygon — Spain and Portugal were always meant to
  share one map, not two — so there was never an internal edge between
  the two countries' fills for a viewer to actually see. Added
  `TRIP_PLANNER_BORDER`, a new 7-point line (`[56,155]` near the north
  coast down to `[125,425]` near the Algarve/Guadiana area) rendered as
  its own stroked-only `<path class="tp-border">` — no fill, drawn right
  after the landmass/island shapes so it sits under the rivers/roads/
  pins rather than competing with them. Styled as a warm brown dashed
  line (`#8a5a2b`, `stroke-dasharray: 3 4`), visually distinct from both
  the white-dashed highways and the blue rivers, plus its own new legend
  entry ("Spain–Portugal border").
- **Routed to loosely track where the real border actually runs, not a
  straight line drawn for convenience.** Points bend near where the
  Douro and Tagus rivers cross the real border (matching this build-out's
  established `TRIP_PLANNER_RIVERS` data), continuing the same honest
  framing already used for the coastline redraw: **explicitly an
  approximation, not a traced border dataset** — this environment has no
  way to fetch real geographic border data, so this is a plausible,
  reasonably-placed line, stated as such in the code's own comment,
  not represented as survey-accurate. Verified in Python before
  committing that every border point stays comfortably clear (28px+) of
  every city pin, so the line never cuts through a label.
- **The actual "wasted space" complaint, fixed at its real cause — the
  map's own max-width, not the map's aspect ratio or its content.**
  `#tp-map-svg` was hard-capped at `max-width: 420px` inside a `#tp-map-
  wrap` that, on any normal-width screen, is far wider than 420px —
  confirmed directly from the screenshot's own proportions (the map
  filled maybe half the available row, with the legend and a large gap
  of plain cream background to its right). Regrouped the SVG and its
  legend into a new `#tp-map-col` (`flex: 3 1 640px; max-width: 720px`)
  so they grow together as one unit, bumped `#tp-map-svg`'s own cap from
  420px to 700px, and centered the whole `#tp-map-wrap` (`justify-
  content: center`, capped at `max-width: 1180px` so it doesn't stretch
  edge-to-edge on a very wide monitor either) — the map is now roughly
  70% larger on a typical desktop width while `#tp-controls` (the click-
  to-select panel) keeps its own sensible `max-width: 340px` alongside
  it rather than being crowded out. The existing narrow-screen media
  query (`flex-direction: column` under the mobile breakpoint) needed
  only two additions (`#tp-map-col`/`#tp-controls` both capped at 100%
  width there) to keep working the same way it already did — the column
  stacks exactly as before on a phone-width screen.
- Verified via this project's established non-script-content discipline
  plus the same geometry-check method used for the coastline fix: all 16
  inline `<script>` blocks re-verified via `node --check` (confirms the
  new `TRIP_PLANNER_BORDER` array literal and the render function's new
  `borderD` template logic are syntactically valid); a full script-
  excluded tag-balance recount (all tracked static-HTML tags held
  exactly at the established baseline — the new `#tp-map-col` div and
  border `<path>` are both JS-template-string content inside `renderTrip
  Planner()`, the same dynamically-injected-markup category this file's
  own tag-balance check has never counted, consistent with how the rest
  of this map's own markup was already treated); the duplicate-id sweep
  (unchanged from baseline — the same 4 pre-existing, unrelated Client
  Tracker bulk-action ids; the new `tp-map-col` id confirmed genuinely
  unique); and a real Python distance check confirming every border
  point's clearance from every city pin (minimum 28px, at Porto).
- **Unverified live, and this is real visual/layout work no static check
  can confirm**: whether 700px actually reads as "enlarged and centered"
  rather than just "bigger" on the DE's real screen, whether the new
  dashed-brown border line is visually legible against the pale green
  landmass fill without looking like clutter next to the highway/river
  lines, and whether the border's own routing (through the Douro/Tagus
  crossing points) looks geographically sane once actually rendered —
  none of this has been seen outside this environment. Test next: open
  the Interactive Trip Planner Map and confirm the map now fills most of
  its row with visibly less empty space beside it, that a clear brown
  dashed line separates Portugal from Spain, and that the new legend
  entry reads clearly alongside the existing three.

## Interactive map: 10 missing Portugal cities/islands added, road labels corrected to real highway numbers, and a real click-2-pins travel-time/mode feature (Sep 2026, unverified live)

Direct follow-up: "okay this is great. Some cities and islands are
missing from Portugal. Add in the appropriate missing areas. Make
road/highway mapping more accurate as well. Can it include the time to
travel to each place when you click on 2 locations as well? For
example, when I click on Porto and Faro, it tells me the amount of
travel time and recommended travel type, car/train/domestic flight?"
Three real pieces, each grounded in real coordinates/highway numbers/
guide facts rather than guessed — the standing discipline for this
whole Portugal build-out.

- **6 new mainland pins, placed via the same real affine transform this
  map's Portugal pins have always used, not eyeballed.** Recomputed the
  transform fresh (Spain's 9 most-precisely-known reference cities'
  real lng/lat → their real pin x/y, solved via least-squares in pure
  Python — no numpy available in this environment, so the 3×3 normal-
  equations solve was hand-written) and confirmed it reproduces
  Lisbon/Porto/Faro's own already-placed pins within ~1.5px, i.e. the
  same transform as before. Applied to **Cascais, Évora, Coimbra,
  Aveiro, Albufeira, and Douro Valley** (Peso da Régua as its
  representative point) — the six Portugal locations with the most
  real, already-built guide content (Locale Planning Quick Reference
  rows, a full Chapel-of-Bones/Day-Trip writeup, Popular-Attractions
  xlsx detail, etc.) that didn't yet have a map pin. Verified via a
  real point-in-polygon test against `QB_LANDMASS_PATH` (all six land
  inside the shape) and a pairwise-clearance check against every other
  pin. Cascais and Albufeira came back too close to Lisbon/Faro
  respectively for their labels not to collide (12–14px) — nudged both
  a further, still real-direction-correct few px west along the coast,
  the same fix already applied to Sintra in an earlier pass, until
  every new pin cleared the established Málaga–Marbella precedent
  (22.4px, the closest two pins already tolerated anywhere on this
  map) — confirmed via the same test, re-run against the actual
  committed file content, not the drafted coordinates.
- **4 new Azores/Madeira pins, in a genuinely new schematic inset box —
  not an extrapolation of the real transform.** The Azores (real lng
  ≈ −25 to −31) and Madeira (≈ −17) sit far enough west of every Spain
  reference point that projecting them through the real transform would
  land them off the edge of the 560×520 viewBox entirely, or force the
  whole map to shrink to make room for empty ocean. Used the standard
  cartographic fix instead — the same one printed Portugal/US maps use
  for this exact problem (a US map's Hawaii/Alaska corner insets, e.g.):
  a new `TRIP_PLANNER_INSET_BOX` const, explicitly labeled "Azores &
  Madeira (schematic — not to scale)," placed at a genuinely open patch
  of ocean on this map (verified via a grid-sampled point-in-polygon
  sweep against `QB_LANDMASS_PATH` before picking coordinates — the
  whole region is landmass-free, and it sits 130+px from the nearest
  real pin, so it can never visually collide with anything). Holds
  **São Miguel, Terceira, and Faial** (the three Azores islands with
  real Locale Planning Quick Reference nights/alternatives/add-ons data
  already in this guide) plus **Madeira** — each pin still carries its
  real lat/lng (for the travel-time feature below), just a schematic
  on-screen x/y, flagged via a new `inset: true` field. Reused the
  existing generic `.tp-pin`/`toggleTripPin()` click machinery
  unchanged for these four — they're real, clickable, selectable pins
  like any other, just visually grouped inside a dashed box instead of
  sitting at their true (off-map) position.
- **Road labels corrected to real Portuguese highway designations, one
  genuine inaccuracy found and fixed.** The Seville–Lisbon line had
  been labeled "A-49" since an earlier session — real, but only for the
  Spain-side Seville–Huelva leg, not the whole route. The actual
  standard direct drive is Spain's **A-66** to the Badajoz/Elvas border
  crossing, then Portugal's **A6** the rest of the way to Lisbon (the
  same A6 this map already uses for the separate Lisbon–Évora leg) —
  relabeled "A-66 / A6". The other four pre-existing Portugal-touching
  labels (Lisbon–Sintra "A-16", Lisbon–Porto "A-1", Lisbon–Faro "A-2")
  were checked against real Portuguese auto-estrada designations and
  confirmed already correct, left unchanged. **6 new road segments**
  for the new pins, each a real highway: Lisbon–Cascais (**A-5**,
  Auto-estrada da Costa do Estoril), Lisbon–Évora (**A-6**, Auto-estrada
  do Sul), Porto–Aveiro and Aveiro–Coimbra (both **A-1**, continuing
  Porto's own corridor south in real geographic order rather than a
  single nearest-neighbor jump straight from Porto to Coimbra),
  Faro–Albufeira (**A-22**, Via do Infante), and Porto–Douro Valley
  (**A-4**, Auto-estrada Transmontana). No roads connect the four inset
  Azores/Madeira pins — real trips there go by flight or seasonal
  ferry, matching how every other island on this map (Mallorca) is
  already treated.
- **A real click-2-pins travel-time/mode feature, the third explicit
  ask.** Every `TRIP_PLANNER_PINS` entry — including the original 12
  Spain and 4 Portugal pins, not just the new ones — now also carries
  real `lat`/`lng` fields, so the feature has one consistent data
  source for ANY pair, not just newly-added cities. A new `#tp-travel-
  time` box (in `#tp-controls`, above the existing Find-My-Itinerary/
  Clear buttons — updates live on every pin click, not gated behind a
  button) shows a mode + time line the moment exactly 2 pins are
  selected, and hides itself again the instant selection count is
  anything else — wired into the two existing selection-mutation
  functions (`toggleTripPin`/`clearTripPlanner`) rather than adding a
  third, parallel selection-tracking mechanism.
  - **16 explicit `TRAVEL_TIMES` entries, sourced from real facts
    already written elsewhere in this guide, grep-verified before use
    rather than re-derived from memory**: Porto↔Faro's Ryanair-only
    flight and 5+ hr not-recommended train (this session's own earlier
    Arrivals & Transfers Flights/Trains modules), Lisbon↔Porto's Alfa
    Pendular timing, Madrid↔Toledo's ~30 min commuter train and
    Madrid↔Barcelona's ~3 hr AVE (both already stated in this guide's
    own Spain train-travel section), and the Azores' real SATA-flight/
    seasonal-Atlanticoline-ferry facts (this session's own Azores
    Arrivals & Transfers content) — plus a handful of real, well-
    established regional facts (Lisbon↔Sintra/Cascais commuter rail,
    Porto↔Coimbra/Aveiro, Faro↔Albufeira, Porto↔Douro Valley) disclosed
    as ordinary travel knowledge rather than claimed as guide-sourced.
  - **A real bug caught by testing, not assumed correct from the
    draft**: the Lisbon↔Évora entry's key was written as
    `"Évora|Lisbon"` by hand, but a real Node test of the actual
    `[a,b].sort().join('|')` key-building logic against the real pin
    names showed JS's default UTF-16-code-unit string sort puts
    `"Lisbon"` (L = U+004C) before `"Évora"` (É = U+00C9) — the
    opposite of naive alphabetical intuition. The stored key silently
    never matched a real lookup; every Lisbon↔Évora click would have
    silently fallen through to the generic distance-estimate fallback
    (which happened to compute the same "~1 hr 30 min" by coincidence,
    masking the bug from a casual look) instead of surfacing the real,
    sourced A-6 note. Fixed by correcting the key to `"Lisbon|Évora"`,
    then re-ran the same real Node test against all 16 keys and
    confirmed every one now matches its real sorted pin pair — this is
    exactly the kind of mismatch that looks fine on a manual read and
    only shows up under actual execution, the same lesson this file's
    own history has learned the hard way more than once (`ITIN_
    STOPWORDS`, `renderDrafts`/`wireDraftButtons`).
  - **A disclosed, honest fallback for every other pair.** Any city
    pair not in the explicit table (still the large majority of
    possible pairs) is estimated from real haversine great-circle
    distance between the two pins' actual lat/lng, with a simple mode
    rule: either pin marked `inset` (an Azores/Madeira island) always
    recommends a flight, since a real trip there always crosses open
    water regardless of mainland distance; otherwise >400km suggests a
    flight (distance ÷ realistic cruise speed + a ground-handling
    buffer), 120–400km suggests "train or car" at real highway speed,
    and under 120km suggests a plain car estimate at a slower mixed-
    road speed. Every estimate is visibly labeled on-screen ("Estimated
    from straight-line distance... not a sourced fact; confirm actual
    routing/timing before quoting a client") — never presented as
    equal-confidence to a `TRAVEL_TIMES` entry, matching this whole
    build-out's standing rule about disclosing approximations.
- Verified via this project's established discipline plus the extra
  execution-based check the key bug above specifically called for: all
  16 inline `<script>` blocks re-extracted and `node --check`ed
  individually (all pass, both before and after the key fix); a full
  script-excluded tag-balance recount (div/table/tr/td/th/thead/tbody/
  ul/li/h3/h4/p/button/span/select/label/details/summary all held
  exactly even); the duplicate-id sweep (unchanged from the established
  baseline — the same 4 pre-existing, unrelated Client Tracker bulk-
  action ids; the new `tp-travel-time` id confirmed genuinely unique);
  a `getElementById` cross-check (333 distinct string-literal lookups,
  zero missing); a reference-count check confirming every new helper
  function (`updateTripPlannerTravelTime`/`tpPairKey`/`tpHaversineKm`/
  `tpFormatHours`/`tpEstimateTravelMode`) has real callers beyond its
  own definition, not just defined-and-orphaned; a real point-in-
  polygon/clearance re-check run against the FINAL committed file
  content (not the drafted values) confirming all 22 non-inset pins
  land inside the mainland shape, all 4 inset pins land inside both the
  new inset box AND outside the mainland shape (as intended), and every
  pin clears the established 22.4px precedent; and a real Node
  simulation of the actual click-2-pins logic across 9 sample pairs
  (both click orders of Porto/Faro correctly resolve to the same
  entry; Lisbon/Évora now correctly hits the real entry post-fix;
  Madrid/Barcelona hits its real entry; São Miguel/Madeira and
  Madrid/São Miguel both correctly fall back to a flight estimate;
  Sintra/Cascais and Toledo/Granada both produce reasonable car/train
  estimates at genuinely different distances).
- **Deliberately not built**: a full A-to-B routing engine (real road-
  network distance, not straight-line) — this map has never had real
  routing data for ANY pair, existing or new, so a haversine-based
  estimate is consistent with everything else here, not a new kind of
  approximation; individual pins for the Azores' other 6 islands (Pico,
  São Jorge, Graciosa, Santa Maria, Flores, Corvo) or for Coimbra/
  Aveiro's own day-trip satellites — scoped to the locations with real,
  already-built guide content backing them, matching this whole
  build-out's "don't guess, place diligently" rule; and re-deriving
  Spain-only travel times beyond the two (Madrid↔Toledo, Madrid↔
  Barcelona) already explicitly documented elsewhere in this guide —
  the fallback estimator already covers the rest reasonably, and
  hand-sourcing a full 16×16 pair matrix was judged disproportionate to
  what was actually asked.
- **Unverified live, same caveat as the rest of this Portugal build-
  out, and this is real interactive/visual work no static check can
  confirm**: whether the new pins' label text stays legible at their
  real on-screen spacing once rendered (point-in-polygon and pixel-
  clearance checks confirm correctness, not that it looks uncrowded);
  whether the dashed inset box reads clearly as "this is schematic, not
  really located here" rather than as a stray disconnected map
  fragment; whether the `#tp-travel-time` box's placement (above the
  existing buttons, always-live on click) feels like a natural part of
  the flow rather than a jarring extra box; and whether the haversine-
  based estimates "feel right" against real DE intuition for a pair
  like Toledo↔Granada — none of this has been seen in a real browser
  from this environment. Test next: open the Interactive Trip Planner
  Map, confirm all 10 new pins render inside the (correct) landmass or
  inset box with legible labels, click Porto then Faro and confirm the
  travel-time box shows the real Ryanair/train-not-recommended note,
  click any two mainland cities with no explicit entry (e.g. Toledo and
  Granada) and confirm a clearly-labeled estimate appears instead, and
  confirm selecting a 3rd pin or clearing selection correctly
  hides the travel-time box again.

## Interactive map: the real bottleneck was the whole guide's content column, not the map's own CSS (Sep 2026, unverified live)

Direct follow-up, from a fresh screenshot showing the map's controls
("Click cities to add them" + the two buttons) dropped BELOW the map
instead of beside it, with a large blank area to the right of the whole
thing: "Can we use the space to the right on the map though? It is
wasted space. That way all the mapping can be more accurate so all the
cities can be in the appropriate location geographically."

- **Root cause, found by reading the actual layout chain rather than
  just re-tuning the map's own numbers again.** The previous "enlarge
  and center" pass (see the entry above) raised `#tp-map-col`/`#tp-map-
  svg` to a 700–720px range and `#tp-map-wrap` to a 1180px cap — but
  never checked those against the REAL width available inside `#main`,
  this guide's whole content column. `#main` has always been hard-capped
  at `max-width: 960px`, and `#main-inner` adds `60px` of padding on
  each side — so the actual usable width for anything inside, map
  included, was only ~840px. `#tp-map-col`(720) + a 28px gap +
  `#tp-controls`(340) = 1088px — already more than that 840px budget
  **before** this session's own 10-new-pins/travel-time batch even
  shipped. The controls were silently dropping to their own line on
  every normal-width screen, not just narrow ones, and the "wasted
  space" the DE is pointing at is the gap between `#main`'s own 960px-
  capped column and the actual, much wider browser viewport around it —
  confirmed this is the real shape of the bug (not the map's own SVG
  having unused ocean space inside its viewBox — the Azores/Madeira
  inset box already sits right up against the viewBox's own right edge,
  leaving almost no true internal margin there).
- **Fixed at that real bottleneck**: raised `#main`'s own `max-width`
  (960px → 1300px) and its sidebar-collapsed variant
  (`body.sidebar-collapsed #main`, 1100px → 1400px) — both left
  otherwise identical (same offsets, same centering behavior, same
  mobile `100%` fallback at the existing 900px breakpoint, untouched).
  Then re-sized the map's own elements to actually use that newly real
  room while comfortably fitting `#tp-map-col` beside `#tp-controls`
  again (recomputed against `#main-inner`'s known 120px horizontal
  padding and `#tp-map-wrap`'s own 48px, not just guessed): `#tp-map-
  col` 720px → 760px, `#tp-map-svg` 700px → 740px, `#tp-controls` 340px
  → 320px, `#tp-map-wrap` 1180px → 1280px. The math: default state now
  has ~1132px of real flex budget, and `760 + 28 + 320 = 1108px` fits
  inside it with ~24px to spare — a real, checked fit, not a repeat of
  the same unverified-overflow mistake the previous pass made.
- **A real, stated tradeoff, not a free win**: `#main` is the container
  for the ENTIRE guide, so this also widens the line length of every
  other paragraph and table in the file, not just the map — 1300px
  (1400px collapsed) is still a normal desktop content width for a
  reference tool this table-heavy, but it's a genuine, disclosed change
  in how the rest of the guide reads, not something scoped only to the
  map section. Deliberately did NOT attempt a narrower "just break the
  map out of `#main`'s box" CSS trick (negative-margin/viewport-calc
  breakout) instead — `#main`'s own left offset differs across three
  real states (330px sidebar-expanded, 0px collapsed, 0px mobile), and
  a breakout calibrated to only one of those would either overflow or
  silently do nothing in the other two; this environment has no way to
  render and catch that kind of overflow bug before it ships, so the
  plain, uniform width increase — the same one CSS number checked
  against the same layout math in all three states — was the safer,
  more honestly verifiable choice, even though it's a bigger blast
  radius than "just the map."
- **"So all the cities can be in the appropriate location geographically"
  — addressed as a rendering/legibility fix, not a coordinate change.**
  No pin coordinates, the affine transform, or `QB_LANDMASS_PATH` were
  touched here — those were already verified geographically correct
  (point-in-polygon/clearance-checked) in the immediately preceding
  entry. This pass is purely about the map rendering PHYSICALLY BIGGER
  (more real screen pixels per viewBox unit), which is what actually
  helps the already-correct-but-tightly-clustered Portugal pins
  (Lisbon/Cascais/Sintra/Évora, Porto/Aveiro/Coimbra/Douro Valley) read
  as being in genuinely separate, legible locations rather than a
  crowded knot — the same relative geographic accuracy, just easier to
  actually see.
- Verified via this project's established non-script-content discipline:
  all 16 inline `<script>` blocks re-extracted and `node --check`ed
  individually (unaffected — pure CSS, checked anyway per standing
  practice); a full script-excluded tag-balance recount (all tracked
  tags held exactly at the established baseline — no HTML markup
  touched, only CSS values); the duplicate-id sweep (unchanged from
  baseline — the same 4 pre-existing, unrelated Client Tracker bulk-
  action ids; no new `id` attributes were added); and the actual layout
  arithmetic re-derived from the real `#main-inner`/`#tp-map-wrap`
  padding values read directly out of the file (not assumed from
  memory) and checked to fit in both the default and sidebar-collapsed
  states before committing, the same real-numbers-not-guesses discipline
  this whole map-extension effort has used throughout.
- **Unverified live, and this is the one thing most worth a real
  browser check**: whether 1300px (1400px collapsed) actually reads as
  "comfortably wider" or "too wide" for the guide's plain prose
  sections — tables and the map benefit clearly, but long paragraphs of
  running text haven't been seen at this new width in a real browser.
  Also unverified: whether `#tp-map-col`/`#tp-controls` now genuinely
  sit side by side as intended (the arithmetic checks out, but arithmetic
  isn't a browser), and whether the bigger map (740px vs. the old
  effective ~700px) reads as meaningfully roomier or only marginally so
  once actually rendered. Test next: open the Interactive Trip Planner
  Map at a normal desktop window width and confirm the "Click cities to
  add them" controls now sit beside the map (not below it), that there's
  visibly less blank space to the right of the whole section, and — the
  real tradeoff check — skim a text-heavy section elsewhere in the guide
  (e.g. a Culture & Etiquette page) and confirm the wider paragraph
  column still reads comfortably rather than feeling stretched.
