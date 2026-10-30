import { createReadStream, readFileSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, join, normalize, sep } from "node:path";

/**
 * Serves the operations console's built files — the job nginx does in the console's container
 * (`apps/admin/nginx.conf`), with the same three rules: SPA fallback, `no-store` on the document and
 * `immutable` on hashed assets, and the same security headers on every response.
 *
 * The API origin goes into the document's `<meta name="rowcat-api-origin">` and the CSP's
 * `connect-src` from one value, as `apps/admin/docker/rowcat-runtime-config.sh` does — two values that
 * could disagree show up only as "network failure".
 *
 * What this does not hold: directory listings, range requests or compression. The console is a
 * few hundred kilobytes read over loopback.
 */
export function startConsoleServer(options: {
	distDir: string;
	apiOrigin: string;
	port: number;
}): Promise<Server> {
	const { distDir, apiOrigin, port } = options;
	const index = readFileSync(join(distDir, "index.html"), "utf8").replace(
		"</head>",
		`<meta name="rowcat-api-origin" content="${apiOrigin}" /></head>`,
	);
	const headers = {
		"X-Robots-Tag": "noindex, nofollow",
		"X-Frame-Options": "DENY",
		"X-Content-Type-Options": "nosniff",
		"Referrer-Policy": "no-referrer",
		"Content-Security-Policy": `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' ${apiOrigin}; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'`,
	};

	const server = createServer((req, res) => {
		const pathname = decodeURIComponent(
			new URL(req.url ?? "/", "http://console").pathname,
		);
		const file = normalize(join(distDir, pathname));
		// A path that climbs out of the bundle folder is answered with the document, not the file.
		const inside = file.startsWith(distDir + sep);
		const asset =
			inside && pathname !== "/index.html" && isFile(file) ? file : null;

		if (!asset) {
			res.writeHead(200, {
				...headers,
				"Content-Type": "text/html; charset=utf-8",
				"Cache-Control": "no-store",
			});
			res.end(index);
			return;
		}
		res.writeHead(200, {
			...headers,
			"Content-Type":
				CONTENT_TYPES[extname(asset)] ?? "application/octet-stream",
			"Cache-Control": pathname.startsWith("/assets/")
				? "public, max-age=31536000, immutable"
				: "no-cache",
		});
		createReadStream(asset).pipe(res);
	});

	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen({ port, host: "127.0.0.1" }, () => resolve(server));
	});
}

function isFile(path: string): boolean {
	try {
		return statSync(path).isFile();
	} catch {
		return false;
	}
}

const CONTENT_TYPES: Record<string, string> = {
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".html": "text/html; charset=utf-8",
	".json": "application/json",
	".svg": "image/svg+xml",
	".png": "image/png",
	".ico": "image/x-icon",
	".webp": "image/webp",
	".woff2": "font/woff2",
	".txt": "text/plain; charset=utf-8",
};
