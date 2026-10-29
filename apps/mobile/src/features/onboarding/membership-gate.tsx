import { useMobileIdentity } from "../../lib/identity.tsx";
import { AgePanel } from "./age-panel.tsx";
import { GuardianPanel } from "./guardian-panel.tsx";
import { type AppGate, appGateFor } from "./membership-gate-state.ts";

/**
 * Entry gate: **the one door an authenticated person passes before reaching product screens.**
 *
 * ## The priority is not decided here
 *
 * This component reads one value the server computed (`viewer.membershipGate`). The order (age →
 * guardian consent) lives in the domain's `resolveMembershipGate` and runs on the server. If the
 * screen reassembled that decision from `ageStatus`, a copy would exist and would apply stale rules
 * while a deployment is rolling out.
 *
 * ## Not attached per route: it renders **instead of** the navigator
 *
 * If each screen raised its own gate, a route added later would miss it, and the missed route would
 * open without any error. So the decision lives in one place, `app/_layout.tsx`. When a gate is
 * raised, **`<Stack>` is not mounted** in that slot, so even a typed address (`/chat/<id>`,
 * `/create`, `/settings`) has no screen in the tree to draw.
 *
 * It is not an overlay on purpose. Web once covered the app with `fixed inset-0`, while the header,
 * sidebar and footer stayed in the DOM and remained live to the keyboard and assistive technology:
 * focus could land on invisible links, and the bell and account menu could open behind the cover
 * and be left unreachable. On native the same mistake is quieter (there is no focus ring).
 *
 * ## The three cases where no gate is raised
 *
 * ```text
 * guest         age is a property of the member, not of the device
 * booting       we do not yet know who this is; the gate is not drawn even for one frame
 * unavailable   failing to reach `/me` is not an answer; we do not trap on a stale value
 * ```
 *
 * All three have `session.viewer === null` and fold to the same branch (`lib/session-state.ts`).
 * Not listing a fourth case is the design's point.
 *
 * ## The guardian screen is not behind this door
 *
 * `/guardian/:token` is a **public web route**. The person who opens that address is a guardian who
 * received the link, not a member, and it must open in a browser with no session and no viewer. It
 * cannot be a screen inside this gate, and there is no reason to build a native counterpart.
 */
export function useAppGate(): AppGate | null {
	/**
	 * The viewer's source is the identity provider alone (`lib/identity.tsx`). Calling
	 * `viewerQueryOptions` here again would give two answers to "whose app is this", and they diverge
	 * during transitions: the identity provider deliberately hides the previous identity while
	 * sign-out runs (`resolveSessionState`), but reading the query directly would draw the gate of the
	 * account that has just left.
	 */
	const { session } = useMobileIdentity();
	return appGateFor(session.viewer);
}

/** The screen of the gate currently raised. **Does not wrap children**: the caller has already decided. */
export function AppGatePanel({ gate }: { gate: AppGate }) {
	if (gate === "age") return <AgePanel />;
	return <GuardianPanel />;
}
