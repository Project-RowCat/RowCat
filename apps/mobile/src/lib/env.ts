/**
 * The mobile environment boundary. **Only one value comes in here: the API origin.**
 *
 * The web reads `import.meta.env.VITE_API_ORIGIN`, but that expression belongs to Vite. In Expo the
 * same slot is filled by `process.env.EXPO_PUBLIC_*`, and that value is **inlined into the
 * bundle**. So only values that are harmless when public may come in here.
 *
 * ```text
 * may come in        the API origin
 * must never         API keys · Apple secret · OAuth client secret · BYO provider keys · DEK
 * ```
 *
 * The last line is a fact, not a rule. Anyone who downloads the app binary can read a value with
 * the `EXPO_PUBLIC_` prefix, and that is a **public deployment**, not a configuration mistake.
 *
 * **There is no default: if it is empty, the app throws where it starts.** Both candidates are
 * wrong:
 *
 * ```text
 * localhost         a physical device cannot reach the developer machine's localhost; forgetting the
 *                   setting silently reaches nothing
 * a production      it once was. That value was the address of the one operator who ran this
 *   origin          repository, and a fork that forgets to set the origin silently attaches to someone
 *                   else's production server
 * ```
 *
 * So local development also fills `EXPO_PUBLIC_API_ORIGIN` **explicitly** (`README.md` describes
 * the method rather than `.env.example`; the repository-root `.env` belongs to the server). If it
 * is forgotten, the first screen stops with this message, which is closer to the cause than a 401
 * from the wrong server.
 *
 * In EAS builds, a missing origin or an example.com placeholder **stops the build**
 * (`app.config.ts`, `src/lib/build-profile.ts`). This throw is the last line for local runs that do
 * not pass through that gate.
 */
import { apiBaseUrl } from "@rowcat/sdk";

const configured = process.env.EXPO_PUBLIC_API_ORIGIN?.trim();

if (!configured)
	throw new Error(
		"EXPO_PUBLIC_API_ORIGIN is missing — this app has no default API origin. " +
			"Write the API origin to connect to in apps/mobile/.env.local (or the shell) " +
			"(e.g. for a dev server on the same Wi-Fi, http://192.168.0.10:3001).",
	);

export const API_ORIGIN: string = configured;

/**
 * The web origin: **the route to the screens that live on the web** (account-deletion guidance,
 * guardian consent, password reset, shared story addresses), and without it those routes do not
 * exist.
 *
 * It is not derived from the API origin (for example by stripping an `api.` prefix). That would be
 * a **guessed domain**, and a guessed address becomes a dead link that reads as "the app is
 * broken". The web's `lib/admin-console.ts` records the same judgement for the operations console
 * address.
 *
 * So there is no default. In a deployment that does not fill it, the links to account deletion
 * guidance and password reset are **not drawn** (`lib/public-web.ts`).
 * The sentences stay; the links are a convenience on top.
 *
 * The fact that `EXPO_PUBLIC_` values are inlined into the bundle still applies: this value is a
 * public website's address, so that is acceptable.
 */
const webOrigin = process.env.EXPO_PUBLIC_WEB_ORIGIN?.trim();

export const WEB_ORIGIN: string | null = webOrigin || null;

/**
 * The base URL. The path prefix (`/v2`) is **not added here**.
 *
 * `@rowcat/contracts` decides the prefix and `@rowcat/sdk` attaches it. If mobile wrote
 * `${origin}/v2` there would be a second copy of that rule, and on the day the prefix changes only
 * the web would be fixed.
 */
export const API_BASE_URL = apiBaseUrl(API_ORIGIN);
