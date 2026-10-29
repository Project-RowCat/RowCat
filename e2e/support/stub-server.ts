import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import {
	decodeGenerationScript,
	GENERATION_SCRIPT_HEADER,
	type GenerationScript,
} from "./generation-script.ts";
import { FORWARDED_ORIGIN } from "./origins.ts";

/**
 * The API stub that journeys connect to. It stands in front of the real API and intercepts only the
 * generation stream.
 *
 * - Why not page.route: Playwright's route interception fills the response all at once
 *   (route.fulfill). NDJSON then arrives in one go, the generating period effectively never exists,
 *   and the core journeys for stop, navigate-while-streaming and late chunks cannot be verified. A
 *   live stream needs a running server.
 * - Why a proxy rather than a pure stub: authentication, stories and viewer must be answered by
 *   the real server. Imitating them would make the journey test a fake rather than the product, and
 *   it would stay green when the contract changes. So only the generation stream is intercepted,
 *   and everything else is passed through.
 * - Why CORS is handled here: the browser sees this proxy's origin, not the API's. The proxy
 *   calls the API server-side, so no Origin header is attached (the same shape as SSR calling the
 *   API). The API's `WEB_ORIGIN` list therefore need not include the journey port, and journeys do
 *   not make the developer edit `.env`. The browser judges CORS from the proxy's response headers,
 *   so the headers are set here.
 * - This server is for journeys only and adds nothing to the development or production paths.
 */

const PORT = Number(process.env.E2E_STUB_PORT ?? 3011);
const TARGET = process.env.E2E_API_ORIGIN ?? "http://localhost:3001";
const WEB_ORIGIN = process.env.E2E_WEB_ORIGIN ?? "http://localhost:3100";
/**
 * The origin to pretend to be when talking to the upstream.
 *
 * Removing Origin makes Better Auth reject with `MISSING_OR_NULL_ORIGIN`. That check is CSRF
 * defense, so turning it off is not the fix. Forwarding the browser's origin (the journey port)
 * fails as well, because it is not in the API's trusted list.
 *
 * So the request goes out with an already-trusted dev origin substituted. The browser's CORS
 * judgement is made by this proxy with its own headers (`CORS_HEADERS` below), so the substitution
 * is invisible to the browser. Developers' `.env` does not need the journey port registered.
 */

/** What the browser must be allowed to pass for this proxy. Same axis as the real API's list. */
const CORS_HEADERS: Record<string, string> = {
	"access-control-allow-origin": WEB_ORIGIN,
	"access-control-allow-credentials": "true",
	"access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
	"access-control-allow-headers": `content-type,authorization,idempotency-key,${GENERATION_SCRIPT_HEADER}`,
	"access-control-expose-headers": "retry-after",
	"access-control-max-age": "600",
};

const readBody = async (req: IncomingMessage): Promise<Buffer> => {
	const parts: Buffer[] = [];
	for await (const chunk of req) parts.push(chunk as Buffer);
	return Buffer.concat(parts);
};

const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Streams the NDJSON as scripted. Stops immediately when the connection drops.
 *
 * When the user presses stop, the browser cancels the request and this side receives `close`.
 * Continuing to write would write to a socket that is already gone. More importantly, the journey's
 * premise that no chunk arrives after stop would break on the stub side.
 */
async function streamGeneration(
	res: ServerResponse,
	req: IncomingMessage,
	script: GenerationScript,
): Promise<void> {
	let closed = false;
	req.on("close", () => {
		closed = true;
	});

	res.writeHead(200, {
		...CORS_HEADERS,
		"content-type": "application/x-ndjson",
		"cache-control": "no-store",
		// If a proxy or the browser buffers in between, the stream stops being a stream, so buffering is
		// turned off here.
		"x-accel-buffering": "no",
	});

	const write = (event: unknown): boolean => {
		if (closed || res.writableEnded) return false;
		return res.write(`${JSON.stringify(event)}\n`);
	};

	if (script.leadMs) await sleep(script.leadMs);

	for (const text of script.chunks) {
		if (closed) return;
		if (!write({ type: "delta", text })) return;
		if (script.delayMs) await sleep(script.delayMs);
	}

	if (closed) return;

	if (script.ending.kind === "error") {
		write({
			type: "error",
			code: script.ending.code,
			message: script.ending.message,
		});
		res.end();
		return;
	}

	if (script.ending.kind === "hang") {
		/**
		 * Does not end here. The response is closed when the browser cancels or the journey ends. That
		 * interval is the window in which the user can press stop.
		 */
		return;
	}

	write({ type: "done", finishReason: "stop" });
	res.end();
}

