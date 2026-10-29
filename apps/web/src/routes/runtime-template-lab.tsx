import { createFileRoute, redirect } from "@tanstack/react-router";
import { RuntimeTemplateLabPage } from "#/features/runtime-template-lab/template-lab-page.tsx";

/**
 * Start template lab, for development builds only. Like /visual-lab and /runtime-vm-lab, it sits
 * outside the `(app)` group, so it has no shell and no viewer query. In production the route is
 * only a redirect, and because import.meta.env.DEV folds at build time, the screen code behind that
 * branch is dropped too. No product UI links here.
 */
export const Route = createFileRoute("/runtime-template-lab")({
	beforeLoad: () => {
		if (!import.meta.env.DEV) throw redirect({ to: "/" });
	},
	component: RuntimeTemplateLabPage,
});
