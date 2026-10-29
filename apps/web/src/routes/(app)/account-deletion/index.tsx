import { APP_NAME } from "@rowcat/domain";
import { createFileRoute } from "@tanstack/react-router";
import { AccountDeletionGuide } from "#/features/account/account-deletion-guide.tsx";
import { translator } from "#/lib/i18n/current.ts";

/**
 * /account-deletion is a public information page. What matters is what it does not have: no
 * beforeLoad guard, no loader, and no viewer lookup. App store reviewers and users who cannot log
 * in must be able to read it. Depending on a session would make the page unavailable to exactly
 * those people.
 *
 * It sits inside the (app) group for the header. Someone who has read the instructions should be
 * able to log in and delete the account right away, and that path is already in the header. Outside
 * the group, as the login screen is, the browser's back button would be the only way out.
 *
 * The address does not change. The store listing and review responses cite this path, and one dead
 * link means a rejected review. So the file is not moved, because that would change the path.
 */
export const Route = createFileRoute("/(app)/account-deletion/")({
	head: () => ({
		meta: [
			{
				title: translator("shell")("titles.accountDeletion", { app: APP_NAME }),
			},
			/**
			 * Unlike the account screens, this page should be indexed. It is a public document with no
			 * private values. If search cannot find it, the people who need it most, those who cannot log
			 * in, will not reach it. That is why noindex is not added out of habit.
			 */
			{
				name: "description",
				content: translator("shell")("titles.accountDeletionDescription", {
					app: APP_NAME,
				}),
			},
		],
	}),
	component: AccountDeletionGuide,
});
