import type { GenerationTarget } from "./generation-preference.ts";

/**
 * The person's own words on the OpenRouter route: a model name they type in the picker, and the model
 * provider they type for it. Both apps' pickers call these same functions, so one app cannot accept a
 * name or a provider the other refuses.
 *
 * OpenRouter is a gateway; it routes far more models than the server catalogue lists, and each model
 * is served by several companies (Anthropic, Amazon Bedrock, Google Vertex, DeepInfra, …). So:
 *
 * - **Any model name** can be typed into the picker (`checkOpenRouterModel`, the gateway's
 *   `vendor/model[:variant]` shape) and is stored as the target's model, like a catalogue pick. A typed
 *   name the catalogue does not list is still executable on this route (`resolveGenerationExecution`
 *   skips the catalogue check for it) and is drawn as itself, not as "not in the list". No capabilities
 *   are known for it: no reasoning row (nothing is sent; the model's default applies) and no narration
 *   pack. A typed name the catalogue does list simply meets its row.
 * - **The model provider** is typed beside the model and stored on the target
 *   (`GenerationTarget.upstream`), so it inherits room → global with its model and picking another model
 *   drops it. It is the gateway's provider slug (`anthropic`, `amazon-bedrock`, `deepinfra/fp8`), sent as
 *   `provider: { order: [slug], allow_fallbacks: false }` by each app's adapter — strict, because a
 *   fallback moves the prompt to a company the person chose against.
 *
 * Not here: whether a name or a provider exists. The gateway answers that when the request is sent; a
 * wrong one is a failure with its own name, not something this rule could know. The server never
 * learns either — BYO requests do not pass through it.
 *
 * `URL` and locale functions are not used (Hermes); the parse is narrow and refuses what it cannot
 * describe.
 */

export const OPENROUTER_PROVIDER = "openrouter-byo" as const;

export const OPENROUTER_MODEL_MAX_LENGTH = 200;
export const OPENROUTER_UPSTREAM_MAX_LENGTH = 100;

/**
 * `vendor/model`, optionally `:variant` (`:free`, `:nitro`), optionally led by `~` (the gateway's
 * "latest" aliases, `~anthropic/claude-sonnet-latest`). Every one of the 455 ids `/api/v1/models` listed
 * on 2026-11-04 passes; a name without the vendor segment is not one the gateway routes.
 */
const MODEL_SLUG =
	/^~?[a-z0-9][a-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*(:[a-z0-9-]+)?$/;

/** Lowercase segments joined by `/`: the shape of the gateway's provider slugs and endpoint tags. */
const UPSTREAM_SLUG = /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*$/;

/** Whether a model name has the gateway's shape; the read side of `checkOpenRouterModel`. */
export const isOpenRouterModelName = (value: unknown): value is string =>
	typeof value === "string" &&
	value.length <= OPENROUTER_MODEL_MAX_LENGTH &&
	MODEL_SLUG.test(value);

export type OpenRouterModelCheck =
	| { ok: true; model: string }
	/** `empty`: nothing typed. `invalid`: not `vendor/model[:variant]`, or over the length cap. */
	| { ok: false; reason: "empty" | "invalid" };

/** What the person typed in the picker's model field → the model to store, kept verbatim (trimmed). */
export function checkOpenRouterModel(raw: string): OpenRouterModelCheck {
	const model = raw.trim();
	if (!model) return { ok: false, reason: "empty" };
	return isOpenRouterModelName(model)
		? { ok: true, model }
		: { ok: false, reason: "invalid" };
}

/** A stored or typed value → a host slug, or `null`. Used at every read boundary. */
export function readOpenRouterUpstream(value: unknown): string | null {
	if (typeof value !== "string") return null;
	if (!value || value.length > OPENROUTER_UPSTREAM_MAX_LENGTH) return null;
	return UPSTREAM_SLUG.test(value) ? value : null;
}

export type OpenRouterUpstreamCheck =
	/** `null` upstream: the field is empty, so the gateway chooses. */
	{ ok: true; upstream: string | null } | { ok: false; reason: "invalid" };

/**
 * What the person typed in the host field → the value to store. Trimmed and lowercased (the gateway's
 * slugs are lowercase, and `Amazon-Bedrock` typed by hand means the same company); empty means the
 * gateway chooses.
 */
export function checkOpenRouterUpstream(raw: string): OpenRouterUpstreamCheck {
	const text = raw.trim().toLowerCase();
	if (!text) return { ok: true, upstream: null };
	const upstream = readOpenRouterUpstream(text);
	return upstream ? { ok: true, upstream } : { ok: false, reason: "invalid" };
}

/** The OpenRouter target with this host pinned, or with none (`null`: the gateway chooses). */
export function withOpenRouterUpstream(
	target: Extract<GenerationTarget, { provider: "openrouter-byo" }>,
	upstream: string | null,
): GenerationTarget {
	const checked = readOpenRouterUpstream(upstream);
	return checked
		? { provider: target.provider, model: target.model, upstream: checked }
		: { provider: target.provider, model: target.model };
}

/** The pinned host of a target, or `null` (any other provider, or the gateway chooses). */
export const openRouterUpstreamOf = (
	target: GenerationTarget | null,
): string | null =>
	target?.provider === "openrouter-byo" ? (target.upstream ?? null) : null;
