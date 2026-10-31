/// <reference types="vite/client" />

interface ImportMetaEnv {
	/**
	 * API origin override. Do not add the path prefix (`/v2`); `@rowcat/sdk` adds it. When empty,
	 * development uses http://localhost:3001 and production builds use the production domain.
	 */
	readonly VITE_API_ORIGIN?: string;
	/**
	 * Origin of the admin console (apps/admin), origin only with no path. When empty, development uses
	 * http://localhost:3002 and production builds render no link. The reason a domain is not guessed
	 * is in the header of src/lib/admin-console.ts.
	 */
	readonly VITE_ADMIN_ORIGIN?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}

/**
 * The id of this build output (vite.config.ts `define`). Compared with the server's
 * `/rowcat-build.json` to learn that a newer deployment is serving (`lib/build-freshness/`). Absent
 * where nothing defines it (vitest), so it is read through `typeof`.
 */
declare const __ROWCAT_BUILD_ID__: string | undefined;
