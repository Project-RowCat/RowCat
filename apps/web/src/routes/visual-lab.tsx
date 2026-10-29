import { createFileRoute, redirect } from "@tanstack/react-router";
import { VisualLabPage } from "#/features/visual-lab/visual-lab-page.tsx";

/**
 * Visual QA lab, for development builds only.
 *
 * It sits outside the `(app)` group on purpose. Inside it, the sidebar, header and the root viewer
 * query would tie a primitive-comparison screen to the API and session, which have nothing to do
 * with the comparison.
 *
 * import.meta.env.DEV folds to a constant at build time, so production always redirects and the lab
 * code behind that branch is dropped. The mobile /visual-lab does the same with __DEV__.
 */
export const Route = createFileRoute("/visual-lab")({
	beforeLoad: () => {
		if (!import.meta.env.DEV) throw redirect({ to: "/" });
	},
	component: VisualLabPage,
});
