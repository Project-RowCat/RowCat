import type { GenerationModelDto } from "@rowcat/contracts";

/**
 * The rules for a user-configured OpenAI-compatible endpoint: which address is accepted, which model
 * names, and how those names become rows the model picker can show.
 *
 * Every other BYO provider has an address that is a constant in its adapter and models the server
 * catalogue lists. This one has neither: the person enters the address and the model names, so the
 * device is the only place that knows them. That is why the rules live here, pure — both apps' connect
 * dialogs, stores and pickers call these same functions, and a second copy would let one app accept an
 * address the other refuses.
 *
 * What the address rule protects is the key, not the conversation. The person chose where their
 * conversation goes; what we refuse is sending their key somewhere it can be read on the way. So
 * `https` is accepted for any host, and plain `http` only for this device's own loopback (a local
 * server such as Ollama or LM Studio), where the request never leaves the machine.
 *
 * `URL` is not used: Hermes ships only a partial implementation and browsers are lenient in ways that
 * differ (the runtime's asset rule avoids it for the same reason). The parse is narrow on purpose —
 * anything it cannot describe is refused rather than guessed at.
 *
 * Not here: whether the server speaks the protocol (the connect dialog's probe asks it), and
 * capabilities. Nothing about such a server is known, so its rows carry no reasoning levels and no
 * narration pack; listing a level would promise a parameter the server may reject.
 */

export const OPENAI_COMPATIBLE_PROVIDER = "openai-compatible-byo" as const;

/** The provider label; the same words as both apps' provider tables. */
export const OPENAI_COMPATIBLE_LABEL = "OpenAI-compatible";

/** Hosts plain `http` is accepted for: this device's loopback only. */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set([
	"localhost",
	"127.0.0.1",
	"[::1]",
]);

export const OPENAI_COMPATIBLE_ENDPOINT_MAX_LENGTH = 300;
export const OPENAI_COMPATIBLE_MODEL_MAX_LENGTH = 200;
export const OPENAI_COMPATIBLE_MAX_MODELS = 20;

export type OpenAiCompatibleEndpointCheck =
	| { ok: true; endpoint: string }
	/**
	 * - `empty`: nothing entered.
	 * - `insecure`: plain `http` to a host that is not this device; the key would cross the network
	 *   readable.
	 * - `invalid`: not an address this rule can describe (credentials, query, fragment, whitespace, a
	 *   malformed host or port).
	 */
	| { ok: false; reason: "empty" | "insecure" | "invalid" };

const HOST_NAME =
	/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;
