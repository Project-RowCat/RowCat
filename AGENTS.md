# AGENTS.md

Read this before starting work in RowCat. The **rationale** for most rules lives in code comments and
`docs/` — what stays here is the index into those, plus the boundaries you would otherwise violate
without noticing. Open the path next to an entry and you'll find the why.

## Repository

A UGC platform that hosts a story gallery and conversation generation. There is exactly one public API
(`/v2`). The hosted service has shut down; this repository is the code a fork deploys under its own name
(`docs/oss/FORKING.md`).

pnpm workspaces (`apps/*` + `packages/*`), TypeScript strict, Biome. The package manager is
the `packageManager` field in the root `package.json` (`pnpm@10.34.5`) — do not install with npm or yarn.

## Map

| Location | What |
| --- | --- |
| `apps/api` | Hono + Better Auth + Drizzle (Postgres). Public API `/v2` |
| `apps/web` | TanStack Start (SSR) + React 19 + Router/Query + Tailwind 4 |
| `apps/admin` | Operations console (SPA). Vite + TanStack Router/Query. **No SSR** |
| `apps/mobile` | Expo (SDK 57) native client. SQLite · SecureStore · Better Auth native session |
| `apps/mobile/AGENTS.md` | **That app's boundaries.** Loaded alongside this file when you touch that folder — the root keeps only what binds other packages too |
| `packages/contracts` | Wire contracts (zod). Only the **shapes** that cross the wire |
| `packages/domain` | Product model and pure rules. The vocabulary screens and server share |
| `packages/sdk` | API client. Transport (base URL, paths, credentials, cancellation, error mapping) |
| `packages/query` | TanStack Query keys, `queryOptions`, post-write cache policy |
| `packages/chat` | Product rules for conversation (pure). Memory, persona, conversation port, ownership |
| `packages/prompt-packs` | The narration pack bodies' lazy loader. **The public release ships no bodies** — the table is empty and `PROMPT_PACKS_AVAILABLE` is false. `dependencies` is empty — it knows only a string key |
| `packages/markdown` | Markdown rules for conversation bodies (pure). Parser config, URL policy, safe folding, node vocabulary |
| `packages/authoring` | Product rules for creation (pure). Draft model, validation, publication assembly |
| `packages/sync` | The pure half of the sync protocol. Envelope crypto, keyring, HLC, engine, ports, controller |
| `packages/design` | Design tokens (`tokens.ts` → generated `tokens.css` and `tokens.native.ts`) |
| `packages/ui-web` | Shared web components (Base UI + Tailwind) |
| `packages/ui-native` | Shared mobile components (React Native + `@rn-primitives`). Shares **no render code** with `ui-web` |
| `apps/api/src/lib/media` | Image validation, normalization, storage port. Avatars and covers **share it** |
| `apps/api/src/lib/remote-image` | Trust boundary of the runtime remote-image proxy (address decision, pinned connection, redirect re-decision) |
| `apps/api/src/lib/rate-limit` | Distributed rate limiting. Feature code sees only `checkRateLimit` (counts) and `reserveRateLimit` (amounts) |
| `apps/api/src/config` | The pure layer of environment config. Schema, resolution, inventory, drift check, diagnostics |
| `apps/api/src/jobs` | Infrastructure for one periodic job. A job is only a caller of a service |
| `apps/api/src/services/mobile-updates` | The self-hosted OTA server: Expo Updates protocol, selection, rollout, release state. **Selects signed bytes; never signs, never streams assets** |
| `apps/mobile/scripts/ota` | The OTA release tool (`pnpm mobile:update`) — export, content-addressed upload, **signing**, registration. The only code that touches a signing key |
| `apps/web/src/features/conversation` | The web generation lifecycle (React). Pure rules belong to `@rowcat/chat` |

**The creator runtime** spans packages and apps; the layers are these.

| Location | What |
| --- | --- |
| `packages/runtime` | **The public language contract.** JSX runtime, primitives, hooks, durable state. `dependencies` is empty |
| `packages/runtime-compiler` | Source → diagnostics and **artifact**. **It does not execute** |
| `packages/runtime-host` | Trusted host that runs artifacts in an **isolated WASM JavaScript VM**. The engine sits behind `vm/quickjs.ts` alone |
| `packages/runtime-persistence` | Product domain of player saves. Two records, deterministic identity, save port, coordinator |
| `packages/runtime-renderer-web` | Applies patch bundles imperatively to a shadow DOM |
| `packages/runtime-renderer-native` | Applies the same bundles to a host tree store that RN materializes |
| `apps/web/src/features/runtime-studio` | Authoring surface (Monaco). Execution lives outside this folder |
| `apps/web/src/features/runtime-templates` | Starter template gallery. Card art is our own trusted markup and **runs no creator code** |
| `apps/web/src/features/runtime-preview` | Studio preview — worker, generation number, state machine, console buffer |
| `apps/web/src/features/runtime-player` | Web playback surface. **A different worker from preview** (it has no compiler) |
| `apps/mobile/src/features/runtime-player` | Native playback surface — hidden execution WebView, RN renderer, SQLite saves |
| `apps/mobile/src/lib/runtime-native` | Native transport and session (bridge, generation number, state machine, latency measurement) |
| `apps/mobile/modules/rowcat-runtime-webview` | The native half of that bridge plus the **runtime assets** (harness HTML, QuickJS WASM) |
| `apps/web/src/features/docs` | Public docs screens (`/docs/runtime/*`). Pulls in neither compiler nor VM |
| `packages/runtime-ai-docs` | The **AI-readable corpus** — public docs + an API reference extracted from `@rowcat/runtime`'s own source. Generated and committed |
| `packages/runtime-mcp` | The MCP tool layer — meaning, validation, limits, preview sessions. **Pure core**, no transport |
| `apps/mcp` | The npm package `@rowcat/mcp`, whose `bin` is **`rowcat-mcp`** — the stdio MCP server and the **headless RowCat device** that reaches the creator's E2EE drafts. Package name and command name are different values and documentation keeps them apart |
| `apps/mcp/README.md` ↔ `DEVELOPMENT.md` | **The first one ships.** `files` is `dist` · `README.md` · `LICENSE`, so the README is read on npm by people who do not have this repository — workspace commands, workflow names and release procedure belong to `DEVELOPMENT.md`, which is not packed |
| `apps/web/src/features/conversation/conversation-viewport.tsx` | The **neutral geometry** shared by conversation rooms and runtime playback |

`docs/` is the canonical source of rationale. Section headers point here.

| Document | What |
| --- | --- |
| `docs/creator-runtime/` | Every runtime decision record — `patch-protocol` · `web-renderer` · `native-vm-host` · `vm-poc` · `story-state` · `persistence` · `input-generation` · `publication` · `player` · `remote-assets` · `managed-assets` · `managed-audio` · `scroll-and-focus` · `motion` · `templates` · `ai-authoring` · `public-beta` |
| `docs/public/runtime` | **The public docs creators read.** A different audience from the folder above; do not copy that content here |
| `docs/sync/ARCHITECTURE.md` | Encrypted sync · pairing · draft conflict recovery |
| `docs/chat/` | `MEMORY.md` (memory, auto-maintenance) · `PERSONA.md` (user personas) · `NARRATION.md` (the narration pack port) · `CHARACTERS.md` (characters added to a room) · `USER-NOTE.md` (the user's own instruction for a conversation) · `INTENSITY.md` (expression intensity — inside what the rating allows) · `REPLY-SUGGESTION.md` (what I might say next) · `TOOLS.md` (tool calling) · `PROMPT-PROTECTION.md` (guards off the wire; protected works assembled by the server) |
| `docs/design/` | Design system boundaries · `FAILURE-FEEDBACK.md` · `VISUAL-PARITY.md` |
| `docs/motion/ARCHITECTURE.md` | The motion language and the two apps' intended differences |
| `docs/settings/ARCHITECTURE.md` | Settings, preferences, prompt caching |
| `docs/moderation/` · `docs/profile/` · `docs/membership/` | Reports, enforcement, appeals / public profiles, relations / age, guardian consent |
| `docs/notifications/` · `docs/updates/` · `docs/jobs/` | The two notification planes / update notes / background jobs |
| `docs/ops/` | `RATE-LIMITING.md` · `CONFIGURATION.md` |
| `docs/ota/` | Self-hosted mobile OTA — `ARCHITECTURE.md` (trust model, runtime generation, rollout, rollback) · `OPERATIONS.md` (publish, canary, pause, rollback, new runtime, key rotation) |

## Layer rules

This is the part most often violated. Each package's `src/index.ts` header comment says the same thing
at greater length.

| Package | May depend on | Must not enter |
| --- | --- | --- |
| `contracts` | zod | How the server **builds** that envelope (Hono exceptions and such) |
| `domain` | nothing | Transport conventions. Unspecified is `null`, not `""` |
| `sdk` | `contracts`, `domain` | `apps/api` types (no Hono RPC coupling), `import.meta.env`, `process.env` |
| `query` | `domain`, `sdk` | Navigation, URL resolution, DOM, toasts — all the app's job |
| `chat` | `contracts`, zod | React, fetch, Dexie/IndexedDB, DOM, Node APIs, `@rowcat/sync` |
| `prompt-packs` | **nothing** | Product vocabulary (scope/density/cast), model capability, `contracts`, zod, React, fetch, DOM. It receives one opaque string key |
| `markdown` | `contracts`, unified/remark, mdast types | React/RN, HTML strings, sanitizers, fetch, DOM, `chat` |
| `authoring` | `contracts`, `domain`, zod | React, fetch, Dexie/IndexedDB, DOM, `chat`, `@rowcat/sync`, story-id issuance |
| `sync` | `contracts`, `@noble/*`, fflate | React, fetch, Dexie/IndexedDB, SQLite, DOM, Node APIs, `chat`, `authoring`, `sdk` |
| `runtime` | **nothing** | React, DOM, Node, Monaco, authoring stores, network — `dependencies` is empty |
| `runtime-compiler` | `runtime`, TypeScript | `authoring`, `chat`, `sdk`, `query`, UI, React, Dexie, DOM. Node only in `environment/node.ts` |
| `runtime-host` | `runtime` (declarations and the **generated sandbox**), `runtime-compiler` (contracts and paths only); quickjs-emscripten **only in `vm/quickjs.ts`** | React, RN, Monaco, authoring stores, Dexie, SQLite, SDK, generation, UI, Node APIs, the TypeScript compiler (**it does not compile**), `requestAnimationFrame`, `requestIdleCallback`, `postTask`, `setImmediate` (yielding is injected as a clock port) |
| `runtime-persistence` | `contracts` (`Rev`), `runtime-host` (**only the `story-state` and `persistent-state` subpaths** — pulling the root drags the QuickJS engine into the save layer), zod | React, RN, Dexie, SQLite, `fetch`, SDK, query, `@rowcat/sync`, authoring, chat, compiler, renderers, DOM, generation |
| `runtime-renderer-web` | `runtime` (color decision), `runtime-host` (**only the `patches` subpath**) | React, React DOM, Monaco, authoring, Dexie, query, SDK, router, studio UI, Node, network, `innerHTML`, generic `setAttribute(name, value)` assignment |
| `runtime-renderer-native` | `runtime` (color decision), `runtime-host` (**only the `patches` subpath**), React and React Native (peer) | `apps/mobile`, authoring, compiler, the web renderer, `ui-native`, `ui-web`, SDK, query, Dexie, SQLite, Node, network, JSX prop spreading |
| `runtime-ai-docs` | `runtime` (declarations), TypeScript **only in `source/api.ts`**, `node:fs` **only under `source/`** | `apps/*`, the compiler, the VM, React, DOM, network. Writing product prose in code — every sentence comes from the markdown |
| `runtime-mcp` | `authoring`, `runtime-compiler`, `runtime-host`, `runtime-ai-docs`, zod; QuickJS and `node:*` **only in `node/host.ts`** | `apps/*`, `sdk`, `query`, `sync`, DB drivers, shells, `fetch`, `eval`. A second compiler, a second VM, a second authoring store |
| `apps/mcp` | `runtime-mcp`, `authoring`, `sdk`, `sync`, `contracts`, the MCP SDK | `apps/web`, `apps/api`, DB drivers, shells. Writing files anywhere but its own config; anything on **stdout** (that stream is JSON-RPC) |
| `ui-web` | `design` | Feature code, API calls, `ui-native` |
| `ui-native` | `design`, `@rn-primitives/*`, `lucide-react-native` | Feature code, API calls, `ui-web`, DOM libraries, product vocabulary (`Story`, `Viewer`, …) |
| `apps/api` | `contracts`, `domain`, `chat`, `@rowcat/sync/server`, **one runtime path from `authoring`** (`@rowcat/authoring/runtime`), `runtime-compiler` (+ `@rowcat/runtime` declarations) | `apps/web`, any other path of `@rowcat/sync`, any other path of `authoring` |
| `apps/web` | all of the above | — |
| `apps/admin` | `contracts`, `domain`, `sdk`, `query`, `ui-web`, `design` | `apps/web` and `apps/api` types, Dexie and local storage, `chat`, `authoring`, `sync` |
| `apps/mobile` | all of the above except `ui-web`, plus `ui-native` | `@rowcat/ui-web`, `apps/web`, Dexie, DOM/`window`/`localStorage`, color literals |

Also:

- **The license split is a layer rule too.** `runtime` · `runtime-compiler` · `runtime-host` · `runtime-renderer-*` ·
  `runtime-persistence` · `runtime-ai-docs` · `contracts` are Apache-2.0; everything else is AGPL-3.0-only (`NOTICE`).
  An Apache package never takes an AGPL workspace package as a shipped dependency — `apps/api/src/license-split.test.ts`.
- Web feature code reaches the API through exactly one door: `getRowCatClient()` (`apps/web/src/lib/api.ts`).
  Putting ``fetch(`${API_BASE_URL}/...`)`` in a feature scatters path rules outside `contracts`.
- The path prefix (`/v2`) is decided by `contracts` and attached by `sdk`. Apps pick **only the origin** — and they
  must pick one: `@rowcat/sdk` has no default origin (`apiBaseUrl()` and `createRowCatClient()` throw without one).
  Web and admin fold to `DEVELOPMENT_API_ORIGIN` (localhost); mobile throws at startup when `EXPO_PUBLIC_API_ORIGIN`
  is empty. **No code defaults to an operator's domain** — `apps/api/src/config/operator-domain.test.ts` locks the
  original operator's domain out of the tree (forks change identity in the places `docs/oss/FORKING.md` lists).
- Server-authoritative decisions (visibility, adult, blocks, publication policy) are finished by the API.
  The web draws the result.
- **The source of truth for local data (conversations, drafts) is IndexedDB.** It does not go in TanStack
  Query — that is a cache for server state, and putting local records there creates a second truth.
  Subscriptions come from `dexie-react-hooks`'s `liveQuery`.
- One member, **one** local database. `lib/local-data/scope.tsx` owns its lifetime, and chat and authoring
  each see only their own slice through a narrow adapter. **Only sync sees the whole scope** — `applyPull`
  has to write every domain's store in one transaction, and a window narrowed to a single domain cannot
  express that atomicity.

## App shell

The web has three surfaces with non-overlapping responsibilities
(`apps/web/src/components/app-shell/`).

```text
sidebar = global destinations + resume recent conversation
header  = which resource am I in + global utilities (notifications, settings, account)
canvas  = the feature's content
```

- **There is no footer.** The one qualification a footer ever had was *does the law require it to be displayed at
  all times* (legal document links, business identity), and this repository ships no legal documents. A deployment
  that must display those adds a footer for exactly that and nothing else — sitemaps, social links, about pages,
  announcements, language pickers, app badges and newsletters do not pass that test.
- **The sidebar's contents are fixed**: brand, `발견`/`대화`/`만들기`, `최근 대화`, `모든 대화`.
  Notifications, settings, account, sign-out, theme, sync, AI providers, search, filters and recent drafts
  do not go in — there is no slot that accepts arbitrary widgets, and every global access point belongs to
  the header. The moment the left column becomes "leftover space", the canvas becomes one cell inside the
  sidebar.
- **The header's right side is three items and `ShellUtility` pins that vocabulary**: `알림`, `설정`,
  `계정`, in a fixed order regardless of route. There is one qualification: *does it call me no matter
  which screen I'm on*. Search, filters, sort and adult display belong to the discovery screen's own URL;
  share, favorite and report belong to that canvas. **Guests have none of the three** (only `테마` and
  `로그인`) — do not draw a disabled bell that sends you to login when pressed.
- **The sidebar is present at the same width on every app screen** (240px from `lg`). On narrow screens
  the **same contents** move into a left drawer opened by a header trigger. Do not build two navigation IAs.
- **Recent conversations are a switcher, with three lightweight room actions on top** (`이름 변경`,
  `대화 설정`, `대화 삭제`). Find, sort, preview, pin and archive belong to `/chats` — the moment they
  attach, the 240px column becomes a conversation list screen, and that screen already exists separately.
  The cap is `SIDEBAR_RECENT_CHAT_LIMIT` (10), and **the currently open room stays at the end even when it
  falls outside the window** (but a room that is not in the list is never invented). That cap and its
  exception belong to `recentSidebarRooms` in `@rowcat/chat`, and **mobile's navigation drawer calls the
  same function.**
- **There are no recent drafts. The asymmetry is intended.** Conversation is an activity you resume several
  times a day, so a resume shortcut earns its place; draft authoring is something you enter from your own
  workspace and stay in for a long time.
- **`만들기` is the only destination for creation.** `/create` is the workspace's home and holds four
  tabs (`초안`, `발행한 작품`, `분석`, `댓글`). All four are tabs **inside** the canvas — not children of the
  sidebar, not header utilities. Do not create a second route family such as `/creator-studio`. Which tab
  you are on **belongs to the address** (`?view=published`, `?view=analytics`; the default is omitted).
- **The sidebar's room list comes from the member's IndexedDB.** There is no server endpoint for room
  lists and we will not add one, and no copy lives in the query cache. When sync changes the local DB,
  `liveQuery` refreshes it — if the sidebar has to know about sync, the boundary was drawn wrong. Guests
  do not get the section at all.
- **The list and the workspace are two screens of the same section.** `/chats` and `/chat/$roomId` are both
  `section: "chat"`, and only the latter is locked to the viewport — section and screen character are
  different axes.
- **Notifications, settings and account are not a fourth section** (`section: null`). The fact of being
  here is stated by the header's right side (`utility`). Do not force the nearest section on. The bell's
  active state is also decided by `shell-route.ts` — if the header re-writes
  `pathname.startsWith("/notifications")`, the decision lives in two places.
- **Route → shell decisions live in `shell-route.ts` alone.** If the sidebar, header and drawer each
  write their own, one of them gets missed when a route is added, and that symptom is not visible.
- **Screens do not register their own title or actions on the header through an effect.** That structure
  brings a title one frame late, the previous screen's actions left over mid-navigation, StrictMode double
  registration, and SSR mismatch. Context is derived from the router match (`routes/(app)/route.tsx`).
- **The only screens where the header carries context are the local-first ones.** On screens whose canvas
  already has an h1 (discovery, lists, settings, account) that cell is empty — do not draw the same title
  twice.
- **There are three places that open room management and one set of actions**: the row menu in `/chats`,
  `대화 설정` in the header, and the recent-conversation row in the sidebar. All three go through
  `useRoomManagement`, so confirmation copy, validation, failure handling and account-switch rules cannot
  diverge (`features/chat/room-actions.ts` → `room-context-actions.tsx`). Do not build a second operation
  such as `sidebarRenameRoom()`.
- **Sidebar row actions target a room id, not a position in the list.** `liveQuery` re-sorting the list
  while the menu is open really happens, and if you point by position the action moves to the neighbouring
  room at that moment. The dialog that opens **re-subscribes to the store by that id** — if the room
  disappeared in between, the dialog closes quietly (it does not resurrect it).
- **Deleting a room from the sidebar navigates nowhere unless it was the active room.** Only for the active
  room do we leave **the same way the header does** (`/chats`, `replace`).
- **Do not put a button inside a row's link.** The overflow trigger is the link's **sibling** — a `<button>`
  inside an `<a>` is invalid markup, so the browser repairs the tree (hydration mismatch) and what you are
  pressing diverges between keyboard and screen reader (`features/chat/room-row-markup.test.ts`).
- **The overflow trigger is the path for people who cannot right-click.** On desktop it appears only on
  hover, focus and menu-open; on coarse pointers it is **always visible** (`pointer-coarse`).
- **The active resource's source of truth is the route parameter.** Do not keep shadow state such as
  `selectedRoomId`.
- Workspace routes key `remountDeps` on the resource id — that makes switching room or draft equivalent to
  leaving and re-entering the screen, so an in-flight generation and a pending autosave each get cleaned up
  against their original resource.

## Mobile

`apps/mobile`'s boundaries live in **`apps/mobile/AGENTS.md`** (loaded alongside this file when you touch
that folder), and the canonical screen rules are in `apps/mobile/README.md`. What stays here is **only
what binds other packages too.**

- **Web and mobile call the same pure functions — changing one changes both apps.** This is the kind of
  place you touch thinking you are fixing one screen, so it is written out:

  ```text
  @rowcat/chat     chatPlaceholderNames · resolveChatPlaceholders
                   recentSidebarRooms · roomLibraryView · ROOM_ACTIONS · ROOM_SETTINGS_IA
                   roomSettingsGroups · roomSettingsRowAvailable
                   sortCharacters · checkCharacterName · createCharacterRecord
                   resolveNarrationExecution · narrationInjection · narrationWritesUser
                   narrationOutputPolicy · stripCastTrackingLines
                   promptPackCapabilityFor · promptPackKey · splitChatTrackingBlocks
                   trimContinuationPrefill · CONTINUATION_FALLBACK_NUDGE
                   buildModelOptions · messageActionsFor · countLaterMessages
                   planMessageEdit · planRoomRename · planMemorySave · groupMemories
                   roomUserNote · applyRoomUserNote · checkChatUserNote
                   chatIntensityChoices · resolveChatIntensity · chatIntensityBlock
                   roomChatIntensity · applyRoomIntensity
                   messagesFromEnd · buildAiResponseEvidence · sceneTriggerKey
                   resolveEffectiveGeneration · resolveGenerationExecution
                   resolveUtilityTarget · finalizeWithSceneImage · parseChatContent
                   planChatGeneration · protectedStoryIdOf · deliveredChatSystem
                   canSuggestReply · selectReplySuggestionWindow · replySuggestionTurnKey
                   buildReplySuggestionRequest · parseReplySuggestions · runReplySuggestion
  @rowcat/domain   filtersForViewer · resolveProfileActions · profileContentBlocked
                   appliedGalleryFilters · sortTriggerLabel · periodApplies
                   adultVisibilityState · storyLifecycleActions
                   STORY_START_LABEL · storyStartGlyph · canDisconnectLoginMethod · resolveMembershipGate
                   isStoryDiscoverable · isStoryDirectlyViewable · isStoryShareable
                   isStoryVisibleOnCreatorProfile · storyVisibilityBadgeLabel
                   mergeConversationLibrary · activeConversationEntryId
                   isPinnableWork · pinnedWorkNotice · pinItem · unpinItem · movePinnedItem
  @rowcat/query    followMutationOptions · blockMutationOptions · accountQueryOptions
                   ownPinnedStoriesQueryOptions · pinnedStoriesMutationOptions
                   storyLifecycleMutationOptions · every account mutation policy
  @rowcat/authoring  prepareStoryPublication · buildStoryPublication · autosave-queue.ts
                   resolveConversationAuthoringMode
  @rowcat/runtime-persistence  runtimeConversationPresenceAllowed · runtimeConversationIdFor
  ```

- **Adding a value to shared vocabulary breaks compilation in both apps** — those tables are
  `Record<…, string>` on purpose (`MobileAppSection`, `RoomSort`, `RoomActionId`, `RoomSettingsRowId`,
  `MembershipGate`, `ChatMarkdownNodeType`, `StoryVisibility`, `StoryLifecycleAction`,
  `ChatIntensity`). A commit that adds
  a value is **a commit that fixes both apps.**
- **The store mobile owns is SQLite.** The sync protocol, envelope version and codec registry are the same
  ones the web uses — device preferences (`generation_preference`) and provider connections are **not** in
  that registry.
- **Adding a dependency that requires a native rebuild changes the release procedure.** The current list is
  `expo-image-picker`, **`expo-image-manipulator`** (the avatar crop surface — the only way to
  crop a picked image in RN; one file knows that module, `lib/image-crop.ts`, exactly as the picker has one),
  `expo-clipboard`, `expo-apple-authentication`, `expo-notifications`,
  **`expo-audio`** (the creator runtime's managed audio — the app owns the player and the renderer package sees only a
  port), **`expo-file-system`** (the draft cover a device holds until publication — the picker hands back a **cache**
  URI and the OS empties that place, while a draft lives for weeks, so choosing a cover copies the bytes into the
  document directory; one file knows that module, `lib/draft-cover-files.ts`, and the store receives it as a port
  because it would otherwise enter the test graph, which has no polyfills), the PortOne SDK, and the three
  `@rowcat/ui-native` brought along (`react-native-svg`,
  `react-native-reanimated` + `react-native-worklets`, `expo-blur`), and **`react-native-pulsar`** (haptics —
  **iOS only**: excluded from Android autolinking, and one file knows it, `lib/haptics/`, loaded lazily so a binary
  built before it does not crash at launch; it never calls `Settings`, because `enableSound(false)` deactivates the
  shared audio session the runtime's `expo-audio` plays on). **`expo-notifications` brings this
  app's first runtime permission — and the app never asks for it itself**: the system prompt appears only
  when the user turns it on under `푸시 알림` in settings. Fonts (five Pretendard weights) are registered by
  `expo-font` **at runtime** and therefore require no rebuild. **`expo-updates`** (self-hosted OTA — see
  `## Mobile OTA updates`) is the newest: it changes no JS, adds no permission, and is configured entirely in
  `app.config.ts`.

## Mobile OTA updates — self-hosted, signed, runtime-gated

**`expo-updates` is the client; the protocol server, manifests, assets, rollout and release tooling are ours**
(`docs/ota/ARCHITECTURE.md`, procedures in `docs/ota/OPERATIONS.md`). Not EAS Update hosting, and not a custom
updater.

```text
release env   apps/mobile/scripts/ota   export → sha256-addressed upload → manifest → SIGN → bundle file
                                       → apps/api CLI (a process, not a route) registers it
API           GET /v2/mobile/updates/manifest   selects; returns the signed bytes verbatim; no session
CDN           mobile-updates/assets/sha256/<hex>   immutable — the app downloads assets directly
```

- **OTA is remote code execution by design, so signing is the trust model.** The private key lives only in the
  release environment (`scripts/ota/signing.ts` is the one reader); the binary embeds the certificate
  (`apps/mobile/certs/<keyId>.pem`); **API, Postgres, CDN and object storage hold no signing authority** — a
  compromise of any of them cannot produce new executable code. Static tests pin both sides (no signing code in
  `services/mobile-updates/`, no private key anywhere under `apps/mobile`).
- **One key per channel** (`rowcat-<preview|testflight|production>-<n>`). With one key, whoever controls the DB
  could serve a preview bundle (which may target any API) to a TestFlight binary — the exact accident
  `build-profile.ts` exists to prevent. The request's channel header is routing, not authority.
- **A channel without a committed certificate fails its EAS build** — there is no unsigned OTA and no silent
  off. `ROWCAT_OTA=off` is the explicit opt-out.
- **Native compatibility is `RUNTIME_VERSION` in `app.config.ts` (`rowcat-native-N`), not the app version.**
  `native-runtime.lock.json` records each generation's `@expo/fingerprint`; `pnpm check` and every publish fail
  when the current fingerprint differs from the recorded one. Generations are append-only — never reuse one.
  ⚠️ **The creator runtime's harness HTML and QuickJS WASM are native assets** (`modules/rowcat-runtime-webview/
  assets/runtime/`), so a `runtime-host` change bumps the generation and needs a new binary.
- **There is no default API origin, and the committed `eas.json` holds RFC 2606 placeholders.** Every EAS build must
  name its API origin. Placeholders (`example.com` family, `.example`, `.invalid`) stop the build, and `testflight`
  stops when its origin equals the production profile's committed origin (`src/lib/build-profile.ts` ↔
  `app.config.ts`). EAS `owner`/`projectId` are empty in the public repo; a fork fills them after `eas init`, and a
  build runner stops while they are empty.
- **The binary's environment and the bundle's must agree.** The publisher takes `EXPO_PUBLIC_*` from that
  channel's `eas.json` profile, stops if the shell disagrees, re-runs `checkEasBuildEnvironment`, and the API
  only registers a bundle whose API origin is **its own** `API_ORIGIN`.
- **Rollout is deterministic**: `sha256(releaseId ‖ EAS-Client-ID) mod 10000 < pct×100`. The id is the
  install-scoped random UUID `expo-updates` already sends — survives sign-out and account switch, changes on
  reinstall, **never stored**. Percentages only grow; production registers as **draft** unless a number is given.
- **No state moves an install that already has a release.** Clients only accept a *newer* signed response, so
  `rollback` = mark `rolled_back` (no key needed) **then** re-sign the previous good release with a new
  timestamp (or a signed `rollBackToEmbedded`). Do not claim "reactivate the old release" restores anyone.
- **The app's JS does not touch updates**: no `expo-updates` import, no `reloadAsync()`, no manifest fetch
  (`src/lib/updates-boundaries.test.ts`). `checkAutomatically: ON_LOAD` + `fallbackToCacheTimeout: 0` means a
  downloaded update runs on the **next cold start** — never mid-generation, mid-playback.
- **Three "updates", never merged**: an OTA release, an **update note** (repository-authored, ships *inside* the
  JS bundle; the publisher only checks it exists), and **`app_update`** (the native floor rose). OTA publishing
  never sends `app_update`.
- **The admin console expresses intent; CI produces code** (`/mobile-updates`, `docs/ota/ARCHITECTURE.md`
  §운영 제어면). Read, rollout, pause and resume go through the **same** `transitionRelease` the CLI uses (operator id
  from the session on the event row + one `admin_audit_log` row pointing at it, same transaction). `새 OTA 릴리스` and
  `되돌리기` only record a `mobile_update_job` and **dispatch** `.github/workflows/mobile-ota.yml`, which runs the
  existing `pnpm mobile:update publish|rollback` with the channel's environment secrets — there is no second
  publisher. **That workflow is not in this repository** (it was bound to the hosted service's accounts);
  `docs/ota/example-workflows.md` holds it as an example a fork copies to exactly that path on `main` — the file name
  and branch are constants the dispatch and the OIDC `workflow_ref` check bind to. A deployment without it leaves
  `OTA_CI_*` empty, and the console then reads, rolls out, pauses and resumes while publishing and rollback go through
  the CLI. The API holds an Actions-write token, never a signing key; CI reports back with a GitHub OIDC token
  bound to this workflow at `main`, the channel's environment and the run id, and result release ids are re-checked
  against the registration table. Capabilities `read`/`operate`/`publish` map to roles in one domain table
  (`MOBILE_UPDATE_CAPABILITY_ROLES`). Production publishes register as **draft**; widening is a separate rollout.
  Rollback requests never mark `rolled_back` first — the tool does, in CI. Do not add a browser form that uploads JS,
  edits a manifest, picks an asset URL, or states a runtime version or API origin; the CLI stays the incident path.

## The presentation capability boundary — no generic `Sheet` in feature code

**This stands as a capability rather than a rule.** The generic `Sheet` is an internal implementation
detail of `@rowcat/ui-native`. Feature code cannot import it, render it, re-export it, or re-wrap and
export it — the root does not export that name and the package opens no subpaths (`exports` is a single
`"."`). Reverting either one breaks compilation first.

There are exactly **two** published sheet capabilities, and their APIs *are* the policy.

```text
ChoiceSheet        title · open · value · options · onValueChange · onOpenChange
                   no children — there is no way to hold anything but a short single choice
NavigationDrawer   title · triggerLabel · open · onOpenChange · children
                   takes children but **geometry is not an argument** — position, height, motion and width are fixed
```

The test is not whether it takes `children` but **what this API can express**. With a generic `Sheet` the
call site decides where, how large and what to hold; `NavigationDrawer` expresses exactly one thing —
standing at the left edge at full viewport height. The moment any of `placement`, `size` or `snapPoints`
opens up, it is a generic container under another name, and `public-api.test.ts` blocks those three by name.

```text
action group bound to a trigger        DropdownMenu
value choice bound to a trigger        Select
one-field form · read-only detail      Dialog
irreversible confirmation              AlertDialog
long form · small management screen    Dialog size="full" · dedicated screen
window that docks to the bottom on narrow screens   Dialog placement="adaptive"
short single choice                    ChoiceSheet
global navigation                      NavigationDrawer
result is a long list you jump back from   a surface that replaces the canvas
```

- **Docking to the bottom is not what makes something a sheet.** Position is an axis of `Dialog`
  (`placement`); it is a sheet only when you can answer "does rising from the bottom itself earn its place
  in this interaction". Room settings docking to the bottom on narrow screens is still a `Dialog`.
- **Do not build an allowlist** (`apps/mobile` had `SHEET_SURFACES` for a while). With a list present, the
  fastest answer for someone who built room settings as a sheet is **to add one more name**, and that line
  looks like an ordinary diff in review.
- **Do not build a second generic container such as `ActionSheet`.** The moment it takes `children` or
  `items: ReactNode[]` it is a `Sheet` under another name. When a new interaction genuinely needs a bottom
  sheet, the answer is still **a narrow API that expresses only that interaction.**
- **Renaming narrows nothing** — `ChoiceSheet` must be a function defined in its own file.
- **The presentation boundary tests and `ui-native`'s public API boundary are architectural guards.** Do not
  edit them to make a feature pass; when a request collides with them, **leave the guard and report the
  conflict** (the correct fix is to make `RoomSettings` a `Dialog`, not to add `RoomSettings` to a list).

```text
packages/ui-native/src/public-api.test.ts   root does not export Sheet · exports has no wildcard
packages/ui-native/src/boundaries.test.ts   only choice-sheet imports the sheet
apps/mobile/src/lib/presentation-policy.test.ts  absence of Sheet in feature code · container per surface (both directions)
                                            tsconfig paths has no @rowcat/ui-native/*
```

The last line matters: with that one line in `paths`, TypeScript **skips `exports`** and resolves straight
to source, which makes the package's closed subpaths meaningless for this app alone — and that line looks
exactly like its neighbours, so it is invisible in review.

## Legacy remnants — **when may they be deleted**

The local migration from legacy RowCat (`lib/local-legacy/`) and the retired-address adoption
(`local-data/adopt.ts`) were deleted when the service shut down — the open-source release has no legacy origin to
inherit. Their Dexie tables were dropped in v24 and **the older version declarations stay** (`lib/local-data/db.ts`).

Two remnants remain, both **carrying user data** and both **observable** — a server query answers whether the
condition is met:

```text
empty legacy fields in the publication contract   play.playGuide · play.persona · play.characters
legacy avatar fallback                            member.avatar_url
```

```sql
select count(*) from member where avatar_url is not null and avatar_url <> '';
select count(*) from story
  where play_payload ? 'playGuide' or play_payload ? 'persona' or play_payload ? 'characters';
```

- **Empty fields** — the condition is that zero rows actually carry those keys. If it is not zero, this is not
  something to wait for but something **to do** (a backfill rewriting the payload without those keys).
- **⚠︎ Zero in the development database proves nothing** — the question is about rows accumulated in the
  deployment you run.
- **A deletion commit cannot be undone.** Whichever remnant you delete, **the value showing the condition was met**
  must be in the commit message (a query result).

## Encrypted sync

The full rules are in `docs/sync/ARCHITECTURE.md` and the individual file headers.

- **`@rowcat/sync` holds the entire protocol**: envelope crypto (AES-256-GCM), keyring and recovery codes,
  HLC, the codec registry, the engine (pull, push, bootstrap), ports, and the state machine. It imports
  none of React, Dexie, SQLite, DOM, fetch, `chat`, `authoring` or `sdk` — Expo has to use that package
  **without changing a character.**
- **The server does not decrypt.** `services/sync/index.ts` treats ciphertext as an opaque string, and the only
  thing the server pulls in is `@rowcat/sync/server` (proof-of-possession verification plus envelope syntax
  validation). Any other path appearing in **server runtime code** has crossed the boundary — and
  `routes/me/sync.test.ts` is not an exception (that test **plays the device side**, not the server).
- **The owner comes only from the session.** There is no `owner` or `viewerId` anywhere in the request, and
  the contract schema has no slot for it.
- **Pull application and cursor advance are one transaction.** Split, a state where only the cursor commits
  becomes representable, and that page's records never arrive (legacy's worst defect).
- **Do not use a Postgres `SEQUENCE` for the cursor.** `nextval()` issues outside the transaction, so a
  transaction that started later commits first and a lower seq appears afterwards. Lock the member's
  `sync_state` row `FOR UPDATE`.
- **Domain codecs belong to the domain but do not import `@rowcat/sync`.** They export plain objects, and
  conformance is checked by structural typing at the app's assembly point
  (`apps/web/src/lib/local-sync/registry.ts`).
- **That is why there are four copies of `compareRev` (`sync`, `chat`, `authoring`, `runtime-persistence`),
  and a test guards their equivalence.** A promise in a comment cannot stop only one of them being fixed, and
  that divergence is not a compile error but **two devices arriving at different winners.**
  `local-sync/codec-order.test.ts` runs every domain codec's merge against `@rowcat/sync`'s comparison in the
  same matrix (it sits at the assembly point because that is the only place all four packages can be imported
  together). **One copy per package** — inside a package the codecs share one module (`rev-order.ts`), because
  a second copy inside the same package is covered by no test. All four fold `NaN`, negatives and fractions once — the contract enforces
  non-negative integers, but **locally stored rows never pass that validation**, and an unfolded comparison
  is not a total order.
- **A merged revision must be at least `max(local.rev, remote.rev)`.** If local wins but goes out wearing an
  old revision, the peer reads it as a replay, ignores it and re-uploads its own — the two devices overwrite
  each other forever.
- **Plaintext, DEKs, recovery codes, ciphertext, `authKey` and proofs never go in logs** (a static scan
  enforces it).
- **Account deletion wipes this namespace whole** — ciphertext is user data too.
- **The crypto format is pinned by golden vectors** (`packages/sync/src/__fixtures__/vectors.json`).
  Changing the envelope, AAD, compression codec bytes or key derivation breaks that test first — it is a
  change that makes already-uploaded ciphertext unopenable, so that is correct.

### Automatic sync

**A layer that adds scheduling only.** If you need a new record type, a payload change, an envelope version
bump or a server endpoint, you are not working on automatic sync but on something else.

- **Scheduling lives in `@rowcat/sync/auto-sync.ts` (pure); signals live in the app**
  (`lib/local-sync/auto-sync.ts`). Do not put `visibilitychange`, `focus` or `online` in the shared package
  — Expo builds the same signals from `AppState` and `NetInfo`, and two copies of the state machine will
  diverge eventually.
- **Do not build periodic polling.** There is no `setInterval` and no safety net — a quiet app making no
  requests is V1's promise, and reducing latency for remote changes is the SSE wake-up's job.
- **Local change signals are emitted from the write path, not built from `liveQuery`** — that reacts to
  changes sync itself applied, giving an infinite pull → write → signal → pull loop. The wrapping happens at
  one assembly point, and **read-only methods are enumerated while everything else is treated as a
  write** (so a missed new method fails safe). **Signals carry no content** (`notify()` takes no arguments).
- **One run per member.** The manual button goes through the same gate (`autoSync.runManualSync()`).
  Web Locks reduce duplication across tabs, but that is **waste prevention, not correctness.**
- **The runtime is owned by one root** (`lib/local-sync/provider.tsx`). The context carries **only the
  instance** — carrying phase re-renders the whole app on every background sync.
- **Creation in render; start and stop in an effect.** Stopping something created in render from an effect's
  cleanup lets StrictMode's double mount permanently stop a live instance. A stopped coordinator is never
  reused.
- **The automatic-sync toggle is a device preference** (`syncState.autoSyncEnabled`, on by default). It is
  not synced and does not live in `localStorage` (on a shared browser Alice's choice becomes Bob's default).
  Turning it off turns off **the schedule**, not sync — it does not lock, does not erase keys, and does not
  block the manual button.
- **No toast on automatic failure.** One status line says what is being waited on. Manual button failures
  surface immediately as before.
- **Failures that retrying will not fix block rather than back off** (401, 403, crypto, bad payload).
  Backoff stands only for transient failures and only after the **whole** run failed (the engine already
  tried four times).

### SSE wake-up

**A notification plane, not a data plane.** All it does is tell open devices "your namespace may have moved
forward" so automatic sync wakes **early**; replication is still done solely by `/v2/me/sync/records`.

- **One cursor rides the SSE** (`SyncWakeEvent { cursor }`). Not record ids, types, ciphertext, room/story/
  draft/message ids, HLC, device identifiers or conflict flags. When you want to add a second field, first
  write down why that value belongs on the notification plane.
- **Notifications go out only after commit** (announcing inside means a rolled-back cursor is already out and
  the receiving device pulls a state that does not exist). **A failed notification does not roll back the
  push** — wake-up is an optimization and correctness already belongs to startup, foreground, reconnect and
  manual sync. **One frame per commit** (conflicts, empty pushes and idempotent retries do not advance state,
  so they are not announced).
- **Subscription comes before the durable read** (`services/sync/wake.ts`) — reversed, commits in between
  vanish with nobody listening. Overlapping so the same cursor goes out twice is harmless.
- **No event log on the server** — a missed notification is covered by the reconnect's initial frame carrying
  the durable cursor, which is more accurate than `Last-Event-ID` replay.
- **The broker spreads only within the process.** Once there is more than one replica the fix is in `publish`
  alone, and until then the symptom is **latency, not errors.** Do not add Redis preemptively because it is
  in the stack.
- **The bridge from wake-up to run is one line**: `autoSync.requestSync("remote-wake")`. Calling
  `controller.syncNow()` from wake-up code creates a second path with no single-run gate, no backoff and no
  account isolation.
- **SSE does not advance the local cursor** (a received cursor is a hint). When unsure, **wake up** — one
  wasted pull is cheaper than a missed change. **The heartbeat is not polling** (a `: ping` comment every 20
  seconds that the client parser discards).
- **The session is asked again at every heartbeat, and a stream lives at most 30 minutes** (`stillSignedIn`,
  `SYNC_WAKE_MAX_LIFETIME_MS`). Checked only at open, a stream outlived a password reset, a revoke or account deletion,
  and whoever held the old cookie kept learning when the owner was active. A failed check keeps the stream (this plane is
  an optimization); the lifetime is what makes the client re-authenticate regardless, and it reconnects on its own.
- **All four connection conditions must hold**: this scope is mine + the controller is trusted (holds keys) +
  automatic sync is on + online. **Look at `trusted`, not `state`** — putting `syncing` in the condition
  disconnects and reconnects on every sync.
- **Reconnect is bounded backoff** (1, 2, 5, 10, 30 seconds, ±25% jitter) and **stops** on 401 and 403. Only
  a connection that outlived the heartbeat interval counts as "healthy" and resets the counter.
- **Connection state and sync state are different axes** — a dropped SSE is not a sync failure, so it does
  not touch `lastError` and there is no toast or indicator. No separate toggle either. **One stream per
  tab** (do not build Web Lock leader election).

### Local recovery of draft conflicts

**Merging has not changed by a character.** HLC still picks the canonical winner; what is new is only that
the device holds onto the value that convergence **discarded** so the user can write it back
(`docs/sync/ARCHITECTURE.md` §19.5, `packages/authoring/src/recovery.ts`).

- **Diagnostics are not the recovery store.** `MergeContext.note` carries only a classification and counts
  (it reaches logs and telemetry); `MergeContext.recover` carries **the disappearing user value** no further
  than this device's store. Merging them turns a diagnostic event into a plaintext carrier.
  **`@rowcat/sync` does not know the shape of the payload** (once words like `prompt`, `title` or `adult`
  enter, the protocol knows the authoring model).
- **A copy is not a sync record** — it is in neither the codec registry nor `TABLE_ORDER`, and that row has
  **not one sync column** (syncing copies makes them **a second conflict domain**).
- **The copy commits in the same local transaction as the merge result** (the one dangerous state is: the
  canonical value overwritten and no losing copy). The codec only **names** candidates; `applyPull` does the
  writing.
- **The recovery copy is narrower than the diagnostic.** "The group revision diverged" is true even for
  merges that lost nothing (A edited only the title, B only the prompt), and leaving a copy there gives the
  user a notice about **an edit they never lost** — restoring it loses the newer value instead. So we also
  check whether the loser's group revision is still present in the winner's `fieldRev` (evidence of a common
  ancestor).
- **Only one group's value is stored** (a whole-draft snapshot makes restoring roll back other groups'
  legitimate newest values). The value's type is `StoryDraftPatch`, so there is **no slot in the type** for
  `publishedStoryId`. The field↔group table is still one thing.
- **Restoring is not resurrecting an old revision** — directly rolling back `rev`, `fieldRev`, `dirty`,
  `serverVersion` and `updatedAt` sends that record out wearing a lower clock than the server knows and the
  peer ignores it as a replay. The one path is `restoreDraftConflict`, and inside it is one `updateDraft`.
- **Only a successful restore clears the copy** (if the draft is gone the copy **stays** — it must still be
  readable). **There is no retention period** (inventing a delete-after-N-days rule makes this feature
  delete the manuscript it exists to protect).
- **The notice does not block editing** (no forced modal, no automatic restore — one line in the editor and
  one `확인` button; the copy uses the same vocabulary in both apps, `DRAFT_RECOVERY_COPY`).
  **There is no backfill** (past conflicts left no material to restore).

### Device pairing

**A path that hands keys to a new device without re-entering the recovery code.** The only secret moved is
the DEK currently in use (`docs/sync/ARCHITECTURE.md` §13, `packages/sync/src/pairing.ts`).

- **The server is an authenticated relay that expires** — it holds only
  `(owner, codeHash, newPub, payload, expiresAt)` and **does not parse** `payload` (which is why the approve
  request does not take a separate `ephemeralPublicKey`: once the server knows the envelope's structure it
  eventually becomes the subject of validation and transformation).
- **The server never receives the code itself** (only the hex of `codeHash`). The code is both the HKDF salt
  and the AAD, so **once the plaintext lands in a log, DB or proxy the channel binding is gone entirely.**
  Even the hash rides in the **body**, not the path.
- **Channel binding is this protocol's lock** — even if the server swaps `newPub`, it does not know the code
  and cannot derive K, so all it gains is **the ability to make pairing fail.** The code carries 80 bits of
  entropy, and normalization, validation and formatting belong to one pure function
  (`normalizePairingCode`).
- **Open, then verify, then remember.** An opened envelope says only "someone with the matching code and
  private key sealed this"; whether that key **opens this account's keyring** is decided by the existing
  proof-of-possession path (`verifyKeyring`). Remembering a wrong key leaves that device marked "trusted"
  while unable to open its own data forever, and **that state does not heal itself** — so all three live
  inside **one controller call.**
- **The pairing private key lives only in memory** (we do not persist material that can open the DEK for a
  five-minute convenience).
- **Close the relay after consuming it** (lookup consumes nothing and `DELETE` handles both cancellation and
  cleanup). **The first approval wins** (conditional `UPDATE payload IS NULL`; a late approval gets 409) —
  overwriting diverges the envelope the new device already took from the server's. **An expired session is
  the same as a nonexistent one** (both 404).
- **Polling is permitted only here** (about every 2 seconds while the screen is open). **Do not put pairing
  events on the SSE.** The bridge after success is one line: `autoSync.requestSync("unlocked")`.
- **Only a device holding keys can approve** (no DEK, no approval) — if a browser that merely signed in could
  approve, session theft would be data theft.
- **Do not build a device list on the server.** The moment you draw a list, `원격 해제` inevitably appears
  next to it, and **that button is a lie today** (undoing a device's knowledge of a DEK it already has is
  cryptographically impossible without DEK rotation plus full re-encryption).
- **Pairing does not change the keyring** — changing it silently detaches a third device that is offline
  right now, and nobody finds out until that device wakes up.
- **There is one path that erases the keyring, and it is a reset** — `DELETE /v2/me/sync/keyring`. It is the
  other face of first-writer-only: someone who briefly steals the session of an account that never enabled
  sync can register a keyring first, leaving the owner stuck at `locked`. That operation requires a
  **recent login** instead of proof of possession (`requireFreshSession`, 24 hours) and erases keyring,
  pairings and ciphertext in one transaction — the safeguard is that all you can gain is **the ability to
  delete ciphertext you cannot read.** The controller's `reset()` then rolls every local `serverVersion`
  back to 0 (`forgetServerVersions`) — without that, the next bootstrap's pushes are all rejected and the
  conflict is not resolvable by pulling.

## Personas

**The role the user plays in a conversation.** Full rules in `docs/chat/PERSONA.md` and the `persona.ts`
header in `@rowcat/chat`.

```text
① the story seed's counterpart   ChatSeedPersonaDto     the creator's suggestion. **immutable** (a playback snapshot)
② authoring suggestedPersona     (gone)                 folded into `prompt` in v2 — **do not revive**
③ the user persona               ChatPersona            an account asset. one row in the library
④ the room's copy                ChatPersonaSnapshot    **a value copied from ③**. that conversation's identity
```

- **Four things share a word and all four are different.** Folding ① and ③ into one record makes renaming a
  persona **an edit to the story snapshot of every conversation already started**, and reviving ② is not
  adding UI but **rolling the storage model back to v1**
  (`packages/authoring/src/persona-boundary.test.ts` pins that absence as a value).
- **The room does not point at the library — it copies the value** (`personaSnapshotOf`). With a `personaId`
  four things break at once: an old conversation using a deleted row loses its name, an edited row changes
  the speaker in conversations the user never touched, that room becomes half-empty on a device that arrives
  late, and the same turn in the same room varies with the library's current state. The fact that it cannot
  be traced back is **pinned in the type** — `ChatPersonaSnapshot` has no `id`.
- **`effectiveChatPersona` alone answers precedence**: room override → story suggestion →
  `CHAT_DEFAULT_USER_NAME`. Do not scatter `room.persona ?? room.seed.persona` across screens and runtime —
  the symptom of missing one place is **the model calling the counterpart by a different name than the
  screen does**, which is silent. **A `null` override means "use the story default", not "no role"**, and
  the parent value is never copied down and stored.
- **There is exactly one representation of "no override" — the key's absence** (`applyRoomPersona`). With
  two shapes living in the store, the difference shows up only as **"applying the same page twice gives
  different results".**
- **`{{user}}`, the speaker on user turns, the counterpart block in the system prompt, and the opening all
  read the same value.** **The prompt order has not changed by a character** (the counterpart block sits
  after characters, before play guidance, and before the safety tail guard).
- **Stored speakers are never rewritten** — changing the role leaves the speaker on turns already exchanged.
- **If the role changes mid-generation, that response never reaches its final save.** The decision axis is
  the conversation's execution identity (`ConversationSession.token`), and the web's local room builds it
  from `store instance + effective role`. **An abort signal cannot prevent this.**
- **The library is not a child of the room** — there is no `roomId` and the room tombstone's cascade does not
  sweep this table (it is not that we "choose not to" cascade; it **cannot**). It is, however, inside
  `applyPull`'s transaction. **There is no plaintext on the server** (no column in PostgreSQL holds a name
  or description, and we will not add one).
- **The operation is narrow.** It is `setRoomPersona(roomId, value | null)`, and we do not build
  `updateRoom(id, Partial<ChatRoom>)` — with that, call sites can touch `seed`, `adult`, `createdAt` and
  sync metadata. **Taking a value and not the library's id** is the point of that signature.
- **The dialog shown before starting a conversation does not create the room.** The chosen value is pinned in
  **the same transaction** as the room (an argument to `createRoom`) — applying it afterwards puts the story's
  default role on the first frame where the opening is drawn, and anyone who sends a first turn in that gap
  starts a conversation where the model received a different name than the screen showed. **If the library is
  empty the dialog does not open — and not loaded is not empty.** On the web a press before the library
  subscription answers reads the store once (`use-story-start.tsx`); read as `[]`, it skipped the picker for
  someone with roles to choose. Mobile still starts at once in that window, and its header says why.
- **The library is a settings category in both apps** (`/settings/personas`). Do not add a fourth sidebar
  destination. The web's old address (`/personas`) survives only as a screenless redirect. **The picker on the
  room settings surface stays** (what it decides is *which copy gets pinned to this conversation*).
- **There is no legacy persona import** — the legacy schema had no axis for deciding "is this row a reusable
  asset or a value for that one room" (and the legacy migration itself was removed at shutdown).
- **V1's vocabulary is two fields: name and description.** Avatar, gender, age, pronouns, favorites, folders,
  tags and NSFW flags are all axes that never reach the prompt, so putting them in the schema creates a form
  that does nothing.

## Conversation memory

Memory is **per room**. Full rules in `docs/chat/MEMORY.md`.

- **Memory is conversation content, not a device preference** — so unlike `generationPreferences` and
  `providerConnections` it carries every sync axis and appears in **both** the codec registry and
  `TABLE_ORDER`. **And the protocol still did not change** (a client that does not know this type ignores
  the record and advances the cursor — **adding a type does not break compatibility**).
- **`ChatStore` holds memory too** (the name is narrowed to `ChatMemoryStore`, but there is one
  implementation). Splitting the port makes it impossible to express the atomicity room deletion needs:
  messages and memories in **one transaction.**
- **A room has three children** (messages, memories, summary). The delete cascade walks all three on **both**
  the deleting side (`deleteRoom`) and the receiving side (`applyTombstone`) — miss one and the contents of an
  already-deleted room get re-uploaded.
- **Editing a memory does not bump the room's `updatedAt`** — touching one memory on an old room and having
  that conversation jump to the top of the list reads to the user as something they did not do.
- **Length is counted in code points and there is one predicate** (`checkMemoryContent`) — diverge and a
  memory written near the limit with emoji is rejected on the receiving device and never arrives.
- **Context assembly happens in one place: `buildChatGenerationRequest`.** The budget
  (`CHAT_MEMORY_CONTEXT_CHAR_BUDGET`) is the axis that keeps memory from starving history, and `pinned` is
  **priority, not absolute protection**. **Generation freezes memory the moment it starts.** The memory block
  sits after creator content and before the safety tail guard — that order is the substance of the prompt
  injection boundary.
- **Memories have a source, and that axis is the permission** (`source: "user" | "auto"`). Auto-maintenance
  only **reads** `"user"` memories, the direction opens one way (`promoteMemoryPatch`), and
  `mergeMemorySource` enforces that monotonicity structurally. **Do not guess the source from the content.**
  Memory is **not global.**

### Auto-maintenance — rolling summary and fact extraction

**Not a second memory product** (`docs/chat/MEMORY.md` §9–§15).

```text
response saved → maintain?.() → room gate → batch selection → utility call → parse and validate
  → re-check ownership → **one transactional commit** (summary + frontier + memories) → existing sync
```

- **All the rules live in `@rowcat/chat`** (`memory-maintenance.ts`, `maintenance-prompt.ts`,
  `maintenance-runner.ts`). What remains in the app is one piece of port wiring, and mobile's static scan
  enforces that — if an app re-writes `slice(0, 40)` or a constant, the same conversation gets summarized
  differently in the two apps.
- **The trigger lives on the conversation port** (`ConversationSession.maintain`). If screens called it,
  a screen that forgot would mean **summaries are never produced in that app at all**, and that absence
  raises no error. The playback session (story test) **does not have** that function.
- **`maintain` returns `void` and does not throw** — give it an awaitable value and someone eventually adds
  `await`, and that one word inserts a paid call between the assistant's response and the next input.
- **The frontier cannot pass the recent verbatim window** (`CHAT_MAINTENANCE_RECENT_KEEP` =
  `CHAT_HISTORY_LIMIT` = 40). That equality buys two things: the same event never rides in both verbatim and
  summary, and ordinary edits, regenerations and delete-from-here **do not cause a rewind.**
- **A rewind treats summary and memory differently** — a summary is prose and cannot be subtracted, so it is
  **discarded whole**; memories carry `originAt` so only those from the vanished span are deleted.
  **Human-written memories survive any rewrite.**
- **Only summary merges have a different rule — epoch first, then HLC** (`ChatSummary.epoch`). With a plain
  last-writer-wins, a late advance from a device that does not know about the rewind wins and **the summary
  of a deleted conversation comes back.**
- **A summary's identity is derived from the room id** (`summaryIdFor`). Random and both devices' summaries
  survive; the room id verbatim and the server's primary key `(owner, id)` makes it fight the room record
  for the same row.
- **The model only proposes operations; a pure function decides** (`planMemoryMaintenance`). If the response
  leaves the schema **nothing commits** (not even the frontier). **There is one commit**
  (`applyMemoryMaintenance`) — split, a room whose frontier advanced alone records that span as processed
  **while never processing it again.**
- **Do not lean on `AbortController`** — the decision reads state, not a signal (ownership before starting,
  ownership after the response, and the condition at commit time; all three).
- **Managed stays managed and BYO stays BYO** (`resolveUtilityTarget`, the same function conversation turns
  use). **Do not put story settings or safety guards on the maintenance request** (with them, the utility
  model starts acting). The rating axis is always all-ages.
- **No progress indicator, no failure copy, and no "extract memories now" button.** **There is no screen that
  draws the summary** (build one and you immediately have to answer "can I edit it").
- **No embeddings and no vector search** — duplicates are handled by a deterministic normalized comparison
  (`memoryDedupeKey`) and by the extraction request receiving the existing memory list. A wrong merge
  ("received the key" ≡ "gave the key") is far more expensive than leaving a duplicate.

### Conversation bodies — markdown and name substitution

```text
substitution   packages/chat        pure rules, so web and mobile call the same function
syntax·safety  packages/markdown    parser config · URL policy · safe folding · node vocabulary
render         apps/web             react-markdown + a component table
               apps/mobile          the same tree → native views
```

**Render code is not shared; everything before it is.** If the two apps each stand up a parser, the direction
of divergence is fixed — one turns on GFM, one folds `javascript:`, one strips raw HTML. None of those break
compilation.

- **What the substituted value replaces is the axis** — scenario, start scenes, play guidance, character cards,
  counterpart descriptions and lore (including keys) are substituted **as values**; a message is substituted
  **only on the way to the screen**, and memories are not substituted at all. Stored text never moves: search
  scans the stored body, copy takes the stored original, and message editing puts the stored value in the form.
- **⚠️ `{{char}}` had no source at all for v2 works, and that was the bug.** `chatPlaceholderNames` read only
  `seed.characters[0]`, and the publication assembler always ships `play.characters` empty — so for every v2
  work the name was `""`, the placeholder stayed literal by the "leave it when the name is unknown" rule, and
  scenario, lore and the narration pack body all reached the model wearing `{{char}}`. The model copied what it
  read, which is what "substitution does not work in the output" actually was. The second source is **the cast
  added to this room** (`chat.character`), in the same order the prompt's cast block uses — seed cards first,
  added characters next. A card whose name is only whitespace counts as absent.
- **⚠️ A message body is substituted when drawn — and that is a reversed decision.** For a while nothing
  substituted a message, on the grounds above. The price was that a response echoing `{{char}}` was drawn with
  that word visible, which reads as a malfunction. So substitution now stands on the **render path only**
  (`ChatBody` / `MessageBody`, before the tracking-block split and `[img:…]` so the rule is not written per
  piece) — exactly the seat `normalizeChatMarkdown` already occupies. Both apps carry a static scan pinning
  that the body renderer is the **only** caller, which is the structural form of "the stored original is
  untouched"; the names come down from the screen beside `sceneImages`, because a row has no room identity
  (a streaming response and a story test have no room at all).
- **Substitution happens once, in the assembler** (the first line of `buildChatGenerationRequest`).
  Substituting per block means missing that line when a block is added, and in that block alone `{{char}}`
  reaches the model as-is — compilation and tests pass, and it surfaces only in that story's conversations.
- **The opening is substituted inside `resolveOpeningScene`** (if the screen and the assembler each
  substitute, the symptom is not an error but **the model calling the counterpart by a different name than
  the screen**). Substitution is idempotent.
- **When the name is unknown, leave the placeholder** — blanking it silently removes the sentence's subject
  (`{{char}}가 웃는다` → `가 웃는다`). `{{user}}`'s default is **the same value** the assembler attaches to
  user turns (`CHAT_DEFAULT_USER_NAME`), and with several characters `{{char}}` is **the first card**.
- **The vocabulary is only two.** Do not add macros such as `{{time}}` or `{{random}}` — non-deterministic
  values break the prompt prefix on every request, and above all the assembler would come to know the clock
  and the RNG. Braces are matched by **counting** (lookbehind is avoided because this package also runs on
  Hermes).
- **Markdown uses a parser, and that config lives in one place** (`chatRemarkPlugins()` — CommonMark + GFM +
  line breaks + safe folding). Do not write code that reads syntax with regexes; that failure is silent.
- **Raw HTML is neither executed nor stripped** — folding turns `<script>` and `<img onerror=…>` into
  **characters** (`safety.ts`). Stripping makes the author's text vanish from the screen entirely, and the
  user cannot tell whether it was syntax or we swallowed it. There is no `rehype-raw` and no
  `dangerouslySetInnerHTML`, and a static scan blocks all three together.
- **The folded tree's node kinds are a closed list** (`CHAT_MARKDOWN_NODE_TYPES`, eighteen). Mobile's
  renderer table is a `Record<…>` so growing the vocabulary **breaks compilation** there, and the web's
  coverage test breaks.
- **We render images — and that is a reversed decision.** For a while only alt text remained, on privacy
  grounds. Now we render but narrowed the conditions under which a request goes out: schemes are `http` and
  `https` only (no `data:` — the same syntax carries SVG documents), SVG is rejected, no referrer is sent, and
  there is no request at all until it enters the viewport. What fails to load **folds to alt text.**
- **A bare URL pointing at an image is promoted to an image too** (the decision is made by an extension list
  derived from the contract's accepted input formats, `image-url.ts`). **An explicit `![]()` does not go
  through that decision** (content-addressed CDNs normally have no extension).
- **An image always stands on its own line — folding guarantees it** (`liftImageLines`). Every renderable
  image moves out of its paragraph, and the text lines around it **become paragraphs again with their
  original line breaks intact.** The reason is that mobile's paragraph is a single `Text`, and a size-less
  `Image` inside it silently disappears. **The unit of decision being the line rather than the paragraph is
  the point** — with `remark-breaks` on, the two are different things, and roleplay manuscripts almost never
  use blank lines, so **almost every image in a start scene** is a single line wedged between text lines.
- **⚠️ An image inline in a sentence is lifted too — and that is a reversed decision.** For a while it stayed
  a link labelled `외부 이미지 열기`, on the grounds that splitting the line introduces a break the author
  never wrote. What that rule actually filtered out was not the author's line breaks but **the picture**: the
  shape a model writes is `*문이 열린다.* ![](밤.png)`, glued to the prose, so those responses drew that one
  Korean phrase and nothing else. One unwritten line break is a cheaper error than a vanished image. Only the
  line the image actually sat on changes; the space that sat between the image and the following prose is the
  image line's, so it is trimmed (left in, mobile's `Text` draws it before the paragraph's first letter).
- **The one thing that still does not get promoted is a bare URL mid-sentence** (`renderableImageNode`'s
  `lineOnly`) — the author never wrote image syntax there, so cutting that sentence in three is editing the
  text rather than presenting it.
- **An image that cannot be drawn folds to its alt text, and there is exactly one such answer** (`altOnly`).
  Three things reach it: a refused format (SVG), a dangerous destination, and a seat where no block can stand
  (a heading, a table cell, inside a link). **There is no "open the external image" link** — that affordance
  said nothing at the place it stood, and the answer for an undrawable image already existed in this
  repository: a picture that fails to load folds to alt text, and both renderers already do that. A link
  whose children all fold away wears **its own address** as the label (`linkLabel`) — an empty `<a>` is in
  the accessibility tree and nowhere on screen.
- **A named link stays a link even when its address is an image** (promotion requires the link's text to be
  the address verbatim).
- **The parser having recognized something is not grounds for trust** — links are `http`, `https` and
  `mailto` only, dangerous destinations have **only the link stripped** and remain as text, and relative paths
  are not accepted. Removing tabs and newlines before reading the scheme is part of that rule
  (`java\tscript:` is a script in the browser). Surviving links carry `nofollow noopener noreferrer`.
- **Task list checkboxes cannot be toggled** — what is stored is the original text and the box is a picture of
  it; the moment it looks like pressing changes something, it is a promise we cannot keep.
- **Unfinished syntax does not block rendering.** While streaming, the manuscript is almost always in the
  middle of some syntax, and that is **the normal state of every frame, not an exception.** Every prefix of
  the fixtures is run one character at a time.
- **Emphasis reads as a dimmed layer, and both apps use the same value** (`opacity-75` ↔ `opacity: 0.75`). In a
  conversation, asterisks mark what is **not speech** (action, description, aside) — that convention came from legacy,
  where the 행동 추가 button wrapped the line in one asterisk on each side and the result was dimmed text. Weight and slant alone do not carry it:
  **Korean has no true italic face**, so synthesized slant is nearly indistinguishable from body text, and weight alone
  reads as "emphasis" rather than a separate layer. The two markers stay distinguishable from each other (weight ↔
  slant) and standard meaning is not inverted.
- **The composer's 행동 표시 button inserts that marker — one asterisk on each side — and the rule is one pure
  function** (`applyChatEmphasisMarker`, `CHAT_EMPHASIS_MARKER`). It is **not** `**`: what separates the layer is the
  dimming, which both markers get, so the heavier one only makes the line that is not speech read stronger than the
  speech beside it — and pressing with nothing selected would leave `****` sitting in the field.
  **It is not a formatting toggle** — the name says what it does, and pressing again
  wrapping twice is cheaper than answering what a half-covered selection means. The rule exists because of one space:
  CommonMark emphasis does not hold with whitespace **inside** the markers, so wrapping a selection that carries a
  trailing space produces `*문을 연다 *` and **the asterisks stay on screen**. That failure raises nothing.
  **Both apps have the button and only the way the caret comes back diverges**: the web calls `setSelectionRange` on the
  DOM node, while native plants `selection` **once** and lets go on the next selection event — ⚠️ controlling that prop
  every render commits the syllable being composed, and that symptom appears only in Korean, Japanese and Chinese (the
  draft editor's full-screen field reached the same conclusion, `features/create/prompt-section.tsx`). Where the caret
  is right now is a **ref** in both apps: as state it re-renders the composer on every keystroke, and an inverted
  virtualized list sits above it.
- **⚠️ The parser takes the CJK flanking rules, and that decision was paid for once** (`remark-cjk-friendly`, the
  `parseOnly` subpath — this package parses and never serializes). Under plain CommonMark a closing marker preceded by
  punctuation and followed by a letter does not close, which is rare in English and constant in Korean: `**"그래"**라고`,
  `**그래!**하고` and `**(속으로)**하고` all rendered their asterisks literally, and that failure is silent. The price
  was that **every conversation already stored reads differently** — the stored text is untouched, but a sentence that
  showed bare asterisks yesterday is a dimmed layer today. What made it acceptable is that **the direction is one-way:
  emphasis is gained, never lost**, and `parse.test.ts` pins that asymmetry by value (everything that parsed before
  still parses; the three that did not now do). **GFM strikethrough is not covered** — `~~아니야!~~라고` still fails,
  that is a second package, and roleplay's convention is the asterisk. Do not work around either with a regex.
- **Both roles go through the same renderer** (user bubbles are markdown too — typing `*문을 연다*` is if
  anything more common on the user side, and splitting by role makes the same text render differently
  depending on who wrote it). The price is that surfaces and borders are built from `currentColor`.
- **Ownership of line-break preservation moved from CSS to the parser** (`remark-breaks`).
  `whitespace-pre-line` was right for the web, but **the moment a second platform exists that basis is gone.**
- **The gap between paragraphs is exactly one line of prose** (`PROSE_BLOCK_GAP`) — that is why turning
  markdown on does not change the shape of conversations already accumulated, and why height estimation counts
  a blank line in the source as one line (`chat-geometry.test.ts` compares the two).
- **The estimator does not parse markdown** (it would parse every line twice on every scroll — the real height
  arrives from `ResizeObserver` the moment it enters the viewport).
- **The streaming caret is not a sibling — the two platforms solve it differently.** The web uses `::after` on
  the last block; mobile uses **a node appended to the end** of the last block. As a sibling, the caret drops
  to the next line, so a blank line sits there for the whole response and vanishes on commit, making the
  conversation jump. Only in blocks with nowhere to attach (code, tables, images) does it stand on its own line.
- **Mobile lost its merged accessibility name — intentionally** (markdown has many blocks, and headings, lists
  and links carry their own roles; folding them into one name erases every role). **All of the performance is
  `memo`** (the only thing re-parsed is the one streaming line).
- **The stored original is untouched.** Normalization (`normalizeChatMarkdown`) stands **on the render path
  only** and does not flow into copy, search or the edit form. There is no migration.

### Scene images — showing a scene as a picture

```text
draft child record   authoring.sceneImage   { trigger, assetId } — synced
    ▼  prepareStoryPublication (duplicate triggers keep the first; empty entries drop)
publication payload  play.sceneImages       the server verifies ownership
    ▼
playback snapshot → room   seed.sceneImages   a self-contained copy as of acquisition
    ▼  finalizeWithSceneImage — one [img:trigger] line at the end of the response
screen               parseChatContent       text pieces and image pieces
```

- **Bytes never enter the contract** — what is carried is **one reference** (`assetId`). Legacy put a data URL
  here, which made a single room several MB (the same image duplicated once per room, and base64 wrapped in
  base64 again inside the sync envelope, inflating ~1.8×).
- **One rule builds URLs, in the SDK** (`client.media.url`) — this reference **lives on devices for months**,
  so freezing an absolute URL into the snapshot breaks the images in every already-created room the day a
  deployment moves the origin. A static scan blocks copies of it.
- **`CHAT_SEED_VERSION` did not go up** — one `.default([])` is the whole of the compatibility story (bumping
  it makes old devices reject the new seed wholesale, so that story's conversations will not open because of
  one image). The draft side is the opposite: **a new record type** (`authoring.sceneImage`) — as an array on
  the draft root, a device that does not know that key drops it on decode and **the next push erases the
  images.**
- **Attachment happens once, right before the final save, and the function is shared**
  (`finalizeWithSceneImage`). The order is the rule — attach during streaming and the token appears then
  disappears; attach after saving and the stored original diverges from the rendered text.
- **If a token is already present, leave it alone — without asking whether it is valid.** With several
  triggers matching it is **the one that appears first** (list order for ties), and the image attached is
  always **one.**
- **The prompt was not touched.** Do not build a block that tells the model the trigger list — it puts the
  determinism promise of context assembly at stake, and it pushes words the creator chose into the model's
  own sentences.
- **The token is not markdown.** Split the body into pieces first (`parseChatContent`) and hand only the text
  pieces to the markdown renderer — run it through the parser and `[img:night]` reads as a link reference. The
  splitting rule is shared and **only the drawing code is per platform.** While streaming, incomplete tokens
  are hidden (a tail that cannot become a token stays visible).
- **An image that cannot be drawn disappears quietly** (unknown trigger, deleted asset and load failure all
  give the same result). Do not draw the token text instead, and do not use the trigger as alt text — that
  word is **a matching name, not a description**, and a screen reader would read an internal identifier.
- **The server decides asset ownership** (`findUnusableSceneImages` — three things pinned in the predicate:
  `id ∈ …`, `owner`, `kind`). Without `kind` **you can publish an avatar id as a scene image.** A missing asset
  and someone else's asset are rejected with the same code, and we do not publish with just that entry
  dropped (the creator leaves believing they published a story with images).
- **Removing it from the draft does not delete the image on the server** — an already-published snapshot may
  point at it, and a room built from that snapshot **may be open on someone else's device right now.** So
  `/v2/me/scene-images` has exactly one verb (`POST`), with no list endpoint either.
- **Images upload the moment they are chosen** (the point where this diverges from covers, which the browser
  holds until publication) — the trigger has to point at that reference for the draft to be self-contained,
  and **that draft syncs to other devices.**
- **Duplicate triggers are not blocked at save; they are reported** (blocking makes the common edit of swapping
  two entries' names impossible). Instead the screen states which one wins, and normalization produces **the
  same result as playback time.**

### Characters added to a room

**A fourth room child.** Adding a character to a conversation in play. Full rules in
`docs/chat/CHARACTERS.md`.

- **⚠️ `seed.characters` cannot be edited** — the playback snapshot is an immutable field
  (`ROOM_IMMUTABLE`), first-writer-wins, and divergence leaves a diagnostic. So the work's own
  characters cannot be changed, hidden, or removed, and the screen does **not** mix them into the
  list (a row you cannot delete standing among rows you can gives the user no way to read the
  difference) — it states **how many** there are, once. Seed characters are always empty for v2
  works, so in the open-source release that line does not appear (it existed for rooms migrated from legacy
  RowCat, a path removed at shutdown).
- **A child record, not an array on the room.** Without per-item identity, editing/deleting/merging
  all become whole-room overwrites and two devices each adding a character lose one. It is not a
  memory either: memory is a *fact* and a character is a *participant* — memory sits after creator
  content and gets truncated by the char budget, and **a silently truncated character means the
  model answers without knowing that person.**
- **Two fields: name and one free prompt.** Reviving legacy's five (appearance/personality/speech/
  example lines) is the same mistake v2 fixed by folding the draft body into one field. **A
  character with no description is a complete value** — the name alone is a line on the cast list.
- **One 등장인물 block, seed cards first.** Splitting them makes "who is in this story" have two
  answers, and for v2 works one half is always empty. **No provenance tag in the prompt** — "added
  in this conversation" gives the model a reason to treat that character as second-class, and that
  shows up as quality, not as an error.
- **Ordering is creation time, and the store owns it** (`sortCharacters`, no `localeCompare` —
  locale-dependent ordering makes the same room assemble differently per device). The screen and the
  assembler read the same order.
- **⚠️ The room now has four children.** The delete cascade walks messages, memories, characters and
  the summary on **both** sides (`deleteRoom` and `applyTombstone`) — fixing only one shows up only
  after a two-device round trip.
- `chat.character` was added to the codec list and `TABLE_ORDER` **at the end** — the parent is the
  first entry so the parent-before-child constraint holds anywhere, and inserting in the middle
  shifts later types under an in-progress collection cursor. `CHAT_SYNC_SCHEMA_VERSION` stays 1
  (a kind was added, not a version). Merge is plain HLC last-writer-wins and **fields are not
  merged** — a character whose name came from A and description from B is one nobody made.
- **Do not build a global character library, avatars, relations, tags, or a path back into the
  draft.** The last one would make the playback snapshot mutable again.

### Narration packs — who writes this conversation

**A long narration instruction placed in front of the system prompt**, ported from legacy RowCat
(고슴도치 8.0 / 따봉도치 4.1 / 딥싴도치 1.0). Full rules in `docs/chat/NARRATION.md`.

```text
vocabulary  packages/chat/narration.ts     scope · density · cast, key assembly, execution
bodies      packages/prompt-packs          lazily loaded per key. **原저작물, unmodified** — **none in the public release**
capability  GenerationModelDto.promptPack  **the server catalogue answers**
storage     ChatRoom.narration             this conversation's value · E2EE synced
injection   buildChatGenerationRequest     after the roleplay rules, before creator content
```

- **⚠️ The public release ships no bodies, and the axis stands anyway** (`docs/chat/NARRATION.md` §공개본).
  The license RowCat held was granted for its own features; a right to redistribute the twenty-four was
  never established, so they are not in this repository at any commit. The vocabulary, output policy,
  tracking split, stored and synced `ChatRoom.narration` and the catalogue's capability all remain.
  **Whether the row stands is a derived fact, not a switch** — `PROMPT_PACKS_AVAILABLE` (the loader table
  has any key) goes into `roomSettingsRowAvailable` / `roomSettingsGroups` in `@rowcat/chat`, and both apps
  read that one predicate. A model taking a pack and this build having one to give are two facts; drawing the
  row on the first alone offers a setting that changes nothing. Do not null the catalogue to hide it (the
  screen would then say "this model takes no pack", which is untrue), and do not add `NARRATION_ENABLED`
  (it can be on in a build with no bodies). A build that restores bodies restores **all** of them or none
  (`prompt-pack-parity.test.ts`), and rewrites the attribution to the grant it actually holds.
- **The three axes have different characters and only the first is a user judgement.** Scope is
  *how much of my character the AI writes* — four values that are **one ordered dial**, not a list of
  unrelated options, and `NARRATION_SCOPES`'s array order is that dial. Density is a cost tradeoff the
  **model** may or may not offer; cast tracking is a **visible** difference (a second panel).
- **The pack aliases never flow through this repository.** `hedge`·`thumbs`·`deepseek` are the names of
  the body files and of the original work. The contract carries `standard`/`reduced`, the room record
  carries product vocabulary only, and the screens carry neither — the alias appears in **one table**
  (`narration.ts`). Carrying it would make renaming a body file break already-deployed clients.
- **Capability authority is the server** (`promptPack`, beside `reasoning`). Legacy decided this in the
  browser with `model.includes("haiku")`; with twenty-six models that leaves **settings you can choose
  that do nothing**. ⚠️ `DEFAULT_MANAGED_MODEL` must be a model that takes a pack, or the feature is
  invisible to everyone in the default state (a test pins it).
- **⚠️ If the pack does not stand, the protections do not come down.** `assisted`·`auto` remove the
  roleplay rules' first clause and the persona block's last line — but reading the **stored setting** to
  do that produces, on a model that takes no pack, a prompt with neither the protection nor anything to
  replace it. The assembler receives `{ text, writesUser }` as **one value** (`narrationInjection`), so
  that combination is not representable.
- **Consent never comes down.** The original second clause mixed *do not extrapolate* with *do not
  assume consent*; removing it whole would leave autoplay + adult mode with **no sentence stopping the
  AI from writing the user's sexual consent**. The clause is split (`ROLEPLAY_CONSENT`), which is why
  ⚠️ `ROLEPLAY_RULES` is **not byte-identical** to before this slice.
- **The value belongs to the conversation, so it syncs** — unlike model, response length and reasoning
  effort (device preferences). An autoplay story that comes back as an ordinary conversation on another
  device is not a setting that failed to follow; it is **a different story**. Record rules are the
  persona's, unchanged: optional field, absence is the only representation of "off"
  (`applyRoomNarration`), `CHAT_SYNC_SCHEMA_VERSION` stays 1, later-writer-wins.
- **Density folds, the stored value stays** (there is no layer above it to inherit from, so there is
  nothing to delete — coming back to a capable model restores what was chosen).
- **All 24 packs append a `<details>` tracking block to every response**, and the twelve `sim` packs add
  a second one — that is what the cast axis actually is. This repository's markdown **folds raw HTML to
  characters**, so both are split out before the renderer (`splitChatTrackingBlocks`), exactly as
  `[img:trigger]` is. The split vocabulary is closed to the pack's two names, the content is passed
  **verbatim** (no table parsing — the format is the pack's), and the stored original is untouched.
- **⚠️ Splitting a block out and drawing it are different questions, and only one of the two is drawn**
  (`CHAT_VISIBLE_TRACKING_BLOCK_KINDS` — `cast` alone; both apps read that one rule rather than filtering
  by kind themselves). Splitting keeps the body readable, so it covers everything the pack appends;
  drawing puts something in front of a reader, and that needs an axis. `인물 카드` has one — the user
  turns it on knowing it lengthens the prompt and the response — so that panel stands only for
  whoever chose it. **`진행 기록` (`logic`) has none**: all 24 packs append it, there is no setting that
  turns it off, and for a while every person who picked a narration pack received a panel nobody opted
  into on every single response. This repository already answered the same question the same way for the
  rolling summary (**there is no screen that draws it** — build one and you immediately have to answer
  "can I edit it"), and the specific cost here is concrete: that block carries the pack's own safety
  adjudication (`[Err] Violation: High risk of self-harm …`), read by the person that line is about.
  Reviving it starts with the **axis**, not the value — what it turns on, whether it belongs to the room
  or the device, what it promises whoever turns it on; adding a name to that list is what happens
  *after* that decision.
- **The bodies live in their own package because of weight.** In `@rowcat/chat` they would reach
  everything that imports it — **including `apps/api`**, which never reads them. The assembler is
  synchronous, so the call boundary fills the body with `ensurePromptPack()` first and passes the string
  in, the way summary and memory go in.
- **Do not build a global default, a pack editor, or a user-facing lineage picker.** The first has no
  second layer to inherit from, the second would make this repository hold a fork of someone else's work,
  and the third is a model fact.
- **⚠️ The pack bodies do not go out unchanged — an output policy stands after them**
  (`narration-output.ts`, applied in `narrationInjection`). The bodies are the original work and this
  repository does not edit a byte of them, but two things they say cannot stand:

  ```text
  ① a conversation with cast tracking OFF still gets a character table
     all twelve compact bodies instruct "relation databases" in prose, and the three auto ones
     name `Character Database` in their output order. Hiding it on screen is not enough —
     that table was **already generated and already spent output tokens**
  ② the tracking block eats the body's budget
     `NARRATIVE NAVIGATOR` is a dozen-line internal state table the packs demand at the **top of
     every response**. On `짧게` (768 tokens) that alone takes much of the cap, the response is cut
     before it reaches prose, and the continuation then draws the table again
  ```

  So the injection boundary does two things: with cast tracking off it **removes the lines** that
  instruct that table (`stripCastTrackingLines` — exactly three distinct lines across the twelve), and
  it appends our own policy after the body. **Later, more specific instructions win**, the original
  files stay byte-identical (a wholesale upstream swap still works), and what we narrowed lives in code
  and tests. The policy is four sentences: body first · tracking last and once · terse · **and when the
  budget runs short, drop the tracking and finish the body.** The last one is the point — without it a
  response still draws the whole table and gets cut in the prose, which reaches the user as an **empty
  bubble**. `sim` bodies are not narrowed by a character, and with tracking **on** the policy says
  nothing about that block (the pack already instructs it; saying it twice splits the instruction).
  **No token arithmetic** — the policy sets order and priority, not numbers.
- **⚠️ The narrowing can fail silently**, so it is pinned at the assembly point
  (`apps/web/src/test/prompt-pack-parity.test.ts`, which stands only in a build that carries bodies): the real twelve bodies go through the injection
  boundary and the vocabulary must not survive — and the same file pins that the **originals still
  carry it**, so the next person does not read that filter as dead code. `keys.test.ts` guards the
  parser's two block names for the same reason.
- **The prompt is not the only defence — the save decision measures the body, not the raw text**
  (`resolveGenerationOutcome` splits tracking blocks off first, `streaming: true` so an unclosed block
  cut by the cap also folds away). A response whose body is empty is **not saved** and the turn stays
  unanswered, so the screen offers `다시 생성` instead of drawing an empty bubble that claims to be an
  answer. The stored value is still the raw text — the split is used to decide, never to rewrite.
- **The attribution notice is not optional** (`NARRATION_CREDIT`, unfolded, on both apps' screens). It
  stands with the bodies — with none, the pane that draws it is unreachable.

### Expression intensity — how much the description shows

**A dial that sits inside what the rating already allows**, not a second rating. Full rules in
`docs/chat/INTENSITY.md` and the `intensity.ts` header in `@rowcat/chat`.

```text
rating      the server decides   entitlement + story rating   immutable per room (`ROOM_IMMUTABLE`)
intensity   the user chooses     this conversation's value    mutable · E2EE synced
```

- **Two values and an absence** (`softened` · 기본 · `intense`). The middle is the key's absence,
  the same representation every other override axis in this repository uses — there is no layer
  above to inherit from, so "reset" and "never chose" are the same fact.
- **⚠️ Intensity cannot exceed the rating, and none of the three defences leans on prompt
  wording.** The screen offers `강` only on adult-rated rooms (`chatIntensityChoices` takes the
  **story's** rating, not this turn's effective one — the value must survive a lapse in
  entitlement); the assembler stands that block only when the turn actually runs adult
  (`resolveChatIntensity`); and the server wraps the prompt in the rating guards **without knowing
  this axis exists.** That last line is why **the server, the contract and the API did not change
  by a character** — a forged `강` block in an all-ages request still arrives bracketed by
  `ALL_AGES_GUARD` and `ALL_AGES_TAIL`.
- **The block stands between the head and the tail — never folded into the tail.**
  `applyPlatformSafetyPolicy` passes an already-wrapped body through by checking that it
  **ends with the fixed tail** (`endsWith`); a tail that varies per room fails that comparison and
  **every normal request gets its tail attached twice**, invisibly. A test pins
  `applyPlatformSafetyPolicy(system, allAges) === system` for all three live combinations.
- **The wording declares itself as "the requested level"** because `ADULT_TAIL` already says *do
  not lower the **requested** level arbitrarily* — declared that way the two compose; written as
  "write softly" the tail overrides it by recency. **Do not delete the last paragraph of the
  softened block** (it pins the scope: the events still happen, only the exposure drops) — a
  scope-less downward instruction behaves like a long prohibition list and starts avoiding
  conflict, combat and death. The intense block's last line is the same axis (it states its own
  ceiling).
- **It stands after the user note.** A note that says "describe it in detail" in passing must not
  override a `순화` the person deliberately chose — the direction of error has to be the safe one.
- **⚠️ The assembler rebuilds the runtime room from the fields it reads**, so adding an axis to the
  record, the codec and the screen changes nothing until that one line is added too. The symptom
  is only **"the setting says it is on and the responses do not change."** The same trap exists in
  the test: with no block `indexOf` is -1, so an order-only assertion passes green on a block that
  is missing entirely — assert presence before position.
- **Do not build a global default, extra steps on the scale, separate sexual/violence axes, or a
  device preference.** The last one is the expensive one: a story read at `순화` coming back at
  full intensity on another device is not a setting that failed to follow, it is **the thing that
  person was avoiding, shown to them.**
- **Provider filters are a different layer, and the Gemini BYO adapter now sets them from the
  rating.** This axis is the prompt's; what a provider blocks by its own policy sits on top of it.
  That second layer used to be left at its defaults and silently swallowed what our own guards had
  allowed — see **Provider content filters** under `## Settings and preferences`.

### Reply suggestions — what I might say next

**A helper that drafts the user's own next line**, and hands it to the composer rather than to the
conversation. Full rules in `docs/chat/REPLY-SUGGESTION.md`.

```text
rules      packages/chat/reply-suggestion.ts          count · window · availability · turn identity
文面·관문  reply-suggestion-prompt.ts                 the request text and a strict schema
lifecycle  reply-suggestion-runner.ts                 ordering and ownership. **there is no commit**
transport  features/chat/utility-generation.ts        the same door auto-maintenance goes through
screen     features/chat/suggestion/                  the panel above the composer
```

- **Choosing does not send — that is this slice's first rule.** A picked sentence fills the composer and
  the person presses send. Sending on pick makes **a model-written sentence the user's own utterance
  before they read it**, and this repository already drew that line once (the narration pack's
  `assisted`/`auto` let the AI write the user's part, but only as **a setting that person chose**, and
  even then the consent clause never comes down — `ROLEPLAY_CONSENT`). It also keeps one press from
  becoming two generations.
- **Nothing is stored.** No record, no codec entry, no `TABLE_ORDER` slot, no server column — the result
  lives in the screen's state and is discarded when the turn moves. Storing it makes suggestions the
  room's fifth child, carrying every sync axis, and nothing ever reads that value again.
- **The contract did not grow by a character.** The request is the existing `ChatGenerationRequest`, and
  it rides the existing managed router and BYO adapters — no endpoint, no migration, no sync record.
  A managed suggestion therefore passes the **same** gates a turn does (the managed-generation allowlist and
  both rate-limit windows — `### Managed generation access` under `## Settings and preferences`) and counts
  against them like one.
- **The model is the utility target** (`resolveUtilityTarget`, the same function maintenance uses) —
  managed is the product default model, BYO is **the same model that room already uses** (what is cheap
  at that provider is not a fact we know, and an invented model name fails the request).
- **⚠️ The rating follows the room, and that is where it splits from maintenance.** Maintenance is always
  all-ages because its answer is **stored and re-sent on every request**. A suggestion has none of that:
  it is not stored, it disappears unless picked, and once picked it is **the user's own utterance** they
  can edit. Forcing all-ages instead makes the feature not work in exactly the conversations people are
  having. The decision goes through the conversation turn's own function (`resolveAllAges`) and the
  server re-decides with the viewer's entitlement (`resolvePlatformAllAges`).
- **The request carries two blocks and nothing else** — my role, and the recent window. Seed prompt, lore,
  memory, summary, characters and the narration pack are all absent: those make this call as expensive as
  a roleplay turn and make the model **start playing the story** instead of proposing my lines
  (`maintenance-prompt.ts` split from `context.ts` for the same reason). The window is **12**, far shorter
  than the turn's 40 — this request answers "what do I say to that" and nothing else. **The opening stands
  only when no message has been stored yet**, which is exactly the screen of someone who just pressed
  `대화 시작`.
- **Tracking blocks and `[img:trigger]` are stripped from the transcript** — a deliberate divergence from
  the maintenance prompt. This request's window and output are short, so three of those tables would be
  most of it while saying nothing about what to say next. The body/tracking split is this repository's
  existing notion of 「본문」 (`resolveGenerationOutcome` measures the same way).
- **The button does not stand while the composer has text**, and that one axis makes the whole collision
  unrepresentable — filling is always into an empty field, so there is no rule about overwriting a draft.
  What flows up from the composer is **one boolean, only when it flips** (`onEmptyChange`); the value stays
  in the composer and reaches the screen through an imperative `fill` handle, because lifting it would
  re-render the virtualized conversation on every keystroke.
- **It does not stand on a response whose tail is still open either** — the story is not finished and
  `이어서 생성` comes first. That rule also removes the collision with the other two layers above the
  composer, so this fourth layer never has to fight for that spot. Availability is one pure predicate both
  apps call (`canSuggestReply`), and **an open tail is two axes, not one** (`assistantTailOpen`) — reading
  `truncated` alone makes the suggestion and `이어서 생성` stand side by side on an interrupted response.
- **The suggestions belong to the turn** (`replySuggestionTurnKey`). Without it, sending one and getting a
  reply leaves **a turn-old proposal** standing when the composer empties again — a sentence that raises
  no error and looks plausible.
- **The failure is spoken, and that is the other split from maintenance.** This is a press, so it says what
  went wrong — through the app's **existing** failure table (no connection or not on the managed allowlist
  → AI settings, otherwise retry). The runner therefore carries the original error while maintenance's
  does not.
- **Do not build a global default, a count setting, an auto-suggest toggle, or a path that sends on pick.**
  Auto-suggesting spends a generation on every turn including for people who never use it — on managed that
  is the operator's key and the member's rate-limit window, on BYO it is the member's own key; a count
  setting asks the user to weigh cost with nothing on screen to weigh it against.

### Prompt protection — the manuscript stays on the server

**What a request body carries is what anyone with devtools reads.** Full rules in
`docs/chat/PROMPT-PROTECTION.md`.

```text
guards           applyPlatformSafetyPolicy only — server (managed) · router (BYO) · runtime port
protected seed   /play · /playback blank scenario · playGuide · character prompts · lore (projectProtectedSeed)
protected turn   POST /v2/chat/stories/:storyId/generate — device sends its share, server assembles
```

- **The assembler emits no guard blocks.** Absolute, rating, minor, house rules and tail are attached by
  `applyPlatformSafetyPolicy` alone; the minor decision rides as `context.minorCharacterPresent` (the
  assembler is where story content is read). **Bytes reaching the model did not change** —
  `guards.test.ts` pins new and legacy bodies to the same string, and legacy (pre-OTA) bodies are not
  wrapped twice. **Do not wrap managed requests on the device** (mobile used to; that put the full text back
  in the body). The inspector draws `platformPolicyBlocks` at both ends, so its blocks join to
  `deliveredChatSystem(request)`.
- **A protected story's room is assembled by the server from the currently published seed.** The contract has
  no `system` slot (`StoryChatGenerationRequest`, `.strict()`); the device sends only what it holds (history,
  memories, summary, persona/note/intensity, added characters, narration). Device and server sides are one
  mirrored pair in `protected-generation.ts` and a round-trip test proves they assemble the same request —
  **adding an assembler axis means fixing both functions.**
- **The decision is the session's** (`protectedStoryIdOf`: `promptProtected` **and** an origin story — rooms with no
  origin story and playtest stay device-assembled) **and the split is the router's** (`streamChatGenerationPlan`, both
  apps). Do not add `if (protected)` to the generation hook or turn.
- **Same gate, every turn.** The route goes through `requirePlayableStory` (now `routes/stories/playback-gate.ts`,
  shared with `/play` and `/playback`) — republishing reaches open rooms on the next turn, and losing entitlement
  stops them. **Protected rooms are no longer acquisition-time snapshots; that was a product decision.**
- **The server runs the lore tool loop for these rooms** with the same `runChatToolLoop`; the whole loop is one
  request to the managed gates — the allowlist and both rate-limit windows are checked once, at the start
  (`docs/chat/TOOLS.md` §3).
- **BYO is blocked on protected rooms** (`managed_only`) — there is no manuscript to send from the browser. So a
  member who is **not** on the managed-generation allowlist cannot converse in a protected room at all (the
  managed door answers `chat_managed_not_allowed` and there is no BYO door to fall back to); the screen sends them
  to AI settings like any other managed refusal, and that dead end is the price of keeping the manuscript on the
  server.
- **Copies already on devices are not recalled** — a playback snapshot a device fetched before the story turned
  protected keeps whatever it carried.

## Account security

**Login methods, passwords, sessions.** The rationale is in `apps/api/src/routes/me/account.ts` and the
`packages/contracts/src/account-security.ts` header.

**Which operation goes through which door is the whole of this slice.** The criterion is one question:
*has Better Auth already opened this operation over HTTP?*

```text
change password    POST /v2/auth/change-password        the Better Auth client, directly
sign out · delete  POST /v2/auth/sign-out · delete-user  same
link provider      POST /v2/auth/link-social            same (the OAuth round trip is the library's)
────────────────────────────────────────────────────────────────────────────────
set password       POST /v2/me/account/password          setPassword is **serverOnly**
unlink method      POST /v2/me/account/login-methods/…   unlinkAccount takes an account row id
list · revoke      GET·POST /v2/me/account/sessions*     listSessions returns session **tokens**
```

Wrapping the top group in our own routes creates a second implementation that imitates identity
verification, and above all **brings passwords into `@rowcat/contracts` and `@rowcat/sdk`.** The bottom
three each have a specific reason for failing that test, and **when that reason disappears the route
should too.**

**The library endpoints the bottom three replace are closed at the HTTP edge** (`auth/http-surface.ts`, refused in
`app.ts` before `auth.handler`): `/list-sessions` returns every session's token, `/list-accounts` and the passkey list
return raw rows, `/passkey/delete-passkey` skips the removal notice, and `/get-access-token` hands out provider OAuth
tokens. Closed there and not in `hooks.before`, because our wrappers call the same operations server-side. The Expo
plugin's `/expo-authorization-proxy` stays open — the app's browser sign-in needs it — but only toward the three
providers' authorization endpoints: as shipped it redirected to any `https` address and signed that address's `state`
into a cookie first (an open redirect from the API's domain, and a way to plant a state the attacker minted). A new
provider adds its endpoint to `EXPO_PROXY_TARGETS` or its app sign-in is refused.

- **`setPassword` is the only place a password crosses our contract, and that exception has a reason** —
  that endpoint is `createAuthEndpoint.serverOnly`, so it has no HTTP surface at all (passing the session
  header through to `auth.api.setPassword` is the path the library intends; not a workaround that builds a
  hash or writes to the `account` row). **Changing is still not in the contract.**
- **Do not tidy passwords.** There is no `.trim()`, `.normalize()` or `.toLowerCase()` in the contract, the
  SDK or the screen — change one character and the rules diverge between storing and verifying, and that
  account cannot sign in with the password it knows. There is **one** source for the length policy
  (`PASSWORD_LENGTH`).
- **Session tokens stop at the server.** `listSessions` hands back the session object, that object has a
  `token`, and `revokeSession` takes that **token**. Sending that shape down to the screen seats another
  device's session token in the query cache, devtools and the error reporter at once — one line undoing the
  reason session cookies are HttpOnly. `AccountSessionDto` carries **the row id** only, and resolving that id
  back to a token happens **only within this session's list** (rather than writing an ownership check
  separately, a request pointing at someone else's is not expressible in the predicate).
  **`account.id` does not cross the line either** (an unlink request points at one provider name).
- **The last login method cannot be unlinked, and that decision is three layers deep** — a pure function
  (`canDisconnectLoginMethod`) sets up the same rule on screen and server, and the library's own guard sits
  behind it. The screen's disabled button is none of those (what locks is **whether a direct API call is also
  rejected**). The reason it is not written as `methods.length > 1` is that **"number of methods" and "number
  of usable methods" are not the same value** (Better Auth can represent a credential row with no password).
  Our projection drops providers outside the contract vocabulary, so it errs **narrower** than the library's —
  and an error in that direction does not lock anyone out.
- **Linking is not signing in.** There is nowhere in the account screen to call `signInWithGoogle` or
  `signInWithApple`, and a static scan blocks it — those functions look for that identity's owner and
  **create a new account when there is none**, so calling them from the linking screen produces **a second
  RowCat member** with no stories and no local data. Linking goes through `/link-social` alone, and on
  success the Better Auth user is unchanged, so `member.id`, the local database scope and the sync namespace
  all stay put.
- **Link conflicts are not silently merged.** If that identity is attached to another account the library
  rejects it, and we neither merge accounts nor move resources (that path does not exist in this repository).
  Nor do we treat a matching email as the same person — not enabling `allowDifferentEmails` is where that
  assumption is blocked. The copy says only "it is linked to another account" and **does not say which one.**
- **The user does not decide where they come back to.** `callbackURL` and `errorCallbackURL` are built by us
  from this app's origin plus a **constant path**, and the call site has no argument to pass one (that
  argument is an open redirect). The `connected=google` on the returned URL is a **claim**, so we do not fix
  the list from it — we ask the server for account info again and strip the marker from the URL immediately.
- **Every gate here is `requireViewer`.** These operations are **locking your own account's doors**, and a
  suspended or blocked member needs that more, not less — a sanction that leaves you unable to change your
  password or cut off someone else's device is not a sanction but a dead end.
- **Do not turn off Better Auth's fresh-session requirement.** Session listing and method unlinking require
  `freshAge` (24 hours by default) while our session lifetime is 30 days, so **for anyone signed in for a
  while this is the normal path.** It is tempting to disable, but the same value guards identity verification
  for **account deletion**. Instead we draw that state not as an error but as **the next thing to do**
  (`recent_login_required`).
- **The current session is not revoked through this path** — that is signing out and has its own path. There
  is no button, and the server rejects it (`current_session_revoke`) — allowing it lets a user kill their own
  screen from the "clean up other devices" list, and that screen cannot tell them why they were signed out.
- **Session revocation is idempotent.** An already-revoked session, a nonexistent one and **someone else's**
  all get the same result: the current list. Distinguishing them turns that response into a detector for
  "that session exists".
- **Changing the password does not cut off other devices** (we do not pass `revokeOtherSessions`) — cutting
  them off silently reads to the user as something they did not do. That operation has its own button.
- **No optimistic updates, and no blanket invalidation of `["viewer"]`.** The lie briefly drawn here is "this
  device can no longer get in", and someone will believe it and walk away. Exactly two cells move:
  `["viewer","account"]` and `["viewer","account","sessions"]`. The latter sitting **beneath** the former is
  intentional (sign-out cleanup clears both by prefix match). Conversely, refetching only the account info
  needs `exact: true`.
- **A second concurrent set-password is not a 500.** A unique index conflict has no vocabulary in the library
  and becomes a raw 500, but what actually happened is "a password is already set", which already has a name.
  Do not decide by reading the driver's error code — **look at the current state again** (unknown failures are
  rethrown; folding them into a known reason means that failure never gets a name).
- **Trusted device lists and a security activity dashboard are still other slices**, and a static scan keeps that
  vocabulary off the screens. Password reset and two-factor authentication left that list — see
  `### Password reset` and `### Two-factor authentication` below.

### Authentication mail — email ownership and email change

The rationale is in `apps/api/src/services/mail/templates.tsx`, `lib/mail-config.ts` and `auth/index.ts`.

- **The existence of a delivery mechanism turns on email verification** (`emailVerificationRequired =
  mailEnabled`). We do not add a separate switch because one of the combinations is a disaster — a deployment
  that "requires it but cannot send" produces only accounts that can sign up and never sign in. Deriving it
  makes that state **unrepresentable.** That is why the tests for that axis run **in a separate process**
  (`vitest.mail.config.ts`, `*.verified.test.ts`). Do not weaken the invariant for convenience.
- **We do not build the verification token.** Better Auth's signed token and the `verification` table are used
  as-is — code that validates a link is guaranteed to get something wrong if hand-written (expiry, reuse,
  subject matching), and the wrong part is an account takeover path.
- **The user does not decide the callback URL.** The value the web passes is a **constant path**, and when the
  link is opened the library's `originCheck` compares it against `trustedOrigins` again (`disableOriginCheck:
  false` is stated explicitly, which is why that check runs in tests too). Since the link is delivered by mail,
  this hole is far more expensive than the login screen's `?redirect=`.
- **There are deployments where signing up does not grant a session.** When verification is required the
  library leaves `token` as `null` and creates no session — **both web and mobile** read that value and route
  to the verification notice. Navigating without reading it makes `/me` answer guest, and to the user it looks
  like "I signed up but was not signed in".
- **Do not bulk-verify existing unverified accounts.** `UPDATE user SET emailVerified = true` records a fact we
  never verified. The migration path is `sendOnSignIn: true` alone. **We also do not force sign-outs.**
- **Only the unverified-login failure states its reason.** It looks like an exception to the account
  enumeration rule but is not — the server gives that code **only after verifying the password**, so seeing the
  message requires already knowing that account's password. Folded the other way, that person keeps retyping a
  correct password.
- **Duplicate signup receives a response that looks like success** (the library's existence hiding). Reverse it
  and the signup form becomes a member directory lookup.
- **Changing an email requires both addresses to agree**: an **approval request** to the current address → an
  **ownership confirmation** to the new address → only then does `user.email` change. Step one going to the
  current address *is* this slice's security notice. **Do not enable `updateEmailWithoutVerification`** — the
  current address being unverified is not grounds to skip proving ownership of the new one; if anything, nobody
  has ever proven ownership of that account.
- **Email is not ownership.** Changing the address leaves the Better Auth user and `member.id` intact — if that
  fact wobbles, the local database scope and the sync namespace diverge, and the symptom is not an error but
  **conversations and drafts appearing to have vanished entirely.**
- **Conflicts are not silently merged.** If an account uses that address the library does nothing and returns
  success (existence hiding). The screen says only "we sent a mail".
- **The completion notice is deferred.** Sending "this changed" to the old address would be ideal, but there is
  no supported hook that knows the old address at that point, and building another token scheme of our own for
  one message is exactly what this slice avoids.
- **The copy is six typed events** (`TransactionalMail`), all account-security. There are three reasons not to expose a surface that takes arbitrary subjects and bodies:
  you can no longer grep which code sends which mail, a path appears where user input becomes HTML directly,
  and **a marketing sender grows on top of this infrastructure.** There is not one line of tracking pixel, click
  tracking or unsubscribe copy, and `mail.test.ts` still **counts** the vocabulary. `password-reset` entered with
  the screen that receives it, and that commit wrote its reason into the count — the bar for a seventh has not been
  lowered. (For a while there were two more: a pre-charge notice for the web subscription, which left with billing,
  and the terms revision notice, which left with the legal templates.)
- **The copy has two layers.** `emails/*.tsx` is the picture (React Email components, a default export and
  `PreviewProps`); `templates.tsx` is the product rule (event, subject, plaintext, which component renders it).
  The reason for the split is `react-email dev` — that preview server treats each file in the folder as **one
  mail**, so copy inside a single file's `switch` makes previewing impossible. Hence **the file count in
  `emails/` equals the event count.** Conversely, do not push the event vocabulary down into that folder.
  Preview is one command (`pnpm --filter @rowcat/api email:dev`, :3005), each file's `PreviewProps` is that
  screen's input, and it **must be obviously fake** (previews end up in screenshots and reviews as-is).
- **React Email renders the HTML and React does the escaping.** This file used to concatenate HTML strings by
  hand, and back then calling `escapeHtml` was **the rule** — display names, emails and passkey labels are
  user-controlled, so missing it once turns that mail into a markup injection surface. Now the path that breaks
  by forgetting is gone from the syntax, and the check that guarded it looks at **the rendered result** rather
  than at a helper. `dangerouslySetInnerHTML` has never appeared in this folder.
- **Plaintext is still written by hand.** There are two reasons not to use `render(el, { plainText: true })`:
  that converter writes links as `label [url]`, and the auth flow has a path that opens **the first link in the
  plaintext** verbatim, so the closing bracket sticks to the URL. Above all, plaintext is **the body received by
  clients that do not render HTML**, so the sentences have to stand on their own.
- **This folder is the one place JSX entered.** `apps/api`'s tsconfig gained `jsx: react-jsx` and `.tsx` joined
  `include` — **node's type stripping alone will not run these files.** It amounts to one exception to what
  `erasableSyntaxOnly` guarded, so adding `.tsx` files is done knowing that. The secret-logging scan also sweeps
  `emails/` in full.
- **`react-email` is a runtime dependency, and that is this change's price** — the package ships a CLI, so
  **esbuild, socket.io and tailwind come along into the deploy image** (tens of MB). If the image has to shrink,
  there is one place to fix it: demote it to a devDependency and switch the runtime imports to
  `@react-email/components` and `@react-email/render` (the copy code does not change by a character).
- **The two passkey notices contain no links.** Putting an action link in a security alert makes that mail a
  template for phishing — what the user should do is reach the account screen through the path they always use.
- **Code does not choose the vendor.** Transport is SMTP (`services/mail/smtp.ts` is the only file where a
  vendor appears), and choosing a provider SDK is an **operational decision** attached to contracts, pricing and
  domain authentication.
- **Dev transport writes the link to the server console, and production refuses to boot.** Do not build a route
  such as `GET /dev/latest-email` — a route like that stays wide open in a deployment where one setting is
  wrong. **Tokens, URLs and bodies never go in logs** (a static scan enforces it); only `services/mail/dev.ts`
  is excluded, and that is what marks it dev-only.

### Two-factor authentication

**An authenticator app plus ten backup codes, guarding the password door only.** Better Auth's `twoFactor` plugin,
unwrapped (`apps/api/src/auth/index.ts`, `auth/two-factor-policy.ts`, `db/tables/two-factor.ts`).

```text
POST /v2/auth/two-factor/enable                  password + recent login → secret + 10 backup codes (still OFF)
POST /v2/auth/two-factor/verify-totp             with a session: first code turns it ON · with the challenge cookie: sign-in
POST /v2/auth/two-factor/verify-backup-code      challenge cookie → session; each code works once
POST /v2/auth/two-factor/generate-backup-codes   password + recent login → 10 new, every old one dies
POST /v2/auth/two-factor/disable                 password + recent login
POST /v2/auth/two-factor/get-totp-uri            closed (404)
```

- **We do not write TOTP, backup codes or the challenge.** Secret generation, verification, encrypted storage
  (`BETTER_AUTH_SECRET`), the 10-minute challenge cookie and the failure lockout are the plugin's. What we own is the
  door policy (`enforceTwoFactorPolicy`, one `hooks.before`) and the screens.
- **It guards `/sign-in/email` and nothing else — and the copy says so.** Social sign-in and passkeys are not
  challenged: they are already a factor other than the password, and the threat this answers is a leaked password.
  The screens write "비밀번호로 로그인할 때", never "모든 로그인".
- **Only accounts with a password can turn it on** (`allowPasswordless` stays off). An account with no password has no
  door to guard, and a "켜져 있습니다" there would be a lie — the button is absent, not disabled.
- **Enable, disable and regenerate require recent login (24 h) on top of the password.** The plugin asks only for a
  session and the password; the password says *this person knows it*, recent login says *this session is not an old
  stolen cookie*. The failure is the plugin's own vocabulary (`SESSION_NOT_FRESH`), drawn as the next step like the
  session list.
- **Backup codes come before the authenticator, and enabling is not on until the first code verifies.** The setup
  dialog shows the ten codes and requires a "받아 적었습니다" check **before** it shows the QR; the account flips to
  enabled only when the first code is right (`skipVerificationOnEnable: false`). So "on without a recovery path" is
  not representable, and someone who quits midway is not locked out by a factor they never finished.
- **Secrets leave the server once.** The TOTP URI is in the enable response only (`get-totp-uri` is closed); backup
  code plaintext is in the enable and regenerate responses only (`viewBackupCodes` is serverOnly). The QR is drawn
  **in the browser** (`qrcode`) — an external QR service would put the secret in someone else's logs.
- **No trusted devices.** A `trustDevice: true` request is **refused** (`TRUST_DEVICE_UNSUPPORTED`), not ignored —
  that state outlives sign-out, has no screen to list or revoke it, and would stay forever on a lost laptop. The
  slice that builds that screen deletes the refusal.
- **No email/SMS OTP.** That would be another `TransactionalMail`, and that vocabulary is closed on purpose (see
  `### Authentication mail`) — a deployment's own privacy policy usually lists every mail it sends, too.
- **The word is `백업 코드`, never `복구 코드`** — that one is the sync recovery code, and the web account folder's
  static scan still bans it there.
- **Account enumeration does not regress.** The challenge appears only **after** the password is verified, so a
  wrong password answers identically whether or not the account uses 2FA (`two-factor.test.ts` pins it).
- **`AccountDetailsDto.twoFactorEnabled` is one boolean** (`.default(false)` so an older server parses as off). No
  secret, remaining-code count or method list crosses the contract; the key-set tests grew by exactly that name.
- **Mobile answers the challenge and manages nothing.** Its login screen swaps to a code prompt
  (`features/sign-in/two-factor-prompt.tsx`) and calls the same two verify endpoints through the Expo cookie jar;
  without it, turning 2FA on in the web would lock that person out of the app's password sign-in. Enabling,
  disabling and regenerating stay on the web account screen (a static scan pins both directions). The code-shape
  rule is shared (`@rowcat/domain`'s `two-factor.ts`).
- **No security notice mail yet** (enabled/disabled) — that is an eighth and ninth `TransactionalMail` and needs the
  same bar the seventh met.
- **Lost both the authenticator and every backup code?** Social sign-in or a passkey still gets in (they are not
  challenged), and from there the person can regenerate codes or turn it off; an account with **only** a password
  has no self-service path and goes through the business contact. Account deletion needs nothing extra
  (`twoFactor.userId` cascades).

### Password reset

**The mailbox owner sets a new password.** Better Auth's built-in flow, unwrapped
(`apps/api/src/auth/index.ts` · `emailAndPassword`, `apps/web/src/features/auth/password-reset.ts`).

```text
POST /v2/auth/request-password-reset   email → (if an account exists) one mail
GET  /v2/auth/reset-password/:token    the link → web /reset-password?token=…  (or ?error=INVALID_TOKEN)
POST /v2/auth/reset-password           token + new password
```

- **Not wrapped in our routes** — the same reason as change-email: a second token implementation, and a password
  crossing our contract. The web calls the auth client directly.
- **The sender is registered only when reset is open** (`passwordResetEnabled` — mail **and** the switch below). Registered without a transport,
  `sendTransactionalMail` quietly does nothing while the screen says "sent" — that person waits forever. Unregistered,
  the library answers `RESET_PASSWORD_DISABLED` and the screen says it cannot be done here.
- **The sender does not await the mail — and neither do the verification and email-change senders**
  (`sendWithoutWaiting`). Sign-up, resend and email change also answer an existing or unknown address with the same
  sentence and no mail, so awaiting SMTP there leaked the same fact through response time (email change from any one
  account, quickly). The library answers an unknown address immediately and a known one only
  after this callback — awaiting SMTP there makes **response time** say "this address is registered" while the
  sentence stays the same. The price is that a send failure is a log line (no address, no URL), never the response.
- **Unknown addresses get the same answer and no mail.** The screen's sentence always says *if an account exists*.
  Never mail "this address is not registered" — it lands with the address owner, who asked for nothing.
- **Reset revokes every session — the opposite of change** (`revokeSessionsOnPasswordReset`). Whoever resets does not
  know the current password, and whoever does may already hold a session; a reset that leaves it alive adds a door
  without closing the open one. The mail and the screen both say this, so **turning it off removes those sentences
  in the same commit.** Token life is stated (`resetPasswordTokenExpiresIn`, 1 hour) for the same reason — the mail
  quotes the number. `password-reset.verified.test.ts` pins both by value.
- **The return address is a constant path** (`/reset-password`, plus `?redirect=` through `redirectTargetFrom`),
  checked against `trustedOrigins` by the library; an untrusted one is a 403 and **no mail goes out.**
- **One route, three faces** — request, new password, expired link. An expired link's next step is getting another
  one, so it happens in place. The token is moved into state and **stripped from the address** (`replace`); a
  refresh shows the request face and the mail's link still works until consumed. The route is outside `(app)` like
  `/login` and does not bounce signed-in viewers.
- **No auto sign-in after reset** (the library does not, and the link may be opened on a shared PC). The screen
  clears viewer state first — the session it held was just revoked — then goes to `/login?reset=1`.
- **A social-only account gains a password** (the library creates the credential row). Accepted: mailbox ownership
  is proven, and it may be the only way back for someone who lost their provider.
- **Reset does not mark the email verified** — an unverified account still meets the verification mail at the next
  sign-in. Do not write `emailVerified` by hand here; verification has one recorder.
- **The entered email never rides the URL** (the login link carries only `redirect`).
- **Mobile hands the whole flow to the web.** Its login screen's `비밀번호를 잊으셨나요?` opens `/reset-password`
  (`passwordResetWebUrl`); the app calls neither reset endpoint (`account-boundaries.test.ts`). The mail link
  returns to the web anyway — and may be opened on a desktop where `rowcat://` goes nowhere — so a native request
  form would put half of one procedure on each surface. No web origin or reset closed, no link.
- **Still a separate switch — `PASSWORD_RESET_ENABLED`.** A privacy policy commonly closes the list of mail the
  operator sends, and a deployment whose policy does not list the reset mail must leave the switch empty. So reset
  opens only when **both** mail exists and `PASSWORD_RESET_ENABLED=on` (`passwordResetEnabled` in `env.ts` — the one
  place that decides). Mail alone must never open it — `env-doctor.test.ts` pins that.
- **The login link reads that same fact, not a guess.** `GET /v2/runtime-config` carries `passwordReset`
  (default `false`, so an older server reads as closed), and both apps draw `비밀번호를 잊으셨나요?` only when
  it is `true` (web: the `/login` loader prefetches `runtimeConfigQueryOptions`; mobile:
  `lib/password-reset-link.ts`). It is **not** a `disabledFeatures` entry — those are the operator's console
  breakers, and this value is deployment configuration the console cannot open.

### Passkeys

**A list, not an account row.** Rationale in `apps/api/src/services/account/passkeys.ts` and
`db/tables/passkey.ts`.

- **Do not add `"passkey"` to `LoginMethodProvider`.** That vocabulary points at **one provider record**, one
  per provider per member, while a passkey account holds three or four. Merged, one row in the list comes to
  represent several credentials, and neither that row's `linkedAt` nor its unlink button can say what it means.
- **We do not write the WebAuthn protocol.** What we decide is only **which domain's ceremony to trust**, two
  values — and those two are the most dangerous settings in this slice. **Do not derive rpID and origin from
  request headers**: with no configuration the plugin builds rpID from `baseURL`'s host (= **the API domain**)
  and takes the verification origin from the `Origin` header — both wrong wherever web and API sit on different
  hosts. **If rpID does not
  cover the origin, boot is blocked** (`lib/webauthn-config.ts` — the suffix comparison **also checks the dot
  boundary**: with `endsWith` alone, `evil-rowcat.com` passes for `rowcat.com`). When they are mismatched the
  symptom is not an error but the browser refusing registration, and nothing appears in the server log.
- **Passkeys do not create accounts** (`registration.requireSession` at its default). That default incidentally
  buys one more thing — the plugin requires a **fresh session** to issue registration options, which is what
  stops one stolen session cookie from becoming a permanent login method.
- **Only list, rename and delete are wrapped in our routes.** The plugin's list response is **the credential rows
  as-is**, carrying public keys, credential ids and counters, and deletion is **the only place the server can
  observe success** (for the security notice). Registration is not wrapped — the challenge cookie is tied to the
  browser round trip. `AccountPasskeyDto` is an **allowlist** (three fields) and **a test that counts the
  response's key set** guards that boundary (written as "there are no sensitive fields", it would pass while
  leaking the day the plugin adds a column).
- **Do not invent device names from the AAGUID.** Privacy-preserving platforms fill it with zeros and the list is
  not authoritative either — **a wrong label is worse than none** (users mistake their own device for someone
  else's and delete a perfectly good credential).
- **The target is found within this session's list** (`requireOwnPasskey`). The library's
  `requireResourceOwnership` stands one layer behind it; we look first because **that middleware's rejection
  vocabulary differs per endpoint.**
- **A missing passkey and someone else's are the same 404.** A second delete being a 404 is where this diverges
  from session revocation, and there is a reason — for sessions, "that reference is gone" is part of the normal
  state, while a passkey is this account's asset list, so pointing at something absent means the screen is stale.
- **Do not weaken the provider unlink guard.** We do not enable `allowUnlinkingAll` — passkeys live in their own
  table, so the library's unlink guard **does not count them.**
- **The registration notice is sent by a response hook** (`hooks.after`). `registration.afterVerification` runs
  **before** the credential row is stored.
- **Passkeys are neither local data nor sync data** (sharing between devices is the authenticator ecosystem's
  job; all we would carry is a public key). Account deletion does not enumerate this table separately
  (`passkey.userId` cascades).

### Sign in with Apple

```text
Google   two strings the console gave us          a half-configuration turns off quietly
Apple    Services ID · team id · key id · .p8      a half-configuration **blocks boot**
```

- **There is no secret to paste.** Apple's `client_secret` is a short-lived ES256 JWT we sign with the `.p8`
  private key. We do not accept a signed JWT via env var because that value **expires without saying
  anything** — on the day it expires, boot succeeds, the health check passes, every other method is fine, and
  only people who pressed the Apple button fail, with the symptom months away from the deployment.
- **`clientSecret` is an accessor.** The library reads that value **at request time**, so one accessor removes
  expiry entirely. Passing a string built at boot returns to the same trap in a long-lived process. This works
  because signing is **synchronous.**
- **The signature must use JWS encoding** (`dsaEncoding: "ieee-p1363"`) — node's default DER looks like a
  syntactically valid JWT and is rejected only by Apple (a test pins the signature length at 64 bytes).
- **A half-configuration is a boot error.** Apple has four values, one of them a multi-line file, and the
  symptom of that mistake appears **after** the user has finished signing in on Apple's screen. **No key
  material rides in any failure message** (boot logs are read by many people).
- **Add `https://appleid.apple.com` to the trusted list — only in deployments with Apple on.** Apple alone uses
  `response_mode=form_post`, so the browser sends a **cross-site POST** to our callback. Better Auth's origin
  check only stands on requests carrying cookies, and **when a CDN plants a `SameSite=None` cookie**
  (Cloudflare's `__cf_bm`) that POST gains a cookie and immediately becomes a 403. Do not add it in deployments
  with Apple off, and **do not put it in the browser CORS list.** We do not handle that POST ourselves (the
  library's callback handler bounces the POST into a GET at the same address and takes the usual path — which
  is why there is no reason to loosen the `state` cookie to `SameSite=None`).
- **`appBundleIdentifier` now exists, and it is not an env var.** The token's audience differs per path:

  ```text
  browser round trip   aud = Services ID   the web's clientId is that value
  native sheet         aud = **bundle id**  a token the app receives wears the app's name
  ```

  The library folds those two into one slot, so without this line native tokens **always** fail verification and
  the symptom is "only Apple sign-in is broken". **The value's source is `APP_BUNDLE_ID` in `@rowcat/domain`** —
  a bundle id is not a secret and cannot be changed (changing it is a store product migration), and as a knob it
  gains nothing while making one more deployment carrying **a wrong value** representable.
- **Linking is not signing in — that rule applies here too** (a static scan blocks **both** names).
- **Apple's "Hide My Email" trips linking often.** A relay address cannot match the RowCat account's email, and
  since `allowDifferentEmails` is off it becomes `email_does_not_match`. Do not turn the rule off; **make the
  guidance accurate.**
- **The login screen's social buttons come from one list** (`features/auth/social-sign-in.ts`) — hand-written
  buttons mean one of them misses `pending` handling or swallows failures, and that divergence is visible only
  to people using that method. **Mobile has the same shape** (`SOCIAL_PROVIDERS`, one start function) and
  **only transport differs** (that app's Apple receives an id token through the OS sheet).
- **Apple receives login information** (Apple Inc., United States — an overseas transfer). A deployment that turns
  Apple on says so in its own privacy policy first. Empty means the provider is not registered and the path does not
  exist.

### Kakao login

```text
Kakao   REST API key (+ optional Client Secret)   **the first alone turns it on**
```

- **A third shape is needed because the second value is optional.** Kakao's Client Secret is a security setting
  toggled in the console, so an empty value can be a **normal configuration.** There is only **one** genuinely
  dangerous direction of mismatch (turned on in the console with the env var empty makes the token exchange fail
  **after** the user finishes signing in), and `env:doctor` reports that warning.
- **It is `KAKAO_REST_API_KEY`, not `KAKAO_CLIENT_ID`.** The Kakao console has four keys and all of them are
  called "key" — writing `CLIENT_ID` does not tell you which to copy, and the symptom of the wrong key appears
  only after sign-in completes. **The Admin key must not end up here.**
- **The only method where email is not guaranteed — and we do not work around it.** `account_email` is
  **optional consent** and can be refused, at which point Better Auth creates no account and bounces back with
  `email_not_found`. Inventing a synthetic address (`<kakao id>@kakao.local`) is the common workaround, but that
  value is an email whose ownership is unproven, so verification, email change and password setting all stand on
  a falsehood, and mail sent there arrives nowhere. **Do not fill it in via `mapProfileToUser`.**
- **That failure has a sentence of its own for the first time.** Before this, social login failures did **not
  return to our screens** because there was no `errorCallbackURL` (Better Auth's default English error page was
  the last screen). Kakao made that path common enough that failures now return to the login screen — not split
  per provider (Google and Apple were failing silently for the same reason).
- **Values arriving on the URL are accepted only as vocabulary** (only values that passed
  `SOCIAL_CALLBACK_ERROR_CODES` and `SOCIAL_PROVIDERS` ride in search params) — putting a raw string there makes
  the screen render a string that came from the address bar. Unknown codes are dropped.
- **Narrow the consent scopes we request.** `profile_image` is dropped from the three defaults — that URL lands
  in `user.image` and **not one line of code in this repository reads that field.** It is a trade where one
  consent item we cannot explain the purpose of is added and one piece of personal data we never read
  accumulates.
- **Do not put per-provider branching in the browser.** The client does not pass scopes — passing them makes the
  same deployment show different consent screens depending on the request's origin, with only one of them
  receiving an email.
- **A table on the screen replaces the ternary** (`Record<SocialProvider, …>`). While it was a ternary, the
  moment a third arrived a new button **wore the Apple mark and started Apple sign-in** while compiling fine.
- **Trusted origins do not grow** (Kakao's callback is an ordinary GET redirect).
- **We did not make the button yellow — and that is an open decision.** Kakao's guidelines require a yellow
  background (#FEE500), while this screen has an existing decision that **the three buttons are the same rank.**
  Those two genuinely conflict, and following the guideline changes the visual hierarchy, so it is a **design
  decision** that has to arrive with that decision (`features/auth/kakao-mark.tsx` header).
- **Not on mobile yet.** The reason it did not grow is the mark — `@rowcat/ui-native`'s `BrandName` has no value
  for it, and growing only the vocabulary first creates a button with nothing to draw (that table is a `Record`,
  so adding a value **breaks compilation on the login screen**).
- **Kakao receives login information** (Kakao Corp., a domestic operator — no overseas transfer). A deployment that
  turns Kakao on says so in its own privacy policy first.

## Account deletion

The only irreversible operation, so the boundaries are tighter than elsewhere. Rationale in
`apps/api/src/services/account/deletion.ts` and `apps/web/src/lib/local-data/purge.ts`.

- **The entrance is Better Auth's `/v2/auth/delete-user` alone.** Building a delete route under our `/v2`
  creates a second implementation imitating identity verification, and above all brings passwords into the
  contracts and the SDK. The web therefore calls `authClient.deleteUser()` directly — the **only** write that
  does not go through `getRowCatClient()`.
- **A password account confirms deletion with its password — that rule is ours, not the library's**
  (`auth/account-deletion-policy.ts`, `hooks.before`). The library checks a password only when one is sent, so any
  session under 24 hours deleted a password account with `{}`. Social-only accounts still rely on recent login.
- **Server cleanup lives in `services/account/deletion.ts` alone**, and the auth account (`user`) row is deleted
  in **the same transaction** (splitting makes "the data is gone but the account is alive" representable).
- **`story.owner` is nullable and NULL means "a story whose identity was erased by account deletion".** Only
  publicly published works are kept; private, unlisted and archived are deleted, and **there is no exception.**
  (For a while a story someone had purchased was kept regardless of visibility; that exception left with billing.)
  Account for NULL when writing new queries — `NOT IN` against NULL is not false but **NULL**,
  so one block filter hides every ownerless story (`galleryWhere`).
- **We do not keep a minimal deletion tombstone.** With no re-signup restriction and no dispute handling today,
  retaining a personal identifier that no code reads is not a retention basis but a habit.
- **Local deletion is one name**: `deleteLocalDbForViewer(viewerId)` deletes only that member's database. Do not
  write code that sweeps `indexedDB.databases()` and deletes by prefix (it deletes other members on the same
  browser). Deleting through the open instance means a late write cannot resurrect the name. **Remembered device
  keys and device preferences are not deleted separately** (they vanish inside the member database — a global
  revoke function would make Alice's deletion undo Bob's trust).
- **Received notifications are deleted whole; what remains in someone else's inbox has only its identity
  detached** (`actor` becomes `set null`) — the latter is **something that actually happened to another person.**
  The design choice of not snapshotting nicknames pays off here: there is no name to delete in the first place.
- **Deletion does not create sync tombstones** (a tombstone per room and per message would mean uploading all
  the private content right before erasing it). The owner's namespace is deleted whole.
- **Signing out and deleting are different** (`purge.test.ts`). **The server goes first** — deleting locally
  first means that when a wrong password makes the server refuse, the conversations and drafts are already gone.
  A local failure after the server succeeded is **not a deletion failure.**

## Settings and preferences

**Ownership of values is the whole of this slice.** Full rules in `docs/settings/ARCHITECTURE.md`.

- **Settings is a workspace with its own navigation list, and that list stands inside the canvas.** There are
  two routes: `/settings` (general) and `/settings/ai`. **Do not create `/settings/general`** (when one screen
  has two addresses you cannot answer which is canonical). Switching is a **route**, not React state. There is
  one list and two containers — both are in the DOM, so the active indicator's namespace is separated.
  **Do not create placeholder categories.**
- **A settings screen opened from a conversation carries the way back** (`settings-return.ts`). The value rides in
  the address and is **narrowed to a conversation path** (`/chat/…`), so an open redirect is not expressible — the
  same shape the login screen's `?redirect=` has. Category switches carry it along (dropping it loses the way back
  for anyone who changed category, and the link simply disappears with no error), and screens that are not
  conversations get nothing — a `대화로 돌아가기` that leads somewhere the user has never seen is worse than none.
  **It is not a modal.** The reported ask was "open it as a window with an X", and settings is a workspace whose
  category switching is a route — as a modal the nav list and the address lose their meaning and refresh, back and
  link sharing each become a feature to handle separately. What was fixed is the **exactness of the way out.**
- **Shell and auth decisions belong to one layout route.** Written per leaf, one gets missed when a category is
  added, and the missed route just opens with no error.
- **`계정 관리` is not a category but a way out** — nickname, email, login methods, content display, sync and
  deletion belong to `/account`, and the settings screen draws none of those values (a static scan enforces it).
- **`이 기기 데이터 지우기` lives under `일반` in `/settings`.** Signing out, deleting the account and clearing
  device data mean entirely different things, and putting them in one place leaves the user unable to learn the
  difference from the screen. What is deleted is **one** per-member local database — not the server, not another
  member's name (this operation means "return this device to the state right after first login"). **The
  confirmation dialog states the price up front**: since the server's ciphertext is untouched, entering the sync
  key again brings a copy down.
- **The settings screen is not a store for any value.** Do not build an object holding every setting, a
  `SettingsProvider`, or a `설정 저장` button at the bottom — transactions spanning different stores do not
  exist, so such a button reports a partially-succeeded state as success.
- **`/account` is identity and security; `/settings` is behaviour.** **Theme looks like an exception and is
  not** — the value is stored on the account but is neither identity nor security; it is "how this app looks".
  The sections are split because **ownership differs** (above is the device's value, below the account's).
  Presets and custom colors are both open to every member (`### Account theme` below).
- **Generation setting precedence is room > global > product default**, and one pure function does the merging
  (`resolveEffectiveGeneration`). **The axes layer independently**, so the result carries per-axis sources
  (`sources`) rather than a single `source`.
- **There are three axes**: response length, generation target, and **reasoning effort** (`ReasoningEffort`).
  Only the third has a different character — **the model decides the range of values you may pick.** The
  authority for that capability is the server (`GenerationModelDto.reasoning`), and the screen does not guess
  from model id, provider or company name. `reasoning: null` means "RowCat does not offer an adjustable
  reasoning setting for this target", not "this model does not reason" — in that case **the row is absent
  entirely.**
- **Provider parameters for reasoning effort reach no shared layer.** `reasoning_effort`,
  `thinking.budget_tokens`, `output_config.effort`, `thinkingBudget` and `thinkingLevel` are the execution
  boundary's vocabulary — what contracts, preferences and the catalogue carry is one piece of product
  vocabulary, and putting a budget number on any of them creates code on the screen that reads it. **When
  absent, the key itself is absent.** We also do not send a value that **disables** thinking (some models reject
  it with a 400).
- **⚠️ It is not one translation table per company — it differs per generation, and the newest generation
  rejects the old shape with a 400.**

  ```text
  Anthropic   adaptive (thinking.type: "adaptive" + output_config.effort)  ↔  extended (budget_tokens)
  Gemini      3.x (thinkingConfig.thinkingLevel)                          ↔  2.5 (thinkingBudget)
  ```

  The fork belongs to each adapter's discriminated union, and a state where both parameters ride on one request
  is **unrepresentable.** Nothing is sent for unknown models (stored preferences outlive the catalogue). The
  symptom of a wrong value is a 400 only the user who picked that model receives, and it **disappears when
  reasoning is turned off**, so the fact that this axis is the cause never surfaces.
- **Output-cap arithmetic attaches only to the mechanism that requires it, and the condition is set by the
  mechanism rather than the provider.** Only where thinking tokens are consumed **within** the output cap do we
  raise the cap by the budget: Anthropic extended and Gemini 2.5. **Do not apply it to mechanisms whose budget
  is unknown** — there is no number to add, and an invented one raises a spending ceiling the user never chose.
  A budget of `0` is distinct from `undefined`. **⚠︎ On Gemini 3.x the price is especially high** — the reported
  behaviour is that thinking grows on its own to roughly 96% of the cap, so no number you add guarantees room
  for the body. We do not answer that on this axis. Both facts confirmed 2026-09-02 (googleapis/python-genai#2062
  — **the official documentation does not state this relationship**).
- **The capability table differs per model, and can differ per path for the same model** (the Claude 4.5
  generation is `null` on managed and has all three on BYO). Not leaning on the gateway's "fold to the nearest
  tier" is the same axis — lean on that leniency and the tier listed diverges from the tier that actually runs,
  **with no error at all.**
- **When the target changes, delete the reasoning override that became unusable — do not move it**
  (`reconcileReasoningOverride`). Moving it stores a value the user never chose as their explicit choice.
  **Do not touch any other axis**, and if the catalogue did not arrive, do not delete either.
- **There are two paths that change the target, and the latter has no trigger for cleanup.** While a room
  inherits its target, a change to the global leaves the room's override stored as an unusable value, and the
  screen draws that tier while execution runs on the new model's default (**the only place where a stored
  explicit preference means something other than what it says**). That window is closed by **the layer that puts
  stored values on screen** (`useStaleReasoningReconcile`; the rule is one shared pure function,
  `reasoningOverrideStale`) — do not pull the catalogue into the inheritance layer. **Do not slip an unusable
  value into the list.**
- **Reasoning content does not flow into the conversation** (Gemini sends thinking summaries as `text` parts too,
  so `thought` is filtered out). There is nowhere that stores thinking content.
- **"Which target was wanted" and "which target can run" are different questions** — precedence resolution knows
  nothing about connections (pure), and `resolveGenerationExecution` decides afterwards by looking at this
  device's provider connections. **Reasoning has the same shape** (`reasoningEffortForRequest`).
- **An explicitly chosen BYO target is never substituted.** With no connection we block generation and tell the
  user — whose key pays, the server the prompt passes through and the model's character all change at once
  while nothing appears to have happened. Falling back to managed because there is no override at all is not
  substitution but **inheritance.**
- **The two reasons something is unusable diverge on screen too** (`provider_not_connected` offers a path to
  connect; `model_unavailable` only says to pick another model). **If the catalogue query failed, do not
  adjudicate the model's existence.** Recovery is guidance, not a fix.
- **Only a key that passed validation is stored** (`features/settings/connect-provider.ts`). Ordering and
  same-tick duplicate submission live in a pure function because inside the dialog you cannot verify them without
  rendering. Do not clear the input on failure, do not fold every failure into "the key is wrong", and do not let
  a 401 at execution time delete a stored connection.
- **BYO credentials are member+device local and are never synced.** The seal is a non-extractable AES-GCM
  wrapping key with domain-separated AAD, and it **only prevents plaintext at rest** — a script on the same
  origin can still call decrypt (we state that honestly).
- **BYO generation does not pass through the RowCat API.** That path therefore has no server-side safety
  re-adjudication, and the policy is applied once by the generation router using **the same function** as the
  server (`applyPlatformSafetyPolicy`, idempotent).
- **Provider adapters only map, normalizing into `ChatStreamEvent`.** Prompt assembly is still one place
  (`buildChatGenerationRequest`) and the conversation hook has no provider branching.
- **Do not store "unset" as a value.** `기본 설정 사용` erases the override rather than copying the parent value —
  copying binds those users to the old value the day the product default changes.
- **Device preferences are not synced** (provider connections differ per device) and **generation freezes
  preferences the moment it starts** (the hook reads once from the store rather than subscribing).
  **Credentials enter no preference record** (a preference points at a target; connections are owned by the
  device — `apps/web/src/lib/local-provider/`).
- **The model catalogue's authority is the server** (`GET /v2/chat/models`). BYO entries use the provider's
  canonical id but with an **alias** instead of a dated snapshot (stored preferences live on devices a long time).
- **RowCat managed is several models with three layers.**

  ```text
  public identity     ROWCAT_MANAGED_MODELS in @rowcat/contracts   claude-sonnet-5
  server allowlist    services/generation/managed-models.ts                   unknown is a 400 and never substituted
  upstream slug       anthropic/claude-sonnet-5                    **never leaves the server**
  ```

  If the browser knows the upstream slug, the managed path is an arbitrary-model proxy. **Adding one managed
  model moves two places in the same commit** (the contract's identity → the registry's label, slug and
  **reasoning capability**). Mismatched, boot is blocked.
- **The catalogue carries no price.** Managed generation is unmetered (`### Managed generation access`), so there is
  no rate to project and no balance to draw — the catalogue's `pricing`, the tariff and its rate formatter left with
  billing. Do not put a cost hint back on the model cell; there is nothing true to say there.
- **The tokens a conversation actually spent are readable, and counting them is one pure function** (`chatUsageView`,
  drawn in the room's **`대화 정보`** pane in both apps). ⚠︎ **It used to sit at the end of the 생성 설정 pane**, and
  the causality that put it there is still true (the values chosen there move these numbers, and someone who sees a
  spiked turn next reaches for the control above it) — what reversed was the price: that pane is the **operating**
  surface anyone opens to pick a model, and every one of them had to scroll past a twenty-row diagnostic. The two
  panes answer different questions (*what shall I make this with* ↔ *what was this conversation*), and this table
  answers the second. **`ROOM_SETTINGS_IA` did not grow a row** — the destination is a pane that already existed, and
  what widened is that pane's axis: from 「facts fixed when the room was acquired」 to 「facts you cannot change here」.
  **The rule that it holds no controls is unchanged.** **The window is the most recent page and did not widen with the
  move** (the question is unchanged: did tokens spike on a recent turn); both apps use the same size
  (`useLocalMessages` · `lib/local-data/use-room-messages.ts`), and the screen states what it counted. The values are
  already stored on each answer, so there
  is no new record, endpoint or sync axis — what the function adds is the one rule that is easy to lose: **unknown is
  not zero.** Written per app, one of them eventually uses `?? 0`, and then answers that reported nothing count as
  answers that spent nothing, which makes the total **always smaller than the truth** (the server-side cache
  observation this repository once had learned the same lesson and wrote it down as `cache_usage_reported`). Answers with no reported usage are **counted and named**, never
  folded in. **No money appears here** — nothing is charged for these tokens, and a provider's price for a BYO key
  is not a fact this app knows.
  **Each row also says how that turn ended** (`상한에서 잘림` · `끊김`; a normal turn says nothing, so the two that
  matter are not buried), and **a row stands for every answer.** Gating rows on "reported usage" hid exactly the turns
  worth looking for — a turn that was cut is the one least likely to have received a usage frame, and that was the
  whole reason someone opened this pane.
- **Do not pre-lock managed models on the client.** Whether this member may use them is the server's decision and
  that rejection has a name (`chat_managed_not_allowed`). **Do not silently change the chosen target either.**
- **Do not use branding aliases.** The same model appearing in **both** the RowCat group and the BYO group is
  normal, and **the group name** says which path it is.
- **Managed models are not deployment configuration.** There is no `CHAT_MODEL` env var and the product default
  is decided by code (`DEFAULT_MANAGED_MODEL`).
- **The managed request contract and the provider-neutral request are different types.** The model exists only on
  `ManagedChatGenerationRequest` — putting it on the shared request creates a field BYO ignores, and that field
  eventually reads as "the cell where you specify a provider".
- **An unknown managed model is a failure** (`chat_managed_model_unavailable`, 400). Substituting means the user
  reads a response of different character as coming from the model they picked.
- Do not create `GET/PATCH /settings` or a `member_settings JSONB` on the server, and **do not create a provider
  credentials table** either.

### Managed generation access — who may spend the operator's key

**Managed generation is unmetered.** It runs on the operator's provider key and nothing charges for it, so what
stands between a member and that key is this allowlist, the two rate-limit windows (`managedGeneration` 30/min,
`managedGenerationDaily` 400/24h, both fail-closed — `## Rate limiting`) and the stream's wall-clock cap.

```text
deployment   MANAGED_GENERATION_ACCESS          allowlist (default) | everyone
member       member.managed_generation_allowed  default false — an admin turns it on per member
role         staff · admin                      always allowed
refusal      403 chat_managed_not_allowed       → the client sends the person to AI settings (BYO)
```

- **The default closes.** A deployment that never set the variable serves the key to its operators and to the
  members an admin listed — not to every signup. `everyone` is a deliberate choice for a deployment that wants
  it.
- **The decision is the server's and stands before upstream.** Every managed door — `/v2/chat/generate` and the
  protected story route — refuses before anything is sent, so a refused request costs the operator nothing. Nothing
  the client draws is the gate; the 403 is.
- **Operators are always allowed** — the people who hold the key need no row to use it, and an operator testing
  their own deployment must not first edit their own member record.
- **The refusal is not a retry and not a dead end.** `chat_managed_not_allowed` takes the same seat in the failure
  ladder as `provider_not_connected` / `invalid_credential` — **AI settings**, where the person connects their own
  key — and `다시 생성` does not stand (`canRetryGeneration`; pressing again gets the same 403). The sentence says what
  is true: this server's default AI is open to allowed accounts, and a personal key works.
- **BYO is untouched** (that path never reaches our server). Utility calls that ride the managed door
  (auto-maintenance, reply suggestions) are refused the same way — maintenance silently, because `maintain` never
  throws; a suggestion speaks, because it was a press.
- **The toggle lives on the member detail in the operations console and is admin-only**
  (`POST /v2/admin/members/:id/managed-generation`, `{ allowed, reason }`; `client.admin.setManagedGeneration` ·
  `adminSetManagedGenerationMutationOptions`). The row write and its audit row
  (`admin.member.managed_generation.set`) are one transaction, and the detail projection carries the current value
  as `operator.managedGenerationAllowed`.
- **Do not bring back a balance to "solve" cost.** Metering existed and left with billing (`docs/oss/PLAN.md`
  §3단계); the answer to "this member spends too much" is the allowlist or the rate-limit table, not a ledger.

### Account theme — presets and custom colors

```text
default semantic tokens   @rowcat/design              product   light + dark
brightness preference     browser/app appearance      device    system | light | dark
presets                   member_theme_customization  account   default | white | gray | black
custom color values       member_theme_customization  account   **one** palette (background, surface, accent)
background gradient       member_theme_customization  account   **one** expression over that background
```

**All of it is free.** For a while custom colors and the gradient were a Cattower subscription benefit; that gate
left with billing (`docs/oss/PLAN.md` §3단계). What remains is the shape the gate forced, and it stands on its own.

- **The two axes do not erase each other — the shape of the UPDATE statement is that promise.** The preset write's `set`
  has no color cells and the color write's `set` has no `preset`. Listing every column looks much shorter, and then
  someone who tried a preset once loses the colors they saved (an API test guards it **both ways**).
- **So the writes stay split** (`PUT /preset`, `PUT /colors`, `DELETE /colors`, `DELETE /` — all `requireViewer`).
  The split's basis used to be authorization; now it is that one save must not touch the other's cells. Do not merge
  them into one `PUT /` — that request would have to decide by **a diff of what changed** which cells it may write.
- **There is no entitlement field.** `customColorsActive` is gone from the contract, and the selection both apps pass
  is `{ preset, customization }` (`effectiveThemeSelection` → `resolveEffectiveThemeOverrides`). Do not leave an
  always-true boolean behind — every reader keeps a branch on it, and someone eventually writes that branch again.
  Both apps' static scans lock the absence of billing and entitlement vocabulary in the theme files.
- **Priority is custom colors > preset > default tokens.**
- **`surface` is not one surface but the reference point for the whole neutral UI family.** Layers and borders are
  derived, and **we do not paint the same hex across all of them** (a card, a hover and an input border in one color
  erases the hierarchy). There are two perceptual-lightness (OKLab `L`) steps and the direction is set by **the chosen
  surface's lightness** (`themeSurfaceScheme`). **`accent` is not the brand color** (it is menu hover and the selected
  row's floor, so painting it `primary` flashes the screen in brand color while scanning a list). Only
  `muted-foreground` follows a different rule (it interpolates between surface and body text and picks **the first point
  that reaches AA**).
- **There are three accepted cells** (`THEME_CUSTOMIZATION_SLOTS`). The fact that the resolver's **output** became
  twenty-five is not grounds to widen that vocabulary, and a request carrying `muted` or `border` is rejected with a 400
  by the contract's `.strict()`. `MANAGED_THEME_COLOR_NAMES` is the union of both resolvers — kept narrow, derived colors
  remain inline on the screen of an account that reverted.
- **`destructive` and `chart-*` paint no layer** (the red that says "this cannot be undone" is not an axis of taste).
- **Preset color values are not stored** (what sits in the column is one name). The vocabulary lives in **both**
  `contracts` and `design` and a test at the assembly point guards their equivalence.
- **The account palette is one — there is no light/dark variant.** The resolver has no `scheme` argument and the two
  application layers **do not pass one to it** (a static scan locks that absence).
- **The platform chrome follows the effective background, not the device appearance.** The status bar icons and the
  browser's default controls do not read our tokens, so when the account overrides the background,
  `device light + black preset` becomes **black icons on a black screen**. **That value does not substitute for
  `scheme`** — the root's `.light`/`.dark` are untouched and what is layered on is `style.colorScheme` alone, applied in
  **one place** (`lib/theme/chrome-scheme.ts`). It is derived state and is stored nowhere.
- **Brightness and theme are different values with different owners.** **The theme is account state, not device
  storage** — demoted, a theme chosen on the web never reaches the app, and the previous person's theme remains in a
  signed-out browser.
- **Having no row is the normal state, and the delete condition is a disjunction** (`shouldPersist`) — deleting on the
  preset alone makes saved colors vanish the moment someone reverts to `기본`.
- **Only three things are choosable and the foreground is derived.** Opening the foreground makes
  `background #ffffff · foreground #ffffff` a valid configuration, and whoever saves it also loses the way back.
- **A custom-color save is a replacement.** An empty document (`{}`) means the same as clearing colors — with merge
  semantics, a request reverting a cell must distinguish `null` from omission, and that distinction is implemented
  differently by every client.
- **There is one place per app where this is applied.** **The first paint is the default colors** — this value is
  private server state that a pre-run script cannot read, and putting it in unscoped localStorage in advance **crosses
  the account boundary.**
- **The background gradient is not a fourth axis but part of custom colors.** Do not build a dedicated endpoint — it
  turns one save button into two round trips, making **a half-succeeded state** representable.
- **The first stop is `background` — do not create a second color cell** (there is no `gradient_from` column). That
  background value is the floor for foreground contrast, the platform chrome's classification, mobile's actual
  background and the `--background` token, and a CSS image cannot go there. That pairing is a **structural invariant**
  (if there is a gradient there is a background) — a stray row that violates it is folded by the read into **an absent
  key.**
- **No CSS string lives in storage, the contract or the cache.** It is built in one web serialization function, and
  `stops`, `positions`, `radial` and `css` are all rejected by `.strict()`.
- **Do not mix images into the semantic color table.** `--background` stays a **color** all the way through and the
  gradient is layered separately through `--account-background-image` — put an image in a color token's slot and the
  browser **ignores that declaration** with no error, so places reading that token as a color quietly become transparent.
  There are only two consumers, both app backgrounds, with the coordinate system fixed to the viewport
  (`background-attachment: fixed`).
- **Only the foreground looks at both stops together** (`readableForegroundAcross`) — a text color chosen from the first
  stop alone **disappears over half the screen**, and that symptom is invisible in a single screenshot. Conversely
  **the platform chrome reads the solid reference point.**
- **Do not block unreadable combinations — say so** (one warning line; saving stays open).
- **The angle is an integer and `360` does not exist** (with the same direction stored as two values, "did it change" is
  answered by floating-point error). It is folded in **one input boundary.**
- **`랜덤 팔레트` is a convenience.** **The randomness does not roll three channels separately** — coordinates are chosen
  in OKLCh and dropped to sRGB only at the end. There are three rules: **the surface is lighter than the background**,
  the accent is saturated, and the text is always readable. **The random source is an argument** (a pure module calling
  `Math.random` directly removes any way to verify by value that "a generated palette is always readable").
- **Mobile is narrower — and that boundary splits at the gradient.** That app edits presets and solid custom colors
  only, drawing and editing no gradient, and because the color write has **replacement semantics** its absence would be
  a deletion. So the draft **passes that value through**, and to keep the passed value from going stale the draft sync
  observes **even the invisible cells** (`themeDraftSyncKey`) — while **the `dirty` decision conversely looks only at the
  three visible cells** (merged, changing only the gradient on the web turns on mobile's `색상 저장`).

### Provider content filters — the layer above our guards

**Only the Gemini BYO adapter has this axis today**, and it is set from one value: the turn's
rating (`apps/{web,mobile}/src/lib/generation/gemini.ts`, `safetySettingsFor`).

```text
all-ages   BLOCK_ONLY_HIGH   looser than the provider default, but the net stays
adult      OFF               our guards are the ceiling; the filter does not second-guess them
```

- **⚠️ Sending nothing is not neutral.** For a long time this adapter sent no `safetySettings` and
  the comment called that "the provider's policy, not ours to tune". The default thresholds are
  calibrated for a general assistant, so they blocked **what our own guards explicitly allow** —
  the all-ages guard says conflict, combat, crime and death may be handled freely and the default
  cut those scenes; the adult guard permits direct description and that response never arrived at
  all. The user saw one unexplained `다시 생성`.
- **Not turning it off for all-ages is half of the table.** That rating's guards forbid sexual
  content at both ends of the prompt, so on the normal path the filter has nothing to fire on and
  keeping it costs nothing — and **BYO has no server-side re-adjudication**, so a free last net is
  not one to discard.
- **Turning it off for adult is not bypassing a filter; it is keeping one owner for the decision.**
  What may be written is settled by the absolute guard, the rating guard, the minor guard and the
  intensity block, at both ends of the prompt. A general-purpose threshold re-deciding that on top
  means **what we forbid stays forbidden and only what we allow disappears.**
- **⚠️ Off does not mean anything goes.** The core prohibitions do not come down with this setting,
  and the key is the user's own so **that account's own terms with the provider still stand.**
  Say this honestly; do not write "we turned the filter off, so it will generate anything."
- **A blocked response has its own name** (`content_blocked`) and **is not a `done` frame.** Folded
  into completion, that turn reads as unanswered and the screen offers a retry that cannot work.
  Both the finish reason and `promptFeedback.blockReason` (no candidate at all) reach it, the
  vocabulary is a closed list, and **`MAX_TOKENS` is deliberately not in it** — written as
  `!== "STOP"` a truncated response reports as blocked and `이어서 생성` loses its seat.
- **`다시 생성` does not stand on it** (`canRetryGeneration`). The judgment is an approximation and
  the comment says so: sampling means a retry could pass, but after we already lowered every
  tunable threshold, what is still blocked is a prohibition we cannot turn off — pressing again
  mostly buys one more paid call and the same answer.
- **The table is the provider's dialect, so it stays in that adapter** — the same rule
  `chatToolJsonSchema` follows (the spec-shaped part is shared; Gemini's upper-case types stay
  put). **The two apps' copies are a pair**: fix one and only that app's intensity stays blocked,
  so each app's `adapters.test.ts` pins the emitted array by value.
- **Anthropic BYO and the managed path have no equivalent axis.** Do not invent one — Anthropic
  exposes no such parameter, and the managed path's policy is the server's.

### Prompt caching

**A transport optimization, not a product axis** (`docs/settings/ARCHITECTURE.md`, §prompt caching, and each
adapter's header).

- **RowCat does not build a prompt cache.** Caching is upstream's job — we do not build a hash → prompt table and
  we do not manage Gemini's `cachedContents` lifecycle (no request goes out **before** generation).
- **The cache-target decision is the provider namespace, and it stands after routing resolution**
  (`usesExplicitPromptCaching`). What a managed request carries is a public identity with no namespace — you have
  to look at the resolved upstream slug. Do not write literals and do not copy the managed identity list (the day
  the registry's slug is swapped, caching turns off quietly, and the symptom is **the invoice**).
- **Do not place breakpoints by hand** — attaching `cache_control` per block would require the adapter to know
  the boundaries of guards, seed, lore, memory and history, which breaks `@rowcat/chat`'s provider neutrality.
- **This is not response caching** (reusing a whole probabilistic model response is a different product
  behaviour, and in roleplay it shows up as the same answer repeating). **Do not reorder context for the cache**
  — instead **determinism** pays the price (a `Date.now()`, an RNG or a request timestamp in the assembler makes
  the prefix different every time).
- **The contract defines what the three usage names mean**: `inputTokens` is **total input including cache**,
  `cachedInputTokens` is the portion read from cache, and `cacheWriteInputTokens` is what this request wrote to
  the cache (**not subtracted** from input). Provider raw fields are not 1:1 with these — in particular
  Anthropic's `input_tokens` is **the remainder after cache**, so the adapter adds all three to get total input.
- **Vendor names do not ride on the contract** and cost and discounts do not go out. **Unknown and zero are
  different** — if the provider does not report cache details we do not carry that axis (writing 0 asserts "the
  cache did not hit at all", which we cannot know).
- **Cache metrics are observation, not correctness** (generation does not fail for their absence, and we do not
  retry on a cache miss or a cache write failure — it is a paid request on someone's key). **There is no cache UI
  and no toggle.**
- **BYO key handling did not change by a line** (we do not build a cache of decrypted keys).
- **Gateway attribution is derived from configuration, never a literal** — `HTTP-Referer` is the deployment's
  canonical web origin (omitted on loopback) and `X-Title` is `APP_NAME` (`services/generation/chat.ts`).

### Sticky routing — the same conversation to the same endpoint

**Turning the cache on and returning to that cache are different axes** (a cache lives per provider endpoint, so
routing elsewhere every turn makes hits accidental).

```text
room record     routingSessionId   a random value the device issued. once set, it does not change
generation req  routingSessionId   product vocabulary. BYO adapters do not read it
upstream body   session_id         **this name appears only here**
```

- **The value is not the room id, nor derived from it** — derived, this value becomes another representation of
  the room id, and at that moment the fact that the server has no rooms collapses over one routing axis. The
  contract narrowing the shape is that fact's last line of defence (`RoutingSessionId` — a value like `room:<id>`
  is a 400).
- **Product vocabulary and provider vocabulary are separated** (`session_id` ends at `services/generation/chat.ts` — one
  name would make changing providers a client deployment). **It rides only on managed.**
- **One key per room, and the value is persisted.** Rooms created under older versions are issued one right
  before the next generation and it is **stored** (`ensureRoomRoutingSession`) — creating one per request makes
  every turn a new conversation, which is worse than not having this axis. Issuance does not bump `updatedAt`.
  **Changing model, reasoning effort, response length, role or title keeps the same value** (do not build a
  `room → provider endpoint` table on the RowCat side, and do not hand-pin `provider.order` to imitate pinning).
- **It syncs and is not erased by merges.** Two rules: if only one side has it, that side wins; if both do, the
  HLC winner. Following the winner blindly **erases** the value when a version that does not know this axis wins;
  defending local unconditionally makes the room record shuttle forever.
- **No-retention routing is unchanged** (`data_collection: "deny"` + `DISCLOSED_PROVIDERS`). This axis is routing
  **affinity**, not routing **permission**. **It is still not response caching.**
- **⚠︎ An old rule narrowed.** For a while this line read *"do not send room ids, conversation ids or
  `session_id` upstream for cache routing"*, and **the first two survived** — neither room id nor conversation id
  goes out. What goes out is one **opaque random value issued per room**, and all upstream can trace from it is
  the fact of "a continuation of the same conversation".

## 만들기 — the creation workspace

A creator holds two kinds of resource with **opposite ownership**. One screen composes them while the data
layers stay separated all the way down. The third tab (`분석`) is not a new resource but an **aggregate** over
the second, and the fourth (`댓글`) is a **read across** two existing resources — my works and their comments.

```text
draft            this device's editing original   IndexedDB · liveQuery · E2EE sync
published work   the publication on the server    Postgres · API · SDK · TanStack Query
analytics        that publication's performance   Postgres aggregation · API · SDK · TanStack Query
comments         what others said on my works     Postgres · API · SDK · TanStack Query
```

- **`/create` is the workspace's home and `/create/:draftId` is the editor.** There is one route family (no
  `/studio`, no `/dashboard`, and no rearrangement into `/create/drafts/:draftId`). That family has two more
  screens: `/create/:draftId/test` (story test) and `/create/:draftId/runtime` (runtime studio). Both are
  authoring tools that do not publish, so they are still the `만들기` section.
- **There are four tabs and the address owns which one** (`?view=…`, default `drafts` omitted). In
  `localStorage` or React state, refresh, back and link sharing each become a feature you have to handle
  separately. The parser is lenient (if one hand-edited character turns the workspace into an error screen, the
  person reads it as their drafts having vanished). **Do not pre-build a slot for `settings`** — with a value in
  the vocabulary the screen draws it as a disabled tab at minimum, and the user reads that as a feature arriving
  soon. `comments` entered **with the screen that draws it**, which is the only way a value enters.
- **Tabs are links, and `activeOptions={{ exact: true, includeSearch: true }}` is required** — the default
  compares the link's search as a *subset* of the current search, and the `초안` tab's search is `{}`, which is
  true at any address. Then on `?view=published` **both tabs** carry `aria-current`, and visually only one is
  highlighted so it is invisible.
- **Drafts do not wait on the server** (there is no loader, and server state is not mixed into the gate that
  only checks whether the local store opened — `/create` must open offline and let you create and edit drafts).
- **The `미리보기` section draws the gallery card with the same component**
  (`features/gallery/story-card-body.tsx`) — the gallery wraps it in a `<button>` and the editor in a plain
  `<div>` (what differs is **the element kind**, so do not fold it into a boolean such as `interactive`).
  Two copies mean **only the preview goes stale** the day the gallery changes the tag count or title line count.
  The values pass through `prepareStoryMetadata` (the very normalization publication uses), and the `비공개`
  badge **follows the server's projection exactly** (`visibility === "private"`, not `!== "public"` — `archived`
  is false in the public projection).
- **The preview is a picture, not an operation** (`pointer-events-none`, `aria-hidden`). The heart row is
  **drawn without a number** — the favourite count of a story that does not exist yet is not `0` but **an absent
  fact** — and an empty title is not filled in (`제목 없음` is the draft list's vocabulary). **It is not a
  fourth tab** but a section inside the editor, placed right after `기본 정보`.
- **One hook answers what the cover currently is** (`use-draft-cover-url.ts`) — deciding separately produces a
  state where one side draws the file awaiting publication and the other the server's old cover, and **those two
  are side by side on the same screen.**
- **Failure in `발행한 작품` ends inside that section, and paused is distinguished from failed** — TanStack Query
  *pauses* retries when it decides there is no network (`fetchStatus: "paused"`), and that state is still
  `pending` rather than an error, so drawing only a placeholder shows offline users **a load that never ends.**
  That branch must stand **before** `isPending`.
- **There is one resource: `GET /v2/me/stories`.** Do not reuse the public profile's grid (that one answers "what
  this person shared with others" and **deliberately** excludes private work), and do not revive `?creator=` on
  the gallery (ownership is not one of discovery's axes). The owner comes **only from the session**, and the gate
  is `requireViewer` (a suspended creator must still be able to read the state of their own work).
- **The owner's list does not go through `galleryWhere`.** `listOwnedStories`'s predicate is `owner = :ownerId`
  alone, so private, archived, operator-hidden and adult all appear. Do not add a boolean such as `includeHidden`
  to `GallerySelector` to reuse `listStories` — that predicate answers a different question ("is this visible to
  this viewer") than this screen's ("is it mine"), and **every added axis shakes the discovery path's visibility
  boundary too.** Ordering is `updated_at desc, id desc`.
- **`CreatorWorkDto` is an allowlist.** `StoryDto` is not reused because it folds visibility into an `isPrivate`
  boolean — to a creator, `public` and `archived` both reading as "not private" makes an archived work look
  published. Playback payload, view count, favourite count, size, operator identity and internal reasons are not
  here, and **a test that counts the response's key set** guards that boundary. **`hidden` is here** — without
  it, the creator's screen draws a state indistinguishable from a broken product: "it is in the list but a 404
  when clicked". **Why** it was hidden belongs to `/v2/me/moderation`, though.
- **A domain predicate answers whether it can be viewed** (`isOwnWorkViewable`) — operator hiding and archiving
  are **404 even to the owner**, and if a screen re-writes that rule, only that screen draws dead links the day
  the boundary changes.
- **The two identities stay different to the end** (`StoryDraft.id` ↔ `Story.id`). The one bridge is
  `originDraftId`, and they are not joined by title or list position. The mapping belongs to a pure function and
  builds an index from the already-subscribed draft list — calling `store.getDraft()` per row means an IndexedDB
  round trip on every render.
- **A missing draft is not an error** — **state** it and drop only `초안 편집`. **Do not restore a draft from the
  playback snapshot** (that is the publication's representation, not the authoring one, so republishing from a
  restored draft makes content the creator never wrote their own work). When sync later brings that draft,
  `liveQuery` refreshes the list and the action appears on its own.
- **The `발행한 작품` tab is read, navigate and visibility transitions only.** Editing title, rating or body from
  that row makes the draft's title and the work's title diverge, and there is no longer any basis to decide which
  the next publication should treat as the creator's intent. There is no `다시 발행` button either — that
  operation requires an **order** (flush pending autosave, assemble the snapshot, validate, re-check ownership),
  and `publishDraft()` alone owns that order.
- **After publishing there is one invalidation line** (`invalidateCreatorWorks`). We do not splice a row in by
  hand because **there is no material to build one** — the publication response is the public projection, so it
  has no `originDraftId` and no `hidden`, and visibility is folded into a boolean. The invalidation scope is
  **this one prefix.**
- **The cache key is `["viewer","creator-works"]` and signing out is a reset, not an invalidation.** What sits in
  this tab is **the title of work not yet shown to anyone** — invalidation alone draws the previous person's
  manuscript titles the moment the next person opens `/create` (a P0). The same reason is why the key does not
  carry a member id.
- **Deleting a draft deletes only the draft** (the server work remains, and the confirmation for a published
  draft **states that explicitly** — `draftDeleteNotice`). Do not attach it to unpublished drafts (the same
  warning on every deletion soon goes unread). The tombstone row's `publishedStoryId` is not cleared (the
  publication link is monotonic).
- **Do not build metric cards in the `초안` and `발행한 작품` tabs** (metrics have their own tab and their own
  resource).
- Rating decisions are still not this slice. **Story deletion exists only as an operator tool** (`### Operations
  console` — there is no in-app deletion; a deployment takes requests through its own contact channel); creator
  self-service is a separate product decision. Until then a device draft can keep a `publishedStoryId` whose story an
  operator deleted — the publish panel still links to it and `다시 발행` creates a **new** story id.

### Comment inbox — what others said on my works

**A read over existing comments, not a messaging system** (`packages/contracts/src/creator-comments.ts`,
`listCreatorCommentInbox` in `apps/api/src/services/comments.ts`, `GET /v2/me/creator-comments`).

```text
included    live comments and replies on works I own (any visibility, hidden too)
excluded    tombstones · lines I wrote · lines by members I blocked
order       newest first, cursor (created_at, id) — the comments cursor format, opposite direction
```

- **The set is the analytics `댓글` metric's set** (current non-deleted user utterances) minus my own lines and
  blocked authors. Diverge and the analytics tab says 12 while the inbox draws 10, with nothing on screen to
  explain it. Tombstones are excluded **in the type**: the row's `comment` is `VisibleStoryCommentDto`, so the
  SDK rejects a response that leaks one.
- **Ownership lives inside the join** (`story.owner = :viewer`), not in a "list my stories, then their comments"
  two-step — that shape moves the "which works may I read" decision out of the service. There is no slot for a
  target member, a story filter or a sort axis. The gate is `requireViewer` (a sanctioned creator still reads
  what was said about their work).
- **The comment projection is reused, not redefined** — same author projection, same aggregates
  (`readAggregates`, two queries per page), so the same comment cannot render differently in two places.
- **No read state, replies-from-here, assignment or triage.** Notifications already announce new comments;
  a second unread axis would make two inboxes disagree about the same fact. The only row action is the existing
  **report** (`(storyId, commentId)`); deleting another person's comment is the author's or the operator's
  power, not the creator's.
- **Navigation is by id, to the story's comments section** (`creatorCommentDestination` →
  `/stories/:id#comments`, `STORY_COMMENTS_ANCHOR`). Not to the comment itself — same V1 decision as
  notifications (two cursor paginations stand between a link and that row). Archived, operator-hidden and
  private works have **no destination** (the first two 404 even for the owner; the last has no comment section),
  and the row says why instead of drawing a dead link. The detail pins the section briefly on arrival
  (`useHashArrival`) because related works arrive later with no reserved space.
- **The cache key is `["viewer","creator-comments"]` and signing out is a reset** — it holds titles of archived
  works and other people's words. No mutation invalidates it (it moves with other people's writes; freshness
  decides). The panel distinguishes offline, **session lost (401 → sign in, not retry)**, failure, loading and a
  genuinely empty inbox.
- **Both apps draw it, and the rules are one module** (`@rowcat/domain`'s `creator-comments.ts` —
  `creatorCommentsPanelView`, `creatorCommentKindLabel`, `creatorCommentUnreachableReason`). Each app keeps only an
  adapter that folds the failure into `sessionLost` (that judgement is `@rowcat/sdk` vocabulary) and formats the time
  (web `features/create/comments/state.ts`, mobile `features/create/creator-comments-state.ts`). **Mobile stops at the
  story**, not the comments section — the native detail has no section anchor, the same reason its notification
  destinations stop there; the day it gets one, `creatorCommentRowView` grows the hash.

### Story lifecycle — public, unlisted, private, archived

**Five operations that move the visibility of an already-published work, not publication itself**
(`packages/contracts/src/story-lifecycle.ts`, `apps/api/src/services/story/lifecycle.ts`).

```text
private / unlisted  ──publish──▶  public       goes into the catalogue
private / public    ──unlist───▶  unlisted     opens by link — absent from lists, search and profile
public / unlisted   ─unpublish─▶  private      the withdrawing transition
private / unlisted / public ──archive──▶  archived
archived            ──restore──▶  private      **neither public nor unlisted — it returns to private**
```

- **There is no `archived → public`. That absence is the whole of this slice.** Unarchiving and republishing are
  two different decisions, and doing both with one press returns a work you took down months ago to the catalogue
  without confirmation. There are **three** such paths (lifecycle `publish`, publish `POST /stories`, update
  `PUT /stories/:id`) and all three are blocked — one being open is enough to reach the same place in two
  presses. `archived → unlisted` is absent for the same reason.
- **The request has no body.** What to move is stated by the path; where to is stated by **the operation's name.**
  We do not build a generic field patch such as `PATCH /stories/:id { visibility }` because that shape can express
  every value in the vocabulary as a destination, so forbidden transitions become constructible requests.
- **This service touches one column: `story.visibility`.** That fact makes all of the following unrepresentable:
  `hidden` being released, the rating changing, authored content changing, counters resetting, the cover
  disappearing. **It does not bump `updated_at`** either — that value is the authoring edit time and the sort
  axis, and archiving is not an edit.
- **The gate's rule is one line: operations that reduce visibility are always open, and only operations that can
  return to visibility require a whole account.**

  ```text
               account state     capability      breaker   entitlement
  publish      requireActive     story.publish   publish   identity check if adult (**the locked row's rating**)
  unlist       requireActive     story.publish   publish   same
  unpublish    requireViewer     —               —         —
  archive      requireViewer     —               —         —
  restore      requireActive     —               —         —
  ```

  **`unlist` standing in the same row as `publish`** is the only ambiguous direction here. That operation both
  increases and decreases visibility depending on where it starts, and the gate does not compute the direction —
  it **aligns with the increasing side**, because an unlisted work opens to anyone who knows the address and that
  address spreads to places we do not control. It is not a dead end because the two withdrawing paths stay open —
  making a suspended creator unable to take down their own public work is not a sanction but holding their content
  in the catalogue.
- **The adult decision on a public transition comes from the locked row, not the request** (there is no body, so
  there is no slot for a rating in the first place) — which is why there is no path for a member who **had the
  entitlement at publication and has since lost it** to raise that work to public.
- **All five are idempotent.** A request for "already in that state" is a success and returns the current story —
  if a retry that merely lost its response looked like an error, the screen would draw failure while the state the
  user wanted is already true. Rejection is only for **a different transition**: making an archived work public is
  `story_archived`, and restoring a work that **opens from outside** is `story_not_archived` (we do not quietly
  lower the latter to private, because that is a **visibility reduction** nobody asked for).
- **Ownership is pinned in the predicate with `FOR UPDATE` in front of it** (a missing work and someone else's are
  the same 404). The lock is for contention — with `archive` and `publish` arriving side by side, without it both
  read the same starting state and a transition absent from this table commits.
- **We do not remember what it was before archiving** (remembering and restoring to it makes `복원`'s result
  depend on a state from months ago, which the user cannot know before pressing).
- **Archiving is not deletion** — cover, authored content, draft link, view count, favourites and comments all
  remain, and it stays in the `발행한 작품` list (vanishing from there removes any way to restore it). The
  confirmation states that **first**, and **the `보관` confirmation also states in advance that restoring is not
  publishing** (restore itself has no confirmation — nothing visible from outside changes).
- **Three operations require confirmation** (`공개`, `링크 공개`, `보관`). Attaching one to every operation makes
  the dialog unread, and then the three that must be read go unread too. **`링크 공개` requires confirmation
  because the words sound safe.**
- **Nothing anywhere implies review.** Pre-moderation, awaiting approval and review requests are procedures this
  product does not have, and a creator who reads those sentences walks away thinking it has not gone up yet.
- **The cache is swept immediately on withdrawing transitions** (invalidation alone leaves the just-withdrawn work
  in the gallery until the refetch finishes). Conversely, transitions that raise visibility are **not spliced in**
  — which query and which position that work lands in is decided by the server's visibility boundary and ordering.
- **A row's visibility comes from the operation, not the response** (`STORY_LIFECYCLE_RESULT` — not an invented
  value but that endpoint's postcondition). Deriving the destination from the response leans on the fact that
  "the archive transition's response reads as the owner projection", and that expectation breaks quietly.
- **The domain predicate decides which operations a screen draws** (`storyLifecycleActions`) — re-writing
  `visibility === "public" ? … : …` in a component leaves only that screen on the old rules the day the transition
  table changes, and the symptom is **a button that presses and receives a 409**, which is silent.
- **Do not add review states to the vocabulary** (`pending`, `reviewing`, `approved`) — that procedure does not exist.

### Discover — search relevance, tags, related works, popular ranking

**Four additions on one predicate.** All of them go through `galleryWhere`; none of them loosens a viewer axis
(`apps/api/src/services/story/index.ts`, `apps/api/src/services/story/ranking.ts`).

```text
relevance   a third StorySort. tiered score in SQL: title exact > title prefix > title contains > tag > nickname · author > description
tag         GalleryFilters.tag — exact array containment (`@>`), trimmed verbatim, one tag
related     GET /stories/:id/related — shared tags ×10 + same creator ×3, then favorites · play starts · recency · id; 8 max
popular     uniquePlayStarters×3 + favorites×4 + views×1 (× 0.2 for adult) — counters for `all`, per-story window subqueries otherwise
period      all = no cutoff · day/week/month = 1/7/30 **UTC calendar days including today**, from `@rowcat/domain`
```

- **Relevance without a query does not exist.** `effectiveGallerySort` folds `relevance` + empty query to `recent`
  in every layer (both URL adapters, `canonicalGalleryFilters`, the guest cache key, `selectPage`). The rule that a
  submitted query moves the default sort to relevance and a cleared query moves it back is one domain function both
  apps call (`applyGalleryQuery`); popular is never touched by it. The sort menu offers `관련순` only while a query
  exists.
- **The weights live in one pure module** (`story-ranking.ts`) with a mirror pure function per score
  (`relevanceScore` · `popularScore`) and API tests that assert the SQL orders like the function does. Every ranking
  ends in `created_at desc, id desc` — score alone is not a cursor.
- **The tag axis is exact, single and verbatim.** Authoring normalizes tags by trim only, so the filter trims and
  nothing more (`normalizeGalleryTag`); `밤` must not match `밤을 되감는`. Tags are actionable on the detail screens
  (web `Link` to `/?tag=`, mobile `router.navigate` with the `tag` param) and folded back by the toolbar token —
  there is no menu control. AND/OR over several tags was not added because no screen asks for it.
- **Related works are a discovery surface.** The route reads the source through the detail selector (so an invisible
  source is a 404 and cannot lend its tags), then lists candidates with the gallery route's axes (`unlistedVisible`
  and `ownAdultAllowed` false, own private visible). Score 0 is excluded — an empty list is a fact and neither app
  draws the section. One query; the source's tags ride as one bound array literal.
- **Popular reads only recorded signals.** `downloads` is dead (nothing calls `recordDownload`) and a weight on a
  constant zero would only *read* as a signal; it is gone from the score. The period is the recency mechanism —
  there is no decay on `all` (it would force a ledger scan the counters exist to avoid).
- **⚠️ The first signal is people, not sessions, and that is what keeps the ranking free of a play-mode bias.**
  For a while it was `story.play_starts` — a **session** count whose unit differs per playback mode: a chat session
  key is a local room id, so one person making three rooms counts three, while a runtime session key is the library
  row's identity, so the same person reopening it counts once. Each definition is right for its own product
  lifetime; what was wrong was adding those two numbers into **one ranking formula at the same weight**, which
  favours chat works per player. So a **second ledger counts people** (`story_play_starter`, one row per story per
  member, `story.unique_play_starters` as its counter) and the ranking reads that. **Do not "fix" the bias with a
  per-mode multiplier** — that writes today's usage pattern into business logic and goes stale immediately. **The
  telemetry definition did not change**: `story_play_log` still counts sessions and creator analytics' `playStarts`
  is still that number.
- **Windowed signals all count what is *new* in the period** — first-time starters, favourites added, views. Leaving
  one of them as "active during the window" adds two meanings inside one expression.
- **The period window is a UTC calendar window and `@rowcat/domain` owns it** (`storyPeriodStart` →
  `calendarWindowStart`, the very function creator analytics calls). It was `Date.now() - 7 × 86400000` while the
  label said `이번 주` — neither a rolling 168 hours nor an ISO week, so the screen named something it did not count.
  It is calendar-shaped because **the view ledger's resolution is a UTC day** (`story_view_log.day` is a date
  string): claiming an exact rolling 24 hours on top of that ledger is precision we do not have. The three ledgers
  now cut at the same midnight, so the day the view ledger was up to one day wider than the timestamp ledgers is
  over. Labels are `전체 기간` · `오늘` · `최근 7일` · `최근 30일` — `이번 주`/`이번 달` are absent because they mean
  the ISO week and the calendar month.
- **Period vocabulary, labels and boundaries are one source** (`packages/domain/src/time-window.ts`;
  `STORY_PERIODS`, `STORY_PERIOD_LABEL`, `CREATOR_ANALYTICS_WINDOWS` and its label table are all aliases of it).
  Two arrays with the same words and different cutoffs is exactly the state that was fixed, and nothing broke while
  it was true.
- **⚠️ Ranked pagination is offset-based, and live score movement can shift a row across a page boundary.** For a
  static snapshot the order is fully deterministic (score → `created_at desc` → `id desc`, so equal scores never
  duplicate or drop), but a favourite added between page 1 and page 2 can move a row past the offset and that row is
  then seen twice or not at all. **This is a known limitation, not a defect to paper over** — closing it means a
  ranked cursor (the score would have to ride in the cursor) or a snapshotted ranking session, and neither is worth
  building before there is a catalogue large enough for it to matter. Do not "fix" it by dropping a tie-breaker.
- **Query and cache identity grew with the axes.** `tag` is part of `GalleryFilters` so the query key carries it; the
  guest cache never caches a tagged or searched request, and folds a query-less `relevance` to `recent` before keying.
  Search and tag length caps are contract constants (`STORY_SEARCH_MAX_LENGTH`, `STORY_TAG_MAX_LENGTH` = the publish
  tag cap) — the adapters drop over-long values instead of truncating.

### Unlisted — not discoverable, but it opens

**The fourth value in the visibility vocabulary**, and the slice that brought **the separation of the discovery
axis from the viewing axis** into this repository.

```text
                discover   direct view   creator profile   share   the word the user sees
public             ✓            ✓              ✓            ✓      공개
unlisted           ✗            ✓              ✗            ✓      링크 공개
private            ✗         owner only        ✗            ✗      비공개
archived           ✗            ✗              ✗            ✗      보관
```

- **The two middle columns splitting is the whole of this feature.** Until then "is it discovered" and "does it
  open" had the same answer (`visibility === "public"`), so it did not matter that the comparison was scattered
  across predicates. Now every comparison has to decide **which of the four questions it answers**, and those
  answers are the domain's four predicates — `isStoryDiscoverable`, `isStoryDirectlyViewable`, `isStoryShareable`,
  `isStoryVisibleOnCreatorProfile`. **Do not fold them into one boolean** (they currently split into two answers
  but the questions differ — when a state of "opens but is not handed over" appears, one function diverges; folded,
  that change shakes the viewing boundary too).
- **The server's axis is `GallerySelector.unlistedVisible` alone, with no default** (discovery surfaces are
  `false`; the single-item path someone reaches by address is `true`). **Do not derive it from `viewerId`** — what
  divides them is not the viewer but **what that query is asking.**
- **Visibility predicates are built as allowlists** (`galleryWhere`'s `visible` array) — written negatively
  (`<> 'archived'`), a new value falls on the passing side when the vocabulary grows.
- **It is not a security boundary, and the copy says so.** All it promises is "not in the list", and anyone who
  obtains the address opens it **even as a guest**. There is no password, expiry, invite or token, and a pure test
  pins the absence of those words from the publication copy — promising stronger privacy than reality endangers
  whoever believed it and spread the link.
- **The address does not carry the visibility difference** (one path, `/stories/:id`; no `/unlisted/…` and no
  signed parameters — an address that carries the difference *is* the authorization).
  **No viewer axis loosens at all** (operator hiding, adult gate, blocks, sanctions).
- **Playback opens too** — the playback predicate (`playbackWhere` in `services/story/playback.ts`) admits `public`
  and `unlisted` alike, because its question is not "is it in the catalogue" but **"may this person open it by
  address"**. Diverging from the detail's answer creates **a `대화 시작` button that always receives a 404 when
  pressed.**
- **Account deletion does not keep unlisted work** (what remains is the `= 'public'` allowlist alone — unlisted is
  not standing in the catalogue, so there is no basis to keep it).
- **`noindex` is not access control** — it is a **request** not to index, and obeying it is the crawler's choice.
  Do not enumerate story addresses in `robots.txt` either: that file is a public document, so it becomes **a list
  of the addresses you were hiding.** Preview tags (og:*) stay as they are.
- **Both apps call the same function for the badge word** (`storyVisibilityBadgeLabel`; public is `null` so no
  pill stands — drawing the default state as a badge puts an information-free pill on nearly every card).
- **Preview links, temporary tokens, expiry, passwords, invite lists and collaborator access are not this slice.**

### Draft body — one prompt

The authoring surface is **one field**. Worldbuilding (`scenario`, `playGuide`), the counterpart
(`suggestedPersona`) and character records disappeared in v2 and their contents folded into one `prompt`
(`packages/authoring/src/legacy.ts`, `model.ts`).

- **Do not split the fields again** — reviving `세계관`, `진행 지침`, `상대역` and `등장인물 카드` is not adding UI
  but **rolling the storage model back to v1.** When a field does not answer the question (is a character's speech
  style a character card or play guidance?), the creator writes it anywhere, and at that moment the field is not a
  classification but an obstacle.
- **Lore and start scenes did not fold** (lore is conditional injection triggered by keywords; a start scene is a
  separate axis where one candidate is chosen as the opening).
- **The folding rule is one pure function** (`foldLegacyDraftBody`, called from three places). Folding separately
  makes the same draft a different text per device, and that difference appears only as **one side overwriting the
  other** in the next merge — so no clock, RNG or locale may enter. **Folding errs toward keeping, not losing**
  (the user can delete a duplicate; we cannot return a manuscript that vanished).
- **`AUTHORING_SCHEMA_VERSION` went to 2, and that is this change's safeguard** — the engine ignores versions
  **higher** than its own codec, so a device that has not updated keeps the last version it knows even when a v2
  draft arrives (there is no path where it half-reads an unknown shape and the manuscript looks empty).
- **The `authoring.character` codec is gone.** We do not erase the remaining ciphertext on the server with a
  tombstone because **erasing requires uploading first** — the only way to propagate a deletion is to rewrite that
  record, and that means uploading private content already folded into the body one more time.
- **There are five field groups** (`persona` dropped). A group with no fields to own would have a revision that
  never rises while adding one more lap to the merge loop, and eventually someone writes "it is empty, let us put
  something in it". When folding a v1 payload, the reason `body`'s revision becomes **the later of the old `body`
  and `persona`** is that pairing — carrying only the earlier one lets the peer's newer counterpart edit beat the
  folded body and **roll it back to the pre-fold state.**
- **Local migration marks folded drafts dirty.** This diverges from the old backfill, and the basis is that the
  characters differ: that one wrote down a fact that was already true, while here the body **actually changes.**
- **The publication contract did not change** — `play.playGuide`, `play.persona` and `play.characters` are still in
  the contract and the assembler **always sends them empty.** Removing them makes the playback snapshot of
  already-published work fail to decode (a shape the authoring tool no longer produces and a shape playback can no
  longer read are different things).

### Analytics — creator metrics

**Four honest numbers, and a window on the two that have a ledger** (`packages/contracts/src/creator-analytics.ts`,
`apps/api/src/services/creator-analytics.ts`, `packages/domain/src/creator-analytics.ts`).

```text
views        cumulative events   detail views deduped by (story, viewer, UTC date). the owner's own views excluded
playStarts   cumulative events   a device reported that a local session actually stood up (`story_play_log`). owner excluded
favorites    current state       members who hold it now. neither cumulative clicks nor a total
comments     current state       comment rows that remain now. deleted comments are not counted
```

- **The window (`all` · `day` · `week` · `month`) applies only to the two event-backed metrics.** `views` and
  `playStarts` have ledgers that answer a period; `favorites` and `comments` **do not** (a removal leaves no row), so
  the window moves the first two and leaves the last two as current state — and every label says which
  (`조회 · 최근 7일` vs plain `즐겨찾기`). The window boundary is a **UTC calendar day** because the view ledger's
  resolution is a day string; the play ledger is cut at the same midnight so the two count the same days
  (`creatorAnalyticsWindowStart`). `all` reads the counters and opens no ledger; the page carries `windowViews` /
  `windowPlayStarts` that equal the totals then. Ordering follows the window's numbers (`windowViews desc,
  windowPlayStarts desc, favorites desc, id desc`).
- **That window is the same object as the discovery period** (`@rowcat/domain`'s `time-window.ts`; both
  `creatorAnalyticsWindowStart` and `storyPeriodStart` are one call into `calendarWindowStart`, and the label tables
  are aliases). Discovery used to cut on rolling durations under the same words, so the two screens' `최근 7일`
  counted different days. **Do not re-derive a cutoff in either service.**
- **`playStarts` is still a session count, and it is deliberately not what the popular ranking reads.** Ranking asks
  *how many people started this*, analytics asks *how many times was it started* — different questions, so ranking
  moved to `story_play_starter` (`### Discover`) and this metric did not change. **Do not rename or redefine it to
  match ranking**, and do not fold the two ledgers into one.
- **Conversion is derived on the client from the same window's two numbers** (`playStartConversion`; `null` when
  views are 0 — not 0%). It can exceed 100% and is not clamped. The server carries no ratio. **The screen does not
  call it a conversion rate** — the words are `조회 대비 플레이 시작`, and one shared sentence
  (`PLAY_START_CONVERSION_NOTE`, both apps) says why it can exceed 100% **and that a session means a room for chat
  works and an account for runtime works**, so the same-named numbers of two playback modes are not comparable.
  Clamping it to 100% to hide that would make the number lie about what it counted.
- **We do not expose downloads.** `story.downloads`, `download_log` and `recordDownload()` all exist but **no live
  path in this repository calls them.** Relabelling that zero as `다운로드` is pretending to measure what we do not
  measure, and the popular ranking no longer reads it either (`### Discover`). **A `play` 200 is still not a start** —
  the start is the device's report after the local session exists (`### Play starts`).
- **It is a separate resource** (`GET /v2/me/creator-analytics`) — bolted onto `/me/stories`, the aggregation runs
  every time the management screen opens and asking for metrics again becomes asking for the whole work list again.
  **Do not reuse the public resources** (those two answer "what is visible", deliberately stripping private,
  archived and operator-hidden, while this screen asks "what is mine").
- **The predicate is one line: `owner = the member the session resolved`**, and the gate is **`requireViewer`**
  (the views an archived work accumulated, and the fact of having been read until it was hidden, belong to that
  person).
- **The total is over every owned work, not the page** (summing accumulated rows makes the total views grow with
  each `더 보기`, and the user reads that as views having increased). The server sends the same total with every page.
- **Per-work comment counts are not N+1** — one derived table **narrowed by owner first** is folded by `story_id`
  and left-joined (missing the narrowing makes the cost proportional to **the platform's entire comment count**).
- **Favourites and views are not recounted** (`story.favorites` and `story.views` are authoritative — if a counter
  drifts, that is a problem to fix on the write path, not on this screen). **Do not put metrics on
  `CreatorWorkDto`** (the two projections answer different questions, and **tests that count key sets** catch both
  boundaries).
- **Nothing non-aggregate goes out** (who viewed, who saved, who wrote which comment). **`hidden` is present** —
  without it, zero views is indistinguishable between "nobody saw it" and "it is hidden and cannot be seen".
- **Ordering is by performance and deterministic** (`windowViews desc, windowPlayStarts desc, favorites desc, id
  desc`) — without the last axis, rows with equal metrics duplicate and drop at page boundaries, and on an account
  where every metric is zero that is **every row.**
- **It is not real time** (no polling, SSE or sync wake-up — what moves these values is mostly other people on
  other devices). Do not attach this prefix to the favourite and comment mutations either (those operations are
  **mostly about other people's work**). Freshness is 60 seconds.
- **After publishing there is one invalidation line** — inventing the material means **writing wrong values**
  (inserting a new row with zero metrics makes an update publication overwrite a work that already accumulated
  views with zero, and the total goes wrong too).
- **The cache key is `["viewer","creator-analytics"]` and signing out is a reset** (what it holds is more private
  than `발행한 작품` — an unpublished manuscript's title with **how much it was read** attached).
  **Only the active tab queries.**
- **Do not draw failure as zero** (`조회 0 · 즐겨찾기 0 · 댓글 0` asserts "nobody looked", which we cannot know).
  The ordering of states belongs to one pure function (`features/create/creator-analytics-state.ts`) — stacked
  inside a component, someone who published ten works sees "아직 분석할 작품이 없습니다". **If there is a held
  value, do not erase it.**
- **Do not abbreviate numbers** (`12.4K` makes 12,400 and 12,449 the same glyphs). That decision drives the narrow
  layout: at 390px `1,247,017` does not fit a three-column cell, so the total cards stack vertically on narrow
  widths (shrinking the type makes creators with more views less able to read their own numbers).
- **No charts, tracking SDK, revenue or reader identity** (there is no shared chart component in this repository, and
  a graph drawn for one screen is decoration). The window lives in the address on both apps (`?view=analytics&window=`
  on the web, the `window` route param on mobile) — a period is refresh- and back-safe like the tab.

### Play starts — the first product telemetry event

**One event, recorded by the device after the local session exists** (`apps/api/src/services/story/telemetry.ts`,
`packages/contracts/src/story-telemetry.ts`, `POST /v2/stories/:id/play-starts`).

```text
chat      IndexedDB / SQLite room created and ownership re-checked   sessionKey = room id       (start-story-chat.ts, both apps)
runtime   the VM session reached `running`                            sessionKey = library row id (runtimePlayStartSessionKey)
```

- **The definition is the boundary, not the button.** `/play` and `/playback` 200s count nothing (a static assertion
  in `story-play-start.test.ts`). A start is reported **after** `createRoom` and the second ownership check, before
  navigation; a runtime start is reported once the session is running (`runtimePlayStartDue`). Storage failure,
  entitlement failure and an account switch mid-flight report nothing. The call is fire-and-forget and its failure
  never fails the start.
- **The server does not trust the report.** Entitlement is re-decided with **the same predicates playback uses**
  (`hasPlaybackEntitlement` shares one `where` builder with the payload query, `getPlayableStoryPayload`); no
  entitlement is the same 404 as no story. The owner's own play is `recorded: false`, not an error.
  The body is `.strict()` with two fields — there is no slot for a member, a story, a title or a timestamp.
- **Idempotency is the primary key `(story_id, session_key)`.** A retry that lost its response, a re-rendered effect
  and a reopened runtime all carry the same key and make no second row; the counter (`story.play_starts`) moves only
  when the insert actually landed, in the same transaction. Runtime keys derive from story+slot, so a runtime start is
  **once per account**, not once per session — the copy says so.
- **⚠️ One request moves two ledgers, because the unit differs.**

  ```text
  story_play_log      (story, session key)   the event    creator analytics' `playStarts`
  story_play_starter  (story, member)        the person   the popular ranking's engagement signal
  ```

  The session key means different things per playback mode (a room for chat, a library row for runtime), so
  **adding those counts into one ranking formula biases it toward chat works**. Both definitions stay; the ranking
  reads people instead (`### Discover`). The starter row is written **only after the event row actually landed**, and
  the *first* one per member is the only insert that survives the partial unique index — a `SELECT` first would let
  two concurrent requests both see nothing and both bump the counter. Both counters move in **one UPDATE** so "the
  event rose and the person did not" is not representable. **The first-start timestamp is what period ranking counts**,
  which is why a window means "people who started this work for the first time in it" — the same shape as the favourite
  window.
- **`member_id` stays server-private** (used for the owner check and nothing else) and becomes NULL on account
  deletion so the aggregate survives — **the starter row does the same** (`set null` plus a partial unique index that
  only applies to non-null identities, so the window counts and the counter stay put and rows with erased identities
  coexist). A per-member rate limit (`storyPlayStart`, fail-open) is the floor against key-rotating scripts;
  entitlement is the wall.
- **The starter ledger was seeded from facts this repository already had** — attributable play events folded by
  (story, member) with their earliest timestamp. Events whose identity had already been erased by account deletion
  were **not** counted: we cannot know whether they were different people, and inventing identities for historical
  telemetry is the one thing that migration must not do. Stories with such events therefore start slightly low, and
  that is the metric's honest epoch.
- **There is no event bus, queue, outbox or SaaS.** One row per event and one derived counter, exactly like views.
  Favorite and comment histories were **not** added — those mutations are already transactional and a second event
  table would only duplicate rows we can already count; when a real window on them is needed the answer is a ledger
  written in the same transaction as the mutation, not client reports.

### Story test — running a draft without publishing

**A temporary authoring sandbox**, not a second conversation product (`packages/authoring/src/playtest.ts`,
`apps/web/src/features/playtest/*`).

```text
draft (+children) → prepareStoryPublication (**the same normalization as publication**) → PlaytestSnapshot
  → temporary session (in memory) → ConversationSession → useConversationGeneration (**the conversation screen's hook**)
```

- **One normalization; validation only for publication.** `buildStoryPublication` split into
  `prepareStoryPublication` (normalization) and `validateStoryPublication` (publication readiness), and **the fact
  that publication validation did not loosen** is the condition of that split. **Not building a second "draft →
  playback" mapper is the most important rule in this slice** — with one, you get stories that "run this way in
  the test and differently when published", and that difference surfaces **only after** publishing
  (`playtest.test.ts` compares the two results field by runtime field).
- **Do not invent a story id.** `storyId` is a publication's provenance and a draft has none. Rather than filling
  it with something like `draft:<id>`, we **narrowed the assembler's input** — `ChatRuntimeSeed` has no such field
  at all.
- **Do not create a room.** We do not create one with `createRoom()` and hide it from the list — such a record
  carries dirty flags, revisions and tombstones and **rides along on the next push.** There are two defences: a
  behavioural test over the real store, plus a static scan blocking paths not yet called. One is not enough.
- **There is one generation lifecycle.** Ordering, failure handling and ownership decisions live in
  `use-conversation-generation.ts`, and the two screens differ only by the **adapter** (`ConversationSession`) they
  pass. The moment a branch such as `if (kind === "playtest")` appears, the two conversations' safety paths diverge,
  and that divergence shows up as **a different prompt in real conversations while the test passes.**
- **The ownership axis is an opaque token** — `generation-owner.ts` does not know what it is and only checks
  reference identity. That is why `테스트 초기화`, switching start scenes and `최신 초안으로 새 테스트` block a
  late-finishing generation **just by creating a new session object** (do not lean on `AbortController` — a request
  that already received its whole body sails past the abort signal and arrives **as a success**). **So the
  conversation lives outside the session** (if a new session object were built each time a message is appended, the
  ownership check would be false every turn and **generation would cut itself off the moment the first response
  arrives**).
- **The snapshot freezes** (if the system prompt changes mid-conversation, nobody can explain what is being tested).
  This screen therefore **does not subscribe** to the draft, and the operation that pulls in edits has its own name
  (`최신 초안으로 새 테스트`). Switching start scenes also rebuilds from **the draft version already held.**
  **Do not merge it with `초기화`** — merged, someone restarting because they disliked a response ends up **testing
  a different version without knowing.**
- **Flush autosave first** (without it, the test runs on a version missing the sentence just typed and the creator
  has no way to find the cause). **If it could not be written, do not navigate.** The ordering belongs to a pure
  function (`startDraftPlaytest`), and unsaved React values are not copied across.
- **The safety path is unchanged** — the rating decision goes through **the same function** as real conversations
  (`resolveAllAges`), the story rating comes first, and the viewer's entitlement layers on top. There is no
  `unsafe creator mode` toggle, and `playtest-runtime.test.ts` compares a publication's request and a test's
  **in full.**
- **Playback-only overrides are stored nowhere** (model and response length are written to neither device
  preferences nor room overrides, and the draft has no slot for them in the first place — a model is not an
  authoring attribute). Start scene selection does not overwrite `defaultStartSceneId`, and a BYO target with no
  connection is blocked with the same copy for the same reason as in real conversations.
- **The only row action is copy** (edit, regenerate and delete-from-here go through store transactions, and
  reporting requires **an identity the server knows**). Nor do we draw absent actions as disabled — which is why
  `MessageList` takes **a function that builds nodes** rather than a bundle of actions: policy belongs to the
  screen and the list only draws.
- **`/create/$draftId/test` is not a child of the editor** (the trailing underscore in the route folder name breaks
  that nesting) — as a child, the editor tree stays alive behind it along with its autosave hook and subscriptions.
  Do not light up `대화` in the sidebar.
- **⚠︎ The inspector arrived, and the sentence that made it cheap was true.** For a while this line read *"an
  inspector is not this slice"* and added that we had not made it hard to build later — lore selection stays
  structured **before** it becomes a prompt string, and no screen code parses a generated prompt. Both halves paid
  off: the debugger below needed neither a second selector nor a parser. **Model A/B is still not this slice.**

### The playtest debugger — an observer, not a second execution path

**Instrumentation around the real pipeline.** The generation lifecycle is unchanged; what is new is that it can be
handed a sink, and without one **nothing at all happens** (`docs/chat/` has no separate document — the rationale
lives in the headers named below).

```text
rules · buffer · caps   @rowcat/chat  debug-trace.ts   pure. no clock, no RNG — both come in as arguments
prompt structure        @rowcat/chat  prompt-trace.ts  named blocks, captured **before** the string exists
lore decisions          @rowcat/chat  lore.ts          one algorithm, two views
what the screen reads   @rowcat/chat  debug-view.ts    turn selection · exact vs estimated · display (both apps)
runtime lane            apps/web      features/runtime-preview/runtime-preview-debug.ts   web only — no studio on mobile
```

- **The traced assembler is a one-line delegation to the plain one** (`buildChatGenerationRequestTraced`). That is
  the whole claim of this slice — enabling the debugger cannot change the request — and it is **structure, not a
  promise**. Two implementations would make "runs differently with the debugger on" representable, and that
  difference reaches only the creator who trusted the inspector and edited the manuscript on its evidence.
- **`selectLore` returns the traced selection's `selected`.** The extra allocation per turn is nothing next to
  building the prompt string, and in exchange there is no place for the two answers to diverge.
- **`buildSystemPrompt` returns named blocks, not a string.** Joining is one shared function
  (`chatSystemPromptText`) that the assembler itself goes through — so the inspector never has to split the
  finished prompt back apart. **A parser there would make a one-line change to the assembly order quietly wrong**,
  and a static scan blocks the shapes it would take (`debugger-boundaries.test.ts`).
- **The trace lives in memory and goes nowhere** — not IndexedDB, not SQLite, not the codec registry, not the
  server, not telemetry. One store per playtest session: when the session object changes the store is replaced, and
  **the in-flight generation's closure keeps the old one** — that is how a late result fails to attach to a new
  session, the same axis as the ownership check with a different net.
- **Caps drop the oldest and say so** (500 events, 20 turns, 40,000 characters per string). The studio console
  already settled that rule; silently dropping makes the list lie.
- **The correlation from a response to its turn comes from the store, not from a guess.**
  `appendAssistantMessage` returns the id it minted (`AppendedAssistantMessageId`); `void` means *this conversation
  does not answer that*, and then the screen says so rather than assuming the last row belongs to the last turn.
- **Exact usage and estimates are never conflated.** A provider-reported count carries `제공자 보고`; a
  character-based approximation carries `추정 · 문자 수 기반` and disappears the moment real usage arrives. Cache
  metrics are **never** estimated (there is no way to, and `0` would fold "did not hit" into "was not told").
- **Provider error text does not reach this surface.** `SafeGenerationFailure` has no `message` field, so the only
  sentence that can appear is the one our own failure table chose — the same conclusion
  `runtime-preview-generation-failure.ts` reached, in a place where showing the original looks like kindness.
- **The runtime lane reads messages that already cross the worker boundary.** No protocol field, no ordering
  change, no new save point. Before/after values come from diffing consecutive snapshots and a migration is a key
  whose version rose across hydration — and **pending mutations are honestly unanswerable** (a value that has not
  been committed never left the VM), so the panel says that instead of inventing one.
- **Tabs that this lane cannot answer stand anyway and say why.** Hiding them makes a creator read them as coming
  soon; what is there is a decision not to build them (a runtime work assembles no conversation prompt).
- **Do not add**: persistence of traces, upload, sharing, remote debugging, replay of historic production sessions,
  prompt editing from the inspector, or an unsafe creator mode. The safety path is untouched — the rating decision
  still goes through `resolveAllAges` and the debugger draws the result rather than deciding it.

## The creator runtime

**An optional extension layered onto a story**, with authoring, compilation, execution and publication living in
different packages. Every stage's decision record is in `docs/creator-runtime/` — what stays here are the
boundaries you would otherwise violate without noticing.

```text
authoring    DraftRuntimeProject + DraftRuntimeFile[]   the device's draft. E2EE synced
compilation  @rowcat/runtime-compiler                   source → diagnostics + artifact. **it does not execute**
execution    @rowcat/runtime-host                       an isolated WASM JavaScript VM. the reconciler is inside it
rendering    runtime-renderer-web · -native             applies patch bundles to their own trees
publication  the server recompiles                       it does not retain authoring source
```

### The authoring surface — a code project attached to a draft

Rationale in `packages/authoring/src/runtime.ts` and the `apps/web/src/features/runtime-studio/*` headers.

- **The studio has execution — outside this folder.** The preview's worker, VM and renderer belong to
  `features/runtime-preview` and this folder receives only a hook's handle. Do not build a second execution path
  there with `eval`, `new Function`, an `iframe` or a `Blob` URL — that detour is dangerous not for performance but
  for **privilege**: when someone else's code runs on our origin with our privileges, session cookies, IndexedDB
  and sync keys are all right there. A static scan blocks those doors by name.
- **Two records, not a field on the draft root.** Adding `runtimeEnabled` to `StoryDraft` changes `DraftFieldRev`'s
  shape so drafts already accumulated and payloads from other devices do not have that group — and above all, the
  overwhelming majority of drafts never turn it on while **every draft would carry that axis around.**
- **The project's identity derives from the draft id and does not reuse it** (`runtimeProjectIdFor`) — random and
  two devices that each turned it on leave two records with no basis to merge; the draft id verbatim and the
  server's primary key `(owner, id)` makes it **fight the draft record for the same row.**
- **Files have no `position` — order is the path.** Position numbers create a reorder operation that changes
  nothing, and sync's sibling normalization **starts editing the user's file names.** Sorting is not
  `localeCompare` (diverging by locale renders the same project in a different order per device).
  **There is no folder record** (a folder with no files yet is **screen state**, and vanishing on refresh is correct).
- **Turning off and deleting are different operations** (`setRuntimeEnabled(false)` does not touch files — merged,
  the common intent of "let me set this aside for now" becomes an irreversible manuscript deletion).
- **Turning on puts the project row and the starter file in one transaction.** Split, a project that is "on with no
  files" remains and **does not heal itself** (it cannot be turned on again, so the trigger to create a starter file
  never comes). If files already exist, nothing is created.
- **Do not build a second autosave path.** Code bodies are typing too, so they enter the existing queue as its fifth
  kind (`PendingKind.runtimeFile`). If the studio called the store directly, screen-collapse handling, account-switch
  decisions and navigation blocking would not apply to that path, and that absence shows up as **someone who closed
  a tab losing the last few seconds.** `⌘S` does not create a save; it flushes the autosave already running.
- **There is one place with a turn-on operation: a section in the draft editor.** Opening the studio address on a
  draft where it is off **sends you back to the editor** — quietly turning it back on here shows whoever turned it off
  that their action was undone.
- **Monaco is pulled in by value in one place** (`monaco-setup.ts`). The workers are **bundle assets** —
  `@monaco-editor/react`'s default loader fetches from a CDN, which leaks the viewer's IP to a host we do not
  control. `typeAcquisition` is off too (this product has no npm install).
- **⚠️ `@rowcat/runtime`'s declarations are no longer an ambient string.** For a while there was a hand-written
  `.d.ts`, and the flaw in that structure was not abstract — its `JSX.Element` was `unknown`, so
  `<Screen><Text/></Screen>` was not assignable and **the starter project opened wearing red squiggles.** What the
  editor now layers on are **the very files** the compiler places in the virtual file system.
- **Pane widths are a device's taste, so they live in `localStorage`** (not in the draft, not in sync). The minimum
  exists **to prevent an unrecoverable state** (a pane at width 0 has no handle to grab, and that value is persisted).
- **Do not put `role="tree"` on the explorer — that absence is a decision.** ARIA's tree comes with a whole
  convention (every item takes focus, arrow keys traverse the hierarchy, roving tabindex reduces Tab order to one).
  Implementing half of it means assistive technology users meet **a tree where the convention they know does not
  work**, which is worse than a list. It is a list today, and the hierarchy is stated by each row's accessible name
  carrying **the full path.**
- **Motion attaches to explanations of state, not to geometry.** **Monaco's file switch, the resizer, and pane width
  and height are instant** — that geometry is the editor's box, and interpolating it makes Monaco re-measure
  throughout the transition.
- **Do not draw three panes at once on narrow screens** — not hidden, **not drawn** (hiding with CSS keeps an
  invisible editor alive, and Monaco mis-measures its own geometry at width 0).
- **There is no studio on mobile**, and there are still tables and a store implementation for the same reason as
  scene images: without them, code written on a Mac does not reach that device, and worse, **that device's next push
  uploads the draft in a code-less state.**
- **Compilation results, bundles, source maps and publication artifacts are stored in no draft.**

### Runtime starter templates — a chooser, **copied at creation time**

**Six sets of authoring source, not six kinds of story**
(`packages/authoring/src/runtime-templates/types.ts`, `apps/web/src/features/runtime-templates/*`).

```text
turn runtime on (first creation) → gallery (not one character is written to the draft while choosing)
  → instantiateRuntimeTemplate (pure) → enableRuntime(draftId, starter)  ← **one transaction**
```

- **A template is not a runtime dependency.** There is no `story.runtimeTemplateId` and no path that loads a template
  at playback time — with one, that folder becomes **an execution condition of published work**, and a commit
  deleting one template breaks stories already published. The single source of truth for runtime source is
  `DraftRuntimeFile[]`. **That is why templates have no versions** (a `Messenger v2` leaves projects already created
  unchanged — editing a string here must not be editing someone else's manuscript).
- **There is one original of the starter file** (`defaultRuntimeStarter()` = the `blank` template). Surfaces without
  a gallery (mobile's `enableRuntime`) go through that function too. **The store does not know the registry** —
  `enableRuntime` receives **an already-instantiated value**, not a template id (a half-committed template is a
  project that does not compile, and the user inherits a state they did not choose).
- **The gallery stands only on first creation.** A draft that already has a project **does not even mount** that
  dialog — gated by `open` alone, the dialog is in the tree, and the moment a single path opens it, it becomes an
  operation that overwrites someone's files. The last line of defence is the store's idempotency.
  **Choosing saves nothing** (so the gallery's state layer has no store, no hook and nothing async).
- **A selection made invisible by a category change moves to the first item** (left as is, the confirm button creates
  a template not in the list and the user cannot trace it).
- **Drawing a card is not running creator code.** Thumbnails are **our own trusted markup**; we neither execute nor
  screenshot (executing turns opening the gallery into loading the compiler and a WASM VM, with five VM sessions on
  one screen; PNGs do not follow the theme and are not re-shot when a template changes). **The art table is a
  `Record<RuntimeTemplateId, …>`, so a seventh breaks compilation.**
- **Cards and filters are ordinary buttons with `aria-pressed`** (`role="radiogroup"` also demands roving tabindex
  and arrow keys — the same judgement as not putting `role="tree"` on the explorer). The chosen state is not stated
  by colour alone.
- **The detail panel only enters.** Wrapped in `AnimatePresence mode="wait"`, the new child does not mount while the
  outgoing one withdraws, and **the panel stays one step behind the selection.**
- **Template source is not on the screen** (with starter bodies as strings inside TSX you cannot answer whether the
  registry or the screen is the original, and that copy passes neither the registry test nor compilation validation).
- **Do not keep examples that only look valid inside a string.** All six pass **the real compiler** and **mount in
  QuickJS**, and the four focused templates are verified by value down to what changes when pressed. The wiring is
  one file (`apps/web/src/test/runtime-template-harness.ts`) — that is the assembly point because `@rowcat/authoring`
  does not know the compiler. **Templates use only APIs that run today** (a hook name that does not exist yet breaks
  the registry test first — a creator who reads that name reads it as coming soon, and that is a promise without a
  date).
- **Do not write extensions on relative imports** (the runtime's resolution order is `./x` → `x.ts`, `x.tsx`, so
  `./x.ts` looks for `x.ts.ts` — **the opposite** of this repository's rule, so it is pinned by value).
- **`Blank` is first and there is one recommendation** (the flagship; if everything is recommended, nothing is).
  **There are two kinds of template** — the five focused ones each teach one technique, and the flagship uses all of
  them **inside one story.** Neither replaces the other (deleting `Messenger` because the flagship also uses free
  input would force someone who wants to learn that one technique to read thirty-five files). Full rules in
  `docs/creator-runtime/templates.md`.
- **Two templates use generation** (`Messenger` and the flagship) — if browsing the starter templates itself cost
  money, creators would come to fear the gallery. Both stand with the preview's AI toggle off, and the first request
  is always one a person pressed.
- **`asset()` and `Image` are absent from templates too** (the resolver still returns `null` for logical assets, and
  while remote HTTPS addresses do render, a template cannot hold someone else's CDN address — that address's lifetime
  is not ours).
- **There is no search field** (six items are faster to scan than to search). **The dialog does not close while
  creating and failures stay inside it** (a second press on the same tick is blocked by a **synchronous latch** —
  `pending` is `setState` and is too late).
- **A template marketplace, remote templates, a version updater and component insertion are not this slice.**

#### The flagship — `데뷔까지 여덟 주`

```text
useState             open tab · the slot being filled · input field · waiting   gone on restart
useStoryState        this debut group — week · stats · condition · trust · sync  reset when you start over
usePersistentState   what you learned about the five · endings seen · best score survives 플레이 초기화
```

- **The three lifetimes are the story's device — that is why this subject was chosen.** A manager takes a group of
  five trainees through the eight weeks before their debut evaluation. **The third lifetime holds no stats**: the
  next group starts from zero skill and zero trust, and the only thing that carries over is *what you came to know
  about those five people*. Without that asymmetry this is an ordinary raising sim that gets stronger each run.
- **The evening has one entrance and it is the input line.** There are no prepared questions. What you ask is your
  own sentence, and **code decides what that sentence touched** (`matchTopic`, `systems/topics.ts` alone). The screen
  offers observations, never questions — write the question down and that line becomes a button again. **The order is
  the whole design**: the note opens *before* generation, so a refused provider still leaves what you learned, and the
  work moves forward with AI switched off in the preview. What the model does is carry an already-decided fact in that
  person's voice; ask for something they are not ready to tell and **they deflect** (`Topic.deflect` goes into the
  instructions — the screen never prints `잠김` there, because what is locked is not a choice but a thing that person
  does not want to say yet).
- **AI is at the centre and the ruling is still code's** — those do not conflict, because what code reads is **user
  input**, not the model's answer. Keyword opening is the shape this repository already uses for lore, and it has the
  same property: the same sentence always gives the same result. Keywords stay short stems and there is no morphological
  analysis; instead the observation's own words are in the keyword list (the screen says `일곱 해째다`, so `일곱` opens it).
- **Knowing is the lock, and it spans runs.** Each member has three stories and **the third needs the first two**;
  the lock layers two axes — trust is rebuilt every run, notes survive. So one run of eight evenings reaches one or
  two members, and **the eight weeks of someone who already knows are different eight weeks.** Weekly events stay
  choices (a decision, not a conversation) and a locked one does not disappear; it spells out what is missing. Both
  entrances — the event's choice and the evening's sentence — go through **the same `requirementMet`**; split them and
  only one of the two reads persistent state.
- **The weekly settlement is one pure function with no randomness** (`settleWeek`), which is why the planner can
  show the resulting score **by running the real settlement once**. Writing a separate estimate makes the preview
  and the outcome diverge, and a diverged screen reads as a lie. Repeating an activity in one week earns 60% then
  30%, and a member below 30 condition learns half — those two are what make three slots a decision.
- **One function decides the ending** (`resolveEnding(run, career)`) — it takes two arguments because the hidden
  ending reads what carried over. The order is the rule: fail first, then **the narrowest door first** (reversed,
  someone who knows all five is caught by 「다섯이서」 and never sees the hidden one).
- **Every function that changes state lives in `systems/`.** The generation hook is where the order stands:
  save my line → judge the topic → then call the provider (`use-member-reply.ts`).
- **There are no borders and no shadows in this runtime, so depth is made by stacking surfaces**
  (`components/panel.tsx` — `padding: 1` on the outer surface *is* the stroke width) and bars are drawn from two
  `grow` ratios rather than `width: "%"` (transitions do not cover layout axes). That a scene changed is said by a
  **transition** (`components/reveal.tsx`) — the first template in the gallery to use that API.

### The runtime compiler — from source to artifact, **with no execution**

```text
runtime TS/TSX source → path and module resolution → a TypeScript program (no DOM, no Node, no React)
  → diagnostics (syntax + semantics + RowCat policy) → emit (ES modules + source maps) → RuntimeArtifact v1
```

- **⚠️ Policy checks are not a sandbox.** Blocking `eval`, dynamic import and npm imports buys fast feedback and a
  deterministic language policy, not isolation. There are plenty of ways around it (`globalThis["ev"+"al"]`), and the
  real security boundary is the isolated WASM JavaScript VM. **Do not write the sentence "the compiler blocks it, so
  it is safe" in code or in product copy.**
- **⚠️ There are two TypeScripts in this repository, and that is intended.** The root's `typescript@7` is **tsgo**;
  it type-checks the repository but its public API **has no JS emit.** So the compiler pulls in 5.9.3 separately under
  the **alias** `typescript-compiler-api` — the alias is the point: leaving the name as-is makes that package's `tsc`
  shadow the repository's, and this one package gets checked by a different checker with nobody knowing. **The version
  matches what Monaco ships.**
- **The engine sits behind one file, `typescript-host.ts`.** Measured (201 files): cold 307ms, program reuse 192ms —
  **the owner of the speed is `oldProgram` reuse, not the engine.** **Do not port it to Rust** — the dominant cost is
  type checking (142ms) against 49ms of emit, and Rust has **no usable TypeScript type checker.** Replacing emit alone
  gains about 20% and loses rejecting `<div />`, blocking DOM leakage and entry-point type checking, all of which are
  type decisions.
- **Runtime components are not React components** — a primitive's identity is a **symbol**, not a function name (a
  reconciler that decides by name reads every element in a minified bundle as unknown, and that failure does not
  reproduce in a development build).
- **The JSX namespace has one owner: `@rowcat/runtime/jsx-runtime`** (an empty `IntrinsicElements` is the whole of
  what blocks `<div />`, and `ElementType` is what lets a component returning a single string pass).
- **Do not inherit the app's tsconfig** (`types: []`, `lib: ["ES2022"]`) — inheriting brings in React and DOM
  declarations so `<div>Hello</div>` **passes**, and that code has nothing it can draw inside the VM.
- **Do not create a second original for the declarations** — what the tooling reads is **the runtime package's actual
  source** (`@rowcat/runtime/declarations`), and a generator plus a committed artifact plus a check that regenerates
  and compares keeps it fresh. The copy **strips only `.ts` from relative imports** (`allowImportingTsExtensions`
  also demands `noEmit`, which is incompatible with emitting). **Placing it in `node_modules` is the same axis** (a
  `paths` alias gives editor and compiler each their own alias table with a place to diverge). **There is one root
  too** (`RUNTIME_VIRTUAL_ROOT` — diverge and only the editor cannot find `@rowcat/runtime`, with a red squiggle on
  every file's first line as the symptom).
- **The editor's compiler options come from the compiler** (`runtimeCompilerOptions()`) — when a hand-transcribed
  copy diverges, the symptom is **code autocomplete allowed being blocked at compile**, and no test breaks (both are
  right by their own config). There is exactly one axis that diverges, and it is intended: the editor is `noEmit`.
- **Pin the resolution order** (`.ts`, `.tsx`, `/index.ts`, `/index.tsx`) — differing per deployment makes the same
  manuscript a different program per device.
- **Bare names are an allowlist of three** (`@rowcat/runtime` and its two JSX runtimes).
  `@rowcat/runtime/internal/dispatcher` is rejected **even though it really is in the virtual file system** —
  existence and permission are different questions, and policy standing before resolution makes that distinction
  structural. **Dynamic `import()` is blocked even for local files** (the module graph must be fully known at compile
  time for the loader to instantiate only a pre-built graph = arbitrary code cannot be introduced later).
- **The policy pass does not prove data flow, and it errs toward blocking** (err the other way and the creator
  believes the code is permitted and builds a project on it, which the VM then blocks wholesale).
- **A planted file asks about the entry point's type** (`.rowcat/entry-check.ts`) — walking symbols by hand makes that
  comparison a copy of the checker, and the copy alone goes stale the day `RuntimeApp` changes. That file is neither
  emitted nor included in the artifact. **Diagnostics from outside the project are not the creator's problem**
  (diagnostics from the runtime package or planted files are raised as **infrastructure failure**, not drawn in
  `Problems` — drawn, the creator hunts for the cause in their own code).
- **No device enters the artifact's identity** (neither draft id, file record id, `updatedAt`, HLC revision nor
  `dirty` has a slot in the canonical bytes), so the same manuscript arriving on another device through sync gives
  **the same hash.** Input array order, path separators and line endings are folded by canonicalization too.
- **Module ids are the source paths verbatim** (`src/main.tsx`, not `.js`) — that id is the key by which diagnostics,
  source maps and stack traces trace back to the creator's file. A builtin's resolved value is a **controlled
  identifier** (`rowcat:runtime` — a loader handed something that looks like an npm name will eventually try to
  resolve it like npm).
- **The compiler's version is not the package version** (`RUNTIME_COMPILER_VERSION` — a TypeScript patch can change
  emit without that value rising on its own, so a test pins that version by value).
- **The studio uses only the analysis pass** (`analyzeRuntimeProject`) — type diagnostics are already produced by
  Monaco, and producing them again here would require shipping the whole `lib.es2022.d.ts` family in the web bundle.
- **Compilation and autosave are different axes** (a syntactically broken intermediate state is **the normal state**
  of typing, and refusing to save at each of those loses the last few minutes the moment the tab closes). That is also
  why the header draws the two states side by side without folding them into one value — folded, `검사 실패` reads as
  "not saved".
- **A late-finishing compile does not overwrite the newest result** (when it did, the symptom **disappeared the moment
  you typed the next character**, so nobody could reproduce it). The rule belongs to a pure reducer
  (`runtime-compile-state.ts`).
- **`Problems` is one list** (when positions collide RowCat's decision wins — TypeScript's "cannot find module"
  implies a remedy this product does not have: npm install).
- **There are two copies of the path rules and a test guards their equivalence** (a compiler that imported
  `@rowcat/authoring` would drag in contracts, domain and zod, and the server would carry that weight when it runs the
  same validation at publication time). The comparison lives at the **assembly point**
  (`runtime-path-parity.test.ts`).

### Two narrowings in the runtime language contract — asset references and colors

**Widening is always available; narrowing breaks projects already stored** (`packages/runtime/src/asset.ts`,
`color.ts`).

- **`Image.source` is a reference, not an address** (`AssetRef`). While it was a `string`, arbitrary remote URLs,
  `data:`, `javascript:` and relative paths were all part of runtime API v1, and rejecting them later is a **narrowing
  change.** What the contract carries now is one reference, so scheme policy, IP exposure decisions and caching all
  stay **with whoever owns the asset.**
- **The claim that the reference is opaque is true in the type too** — its only property is a symbol key the creator
  cannot name, and none of `ref.url`, `ref.id` or `ref.path` is **representable.** The two opening functions are not
  exported from the root (if a creator can call them, the reference is just a wrapped string and the next person starts
  concatenating).
- **`asset()` looks at neither network nor storage, and it takes two shapes**: a logical path and a **public HTTPS
  image URL**. All it does is one deterministic local check (it does not even use `URL` — that is absent in the VM and
  lenient where present) and rejection is a named code (`runtime_invalid_asset_ref`). One scheme is allowed
  (`https://`), the host must be a domain name, the port is 443 only, credentials, fragments, whitespace and control
  characters are rejected, and the length cap is **a different value** from the logical path's (signed CDN URLs exceed
  200 characters). The decision is `classifyRuntimeAssetValue` alone, and both renderers and the server call **the same
  function.**
- **Do not pre-reserve namespaces** (`characters/` and `music/` are not keywords). We also do not accept media
  database ids directly (accepting them binds this contract to our store's identities).
- **⚠️ `RuntimeColor` cannot be counted in the type — a measured fact.** Counting digits with template literals
  multiplies the union to 22^6 ≈ 110 million, and TypeScript **cannot represent** that type (`TS2590`; confirmed on
  both tsgo and 5.9.3). Only three digits are representable, and a contract that takes three digits as a literal while
  demanding a function for six makes the same value written two ways. So validation moved to **the call site** —
  `color("#ff00aa")`.
- **That validation is done by a recursive conditional type and creates no union.** Not using `never` as the failure
  marker is the easiest thing to get wrong — `never extends 3 | 6 | 8` is **true**, so an invalid color passes (in the
  first implementation `"#ggg"` really did).
- **A dynamic string cannot enter `color()`** (one overload taking `string` drops wrong literals onto the wide side and
  disables the check entirely — the path for computed colors is one predicate, `isRuntimeColor`).
  **The type is not the boundary** (a value that passed `color()` is checked again at runtime, and the host checks it
  once more on top).

### The studio's check state — two inputs, one answer

```text
Monaco worker      syntax · types · module existence   ┐
runtime compiler   entry point · resolution · forbidden syntax   ┴→ one Problems → one Compile sentence
```

- **⚠️ Do not build the check state from the runtime analysis alone.** While it was, the screen contradicted itself —
  `Problems` held TypeScript errors while the header drew `이상 없음`. A full compile passes through type checking, so
  that project does not emit, yet the summary promises it passes. That contradiction raises no error and creators
  mostly believe the summary.
- **The decision comes from the list `Problems` actually draws** (`deriveRuntimeCompileView`) — counting markers and
  diagnostics separately makes a state where `Problems` has one row while the summary says two representable.
- **Warnings do not block eligibility, nor do they fold into `이상 없음`** (the copy forks to `경고 N개`). The
  editor's `info` enters neither count. **Do not draw the unknown as eligibility** (before the check finishes,
  `eligible` is false even while counting — Monaco's worker does not wait for our debounce, so drawing `문제 N개` from
  half of it makes the number jump once more every 250ms).
- **The checker's own failure does not fold into a count** (`검사 실패` stands first because it is not something the
  creator can fix). **Type checking did not move into the studio** (pulling a full compile onto the main thread to fix
  a label ships the whole `lib.es2022.d.ts` family in the web bundle).
- **The edit signal is structurally unambiguous** (`runtimeCompileSignature`) — while it concatenated,
  `[{a, "b c"}]` and `[{"a b", "c"}]` were **the same string**, and in that collision the analysis does not run while
  the screen keeps drawing the previous diagnostics (it heals itself on the next character — nobody reproduces it).
  **It is not a hash** (the question it answers is *must the effect run again*, and the artifact's identity belongs to
  the compiler's canonicalization).
- **No store axis is in that signal** (the input is `{ path, content }` only, so there is no slot for id, revision,
  `dirty` or `updatedAt` — with them, one metadata change applied by sync re-runs the analysis). **List order is not
  a signal either.**

### Runtime execution — isolation, boot, scheduler, root

```text
RuntimeArtifact v1 → validate → create VM (a WASM instance per session) → install prelude and builtins
  → install the generated rowcat:runtime → evaluate the creator ESM graph → mount the root
  → reconciler (inside the VM) → one patch bundle → host validation → onCommit
```

- **The only input is the artifact** (`runtime-host` does not pull in TypeScript and does not compile — the one path
  from TSX to the VM is compiler → artifact → host). **The engine's name ends in one adapter file**
  (`vm/quickjs.ts`; the session sees only `RuntimeVmEngine` and the root does not re-export the adapter). The engine
  choice is **provisional.**
- **⚠️ The reconciler is not trusted host JavaScript.** Creator component functions, hook state and handler functions
  do not leave the VM. What the host receives per commit is **one patch bundle** (JSON) plus task requests and
  diagnostics; what goes in is handler numbers and wire values. Do not build a shape where "the VM sends element
  objects and the host reconciles" — at that moment creator code becomes objects in our realm.
- **Values cross only as wire strings** (`wire.ts`) — only what JSON represents is accepted, and `undefined`,
  functions, symbols, `Date`, `Map` and cycles are deterministically rejected on both sides. **⚠️ The host's symbols
  are not the VM's symbols** (the sandbox's `rowcat:runtime` is a runtime instantiated inside the VM realm, and what
  the host receives is a serialized value, not an object).
- **The output channel is not a capability** — patches do not cross per operation like `hostCall("ui.setProp", …)`.
  There is one more synchronous channel on the bridge (`emit(channel, json)`) whose answer is just "received"
  (the native WebView bridge costs milliseconds, so crossing per operation makes one screen take seconds).
- **⚠️ `setMemoryLimit` does not work in this build** — QuickJS's allocation accounting relies on
  `malloc_usable_size` and the Emscripten build does not provide it (under an 8 MiB limit the VM grew to 2 GiB;
  measured). So we **create a fresh WASM instance per session** and use `WebAssembly.Memory`'s `maximum` as the limit
  (floor 16 MiB). That instance also gives one layer of isolation between sessions.
- **⚠️ The stack limit is set by the host's thread stack.** WASM frames pile onto the host's native stack, so a large
  QuickJS limit lets a host `RangeError` escape and corrupts the runtime. Per-platform limits live in the table in
  `vm/stack-limits.ts` (all **128 KiB**, measured on four platforms). A commit raising that value arrives with the
  result of re-running the stack probe on that platform's harness — overflow's symptom is not an exception but a host
  `RangeError` and a corrupted runtime, which tests do not catch. It is not a creator setting.
- **Do not disable the `Eval` intrinsic** (disabling blocks module source evaluation itself). Dynamic code is blocked
  by the prelude deleting `eval` and `Function` and replacing the four function constructors with throwing functions —
  but **that is not isolation** (isolation is the VM itself).
- **`rowcat:runtime` is not a hand-written stub but JS generated from `@rowcat/runtime`'s source** (two
  transformations only: erasing types and rewriting relative imports to module ids). **It is not bundled** (inside the
  VM it must also be a static ESM graph so the loader runs by the same rules). Everything but the public trio is
  `rowcat:internal/*`, and that prefix *is* the policy (an artifact pointing at such an id is rejected at validation).
- **The host hand-writes two builtins**: the bridge and port installation. There is no large object injection such as
  `globalThis.__rowcat = host` — runtime source does not import the bridge (the runtime does not know the host), the
  slot through which the root emits commit bundles belongs to runtime source, and only the installation module that
  fills that slot with the bridge imports both.
- **Three compatibility identities are compared by boot before the VM is created**: the language contract's version,
  the generation rules' version, and the original source's digest. One mismatch gives
  `runtime_sandbox_incompatible` and **the VM is not even created.**
- **The boot order belongs to a plan** (`planRuntimeBootstrap`): identity → bridge → generated runtime (internals
  first) → port installation → additional builtins the session installs → delete the bridge global → creator modules
  (entry point first). Three places where the order earns its keep: the bridge before the runtime, port installation
  after both, and creator modules after deleting the bridge global.
- **The dispatcher slot is filled only during render** (what fills it is **the reconciler itself**, and outside render
  it is `null`, so hooks throw deterministically — `runtime_hook_outside_render`).
- **The scheduler has four priorities and they are RowCat's vocabulary** (`immediate`, `userBlocking`, `normal`,
  `background`). Neither React's scheduler package nor its constants are pulled in. Within a priority it is **FIFO**,
  and a task that re-queues takes a new sequence number and goes **to the back** (a long promise chain cannot
  monopolize the queue). **`enqueue` does not turn a turn on the spot** (draining starts one microtask later and
  there is one loop — so there is no path where VM → host → VM recurses on the native stack).
- **A turn's interrupt deadline is the earlier of the execution budget and the session budget, and the slice only
  decides whether to start the next turn.** While the slice was also in the deadline, one render by the synchronous
  reconciler exceeding a frame (a 3,000-node mount really did) killed an ordinary story session-wide — a turn cannot
  be continued, so cutting it is the session's death. **The deadline and the clock must share a basis** (the slice
  carries `now()` along and the adapter does not read `Date.now()` directly — mixed, the deadline is always in the
  past and the first interrupt check cuts).
- **Yielding is one clock port** (`RuntimeHostSchedulerClock`) — the core does not choose
  `requestAnimationFrame`, `requestIdleCallback`, `postTask` or `setImmediate`, and the default is `setTimeout(0)`
  (the web worker and the WebView harness plug in a `MessageChannel`).
- **Failures have two weights** (`failureSeverity`) — budget, cancellation interrupts, memory and the engine are
  **fatal**, so the session becomes `failed` and the only remaining operation is `dispose`; creator exceptions,
  rejections carrying a host code and lookup failures are **recoverable**, so only that execution is rejected.
- **Disposal comes before ordinary work**: mark cancelled → drain the queue → abort open host calls → reject pending
  executions → wait for the last turn to unwind → free the VM. Completions arriving late are discarded.
- **Commits are atomic** — render only **reads** the previous tree and builds the next one fresh. The plan (patches)
  applies nothing, and only **after** the host has received the bundle do instance commit, handler release, unmount
  and effect registration happen. If render throws or the host rejects, the previous tree remains authoritative.
- **Render does not consume committed hook slots** (it reads and folds the state queue without draining it, writing
  into the work slot — the queue is drained in one place, the commit). Setters capture (instance, index), not the slot
  object.
- **The runtime enforces the Rules of Hooks** (a changed hook count or kind gives `runtime_hook_order_changed` on the
  spot). **Do not re-interpret the slots** — re-interpreting seats a `useMemo` value where a `useRef` was, and that
  screen is wrong with no error.
- **A state update during render is a rejection.** A setter for a component that is gone leaves one warning and is
  **ignored** (one late async callback must not kill the runtime). An update to the same value (`Object.is`) produces
  no render, and there is no structural equality comparison. **There are no async components and no Suspense.**
- **Identity rules**: under the same parent — with a key, `(key, kind)`; without, `(position, kind)`. Position is the
  index in the flattened list **where empty values still occupy a slot** (the `C` in `[A, cond && B, C]` is always
  index 2 — counting after removing empties makes conditional rendering erase the next sibling's state). A duplicate
  key is a **warning** and the later one is decided by position. Kind is the function's identity, not its name.
- **Host node ids increase monotonically within a session and are never reused** (the renderer may still hold the old
  tree, and if the same number points at a different node the wrong node is edited in that window). `0` is the
  synthetic root.
- **Handlers are numbers and identity is the function's identity** (the same function keeps the same number by
  refcount; a changed function gets a new number and releases the old one). Numbers are not reused — a stale event
  cannot call **a different** handler, and an event on a stale number is not a failure but
  `{ handled: false, reason: "stale" }`.
- **Scheduling belongs to the host** (there is no timer and no microtask in the runtime root). When a redraw is
  needed it **requests** one `"render"` task through the port (a flag, so once), and effects run `background` after
  the commit.
- **The batching rule is one line**: updates within the same scheduler **execution** fold into one render (what
  becomes a different execution is a continuation after awaiting a host capability call, and an update inside an
  effect). We do not imitate React 18's automatic batching.
- **An exception in an effect is a diagnostic** (only that effect is lost). An exception in render is **an execution
  failure**, and `CreatorExecutionError` carries `runtimeCode` and `componentStack` (the names are for diagnostics and
  are not a basis for identity). **The reconciler does not count effect update loops** — what breaks that chain is the
  host's **session budget** (we do not invent an arbitrary number).
- **Limits end a commit, not a session** (depth, node count and patch count are counted first by the VM and again by
  the host from the bundle; bytes only the host knows — read from the string length **before parsing**).
- **Hook state belongs to the session and is stored nowhere** (the VM heap is not a save format).
- **The test consumer is strict** (`TestHostTree` throws on a missing node, a duplicate id, a reused id, a skipped
  revision, or a move to a parent that does not have it). Accepting leniently turns a protocol defect into "the screen
  is sometimes off" in the renderer.
- **There are two harnesses and neither is product UI** (web `/runtime-vm-lab`; a section of mobile's `/dev-tools` —
  Hermes has no WebAssembly, so it is **a VM inside a WebView**).

### Two renderers — the same patch bundle to DOM and React Native

**There is still one reconciler.** Do not move the bundle into React state and rebuild an element tree — at that
moment node identity, key moves, handler identity and atomic commits are decided once more under React's judgement.

- **There is one sentence about isolation: creator JavaScript runs only inside QuickJS/WASM.** The worker, the shadow
  DOM and the hidden WebView are boundaries of responsiveness, style and execution realm respectively, and **none of
  them is isolation** (do not write "it is inside a worker, so it is safe" in code or copy).
- **The web renderer is imperative DOM and one host node is one DOM node** (all React owns is the preview's shell, and
  the browser journeys break the moment React starts drawing below that element). **On native the host node id is the
  React key** (ids are never reused, so key reordering moves the same component — using a position index as the key
  destroys that property entirely).
- **One bundle is one notification** (a commit with fifty patches calls subscribers once, and each node reads its own
  revision as a snapshot so React folds away the places that did not change) — moving a commit into several
  `setState` calls either shows intermediate states on screen or renders once per patch.
- **Native atomicity is an undo journal** (rather than copying the tree, it stacks an undo function per operation and
  runs them in reverse). **A failed bundle raises no node's revision, so subscribers never observe it.**
- **Revisions are strict and failure is a stop** (received only in order from 1, with duplicates, skips and
  regressions never patched over by guessing — there is no backfill protocol). A failed renderer receives neither
  bundles nor events, and the only way back is `reset()`.
- **Props are one table per kind and one hand per name.** `setAttribute(name, value)` and `element[name] = value` are
  absent from the renderers — with those two lines, runtime props become authority over the whole DOM (`onclick`,
  `srcdoc` and `href` open through one prop name). Native has **no JSX prop spreading** for the same reason. A prop
  not in the table, a style of the wrong shape, and a color that is not a color are **contract errors** and do not
  reach the tree (the type is not the boundary; `isRuntimeColor` is checked again).
- **`{ "$asset": value }` is not an address — not even when it is a remote address.** Only the resolver's answer
  becomes `src`/`source`, and the asset string never sits there under any circumstance (what the resolver receives is
  not a string but **a classified kind**).
- **An explicit `gap` prop beats `style.gap`** (we do not leave it to the browser's assignment order, and **both
  renderers use the same rule**). Every box primitive being `display: flex; flex-direction: column` is the same axis —
  matching RN's `View` default is what makes `grow`, `justify` and `align` mean the same thing in both renderers.
- **`move` does not delete and recreate a node** (`moveBefore` where available; otherwise `insertBefore` plus focus
  restoration) — `insertBefore` detaches and reattaches, so the browser takes focus away, and losing focus on the
  active button at every key reorder is, for a keyboard user, starting over each time.
- **Buttons are `<button type="button">`** (do not build `<div role="button">` — the browser gives keyboard
  activation, focus and disabled semantics, and a screen that hand-misses one of them raises no error). `outline` is
  not globally disabled and `:focus-visible` is in the base sheet.
- **Events are one delegated listener at the root** (no closure attached to a DOM node per `onPress`; handler numbers
  live in record metadata). What goes out is one integer, and `MouseEvent`, coordinates and `currentTarget` never
  leave that function.
- **Only `#text`'s placement is decided by the platform** (React Native cannot draw a bare string under a `View`, so
  under `Text` it is the string verbatim and elsewhere a `Text` leaf the renderer owns). **The patch protocol did not
  change for this** (raising it into the protocol puts an operation the web renderer never uses into the contract).
- **Theme variables are host configuration** (`--rowcat-runtime-*`) — the app transcribes RowCat tokens into the
  preview host and creator code has no way to read or change them. We do not use `@rowcat/ui-web`'s token names
  because the renderer does not know that package. **There is no creator CSS.**
- **The bridge has one vocabulary and two implementations** (the PoC diagnostics and the runtime session use **the
  same channel and the same discriminant** — split, the numbers diagnostics measure are not the production path's).
  Android uses `WebMessagePort`, iOS `react-native-webview`. **There is no silent fallback**: an Android that failed
  to stand up the port falling back to `injectJavaScript` makes that deployment's measurements false.
- **The WASM and the harness are app assets** (there is no base64 runtime string in the JS bundle, and bytes do not
  ride the bridge as base64 — the harness fetches sibling files from **the same origin** as its own document).
  Freshness is guarded by `pnpm runtime-vm:harness:check` **comparing bytes.** **Mobile is the playback side**
  (neither the TypeScript compiler, Monaco nor a code editor comes to that app — a static scan locks it).
- **⚠️ The 32ms gate on a low-end Android physical device is still UNVALIDATED.** The instrumentation stands, but do
  not use simulator or emulator numbers as that answer. Do not record it as passing without a device measurement.

### The studio preview

```text
creator TSX ─▶ worker: compiler → artifact → QuickJS/WASM → reconciler → patch bundle
                                                        │ postMessage(JSON) + generation number
main: runtime-renderer-web ─▶ shadow DOM ◀─ press ─▶ handler number ─▶ worker
```

- **The worker is the compilation authority** (the studio's check state is an **early gate** that enables the run
  button, and the worker re-runs `compileRuntimeProject` — on failure it does not create a VM and does not quietly run
  the old artifact). The default libraries are bundle assets (Vite `?raw`) and the digest is a pure SHA-256, giving
  the same `sourceHash` as Node.
- **There is one place that pulls in the compiler, WASM and runtime-host by value: the worker.** The renderer pulls in
  **only `runtime-host`'s `patches` subpath** (pulling the root brings sessions, the engine and the generated sandbox
  string into the main bundle). The studio folder pulls in neither.
- **A generation number rides on every message.** When you start A, edit, and start B, A's late commit arriving at B's
  screen makes that screen wrong with no error at all. The main thread issues a monotonically increasing number, the
  worker echoes it, and a message with a different number touches neither state nor renderer. `start` and `stop` go
  through one chain (B's start waits for A's cleanup).
- **The creator's failure and ours are different sentences.** When render throws, the VM emits no new commit, so
  **the previous screen remains** and the error stands over it (clearing it throws away what atomicity bought). Fatal
  failures of the renderer, worker or VM stop the screen and demand a restart. Drawing both the same way makes the
  creator try to fix their code for our failure. Host file paths, worker stacks and engine internals do not reach the
  screen.
- **It does not run by itself** (opening a draft is not running code — running is a button and stands only when
  eligible). **Staleness is a fact, not an operation**: when the source changes the running VM stays as-is (we do not
  build Fast Refresh — there is no way to carry hook state into new code), the screen writes `변경사항 있음`, and
  `다시 시작` becomes the primary action. The source snapshot is **the editor's current file list**, waiting for
  neither autosave nor forcing it.
- **The console is a capped list** (500 lines, dropping from the front and stating how many were dropped).
  `console.*` and runtime diagnostics land in the bottom panel's `Console` tab and are not mixed with Monaco's compile
  diagnostics (those are the code's problem; these are execution events). The values are JSON that already crossed the
  wire, so no method of a creator object is ever called.
- **Leaving stops it** (unmount sends `stop` so cleanup functions run, and kills the worker if there is no answer).
  The normal stop order is `unmountRoot` (cleanup functions) → `settle` → `dispose`; do not call `dispose` first.
- **Runtime errors arrive with source coordinates** (`PreviewErrorInfo.frames`). The worker keeps the artifact of
  the running session and maps the host's creator frames through each module's source map
  (`@rowcat/runtime-compiler/source-map` · `runtime-preview-frames.ts`); frames from host builtins or the engine are
  dropped, a frame that cannot be mapped keeps its file but no line (an emitted line number is never shown as a
  source line), and the studio opens a frame through the same `navigate` request a `Problems` row uses. The mapper
  is injected into the pure module because the compiler may be a value import in the worker only.
- **The editor's runtime section checks the saved files before publishing** (`runtime-saved-check.ts` —
  `analyzeRuntimeProject` on the stored files, not the editor snapshot). It is a **structure** check (entry, module
  resolution, forbidden syntax) and the copy says so; the server's compile of the submitted source remains the
  authority and the line never locks the publish button.
- **The preview writes nothing** (it touches neither the authoring store, publication, the playback API nor story
  visibility, and does not upload creator code to the server — a boundary check blocks it by name).

### Runtime durable state — three lifetimes

```text
useState             only for this runtime session   gone when the VM dies
useStoryState        for this playthrough            플레이 초기화 erases it
usePersistentState   long progress per member+story  **survives 플레이 초기화**
```

Full rules in `docs/creator-runtime/story-state.md` and `persistence.md`.

- **`useStoryState` is not an alias for `useState`** — two components reading the same definition see **the same
  value**, which is why the value lives in a registry inside the VM rather than in a hook slot, and the slot holds
  only a key and a setter.
- **One engine, two lifetimes** (the `internal/durable-state.ts` core plus two scopes). We did not make a copy because
  the things easy to get wrong in this machine — atomicity of pending values, the failure direction of migrations,
  canonical ordering, and an owned copy of the initial value — **must have the same answer for both.** With a copy
  only one gets fixed, and that divergence shows up as "progress disappears only in this lifetime".
- **The two definitions are different types** (branded symbols diverge, so both `useStoryState(persistentDefinition)`
  and the reverse are **blocked in the type** — which is the one line explaining why there is no alias such as
  `type PersistentStateDefinition<T> = StoryStateDefinition<T>`). **The key spaces are separate too.**
- **Definitions happen once at module top level and the registry seals before the first render** (a definition during
  render is a rejection, and so are two definitions with the same key — picking whichever ran first quietly
  establishes code that reads someone else's saved data). **The seal closes both registries together**, which is why
  there is **one** hydration call.
- **⚠️ The initial value must not narrow the state's type.** `initial: T & SerializableShape<T>` is an entirely
  natural declaration and Phase 1 really did that, but that intersection is **the source of inference**, so
  `{ trust: 40 }` becomes the literal `40` and `setStory` cannot change it. Inference happens from `initial: T` alone
  and the check is done by a **deferred conditional intersection.**
- **There is no async hydration** (a frame where the first render briefly shows `initial` and then switches to the
  saved value is a wrong screen).
- **Commits are atomic and the ordering is the structure of that promise**: preview the delta → emit the patches and
  get acknowledgement → emit the save delta → commit the tree and pending values together. Durable state going out
  **after** the UI is the expression of "if the patches are rejected, durable state does not advance either".
  **A render with no patches at all still commits durable state.**
- **The UI patch protocol did not change by a character** (durable state is a separate host contract and the two
  renderers do not know what it is). **There are two channels and the payload does not name the lifetime** — writing
  the lifetime into one channel as a word makes the host choose the store by that word, and one wrong direction of
  that decision is **플레이 초기화 erasing long progress.**
- **The snapshot has no scope** (`{ formatVersion, entries }` — no `storyId`, `userId`, `saveSlotId` or `deviceId`).
  Those values are the save coordinator's vocabulary for deciding **where** the snapshot goes. The representation is
  **key-ordered**, so the same logical state is the same bytes.
- **Do not delete unknown entries** (detaching a module briefly and reattaching it must not erase the player's
  progress — the only thing that deletes is one explicit 플레이 초기화).
- **Migrations run inside QuickJS** (the host has no reflection that traces back the creator's schema). Once per
  hydration, the result is validated, and **if it throws the session does not stand** — quietly discarding the save
  and falling back to `initial` turns the creator's migration bug into deletion of the player's progress. A stored
  version higher than ours is neither auto-downgraded nor reset. **The version cap became a property of the value**
  (a positive safe integer) — now that the version belongs to **the creator's schema**, the meaning "the version this
  runtime can read" is gone.
- **⚠️ Do not merge the save records into one.** `{ storyState, persistentState }` as one row is much shorter, but
  then device A's chapter progress and device B's ending unlock enter **one conflict domain** — a snapshot is an
  arbitrary value the creator defined, so merging can only be whole-record LWW, and under that rule one of the two is
  guaranteed to vanish. **A deep merge is forbidden too** (it leaves a state nobody ever created).
- **A reset is not a deletion but a newer state** (an empty snapshot at a higher revision) — deleting the row locally
  does not propagate that deletion, so a device holding the old progress resurrects it on the next sync. Hence the
  save port has **no `delete`.**
- **Identity is deterministic and does not reuse the story id**
  (`runtime-playthrough:<story>:<slot>`, `runtime-persistent:<story>`) — random and both devices' saves survive; the
  story id verbatim and it **fights the story record for the same row** under the server's `(owner, id)` primary key.
  The slot is in the id even though V1 has only one (removing it now changes the identity of already-synced saves the
  day slots grow).
- **The payload has no member, device or sync axis** (ownership is already decided by the local scope and the server
  session, and writing it again as a value makes that value look like authorization). Creator code cannot see `rev` or
  `dirty` either. **The server was not changed by a character** (no plaintext save route, no `runtime_save` JSONB
  column — what goes out is two opaque `sync_record`s through the existing envelope crypto).
- **The two atomicities are different boundaries** — a runtime commit does not wait on IndexedDB (a frame would be
  bound to store latency, and above all a save failure would require **undoing a render already drawn**). A save
  failure is the coordinator's state (`failed`) and the runtime keeps running. That window is **narrowed, not
  removed.**
- **Not a queue but one "the value we want now"** (a snapshot is the whole state, so the last one contains all the
  previous). There is one write per scope and the next starts after the previous finishes — that serialization *is*
  the guarantee of **never going backwards.**
- **"There is no save" forks three ways** (`ready`, `sync-required`, `failed`) — folding a freshly-paired device's
  "there is no row" into `ready` starts a new game on an account with months of progress, and that first commit
  overwrites the real save. **Local first** (with a valid local save we do not ask about the first sync).
- **⚠️ `initialSyncDone()` asks something broader than its name — "is there anything to wait for".** While it read one
  bootstrap flag, **an account that never configured sync had that value false forever**, and in that deployment the
  playback screen sat at `동기화 중` forever so **nobody could open a story** (browser journey 20 caught it first). A
  device that does not remember keys has nothing to receive and therefore does not wait — the web has that fact
  alongside the sync state row and mobile has it in SecureStore, so **the assembly point injects it.** One window
  remains and is accepted knowingly: the account has sync but **this device alone is locked.**
- **Do not overwrite a corrupted row** (on validation failure leave it and report the failure — a later recovery tool
  needs the original still there). **Migrations are made durable** (`sessionHydrated` — called **only after the
  session stands successfully**, and writing nothing when the value is unchanged).
- **The cap comes before the durable write** (256 KiB). The host's snapshot cap (1 MiB) may not fit inside the sync
  record's ciphertext cap, and deferring that failure to push makes it look to the user like "sync has been stopped
  for days". **Do not lower the runtime's cap to match this** (there is no reason the two questions must have the same
  answer).
- **The studio preview does not touch product saves** (the preview's snapshot is worker memory and vanishes on
  refresh, and a static scan keeps that folder from pulling in the save domain or Dexie). There are three operations:
  `다시 시작` (both carry over), `플레이 초기화` (playthrough only), and `긴 진행 초기화` (debug only). One pure
  function owns the decision (`runtimePreviewResetPlan`).
- **There is no durable save for guests** (a sync record needs an owner and that owner comes only from a session — we
  do not invent a fake one). **Do not snapshot the QuickJS heap** (what crosses is explicit durable state only; hook
  slots, closures, component instances, promises and module objects are not a save format).

### Interactive input and managed generation

```text
platform input → one string the renderer built → dispatchEvent → QuickJS's onChangeText → state
    ↓  the user confirms
useGeneration().generate(...) → host capability (authorization, validation, limits, cancellation) → RuntimeGenerationPort
    ↓  the trusted RowCat generation stack → host completion queue → the next VM turn → the creator puts it into state **themselves**
```

Full rules in `docs/creator-runtime/input-generation.md`.

- **The input contract is platform-neutral** — `onChangeText` receives **one string** and `onSubmit` takes no
  arguments (neither `KeyboardEvent`, `InputEvent`, `React.ChangeEvent`, `NativeSyntheticEvent` nor a native view
  reference crosses this boundary).
- **`value` is required — there are no uncontrolled inputs** (one more option gives "what is written right now" two
  owners, and that divergence surfaces **only at the moment of saving**). Without `onChangeText`, the renderer
  **reverts** what was typed.
- **⚠️ Enter during composition is not submit (P0).** Korean, Japanese and Chinese use Enter before confirming, and
  reading that as submit sends a sentence the user never sent. The web **looks at two facts together** — the
  composition state we track and the event's `isComposing` (neither alone covers every browser). On `compositionend`
  we **send the confirmed text first** and then align the controlled value (the other order loses the character just
  confirmed). **There is nothing to do on native** — that asymmetry is the only intended difference between the two
  renderers.
- **`TextArea` has no `onSubmit`** (in a multi-line field Enter is a newline, and that absence is the contract — both
  the prop table and the type reject the name). Do not add shortcuts. **A disabled input does not get wired at all.**
- **A commit with an unchanged value does not rewrite the element's value** (one unnecessary assignment resets the
  caret, the selection and composition — during composition we do not write at all).
- **Events go through the scheduler** (a platform callback does not enter the VM directly, a handler's identity is a
  **number**, and an event on a released number is not a failure but silently dropped).
- **A generation request has no provider, model, key, temperature, reasoning effort or streaming.** Those axes are
  decided by RowCat's product rules, and **the creator does not even know whether it is managed or BYO.** The result
  is one string too — token counts, cost, balance, model id and finish reason are not in that shape.
- **The creator's `instructions` are subordinate application content** (they sit **between** the safety guards, and
  that assembly goes through the one function conversation and BYO paths use — `applyPlatformSafetyPolicy`,
  idempotent).
- **⚠️ Generation starts only from a user interaction.** Only the `event` origin is authorized and every other origin is
  rejected — including **`media`**, which is `dispatchEvent` for an event the platform raised by itself (a sound reaching
  its end). The renderer names that source at the DOM or native callback (`RuntimeEventSource`), it crosses the worker
  and the native bridge as one optional field, and creator code cannot set it; folded into `event`, `<Audio onEnded>`
  could loop `generate()` with nobody touching the screen. The rest of this rule is unchanged — the fact that `useEffect` runs on every mount must not mean it is billed on every mount. The basis
  for the decision is **the name the host attaches** (`RuntimeHostCallContext.origin`), which the VM cannot forge, and
  a stage inside the VM cannot answer it (a continuation after `await` is `idle` but **the execution is the same
  execution**). **Authorization comes before validation** — behind it, the reason for rejection varies with the
  request's shape and becomes a detector.
- **Validation comes before the port and limits are applied twice** (the VM first, the host again). A rejected request
  **never reaches the provider.** Concurrency is **one** (making a double press deterministic) and the session budget
  is 200.
- **The error vocabulary does not differ by a character between host and runtime** (diverge and a translation table
  appears at that point, and eventually only one side gets fixed). **The provider's internals do not reach the
  creator**: a failure that did not state a reason is all `failed`, and the sentence is ours too. **A generation
  failure is not a session failure.**
- **⚠️ A named reason is not a passport for the original message — sanitization is two layers.** The host folds only
  exceptions **that did not state a reason**, so a trusted adapter attaching the name `failed` to an unknown exception
  while carrying `error.message` sends that sentence straight past the sanitizer into QuickJS's
  `RuntimeError.message` — one line of `401 … Authorization: Bearer sk-live-…` reaching creator code's hands (it
  really happened). So **we replace the sentence with ours at the very place the reason is attached** (in preview,
  `runtime-preview-generation-failure.ts` alone owns that decision). The five reasons' sentences are all **static**,
  and **the reason we do disclose is no exception** (`not-authorized` does not carry a provider name — when the same
  contract later runs on a player's device, that word is someone else's device setting). The host's sanitization is
  **a line of defence behind it, not a replacement.**
- **No credentials reach the worker** (preview generation is a worker → main round trip, and there is **one adapter**
  that pulls in the generation stack; a static scan pins that list by value). **Do not build a second AI stack.**
- **Cancellation is two layers** (the generation number, so a late answer does not reach a new session; and
  `AbortSignal`, so a paid request already in flight is genuinely cut). **A request receives an answer even with no
  adapter** (dropping it silently leaves the VM's promise unsettled forever). **Completion returns through the host
  completion queue** (the provider's promise callback does not enter the VM synchronously).
- **The result is a suggestion.** `useGeneration()` does not change durable state by a character, and which lifetime
  the text goes into is decided by one of the creator's setters. A failed generation leaves no fake reply.
- **Preview AI is off by default and freezes when the session stands** (we do not swap the capability table of a
  running VM). **`useGeneration()` exists even in a session with no capability** (the failure is
  `runtime_generation_unavailable` on the spot — a public API disappearing based on host configuration makes the same
  creator project compile differently per deployment).
- **There is instrumentation and no telemetry** (a session with no capability is **`null`** — filling it with 0 makes
  *it is on and was not called* and *it cannot be called* one value). Creator code cannot read these numbers.
- **There is no streaming, tool calling, structured output, chat-specific API such as `useChat()`, creator provider
  selection, creator networking or background generation** (the runtime is genre-neutral, and the messenger is
  something the creator **built** from public primitives).

### Scroll and focus — controllers

**Telling the screen to do one thing, not describing what it looks like.** Full rules in
`docs/creator-runtime/scroll-and-focus.md`.

```text
creator      const scroll = useScrollController();
             <ScrollView controller={scroll}>…</ScrollView>
             setMessages(...); scroll.scrollToEnd();
    ↓  a narrow capability object — never a platform object
VM           normalize → { "$control": 7 } rides as an ordinary prop value
             render collects the bound set · commit installs it · the queue flushes after that commit
    ↓  one more port channel (`commands`)
renderer     control id → the node its own prop table recorded → one platform operation
```

- **⚠️ A controller is not a `ref`, and it is not a node id either.** `ref.current` holding a platform
  object is impossible inside QuickJS (there is no DOM and no RN there), and handing the creator a host
  node **number** turns this into a general imperative channel — a number the creator can invent reaches
  another session's node, the trusted shell, or nothing at all, and what blocks it is then one line of
  validation rather than the type. What the creator holds is opaque: the integer sits under a symbol key
  (`RUNTIME_CONTROL`) whose module is outside the compiler's allowlist, so `controller.nodeId` and
  `controller.current` are **not expressible** (compiler tests pin that absence by value).
- **Binding is a prop, and that fact answers the whole lifetime.** `{ "$control": n }` stands beside
  `{ "$handler": n }` and `{ "$asset": path }` — **the patch protocol did not grow one operation.**
  Mounting is `set-prop`, removing is `remove-prop` or `remove`, and **a reorder (`move`) does not touch
  props**, so a key reorder cannot silently detach the controller. Control ids are never reused, so a
  stale controller pointing at a new node is not representable.
- **A command is not a patch.** Scroll position and focus are not tree state — as `set-prop scrollTop=240`
  they become values the reconciler compares every commit, and an unrelated commit would undo what the
  user scrolled by hand. What the channel carries is **a control id and a finite discriminated
  vocabulary** (`scroll` start/end/offset, `focus`, `blur`) — no node id, no method name, no coordinates,
  no easing curve.
- **⚠️ Ordering is the whole promise: a command never precedes the commit of its own execution.**
  The rule is one line — *if a render is pending it flushes after that render's commit, otherwise it
  flushes in this settle* — and `flushCommands` **yields** when a render is pending, so the two work items
  give the same result in either scheduler order. `setMessages(...)` then `scrollToEnd()` always sees the
  grown end. **There is no `setTimeout(0)` anywhere on this path.** A command does not always request a
  render, and the reason is effects: `scrollToEnd()` inside a dep-less `useEffect` would otherwise re-run
  that effect forever.
- **The one place web and native diverge is the frame.** The web applies patches to the DOM synchronously,
  so reading `scrollHeight` right after a commit already sees the grown content; on native the store has
  committed but React has not drawn and the new node's ref does not exist yet — so the deck holds the
  command, raises its own version, and the surface's dep-less `useEffect` flushes it after that render.
  **Pending never survives more than one flush** (holding it longer makes the scroll jump several frames
  later, tied to no interaction). **The deck's owner is the session, not the screen.**
- **Adjudication is three layers and the type is not the boundary.** The type catches the wrong pairing
  in the studio; the VM re-checks the pairing, rejects a duplicate binding (`runtime_host_control_already_bound`)
  and installs the authorized set **only when the commit is accepted**; the renderers check kind again.
  **An unbound controller is decided in the VM** — that is the only place a reason can reach the creator
  (commands take no answer), and it is a **warning, not a throw**: a conditionally rendered input's
  controller is normally unbound while it is absent.
- **Commands may not be called during render** (`runtime_host_command_invalid_phase`) — the same seat as
  `setState`. Everywhere else is allowed, **including the continuation after `await`**, because that is
  the same execution the user's press started.
- **There is no animation, and that absence is a decision.** Both platforms offer `animated: true`;
  taking it would require answering duration, easing and mid-gesture behaviour here, and those belong to
  a Motion slice that does not exist. **An immediate, correct API beats one that moves differently per
  platform.** Reading scroll position, viewport size and layout measurement are absent for the same
  reason the headless preview cannot invent them.
- **⚠️ `RUNTIME_API_VERSION` went 4 → 5 and that bump costs.** Public vocabulary grew, and the host's
  validation demands an exact match with no authoring source on the server — already-published runtime
  works do not open until their creator republishes. The answer is a product decision (a
  backward-compatible sandbox, or telling creators to republish), and **this commit must not ship without
  it.** The artifact format version and the patch protocol did **not** move.
- **VirtualizedList, Time/Motion, style v2, gestures, clipboard, and richer text-input control are not
  this slice.**

### Basic motion — transitions

**A declarative layer on top of the existing prop patch, and nothing more.** Full rules in
`docs/creator-runtime/motion.md`.

```text
creator   setOpen(true) → ordinary render → set-prop style { opacity, translateY, scale }
     ↓  frames do not cross this boundary — one press is one commit
renderer  interpolates to that value in its own realm
```

- **Creator code neither receives nor makes frames — that one line is the whole design.** There is no
  `animate()`, `useAnimation()`, animation handle, or `delay`; **and no completion callback**
  (`onTransitionEnd`). The last absence is the expensive one: with it, a creator's state machine gets
  bound to the host's clock, and then **the reduced-motion setting changes the order the program runs
  in.** A 200ms transition costs one VM turn, not sixty (on native, not sixty bridge crossings).
- **`transition` stands exactly where `style?: RuntimeStyle` stands** — the eight box primitives, via
  one `RuntimeTransitionable` (writing the prop out per component means one copy eventually goes
  missing, and that absence has no error). `Screen`·`Text`·`Button`·`Progress`·`Audio` do not have it.
  **`Text` is the one deliberate omission**: web's `<span>` needs `display: inline-block` for
  transforms, and that line changes layout — wrap it in a `View`.
- **Four axes move**: `opacity` · `translateX` · `translateY` · `scale`. `width`·`padding` are absent
  because they re-run layout and the two platforms measure the intermediate at different moments;
  `backgroundColor` because color interpolation is a color-space choice this contract does not have.
- **Transform is three numbers, not a string** — a string makes the browser the owner of that syntax.
  Numbers let **the renderers fix the order** (translate · translate · scale), and both use the same
  one; diverge and a scaled node's travel distance differs per platform, invisibly when scale is 1.
  A missing axis is **neutral, not "unchanged"**.
- **The easing control points are one table in `@rowcat/runtime`.** React Native's `Easing.ease` is
  CSS's `ease-in`, not CSS's `ease` — let each renderer use its own platform's same-named curve and
  the same work moves differently in the two places.
- **The first paint does not move, and that is the rule most quietly broken.** The web arms the
  transition declaration **at the end of the batch that created the node** (create, props and insert
  are all inside it); native's first apply is duration 0. **Neither uses `requestAnimationFrame` nor a
  forced reflow** — those lean on timing and behave differently in a tab receiving no frames. The end
  of a batch is an **observable event**.
- **Removal is still immediate — there is no Presence.** Keeping a removed node alive for a visual
  exit detaches handler-number and controller lifetimes from the tree, and then a button on a
  component that is gone gets pressed. Enter/exit is a separate slice; **do not build half of it here.**
- **Interruption never rewinds** — a new target continues from the value being drawn. On web the
  browser gives that for free and the rule is *do not write the old target one more time*; on native
  `Animated.Value` replaces from the current value, which is why the plan has no start point.
- **⚠️ Native is `useNativeDriver: false` and that is a paid choice.** Under the native driver the JS
  value is not updated while running, so interruption's start point depends on platform internals this
  repository cannot check by value. Interruption is a requirement and performance is not.
  **Reversing it requires an interruption measurement on a device** — the symptom is "it sometimes
  rewinds", which reproduces in neither the simulator nor tests.
- **Reduced motion is honored and the creator cannot read it** (`useReducedMotion()` does not exist —
  with it, an accessibility setting becomes a branch in the story). Turning on mid-transition ends at
  the target rather than leaving a node halfway; turning off later does not replay. **This is
  deliberately different from the product shell's policy** (`docs/motion/ARCHITECTURE.md` stops
  transforms and keeps opacity flowing) — there we own the screen and can judge per axis; here what
  moves is the creator's value and we do not know which of it is explanation.
- **Policy and value are different axes.** Changing only `duration` replays nothing; the new policy
  applies from the **next** target change. Within one batch `transition` applies before `style`, which
  is the same sentence.
- **The protocol did not grow by a character** — `transition` is one ordinary `set-prop`, the artifact
  format and `RUNTIME_COMPILER_VERSION` did not move, no port channel was added, and the server, DB,
  publication, saves and sync were untouched.
- **⚠️ `RUNTIME_API_VERSION` went 5 → 6 and it costs.** Everything added is a type, so a v6 artifact
  would evaluate fine on a v5 host and *then* fail the whole batch on the first `set-prop transition` —
  rejection before boot is better. The price is `player.md`'s: **already-published runtime works do not
  open until their creator republishes**, and that answer (a backward-compatible sandbox, or telling
  creators to republish) is a product decision. **Do not ship this commit without it.**
- **What is not verified by value: the actual frames on a device.** This repository does not mock
  React Native (`apps/mobile/vitest.config.ts`), so `useNodeMotion`'s frame behavior and focus/scroll
  preservation during a transition belong to simulator and device QA. What *is* checked by value is the
  rules (plan, target, policy) and the structure (**the component kind never depends on `transition`** —
  a conditional swap remounts the node and a focused `TextInput`, a `ScrollView`'s position and a child
  `Audio`'s playback all vanish with no error).

### Runtime publication and playback

```text
authoring source (device · E2EE)  ──publish request──▶  the API **compiles**  ──▶  story_runtime
player (web · native)             ◀──playback response (one entitlement gate)──┘
```

Full rules in `docs/creator-runtime/publication.md` and `player.md`.

- **⚠️ We do not accept a client-built artifact as publication input** (the contract has **no slot** for it and the
  server recompiles with `@rowcat/runtime-compiler`). There is one reason: a client-built artifact **proves nothing**
  about having passed RowCat's compiler policy layer (one HTTP client that does not use a browser makes that entire
  layer nonexistent). **The sandbox is still the primary security boundary** — requiring compilation here does not
  replace isolation but keeps publication from **deliberately** skipping the policy layer, and we do not write the
  sentence "the server compiles it, so it is safe" anywhere.
- **⚠️ Published runtime code is not a secret.** A compiled artifact **executes on authorized players' devices**, so
  strings, character instructions and control flow can be inspected, and `promptProtected` does not change that. The
  copy that tells creators this belongs to the authoring surface, and it **does not imply nonexistent alternatives**
  such as obfuscation or server-side execution.
- **The request's runtime axis is a discriminated union and omission is a third meaning.**

  ```text
  field absent       said nothing — an update **leaves the currently published runtime alone**
  mode: "disabled"   turned off — delete the published runtime (authoring source stays on the device)
  mode: "source"     one set of source. the server compiles it
  ```

  Distinguishing the first from the second is this contract's point — during rollout, clients that do not know this
  axis send update publications, and reading that absence as "turned off" makes **one update silently delete the
  published runtime.**
- **Compilation is outside the transaction and before the DB.** Before, because of the failure direction — rejected,
  nothing is written to the story row and the already-published runtime does not change by a character. Outside,
  because of time.
- **⚠️ Compilation runs in a worker thread with a memory ceiling and a deadline** (`services/story/runtime-compile.ts`,
  bundled as its own entry). It ran inline for a while, and type checking is unbounded: a recursive conditional type a
  few lines long took the whole API process to "heap out of memory" from a ~1 KB source, far below every size cap.
  Exhaustion is the source's doing and is a diagnostic (`runtime_compile_exhausted`); too many compiles at once is a 503
  (`story_runtime_compile_busy`). Each thread is fresh and single-shot — a thread that compiled hostile source is never
  reused. Do not move the compile back inline to save its cold start.
- **The server does not retain authoring source** (do not create columns such as `mainTsx` or `runtimeSourceFiles` —
  source crosses once as compilation input, and the durable original stays in the device's local-first, E2EE
  authoring system).
- **A total byte cap stands separately** (one file at 200,000 characters times 200 files makes a theoretical 40MB
  project that breaks no rule, and compiling it takes the API process's memory whole). **The server re-checks the
  authoring caps without making a looser copy.**
- **The capability manifest is derived by the server.** If a creator could declare `usesGeneration: false`, you get
  publications that spend a key (the operator's or the player's own) with no trusted AI notice. **This value is not a security authority** — what can
  actually be called is decided by the host's capability table, and all this list does is stand **in front** of it.
- **Do not fold the compiler's failures into diagnostics** (creator source diagnostics are a 400,
  `story_runtime_invalid` plus structured `details`; compiler and service exceptions are a 500 — folded, a server
  incident looks like a syntax error and the creator tries to fix their own code). Diagnostics carry no server file
  paths, TypeScript internals or stacks, and **we do not quietly publish it as a conversation story.**
- **`story_runtime` has no member foreign key** (a story that survives its creator's account deletion must keep its
  runtime). **Lifecycle transitions do not touch this row.**
- **Two playback paths, one entitlement gate** (`requirePlayableStory`). The old `/play` did not change by a character
  and **still returns a conversation snapshot even for runtime stories** — an intended compatibility fallback (a
  client already deployed receiving a shape it does not know shows only "the story cannot be opened"). The new
  `/playback` gives the discriminated union. Re-writing the entitlement rules on the new path means one of them
  loosens eventually, and **that looseness opens someone's private manuscript.**
- **The playback mode is projected by the server** (`StoryDto.playMode`) — a screen guessing from title, creator or
  the device's authoring files is guaranteed to be wrong on another device or another account, and the symptom is
  **pressing the primary action and nothing happening.** It rides on **the same response** as the detail for that
  reason too (queried separately, `대화 시작` is drawn briefly then becomes `플레이`, and whoever pressed that flicker
  creates a conversation that does not exist).
- **The primary action is always `start`** — what the playback mode changes is **what `start` means** and the word
  (`STORY_START_LABEL` and `storyStartGlyph`; both apps read the same table).
- **Starting a runtime story does not create a room** (no `createRoom()` and no role picker — a runtime playthrough is
  not a conversation but **durable state**, and a room created for it would sit in the list doing nothing).
- **⚠️ There is no compiler in the product playback worker.** Reusing the studio preview worker sends the whole
  `lib.es2022.d.ts` family and TypeScript **to every player's device** — players do not write code yet would receive
  the tools for writing it. Hence two workers, and a static scan locks that absence.
- **Saving is unchanged** (no new save endpoint and no plaintext save column). **Do not fold `sync-required` into a
  new game.** **Announce the hydration result before mounting** (durability of the migration).
- **The two resets are different operations**: `다시 시작` carries the save over; `플레이 초기화` empties the
  playthrough only. **Product playback has no operation that erases long progress.** The confirmation states **what
  remains first.**
- **⚠️ The save scope has exactly one owner at a time — transitions are serial.** Restart, reset and leaving are
  linked not by a React effect's cleanup but by `RuntimePlayerLifecycle` in `@rowcat/runtime-persistence`, and both
  apps use **the same object.** The next session cannot read or clear the save until the old session has cut
  generation, stopped the VM so cleanup functions ran, flushed the last save **to completion**, and disposed the
  coordinator. While the next coordinator was created directly in the effect's cleanup, the old coordinator's last
  write overlapped the new one's `load()` (the screen showed chapter 2 while the new VM was on chapter 1), and on
  reset a late-finishing write won. **Only the leaving flush has a cap (2 seconds)**; explicit transitions wait to
  completion and do not stand up if they do not finish (there is no fallback that quietly stands up with old values).
  Consecutive requests coalesce (`reset` is a logical OR).
- **The AI notice is a trusted sentence and stands before the session does.** Whatever the creator writes on the
  button, `useGeneration()` builds requests with this person's current settings. **Do not assert whose key a
  generation spends** (managed versus BYO is this device's setting) and do not name a provider. **The decision freezes into
  the session**, and a refusing session's `generate()` is not "not authorized" but
  `runtime_generation_unavailable`.
- **Do not build a second AI stack** (target resolution, the managed gates, routing, transport and safety guards are all the
  same functions conversation uses, and **the provider's original message is replaced with ours at the very place the
  reason is attached**).
- **All-ages is the work's rating and the viewer's entitlement together** (`resolveAllAges`, as conversations do). The
  playback response carries the rating the server stored (`StoryPlaybackDto.adult`, absent reads as all-ages), the
  studio and the playtest pass the draft's own, and both apps' adapters take it as a **required** argument. Deciding
  from the viewer alone ran an all-ages work's generations under the adult guards for adult viewers — a way around the
  adult publishing gate.
- **Reading a thrown value has its own short budget** (`classify` in `vm/quickjs.ts`). It runs after the execution's
  slice, where nothing interrupts, and reading can run creator code (`toJSON`, getters, proxy traps): `throw { toJSON()
  { for (;;) {} } }` ran unbounded on the host thread, past stop and dispose, and `throw new Promise(…)` crashed a Node
  host through a use-after-free in `dump`. Classification reads `name`/`message`/`stack` as properties and never dumps
  an object.
- **The host counts tree depth too** (`RuntimeHostNodeLedger.project`), as it already counted nodes and bytes: the batch
  is a string creator code can shape. It counts ancestors below the root for what each batch attached, so for a real tree
  it is never stricter than the reconciler.
- **The native canvas clips** (`overflow: "hidden"` on the surface, the twin of the web's `.rc-root`): transitions may
  translate ±100,000 and iOS draws outside bounds by default, so a story could paint over the app bar.
- **Do not trust the artifact.** Even though the server built and validated it, the runtime host validates it again
  before execution — it crossed a network and a cache, and above all the version may have diverged. A compatibility
  failure **has its own state** (`incompatible`) and that panel does not suggest restarting (the same failure would
  come). The copy is `앱을 업데이트해 주세요` and it does not draw `sandbox api 4 host expected 3`.
- **Do not hot-swap the code.** Republishing leaves a running session as-is and newly opened sessions receive the new
  artifact. **`sourceHash`, artifact hashes and compiler versions do not enter the save record's identity** (with
  them, every code fix erases the player's progress).
- **`RUNTIME_API_VERSION` has a compatibility window now** (`RUNTIME_API_MIN_COMPATIBLE_VERSION` ·
  `runtimeApiCompatibility` in `@rowcat/runtime/declarations`). The host accepts `min..current`; `too-old`, `too-new`
  and `malformed` are distinct rejections with sentences that say the remedy (republish vs update the app). Every
  bump so far since 4 → 5 was additive, so the adapter for an older version is **identity** — the artifact runs as-is
  and keeps its own `apiVersion` (the validator does not overwrite it). The four hosts (preview worker, player worker,
  native harness, server) all pass through `validateRuntimeArtifact` and none compares versions itself
  (`runtime-player-boundaries.test.ts`). **An additive bump costs nothing; a bump that removes or changes a name must
  also raise the window's floor, and that commit ships with the republish procedure** — since the source is not on the
  server a recompile migration is impossible (`docs/creator-runtime/public-beta.md` §2).
- **Runtime playback runs inside RowCat's conversation surface, and it is not a room.** The canonical address is
  `/chat/runtime/:storyId` and the old `/stories/:id/play` only redirects there. What it shares with conversation rooms
  is **the product surface** alone (the web's vertical column `conversation-viewport.tsx`, the header's slot, the
  sidebar's `대화` section; the app's `Screen`, `AppBar` and `KeyboardLayout`).

  ```text
  a runtime playthrough is not a ChatRoom.   no createRoom · no fake seed, opening or history
  runtime state is not a ChatMessage log.    do not move useStoryState messages into chat.message
  ```

  `ChatComposer`, `MessageList`, memory, personas, search and room settings are the room's vocabulary and do not come
  to that screen; what the header draws is the story title, `작품 정보`, `생성 설정` and `플레이 초기화` only (the
  web's reset and settings availability cross one narrow bridge, `runtime-chat-controls.ts`). **`생성 설정` is the
  runtime's own model override, not the room's `대화 설정`** — the same `GenerationPreferenceStore` under key
  `runtime:<storyId>` (`getRuntime`/`setRuntime`), target and reasoning only (output length is the creator's
  `maxOutputCharacters`), read per request so no restart is needed, and shown only for stories that use generation. **`/chat/:roomId`'s parameter is still one local room id**
  (do not overload it with `runtime:<id>` or `?mode=runtime`, and both apps' tests check by value that the static
  segment `runtime` precedes the dynamic one).
- **A unified conversation library — runtime rows stand on their own record.** `/chats` and recent conversations draw
  conversation rooms and runtime playthroughs in **one list** ordered by activity (no per-kind sections). The runtime
  row's original is a third sync record, `runtime.conversation`, and **not durable state.** Four reasons not to project
  from the save row: the first open may have no commit; some runtimes define no `useStoryState` at all; removing a row
  from the list is not 플레이 초기화; and a save snapshot's `updatedAt` is not library activity. The condition for
  creating a row is **one entitlement-verified playback response**
  (`runtimeConversationPresenceAllowed`) — neither opening the address, nor the VM standing up, nor a save committing
  is a condition. **Removal from the list is `removedAt`, not a tombstone** (this engine's tombstones are final, so a
  row reopened on another device could not come back, while a library row must; the playthrough and long progress are
  untouched). The merge rule is `mergeConversationLibrary` alone, and `roomLibraryView` and `recentSidebarRooms` run on
  top of it unchanged. Runtime rows do not go through the room management hook — the only operation is
  `목록에서 제거`.
- **A draft with the runtime on edits none of the four conversation-material sections.**

  ```text
  프롬프트     the settings the model reads every turn   runtime: useGeneration() builds the request
  로어         injected into that prompt on a keyword    there is no prompt for it to enter
  시작 장면    the opening when a room is created        runtime opens no conversation
  상황 이미지  the picture appended to a reply           the creator's code draws the screen
  ```

  All four are values playback reads **only when it stands a room up**, and runtime playback creates no room, so on a
  runtime draft they have nowhere to be carried. The decision is `resolveConversationAuthoringMode` alone (**one
  function, four sections, both apps** — it takes no argument naming the section, so the four cannot diverge) and the
  basis is `DraftRuntimeProject.enabled` only (do not guess from file count, prompt body, scene or image count, the
  publication's `playMode` or the address). Three shapes: if the project has not been read yet **do not open the
  section** (`pending` — one frame of typing that passes through autosave mixes the just-typed text into a runtime
  story's old value); absent or off means editing; on means a guidance sentence. **Subscription and judgment live at
  one wiring point per app** (`features/create/runtime-lock.tsx`) — written per section, one of the four eventually
  stops passing `loading`, and that section is open for exactly the frame that costs. **Locking does not change the
  value** — the assembler still carries all four into a runtime publication's snapshot, and turning the runtime off
  brings exactly those values back, so every lock copy says so in its last line (a creator who reads it as deletion
  never turns the runtime off again). **The `추가` action does not stand on a locked section either** (adding an item
  that will not be carried is noise, and for scene images that press is an irreversible upload). Publication
  validation follows the same axis: the only case where a prompt is not required is **an explicit
  `runtime.mode === "source"`** (the other three were never required). Do not automatically feed the old prompt into
  `useGeneration()`.

### Remote image assets — `asset("https://…")`

```text
creator   asset("https://cdn.example.com/a.webp")   →  an opaque AssetRef  →  { "$asset": "https://…" }
host      classifyRuntimeAssetValue → remote         →  {API}/v2/runtime/assets/remote?url=…
server    syntax → DNS → address decision → connect to that address → image/* validation → bytes (our headers only)
```

Full rules in `docs/creator-runtime/remote-assets.md`.

- **⚠️ A remote address must be one the artifact declared, and that list is this feature's security boundary.**
  `asset()` only builds a value and does not ask where the string came from, so without the list this one line holds:
  `<Image source={asset(`https://creator.example/p.png?q=${text the player typed}`)} />`.
  **The fact that the response cannot be read does not prevent this** — that path and query arrive at the creator's
  server, and they can carry durable state, AI-generated sentences and the player's input. What RowCat fetching on
  their behalf hides is **the IP, not the value.** A one-way channel with no eyes is still a channel.

  ```text
  publication compilation collects static strings from source   projectRemoteAssets → RuntimeArtifact.remoteAssets
        ↓  the host validates (shape · canonical · 256 entries · 64 KiB total)
  the session holds that list → started (web worker · native bridge)
        ↓  only after passing through it does the asset resolver build a URL   authorizeRuntimeAssetResolver
  ```

- **The rule is "a complete static string" and there is no scope analysis** (literals, templates with no substitution
  and module constants are in; templates with substitution, concatenation and function return values are out). We do
  not build constant propagation because the evaluator is not complete without executing creator code.
  **Do not narrow by the call site's name (`asset`) either** (`import { asset as img }` and helpers that receive an
  address quietly become placeholders, and that failure surfaces **after** publication).
- **Do not solve it in the type** (a device such as `asset<const T extends string>` is bypassed by one `as any`, and
  above all the publication artifact is built by **the server's compilation**, so the authority must be that pass's
  result rather than type checking).
- **An artifact with no list authorizes no remote address at all** (folding that absence into "allow everything" lets
  one artifact with the field removed open this defence entirely). Which is why neither
  `RUNTIME_ARTIFACT_FORMAT_VERSION` nor `RUNTIME_COMPILER_VERSION` **went up**: bumping makes every already-published
  runtime unplayable until republished, and there is nothing to gain (an optional field's absence already reads on the
  safe side).
- **The list is owned by the session, not by a global** (in a module global, a coordinator field or app state, an
  address declared by story A opens in story B's session, and **that leak has no symptom**). The web clears it when a
  transition begins and `started` refills it; on native the list lives **inside** the `running` state, so it vanishes
  on its own when the generation changes.
- **The main thread and Hermes do not extract the list from the artifact themselves** (whoever stood the session up —
  the worker or the WebView — holds the authority through its validation; read from outside, **a value that never
  passed validation** becomes the resolver's basis).
- **An unauthorized remote address does not get a proxy URL built** (not filtered — building the URL simply does not
  happen). That is also why there is one wrapping function: written out per site, someone eventually omits it, and
  **a resolver missing the authorization produces no symptom at all.**
  **Preview is not an exception** (loose only there, an image that rendered while authoring disappears after
  publication).
- **The API's defences did not shrink by a line; they block a different threat** — the list closes *creator code
  choosing where a value goes*, while the proxy's SSRF, rebinding, redirect re-adjudication, format, size and deadline
  close *whether our server's outbound request is safe*. **Do not build a parameter on the endpoint that asserts an
  artifact** (`storyId`, `allowedUrls`) — authorization the client asserts is not authorization.
- **`asset("https://…")` is not `fetch()`.** Creator code still has no network API at all — there is nowhere to receive
  a response body, headers, status or redirects, and an image that fails to load is a placeholder, not an exception.
  The public docs' sentence is **"there is no arbitrary network API"**, not *"there are no network effects"*, and
  images are that narrow exception.
- **A bare string `source` is still blocked** (what widened is what `asset()` accepts, not `ImageProps.source`'s type
  — a compiler test pins the four combinations by value). `ref.url` and `ref.kind` are still unrepresentable.
  **The wire did not change** (`{ "$asset": string }` as before, with no kind written — it is derived deterministically
  from the value, and writing it makes old clients half-read new artifacts).
- **A player's device never reaches the creator's host** (both the web's `<img src>` and native's `{ uri }` receive
  RowCat's proxy URL — the reverse makes one image line a tracking pixel handing the player's IP to the creator, and
  both renderers' tests check that absence by value). The URL rule is one place in the SDK
  (`media.runtimeAssetUrl`).
- **The decision is two layers answering different questions** — the runtime's `classifyRuntimeAssetValue` looks at
  **shape** deterministically and answers the creator on the spot (it avoids `URL` because that is absent in the VM and
  lenient where present); the server's `lib/remote-image` looks at **the destination** (is the resolved address the
  public internet) at connection time. The former is not a security boundary and we do not write it as one.
- **SSRF is a correctness condition** (neither `https:` nor a public hostname guarantees anything — the name is
  resolved by the creator's DNS). The server connects only when **every** address `lookup` returned is public (one
  private address rejects), and passes the adjudicated address **verbatim** as `https.request`'s `lookup` so there is
  no second resolution (DNS rebinding). Redirects re-adjudicate syntax, DNS and address **from scratch** per
  destination, with a cap of three. Ranges are CIDR, not prefix strings (`address.ts` — it extracts and re-checks the
  IPv4 inside IPv4-mapped, NAT64 and 6to4), and the transport is injected so tests verify all of that by value with no
  internet.
- **The response must be an image, and the bytes say so, not the header** (`Content-Type` must be in the allowlist —
  JPEG, PNG, WebP, GIF; no SVG — and the magic bytes must **match** that format). The cap is 10 MiB (we do not trust
  `Content-Length` and count the stream), and the deadline including redirects is 10 seconds. The outbound request
  carries no cookies, authorization, referrer or client headers (the User-Agent is `${APP_NAME}-RuntimeAssets/1`, with
  no contact URL), and we set exactly four headers on the response we return.
- **Three reasons it is not an open proxy** — a session is required (guests get 401, and the decision stands **before**
  the fetch), a per-member cap (240/minute, fail-open), and the destination decision. It is not tied to story
  entitlement — making the request state which story it came from turns that claim into authorization.
  **There are only two failure codes and no detail** (`runtime_asset_invalid` 400, `runtime_asset_unavailable` 502) —
  answering private networks, 404s, formats and sizes separately makes this endpoint a probe for someone else's network
  from inside our server.
- **Publication does not fetch the images** (compilation is static and a remote image's availability belongs to
  playback time — a creator's CDN being briefly down does not block publication, and we do not copy images into our
  storage at publication either). **Saving, sync and lifecycle were untouched** (a remote address is a value in the
  source and reaches no save record).
- **Bandwidth is a byte budget now, not only a request count** (`lib/remote-image/budget.ts` holds the numbers and
  their derivation). The request cap's product was 2.4 GiB/minute per member; what stands today is three layers:

  ```text
  per response   10 MiB · 10 s · 3 redirects        fetch.ts — counted on the stream
  per member     512 MiB / 10 min (bytes policy)    reserve the response cap on entry, settle what was READ
  per process    16 in flight · 64 queued · 5 s     slots.ts — the buffered-memory ceiling
  ```

  **Admission is one atomic `INCRBY`** (the reservation), so the budget also bounds a member's concurrent fetches
  across replicas (512 / 10 = 51). Settling charges **bytes actually read** — failed, oversized and wrong-format bodies
  included (they used our line); a `NaN` reading charges the whole reservation. Redirects are one reservation (bodies are
  aborted unread; every hop sits under one response cap). The client leaving aborts the upstream and frees the slot
  and the unread reservation. A refused reservation is given back (a burst of 429s must not lock the member out for
  the window). The process slot **queues briefly** instead of refusing — a scene change requesting many images at once
  is normal. **The unit is the member, not the runtime session** — the server cannot see a session and the proxy takes
  no story/artifact parameter (a claim would be authorization), so a member's preview and playback share one budget.
  **A slot is held until the body has left, and a reader that stops reading is cut** (`releasingBody`'s stall
  watchdog, `BODY_STALL_MS`, for both this proxy and `/v2/media/:id`). Released at the handler's end, a client that kept
  its TCP window at zero kept each 10 MiB queued with no time limit, so "16 in flight" bounded nothing; there is no server
  response timeout to fall back on. **DNS is inside the deadline and off the thread pool** — a `dns.Resolver` with its
  own timeout, cancelled with the fetch, not `dns.lookup` (`getaddrinfo` on libuv's four threads, uncancellable: a name
  whose server never answers starved every other pool user in the process).
  ⚠️ **Managed media (`/v2/media/:id`) still has no per-subject byte budget**: it is public-by-id (avatars), native
  audio sends no cookie, and IP is not a subject here — closing it needs a session on the asset path, which is a
  separate decision. What it has instead is identity-free: a **byte-weighted process gate**
  (`lib/media/delivery-gate.ts` — 128 MiB in flight, FIFO, 256 queued · 5 s, `503 media_busy`; a range weighs its
  slice, a 304 weighs nothing, the reservation is held until the streamed body ends or is cancelled). Each abuse
  axis and which limit answers it is the table in `docs/ops/RATE-LIMITING.md` §관리 미디어.
  Flipping fail-open is still not the answer (while Redis wobbles, every runtime image disappears).

### Managed runtime images — `asset("characters/sena/smile")`

**The version where a logical reference became a real image.** The language contract did not change; what grew is one
path carrying **what to bind that name to** through authoring, publication and playback
(`docs/creator-runtime/managed-assets.md`).

```text
studio     upload an image → POST /v2/me/runtime-assets → one media (kind: runtime_image)
draft      DraftRuntimeAsset { path, assetId, mime, width, height }   E2EE synced
      ↓  the publish request's runtime.project.assets
server     syntax → ownership and kind → compile → story_runtime.managed_assets + story_media(runtime_asset)
      ↓  playback response (one entitlement gate)
playback·preview   logical name → media identity → RowCat media URL
```

- **⚠️ The binding does not go into the artifact.** An artifact is **the result of compilation** while this table is
  **a publication decision**, so their lifetimes diverge — swapping an image does not change the source by a character,
  so two publications with the same `sourceHash` must point at different images. Putting it in would require the server
  to edit the compilation result after the fact, and at that moment the bytes `sourceHash` names diverge from the bytes
  stored. This is where it diverges from the remote address list, and the basis is the opposite: that list **derives
  from the source** while this table does not.
- **The logical name is not an axis of the remote authorization list** (what that list closes is *creator code sending
  a value outward*, and a logical name points at **our store** and does not go outward). So **the name may be assembled
  at runtime** — authorization is only "is that name in this publication's table", and if not, it is a placeholder.
  **An unbound name does not kill the session** (an image not yet uploaded and a path renamed halfway are both normal
  authoring states, and one of them throwing would keep the screen from opening while you fix the project).
- **`kind` *is* the publication authorization** (three things pinned in the predicate; without `kind` you can publish
  the id of an avatar, a cover or a scene image as a runtime asset — that image does render, but it is a photo the
  person never agreed to put there). Hence the split upload resources (`POST /v2/me/runtime-assets` ↔
  `/me/scene-images`).
- **`story_media` now has two roles** (`scene_image`, `runtime_asset`) — the two sync functions deleting **narrowed by
  role** is the whole of that isolation (drop `role` from the predicate and a runtime publication sweeps away the same
  story's scene image dependencies, and that loss shows only after the story outlives its creator's account). Conversely, **the retention query does not look at role** (what it asks is "does anything still use this
  media").
- **There is no path that overwrites media** (replacement is not `PUT media-A` but **one new media plus a move of the
  binding**) — overwriting changes an already-published story's screen **without republishing**, and that change is a
  deployment the creator never approved. **Editing a draft does not edit the publication** (a published story does not
  change by a pixel until republished — the copy states that first).
- **`제거` does not delete the image from the world** (what is deleted is the fact that this draft called that image by
  that name; the bytes may be pointed at by an already-published snapshot). Do not build a permanent-delete operation —
  that question has to be answered together by publication dependencies, retention and account deletion.
- **An absent `runtime` field and an empty `assets` mean different things** (the former is **preserve**; the latter is
  **republish a runtime with no managed images**).
- **There is one source for the syntax** (`classifyRuntimeAssetValue` — the server's publication validation and the
  studio's name input go through **the same function**, with no regex copy: diverge and publication rejects a name the
  editor accepted). `@rowcat/authoring` does not import that function (layer rules), so it answers only duplicates and
  counts, and the assembly point joins the two.
- **What is stored is an identity, not an address** (freezing an address binds that snapshot to the deployment's origin
  and path rules, and changing one of them breaks the images of every already-published story).
  **Bindings go out only inside the playback response** (a public URL giving one story's asset manifest is a channel
  for opening a private story's image list without playback entitlement).
- **The table is owned by the session, not by a global** (the preview freezes **a draft copy as of pressing run**;
  playback clears at the start of a transition and refills from that transition's response — kept, story A's image
  appears on story B's screen, and that leak has no symptom).
- **Bindings do not cross the worker or the bridge.** This is where it diverges from the remote list and the basis is
  authority — that list's authority is **the validated artifact**, so whoever stood the session up must state it, while
  this table's authority is a draft copy or an entitlement-verified playback response, and what holds those is the main
  thread (Hermes).
- **The preview's staleness applies to assets too, without re-running compilation** (two signals —
  `runtimeCompileSignature` is files only, the analysis axis; `runtimeProjectSignature` is files plus bindings, the
  execution axis). Folded into one value, changing one image re-runs the whole compilation and the result does not
  differ by a character.
- **There is a store implementation on mobile even with no studio** (without it, an image bound on a Mac does not reach
  that device, and worse, **that device's next push uploads the draft in an image-less state**).
- **Path autocompletion is the editor's, and it is kind-aware** (`runtime-studio/assets/completions.ts`). One
  lexical scanner (`source.ts`) answers completion, hover and reference counting; the list comes from a handle bound
  **per Monaco model** (the provider is global, so a closure over one draft's list leaks it into the next draft). In
  `<Image source={asset("` only images are offered, in `<Audio source={asset("` only sounds
  (`runtimeAssetConsumerAt`) — the other kind would never render there, the resolver does not build its URL.
  Anywhere else both are offered and each row names its kind. The detection errs toward **offering both** (an alias,
  another prop, an expression) — hiding a correct name costs more than a longer list. No network, no media ids or
  URLs in what gets inserted.
- **The asset list is searchable, and it searches names only** (`runtime-studio/assets/list.ts` — one name field and
  a kind filter; media ids never match, so the list never makes them screen vocabulary). The query is screen state:
  the studio remounts per draft, so one draft's search never filters the next.
- **Rename and remove say where before they do anything** (`findRuntimeAssetReferences` in `assets/source.ts` — the
  same scanner completion and hover use, so no second regex exists to disagree). The dialog lists each **directly
  written** site as `file:line` and states separately how many **assembled** calls (`asset(\`…${x}\`)`) exist —
  those may or may not be this name, and the copy says exactly that. **Nothing rewrites source**; the panel only
  reads the editor snapshot (`runtime-boundaries.test.ts` pins both).
- **An asset library, folders, tags, permanent deletion and automatic source refactoring are not this slice.**

### Managed runtime audio — `asset("audio/bgm/main")`

**The version where `<Audio>` started making sound.** The language contract did not change — the primitive, the
reconciler and both renderers' state machines were already standing; what grew is the product path underneath them
(`docs/creator-runtime/managed-audio.md`). Only what **diverges from managed images** is here.

```text
studio     upload MP3/M4A → POST /v2/me/runtime-audio → one media (kind: runtime_audio)
draft      DraftRuntimeAsset { path, kind: "audio", assetId, mime, durationMs }   E2EE synced
      ↓  the publish request's runtime.project.assets carries `kind`
server     syntax → ownership **and kind** → compile → the same two writes as images
      ↓  playback response (the same entitlement gate)
playback·preview   logical name → media identity → RowCat media URL (**range requests**)
```

- **⚠️ `kind` is the security axis of this slice, and it stands in five places** (`media.kind`,
  `DraftRuntimeAsset.kind`, the publish request, the published snapshot, the playback response). One logical namespace
  writes images and sounds with **the same syntax**, so without the kind gate both of these pass:
  `<Image source={asset("audio/bgm/main")} />` and `<Audio source={asset("characters/sena/smile")} />`. Leaning on the
  browser's decode failure means **the request already went out**, and that request may point at media this session has
  no right to open. The gate stands in **one place** (`bindRuntimeAssetResolver`) and it does not filter — **the URL is
  never assembled**.
- **A missing `kind` is `image`, and the reverse is never inferred.** Clients deployed before this axis send
  `{ path, assetId }`, and on that build managed assets were images only, so the absence *is* the fact. Do not guess a
  sound from the MIME — the moment guessing enters, the question changes from *did this person choose to put it here*
  to *what do these bytes parse as*. **A client's `kind` is validation input, not the conclusion**: it decides which
  predicate to ask, and the DB answers whether that media really is this creator's runtime audio.
- **The upload address is the kind** (`POST /v2/me/runtime-audio` ↔ `/me/runtime-assets`). Do not add a `kind` field to
  one route — with it, the request *asserts* which parser and which limit it passes, and this repository already
  rejected that shape once (`POST /media` where the body decides the kind).
- **`story_media.role` did not split.** Audio is `runtime_asset` too — that table asks "does this story stand without
  this media", and the medium is not part of that question. Splitting it makes lifecycle code walk two roles, and the
  day one is missed a surviving story's sound disappears. *What it is drawn with* is answered by the publication binding.
- **`media.width`/`height` became nullable and `duration_ms` arrived.** A `0` there is a state that does not exist
  ("an image 0 wide") and it renders straight into the list. The schema loosened; **the invariant moved to the
  services** — `createMedia`'s input is a discriminated union, so `{ kind: "runtime_audio", width: 512 }` is not
  expressible. That, and the authoring side's `NewRuntimeAssetMedia`, are the only writers.
- **We validate the container and do not re-encode.** Transcoding turns this repository into a media-processing
  platform (an ffmpeg binary, a job queue, partial-failure states) for one gain — a single stored format — and that
  gain is void because both formats already play on web and native. `mime` stays true not through re-encoding but
  because **only the value the container stated is written**. The price is stated honestly: container tags (ID3, MP4
  `©nam`) survive, so the image side's "normalization strips metadata" promise is not true here.
- **The parser is ours and it is bounded.** Pulling in a decoder to learn one duration makes that decoder the least
  trustworthy input reader in the process; calling an external binary makes a deployment's feature set depend on
  whether that binary is installed. Every read checks its length first, box traversal is capped in count and depth,
  and there is no recursion. **An MP4 with a video track is rejected** (`.m4a` and `.mp4` are the same container, and
  a video file stored as `runtime_audio` carries video under a name that says sound).
- **Duration is a different axis from size, and the two rejections have different codes.** A file encoded at 8kbps is
  small and hours long; only a duration cap stops it. Folded into one code, someone who compressed harder receives the
  same rejection again.
- **`GET /v2/media/:id` answers range requests — the only transport change in this slice.** Media clients seek and
  resume with byte ranges, and answering 200-with-everything makes every seek re-fetch the track. Multi-range and
  malformed ranges are **ignored** (→ 200 whole), which is what RFC 9110 permits and what keeps such a client from
  receiving nothing; 416 always carries `Content-Range: bytes */TOTAL`. **The total length comes from the row**
  (`byte_size`) — reading bytes to decide a range puts 10MiB in memory for a request that ends in 416. The storage
  port grew an **optional** `getRange?`, and the fallback lives in the service (a route that knows about it makes
  range correctness vary by adapter).
- **The autoplay affordance belongs to the trusted host, and creator code can neither build nor remove it.** The
  browser's policy releases only inside a user gesture, **synchronously** — a creator's `onPress` round-trips the VM
  and is no longer a gesture by the time it returns. The renderer reports the observation and draws nothing (no React
  in that package); the host draws one button and calls `activateAudio()` in the press. **Preview and product playback
  use the same component** (loose only in preview and a sound that played while authoring goes quiet after publishing).
  **Do not retry on a timer** — that code does not bypass the policy, and if it ever succeeds it plays sound the user
  never allowed. Native has no such axis — an **intended difference** already written into the two state machines.
- **The native player is supplied by the app** (`expo-audio` behind `NativeRuntimeAudioPort`; the renderer package
  imports neither Expo nor `apps/mobile`). **The deck owns the sound's lifetime, not React** — as a component that
  lifetime binds to mount rules, an ordinary parent re-render can restart the sound, and StrictMode's double mount
  builds two players. Above all **sound is not drawn**. The deck's identity is the session's tree store, so a story
  transition ends the previous story's audio **before** the next deck stands.
- **Backgrounding pauses; it does not clear intent.** `suspend()` leaves the desired state alone so returning resumes —
  turning the creator's `playing` off would be a state change the story never made.
- **Remote HTTPS audio stays closed** (`bindRuntimeAssetResolver` resolves a remote target only for `image`, and the
  native URL resolver refuses it again). The compiler collects static HTTPS strings **without looking at which
  primitive consumes them**, so such an address being on the manifest is a normal state — that it does not become
  sound is answered at the resolution layer. **The remote-image security model did not loosen by a line.**
- **`RUNTIME_API_VERSION` did not go up.** The public language contract did not widen — `<Audio>` and `AudioProps` were
  already part of that version — and bumping it makes already-published stories unplayable until republished (the
  host's validation demands an exact match).
- **An asset library, folders, search, tags, permanent deletion, transcoding, waveform thumbnails, trimming, background
  playback, lock-screen controls, OGG/FLAC/WAV/Opus, remote audio and preview-in-the-list are not this slice.**
  **Managed media still has no per-subject byte budget** — the remote proxy got one (`### Remote image assets`), and
  `/v2/media/:id` is public-by-id with no session on native audio, so that gap stays open by decision, not by
  oversight. Its memory axis is closed by the identity-free delivery gate (`lib/media/delivery-gate.ts`).

### AI authoring — `llms.txt` and the MCP server

**A layer that lets a coding agent do what a creator does in the studio**, and nothing more. Full
rules in `docs/creator-runtime/ai-authoring.md`.

```text
docs/public/runtime/**/*.md   prose · symbol ownership · examples   the single source
@rowcat/runtime's own source  names · kinds · signatures            the single source
        ▼  generated, committed, deterministic
RUNTIME_AI_CORPUS  →  /llms.txt · /llms-full.txt · /runtime-api.json · the MCP docs tools
```

- **No sentence about the product is written in code.** The corpus renderer builds tables of
  contents and nothing else; what agents read comes from the markdown verbatim. A line authored in
  TypeScript is a second source that can diverge, and **that divergence happens where only agents
  look.** Even the agent-only guidance is markdown (`_agents.md` — the `_` prefix is what keeps it
  out of the public page list).
- **The cross-check runs both ways.** A name in the source that no page owns does **not** reach the
  reference (it lands in `undocumented` and the test names it); a name a page claims that the source
  does not export **fails generation**. The first does not stop generation, and that direction is
  deliberate — one runtime slice landing ahead of its docs must not block `llms.txt` for the eighty
  names that are documented.
- **The MCP server is a local executable because the server has no drafts.** Authoring data is the
  device's and the server holds ciphertext it cannot open, so the only way to reach a draft is for
  the process to **become one of the account's devices** (session + recovery code + the existing
  sync protocol). Opening a plaintext authoring API on the server would make this executable
  unnecessary and the product's zero-knowledge claim untrue at the same time.
- **That device registers four codecs** (`authoring.draft`, `runtimeProject`, `runtimeFile`,
  `runtimeAsset`). Chat, personas and player saves are `ignored` by the engine — forward
  compatibility's normal path — so this tool **does not hold them and therefore cannot upload
  them.** The absence of a row in that table is the boundary, not a predicate.
- **Records live in memory, so the push is the durability.** `write_file` returns success only
  after the change is uploaded, and says `sync_failed` when it is not. This is where it diverges
  from the web, whose IndexedDB is durable on its own.
- **There is one compiler and one VM.** The preview goes through the same `compileRuntimeProject`
  publication uses and the same QuickJS host the studio worker uses. A second execution path makes
  "runs under MCP, runs differently once published" representable.
- **The agent presses buttons, and that is the point.** Compiling is not evidence that the screen
  is right. Interaction goes through the renderer's own path — a handler number from the tree, then
  `dispatchEvent` — so no browser automation is involved. Node ids are revision-scoped and never
  reused: an operation naming a node that is gone is refused (`stale_node`) rather than guessed at,
  because guessing hands the agent a success for something it did not press.
- **Tool names carry no dot** (`runtime_write_file`). Several clients validate tool names as
  `[A-Za-z0-9_-]`, and one dot makes **every tool of this server disappear** in those clients.
- **There is no publish tool, no runtime on/off, no draft-body editing.** The last is the same rule
  as the product's: those four sections lock while the runtime is on, and MCP must not be the door
  around that lock. `boundaries.test.ts` in both packages pins these absences by value.

## Media — the image upload pipeline (avatars · covers)

**One piece of infrastructure shared by several domains** (`contracts/media.ts`, `lib/media/*`,
`services/media.ts`).

```text
validate·normalize  lib/media/image.ts       bytes → the bytes we decided to store (takes a policy as an argument)
policy              lib/media/policy.ts      caps · output size · cropping · error vocabulary — one per media kind
storage port        lib/media/storage.ts     put · get · delete only. no vendor passes this file
adapter             lib/media/postgres-store.ts
lifecycle           services/media.ts        create · read · delete · orphan cleanup
consumers           services/account/avatar.ts · story-cover   they hold only the discipline of moving a pointer
```

- **Infrastructure is shared; product rules are not.** Avatars and covers carry the same risks (MIME spoofing, image
  bombs, EXIF leakage, SVG) but **opposite rules** — avatars are 2MiB, square 512px, cropped, with a minimum size;
  covers are 5MiB, within 1200×1600, uncropped, with no minimum. So `normalizeImage` takes a policy as an argument and
  **a media kind with no policy cannot exist.** Had we copied the validation, one of the two copies would have missed
  the next vulnerability fix, and nobody would see that until the vulnerability was actually used.
- **The policy carries the error vocabulary too — this is the easiest thing to get wrong.** Covers already have a live
  wire contract (`story_cover_*`), so sharing the pipeline and renaming those codes to `media_*` makes **every cover
  failure on already-deployed screens fall into the `default` branch.** That divergence is not a compile error; it
  shows up only as the copy getting worse.
- **Do not read the format the request claims.** The decision is two stages — confirm the signature by magic bytes,
  then have libvips actually decode. Stage one is there for the **attack surface**, not performance: libvips also
  reads SVG, and that path is librsvg's XML parser rather than an image decoder. The two decisions must **say the same
  format** ("PNG signature with a WebP body" is input we cannot describe). **We do not accept SVG** (there is no
  sanitization pipeline, and standing one up for avatars would make the least trustworthy input its first consumer).
  AVIF, HEIC, BMP and TIFF are not accepted either — the browser being able to draw it is not a reason we must accept it.
- **We normalize before storing, which is why `mime` is always true** (decode → apply EXIF orientation to pixels →
  resize `fit: inside`, **never upscaling** → re-encode to WebP). Storing originals gives as many stored formats as
  there are inputs, and from then on `mime` is not a verified fact but a transcribed claim. **We do not crop**
  (covers) — putting an image in a 3:4 box with `object-cover` and the server cutting it are different things, and the
  latter is irreversible.
- **Only ICC metadata survives** (GPS, device serial numbers, capture software, XMP, IPTC and embedded thumbnails all
  vanish). It matters most for avatars: a profile photo is often a photo just taken on a phone, and that file contains
  **location coordinates.** ICC is the exception because it is not personal data but **information for rendering color
  correctly.** The original filename is not stored either.
- **We accept GIF and keep the motion** (covers). Keeping only the first frame defeats the point of accepting GIF — the
  user chose a moving picture, and not telling them it became a still is a silent loss. The stored format is still
  **one** (WebP) and that format carries animation. **Animated WebP folds the other way, to the first frame** —
  someone who chose a GIF expects motion, while someone who chose WebP mostly does not know it has several frames (the
  same reason we do not reject it).
- **Loosen the bytes and lock the pixels** — GIF carries a whole palette image per frame, so its body cap is far more
  generous (20MiB vs 5MiB for stills) while **total pixels** (40 million) and **frame count** (300) stand separately
  (what we actually pay for is unfolded pixels rather than file size, and those two diverge especially far on GIF). A
  frame budget overrun is **a different code** from a resolution overrun (someone who only lowered the resolution
  receives the same rejection again).
- **`bodyLimit` stands at the larger of the per-format caps** (before reading the body there is no way to know what is
  coming). The 5MiB for stills is enforced **with the same error code** after checking the signature (413 vs 400 splits
  the status code but the code is the same — what the user has to do is the same). It is not mounted globally because
  it would then stand in front of the Better Auth handler and every JSON route.
- **Bytes never enter the contract** (there is no `avatarBase64`, `coverDataUrl` or `bytes`, and there will not be —
  the path is a dedicated binary endpoint and JSON carries **the URL only**). Legacy put a data URL in the story row,
  which made even list queries that **do not use** the cover drag TOAST along, with several MB in one gallery JSON
  response — list, detail and owner projections join `story_cover` but select **only the `version` column**.
  **There is no field taking an arbitrary remote URL** either (such a field would (1) make a photo the user never chose
  to share the face of their profile, (2) let a host we do not control see the viewer's IP, and (3) become an SSRF
  surface the moment the server starts fetching that URL).
- **The storage key is issued by the server with not one character of user input**
  (`media/avatar/<ownerId>/<mediaId>.webp` — the original filename has no slot in the contract and never reaches the
  server). **Do not put emails or nicknames in the path** (a storage key is a value that lands in logs, backups and CDN
  access records). **The storage key is not authorization** (ownership is decided by the `media.owner` column, and the
  member id in the path is for operations — using the path for authorization means whoever can invent a path can invent
  authorization).
- **The URL is ours, not the storage's** (emitting the bucket's public URL removes the place access control sits,
  leaves nowhere to add a later safety check, and breaks every already-emitted HTML and cache the day storage changes).
- **The authority for cache identity derives from the content.** Media gets a **whole new URL because a new id is
  issued** when the avatar changes, so it is unconditionally one year `immutable`. Covers have a fixed address
  (`/stories/:id/cover`), so `story_cover.version` (a Postgres generated column, the first 32 characters of
  `sha256(bytes)`) is attached as `?v=` and `immutable` is applied **only after comparing it.** Two reasons
  `story.updated_at` was abandoned as the cache buster:

  ```text
  atomicity   bytes in story_cover, version in story — you have to "promise" to write two rows
              in one transaction, and a second write path that breaks that promise appears eventually
  uniqueness  a cover replaced twice in the same millisecond emits **different bytes at the same immutable URL**
  ```

  A generated column makes both **unrepresentable.** **The DB computes it, not the application** — whatever statement
  anyone later writes against this table, they cannot omit the version. The ETag comes from the same value.
  **Do not 404 old version URLs** (screens still holding old HTML would draw a broken image, which has nothing to do
  with anything the user did — what is invalid is the **cache eligibility**, not the resource).
- **Cover writes do not issue one UPDATE against the `story` row.** The absence of that one line alone makes releasing
  `hidden`, changing `visibility`, changing the rating, moving counters and reordering lists all unrepresentable. In
  particular the sort axis (`updated_at desc`) stays put (if changing one picture lifted the work to the top of the
  list, the user reads it as an edit they did not make).
- **Replacement is not delete-then-upload. The order is the whole of it.**

  ```text
  1. validate·normalize   on failure nothing has changed
  2. store new bytes      on failure the old avatar is intact
  3. new media row        on failure the old avatar is intact
  4. move the pointer     ← the first point where what is visible changes. one UPDATE statement
  5. clean up the old     on failure nothing has happened to the user
  ```

  One badly-formatted file erasing a perfectly good profile photo is irreversible damage, and this order blocks it
  structurally. Covers are the same axis, so storage is one upsert rather than `DELETE` then `INSERT`.
- **Step 4 locks the member row.** The contender is the same person's second upload — without the lock, two concurrent
  requests **both take the same old media as their cleanup target**, and the media the loser created is pointed at by
  nobody and never cleaned up either. The cover's lock (`SELECT … FOR UPDATE`) blocks contention with account deletion
  and story deletion — either way, **no ownerless cover remains.**
- **Normalization comes before the DB and outside the transaction** (decode and re-encode take hundreds of
  milliseconds, and holding one slot of a ten-connection pool that long slows unrelated requests down with it).
- **Orphans err toward remaining.** It is an operation spanning two stores with no enclosing transaction, so a failure
  must choose a direction to be wrong in. **Bytes go first both when creating and when deleting** — the other direction
  (row first) creates a broken image when creating and **an orphan you can never find** when deleting. In this
  direction an orphan is always findable by query (`findOrphanedAvatarMedia`).
- **The adapter being Postgres is a fact about this deployment, not a ceiling on the design** (code demanding S3
  credentials kills avatars entirely in a deployment that has not configured them, and that failure surfaces **after**
  the user picked a file). The local filesystem cannot be a production architecture, and Postgres is durable storage
  this deployment already depends on. **Do not pre-create a variable such as `MEDIA_STORAGE_PROVIDER`** — a setting
  that does nothing when filled in creates deployments that "believe it is on".
- **`media_blob` has no FK to `media`. Deliberately.** With one, the day the adapter changes, **the normal state** of
  "metadata in Postgres, bytes in S3" becomes a constraint violation.
- **`status` is where a later safety check will sit.** Today only a path producing `ready` exists, but the read
  predicate already checks that value — the predicate has to exist first for adding the check to be a **one-place**
  change.
- **Read authorization is decided by the domain that owns that media.** Reading a cover goes through **exactly the same
  predicate** as the detail (`lookupSelector` → `getStory`), so private, archived, operator-hidden, block and adult
  gates all stand — a cover usually tells you everything about what that story is. Writing asks ownership, and that
  predicate is inside the service's locked SELECT. No value the browser sent enters that decision.
  **A missing story and someone else's are the same 404.**
- **The gates for writing and deleting diverge.** Avatar writes are `requireActiveViewer`; cover `PUT` additionally
  requires the `story.publish` capability. **Both deletes are `requireViewer`** — they are not **creating** something
  outward-facing but **withdrawing** it, and making a sanctioned member unable to take down the very photo that caused
  the problem is not a sanction but a dead end. Cover `DELETE` is **idempotent** and does not move the `story` row a
  cell, but ownership **is** checked even with no cover (being able to receive success against someone else's story
  makes that response information).
- **The response is the resource after the change** (`StoryCoverResponse = { story }`) — returning `{ version }` and
  letting the screen assemble the URL puts a copy of the server's rule in the browser, and that copy goes stale the day
  the deployment changes the rule.
- **There is no invalidation in the cover cache policy** (a cover moves neither list membership, order nor metrics, so
  there is no reason to force a refetch). Instead we seat the new value in exactly the **four places** it is held —
  the gallery, the public profile grid, the story detail and `발행한 작품`. The profile grid is easy to miss, and for
  someone who changed their cover with their own profile open, only that cell keeps the old picture.
  **Do not invent cells that are not there** (the server answers 404 for the detail of an archived or operator-hidden
  work). The screen not appending `?cacheBust=${Date.now()}` is the same axis.
- **`CreatorWorkDto` has `coverUrl`.** Without it the management screen would have to call `GET /v2/stories/:id` per
  row to learn the current cover, and that query passes the viewing gate, so **it is a 404 for your own archived or
  operator-hidden work** — the value is unavailable exactly when you most want to change the cover. Cover management is
  therefore drawn **even with no local draft** (a cover is owned by the publication, not the draft).
- **Do not build a general upload endpoint** (`POST /media` where the body decides the kind makes the policy a value
  that rides along with the request, which is how bytes validated under the avatar cap become a cover). Writing belongs
  to the domain that owns that media.
- **Do not create fake media rows for default avatars** (that stacks the same bytes once per member). An external avatar
  service is worse (a host we do not control sees the viewer's IP and email hash) — the screen draws the name's initial.
- **The avatar URL comes from two axes** (the media pointer first, the legacy `member.avatar_url` as fallback). The
  merge rule is `avatarUrlOf` alone, and the condition for extracting the media id (`status = 'ready'`) lives inside the
  `memberAvatarMediaId` constant — there are three consumers, so writing the join separately means one of them omits
  that condition, and the symptom is one broken image, which is silent.
- **Account deletion removes rows and bytes by different means** (`media.owner`'s cascade takes the rows, but the bytes
  are behind a port so Postgres does not know about them — the deletion service collects the keys **inside** the
  transaction and deletes them **after** the commit). If that cleanup fails **the deletion still succeeds** and the
  count rides in the audit summary.
- **⚠️ `media.owner` is nullable** (the same pattern and the same reason as `story.owner`). SQL's WHERE does not treat
  NULL as true, so `owner = :viewer` drops ownerless rows (fail-closed) — **do not build `owner <> :viewer` or `NOT IN`
  shapes over this column** (that is the day this judgement flips).
- **A file over the limit opens a crop surface instead of a rejection — and only that file does.**
  The client's preflight is unchanged (`checkAvatarFile` · `checkPickedAvatar`, still not a validation
  boundary); what changed is where `too_large` goes, and that fork is a pure function both apps call
  (`avatarIssueOpensCrop`). **The order inside the preflight is that fork's safeguard** — format is
  decided before size, so an over-limit GIF still lands on the format message rather than a crop screen
  the server would reject afterwards. The geometry lives in `@rowcat/domain`'s `avatar-crop.ts` because
  the two apps draw it with entirely different input devices (pointer + canvas ↔ `PanResponder` +
  `expo-image-manipulator`) and **the rectangle must not differ by a pixel** — a divergence there is not
  an error but "my face got cut off", and it does not reproduce. **The untouched confirm is the old
  behaviour**: the initial view is exactly the server's centre crop, so anyone who does not drag gets what
  they got before. Output size derives from `AVATAR_STORED_EDGE` (the server's own output edge, now in
  contracts) rather than a literal — hand-written, the day that number goes up, cropped uploads alone are
  **upscaled**, and that shows up as quality, not as an error. **Server validation did not loosen by a
  character**: those bytes are decoded and judged again, and having passed the crop is not grounds to skip
  anything.
- **There is no image moderation.** We do not build an NSFW classifier, OCR, perceptual hashing or a review queue — what
  the upload boundary decides is **whether the file is a safe format**, not whether the content meets policy, and
  blurring that sentence makes us claim to do something we do not. Policy-violating covers are handled by the existing
  story report path.
- **It is not an asset library** (one avatar per member, one cover per story, no history). An admin media browser,
  albums, video, presigned uploads, a CDN management screen, a crop editor and variants are not this slice.

### Publication media references — which images a story depends on

**`play_payload`'s `assetId` is a reference, and the database did not know it as one.**

```text
publish·update   reconcile story_media with that snapshot in **the same transaction** as the playback snapshot commit
delete account   keep only the media that a surviving story still points at, with identity detached (owner = null)
```

- **It is not "keep every scene image".** The shortest fix — dropping `kind <> 'scene_image'` from the deletion cleanup
  — **keeps forever even images nothing points at** (ones that only ever lived in a draft, ones removed in a later
  version, ones uploaded and never used). Account deletion promises "erase this account's traces", and that rule sells
  the promise for one kind name.
- **The deletion path does not parse `play_payload`** (then deletion would know the playback snapshot's **shape**, and
  the day the contract changes that parser quietly returns an empty list — the result of that silence is a surviving
  public story's images disappearing).
- **The two foreign keys have different delete policies**: `story_id → cascade` (a reference is a property of the story)
  and `media_id → restrict` (**media with a live reference cannot be deleted**) — miss the retention and account
  deletion **bounces entirely.** Stopping loudly beats being deleted quietly.
- **Sync is reconciling to a final state, not adding** (`A, B` → `A, C` results in `A, C`, not `A, B, C` — adding only
  makes this table not a set of references but **a list of every image ever used**). The function **requiring a
  transaction as an argument** is the expression of that atomicity (there is no `db` default).
- **The basis is "does a surviving story still point at it"** (a public work stays with identity detached, and its
  images must live too — the case where two stories share an image and only one is deleted
  comes out right for free under that predicate).
- **The order is everything** (account deletion deletes the stories that are going first and **then** looks at the
  remaining references — every reference remaining then belongs to a surviving story, which is why that query has no
  condition about which stories survive). **Draft references are not here** (this table records only **published
  snapshots'** dependencies).

## Public profiles

**The face of a person as seen from outside** (`docs/profile/ARCHITECTURE.md`, `services/account/profile.ts`).

- **The projection is an allowlist** (only the five fields listed in `PublicProfileDto` go out and the server selects
  only those columns). A **subtractive** shape such as `const { email, ...rest }` blocks only the fields it knows
  today, and the value publishes itself automatically when the member table grows a column — a test that **counts the
  response's whole key set** guards that boundary. **Member status, the three adult-gate axes and the signup date are
  absent** (the first two are the operator's and authorization's axes; the signup date tells you the account's age with
  no product reason to publish it).
- **The address's identity is `member.id`** (building addresses from nicknames — a display name with neither a
  uniqueness constraint nor a change cooldown — makes renaming break links other people saved). **The model is named
  `PublicProfile` and only the address says `제작자`** (someone who only wrote comments must have this address too, so
  pinning `Creator` into the type eventually produces a `UserProfile` with identical fields).
- **The story grid uses the same predicate as the gallery and the one axis that differs is `ownPrivateVisible`** — the
  discovery screen includes the viewer's own private work and **the public profile does not** (if only the owner saw a
  different list, there would be no way to check how their profile looks from outside). That is why `?creator=` was
  removed from the gallery. **The total is counted with the same predicate as the list** (written separately, that
  number is itself an information leak).
- **The profile's only writes are the two relations** (nickname and bio belong to `/account`, and relations **do not
  change this profile's content**). **The follower count is a public aggregate so it rides on the profile**, while
  "am I following this person" does not (that is a viewer relation and `/me/state` answers it — entering the profile
  personalizes this response and the shared cache collapses).
- **Account deletion naturally makes the profile a 404** (it must be **the same 404** as a nonexistent id).
- **There are two cache prefixes** (`["creators","profile",id]` is the same public value for everyone;
  `["creators","stories",id]` varies by viewer — the server cache splits on the same axis, `public, max-age=60` vs
  `private, no-cache`).
- **Moderation is unresolved** (profiles and public work of suspended or blocked accounts stay **as they are** —
  404ing only the profile produces a state where the work is visible but the creator link is dead, and that is not a
  policy but the mismatch an absent policy creates).

## Relations — follow and block

- **The request carries the desired final state** (`following`, `blocked` booleans; not a toggle — a retry from a client
  that lost its response must not flip the state). The contract has **no slot for a subject.**
- **Hiding a button is not a defence** (rejections for yourself, a nonexistent member and someone you have blocked are
  all decided by the server and go out with stable codes). In particular **a nonexistent member must be a 404, not an
  FK-violation 500**, and that 404 is indistinguishable from a deleted id.
- **Blocking severs the follow in the same transaction, and a blocked person cannot be followed again** (with only the
  former, one request revives "blocked but following"). **Unblocking does not revive the follow.**
- **The follower count is not denormalized** (both mutating responses carry **the absolute value after the change** —
  a screen guessing ±1 drifts the number the moment that guess is wrong).
- **Blocking means "remove it from my screen" and promises nothing more** (work is filtered by the central predicate,
  comments by the list predicate, on author). **It neither blocks their viewing nor notifies them** — copy promising
  stronger privacy than that endangers whoever acted on it. **Blocking is not moderation** (nothing changes on anyone
  else's screen and no comment row on the server is deleted).
- **Cache policy belongs to `@rowcat/query`** (follow is optimistic; block is swept **immediately** after confirmation
  — invalidation alone leaves that person's work on screen until the refetch finishes). There is one cell blocking does
  not touch: the public profile's **identity.**
- **The following feed is one filter on the gallery** (`?following=true`; we do not build a `/following` page). Guests
  do not get the axis drawn at all, and if it is left in the address we fold **only the query.**
- **Following creates an in-app notification, inside `setFollow`'s transaction and only when a row was actually
  INSERTed** (the API is idempotent so retries are the normal path, and not checking that piles a row into someone's
  inbox per button press).
- **There are no follower or following lists** (the relation graph being able to support them is not a reason to grow
  screens).

## Story comments

- **Comments are server state** — the **only user-authored content where the server holds plaintext** in this
  repository, and the source of truth is Postgres alone (it does not go into IndexedDB, the codec registry or
  `localStorage` — what someone else wrote was never on my device to begin with).
- **The author comes only from the session** (the request contract has no slot at all for `authorId`, nickname, avatar,
  `storyId` or a timestamp — not "received and ignored" but inexpressible). Which story it is is decided by the path.
- **There is one gate** (`requireCommentableStory`) — three endpoints go through the same function, and inside it two
  questions are answered in order: is this story visible under **the same predicate** as the detail, and is it public.
  Archived and operator-hidden are caught by the first; private by the second (being visible to the owner and public
  discussion being possible are different questions). **Only the private-story 404 has a different code**
  (`story_comments_unavailable` — the only person reaching that branch is the owner already looking at it, so existence
  hiding is not broken).
- **Ownership is pinned in the predicate** (deletion matches `id + story_id + author`, so a request pointing at someone
  else's comment deletes 0 rows and becomes a 404 — we do not read-then-delete).
- **On account deletion that person's comments are deleted** (not anonymized) — public work stays with identity
  detached, but a comment is that person's **utterance**, and keeping it would require standing a name such as "deleted
  member" on the screen, which is re-erecting an identity we erased. **The one exception is structural**: a top-level
  comment with other people's replies becomes a tombstone (below), because deleting it would delete *their* utterances.
  A tombstone is not an anonymized comment — it carries no author and no body at all.
- **The cursor is `(created_at, id)`, oldest first** (offset misaligns on a list that grows while you read it, and the
  id rides along because with no ordering between two rows in the same millisecond, page boundaries duplicate and drop).
  **The column precision is part of that promise** (`timestamp(3)` — with microseconds, a row at the boundary appears
  twice across two pages).
- **Do not splice a new comment into the cache unless the last page has been seen** (spliced, the same row appears twice
  the moment `더 보기` actually fetches that span). **No optimistic insert or delete** (a server-confirmed value carries
  a timestamp and an author representation that a temporary row would have to invent, and an optimistic delete revives a
  deleted post on failure).
- **The body is drawn as plaintext** (we use neither `dangerouslySetInnerHTML` nor a markdown renderer — there is not
  yet a trusted markdown pipeline in this repository, and standing one up for comments would make the least trustworthy
  input its first consumer). The only tidying is the contract's `.trim()`.
- **Do not build a comment count** (an aggregate no screen reads only adds something whose drift must be managed).
  **Do not put bodies in logs.** **Rapid-fire prevention is a floor, not a rate limiter** (5 per 30 seconds per member,
  with `Retry-After`).
- **Writing a comment is a transaction — because of the notification ledger** (a ledger INSERT is the same correctness
  boundary in the same DB so it comes inside, while push, mail and webhooks still cannot). Split, a state where "the
  comment exists but its owner never finds out" stays committed.
- **There is no sorting, search, editing, pinning or @mentions** — put any one of them in the model and the screen
  starts drawing that slot, with storage and moderation rules following.

### Replies — one level, and the tombstone that makes it safe

**A reply is a comment with a `parent_id`.** There is no second table, no second DTO, no second report target and no
second moderation action — splitting them makes every one of those rules two copies, and the copy that goes missing is
usually the narrow one (a screen where replies cannot be reported).

```text
story_comment   parent_id null → 최상위,  값 → **최상위의** 답글(한 단계뿐이다)
                author null + deleted_at + body ''  →  묘비(구조만 남은 줄)
```

- **The one-level rule is a service predicate, not a column.** There is no `depth` and no `root_id` — those are values
  you can compute, and storing them makes a row that disagrees with `parent_id` representable. The parent is locked
  (`FOR UPDATE`) inside the same transaction as the insert, so "the parent was deleted while the reply was being
  written" is not a state that can commit. A reply to a reply is `comment_reply_depth_exceeded` (409).
- **⚠️ `parent_id` is `ON DELETE NO ACTION` and that is the most important line in the feature.** `cascade` is the most
  natural choice and it makes deleting your own comment delete **everyone else's replies**; `set null` promotes them to
  top level and scatters the thread. With `no action` Postgres checks at **statement end**, so a story's cascade (which
  removes parent and children together) passes while a lone delete of a comment that still has replies **fails loudly** —
  code that forgot the tombstone path stops instead of quietly destroying other people's writing.
- **Deleting has two outcomes and the server says which.** A comment with surviving replies becomes a **tombstone** (the
  row stays; body, author and its reactions are erased); anything else is physically deleted. `DELETE` therefore answers
  **200 with `{ comment }`** — `null` means the row is gone, a value means it is now a tombstone. It was 204, and the
  reason it changed is that the client cannot otherwise tell the two apart except by guessing from `replyCount`, which
  goes stale the moment someone else replies. Old clients are unaffected (the SDK's `requestVoid` discards bodies).
- **The tombstone stores nothing.** There is no `deleted_body` column and no nickname snapshot — moving the text to
  another column is not deleting it. The audit snapshot moderation needs comes from the **locked row read**, so the
  operator path is byte-identical whether the row survives or not.
- **`StoryCommentDto` is a discriminated union on `state`.** A tombstone has no `author`, no `body` and no reaction
  counts — the type cannot represent "deleted but still carrying a body", so no screen can accidentally draw one, and
  `body === ""` is never the deletion test. The `visible` variant is a **superset of the previous DTO**, so old clients
  still decode ordinary comments; a tombstone is a genuinely new state and we do not fake an author to hide that.
- **New replies to a tombstone are refused** (`comment_reply_to_deleted`, 409) while **existing replies stay readable** —
  what is blocked is starting a new exchange with someone who left.
- **Replies are their own resource** (`GET·POST /v2/stories/:id/comments/:commentId/replies`). The top-level page carries
  `replyCount` and never an array — embedding replies makes one page's cost proportional to thread length and needs a
  second pagination inside it. A mismatched or non-top-level parent is a **404, not an empty page**: an empty page makes
  `200` mean "something is there", which is a probe for another story's comment ids.
- **The parent is always in the path.** The reply request body is `{ body }` — the same schema as a top-level comment,
  so a request whose path and body point at different parents is inexpressible.
- **Aggregates are set-oriented — two queries per page, not two per row.** Reply counts (`parent_id in (…) group by`)
  and reactions (`comment_id in (…) group by`, with `bool_or(member_id = viewer)` for `viewerLiked`) are read once for
  the whole page; a query-count test on real Postgres pins that the number does not move when the page doubles.
- **⚠️ Blocked authors need `or(isNull(author), notInArray(…))`.** `NULL not in (…)` is NULL, not true, so the plain
  predicate makes **tombstones disappear** for any viewer holding a block list — and then their replies float without a
  parent. Reply counts pass through the same predicate, or `답글 1개 보기` opens an empty thread.
- **A reply notifies the parent comment's author, and only them** (`comment_reply`). The story owner does **not** also
  get `story_comment` — one reply must not become two rows saying the same thing in two different voices. The self and
  blocked gates are the existing `notifySocialEvent` ones.
- **Replies share the top-level rate-limit policy** (`storyCommentCreate`). A separate window would let one person write
  ten rows in 30 seconds; what the limiter counts is how fast a person writes, not which list it lands in.

### Comment reactions — exactly one, and it is quiet

- **The public vocabulary is `like` and nothing else** (`STORY_COMMENT_REACTION_KINDS`). The `kind` column is open so
  the schema does not need a migration later, but the product sells one reaction — an emoji picker is not this slice,
  and a kind outside the vocabulary is a **404 on the path** (answering "unsupported reaction" would publish the list).
- **`PUT`/`DELETE`, not a toggle.** A toggle makes a retry that lost its response undo what the user just did, and the
  server has to guess what was wanted. Both verbs are idempotent and both answer with the comment as it now stands, so
  the cache replaces a row rather than doing arithmetic.
- **A table, not a counter or an array.** `story_comment_reaction (comment_id, member_id, kind)` is the primary key and
  therefore the final authority — a burst of presses is one row. Counts are read at read time; **do not denormalize
  without profiling** (a counter buys drift you cannot reconcile because there is no ledger to ask).
- **No notifications for likes** — deliberately. One popular comment would fill an inbox, and then people stop reading
  the inbox that also carries enforcement and appeal notices.
- **Tombstoning deletes that comment's reactions explicitly** — the FK cascade does not reach a row that survives, and
  a tombstone with a like count is a count for a statement that no longer exists.
- **Optimistic reaction state is not used.** Five presses would stack five ±1s while the server's truth is always 0 or 1;
  the confirmed row is written into the cache instead, scoped per comment so one row's press does not queue behind
  another's.

### What replies changed elsewhere

- **Creator analytics counts current non-deleted user utterances, including replies** — tombstones are excluded
  (`deleted_at is null` in both the per-story and the total query, and the two must agree). There is no separate reply
  metric; the question the screen answers is "how much did people say about my work".
- **Moderation vocabulary did not grow.** A reply is reported as `comment` with the same `(storyId, commentId)` pair,
  and `remove_comment` goes through the same delete function — so an enforcement against one comment cannot delete the
  innocent replies beneath it. `getStoryCommentById`/`getStoryCommentSnapshot` treat a tombstone as absent, so no
  moderation-unaware query can still reach a deleted body.
- **Account deletion is two steps and the order matters**: tombstone the roots that carry other people's replies, then
  delete the rest. Reversed, the DELETE fails on the FK — which is the intended direction (a loud stop beats silently
  destroying other people's writing).
- **Blocking still does not stop writes.** This slice did not change that rule: blocking means "remove it from my
  screen", and stopping someone from writing on a public story is moderation's authority, not a personal setting's.

## Moderation

Reports, enforcement, appeals (`docs/moderation/ARCHITECTURE.md`).

- **Four things are different from each other**: a report (who asked for review) · a case (what happened around one
  target) · an action (who enforced what) · an appeal (the rebuttal of whoever was enforced against). Folding them into
  one table with a `type` column makes "a report is enforcement" representable. **A report is not enforcement** (the
  request contract has **no** fields such as `ban` or `hide`, so a reporter choosing the punishment is not expressible).
- **Actions are not edited** (a reversal has `reverseAction` leave **a new row** and fill only the original's
  `reversed_by` — there is no statement in the store that UPDATEs a kind or a reason).
- **Closing a report has the same conflict-of-interest rules as enforcement** (`assertMayResolveReport`): never a report
  about yourself, and a report about an operator account is an admin's to close. It was the one moderation write without
  them — a staff member could dismiss every report about their own account and the case never reached an admin. A
  report whose target is gone still closes (refusing it would leave reports nobody can close).
- **`member.status` is derived from the action ledger** (every path touching an account axis calls
  `recomputeMemberStatus` in the same transaction) — with one function that takes a status and writes it verbatim,
  a call site that says "this action was reversed, so approved" inevitably appears, and that code **ignores other
  active actions.**
- **Hiding a story touches only `hidden`** (`visibility` is the creator's axis, so having an unhide set it back to
  `public` publishes work they had made private). `updated_at` is untouched too.
- **Comment deletion is `DELETE ... RETURNING`** (the deleted value and the audit snapshot come from one statement, so
  "read after deleting" is not expressible, and it is **one transaction** with the action record).
- **The role is `member.role` and there is no promotion path in the product API** (the only way to change it is
  `db:seed:moderator` — a role patch under `/me` is the day anyone can make themselves an operator). **The operations
  gate is `requireModeratorViewer` alone** (standing on top of `requireActiveViewer` — a suspended operator does not
  get in).
- **Capability restrictions are only three — `comment.write`, `social.write`, `story.publish` — and a real route checks
  each.** `chat.generate` is **deliberately absent**: BYO generation does not pass through our server, so a restriction
  is defeated by one line of their own key, and in that state "generation is restricted" is a sentence that is not true.
- **Blocking stays open under a `social.write` restriction** (it is an operation that reduces interaction rather than
  creating it, and taking a self-protection tool away from a sanctioned member is using a safety feature as part of the
  sanction).
- **Expiry is decided by a predicate** (the sweep job is not a correctness condition).
- **Reporting an AI response is the only path that leaves E2EE.** The evidence is the three things
  `AiResponseEvidence` (`.strict()`) holds — the reported response, the immediately preceding message of mine that was
  selected, and the model alias — and room history, memories, the seed, lore, the system prompt and room/message ids
  have **no slot in the schema.** **The server takes the evidence for public targets** (if a reporter can invent
  evidence, that evidence is not evidence). **Every target you cannot see is the same 404** (down to the code).
- **`/v2/me/moderation` exists separately** (bolting restriction lists and appeal status onto `/me` makes every route's
  SSR HTML carry that person's sanction history). That router's gate is **`requireViewer`** — a sanctioned person is
  precisely who needs this screen, and locking appeal submission too removes any way to object. **The two reasons are
  different cells** (the operator's internal `reason` has no slot in the member response type — not code that picks
  fields out but **an entirely different type**).
- **The operations UI is `apps/admin` alone — there is no `/moderation` in the web.** While both apps drew the same
  queue, the flaw was not duplication but **drift**: reliability improvements landed only in the console and both call
  the same API, so no test broke. What remains in the web is **one link** in the account screen (address from
  `VITE_ADMIN_ORIGIN`; **unset means the section is not drawn**), and that link is not authorization. The test guarding
  that absence blocks **the names of operator-only queries and operations** rather than a word, because reports,
  appeals and 내 신고 must not be blocked with it.
- **Do not put bodies in logs** (what diagnostics need are report id, case id, action id and target kind).
  **Account deletion forks three ways**: a report carrying private conversation evidence is deleted whole; a case whose
  target vanished with it is deleted too; a report about someone else's content has **only its identity** detached.
- **Enforcement reaches the target as an in-app notification.** The operator's identity and the internal reason have no
  slot in it, and **accepting an appeal does not send a separate lifted notification.** There is no automatic
  classification and no email notice (V1).

### My reports — the lifecycle the reporter sees

**One projection of the existing `moderation_report` rows.**

- **The reporter's vocabulary is only two** (`reviewing`, `reviewed`) — **a different vocabulary** from the three
  internal dispositions (`open`, `resolved`, `dismissed`), and `myReportStateOf` alone owns the folding. We do not emit
  `dismissed` as `기각됨` because that becomes a disposition notice — the reporter would infer from that value what did
  (or did not) happen to the other person.
- **`MyReportDto` is an allowlist** (six fields). `ModerationReportSummaryDto` is not reused because it has `caseId`,
  `caseReportCount` and the internal `status`, and **a test that counts the response's key set** guards the boundary.
  **The absence of `targetId` is intended too** (the reporter already knows what they reported, and carrying it makes
  this list a tool for asking "is that id still valid"). **Do not tell the reporter how many reports that target has**
  (material for coordinating targeted reporting or detecting moderation activity).
- **Ownership is pinned in the SQL predicate** (there is no slot for `reporterId` in the contract or the SDK signature,
  so "show me Bob's reports" is **inexpressible**). Do not open a reporter filter under `/moderation` — that prefix is
  the operator's, and one request that forgets the parameter is the whole queue.
- **Do not re-query the target** (then the moment an operator hides or deletes a reported story, that row drops out of
  the reporter's history — a list that vanishes exactly when you most want to check — and whether a row is visible
  becomes a detector for the target's current state).
- **The gate is `requireViewer`** (making a suspended member unable to read their own report history is not a sanction
  but holding their own records hostage). **It is read-only** (no withdrawal, edit, reopen, reason change or message to
  the operator, and no disabled buttons holding those places either — the route being a single `GET` is the expression
  of that absence).
- **Do not invent a processing deadline.** `7일 이내`, `예상 완료` and `지연됨` are neither on the screen nor in the
  contract — the software offers no voluntary SLA (a deployment that wants one writes it into its own policy first),
  and a screen that invents one makes a promise the operator may not keep. A statutory deadline is a different axis (when the
  product sold things, the three business days for refunds stood in the refund policy with its basis). **Do not merge
  a legal obligation and an operational promise into one sentence.**
- **The notification attaches to the report transition, not the case closing** (a `report_reviewed` row is created
  **inside the same transaction** where `resolveReport`'s conditional UPDATE (`status = 'open'`) succeeded). Attached to
  case closure, (1) the owner of the report closed first waits until the remaining ones close, and (2) creating the
  notification requires reading that case's **list of reporters.** One conditional UPDATE solves idempotency (a retry
  that lost its response is a 404) and contention together.
- **Do not use `notifySocialEvent`** (that function's two gates — self and blocked — are rules for events with an actor,
  and there is no actor here; passing through the block gate means a reporter who blocked that operator never receives
  the review completion).
- **A deleted reporter (`reporter = NULL`) does not block closing** (throwing lets one account deletion block the
  operator's queue forever, and resurrecting the identity to send it is worse). **Filing does not create a
  notification** (re-announcing to your inbox what you just did is noise; the durable receipt is this list).
  **Marking a notification read does not change moderation state.**
- **The screen is a section of `/account`** (`/moderation` is an operations tool in this repository, so `beforeLoad`
  sends members with no role away — which is why the notification's destination is `/account` too). The state ordering
  (paused → failed → loading → empty) belongs to a pure function: **drawing failure as "제출한 신고가 없습니다"** makes
  someone who just filed a report read it as us having lost it.
- **The query key is `["moderation","me","reports"]` and after filing we invalidate that one prefix** (a report is not
  enforcement and does not move public state by a cell). **Mail, SLAs, withdrawal, support conversations and automatic
  classification are not this slice.**

## In-app notifications

**Private state the server owns** (`docs/notifications/ARCHITECTURE.md`).

- **The third place ownership lives.** Conversations and drafts belong to the device, stories and comments to everyone,
  and **a notification is read by its recipient alone.** The path is one — `Postgres → API → SDK → Query → screen` —
  and **it does not enter IndexedDB, the codec registry or `localStorage`**: with read state diverging per device, a
  notification read on a Mac becomes new again on a phone, and that state does not heal itself.
- **Reuse nothing from sync.** In particular do not put notifications on `/v2/me/sync/events` — that stream is a layer
  carrying only "your namespace may have moved forward", and loading social events onto it collapses the zero-knowledge
  claim. **There is no notification-specific SSE or WebSocket in V1** either (the badge lives on one 60-second poll).
- **The kinds are a closed list with no placeholders** (`follow`, `story_comment`, `comment_reply`,
  `creator_story_published`, `moderation_action`, `moderation_reversed`, `appeal_resolved`, `report_reviewed`,
  `app_update`). Your own comment, unfollows, blocks, favourites, **report filing** and conversation
  creation are none of them.
- **`creator_story_published` is the one social event with many recipients, and that is the whole of its server
  shape.** A story entering `public` **for the first time** notifies the creator's current followers, and the write is
  **one set-oriented `INSERT … SELECT … FROM follow`** (`notifyFollowersOfSocialEvent`) that carries the self and block
  gates in its own `where` — looping `notifySocialEvent` per follower is exactly N+1 and that cost does not reproduce
  on a development account with three followers. **The block predicate is one shared SQL fragment** with the
  single-recipient path; written twice, only one gets fixed and the divergence shows up only as "I blocked them and
  still get their story notifications". The source key is **per story** (`story-published:<storyId>`), and that one
  value *is* the product invariant: **one follower + one story = at most one row**, so a retried publish, a rerun
  transaction and a `public → private → public` round trip all add nothing.
- **What makes it an event is the transition, not the destination.** The predicate is
  `after === "public" && before !== "public"` (`enteredPublicVisibility`), and it lives in **one** place because
  **three** paths write `story.visibility = 'public'` — initial `publishStory`, `updatePublishedStory`, and the
  lifecycle `publishStoryPublicly`. Miss one and only that path goes silent, with no symptom. Read it the other way
  and republishing an already-public story (a normal edit: title, cover, runtime) reaches **followers gained since**,
  who receive a months-old work as "new". `unlisted` is not a destination — it is not in the catalogue, so "a new work
  is out" is not true of it. **The notification writes commit in the same transaction as the transition**, so a
  rejected publish leaves no row.
- **The last two diverge from the rest.** The others are **something a person did (to this account, or — for
  `creator_story_published` — to a creator I chose to follow) or an operator did to this account**; `report_reviewed` is **a completion notice for a procedure I requested** (carrying neither target nor
  disposition); and `app_update` is **a fact the operator announces to everyone** (no actor, not
  passing the self and blocked gates, with effectively every member as recipient). They live in the same inbox anyway so
  as not to build a second inbox.
- **Only `app_update` carries values rather than references** — **even though the floor row really exists**, and
  that existence is the reason: that row is a setting the operator keeps changing, so as a reference one floor change
  rewrites the meaning of every notification already sent (a row that announced 1.2.0 reads as having announced
  1.4.0). **Do not substitute the current state at read time** — a notification is what happened then.
- **What is written to the ledger is inside the original transaction; what goes outward is outside it.**

  ```text
  INSERT notification      the same correctness boundary in the same DB — inside the transaction
  push · mail · webhooks · queues   outbound calls — they cannot come inside
  ```

- **Do not build a general event bus** (there are only four wiring points, and a dispatcher makes the wiring vanish from
  the code — you can no longer grep which write produces which notification). The authoritative write calls a narrow
  notification service **directly.** **The service decides the recipient, not the route** ("who owns this story" is a
  relational question).
- **Do not put content in the row** (neither comment bodies, finished copy nor web URLs are columns — names, titles and
  reasons are joined from the current source rows at read time). Storing the copy freezes Korean into the server where a
  later Expo cannot use it, and carrying an `href` hands that app a value it cannot use — the destination is built by one
  pure function in the web.
- **`source_key` is the idempotency key and `UNIQUE(recipient, source_key)` is its final authority.** **Follow alone is
  per actor** (`follow:<actorId>`) and that is the point — per event, follow/unfollow cycling alone could fill someone's
  inbox without limit (following again **revives** that row). The rest use `onConflictDoNothing`: a retry must not turn
  an already-read notification back into unread.
- **Social notifications have two more gates** — do not notify yourself, and **do not notify when the recipient has
  blocked the actor.** Filtering on screen is not enough: that row must not enter the inbox in the first place and must
  not count toward unread. **Blocking sweeps away social notifications that person already created, in the same
  transaction** (moderation notifications have no actor so they are not caught). **Unblocking does not revive them.**
- **The operator's identity is not in the notification** (a moderation notification's `actor` is always NULL, and what
  goes out is one action reference and its **public reason** — which is why we did not reuse the operator DTO and made
  `NotificationActionDto` separately).
- **Accepting an appeal is one row** (acceptance reverses the action internally but does not create
  `moderation_reversed` — `appeal_resolved` alone already says why it was lifted, and sending both makes one event two
  rows). That is why the notification lives at the call site rather than **inside** `reverseAction`.
- **Four endpoints, all under `/v2/me/notifications`** (there is no slot for naming a target member in the path, query,
  body or headers). Someone else's notification is **the same 404 as a nonexistent one**, and every response is
  `no-store`. **The gate is `requireViewer`** (an inbox holds why you were sanctioned and how your appeal was handled —
  read marking is a write yet stays open because it is not an outward interaction but **private state of your own
  inbox**).
- **The unread count is a dedicated query** (not bolted onto `/me`, the hottest read the root SSR takes every time).
  **Do not count from accumulated pages** either (a client holding only the first 20 rows always counts low). Mark-all-read
  is bounded by one server UPDATE statement, so a notification arriving at that same moment stays unread (we do not take
  a client timestamp).
- **Every query key is under `["viewer", ...]`, but signing out must be `resetQueries`** — invalidation alone leaves the
  value, and the header's badge has an observer that immediately redraws it (a P0).
- **Opening the bell is not reading** (if a glance cleared the marker there would be no way back — V1 has no "mark as
  unread"). The popover draws only the most recent rows and the full history is continued by `/notifications` with
  `더 보기` (not infinite scroll — account history is not discovery).
- **There is no notification deletion and no per-kind delivery setting** (V1). One more reason not to build per-kind
  toggles: moderation notifications become something you can turn off by accident.
- **A notification is not an audit record** (the audit record for enforcement is the `moderation_action` row; a
  notification is a copy made to tell a person and gets deleted — writing code that reconstructs enforcement from
  notification history makes those deletions data loss).
- **Account deletion erases the received inbox and detaches only the identity in other people's**
  (the screen draws `삭제된 사용자`).

### Native push — the delivery plane

```text
product event → durable notification row → push delivery → Expo → OS banner
                 ↑ authority              ↑ best effort · retryable · not authority
```

- **The inbox still answers everything**: does the notification exist, what does it mean, **was it read**, history,
  where does it go. If push fails that row is still there and the user opens the app.
  **`NotificationKind` did not grow** (no new kind and no vocabulary such as `push`).
- **Registration is bound to the auth session, not the member** (`push_registration.session_id`, `on delete cascade`) —
  **signing out is unregistering**, and that guarantee comes from the database rather than our code's diligence (even if
  the unregister request fails on one network, a device that signed out does not keep receiving). **Do not block
  signing out on that request.**
- **The entitlement predicate is read at two moments and the fragment is one**
  (`activePushRegistrationPredicate`). Having been entitled at creation time **does not mean it is fine to send now** —
  a delivery can sit `pending` arbitrarily long through backoff or a stopped job. So it passes the same fragment once
  more **inside the claiming transaction** (asking beforehand from outside opens a window between asking and claiming).
  Written separately in two places, only one loosens and **that divergence raises no error.**
- **A delivery that lost entitlement is finished, not filtered** (`registration_inactive`) — merely excluding it from the
  detail query leaves the row `pending` and **it occupies every batch.** **The notification row is untouched even then.**
  Receipts do not pass this check (a notification Expo already accepted cannot be taken back).
- **The delivery is written in the same transaction as the notification** (created outside, notifications from a process
  that died in that window are never pushed — idempotency blocks a second insert). **It attaches only to events that
  actually happened** (a retry swallowed by `onConflictDoNothing` creates no delivery, and a row revived by `refresh` is
  **a new event**, so it sweeps away the prior delivery and creates a new one — it is a revival reusing the same row id,
  and without that the delivery's unique constraint silently swallows the second dispatch).
- **A broadcast is a set too** (the id list `returning "id"` gave from the notification INSERT is handed to **one**
  delivery INSERT — as a loop it spends time proportional to the member count while that transaction stays open).
- **A delivery failure does not roll back the notification** (no statement on the delivery path UPDATEs a `notification`
  row, and a static scan guards that absence).
- **A ticket is not delivery** (Expo having accepted it and APNs/FCM having delivered it are different facts, so we check
  receipts once more — without it, a registration for a device that deleted the app lives forever and every notification
  for that member goes out in vain). Only `DeviceNotRegistered` **turns that registration off**, and one device's failure
  does not block another's.
- **The lifetime is 24 hours** (raising a banner for a comment from three days ago because the job was stopped is not a
  notification but noise). An expired delivery ends without sending and **the notification is untouched.**
- **It is not exactly-once — we say so honestly** (if the process dies after Expo accepted it and before the result is
  written, that delivery goes out once more after the 5-minute lease). The price of a duplicate is one banner appearing
  twice (the inbox is one row throughout).
- **Less rides on the lock screen than in the inbox** (the copy belongs to the server, `services/push/copy.ts`, and we do
  not lift the app's `notification-copy.ts` up). **Actor nicknames and story titles do not ride either** — a lock screen
  is seen by people who did not unlock the device and the OS stores it. Every title is the app's name alone (a different
  title per kind is itself classification information).
- **The payload is one reference** (`{ version, notificationId }`) — there is no server-built URL, and the contract is
  `.strict()` so a payload carrying such a key is rejected by the app (navigation belongs to the app). The notification
  id is **not authorization.**
- **"Turned off" is this installation's value and it has three states** (`unset`, `enabled`, `disabled`; device key-value
  store). The OS permission and RowCat's delivery decision are different values, so keeping the latter in memory alone
  makes an installation that pressed `이 기기에서 끄기` **come back on with an app restart.** As a boolean, *not yet
  chosen* and *turned off* become one value, and the moment the version rises that fold turns push off for everyone who
  had it on — which is why the auto-refresh gate asks **whether it is not `disabled`** rather than whether it is true.
  **It is not synced and does not go to the server.**
- **A failure does not make that decision** (turning on writes `enabled` **only after** the server accepted; turning off
  writes `disabled` **only after** the unregister succeeded — one pure module owns that ordering). Reversed, the server
  keeps sending while the screen and the auto-refresh believe it is off, and **that state does not heal itself.**
  Auto-refresh writes nothing even on success (it is something we did, not a fact the user chose).
- **Neither pressing nor receiving is reading** (a foreground receipt does not splice a row into the cache; it emits one
  "ask again" signal). **This is not web push** (no service worker, VAPID or browser notification permission).
  **There is no app icon badge** (V1 — pushes arrive out of order, duplicate, and can arrive after another device
  already read them, so using an absolute value as it comes makes that number **go backwards**).
- **Do not push update notes** (`app_update` announces that the minimum supported version rose; release news is a
  different thing the repository owns — merging them makes raising the floor an act of writing release notes).
- **Three settings**: `PUSH_TRANSPORT`, `EXPO_ACCESS_TOKEN` (optional, secret) and `BACKGROUND_JOBS_ENABLED`.
  **The third is the easiest to get wrong** — with only the first two filled in, registration succeeds, notifications are
  created and delivery rows pile up while nothing goes out, and that state has no symptom (`env:doctor` reports
  `degraded`). **Deliveries are written even with transport off** (what this layer answers is *is there something to
  deliver*; *can we send it now* is the job's question).

## Membership eligibility — age and guardian consent

The slice that lets someone under 14 **use the product normally** while making that account structurally unable to reach
adult content and direct-connection generation. Full rules and rollout order in
`docs/membership/ARCHITECTURE.md`.

- **Age is a different axis from the three adult axes and stands above them.** A child row with `verified`, `adult` and
  `show_adult` all on is genuinely representable (legacy data, bad seeds, operator error) and that combination opening
  adult content cannot be undone — so `canViewAdult` and `isAdultVerified` look at `isChildViewer` **first.** Do not
  place a fourth boolean alongside the three.
- **`unknown` is not a child.** Folding unverified into child strips adult content and BYO from every existing member
  the instant the gate turns on, and that is a sanction based on a fact never verified.
- **We do not store dates of birth.** The server folds that value into `age_status` + `age_threshold_date` (only for
  children) and discards it — there is no column, no slot in any response schema, and a static scan stops it leaking to
  logs. **For members 14 and over not even the transition date is kept.**
- **The age transition is done by a predicate** (`resolveAgeStatus`) — with a batch as the correctness condition, a member
  whose birthday passed stays a child for the day that job is down. The computation is always a calendar date in the
  product timezone (KST; counted in UTC the decision is off by a day for nine hours, and one of those directions passes
  someone not yet 14), and 14 years after a Feb 29 birth is **March 1** in a non-leap year.
- **There is one entry gate and `resolveMembershipGate` owns the priority** — the screen reads one server-computed
  `viewer.membershipGate`.
- **There is no terms gate — and a fork that adds one does not put it in front of a child.** Consent a child pressed
  alone is a juristic act their guardian can rescind (「민법」 제5조), so that screen would collect consent it cannot
  accept; a child's consent belongs inside the guardian consent flow.
- **Do not add a `member.guardian_approved` boolean.** 「개인정보 보호법」 제22조의2 제1항 requires not only obtaining
  consent but **verifying that consent was given**, and a boolean expresses only the former — above all it **cannot
  express withdrawal.** The absence of `expired` in `guardian_consent.status` is the same axis (expiry is decided by a
  predicate).
- **The final authority for the invariants is a partial unique index and a conditional UPDATE** — one open request per
  member, one valid consent, and approval is `where status = 'verified'` so a replay updates 0 rows and becomes a 409.
  Do not rely on the screen's disabled button.
- **Only the hash of the token is stored.** The plaintext rides once on the response that created the request and is gone
  — it cannot be retrieved by a status lookup, and creating a new request kills the old link.
- **The guardian screen's response contains no child** (no nickname, email, member id or signup date). If the link is
  misdelivered, what is learned is "there is one under-14 signup request" and no more, and **a test that counts the
  response's key set** guards that boundary.
- **`/v2/guardian/*` is outside `/me`** — the caller is not a member but a guardian holding a single-use link, and under
  `/me` **a path where a child's session confirms their own consent** becomes representable.
- **Identity verification is a capability and not part of this slice.** It lives in `services/identity/` and the fact that
  the adapter **imports nothing about guardian consent** is the basis of that boundary. **The port states facts and does
  not judge** — resident registration numbers, CI, DI and dates of birth have no slot in the type, and `adult` means only
  "is this person 19 or older". Half the PortOne adapter's job is **discarding**, and **what to store is decided by the
  consumer.**
- **The client does not join initiation and confirmation.** The server creates `identityVerificationId`, stores it on the
  consent request row, and **the confirmation request has no body** — able to carry an identifier, a path opens to attach
  someone else's verification to your own request. We do not read the values carried on the return URL either.
- **The server states the handoff method** (`IdentityVerificationHandoff`'s discriminated union) — guessed by the screen,
  the day a deployment changes provider we quietly follow the wrong procedure. The screen **does not proceed on an unknown
  kind.**
- **The verification provider is fail-closed.** Unconfigured is 503 and **a half configuration is unconfigured.**
  Production + `dev` **blocks boot.** **Do not build a dev-only verification HTTP route.**
- **A non-adult cannot be a legal guardian** — without this line a child completes identity verification on their own
  phone and creates their own consent, and at that moment the whole procedure is a formality.
- **A child loses exactly two things** (adult content, BYO — `MINOR_RESTRICTED_CAPABILITIES`). There used to be a
  third, paid purchases and subscriptions (`minor_purchase_restricted`); it left with billing. Managed generation,
  conversations, drafts, all-ages publishing, comments, relationships, sync and account deletion are **unchanged** — a
  child account is not a half account.
- **The rejection goes through one `requireNonChild` and the code splits per capability.** Do not reuse the adult gate's
  code — `adult_verification_required` means "complete identity verification and you are fine", which for an under-14 is
  a lie, and whoever follows that guidance hunts for a procedure that does not exist.
- **Enforcement of the BYO restriction is practically all client-side — say so honestly.** That request does not pass
  through our server so there is no place for the server to re-decide. **Do not "solve" it by routing through our
  server** (that breaks BYO's definition) and **do not delete stored keys.**
- **Do not build surveillance.** No guardian account, no family dashboard, no activity monitoring, no conversation
  viewing, no usage-time limits, no guardian notifications — a legal guardian's consent is **authorization for that
  account's use**, not a right of access to the child's privacy.
- **Public browsing is unchanged.** The gate stands **only in front of an authenticated member's screen**, and both a
  guest and a failed `/me` lookup pass (someone trapped has no way out).
- **The member-side gates are surfaces they cover, not routes** (a route added is a route missed). Conversely
  **the guardian screen is a genuinely public route** (`/guardian/$token`) — inside the app shell the entry gate would
  stand in front of it. The gates share the exits (sign-out and account deletion live **inside** the gate) and a
  static scan guards it.
- **A child exiting is not a failure.** Written as "you cannot sign up", that child goes back and edits their age, and at
  that moment we lose both the chance to identify a child and the protection. The sentence being short and gentle is not
  taste but 「개인정보 보호법」 제22조의2 제3항.
- **There is no self-service button for consent withdrawal** — the person who can request it is the guardian, who has no
  account, and we keep no stable reference to identify them again (that would require storing the CI). An operations
  script handles it (`guardian:revoke`).
- **There is a rollout switch** (`MEMBERSHIP_AGE_GATE`, off by default). **It does not apply to members already confirmed
  as children** — turning it off means "we do not ask yet", not "the law is off".

### Adult eligibility verification — a member's own identity verification

**The second consumer of the identity-verification capability.** It uses the same adapter as guardian consent but attaches
a different judgment to the fact (`apps/api/src/services/adult-verification.ts`).

- **Separating the consumers is the whole of this slice.** Different tables (`identity_verification` ↔ `guardian_consent`),
  different services, different SDK resources. Merged, an **interchangeable state** appears — a verification the guardian
  completed opening the child's adult entitlement is that path, and it is the most expensive defect in this repository.
  `adult-verification.ts` **imports nothing about guardian consent.**
- **The browser's success is not evidence.** What the SDK said "done" about is a value inside that browser, and the
  decision is made by the server asking the verification authority with its own secret. **The completion request has no
  body.**
- **The completion request does not name a target.** There is one open attempt per member per purpose (a partial unique
  index) so there is nothing to point at, and being unable to point makes **a request naming someone else's or an old
  attempt inexpressible.** That choice also solves the redirect return — even when the page leaves entirely on mobile
  there is no value to lose.
- **Verified ≠ adult.** Under 19 is a normal success too, and only `verified` turns on then. Do not tell that person
  "identity verification failed" — nothing actually went wrong.
- **Not knowing the age means not an adult.** If the authority does not give a date of birth, `adult` is false. Signup
  date, payment method, an existing `adult` value and self-declaration are none of them grounds for adult entitlement.
- **Entitlements are monotone.** `verified` and `adult` only turn on — a verification failure does not clear an already
  verified account's entitlement (a failure is "not verified", not "revoked") and a later minor verification does not roll
  back adult entitlement. Opening that path makes **an operation the user can invoke themselves a way to roll back
  identity state.**
- **Viewing freshness is a predicate on top of those columns, not a write to them** (`ADULT_REVERIFICATION_ENABLED`;
  turning it on in a deployment that already has adult members is an unfavourable change its own terms may require
  notice for). 「청소년 보호법 시행령」 제17조 제2항 lets a member
  check stand in for re-verification only **for one year**, so `adultRecheckRequired` (viewer projection, one LATERAL
  read of `max(identity_verification.verified_at)` where `adult = true`) closes **viewing** (`canViewAdult` ·
  `canViewAdultContent`) one KST calendar year after the last adult verification (Feb 29 → Feb 28 — the early side).
  `verified`/`adult` stay on, so **publishing eligibility and the `show_adult` toggle are untouched**; a later minor
  verification does not renew the deadline. Members with no such row are due the moment the switch turns on. The rule
  is `@rowcat/domain`'s `adult-recheck.ts`; the gallery's adult filter answers `adult_recheck_required`, not "display
  off". **This is why finished `identity_verification` rows live as long as the account** — the retention job's
  predicate touches only abandoned `pending` attempts, and widening it silently locks every adult out a year early.
- **`show_adult` appears in no transaction of this procedure.** Completing verification and deciding to view adult content
  are different decisions, and turned on as a side effect that person sees a screen they never chose.
- **The entitlement is decided by the current server state.** The reflection decides on the **re-read age** inside the
  transaction that locked the member row — an account that turned into a child while the verification window was open
  genuinely exists, and a mistake in that direction cannot be undone.
- **A child has no such procedure.** The gate is `requireNonChild(_, "adult")` and the code is `minor_adult_restricted`.
  **The read-side gate is `requireViewer`** (identity verification is not an outward interaction).
- **It is not an entry gate.** Do not add `adult_verification_required` to `MembershipGate` — adult content is a choice
  and someone who has not verified uses the product as it is.
- **No identity is stored.** What this consumer leaves is an opaque reference, timestamps and a boolean "was this person
  19 or older then". Not even a name or contact is kept, which is where it splits from guardian consent, and the basis is
  the retention purpose — that one is grounded in 「개인정보 보호법」 제22조의2 제2항, and the two questions here need no
  identity. A test **counts the row's column set whole.**
- **The handoff helper is `apps/web/src/lib/identity/handoff.ts`.** The moment there were two consumers, keeping it under
  `features/onboarding/` would make the account screen import the guardian-consent screen's folder.
- **Settings were not split.** Both consumers use the same `PORTONE_*` — splitting now adds one more unfilled variable and
  that deployment quietly fails half-configured.
- **The dev verifier answers three branches** (adult, minor, verification failure). Do not derive that branch from browser
  input or the request body — that derivation code ships to production too. A test pins it as a module function
  (`setDevIdentityOutcome`) and that function throws in production.
- **Adult publishing entitlement genuinely stands as the gate on public publishing.** A member whose entitlement lapsed
  **cannot set their adult work public**, and taking it down or archiving it is not blocked.

## Operations console — apps/admin

The operation surface for running the actual deployment. **A separate app from `apps/web`**, sharing only contracts, SDK,
query policy and the design system (`apps/admin/README.md` and the file headers).

- **This app is all of the operations UI.** With two consoles, a reliability improvement lands in only one, and because
  both call the same API that mismatch breaks no test. **Consumer features stay in the web app** (reporting, appeals,
  `내 신고`, the sanctions section, notifications).
- **Do not build a second moderation system.** The report queue, enforcement and appeals are still `/v2/moderation/*`
  alone, and the console calls it **verbatim.** Do not move those routes under `/v2/admin` for naming consistency — the
  paths of already-shipped clients and the SDK die and what is gained is only a sense of consistency.
- **Enforcement endpoints are not under `/v2/admin`.** Hiding, suspension, banning, capability restriction and comment
  deletion all go through one `POST /v2/moderation/actions`. A convenience route such as
  `PATCH /v2/admin/stories/:id { hidden }` creates **a second enforcement path with no audit record and nothing to
  appeal**, and the owner of a story hidden that way has not even an action to appeal.
- **There are two gates.** `requireModeratorViewer` (staff and admin) covers all reads, and `requireAdminViewer` stands
  only on the managed-generation allowlist toggle (who may spend the operator's provider key), the app version floor
  that locks the app, and the app update announcement that reaches every member's inbox. That `staff` and `admin` had identical powers until now is what changes here, and the basis is
  that **real operations worth splitting appeared.** Both stand on `requireActiveViewer`, so **a suspended operator
  cannot enter even with the role.**
- **Do not build a static admin key (`X-ADMIN-KEY`).** Legacy did, and that approach fails three ways: a secret ships to
  the browser, it does not rotate, and above all **you cannot tell who did what.** For an audit record to exist a person
  must be identified per operation, and a shared secret cannot express that.
- **The projections are allowlists.** `AdminMemberDetailDto` and `AdminStorySummaryDto` reuse neither `StoryDto` nor
  `CreatorWorkDto`, and do not use the subtracting style — that code blocks only the fields it knows today and leaks
  automatically as columns grow. **A test that counts the response's key set** guards the boundary.
- **Authored content does not go out in operational responses.** `play_payload` is not selected, so the screen could not
  draw it if it wanted to. The one case where an operator must read a manuscript is a reported story, and that path
  already belongs to moderation evidence — **visible only with a report, and only bound to a case.**
- **Email is on the detail only and that lookup lands in the audit** (`admin.member.view`). Search compares email
  **exactly** and does not open partial matching — one `@gmail.com` sweeping the roster is not an operations tool but a
  leak path.
- **The screen's gate is not authorization but flicker prevention.** The real rejection is the 403 every lookup receives
  from the server, and with `lib/operator.ts` deleted the lists are empty. That decision is **a surface the shell covers**
  rather than a route because as a route one is missed when routes grow and **the missed route simply opens with no
  error.**
- **`unknown` is not a guest.** Folding a failed `/me` lookup into guest makes an already-signed-in operator look signed
  out when the API wobbles, and if that moment happens to be during an incident that screen delays the response. Members
  without the role are not sent to sign-in either — what they need is a role grant and that is not theirs to do.
- **There is no SSR** (so privileged data is not frozen into HTML — that document stays in proxies, browser caches and
  back-button snapshots). Routing is defined in code too.
- **There is one cache prefix (`["admin"]`) and signing out is a reset.** What sits here is members' emails, sanction
  history and the titles of private works.
- **Cursor lists page with `더 보기`, and no screen holds a cursor** (the report queue and appeals —
  `moderation{Queue,Appeals}InfiniteQueryOptions` through `useAdminInfiniteQuery`). A cursor lives only in the cache
  cell of the filters that produced it (filters are the key), so "the `open` cursor asking for the next `resolved`
  page" is not expressible — a screen that kept cursors in state would have to remember to clear them on every filter
  change, and the one that forgets reads the **wrong list**, not an error. A failed next page is said **at the tail**
  (`next-page.ts`) and is not page staleness — TanStack sets `isError` for it, and folding that into the top banner
  shows "refresh failed" over rows that are fine while its retry restarts from page one. No infinite scroll. The
  report detail carries the queue's filters in its address so `큐로` returns to the same filters and loaded pages.
  `boundaries.test.ts` blocks `useInfiniteQuery(` and cursor vocabulary in `features/`.
- **Published-story deletion is an admin operation, not an enforcement** (`POST /v2/admin/stories/:id/delete`,
  `services/admin/story-deletion.ts`). It is the hand of whatever contact channel a deployment takes deletion
  requests through, so it is not under `/v2/moderation/actions` and has no appeal. One locked
  transaction, and the request picks nothing but a reason (`.strict()`):

  ```text
  any moderation_action targets the story   409 story_delete_has_enforcement — nothing written
                                            (target_story cascades: deleting would erase the enforcement + appeals)
  otherwise                                 deleted — row gone; cover, runtime, comments, favorites, logs cascade
  ```

  There is one outcome (`AdminStoryDeleteOutcome` is `"deleted"`). For a while a story someone had bought was
  **detached** instead (ownerless, private, still playable by its buyers); with purchases gone nobody could open such a
  row, so the branch left with them.

  **What deliberately survives**: media bytes (a device draft may still point at them and republishing needs them)
  and moderation cases/reports (a reporter's `내 신고` does not re-query the target — this diverges from account
  deletion, which erases cases because it erases an identity). A second call answers 404 and the console reads that
  as "already gone". The audit row (`admin.story.delete`) carries the reason, the title, the previous visibility and
  whether it had an owner — the title because after the row is gone that line is the only answer to "what did we
  delete".
- **Do not use `window.confirm()`.** Every destructive operation goes through one `ConfirmDialog` and requires four
  things: what, where, **what result**, and why. `consequence` is not optional because "Are you sure you want to delete?"
  gives no information and becomes a sentence people press without reading.
- **The API's `WEB_ORIGIN` must contain the console's origin.** Missing it, every lookup is blocked by CORS while the
  preflight passes with a 204 and the server log holds only a `[cors]` warning — on screen it looks like "network
  failure".
- **There are two motions only**: page entry (`PageEnter`) and the sidebar's active indicator. Table rows have neither
  entry nor relayout — twenty rows appended by `더 보기` rising one by one reads as a list just created, and an
  operational table is a scanning surface so that cost is especially high. `transitions.ts` being a copy of `apps/web`'s
  is deliberate, and **drift is not dangerous because the values are not in that file** (the rhythm's source is
  `@rowcat/design` alone). Always separate the active indicator's namespace — this app draws the same navigation list
  **twice and both are in the DOM.**
- **Do not put an API-origin badge in the header.** There was one and it had a basis, but what it actually said was
  usually `localhost:3001` — an indicator that is always on and gives no information most of the time stops being read,
  and is not read when it does differ either. Which environment you are in is stated by **the overview's service card.**
- **`vite.config.ts` `dedupe`s React.** This app pulls workspace packages in from source, so Vite's pre-bundling creates a
  second React copy and then `Invalid hook call` fires — **the symptom is nasty because the screen renders.**

### Audit records

**The fact that a privileged operation happened**, and **a different thing** from a moderation action.

```text
moderation_action   the enforcement itself   — deleting it lifts the sanction
admin_audit_log     an observation           — deleting it changes no product behaviour
```

- **Do not merge them into one table with a `type` column** — merged, "we deleted the audit log and the sanction lifted"
  becomes representable. So enforcement operations **do not leave an extra audit row** — the action ledger already holds
  who did what and why, and that is the authority.
- **`recordAudit` takes a transaction as a required argument.** Defaulting it to `db` guarantees a call site outside a
  transaction, and at that moment "the operation happened and the record did not" stays committed — here **the type**
  enforces the rule. A failed audit throws and rolls the original transaction back.
- **Only read-only operations use `recordReadAudit`** (member detail viewing alone). That side swallows failures because
  there is no transaction to roll back, and a member lookup 500ing because the audit table wobbled is not safety but
  amplified failure. **A write calling this function has crossed the boundary.**
- **It is append-only.** There is no UPDATE or DELETE statement in the service and no such method on the route. The
  absence of an edit button is not a courtesy but the fact that **the operation does not exist.**
- **The action vocabulary is not closed.** This is where it splits from feature-switch keys — when a new privileged
  operation appears and someone forgets to widen the vocabulary, that operation passing **unrecorded** is worse. There is
  a prefix convention (`domain.target.action`) and the screen draws unknown values as they are.
- **Do not put secrets in the metadata.** The previous state is kept — without it the log says only "someone changed it to
  off", and what incident response needs is what it was.
- **Do not snapshot the operator's nickname on the row** (join it at read time). A departed operator's rows survive because
  it is a **left join** — with an inner join, one account deletion erases everything that person did, and that is the
  definition of what an audit record must not do.

### Operational settings — feature switches and the minimum app version

- **The vocabulary is closed and unknown keys are rejected** (fail-closed). A free-key/free-JSON settings API makes
  **rows nobody reads** representable, and that row shows as "configured" on the screen — the operator believes they
  turned a feature off while the server runs on.
- **Adding a key happens in the same commit as adding the route that checks it.** All four have real check points
  (`chat`, `publish`, `sync`, `signup`). A key added without a place that checks it is a value that blocks
  nothing while looking like it blocks. **Removing a key goes the same way** — `billing` left in the commit that removed
  the routes it guarded, because a switch with nothing behind it reads as a breaker that works.
- **There are three states and `default` does not fold into two booleans.** Merging `default` and `on` makes "the operator
  turned it on" and "nobody touched it" the same value, and the day the product default changes, deployments that
  explicitly turned it on move with it.
- **The decision is one `isFeatureEnabled`.** Split, a state becomes representable where the screen shows "off" and the
  server lets it through.
- **A failed lookup does not block** (fail-open). Failing to read a switch and the switch being off are different facts,
  and closing the feature on the former means one DB outage closes conversations, publishing and sync at once —
  that is not a breaker but an amplifier. Conversely, keys outside the vocabulary are rejected fail-closed.
- **The cache is five seconds and a write invalidates immediately.** With two or more replicas the reflection lags by up
  to five seconds — that lag is the only imprecision this layer accepts.
- **The asymmetry is deliberate.** `sync` blocks push only and leaves pull open (blocking a device from retrieving its own
  data is not a breaker but holding data hostage). `signup` blocks email signup in middleware, and social is blocked **where the member row is created** but
  **returns `null` instead of throwing** (throwing makes even the public gallery opened with that account a 403).
- **⚠️ The minimum app version is the most dangerous thing in this slice.** Setting a floor at a version not in the store
  locks every mobile user out of the app, and that state cannot be undone until store review completes (the app is
  already locked, so nothing can be announced through it). The server has no way to know whether that version is in the
  store and **cannot block it** — what blocks is the screen's explicit confirmation, and what remains is the audit record.
- **Only `MAJOR.MINOR.PATCH` is accepted.** With four clients each implementing prerelease ordering, one is certain to be
  wrong, and **that wrongness also goes in the direction of locking users out of the app.** No floor is `null`, not `""`
  (`""` behaves like `0.0.0` in comparison and quietly becomes "everything passes").
- **The web is not in that table.** One refresh makes it the latest code, so the concept of a floor does not exist, and
  with a row present someone eventually fills it and locks web users out.
- **The public runtime config (`GET /v2/runtime-config`) is not authorization.** A client ignoring a disabled feature and
  requesting anyway is rejected by the server — all that response does is avoid drawing dead buttons, and blurring that
  fact eventually produces code saying "we hid it on the screen so the server check can be skipped". The operator axis has
  **no slot** in that type.

### App update announcements

**One operation announcing that a floor already stands.** Raising the floor still belongs to `### Operational settings`,
and what this section adds is one plane carrying that fact to the inbox.

- **The version is decided by the floor row the operator manages, never by the request.** The broadcast body is one
  audit reason (`.strict()`), so a request carrying a version is a 400 rather than a silently ignored key.
- **What it announces is not a release but end of support.** The fact that broadcasting for a platform with no floor is
  **rejected with 409** is the structural expression of that. Once the copy is used as release promotion this kind becomes
  a free-form broadcast tool, and a pure test blocks that vocabulary by value.
- **Raising the floor and announcing it are different routes.** Merged, every mistake adjusting the floor leaves a row in
  every member's inbox, and that row cannot be undone (rolling the floor back to the same version reuses the idempotency
  key, so no correction notice goes out).
- **The idempotency key is `app-update:<platform>:<version>`.** The platform is there because there are two floors —
  without it, announcing iOS 1.4.0 makes announcing Android 1.4.0 impossible, and the two platforms happening to share a
  version is common.
- **The version freezes onto the notification row.** Re-reading the floor row at read time makes one later floor change
  rewrite the meaning of every notification already sent. **So a floor change invalidates the announcement status
  cache** — missed, the screen draws the old version's send count and the operator reads it as "everyone already received
  it" and does not announce the new version.
- **No mail goes out.** An app update carries no individual-notice obligation, and this slice does not lower the bar
  for growing the mail vocabulary.
- **There is no destination.** In the web inbox both `market://` and `itms-apps://` are dead links, so that row does not
  navigate when pressed. **Do not add an external-URL branch to `NotificationDestination`** — opened once, a notification
  can send people to an arbitrary address, and that address ultimately comes from a server response.
- **The server does not know which members are app users.** That axis is not in storage, so the announcement goes to every
  member and web-only users receive this row too — an accepted cost, stated on the operations screen.
- **Do not add a new route to the operations console.** For a platform with no floor, **do not draw a disabled button** —
  an unpressable button reads as "coming soon", and what to do here is not to wait but to set the floor above.

### ⚠︎ Update notes are not this kind

**Do not send an ordinary release note as `app_update`.** The words overlap, so this is the most natural wrong choice,
and the mistake passes both compilation and tests.

```text
app_update      the minimum supported version rose — below it is no longer accepted
                server-owned · notification plane · one operation raising the floor opens that gate
update note     here is what changed in this release
                repository-owned · the `업데이트` tab of the notifications screen · deployed = **openable**
```

Merged, **raising the floor becomes writing release notes**, and conversely shipping release notes requires locking the
app.

## Update notes

**The writing that announces what changed in this release** (`docs/updates/ARCHITECTURE.md`).

```text
authoring source  …/update-notes/releases/<YYYY>/<YYYY-MM-DD>.ts   typed data · hand-written
tooling loader    scripts/lib/update-note-sources.ts               Node-only discovery/validation — **apps do not call it**
generated         …/update-notes/generated/update-notes.ts         committed · pnpm updates:generate
rules             packages/domain/src/update-note.ts               projection · selection · validation · Discord render
the tab           apps/{web,mobile}/src/features/updates/          the notification UI's `업데이트` tab · a person opens it
seen fact         the device key-value store                       rowcat.updates.lastSeen
Discord           pnpm updates:discord                             reads the **authoring source** · a person pastes it
```

- **There is no hand-maintained registry — a file is itself the basis for discovery.** There was a time when each release
  added one import line and one array line, and a release that missed either became nonexistent **with no symptom.** The
  name is now the rule: a leading `_` is not a release, and a non-date name, a mismatched year folder or a `releasedAt`
  that disagrees **fails generation.**
- **The public repository ships no releases.** `releases/` is absent (git keeps no empty folders) and only
  `update-notes/_template.ts` remains. A missing folder is **zero releases, not a failure**: the generator writes `[]`,
  both apps' `업데이트` tab draws `아직 업데이트 안내가 없습니다.`, and no dot stands on the bell, the tab or a row. The
  loader's own tests therefore read `packages/domain/scripts/__fixtures__/releases/`; journey 17's history assertions
  stand only when the web surface has two or more notes, and otherwise it checks the empty state.
- **The generated file contains neither `internalVersion` nor `discord`.** The renderer does not spread the record but
  writes keys one by one — the basis for the public projection not drawing the internal version is not "the function is
  careful" but **the data the app holds not containing that value.** Only the Discord tool reads the authoring source, and
  that loader uses `node:fs` so it lives outside `src/`.
- **A stale generated file is silent.** Editing the authoring file without regenerating passes types and tests while only
  the deployed app draws the old note — `pnpm updates:check` and the domain tests catch that state, and
  **they do not modify the working tree** (they re-render in memory and compare).
- **A different thing from `app_update`, and that absence is structural.** `NotificationKind` did not grow, this slice does
  not pass through the notification plane, and neither the server routes nor the DB changed a character (a static scan
  blocks notification, floor and runtime-config vocabulary in that folder together).
- **The public identity is the date.** The `id` and the title both come from `releasedAt`. SemVer lives only in the
  authoring record as `internalVersion` and **has no slot in the public projection** — the type has no such field, the
  projection function does not spread the record, and a check counts the key set whole.
- **Do not write version numbers in the sentences.** One `v0.13.0` gives the users two names for the same thing.
- **Do not transcribe commit messages.** A note writes *what changed for the user*, and package names, API names,
  migrations and refactors appearing in the sentences make it a changelog.
- **There are four sections in fixed order** (`새로운 기능`, `개선 사항`, `수정 사항`, `참고 사항`). An empty section
  **does not draw its heading.** The labels live in `@rowcat/domain` because there are three consumers.
- **Share the words; let each surface own the decoration.** What must not diverge is the sections' **identity, order and
  words**:

  ```text
  web/mobile   a Lucide icon + the word   Sparkles · CircleCheck · Wrench · TriangleAlert
  Discord      an emoji prefix + the word   ✨ · ✅ · 🛠️ · ❗
  ```

  Emoji were once part of the label value, and it was narrowed because what drew that glyph in-app was **the device's
  emoji font** — the same release stood in a different shape per platform and did not sit on the same stroke as the rest
  of the product's icons. **The domain does not know Lucide** (the projection has no `icon` field — the basis for
  choosing is the section id). The Discord prefix table is **not exported** either (exported, an app builds a workaround
  re-attaching emoji to the screen, and that workaround passes both compilation and types). Mobile calls a **semantic
  name**, not a glyph. **Icons are decoration so they have no name, and sections are not color-coded.**
- **In-app and Discord are authored separately.** Do not generate one from the other by string transformation — that
  transformation is certain to break one side's sentences, and one of them becomes unfixable.
- **Do not read the clock.** Whether something is published is **a deployed fact**, not a calendar event — being in the
  registry means published, and there is no code comparing `releasedAt` against today. There is no scheduled publishing.
- **The seen fact is a device value.** Scoped to a member there is no slot for a guest's dismissal and the same note
  reappears the moment they sign in. It is not on the server because the cost of one table and two endpoints buys only
  "it does not appear on other devices either". **Do not mix it with `app_update`'s read state.**
- **⚠︎ A note does not open by itself.** For a while both apps' shells raised a window on the way into the app, and the
  removal of that wiring is the most recent change here. The basis is its character — a product release note is neither
  consent nor confirmation, so making it something you must clear before using the app turns one page of information into
  a gate (and someone who dismisses it every time soon dismisses it without reading).

  ```text
  a new note exists  !=  open the note
  ```

  Loading, launch, sign-in, shell entry, navigation completion and discovering a new note open no window, and there is no
  toast or banner. **Pressing the bell, opening the popover, choosing the tab and navigating to that screen make nothing
  read** — the record is written at the one moment the window opens. Both apps' static scans lock **the shell does not
  raise a window** together with the absence of `announcement`, `autoOpen` and `showOnLaunch` in that folder — with the
  names left behind, the wiring soon returns.
- **Selection is history and identity, not "the note to raise".** `updateNotesFor(surface)` gives **every** note for this
  surface newest-first, and `unseenUpdateNoteId(surface, lastSeenId)` gives the identity of the newest note not yet
  opened — that one value answers **both** the tab's dot and the row in history that gets a marker. With no record it is
  treated as new (writing only a baseline on first run leaves no marker on the release that turns this feature on), the
  comparison is `>=` (a device that already opened a newer note through a rollback or reinstall has its marker revived by
  `>`), and **backlogged notes are not counted.**
- **The notification screen is a container with two tabs** (`일반`, `업데이트`). This spot was once **one row above** the
  server notification list, and that shape held only while there was a single note — as releases accumulate, that row
  means "you cannot see the past ones". **The first tab is not named `알림`** (the screen already carries that name, and
  the same word twice vertically blurs the relationship between the two tabs). **The default is `일반` and a new note does
  not switch the tab** (switching makes that dot an interception, not an indicator).
- **The same IA stands in three places**: the web header's popover, the web `/notifications`, and mobile
  `/notifications`. **The popover is a preview** — both tabs draw the first few rows and a link at the bottom goes to
  **that tab** of the full screen. `모두 읽음` lives **inside** the `일반` tab.
- **The tab is in the address but there is one route.** `?tab=updates` is that axis and there is no second route such as
  `/notifications/updates` — it is not an axis **inside** the inbox but two surfaces one screen composes, and split into
  routes that tab soon demands its own loader, cache and empty state. The serialization rule belongs to one pure module
  and unknown values fold to the default tab. **That folding is in the reader, not in validation**: a screen's search is
  the **union** of matched routes, so an unvalidated parent carries the original through and dropping it in this route
  alone does not erase it — if that value reaches `Tabs`'s `value` the screen has **no tab selected** and no error is
  raised. **The popover's tab conversely does not write the address.** **The navigation IA did not change a character.**
- **It lives on the same surface but is not a notification.** What is shared is the visual surface only, not the
  persistence model — notes do not ride on the notification DTO and the unread count counts **server notifications
  only.** Do not build a fake `Notification` from an `UpdateNote` and pass it to `NotificationRow` (`id`, `createdAt`,
  `readAt` and `kind` would all have to be invented, and at that moment this value has the inbox's vocabulary). The
  dependency direction is one-way — **the notification screen (presentation) composes the two tabs**, the notification
  feature does not know the note state, and the update slice does not know the inbox's queries or mutations.
- **The server list's state does not hide the notes tab.** Putting both tabs **inside** that state machine is the most
  natural mistake — one condition does it and the screen looks plausible — but that condition hides an empty inbox,
  offline, a failed lookup, a guest and booting all together. Notes have nothing to do with that query.
- **⚠︎ The header bell represents two facts without adding them.**

  ```text
  3 unread notifications · a new note   →  🔔 3      the count wins
  0 unread notifications · a new note   →  🔔 ●      the dot stands only with no count
  neither                               →  🔔
  ```

  Added, a `1` remains that `모두 읽음` cannot clear — the server never created that row. Both the priority and the label
  assembly go through **the same pure function in both apps** (`notificationAttention`) — that function does not know
  `UpdateNote` and takes **one boolean.** **A hidden note still appears in the label.** Do not write a count in the dot
  (`1` is a lie). **Do not turn on the list query for the note's dot.**
- **The indicator is one dot and four places read the same value** (the bell, the popover's tab, the screen's tab, and the
  newest row in history). No count, no `NEW` badge, no animation. The dot is not in the accessibility tree and that fact
  rides in the label as text (`UPDATE_UNSEEN_LABEL_SUFFIX`) — **do not make the dot separately pressable.**
- **⚠︎ The seen fact has one owner and that place is the app root.** With one screen raising the container, only the header
  bell goes stale, and that mismatch clears only on refresh. **The container being at the root does not mean "it opens by
  itself"**: with no note selected it draws nothing. **On the web that layer owns the window too** — the popover closes
  the instant a row is pressed, so a window beside the list disappears with it (mobile's shortcut is a single navigation
  so the window stays beside the list — **the one intended difference**).
- **Opening is reading.** The record is written by the row **at the moment it opens** and **closing writes nothing.**
- **⚠︎ The record does not go backwards.** With history, **opening an old note became an ordinary operation**, and that
  operation rolling the record back marks a newest note not yet read as "seen" (with no way to undo). So the monotonicity
  rule lives in **one function** (`mergeSeenUpdateNoteId`) and both the place that writes to the medium and the place that
  reflects it on screen go through it — mobile has one more reason: the write is async, so reading back right after
  writing returns the old value.
- **Surfaces split.** A mobile-only release neither stands in the web's history nor lights its dot. The app does not
  re-write that decision — sorting and surface filtering are done by one shared function, and a static scan blocks
  `.sort(`, `.filter(` and `localeCompare` on the app side.
- **It is not a route.** There is no resource to address, and as a route that screen soon demands search, filters and an
  archive.
- **Do not make a card per row.** One item as one box turns a four-section note into ten surfaces. There are no borders,
  badges, gradients or nested surfaces — only type hierarchy and whitespace.
- **Do not obscure the way out.** This is where it splits from the management dialogs — there is nothing to lose here, and
  blocking outside-press keeps someone who finished reading from clearing the window.
- **Do not automate sending.** There is no Discord webhook and no bot token. `pnpm updates:discord` prints to stdout and a
  person pastes it — **outward operations are pressed by a person.**

## Rate limiting

**Burst and abuse defence lives in one place** (`docs/ops/RATE-LIMITING.md`).

```text
policy.ts        limits · windows · subjects · failure policy · error codes   pure — knows neither Redis nor Hono
store.ts         the counter port                                            consume(+cost) · release
redis-store.ts   the atomic Lua adapter · memory-store.ts                     the in-process fallback
limiter.ts       the decision · key derivation · 429/503                      the only place that knows policy
index.ts         checkRateLimit · reserveRateLimit                            the two doors feature code sees
```

- **Feature code issues no Redis commands.** This folder is the only place importing `lib/redis.ts`, and a call site
  writes three things — which policy, what is being counted, and (if needed) which scope.
- **It is one atomic operation.** Lua runs `INCRBY` → `PTTL` → (if absent) `PEXPIRE` inside Redis in one shot. Split into
  round trips, a process that dies right after the increment leaves **a key with no expiry**, and that key blocks that
  account on that policy **permanently.**
- **A policy counts requests or bytes (`unit`), and each has its own door.** `checkRateLimit` counts one per call;
  `reserveRateLimit` reserves an amount on entry and `settle(used)` gives back the rest — `release` only lowers a
  **live** window and clamps at zero (giving back to an expired key would start the next window with free budget).
  This is the one place a second round trip is allowed: admission is still one atomic increment, and a failed release
  leaves an **over**-count (the safe direction). Calling a bytes policy through `checkRateLimit` would count one byte per
  request and stop nothing, so the limiter throws and `policy.test.ts` scans for the wrong door.
- **The subject is always hashed.** Even values as innocuous as a member id are no exception — with "hash this one and not
  that one", whoever adds a policy has to re-make that judgment every time, and one wrong call leaves that value in
  `MONITOR`, backups and the slowlog. **No request body ever touches a key.**
- **IP is not in the subject vocabulary — that absence is the rule.** This deployment has no authoritative way to extract
  an IP, and a limiter built on a forgeable header **blocks only honest users.** So **unauthenticated endpoints are not
  this layer's subjects** (sign-in and signup are covered by Better Auth's own limiter).
- **The policy owns the answer when the store is down** (`allow` ↔ `deny`). `deny` is **a 503, not a 429** — it is not
  something the client did, so folded into 429 the user reads that they went too fast and keeps reading it while no amount
  of waiting helps.
- **A normal 429 writes no log** — start logging and one script fills the log and buries real problems.
- **Feature code does not compute `Retry-After`.** The error carries the value and the header is attached in **one
  place**, `app.ts`'s `onError`. A route that missed it returns a 429 without stating the wait, and that symptom is
  silent. The value is **always at least one second.**
- **Do not swap a domain error code for a shared one** (`comment_rate_limited`, `report_rate_limited`) — the web branches
  on those values, so changing them drops those failures into the default branch, and **that mismatch is not a compile
  error.**
- **The managed-generation limiters are the spending ceiling, so they are fail-closed** (`managedGeneration` 30/min,
  `managedGenerationDaily` 400/24h, both per member). Managed generation runs on the operator's key and is no longer
  metered, so there is no balance reservation behind them any more — while they were fail-open the basis was exactly
  that reservation, and letting requests through while Redis is down would now open the key without a ceiling. They
  run **before** the upstream call (a refused request never goes out), next to the allowlist
  (`### Managed generation access`), and an open stream does not count again (one count at the request's start). The
  numbers are the operator's to change in the policy table — what a deployment can afford differs.
- **Pairing's two 429s are different things.** `pairingTooMany` is a ceiling on the **number** of open sessions and clears
  by cancelling one; `pairingRateLimited` is a ceiling on **speed** and clears by waiting. **Status lookups have no
  policy.**
- **Do not add a policy name without a call site that checks it** — `policy.test.ts` guards that pairing statically.
- **`REDIS_URL` is optional.** Empty, it falls back to an in-process counter, and a boot log warns when it is empty in
  production. **Do not turn off the offline queue** — turned off, the first command before the connection is established
  is rejected, and that command being the first request after boot means a fail-closed policy's first request gets a 503
  while Redis is perfectly healthy (that defect actually existed).

## Failure feedback

**A failure is drawn where its cause still has context** (`docs/design/FAILURE-FEEDBACK.md`,
`apps/web/src/lib/toast.ts`).

```text
an interaction surface that remains   inline        a form · an open dialog · a row · a section
an operation that is gone             error toast   a menu item · a button you were leaving · an icon-only action
a query that fetches the screen       page error    QueryState · per-section error boxes
something the user did not start      nothing       auto-sync · prefetch · periodic refresh · auto-maintenance
```

- **Do not end with `catch {}`.** With no feedback on a failure of something the user pressed, what remains on screen is
  **a button that did nothing**, and that state is indistinguishable from a breakage.
- **Inline if the dialog is still open after the failure; a toast if it closed with the operation.** Do not force a dialog
  to stay open just to keep it inline.
- **One failure, one indication.** With a suitable inline message already there, do not add a toast — `role="alert"` and a
  high-priority toast read the same sentence twice. Do not move a form field's error into a toast either (the relationship
  with the control `aria-describedby` pointed at disappears).
- **One failure, one action, and the ordering is one pure function per app** (`generationRecovery`). A generation failure
  offers exactly one thing to press: AI settings, `이어서 생성`, or `다시 생성`, in that order (a billing rung stood
  second for a while and left with billing). **`chat_managed_not_allowed` is an AI-settings rung** — the same
  destination as `provider_not_connected` and `invalid_credential`, because the way past "this server's default AI is
  for allowed accounts" is connecting your own key — and it gets no `다시 생성` (`canRetryGeneration`). **A screen must
  not re-write that ladder** — three web screens held copies of it and the day a fourth branch landed, only one of them
  got it; the test that used to check each screen *had* the branch now checks that it *does not*. **A failure that
  pressing again cannot fix gets no button at all** (`canRetryGeneration`) — retrying a rejected key just sends the
  provider one more request. ⚠️ **That decision's material is the failure's code, so it must be carried, not
  dropped** — a failure frame that arrives mid-stream becomes `ChatStreamFailure` in both apps and one function
  reads it (`failureCode`). While the web wrapped it as `new Error(event.message)`, a server-side failure and a
  managed routing failure both folded into the generic sentence and both offered a retry that could not work.
  A local save failure is the same axis (`ChatPersistenceError`) — folded, the screen says the response was not
  received, and **that sentence is false**.
  ⚠️ **The ladder also answers the turn where nothing failed.** A turn that ended normally with no body is discarded
  by the save rule and left unanswered (`resolveGenerationOutcome`), and `unanswered` is read in exactly one place —
  this ladder — whose first line used to be `if (!error) return null`. So that turn drew **nothing at all** on either
  app: no message, no sentence, no button. That is what the "generation stops mid-output" report turned out to be.
  It now returns a `notice`-tone recovery with `다시 생성`, and **the tone rides on the value** rather than being
  re-derived by the screen from whether an error was present (the screens already re-wrote this ladder once). A turn
  the user stopped themselves is excluded (`stopped`) — attaching "it was not saved" to their own stop reads as a
  malfunction report.
- **The feature owns the copy and the toast layer owns only placement and lifetime.** Caught exceptions, HTTP internals,
  stack traces and provider details do not reach the screen, and `showErrorToast(String(error))` is blocked by a static
  scan.
- **Error toasts do not dismiss themselves** (`timeout: 0`, `priority: "high"`). And that surface stands **above**
  dialogs (`z-60`) — on the same layer the later portal wins, so a toast raised while a dialog is open sits under the
  backdrop and **its close button cannot be pressed** (verified by value in the browser).
- **Do not build a global mutation error handler.** `new MutationCache({ onError })` cannot know whether that dialog
  already draws it inline, whether it is background maintenance, or whether the call site swallowed it deliberately, so it
  is guaranteed to be either duplication or noise. On the same axis, do not bring toasts into `@rowcat/query`,
  `@rowcat/domain` or `@rowcat/sdk`.
- **Do not build success toasts.** A value changing, a row disappearing and a dialog closing already say success —
  layered on, toasts soon become unread background **and then failures go unread with them.**
- **The operations console has its own toast.** The two apps run in separate documents with separate module instances, so
  without it `showErrorToast` **draws nothing** with neither exception nor warning.
- **Query surfaces split again inside that third line.** `로딩` means **the request may still be in progress**, and
  paused (`fetchStatus: "paused"`) and a failure that never reached the server are not in progress.

  ```text
  no value + in progress          loading
  no value + paused/unreachable   connection guidance + retry   ← not loading
  no value + failed               error + retry
  no value + genuinely nothing    empty state                   ← **must** be distinguished from failure
  value + refresh failed/paused   keep it + one staleness line + retry
  ```

  **If a value is held, do not erase it — and do not pretend it is current either.** There is one sentence:
  *this is the last confirmed value.* A pure function, not a component, owns that ordering.
- **The notification weight splits in two.** A failure with no value that occupies the screen is `role="alert"`, and the
  one staleness line layered over a drawn value is `role="status"` — the latter must stay **mounted with the sentence
  unchanged** while the failure persists (attaching and detaching on every refetch stops assistive-technology users mid-task
  every time a background refresh wobbles).
- **`다시 시도` must actually retry.** On a paused query `refetch()` creates no request (it returns the existing promise) —
  the button presses, no error appears, and the screen is unchanged. The rule is two lines (**regain the connection state
  → restart from scratch only the pauses with nothing to lose**) and each app owns it (browser wiring, so not lifted into
  `@rowcat/query`).
- **Operations screens do not call `useQuery` directly** (one `useAdminQuery`). Making `다시 시도` work correctly requires
  the query's **key**, which the result object does not carry, and letting the screen pass it separately means one of
  twelve screens misses it — and the screen that missed passes types and renders.
- **Draft autosave is none of the four lines above — it has its own place.** The failure stays in the editor header's
  **persistent indicator** (not a toast) and **something pressable** stands there — typing extra characters to wake the
  debounce is a trick, not an operation, and only those who know can use it.
- **A confirmed save failure is not silently discarded.** The blocking condition is **only when both are true**
  (`status === "error"` **and** pending changes remain) — a confirmation dialog every 500ms soon goes unread. **Do not
  trap** (there are two exits and `저장하지 않고 나가기` navigates **after emptying** the queue — leaving without emptying,
  the last flush on unmount revives the sentence the user chose to discard). Do not attach a **write** to `beforeunload`
  and do not hand-intercept history (the router's `useBlocker` covers links, `navigate()` and the back button together).
- **Every locking site is a test.** The surface list being **bidirectional** is the point — without pinning
  both which sites must be toasts and which must be inline, a change deleting one `showErrorToast` and a change adding one
  toast per dialog both pass green.

## Motion

The rule is not what moves but **why only that moves** (`docs/motion/ARCHITECTURE.md`).

**Both apps use the same motion language.** The values come from `@rowcat/design/motion.ts` alone and there are four
places translating it into their runtime's shape:

```text
apps/web/src/lib/motion/transitions.ts        product · Motion for React
packages/ui-web/src/lib/primitive-motion.ts   infrastructure · into the shape primitives take
apps/mobile/src/lib/motion/transitions.ts     product · React Native Reanimated
packages/ui-native/src/motion/rhythm.ts       infrastructure · into the native primitives' shape
```

The rules below apply to **all four.** The places that differ are listed («의도한 차이» in
`docs/motion/ARCHITECTURE.md`) and **a difference not in that table is a mistake.**

- **Motion explains state. State does not wait for motion.** Do not perform product operations (delete, move, save,
  publish, sync) in `onAnimationComplete` — in a tab receiving no frames that operation never happens.
- **The same token does not mean the same movement — that fact is this section's first line.** The proof of parity was not
  a test but **placing the two screens side by side**, and what a test can speak to is values, vocabulary and boundaries.
  **Do not record an unmeasured place as passing.**
- **Do not choreograph route exit.** `PageEnter` has only the destination's entrance, and do not wrap the router outlet in
  a presence keyed by path (scroll restoration, focus and Suspense wobble along with that copy). During hydration give no
  initial value.
- **The layer that says "arrived" is one per screen, and in both apps that one is `PageEnter`.** Native reached that point
  by having the stack choreograph nothing (`animation: "none"`). That place was the platform push for a long time and the
  basis was *"turn it off and iOS's edge swipe drags a still screen"*, and **that sentence was not true on device** (a
  gesture's lifetime is decided by `gestureEnabled`, not `animation`). **So `PageEnter` has no condition** — the "only
  choreograph late-arriving bodies" decision that existed for a while was a device to avoid overlapping the push, and with
  no push there is nothing to overlap.
- **A settings category change is not a screen transition.** The layout route owns the shell and what changes is one cell
  beneath it, so the active indicator **slides between siblings.** This split was recorded as an `의도한 차이` for a
  while, and what was blocking it was not the platform but **this app's route file layout.**
- **Do not tie the middle of a visual transition to JS.** Starting the entering segment after the exiting one ends must
  finish inside the animation runtime — stitched as `runOnJS` → `setState` → commit, that interval's length depends on
  **what JS happened to be doing**, and on device that interval was a 400ms blank.
- **Durations and curves come from `@rowcat/design`'s `motion.ts` alone.** Do not write `duration: 0.2` in a feature file,
  and **exit is always faster than entrance.**
- **`layoutId` states its namespace.** Two surfaces using the same name make an indicator fly across the screen and types
  do not catch it — a static scan does. When the same component lives in two containers, `LayoutGroup` adds another layer.
  **Even with different looks** (a background layer ↔ a 2px underline) the two branches share the **same** static
  geometry.
- **The active indicator does not state active state.** The moving background is `aria-hidden` and `aria-current` plus
  static text styling remain — motion supports meaning, it does not replace it.
- **Reduced motion has one meaning: not turning animation off but turning off movement only.** Transforms are placed at
  their final value immediately and opacity still flows, and **the timing of the state change is the same either way.**
  Screens do not re-ask that preference (a static scan on both sides). There is one exception on the list: the streaming
  response's caret.
- **Two places on native know the animation runtime.** Feature code sees a narrow vocabulary only — **not building a
  general container (`<Motion type=… emphasis=…>`)** is **the same judgment** as `@rowcat/ui-native` not exporting a
  general `Sheet`. Moti is not brought in either.
- **Virtualized conversation rows have no layout motion — in either app.** That geometry belongs to the virtualizer, and
  motion changing its measurements makes scrolling wobble along. **Native has one more reason** — `FlatList` remounts rows
  while scrolling, so an entrance choreography runs **on every scroll.** The test is **"does it change the measured
  height".**
- **Where a control changes state it is not the button that swaps but the glyph** (`animated-icon-swap.tsx`, ten
  consumers). The outer geometry does not move a pixel, which is why **the composer's button is also one** (splitting
  `Button` in two on `generating` means the code cannot keep the claim that it is "the same circle"). The box holds neither
  state nor timers.
- **A list's key is the entity id.** Pressing an exiting row is blocked by `useExitGuard()` — carried on the animation
  target (`exit`), that protection disappears entirely in a tab receiving no frames, which is exactly when an exiting row
  lingers longest.
- **A list growing by `더 보기` has no entrance.** Twenty appended rows rising one by one reads as a list just created.
  Drawing the two differently would require remembering somewhere "is this row new", and that is where motion starts
  holding product state. What remains is **exit and relayout.**
- **Do not use presence for decorations that change a neighbour's position as they leave** — the moment it leaves the flow
  the neighbour shifts, and that shift happens **after** the exit finishes so it reads as larger.
- **Primitives open and close with Motion too — there is one engine.** **The runtime and accessibility policy belong to the
  app's `MotionProvider`** (which is why `motion` is a peer of `@rowcat/ui-web` — with its own copy the context splits and
  only the primitives quietly stop). Neither `AnimatePresence` nor `keepMounted` is used; `animate` is derived from the
  open state — in exchange **every state must move opacity** (Base UI waits for exit via `getAnimations()`). Placement is
  taken as a name rather than a class (the centred box's `-50%` reset is a Motion transform, so overriding it with a class
  throws the box to a corner).
- **There are two exceptions, both outside Motion** — the toast (a swipe assembles the transform from CSS variables) and
  the select (open is instant; only close moves one opacity in CSS).
- **Do not bring `tw-animate-css` back.** shadcn components freshly stamped arrive carrying those classes, and with the
  package absent that line **does nothing** — no animation and a dead class look the same on screen, so it is silent.
- **Do not use springs** (V1). Everything moving today is automatic relayout so there is no physics to imitate — add them
  **together with the slice** that introduces dragging and reordering.
- Do not build global press feedback (`whileTap`), staggered entrances, parallax, always-running decorations or the View
  Transition API. The last especially — do not run two transition systems over the same UI.

## Background jobs

**Periodic jobs sit on one piece of infrastructure** (`docs/jobs/ARCHITECTURE.md`).

```text
scheduler → runner → registered jobs → domain/service functions
            ↑ locking · time · logging · failure isolation all live here
```

- **Jobs hold no rules.** The media reference decision and retention arithmetic belong to
  existing services and a job file is a **caller** of those functions — a copy diverges the day the original changes, and
  that difference surfaces as "a different conclusion only when run by the scheduler", the hardest shape to reproduce.
- **The schedule lives in `registry.ts`, not in job files.** The value a deployment changes comes from `env.ts`.
- **Turning it on is explicit** (`BACKGROUND_JOBS_ENABLED=on`, **off by default**). One of the jobs here performs
  irreversible destruction and another mails every member — those two running **because a module was
  imported** gives a developer's laptop, CI and migration scripts each their own scheduler.
- **The distributed lock is a Postgres advisory lock, not Redis.** That client's contract is "null on an unconfigured
  deployment", so placing the lock there makes **destruction run in two processes at once on a Redis-less deployment.**
  **It is a session lock so there is no TTL** (when the process dies the socket closes and Postgres releases it). The one
  way to take a session is `withPooledClient` (`db.execute()` grabs a different connection per statement, so locking with
  it sends **the release statement on a different session**).
- **One lock per job** — with one, push delivery is skipped while orphan cleanup runs, and that defect only ever
  looks like "pushes sometimes arrive late". **Backlogged runs do not accumulate.**
- **The runner does not throw** — a rejection escaping a timer callback is an `unhandledRejection`, so one bug in orphan
  cleanup takes the whole API down.
- **Severity states the state.** "Skipped, lock held" and "nothing to reconcile" are debug; a single item's failure is
  warn; a whole run's failure and lock infrastructure failure are error. **Do not layer on automatic retries** (the period
  itself is the retry).
- **Time comes from the context's clock** (job implementations contain no `new Date()` or `Date.now()` — a static scan
  blocks it). **Do not read the host timezone** (the default is `03:00 Asia/Seoul`).
- **`JobContext` has no `db`** — handing a job `db` means **it could do the same work while passing that scan.** Only
  retention destruction is an exception, and that exception is visible as an import.
- **A manual run is a process, not a route** (`jobs/cli.ts`). Do not build `POST /v2/admin/jobs/:name/run` — that address
  is a place from which destruction can be started from outside, with authorization resting on one session. Arbitrary
  parameters such as a cutoff are not accepted either.
- **The five billing jobs are gone** (generation-hold expiry, two payment reconciliations, subscription renewal and the
  renewal notice mail) — they left with the tables they walked, not as disabled registrations.
- **Orphan media cleanup walks `avatar` only.** `scene_image` references live in devices' E2EE drafts and playback
  snapshots so **the server cannot say "nobody points at this"**, and deleting anyway makes a live story's image vanish.
  The grace period (24 hours) exists so an in-flight upload is not killed.
- **Retention destruction — this job does not interpret the law.** It deletes only records that have no use once they
  expire, and a rule is registered only when all four are settled — target, period, starting event and action. Anything a
  deployment's own privacy policy has to decide stays in `UNRESOLVED_RETENTION` with a reason. If any is undecided it stays in `UNRESOLVED_RETENTION` with a reason and **holds no destruction predicate** (it
  is not that one exists and is not called). What it enforces is five short-lived records: email verification and change
  tokens (1 hour), sessions (30 days), the guardian consent **link** (24 hours), identity verification **attempts**
  (30 minutes) and the device pairing relay (5 minutes). **Confirmed consents and verifications are not deleted** (the
  predicate picks only requests that expired unopened). **There is no automatic deletion
  of long-dormant accounts either.** The cutoff is one per run and the boundary is `<`. **Do not issue one large DELETE**
  (500-row batches). There is a dry-run, and left on and forgotten the destruction never happens and **that has no
  symptom.** **The existence of infrastructure is not approval of a policy.**

## Commands

Run everything from the repository root.

```bash
pnpm dev          # web(:3000)
pnpm dev:api      # api(:3001)
pnpm dev:admin    # the operations console(:3002) — the API's WEB_ORIGIN must contain this origin
pnpm dev:all      # the three above at once (turbo, streamed logs)
pnpm check        # biome (lint + format) + environment configuration drift check
pnpm env:check    # do the schema, inventory, compose and example files agree (no secrets · for CI)
pnpm env:doctor   # what works with this configuration (--mode production · --file · --json)
pnpm format       # biome format --write
pnpm typecheck    # turbo: workspace tsc --noEmit + the journey (e2e) project
pnpm test         # turbo: vitest across the workspace
pnpm test:e2e     # browser journeys (Playwright) — brings the stack up itself
pnpm build        # turbo: the five apps' bundles

pnpm runtime:declarations      # @rowcat/runtime source → the artifact tooling reads (committed)
pnpm runtime:declarations:check # does that artifact match the source (wired into `pnpm check`)
pnpm runtime:sandbox           # the same source → the artifact the VM runs (committed)
pnpm runtime:sandbox:check     # does that artifact match the source
pnpm runtime-vm:harness        # harness HTML · QuickJS WASM · fixture artifacts (all committed)
pnpm runtime-vm:harness:check  # do those three match the source and dependency — WASM is compared **by bytes**
pnpm updates:generate          # authored releases → the generated runtime registry (committed)
pnpm updates:check             # does that artifact match the authoring source (for CI)
pnpm updates:discord [YYYY-MM-DD]  # print an update note's Discord post to stdout
pnpm mobile:update <publish|rollout|pause|resume|rollback|list|show|gc-report> …  # self-hosted OTA (docs/ota/OPERATIONS.md)
pnpm mobile:runtime:check      # native fingerprint == the recorded runtime generation (wired into `pnpm check`)
pnpm runtime-ai-docs           # public docs + @rowcat/runtime's source → the AI corpus (committed)
pnpm runtime-ai-docs:check     # does that corpus match both sources
pnpm llms                      # the corpus → apps/web/public/{llms.txt,llms-full.txt,runtime-api.json}
pnpm llms:check                # do those three match the corpus
pnpm runtime:public-beta:check # the six drift checks + the eight runtime packages' tests (orchestration only)
```

Per app:

```bash
pnpm --filter @rowcat/api db:generate      # schema change → generate migration SQL
pnpm --filter @rowcat/api db:migrate
pnpm --filter @rowcat/api db:studio
pnpm --filter @rowcat/api db:seed:play     # local seed (playback payload)
pnpm --filter @rowcat/api db:seed:dev-user # dev account (dev@rowcat.test / rowcat-dev)
pnpm --filter @rowcat/api db:seed:moderator <email> [user|staff|admin]
pnpm --filter @rowcat/api guardian:revoke <email>
pnpm --filter @rowcat/api email:dev                                  # mail copy preview (:3005)
pnpm --filter @rowcat/api jobs:list
pnpm --filter @rowcat/api jobs:run <name> [--dry-run]
pnpm --filter @rowcat/api jobs:retention:inspect
pnpm --filter @rowcat/api mobile-updates <register|list|show|rollout|pause|resume|mark-rolled-back|rollback-plan|gc-report>
pnpm --filter web generate-routes          # regenerate routeTree.gen.ts (tsr)
pnpm --filter @rowcat/design gen           # tokens.ts → tokens.css + tokens.native.ts
pnpm --filter @rowcat/mcp start setup      # the normal path — login → pairing code → ready
pnpm --filter @rowcat/mcp start login      # the MCP device's session (the password is not stored)
pnpm --filter @rowcat/mcp start unlock     # open the sync key with the recovery code
pnpm --filter @rowcat/mcp doctor           # what works with this configuration
pnpm --filter @rowcat/mcp build            # dist/index.mjs — the artifact that ships
pnpm --filter @rowcat/mcp pack:verify      # pack → install into an OS temp dir → run the installed CLI
                                           # ↑ release preparation ends here. Publishing is a tag push, never a local command
```

### Turborepo — order and cache, nothing else

`build`, `typecheck` and `test` fan out through `turbo` (`turbo.json`); everything else on this
page is still a plain pnpm script. **The commands themselves did not move** — each package's
`package.json` still holds what runs, and `pnpm --filter web build` works with no scheduler
(`apps/web/Dockerfile` builds that way, and deployment must not come to need turbo).

- **`@rowcat/*` has no build step**, so `dependsOn: ["^build"]` alone hashes nothing — the
  upstream task does not exist. What stands the dependency graph up in the hash is the
  `topo` transit node, which no package implements. Deleting it does not fail anything; it
  makes a stale `typecheck` pass **look green** after an upstream edit.
- **Two things are deliberately uncached.** `@rowcat/api#test` needs a live Postgres and reads
  a gitignored `.env`, so a run that skipped for want of a database must not be stored as a
  pass; `dev` never ends. Everything else caches to `.turbo/` (gitignored, local only — no
  remote cache is configured).
- **Env vars that get baked into a bundle are declared** (`VITE_*`, `EXPO_PUBLIC_*`, `NODE_ENV`).
  The env mode is turbo's default **strict**, so a value absent from `turbo.json` is absent from
  the build — which is the point: nothing unhashed can freeze into an artifact.
- **`pnpm test` runs at `--concurrency=4`, not turbo's default 10.** vitest already uses every
  core inside one suite, so this layer multiplies processes rather than suites — twenty-three at
  once puts the heavy runtime suites (QuickJS, TypeScript) past their 5s timeouts, and that
  failure does not reproduce when the suite runs alone. Four is `pnpm -r`'s own default, so the
  load profile is the one this repository had before turbo. (The full suite is flaky either way —
  see the api and web notes.)
- **`web#build` reads outside its package** (`docs/public/runtime/**` — the `gen:*` steps its build
  runs first), so that path is in its `inputs`. Without it, editing the runtime docs and rebuilding is a
  **cache hit** that ships the old copy.

Docker: `docker compose up` (web, api, admin, db, redis); images via `docker buildx bake`. db and redis do not open host
ports — to connect, run inside the container (`docker compose exec db psql -U rowcat rowcat`).

**The operations console comes up with the default `up` too and opens 3002.** It sat behind a profile for a while on the
grounds of "do not put an internal tool on the public surface". That basis was folded — this console's access control is
the server's authorization, not network position, and the screen's gate is flicker prevention, so receiving the whole
bundle gains a role-less session nothing but a 403 (the decision not to have a static admin key pays off here — there is
no secret shipped to the browser). Behind a profile there was a quiet failure instead: if turning it on must be
remembered, **the console being missing from a deployment entirely has no symptom either.**

### Browser journeys — e2e/

**The layer that runs the product's complete lifecycles on the real stack**, and the only place in this repository that
launches a browser.

```text
3021  the journey API          the product API as-is + journey deployment settings + the outside world blocked
3011  the generation double (proxy)   intercepts POST /chat/generate only and passes everything else through
3100  the journey web          VITE_API_ORIGIN points at the double
```

```text
01–09   conversation lifecycle   start · stop · edit · regenerate · room management · account isolation · room settings · narrow · failure
12      account deletion         the server account and this browser's IndexedDB disappear **together**
13      moderation               report → restriction → **the restricted person's appeal** → acceptance → notification
14      device pairing           two browsers exchange a code and a conversation crosses afterwards
15      the sign-in return address
16      personas                 the library's value is **copied** into the room
17      the notifications' two tabs   popover → does the window survive · does the seen fact spread without a refresh
18      the studio preview       does code a creator wrote run in QuickJS and become a screen
19      runtime durable state    restart inherits · reset empties · raising the version migrates
20      runtime playback         `플레이` creates no room · progress persists · reset empties it
23      password reset           no link while closed · the token leaves the address but the form keeps it · expired link
```

**What 17 catches is a fact that only holds between components.** The row that opens a note is inside the popover and that
popover **closes the instant it is pressed**, so a window in that tree disappears in the same frame — that defect is not
expressible as a value test.

- **They do not replace vitest.** What journeys add is **only the axes that layer cannot express** — does the conversation
  survive a refresh, does stopping really cut the connection, does switching accounts remove the previous person's rooms.
  Do not move rules verified purely into journeys: they are slow, brittle, and say less about what is wrong.
- **The only thing faked is the outside world.** Auth, stories, viewers, moderation and the sync protocol are all
  answered by the real server — imitating those too makes the journey verify not the product but the fake we wrote, and
  it stays green when the contract changes. A double stands in one place only: **the generation provider** (the fake
  payment provider and its interceptors left with billing).
- **The journey API does not use the dev port.** It comes up with journey-only deployment settings — the auth
  callback's trusted origins and `MANAGED_GENERATION_ACCESS=everyone`, so the fresh accounts journeys create can use
  managed generation. Putting that configuration on 3001 makes the journeys of anyone with a dev server running quietly
  run against a different deployment (`reuseExistingServer` reuses it), and what they then see — the allowlist's
  `AI 설정에서 개인 API 키를 연결해 주세요` — is also **the expression of this product's normal state**, so the fact that
  the cause is configuration never surfaces (`e2e/support/origins.ts`).
- **The operator is stage machinery, not the subject under test.** The moderation journey's operator side goes through
  **the very API** the operations console calls. Editing tables directly turns the journey green with state recomputation,
  notifications and appealable lists all missing, and building a journey-only operator route makes that bypass a
  vulnerability.
- **There is a reason a double server was built instead of `page.route`.** Playwright's route interception fills the
  response whole, so the interval where `generating` was true effectively does not exist, and then the 'stop', 'navigate
  mid-stream' and 'late chunk' journeys become unverifiable entirely.
- **The script rides on a request header** (`x-e2e-generation`). Control state on the double makes two journeys running
  side by side overwrite each other's scripts, and that failure does not reproduce. With no header the double invents
  nothing.
- **The double applies CORS itself and forwards to upstream as a trusted origin** — do not make journeys edit a
  developer's `.env`.
- **Retries are 0.** What these journeys mostly try to catch is races, and a retry paints that failure green. For the same
  reason `workers: 1`.
- **Journeys point only by accessible name.** Pointing by CSS class leaves the journey green even when that name disappears
  entirely — pointing by name is itself an accessibility check.
- **Narrow screens are a separate project** (`*.narrow.spec.ts`). Only what actually differs because of width is checked
  separately.
- **There are two fixture stories** (`e2e-story-chat`, `e2e-story-runtime`). Merged into one, attaching a runtime makes
  that story's `playMode` `runtime` and the conversation journey's `대화 시작` disappears. **The runtime fixture's artifact
  goes through the same compiler as production.**
- **Fixture stories are seeded by `db:seed:e2e` with fixed ids.** Entering by title from the gallery ties the journey to the
  discovery screen's sorting and filters and breaks it for reasons unrelated to conversation. The owner is NULL so the
  fixture's lifetime is not entangled with the accounts journeys create. **That fixture is re-seeded every time**
  (`globalSetup`) — that NULL has one cost, because several tests in the api suite **delete ownerless stories whole** in
  their cleanup. So a journey run right after `pnpm test` starts with no fixture, and what appears on screen then is one
  "작품을 찾을 수 없습니다" — a normal branch of this product, so the cause does not surface.
- **Accounts are created fresh per journey.** Reusing a fixed account leaves the previous journey's rooms in the next
  journey's sidebar, making assertions depend on execution order. State is not passed between journeys either.
- **Do not paper over hydration with an arbitrary wait.** A server-rendered screen's button is visible and pressable from
  the moment the document arrives but has no React handler yet — the click quietly does nothing. What to wait for is not
  time but **an observable success signal.** Inputs especially: a value filled before hydration disappears as React
  restores the DOM to its own state, and the symptom is **a submit button disabled forever**, which click retries cannot
  clear.
- **Assert results, not copy.** Guidance sentences belong to pure tests, and a journey pinning them breaks on copy changes.
- **`e2e/` is type-checked by the root `tsconfig.json`.** It belongs to no workspace, so without that file no type check
  looks at journey code at all. Playwright compiles this code as CJS, so `import.meta` does not exist.
- **The repository holds no real provider credentials.**

## When you finish

```bash
pnpm check && pnpm typecheck && pnpm test
```

## Code conventions

- **Biome 2.4.5** — tab indentation, double quotes, automatic import sorting. Do not hand-align; run `pnpm format`.
- **Relative imports carry the extension** (`./lib/errors.ts`). With `verbatimModuleSyntax` +
  `allowImportingTsExtensions`, extensionless imports do not pass.
- The web app's internal absolute paths use `#/` (e.g. `#/lib/api.ts`). `@/` is configured but unused. The api uses
  relative paths.
- `apps/api` is `erasableSyntaxOnly` — no `enum` and no parameter properties (tsx and node erase types, they do not
  transform). The one exception is the JSX in `services/mail/emails/`.
- File names are kebab-case. Tests sit beside their target as `*.test.ts`.
- Type imports are separated with `import type`.

### Comments

Comments in this repository state **why**. What the code does, the code says. Use the plain declarative register, and when
you create a new boundary leave in the file header **what that boundary does not hold and why.** Exemplars:
`packages/sdk/src/index.ts`, `packages/chat/src/index.ts`, `apps/web/src/lib/api.ts`.

## Do not touch

| Path | Instead |
| --- | --- |
| `apps/web/src/routeTree.gen.ts` | `pnpm --filter web generate-routes` |
| the `/account-deletion` path | the store listing asks for this address; once a deployment publishes it, moving the file kills the link |
| `packages/design/src/tokens.css` | edit `tokens.ts` and run `gen` |
| `apps/web/src/generated/runtime-docs*.ts` | edit `docs/public/runtime/**/*.md` and run `gen:runtime-docs`. When the public API grows, fix `features/docs/runtime-api-inventory.ts` and the reference page's `symbols` in the same commit |
| `packages/domain/src/update-notes/generated/*` | edit `update-notes/releases/**` and run `pnpm updates:generate` |
| `packages/runtime-ai-docs/src/generated/corpus.ts` | edit `docs/public/runtime/**` (or the runtime's own source) and run `pnpm runtime-ai-docs` |
| `apps/web/public/llms.txt` · `llms-full.txt` · `runtime-api.json` | the same edit, then `pnpm llms`. **These addresses are a product API** — `llms.txt` is a convention agents look for at the site root |
| `packages/runtime/src/declarations/generated.ts` | edit `packages/runtime/src/**` and run `pnpm runtime:declarations` |
| `packages/runtime/src/sandbox/generated.ts` | edit the same source and run `pnpm runtime:sandbox` — the two must carry the same digest. When the runtime source changes the mobile harness goes stale too |
| `apps/mobile/modules/rowcat-runtime-webview/assets/runtime/*` | edit `runtime-vm-harness/entry.ts` or `@rowcat/runtime-host` and run `pnpm runtime-vm:harness` — **the WASM is the pinned dependency's bytes verbatim** |
| `apps/mobile/src/lib/runtime-native/*.generated.ts` | produced by the same command |
| `packages/runtime-host/src/poc/compiled-fixture.ts` | edit `compiled-fixture-source.ts` and re-stamp it as the test says |
| `packages/ui-web/src/components/**` | shadcn output — excluded from the biome check too. There are two exceptions and both carry a comment stating why: **the motion wiring** and **the toast surface's `z-60`** |
| `apps/mobile/native-runtime.lock.json` | append only, through `pnpm mobile:update runtime:record` after bumping `RUNTIME_VERSION`. Rewriting a recorded generation's fingerprint lets new native code reuse an old generation name |
| `apps/mobile/certs/*.pem` | made by `pnpm mobile:update keys:generate` (private key written **outside** the repo). Replacing one changes which key every future binary of that channel trusts — rotation is a new `--generation`, never an overwrite |
| `apps/api/drizzle/*.sql` | edit the schema and run `db:generate`. Read and review the generated SQL |
| `.env`, `dist`, `.output` | gitignored |
| `packages/ui-native`'s `exports` · whether sheets are re-exported | the presentation capability boundary. Do not open it to let a feature through |
| the sheet bans in `public-api.test.ts` and `presentation-policy.test.ts` | architecture guards. When they break, fix that surface's container rather than adding an exception |
| **publishing `@rowcat/mcp` to npm** | not a local command. Prepare the release (`build` · `test` · `pack:verify`), bump `apps/mcp/package.json`, commit, and push a `mcp-v<version>` tag — `.github/workflows/mcp-publish.yml` runs `pnpm publish`. `prepublishOnly` refuses anywhere else, **including a coding agent's shell** |

## Frequently made mistakes

- **Do not memorize what else to fix when adding an env var.** Add the key to the schema (`config/env-schema.ts`) and run
  `pnpm env:check`, which names whichever of the ownership inventory, compose and example files you missed — that check is
  wired into `pnpm check`, so **drift surfaces in CI rather than in a deployment.** compose passes unfilled variables as
  **empty strings**, so zod's `.default()` does not run — follow the existing convention of taking `""` as unspecified and
  filling the default in code.
- **Code that only reads configuration does not import `env.ts`.** That file is a **boot facade** that reads `process.env`
  and calls `process.exit(1)` on bad values, so a diagnostic tool passing through it dies saying nothing about exactly the
  state it meant to diagnose. The rules belong to a pure layer (`resolveEnvironment`) and **boot and the CLI go through the
  same function** — a second validator makes "the server starts but doctor says it passes" representable.
- **When adding a workspace package, look at that app's `Dockerfile` manifest list too.** That stage collects only
  `package.json` files before copying sources, and a package missing from the list is absent from pnpm's workspace graph
  entirely, so **only that package's dependencies go uninstalled.** The symptom is not an install failure but the bundler
  failing to resolve a module, and it surfaces at the last stage of the image build — locally the whole workspace is
  installed so it does not reproduce.
- **Defaults have one source.** Duplicating a value into compose or `.env.example` makes only the container deployment run
  quietly on a different value. **The model is not an env var.**
- **Do not hold a cookie in a module global under SSR.** Server rendering creates a fresh client per request — in a global,
  requests go out with someone else's session.
- **New routes are mounted in `apps/api/src/routes/index.ts` only.** Scattered path prefixes make the RPC types and the
  real URLs diverge.
- **Viewing gate decisions are gathered in `apps/api/src/lib/gates.ts`.** Duplicated per route, one loosened spot is
  invisible.
- **Routes do not touch the database.** Wire parsing, authentication and HTTP translation belong to the route and relational
  operations to the service (`routes/no-route-db-access.test.ts`; only the readiness probe is exempt). While this rule was
  absent, `routes/me/index.ts` updated the member row directly, and those six lines created a whole second copy of
  `auth/viewer.ts`'s viewer projection — such drift leaks no value and breaks no test so it is invisible in review, and it
  surfaces long after the column lists split as **a new axis missing from the update response only.**
- **Throw `ApiError` from `lib/errors.ts`.** The envelope shape is `contracts`'s `ApiErrorBody`, and what clients branch on
  is `code`, not the status.
- **Make ids with `newId()` from `lib/id.ts`** (a hyphenless UUIDv4).
- **Publishing produces two visibility states** (`public`, `private`). `archived` is not a publishing destination but a
  state transition of a published work, so it has its own endpoint and is rejected as a publish request. It is an allowlist
  so new vocabulary also falls on the rejection side. **An archived story is not touched by the publish path** (both POST
  and PUT are 409).
- **Do not mix the two adult axes.** Publishing eligibility is the legal requirement (`isAdultVerified`) and gallery
  exposure also looks at the display opt-in (`canViewAdult`). The single lookup sits between them — for your own work it
  skips the display setting. Folded into one axis, publishing succeeds and the story you just made 404s.
- **The server assembles the playback snapshot.** What the client uploads is the authored content only, and `storyId`,
  `title`, `adult` and `promptProtected` are injected by the server — that is what makes
  `play_payload.storyId === story.id` structurally true.
- **Renaming and deleting a conversation end locally.** There is no `/v2/rooms` endpoint and there will not be, and it is
  not held in the query cache. The title rules belong to `@rowcat/chat` and the store re-checks rather than trusting the
  screen. Deletion is still soft — a hard delete lets another device revive the room.
- **The composer clears after the user utterance is saved to the conversation, not after `send()` returns**
  (`ConversationSendOptions.onAccepted`). Those are different facts — the first save is an IndexedDB write and can fail,
  and clearing first loses the sentence the user typed from both the screen and the conversation. When clearing,
  **compare the sent value against the current one.** Conversely **do not make `send()` wait for completion.** A second
  submit in the same tick is blocked by `generatingRef` (the synchronous copy, not the cleared input, is the basis of that
  defence).
- **An utterance that failed to save is not a turn awaiting an answer** (`awaitsAnswer`). Marking that attempt as
  unanswered makes the screen offer `다시 생성`, and that button generates from **the previous history** — the sentence the
  user just typed exists nowhere and one more answer is appended to the old conversation.
- **All three message actions are one tail rewrite.** The rule for choosing the range to delete belongs to one
  `selectChatTail` (the ordering axis is the store's `[roomId+createdAt+id]` — do not create a second ordering field).
  There are three store operations and each is **one transaction**: anchor update + tail tombstones + the room's activity
  timestamp. Split, "an edited utterance plus an old response not produced from it" stays committed. **Do not build an
  operation deleting a single middle message** (V1 conversations are linear).
- **⚠️ Editing is open on both roles now, and that is the only thing that changed.** For a while only user messages could
  be edited, and the basis — *hand-editing a model's response is a different product from regenerating* — is still true;
  it was a reason to build a **different operation**, not to build none. Until then, fixing one name in a paragraph the
  model wrote had exactly one path, `다시 생성`, and that button throws away the text you just read. What did **not**
  open:

  ```text
  the tail rule    unchanged — everything after the anchor goes. "editing the front breaks the causality
                   behind it" is true regardless of role
  provenance meta  unchanged — `model`, usage and `truncated` are left alone. Those answer *what that request
                   used*, not *what this text is now*. Keeping `truncated` is what lets a hand-edited cut
                   response still continue
  the role         unchanged — there is no path that folds an assistant record into a user utterance
  ```

- **There are two edit doors and each pins its own role by value** (`editUserMessage` ↔ `editAssistantMessage`,
  `requireEditableRole(role, expected)`). Do not merge them into `edit(id, content, role)` — with that shape the role is
  **a value in the request**, and sending `"user"` for an assistant record becomes expressible again. The screen picks the
  door by role, and **that choice also decides whether generation follows**: a user edit continues (the turn lost its
  answer), an assistant edit does **not** (the operation means "keep this answer, worded this way" — generating there
  appends a turn nobody asked for, and on managed it is billed).
- **Tail tombstones go up on their own.** Revisions are issued **at once** via `nextRevs` — calling `Date.now()` per record
  records one edit as though it spanned several milliseconds.
- **Screens that rewrite history do not call the store directly.** The one path is `rewriteHistory` — it cuts the running
  generation and commits **after raising the epoch first.** An abort signal alone cannot stop it: a request that already
  received its whole body finishes normally, and its confirming save arrives as a success, not a failure.
- **If you added a room child, look at both cascades** — `deleteRoom` and `applyTombstone`. Fixing one, the symptom appears
  on that device only, and only at the next sync.
- **Do not casually change the local IndexedDB name (`rowcat_chat_<viewerId>`).** IndexedDB has no rename, so changing the
  name is not editing one string but **migrating data** — with only the string changed the app creates a fresh empty
  database and the user's manuscripts stay under a name nobody opens. When extending the schema add a Dexie version and
  **do not delete the previous version declarations** — dropping a table is a new version that sets it to `null`
  (v24 is the example).
- **Put `db.syncState` in transactions that modify local records.** Split, a state remains where the record was saved and
  the clock was not, and the next write reissues the same revision. **The algorithm lives only in `@rowcat/sync`.**
- **A draft's `rev` and `fieldRev` are different axes.** `rev` is "the version at which this record was last touched" (it
  rises on child activity too) and `fieldRev[group]` is "the version at which that group's authored fields actually
  changed".
- **Do not forget the CORS allowlist.** Custom request headers (`Idempotency-Key`) and response headers outside the safe
  list (`Retry-After`) must be written in `app.ts` for the browser to let them through. In-process tests do not go through
  CORS so they **all pass**, the preflight goes out as a 204, and only the real request dies — nothing appearing in the
  server log was the whole of that defect (which is why the origin decision is passed as a function so rejections leave a
  `[cors]` warning). **The origin list is a value each deployment must fill** — the default is
  `http://localhost:3000`, so shipped to production as-is the health check and SSR pass while every browser call is
  blocked.
- **Tests have different characters.** api tests use **a real Postgres** and skip rather than fail when the DB is absent
  (`describe.skipIf`). web tests are pure logic and local storage tests with no React rendering.
- **Two-device behaviour is checked with an in-process harness** (`apps/web/src/test/sync-devices.ts`).
- **The api tests' plumbing belongs to `apps/api/src/test/`.** In particular the fact that **member rows are created not at
  signup but on the first `/me`** is known by one `createTestMember` — while that explanation was copied per file one place
  actually missed the `/me`, and that test passed while updating 0 rows. Keep scenarios **beside each test** (lifted into
  the harness, what is being verified hides inside the harness).
- **api tests get their own database per worker** (`rowcat_test_w1`…). They ran sequentially for a while and the basis was
  sharing — several files sweep beyond their own prefix. That basis stands and **the sharing is gone.** Isolation and
  `fileParallelism` are decided together in one place, `vitest.config.ts` (when it cannot be created they run sequentially
  on a shared database as before) — **"shared but parallel" is not representable.**
- **A file's connection pool closes when that file finishes.** Left open, idle connections linger for 30 seconds, and with
  eight workers that failure (`too many clients`) appears not in the file holding the connections but **in the next file to
  connect.**

## Work paths

**When the server starts serving new data**: `contracts` schema → `domain` model → `sdk` resource → `query` options →
screen. Do not add an identity mapper even when the contract and domain shapes are 1:1 today.

**A new endpoint**: request and response schemas in `contracts` → rules in `services/*.ts` → a handler in `routes/*.ts` →
registration in `routes/index.ts` → an `sdk` resource → `query` options.

**When an authoring screen starts handling a new field**: `authoring`'s draft model → (if needed) `contracts`'s publication
schema → `authoring`'s assembler and validation → the editor screen. Do not merge the storage model and the wire
contract — merged, changing the transport format becomes migrating drafts already accumulated on devices.

**A DB schema change**: edit `src/db/tables/*.ts` → check the export is wired in `schema.ts` → `db:generate` → read the
generated SQL → `db:migrate`.

**Attaching one more BYO provider**: add a value to `contracts`'s provider vocabulary → a catalogue row in
`services/generation/models.ts` → one adapter in `lib/generation/<provider>.ts` (`ByoAdapter`: stream + validation) → one row in
the router's `ADAPTERS` table → the label and key-issuance page in `availability.ts`. **Fix nothing else** — the
conversation lifecycle, room settings, global settings, storage and the sync protocol staying unchanged is what shows the
boundary was drawn correctly.

**Adding a new playback mode or capability to runtime stories**: the vocabulary lives in **two places** (the contract's
`StoryPlayMode` and the domain's `STORY_PLAY_MODES`) and a test at the assembly point guards their equivalence. Adding a
value **breaks compilation in both apps** because `STORY_START_LABEL` is a `Record`. Adding a capability has a different
order: `@rowcat/runtime`'s public hook → the host's capability table → `STORY_RUNTIME_CAPABILITIES` → the server's
derivation → the playback surface's disclosure and wiring. **Do not widen the vocabulary first** — then a capability name
the server attaches to no publication stands in the contract, and the screen draws it, if only as disabled guidance.

**Adding one more rate-limit policy**: one entry in `policy.ts` → one `checkRateLimit("<key>", <subject>)` line **at the
place that actually checks it** → one value in `RateLimitSubjectKind` if the subject is a new kind. **Fix nothing else.**
Before adding a new kind, answer first **whether that value is an identity the server can trust** (a value from a request
header does not pass that test). If a domain error code already exists, **use it.**

**Growing the moderation vocabulary**: for a capability, add a value to `ModerationCapability` → one `requireCapability`
line **on the route that actually checks it** → a screen label → one test that "a direct API call is refused". For an
action kind, `ModerationActionKind` → `REVERSAL_KIND` if it is reversible → the branch in `executeAction` → undoing the
effect in `reverseAction` (missed, that action can never be lifted). Here too, do not grow the vocabulary without a route
that checks it.

**Adding one more notification kind**: add a value to `NotificationKind` → that kind's DTO into the discriminated union →
the domain's `Notification` union → one `createNotification`/`notifySocialEvent` line at **the authoritative write that
actually creates it** → the `toDto` branch → the web's copy and destination → one test. **Do not grow the vocabulary
without the write that creates it.** For social events always use `notifySocialEvent` (the self and blocked gates live
there).

**Adding one more creator metric**: first confirm **whether we actually measure that value today** — a column or a log
table existing does not mean we measure it (`story.downloads` is the counterexample). If we do: the two schemas → the two
types → the aggregation (**stop if it becomes per-row counting**) → the web label → the two key-set tests. If the metric's
**meaning** (cumulative event vs current state) differs from the existing three, write that fact in the contract header
and the screen copy.

**Adding one more media kind**: add a value to `MEDIA_KIND` → one policy in `lib/media/policy.ts` (limit, output size,
cropping, **error vocabulary**) → one service in the domain that **owns** that media → a route under that domain → SDK,
query and the screen. **Fix nothing else.** Do not grow the vocabulary without a policy, and **do not let a new kind
inherit an existing kind's limits.**

**Switching storage to object storage**: one adapter under `lib/media/` → one branch in `resolveMediaStore` → the setting
in `env.ts` and **the decision folding a half configuration.** **Fix nothing else** — that is the whole reason the port
exists, and if that fact breaks the boundary was drawn wrong.

**Attaching one more identity verification authority**: add a handoff kind to `IdentityVerificationHandoff` → one adapter
in `services/identity/<authority>.ts` → the branch in `resolveIdentityVerifier` plus **the decision folding a half
configuration** in `env.ts` → a branch performing that kind in the web's `identity-handoff.ts` → one adapter test that
"fields we do not use do not cross the port". **Do not grow the vocabulary without an adapter.**

**Adding one more restriction to child accounts**: first confirm **whether the law or a provider's terms actually require
it** — grown without a basis, a child account becomes a half account. If required: add a value to
`MINOR_RESTRICTED_CAPABILITIES` → a pure decision function → the `requireNonChild` branch and a dedicated error code →
**the route that actually checks it** → the screen copy → the deployment's own terms, if it publishes any. Do not grow the
vocabulary without a route that checks it — that is a value that blocks nothing while looking like it blocks. **If the
server cannot decide the capability, write that fact in the docs and the header.**

**Adding one more update note**: copy `_template.ts` to `releases/<year>/<YYYY-MM-DD>.ts` → write the prose →
regenerate the registry with `pnpm updates:generate` and **commit it together** → `pnpm --filter @rowcat/domain test` →
print the post to paste with `pnpm updates:discord`. **There is nothing to add to the registry by hand.** Do not add a
value to `NotificationKind` or reuse `app_update`. The sentences state **what changed for the user** and carry no version
number.

**Adding one more screen to mobile**: keep the route (`src/app/*`) **thin.** The screen belongs to
`src/features/<slice>/` and which cell it draws is decided by a **pure decision function.** If it draws public data, put
identity and storage axes in the decision arguments **without reading them**, and add that file name to the
`publicSurface` filter in `lib/boundaries.test.ts` — otherwise the guarantee "it does not wait for authentication"
quietly goes missing on that screen alone.

**When you need a floating layer, choose the container first.** Find which cell that interaction is in the
「제시 방식」 table of `docs/design/ARCHITECTURE.md` and use `@rowcat/ui-native`'s container. If no cell in that table
answers the interaction, **that fact must surface in review first.**

**Creating one more conversation kind**: first check **whether you can answer `ConversationSession`'s six questions** — if
some axis cannot be answered, this is not a new conversation kind but a different product feature. If you can: one adapter
→ a hook owning that conversation's state → the screen. **Fix nothing else** — in particular, do not add a branch to
`useConversationGeneration`. `token` must be **an object whose identity does not change while that conversation
continues.**

**Changing an auto-maintenance rule**: first find which file in `@rowcat/chat` holds that rule. **If it becomes fixing an
app, you found the wrong place.** Be especially careful changing constants —
`CHAT_MAINTENANCE_RECENT_KEEP` **must equal** `CHAT_HISTORY_LIMIT`, and raising `CHAT_AUTO_MEMORY_MAX_PER_ROOM` to the
per-room ceiling lets one long conversation fill that room's slots so **the user can no longer write new memories.**
Adding a new operation kind moves four things in one commit: the vocabulary → the schema and the instructions →
`planMemoryMaintenance`'s validation → **both store implementations.**

**Adding a new sync record type**: add a codec to the domain's `sync-codec.ts` → register it in the
`local-sync/registry.ts` array (the order *is* the parent→child push order) → one row in `local-sync/store.ts`'s
type↔table table. **Do not touch the server.**

**Shrinking an authored record's shape** (removing a field or dropping a type): **it is not symmetric with adding.** Raise
`AUTHORING_SCHEMA_VERSION` → put **one pure function** folding the old version into the new one in `@rowcat/authoring` →
have the codec's decode branch on `schemaVersion` and pass through that function (do not guess from the shape) → have both
the web Dexie and mobile SQLite migrations call **the same function** → mark dirty only the records whose content actually
changed. The exemplar is `packages/authoring/src/legacy.ts`.

## Versioning

**The version we call publicly is a date, and SemVer is an internal axis.** It is not a matter of format taste but of
**who reads that value.**

```text
read by users and announcements            a date `YYYY-MM-DD`         update notes · release names
compared by machines to decide             a monotonic integer         SYNC_PROTOCOL_VERSION · SYNC_ENVELOPE_VERSION ·
                                                                       CHAT_SEED_VERSION · AUTHORING_SCHEMA_VERSION ·
                                                                       MOBILE_SCHEMA_VERSION …
required by stores and package managers    SemVer `MAJOR.MINOR.PATCH`  app.config.ts's `version` · ops_app_version_floor
```

- **Do not write `v1.4.0` on a public release.** What SemVer's MAJOR states is that **a contract broke**, and the
  counterparty to that promise is code, not users — standing that number in a release name creates one question the user
  cannot answer. A date answers what users actually ask ("when is what I am looking at from").
- **The public API's version is one path prefix** (`/v2`). There is no `v2.1` and no `2.1.0` — adding a field to a contract
  is not raising the version.
- **There is one place SemVer appears on screen and it is not an exception.** The app update announcement writes
  `iOS 앱 1.4.0 미만은 더 이상 지원되지 않습니다` — that number is **a value the store and the device already show the
  user**, so it needs something to compare against, and a date there leaves the user no way to know whether they are on it.
- **Do not turn integer axes into dates.** Those values are **compared by code to decide**, and that axis has no concept of
  minor or patch — raising the version is always "an old device must not half-read this payload". With three components
  someone eventually bumps only the patch, and that version halts every device once while breaking no compatibility.
- **A date version is a calendar date in the product timezone (`Asia/Seoul`) with no suffix.** Stamped in UTC, the same
  release is off by a day between the document and the screen, and if two versions were needed on one day that is not two
  versions but **the earlier one not yet being in force.**
- **`package.json`'s `0.0.0` is a placeholder, not a version.** Workspace packages are all `private: true` so no code reads
  that number, and once you start raising it every release edits fourteen files nobody looks at. `app.config.ts`'s
  `version` is different — it is **the build's identity**, present because the store accepts only that format, and the
  moment to raise it is submission, not release.
- **There are no git tags and no CHANGELOG yet. When there are, the name is the date** (`2026-08-27`, no `v` — with the
  prefix, a `v1.4.0` eventually stands beside it).

## Commits

Conventional Commits. The subject is one English line; the body is a Korean sentence or two stating **why.**

```
feat(api): add hono api with auth, drizzle schema and story routes

Better Auth를 /v2/auth/*에 물린 Hono 앱과 story·member·social 테이블. 열람자는
미들웨어에서 요청당 한 번만 해석하고, 가시성·성인·차단 판정은 전부 서버에서 끝낸다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

Push only when asked.
