---
title: "Tool round trips keep the room's reasoning only on models that think anyway; default effort is low"
author: Astra-void
date: 2026-11-25
branch: main
cost: { minutes: 20, tokens: 388527 }
id: l-37a736bb
scope: repo
status: active
src: agent
touches:
  - AGENTS.md
  - apps/admin/src/features/operations/operations-page.tsx
  - apps/api/src/routes/admin/index.test.ts
  - apps/api/src/routes/chat-budget.test.ts
  - apps/api/src/routes/chat-story.test.ts
  - apps/api/src/routes/chat.test.ts
  - apps/api/src/routes/chat.ts
  - apps/api/src/routes/runtime-config.ts
  - apps/api/src/services/generation/budget.ts
  - apps/api/src/services/generation/chat.test.ts
---

## Decided
- A tool loop's follow-up request used to drop reasoning for every model. On models that think without any parameter (Fable 5.x, Opus 5.5/5, Sonnet 5.5/5, Haiku 5.5) that never turned thinking off, it only reset depth to the model's own default — a `low` room paid for medium/high thinking on every follow-up round. Now the follow-up carries the turn's level and each adapter decides per model with one shared rule.
- Models where the parameter is what turns thinking on (Opus 4.8/4.7/4.6, Sonnet 4.6, the 4.5 manual-budget generation) and every non-Anthropic model still drop it on round trips: the assembled assistant turn has no thinking block, which the extended form requires (400 after the body already streamed).
- Product default reasoning effort went medium → low (2026-11-25): thinking is billed as output, and output dominates per-turn cost on Opus 5.5. Unsupported levels still fold to the catalog's defaultEffort.

## Tried and ruled out
- Keeping reasoning for all models on round trips: brings back the extended-form 400.
- Deciding in `nextChatToolRequest`: @rowcat/chat does not know the model there; the adapter does.

## Watch out
- Only Sonnet 5.5 was measured live keeping thinking on a follow-up without replayed thinking blocks; Opus 5.5 and Fable were not measured.
- A new Anthropic model that thinks by default must be added to the set, or its tool rounds silently run at the model default.

In the code: packages/chat/src/tool-round-reasoning.ts (chatToolRoundReasoning, THINKS_WITHOUT_PARAMETER, id normalization for `anthropic/…`, `.`→`-`, `:variant`, `~`); called from apps/{web,mobile}/src/lib/generation/{anthropic,gemini,chat-completions}.ts and apps/api/src/services/generation/chat.ts (buildProviderRequestBody + failure diagnostics); PRODUCT_REASONING_EFFORT in packages/chat/src/generation-preference.ts.
