import type { AdultVisibilityState } from "@rowcat/domain";
import { describe, expect, it } from "vitest";
import {
	type AdultContentPlatform,
	adultContentControl,
} from "./adult-content-policy.ts";

/**
 * Platform boundary of adult content display, locked by value. It guards one hard-to-undo mistake:
 * a path that turns adult UGC display on inside the app on iOS. That line looks ordinary in a diff
 * (one switch becomes two-way) but crosses the App Store UGC policy. Distinct from identity
 * verification, which is the same on both platforms; only what the entitlement may show differs.
 */

const eligible = (showAdult: boolean): AdultVisibilityState => ({
	kind: "eligible",
	showAdult,
	recheckRequired: false,
});

const PLATFORMS: AdultContentPlatform[] = [
	"ios",
	"android",
	"web",
	"windows",
	"macos",
];

describe("iOS can't turn it on in the app", () => {
	it("when off, the only way to turn it on is the web", () => {
		expect(adultContentControl("ios", eligible(false))).toEqual({
			kind: "off",
			enable: "web-only",
		});
	});

	/**
	 * Turning off stays open: friction on the safe direction would stop someone who already turned it
	 * on from turning it off, the worst cell in the table.
	 */
	it("when on, it can be turned off natively", () => {
		expect(adultContentControl("ios", eligible(true))).toEqual({ kind: "on" });
	});

	/**
	 * No path to turn it back on after turning off. This checks that round trip by value; the "can
	 * turn off so can turn on" symmetry does not hold here.
	 */
	it("once off, the app can't turn it back on", () => {
		const off = adultContentControl("ios", eligible(false));
		expect(off.kind === "off" && off.enable).toBe("web-only");
	});
});

describe("Android turns it on through a confirmation", () => {
	it("when off, it is a native confirmation", () => {
		expect(adultContentControl("android", eligible(false))).toEqual({
			kind: "off",
			enable: "native-confirm",
		});
	});

	it("when on, it turns off right away", () => {
		expect(adultContentControl("android", eligible(true))).toEqual({
			kind: "on",
		});
	});
});

describe("no eligibility means no operation", () => {
	/**
	 * Child / unverified / minor is already decided by `@rowcat/domain`; re-assembling it here would
	 * diverge from web.
	 */
	it("the three reasons pass through as is", () => {
		for (const platform of PLATFORMS)
			for (const kind of ["child", "unverified", "minor"] as const)
				expect(adultContentControl(platform, { kind })).toEqual({
					kind: "ineligible",
					reason: kind,
				});
	});
});

describe("the ways to turn it on are a closed vocabulary", () => {
	/**
	 * The way to enable stays two values however many platforms exist; a third needs the vocabulary to
	 * grow and shows in review, whereas a boolean (`canEnable`) would let "how" vary per screen.
	 */
	it("on every platform there are only native-confirm and web-only", () => {
		const methods = new Set(
			PLATFORMS.map((platform) => {
				const control = adultContentControl(platform, eligible(false));
				return control.kind === "off" ? control.enable : "other";
			}),
		);
		expect([...methods].sort()).toEqual(["native-confirm", "web-only"]);
	});

	/** Everything except iOS is native confirmation; Android is what actually ships now. */
	it("web-only is iOS alone", () => {
		const webOnly = PLATFORMS.filter((platform) => {
			const control = adultContentControl(platform, eligible(false));
			return control.kind === "off" && control.enable === "web-only";
		});
		expect(webOnly).toEqual(["ios"]);
	});
});
