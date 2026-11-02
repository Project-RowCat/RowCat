import { afterEach, describe, expect, test } from "vitest";
import { i18nFor } from "./i18n/instance.ts";
import {
	__resetMembershipAgesForTest,
	decodeMembershipAges,
	encodeMembershipAges,
	membershipAges,
	serverMembershipAgesStale,
	setServerMembershipAges,
} from "./membership-ages.ts";

/**
 * The ages copy prints. What is pinned: the defaults are what an older API runs; the meta round-trips
 * exactly what the server rendered; and every string that names an age prints the deployment's number
 * rather than a literal — checked by changing the number and reading the strings back.
 */
afterEach(() => __resetMembershipAgesForTest());

describe("membership ages for copy", () => {
	test("before any read, the Korean defaults", () => {
		expect(membershipAges()).toEqual({ guardianConsent: 14, adult: 19 });
	});

	test("the meta value round-trips, and a damaged one reads as nothing", () => {
		expect(
			decodeMembershipAges(
				encodeMembershipAges({ guardianConsent: 13, adult: 18 }),
			),
		).toEqual({ guardianConsent: 13, adult: 18 });
		for (const bad of [undefined, "", "13", "a,b", "0,18", "13.5,18"])
			expect(decodeMembershipAges(bad)).toBeNull();
	});

	test("the server re-reads at most once a minute", () => {
		setServerMembershipAges({ guardianConsent: 13, adult: 18 }, 1_000);
		expect(serverMembershipAgesStale(1_000 + 59_000)).toBe(false);
		expect(serverMembershipAgesStale(1_000 + 60_000)).toBe(true);
	});

	test("strings print the deployment's ages, read at translation time", () => {
		const en = i18nFor("en");
		const ko = i18nFor("ko");
		const under = () =>
			en.t("contentSection.thisAccountIsUnder14", { ns: "account" });
		expect(under()).toBe("This account is under 14.");
		expect(ko.t("contentSection.thisAccountIsUnder14", { ns: "account" })).toBe(
			"만 14세 미만 계정입니다.",
		);

		setServerMembershipAges({ guardianConsent: 13, adult: 18 });
		expect(under()).toBe("This account is under 13.");
		expect(en.t("contentSection.thisAccountIsUnder19", { ns: "account" })).toBe(
			"This account is under 18.",
		);
		expect(ko.t("contentSection.thisAccountIsUnder19", { ns: "account" })).toBe(
			"만 18세 미만 계정입니다.",
		);
	});
});
