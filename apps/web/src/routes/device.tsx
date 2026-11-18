import { DEVICE_USER_CODE_PARAM, deviceUserCodeFrom } from "@rowcat/contracts";
import { APP_NAME } from "@rowcat/domain";
import { viewerQueryOptions } from "@rowcat/query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { DeviceApprovalPage } from "#/features/device-approval/device-approval-page.tsx";
import { getRowCatClient } from "#/lib/api.ts";
import { translator } from "#/lib/i18n/current.ts";

/**
 * Where a person approves `rowcat-mcp` signing in to their account. The tool prints this address —
 * the server builds it from its own web origin (`apps/api/src/auth/device-authorization.ts`), so the
 * path is the contract's `DEVICE_APPROVAL_PAGE_PATH` and `device-approval.test.ts` holds the two
 * together — with the code the person compares in `user_code`.
 *
 * Outside the `(app)` group for the reason sign-in is: one centred face, no header.
 */

export interface DeviceApprovalSearch {
	/** The code from the address, folded to the issued form; anything else is dropped, not shown. */
	user_code?: string;
}

/**
 * The code is not a secret on its own (the terminal shows it, and only the account that opened the
 * request can answer it), so it stays in the address: signing in again comes back to the same code.
 */
function validateDeviceSearch(
	search: Record<string, unknown>,
): DeviceApprovalSearch {
	const code = deviceUserCodeFrom(search[DEVICE_USER_CODE_PARAM]);
	return code ? { user_code: code } : {};
}

export const Route = createFileRoute("/device")({
	validateSearch: validateDeviceSearch,
	/**
	 * Only a signed-in person can approve, and signing in first keeps the code: the return address is
	 * this one, validated again by the login route. Decided in `beforeLoad`, not the component, for the
	 * reason the account route gives — no flash of a face that is about to leave.
	 */
	beforeLoad: async ({ context, location }) => {
		const viewer = await context.queryClient.ensureQueryData(
			viewerQueryOptions(getRowCatClient()),
		);
		if (!viewer)
			throw redirect({ to: "/login", search: { redirect: location.href } });
	},
	head: () => ({
		meta: [
			{
				title: translator("shell")("titles.deviceApproval", { app: APP_NAME }),
			},
			{ name: "robots", content: "noindex, nofollow" },
			/**
			 * The address carries the code. Outside sites get the origin only, never the path or query —
			 * the same line the password-reset page states for its token.
			 */
			{ name: "referrer", content: "strict-origin-when-cross-origin" },
		],
	}),
	component: DeviceApprovalPage,
});
