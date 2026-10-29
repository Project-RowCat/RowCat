import { createFileRoute, redirect } from "@tanstack/react-router";
import { RuntimeVmLabPage } from "#/features/runtime-vm-lab/runtime-vm-lab-page.tsx";

/**
 * Runtime VM PoC lab, for development builds only. Same arrangement as /visual-lab: outside the
 * `(app)` group, no shell, no viewer query, and a redirect in production. This is the Phase 3
 * harness, and no product UI links to it.
 */
export const Route = createFileRoute("/runtime-vm-lab")({
	beforeLoad: () => {
		if (!import.meta.env.DEV) throw redirect({ to: "/" });
	},
	component: RuntimeVmLabPage,
});
