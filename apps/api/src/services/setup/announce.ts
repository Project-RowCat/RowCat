import { formatSetupCode } from "@rowcat/domain";
import { prepareDeploymentSetup } from "./index.ts";

/**
 * Prints the first-run setup code to this process's log — **the one place it appears**, and the
 * reason it proves anything: whoever can read the API's log can run commands on the server, which is
 * the authority promotion otherwise requires.
 *
 * This is the only file allowed to log the code; `lib/no-secret-logging.test.ts` scans the rest of
 * the setup path and leaves this one out, the same exception the dev mail transport has for its
 * links.
 *
 * A failure does not stop boot: the product works without setup, and the operator still has the
 * seed script. Setup stays closed until the next start, which the warning says.
 */
export async function announceDeploymentSetup(): Promise<void> {
	let state: Awaited<ReturnType<typeof prepareDeploymentSetup>>;
	try {
		state = await prepareDeploymentSetup();
	} catch (error) {
		console.warn(
			`[setup] couldn't read the first-run setup state; it stays closed until the next start (${
				error instanceof Error ? error.message : String(error)
			})`,
		);
		return;
	}
	if (!state.open) return;

	console.log("[setup] this deployment has no administrator yet");
	console.log(
		`[setup] open /setup in the operations console, sign in, and enter: ${formatSetupCode(state.code)}`,
	);
}
