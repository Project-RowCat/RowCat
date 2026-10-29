/**
 * Origin of the operator console (`apps/admin`). It is another app's address.
 *
 * The value is configuration, not a constant. The console usually runs on a separate host (internal
 * network or VPN; see the admin service comment in `docker-compose.yml`), so the repo has no
 * verified production domain. Writing an example domain here would freeze an unverified fact, and
 * the link would silently break when the deployment moves.
 *
 * When unset, the value is null and the account screen omits the section (fail-closed). A guessed
 * address is worse: an operator in the middle of an incident would follow a link to a domain that
 * does not serve the console.
 *
 * The development default is the fixed port the repo uses (3002, matching `pnpm dev:admin` and
 * `docker-compose.yml`). It applies only under `import.meta.env.DEV`. Production bundles drop that
 * branch, so the deployed web never points users' browsers at localhost. The `VITE_API_ORIGIN`
 * incident noted in the Dockerfile is the reason.
 *
 * The web used to host its own `/moderation` beside the console. The two copies drifted
 * (reliability fixes landed only in the console), so only this link remains.
 *
 * This is not authorization. The link merely hides the entry from ordinary members. The console has
 * its own gate (`apps/admin/src/lib/operator.ts`), and the real rejection is the 403 that
 * `requireModeratorViewer` returns for every console query. Filling this value by hand opens an
 * empty console.
 */

/**
 * Console port in the development stack. Must match `docker-compose.yml` and
 * `apps/admin/vite.config.ts`.
 */
const DEVELOPMENT_ADMIN_ORIGIN = "http://localhost:3002";

/**
 * An empty build argument arrives as an empty string. `??` does not filter that out and `new
 * URL('')` throws, so `||` is used. `lib/api.ts` uses the same shape for the same reason.
 */
const configured = import.meta.env.VITE_ADMIN_ORIGIN?.trim() || undefined;

/**
 * A malformed URL fails at module load, not on the first click.
 *
 * Keep only the origin. Appending a value that contains a path (for example
 * `https://admin.example.com/moderation`) would produce a broken address whose only symptom is a
 * 404 with no visible cause.
 */
function normalize(origin: string): string {
	return new URL(origin).origin;
}

/**
 * Origin of the operator console, or null when not configured.
 *
 * It is exported as a constant because the value is fixed at build time. Wrapping it in a hook
 * would add a lookup to every consumer for no benefit.
 */
export const ADMIN_CONSOLE_ORIGIN: string | null = configured
	? normalize(configured)
	: import.meta.env.DEV
		? DEVELOPMENT_ADMIN_ORIGIN
		: null;
