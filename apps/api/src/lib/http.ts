import { createHash } from "node:crypto";
import type { Context } from "hono";
import type { AppEnv } from "../app.ts";
import { badRequest } from "./errors.ts";

/**
 * Viewer key for view counting: `m:<id>` for members, `a:<hash>` for guests. Guests are stored only
 * as a hash of IP and User-Agent; dedup needs "same person?" and nothing else, so raw personal data
 * is not kept.
 */
export function viewerKey(c: Context<AppEnv>, viewerId: string | null): string {
	if (viewerId) return `m:${viewerId}`;
	// Behind a proxy the socket address is the load balancer, so use the first X-Forwarded-For value.
	// It is forgeable, but this only dedups view counts; the worst case is a slightly higher count.
	const ip =
		(c.req.header("x-forwarded-for") ?? "").split(",")[0]?.trim() ?? "";
	const ua = c.req.header("user-agent") ?? "";
	return `a:${createHash("sha256").update(`${ip}|${ua}`).digest("base64url").slice(0, 22)}`;
}

/** Whether the client's `If-None-Match` matches, so the caller can answer 304 without a body. */
export function notModified(c: Context<AppEnv>, etag: string): boolean {
	const inm = c.req.header("if-none-match");
	// A proxy may add the `W/` prefix or send several values.
	return (
		!!inm && inm.split(",").some((v) => v.trim().replace(/^W\//, "") === etag)
	);
}

/**
 * The one ETag format. Accepts bytes or an already-derived content identity (covers pass
 * `story_cover.version`, so there is no re-hashing per response); quoting and length rules live
 * here so one resource never yields differently shaped ETags per path.
 */
export const etagOf = (value: Buffer | string): string =>
	`"${createHash("sha256").update(value).digest("base64url").slice(0, 27)}"`;

/**
 * Small Node Buffers are slices of a shared pool, so passing `.buffer` as-is would put other data
 * from the pool in the response; copying only the byteOffset range is the safe form.
 */
export const toArrayBuffer = (buf: Buffer): ArrayBuffer =>
	buf.buffer.slice(
		buf.byteOffset,
		buf.byteOffset + buf.byteLength,
	) as ArrayBuffer;

/**
 * Ends this response's connection. Under the Node server the bindings carry the outgoing response,
 * and destroying it frees what is still queued on the socket; returning the slot alone would leave a
 * stalled client holding those bytes. Elsewhere (`app.request` in tests, other adapters) there is
 * nothing to destroy, and the caller's slot accounting still runs.
 */
export function destroyResponse(c: Context<AppEnv>): void {
	const outgoing = (c.env as { outgoing?: { destroy(): void } } | undefined)
		?.outgoing;
	outgoing?.destroy();
}

/** Read failure is `null`: empty body, broken JSON and wrong Content-Type all fold into one value, so the zod check answers `invalid_input`. */
export const readJson = (c: Context<AppEnv>): Promise<unknown> =>
	c.req.json().catch(() => null);

/**
 * Query-string `limit`. No `z.coerce`: bad values must be rejected, not quietly defaulted, so
 * fractions and non-numbers stay `NaN` and the contract answers 400 instead of becoming
 * `undefined`.
 */
export function readLimit(sp: URLSearchParams): number | undefined {
	const raw = sp.get("limit");
	if (raw === null) return undefined;
	return Number.isSafeInteger(Number(raw)) ? Number(raw) : Number.NaN;
}

/** Keeps the response out of proxies and back-button snapshots. */
export const noStore = (c: Context<AppEnv>): void => {
	c.header("Cache-Control", "private, no-cache");
};

/** Shared guard for operations that require an `Idempotency-Key`. Sync push does not use it; it validates the key's shape with zod and has its own error vocabulary (`routes/me/sync.ts`). */
export function requireIdempotencyKey(c: Context<AppEnv>): string {
	const key = c.req.header("Idempotency-Key")?.trim() ?? "";
	if (!key)
		throw badRequest(
			"The Idempotency-Key header is required.",
			"idempotency_key_required",
		);
	return key;
}
