import { Redirect } from "expo-router";
import { VisualLabScreen } from "../features/visual-lab/visual-lab-screen.tsx";

/**
 * Visual QA lab: not in release UI. Same mechanism as `/dev-tools`: the route file stays in release
 * bundles (expo-router reads every file under `src/app/`) but the line below sends that build back
 * to the first screen, so neither deep links nor hand-typed addresses open it.
 *
 * It is a separate route from diagnostics because folding them would put the session and storage
 * diagnostic table in every visual-comparison screenshot, which web's lab does not have. In a dev
 * build the only way in is typing `/visual-lab`.
 */
export default function VisualLab() {
	if (!__DEV__) return <Redirect href="/" />;
	return <VisualLabScreen />;
}