/** Forwards to the real API as is. The response body is also piped through as a stream. */
async function forward(
	req: IncomingMessage,
	res: ServerResponse,
	body: Buffer,
): Promise<void> {
	const url = new URL(req.url ?? "/", TARGET);
	const headers = new Headers();
	for (const [key, value] of Object.entries(req.headers)) {
		if (value === undefined) continue;
		// `host` is set again by the destination, and `origin` is replaced below with the trusted value.
		if (key === "host" || key === "origin" || key === "connection") continue;
		// Referer is dropped too. Passing the browser's value would mismatch the upstream trusted list
		// (see FORWARDED_ORIGIN above).
		if (key === "referer") continue;
		if (key === GENERATION_SCRIPT_HEADER) continue;
		headers.set(key, Array.isArray(value) ? value.join(",") : value);
	}

	headers.set("origin", FORWARDED_ORIGIN);

	const upstream = await fetch(url, {
		method: req.method,
		headers,
		/*
		 * Does not pass the `Buffer` as is. Node's types and the DOM's `BodyInit` do not overlap here, so
		 * passing it without a copy fails the type check. The copy is the size of one request body.
		 */
		...(req.method === "GET" || req.method === "HEAD"
			? {}
			: { body: body.length > 0 ? new Uint8Array(body) : undefined }),
		redirect: "manual",
	});

	const out = new Headers(upstream.headers);
	/**
	 * The upstream's CORS judgement is discarded. That judgement is about this proxy (which has no
	 * Origin), not the browser. Passing it through would leave the browser unable to find its own
	 * origin, and it would block everything.
	 */
	for (const key of [
		"access-control-allow-origin",
		"access-control-allow-credentials",
		"access-control-expose-headers",
		"content-encoding",
		"content-length",
	])
		out.delete(key);

	const responseHeaders: Record<string, string | string[]> = {
		...CORS_HEADERS,
	};
	for (const [key, value] of out.entries()) responseHeaders[key] = value;
	// `Set-Cookie` can appear several times, and `Headers.entries()` merges them into one, so the
	// original values are passed separately.
	const cookies = upstream.headers.getSetCookie?.() ?? [];
	if (cookies.length > 0) responseHeaders["set-cookie"] = cookies;

	res.writeHead(upstream.status, responseHeaders);
	if (!upstream.body) {
		res.end();
		return;
	}
	const reader = upstream.body.getReader();
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		if (res.writableEnded) return;
		res.write(value);
	}
	res.end();
}

const server = createServer((req, res) => {
	void (async () => {
		try {
			if (req.method === "OPTIONS") {
				res.writeHead(204, CORS_HEADERS);
				return res.end();
			}

			const body = await readBody(req);
			const script =
				req.method === "POST" && req.url?.endsWith("/chat/generate")
					? decodeGenerationScript(
							req.headers[GENERATION_SCRIPT_HEADER] as string | undefined,
						)
					: null;

			if (script) return await streamGeneration(res, req, script);
			await forward(req, res, body);
		} catch (error) {
			// If the proxy fails, journeys see a failure with no cause. Log the reason.
			console.error(
				"[e2e-stub] couldn't forward the request",
				req.method,
				req.url,
				error,
			);
			if (!res.headersSent) res.writeHead(502, CORS_HEADERS);
			res.end();
		}
	})();
});

/** Health check: Playwright waits on this address before starting the journeys. */
server.on("listening", () =>
	console.log(`[e2e-stub] ${PORT} -> ${TARGET} (web: ${WEB_ORIGIN})`),
);

server.listen(PORT, "127.0.0.1");
