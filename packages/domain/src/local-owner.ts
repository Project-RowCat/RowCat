/**
 * Whether this page was opened at a loopback address — the browser's half of "use without signing in"
 * (the local owner, `@rowcat/contracts`'s `deployment-setup.ts`).
 *
 * It decides only whether asking is worth a request. The server decides whether the request really is
 * from its own computer (`apps/api/src/lib/local-request.ts`), and answers 404 otherwise — so a page
 * opened at `localhost` behind some tunnel is merely one wasted request, never a session.
 *
 * Web and console both read it; mobile never does (an app has no page address, and the local owner has
 * no password to sign the app in with).
 */
export function isLoopbackHostname(hostname: string): boolean {
	const value = hostname.toLowerCase();
	return (
		value === "localhost" ||
		value === "[::1]" ||
		/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value)
	);
}
