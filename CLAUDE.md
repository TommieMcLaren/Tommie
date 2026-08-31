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

## Design decisions to preserve, not "helpfully" change

- Outlook is read+draft only, never send. The Client Tracker's "Add to
  Outlook" button follows the same rule in its push-only form: it only
  ever creates a new event, never reads, edits, or sends.
- Kosher is never inferred from "vegetarian" — only Zerta (Barcelona) is
  tagged kosher-certified; unqualified "Jewish" interest is treated as
  heritage-site interest, not a dietary assumption.
- Official KT itineraries are the anchor; personal recommendations are always
  explicitly flagged as separate, never blended in unmarked.

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