const IPV6_LITERAL = /^\[[0-9a-f:.]+\]$/;
const PATH = /^(\/[A-Za-z0-9._~!$&'()*+,;=:@%-]*)*$/;

/**
 * Entered text → the base address the adapter appends `/chat/completions` and `/models` to, or a
 * reason.
 *
 * The result is canonical (lowercase scheme and host, no trailing slash), so the same server typed two
 * ways is one stored value. Idempotent: checking an already-checked endpoint returns it unchanged.
 */
export function checkOpenAiCompatibleEndpoint(
	raw: string,
): OpenAiCompatibleEndpointCheck {
	const text = raw.trim();
	if (!text) return { ok: false, reason: "empty" };
	if (text.length > OPENAI_COMPATIBLE_ENDPOINT_MAX_LENGTH)
		return { ok: false, reason: "invalid" };
	// Whitespace and control characters anywhere; `?` and `#` would put part of the request in a place
	// the adapter does not build.
	for (const char of text) {
		const code = char.codePointAt(0) ?? 0;
		if (code <= 0x20 || code === 0x7f || char === "?" || char === "#")
			return { ok: false, reason: "invalid" };
	}

	const separator = text.indexOf("://");
	if (separator < 0) return { ok: false, reason: "invalid" };
	const scheme = text.slice(0, separator).toLowerCase();
	if (scheme !== "https" && scheme !== "http")
		return { ok: false, reason: "invalid" };

	const rest = text.slice(separator + 3);
	const slash = rest.indexOf("/");
	const authority = (slash < 0 ? rest : rest.slice(0, slash)).toLowerCase();
	const path = slash < 0 ? "" : rest.slice(slash);
	/** Credentials in the address would be sent to that host in a second place the key is not. */
	if (!authority || authority.includes("@"))
		return { ok: false, reason: "invalid" };

	let host: string;
	let port: string | null = null;
	if (authority.startsWith("[")) {
		const close = authority.indexOf("]");
		if (close < 0) return { ok: false, reason: "invalid" };
		host = authority.slice(0, close + 1);
		const after = authority.slice(close + 1);
		if (after) {
			if (!after.startsWith(":")) return { ok: false, reason: "invalid" };
			port = after.slice(1);
		}
		if (!IPV6_LITERAL.test(host)) return { ok: false, reason: "invalid" };
	} else {
		const colon = authority.indexOf(":");
		host = colon < 0 ? authority : authority.slice(0, colon);
		if (colon >= 0) port = authority.slice(colon + 1);
		if (!HOST_NAME.test(host)) return { ok: false, reason: "invalid" };
	}
	if (port !== null) {
		if (!/^[0-9]{1,5}$/.test(port)) return { ok: false, reason: "invalid" };
		const value = Number(port);
		if (value < 1 || value > 65535) return { ok: false, reason: "invalid" };
	}

	if (!PATH.test(path)) return { ok: false, reason: "invalid" };
	if (scheme === "http" && !LOOPBACK_HOSTS.has(host))
		return { ok: false, reason: "insecure" };

	const trimmedPath = path.replace(/\/+$/, "");
	return {
		ok: true,
		endpoint: `${scheme}://${host}${port === null ? "" : `:${port}`}${trimmedPath}`,
	};
}

/** The host part of a checked endpoint; the picker's sub-group heading names the server by it. */
export function openAiCompatibleHost(endpoint: string): string {
	const rest = endpoint.slice(endpoint.indexOf("://") + 3);
	const slash = rest.indexOf("/");
	return slash < 0 ? rest : rest.slice(0, slash);
}

export type OpenAiCompatibleModelsCheck =
	| { ok: true; models: string[] }
	/**
	 * - `empty`: no name entered. A connection with no model has nothing to choose.
	 * - `invalid`: a name with whitespace inside or over the length cap.
	 * - `too_many`: over `OPENAI_COMPATIBLE_MAX_MODELS`.
	 */
	| { ok: false; reason: "empty" | "invalid" | "too_many" };

/**
 * Entered names (one per line or comma-separated) → the list stored with the connection.
 *
 * Names are kept verbatim apart from trimming: the adapter puts each one into the request body as-is,
 * and servers name models with slashes, colons and case (`llama3.1:8b`, `org/model`). Duplicates keep
 * the first; order is the person's.
 */
export function parseOpenAiCompatibleModels(
	raw: string,
): OpenAiCompatibleModelsCheck {
	const seen = new Set<string>();
	const models: string[] = [];
	for (const part of raw.split(/[\n,]/)) {
		const name = part.trim();
		if (!name) continue;
		if (name.length > OPENAI_COMPATIBLE_MODEL_MAX_LENGTH || /\s/.test(name))
			return { ok: false, reason: "invalid" };
		if (seen.has(name)) continue;
		seen.add(name);
		models.push(name);
	}
	if (models.length === 0) return { ok: false, reason: "empty" };
	if (models.length > OPENAI_COMPATIBLE_MAX_MODELS)
		return { ok: false, reason: "too_many" };
	return { ok: true, models };
}

/** What a stored connection says about its server. Not secret; the key is never part of it. */
export interface OpenAiCompatibleConnection {
	endpoint: string;
	models: readonly string[];
}

/**
 * A stored value → the same connection re-checked, or `null`.
 *
 * Both apps' stores read with this. A stored row is never trusted to be what the dialog wrote (a
 * device can hold a row from an older rule, or one edited by hand); an address or a name the rules
 * now refuse makes the connection absent, so the key is never sent somewhere the rule would refuse.
 * Only a value already in canonical form passes — re-checking must not silently rewrite it.
 */
export function readOpenAiCompatibleConnection(
	value: unknown,
): OpenAiCompatibleConnection | null {
	if (typeof value !== "object" || value === null) return null;
	const { endpoint, models } = value as {
		endpoint?: unknown;
		models?: unknown;
	};
	if (typeof endpoint !== "string" || !Array.isArray(models)) return null;
	const checked = checkOpenAiCompatibleEndpoint(endpoint);
	if (!checked.ok || checked.endpoint !== endpoint) return null;
	if (!models.every((model): model is string => typeof model === "string"))
		return null;
	const parsed = parseOpenAiCompatibleModels(models.join("\n"));
	if (!parsed.ok || parsed.models.length !== models.length) return null;
	return { endpoint, models: parsed.models };
}

/**
 * A connection → catalogue-shaped rows, so the picker, availability and capability lookups treat these
 * models like any other BYO entry.
 *
 * Both apps merge these into the catalogue they hand the picker. No capabilities: `reasoning: null`
 * means the row has no adjustable level (so none is sent), and `promptPack: null` means no narration
 * pack. The id follows the catalogue's `provider:model` rule (`generationTargetKey`), so a stored
 * target meets its row.
 */
export function openAiCompatibleModelRows(
	connection: OpenAiCompatibleConnection | null | undefined,
): GenerationModelDto[] {
	if (!connection) return [];
	const vendorLabel = openAiCompatibleHost(connection.endpoint);
	return connection.models.map((model) => ({
		id: `${OPENAI_COMPATIBLE_PROVIDER}:${model}`,
		provider: OPENAI_COMPATIBLE_PROVIDER,
		providerLabel: OPENAI_COMPATIBLE_LABEL,
		vendorLabel,
		label: model,
		model,
		requiresConnection: true,
		reasoning: null,
		promptPack: null,
	}));
}
