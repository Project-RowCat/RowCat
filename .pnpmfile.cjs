/**
 * Optional peers that pnpm would otherwise wire into what we ship.
 *
 * `better-auth` names a framework integration or tool for every stack it supports as an optional
 * peer. pnpm resolves an optional peer whenever the workspace happens to hold that package — the web
 * app's TanStack Start, the API's own dev tools — and `pnpm deploy --prod` then ships it, because a
 * production dependency asked for it. Nothing here imports the subpaths that need them
 * (`better-auth/next-js`, `/tanstack-start`, `/test-utils`, the CLI's `drizzle-kit`), so each edge
 * carried only weight: `next` was ~290 MB of the API image, `drizzle-kit` with esbuild ~70 MB more,
 * and every one of those files is one more the desktop installer writes.
 *
 * `pnpm.overrides` cannot cut these: an override replaces the version pnpm picks, while the peer is
 * still satisfied from the importer's own `devDependencies` (the API has `drizzle-kit` and `vitest`).
 * Deleting the declaration is the one thing that removes the edge.
 *
 * Importing one of those subpaths means deleting its name here in the same commit. Do not add
 * `@better-auth/expo`'s `expo-*` peers: the mobile app's client plugin really imports them, and this
 * hook rewrites the manifest for every importer at once. The desktop build drops what the API never
 * loads on its own (`apps/desktop/scripts/build-app.ts`).
 */
const UNUSED_PEERS = {
	"better-auth": ["next", "@tanstack/react-start", "drizzle-kit", "vitest"],
};

function readPackage(pkg) {
	const names = UNUSED_PEERS[pkg.name];
	if (!names) return pkg;
	for (const name of names) {
		if (pkg.peerDependencies) delete pkg.peerDependencies[name];
		if (pkg.peerDependenciesMeta) delete pkg.peerDependenciesMeta[name];
	}
	return pkg;
}

module.exports = { hooks: { readPackage } };
