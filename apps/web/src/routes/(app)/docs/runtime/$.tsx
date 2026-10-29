import { APP_NAME } from "@rowcat/domain";
import { createFileRoute, notFound } from "@tanstack/react-router";
import {
	runtimeDocDocumentTitle,
	runtimeDocSlugFromSplat,
} from "#/features/docs/runtime-docs-nav.ts";
import { RuntimeDocPage } from "#/features/docs/runtime-docs-page.tsx";
import { findRuntimeDocEntry } from "#/generated/runtime-docs.ts";

/**
 * /docs/runtime/$: one document page. The slug can be nested (concepts/state), hence the splat.
 *
 * Unknown slugs are real 404s. The route neither redirects nor draws an empty shell. The check lives in beforeLoad because it is about existence, not
 * authorization. Throwing there means the title of a missing document never draws, even for a
 * frame.
 *
 * A trailing slash is the same document (runtimeDocSlugFromSplat). If two addresses gave different
 * answers, a link saved somewhere would break.
 */
export const Route = createFileRoute("/(app)/docs/runtime/$")({
	beforeLoad: ({ params }) => {
		const slug = runtimeDocSlugFromSplat(params._splat);
		if (slug.length === 0 || !findRuntimeDocEntry(slug)) throw notFound();
	},
	head: ({ params }) => {
		const entry = findRuntimeDocEntry(runtimeDocSlugFromSplat(params._splat));
		return {
			meta: [
				{ title: entry ? runtimeDocDocumentTitle(entry) : APP_NAME },
				...(entry ? [{ name: "description", content: entry.description }] : []),
			],
		};
	},
	component: RuntimeDocRoute,
});

function RuntimeDocRoute() {
	const { _splat } = Route.useParams();
	const entry = findRuntimeDocEntry(runtimeDocSlugFromSplat(_splat));
	if (!entry) throw notFound();
	return <RuntimeDocPage entry={entry} />;
}
