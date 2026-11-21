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
 * Importing one of those subpaths means deleting its name here in the same commit. The desktop build
 * also drops what the API never loads on its own (`apps/desktop/scripts/build-app.ts`); the Docker
 * image has no such step, so this file is what keeps that image small.
 *
 * The mobile stack is the same story at a larger scale (~380 MB of `expo`, `react-native`, hermes and
 * metro in the API's production install). pnpm links an optional peer whenever the graph holds that
 * package anywhere, and `apps/mobile` holds all of them:
 *
 * - `drizzle-orm` → `expo-sqlite`. Only the API uses drizzle, through `pg`; nothing imports
 *   `drizzle-orm/expo-sqlite`.
 * - `@better-auth/expo` → `expo-*`. The API imports the package root (the server plugin), which loads
 *   none of them; only `/client` does, and only `apps/mobile` imports that. Mobile does not need the
 *   edge either: Metro resolves those imports from `apps/mobile/node_modules`, the same way `/client`'s
 *   `react-native` import resolves, which was never declared. This hook rewrites the manifest for every
 *   importer at once, so cutting the edge here also cuts it for mobile. That is safe only while mobile
 *   lists each of these packages as its own dependency, and `apps/mobile/package.json` must keep them.
 */
const UNUSED_PEERS = {
	"better-auth": ["next", "@tanstack/react-start", "drizzle-kit", "vitest"],
	"drizzle-orm": ["expo-sqlite"],
	"@better-auth/expo": [
		"expo-constants",
		"expo-linking",
		"expo-network",
		"expo-secure-store",
		"expo-web-browser",
	],
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
