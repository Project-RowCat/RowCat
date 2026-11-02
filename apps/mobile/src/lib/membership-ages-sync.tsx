import { runtimeConfigQueryOptions } from "@rowcat/query";
import { useQuery } from "@tanstack/react-query";
import { getRowCatClient } from "./api.ts";
import { setMembershipAges } from "./membership-ages.ts";

/**
 * Root wiring: reads the runtime config and keeps `membershipAges()` on it. Written during render, so
 * the screens rendered below it in the same pass already read the deployment's numbers. Draws
 * nothing; a failed lookup leaves the defaults.
 */
export function MembershipAgesSync(): null {
	const config = useQuery(runtimeConfigQueryOptions(getRowCatClient()));
	const ages = config.data?.membershipAges;
	if (ages) setMembershipAges(ages);
	return null;
}
