import { viewerQueryOptions } from "@rowcat/query";
import { useQuery } from "@tanstack/react-query";
import { getRowCatClient } from "#/lib/api.ts";
import { AgePanel } from "./age-panel.tsx";
import { GuardianPanel } from "./guardian-panel.tsx";
import { type AppGate, appGateFor } from "./membership-gate-state.ts";

/**
 * membership-gate.tsx: the entry gate, the one door a signed-in user passes before product screens.
 *
 * The gate does not decide priority here. It reads the server's viewer.membershipGate. The order
 * (age, then guardian consent) belongs to the domain's resolveMembershipGate. Rebuilding it on
 * the screen creates a copy that sees old rules during a rollout, and the symptom would be 'age is
 * not asked and the user passes'.
 *
 * The gate is a covering surface, not a route. A route-based gate would require every protected
 * route to add a redirect, and a route added later would miss one. That omission appears as 'this
 * screen opens without the gate', and since the response shape looks the same, nobody notices.
 * Here, not rendering children closes every route together, and a reload draws the same decision.
 *
 * The guardian consent page is a real route (/guardian/$token). Its viewer is a guardian holding a
 * link, not a member, and it has no session or viewer, so it cannot sit inside this gate.
 */
export function useAppGate(): AppGate | null {
	const viewer = useQuery(viewerQueryOptions(getRowCatClient())).data ?? null;
	return appGateFor(viewer);
}

/**
 * The shell route renders this instead of the shell, not inside it, because this component cannot
 * remove the tree above it. The decision lives in the pure appGateFor and is read only through
 * useAppGate. Every exit from the gate sits inside these panels, so removing the shell loses no
 * exit path (checked by gate-escape.test.ts).
 */
export function AppGatePanel({ gate }: { gate: AppGate }) {
	return gate === "age" ? <AgePanel /> : <GuardianPanel />;
}
