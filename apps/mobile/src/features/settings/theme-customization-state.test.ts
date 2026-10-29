import type { ThemeCustomizationDto } from "@rowcat/contracts";
import { describe, expect, it } from "vitest";
import {
	EMPTY_THEME_DRAFT,
	isThemeDraftValueValid,
	normalizedThemeDraftValue,
	syncThemeDraftFromServer,
	type ThemeDraft,
	type ThemePreviewBaseColors,
	themeCustomizationView,
	themeDraftEquals,
	themeDraftFrom,
	themeDraftHasValue,
	themeDraftIsValid,
	themeDraftSyncKey,
	themeDraftValidation,
	themePresetSwatch,
	themePreviewColors,
	themeRequestFrom,
	themeSlotFallbackColors,
} from "./theme-customization-state.ts";

/**
 * Locks the meaning of the theme editor by value: compare results, not copy against the web.
 *
 * Getting this wrong loses something concrete: a typo clears a stored color, or a value edited on
 * another device overwrites this device's edit.
 */

/** Any distinct values will do, not a real palette: these functions do not create colors. */
const BASE: ThemePreviewBaseColors = {
	background: "#101010",
	foreground: "#f0f0f0",
	card: "#202020",
	"card-foreground": "#e0e0e0",
	primary: "#3030f0",
	"primary-foreground": "#ffffff",
};

const draft = (patch: Partial<ThemeDraft> = {}): ThemeDraft => ({
	...EMPTY_THEME_DRAFT,
	...patch,
});

describe("trimming hand input", () => {
	it("strips spaces and folds to lowercase", () => {
		expect(normalizedThemeDraftValue("  #AABBCC  ")).toBe("#aabbcc");
	});

	/** Six digits typed without `#` are accepted as a color. A common paste. */
	it("adds # to six digits without it", () => {
		expect(normalizedThemeDraftValue("aabbcc")).toBe("#aabbcc");
	});

	/**
	 * Does not fix anything beyond that. Truncating or resolving color names would make the typed
	 * value differ from the saved one, and the screen could no longer explain what was stored.
	 */
	it("leaves unknown values as is", () => {
		expect(normalizedThemeDraftValue("red")).toBe("red");
		expect(normalizedThemeDraftValue("#abc")).toBe("#abc");
	});
});

describe("validation", () => {
	/** An empty value is always valid: it means "use the preset color". */
	it("an empty value is valid", () => {
		expect(isThemeDraftValueValid("")).toBe(true);
		expect(isThemeDraftValueValid("   ")).toBe(true);
	});

	it("only six-digit hex is a color", () => {
		expect(isThemeDraftValueValid("#aabbcc")).toBe(true);
		expect(isThemeDraftValueValid("#AABBCC")).toBe(true);
		for (const invalid of ["#abc", "#aabbccdd", "rgb(0,0,0)", "red", "#zzzzzz"])
			expect(isThemeDraftValueValid(invalid), invalid).toBe(false);
	});

	/** One invalid slot makes the whole draft unsaveable. */
	it("one wrong cell locks the whole draft", () => {
		expect(themeDraftIsValid(draft({ primary: "#aabbcc" }))).toBe(true);
		expect(themeDraftIsValid(draft({ primary: "nope" }))).toBe(false);
	});

	it("says which cell is wrong", () => {
		expect(themeDraftValidation(draft({ surface: "nope" }))).toEqual({
			background: true,
			surface: false,
			primary: true,
		});
	});
});

describe("save request", () => {
	/**
	 * P0. A draft that is not valid produces no request. Sending it without that value under replace
	 * semantics makes the server carry it out faithfully, and a single typo clears the stored color.
	 */
	it("a draft that isn't valid syntax is null", () => {
		expect(themeRequestFrom(draft({ primary: "nope" }))).toBeNull();
	});

	/** Empty slots are not sent: their meaning is "use the preset color". */
	it("doesn't carry empty cells", () => {
		expect(themeRequestFrom(draft({ background: "#aabbcc" }))).toEqual({
			background: "#aabbcc",
		});
	});

	it("carries the normalized value", () => {
		expect(themeRequestFrom(draft({ primary: "AABBCC" }))).toEqual({
			primary: "#aabbcc",
		});
	});

	/**
	 * Must hold: the web-made gradient is not erased.
	 *
	 * This app has no code that draws or edits it, but color writes replace the whole set, so a
	 * request that omits the slot erases the value. That loss leaves no trace here (nothing is drawn);
	 * the user learns about it the next time they open the web app.
	 */
	it("sends the saved gradient back as is", () => {
		const gradient = { to: "#4a1f5e", angle: 135 } as const;
		const saved = themeDraftFrom({ background: "#10131a", gradient });

		expect(saved.gradient).toEqual(gradient);
		expect(themeRequestFrom(saved)).toEqual({
			background: "#10131a",
			gradient,
		});

		/** Still carried when another slot changes: saving one color does not erase the gradient. */
		expect(themeRequestFrom({ ...saved, primary: "#aabbcc" })).toEqual({
			background: "#10131a",
			primary: "#aabbcc",
			gradient,
		});
	});

	/**
	 * Saving with the background cleared drops the gradient too. The first stop is the background, so
	 * sending a gradient with an empty background is rejected by the contract (400). The only loss is
	 * the gradient, and that is the consequence of clearing the background.
	 */
	it("clearing the background drops the gradient too", () => {
		const saved = themeDraftFrom({
			background: "#10131a",
			primary: "#aabbcc",
			gradient: { to: "#4a1f5e", angle: 135 },
		});

		expect(themeRequestFrom({ ...saved, background: "" })).toEqual({
			primary: "#aabbcc",
		});
	});

	/** A fully cleared draft is an empty document; under replace semantics that means "no colors". */
	it("clearing everything gives an empty document", () => {
		expect(themeRequestFrom(EMPTY_THEME_DRAFT)).toEqual({});
	});
});

describe("did it change", () => {
	/** The same color retyped in uppercase is not a change: save must not enable. */
	it("the same color in a different notation is the same", () => {
		expect(
			themeDraftEquals(
				draft({ primary: "#AABBCC" }),
				draft({ primary: "aabbcc" }),
			),
		).toBe(true);
	});

	it("builds a draft from the server value", () => {
		expect(themeDraftFrom({ background: "#101010" })).toEqual(
			draft({ background: "#101010" }),
		);
	});

	it("true if any cell was chosen", () => {
		expect(themeDraftHasValue(EMPTY_THEME_DRAFT)).toBe(false);
		expect(themeDraftHasValue(draft({ surface: "#101010" }))).toBe(true);
	});
});

describe("did the server snapshot change — looks at the carried values too", () => {
	const G1 = { to: "#4a1f5e", angle: 135 } as const;
	const G2 = { to: "#1f5e4a", angle: 20 } as const;

	/**
	 * P1. Even when the visible slots are identical, a change to the server gradient must realign the
	 * draft.
	 *
	 * Otherwise: change only the gradient from G1 to G2 on the web, then edit a color here and save.
	 * Replace semantics ship the stale G1 the draft still holds, and revert the web's G2. An undo the
	 * user never asked for, with no trace on this screen (the gradient is not drawn here).
	 */
	it("the key differs even when only the gradient changes", () => {
		const colors = { background: "#10131a", primary: "#9a83ff" } as const;
		const before = themeDraftSyncKey(
			themeDraftFrom({ ...colors, gradient: G1 }),
		);
		const after = themeDraftSyncKey(
			themeDraftFrom({ ...colors, gradient: G2 }),
		);
		expect(after).not.toBe(before);
	});

	/** A change of angle alone is a different snapshot. Comparing only colors would drop angle changes entirely. */
	it("the key differs even when only the angle changes", () => {
		const colors = { background: "#10131a" } as const;
		expect(
			themeDraftSyncKey(themeDraftFrom({ ...colors, gradient: G1 })),
		).not.toBe(
			themeDraftSyncKey(
				themeDraftFrom({ ...colors, gradient: { ...G1, angle: 200 } }),
			),
		);
	});

	/** A removal is a change too. If absence is not observed, a deleted value comes back. */
	it("the key differs even when the gradient disappears", () => {
		const colors = { background: "#10131a" } as const;
		expect(
			themeDraftSyncKey(themeDraftFrom({ ...colors, gradient: G1 })),
		).not.toBe(themeDraftSyncKey(themeDraftFrom(colors)));
	});

	/** The same snapshot yields the same key. Overwriting the draft every render would keep reverting values being edited. */
	it("two drafts built from the same value have the same key", () => {
		const state = { background: "#10131a", primary: "#9a83ff", gradient: G1 };
		expect(themeDraftSyncKey(themeDraftFrom(state))).toBe(
			themeDraftSyncKey(themeDraftFrom({ ...state, gradient: { ...G1 } })),
		);
	});

	/** Visible slots are still compared. Adding the gradient axis must not lose them. */
	it("the key differs when a visible cell changes", () => {
		for (const patch of [
			{ background: "#000000" },
			{ surface: "#111111" },
			{ primary: "#222222" },
		]) {
			const before = themeDraftSyncKey(EMPTY_THEME_DRAFT);
			expect(themeDraftSyncKey(draft(patch)), JSON.stringify(patch)).not.toBe(
				before,
			);
		}
	});

	/**
	 * Syncing and `dirty` are different questions. The gradient cannot be edited here, so if a
	 * snapshot that changed only the gradient turned on `Save colors`, the user would see an edit they never
	 * made.
	 */
	it("a change in the gradient alone isn't an edit", () => {
		const colors = { background: "#10131a", primary: "#9a83ff" } as const;
		const before = themeDraftFrom({ ...colors, gradient: G1 });
		const after = themeDraftFrom({ ...colors, gradient: G2 });
		expect(themeDraftEquals(before, after)).toBe(true);
	});

	/**
	 * The regression test for this slice. Chains the two checks above and runs the real loss path by
	 * value: when the snapshot changes to G2, the draft must take it, and the next color save must
	 * carry G2.
	 */
	it("a save after receiving a new snapshot carries the latest gradient", () => {
		const colors = { background: "#10131a", primary: "#9a83ff" } as const;

		/** 1. Screen opens; the draft carries G1. */
		let synced = themeDraftFrom({ ...colors, gradient: G1 });
		expect(themeRequestFrom(synced)).toEqual({ ...colors, gradient: G1 });

		/** 2. The web changes only the gradient. 3. The key differs, so the effect runs. */
		const next = themeDraftFrom({ ...colors, gradient: G2 });
		if (themeDraftSyncKey(next) !== themeDraftSyncKey(synced)) synced = next;

		/** 4. Edit the primary color here and save; G2 is what goes out. */
		expect(themeRequestFrom({ ...synced, primary: "#ff0000" })).toEqual({
			background: "#10131a",
			primary: "#ff0000",
			gradient: G2,
		});
	});

	/** A removed gradient does not come back. This holds only because absence is observed. */
	it("doesn't revive a cleared gradient", () => {
		const colors = { background: "#10131a", primary: "#9a83ff" } as const;

		let synced = themeDraftFrom({ ...colors, gradient: G1 });
		const next = themeDraftFrom(colors);
		if (themeDraftSyncKey(next) !== themeDraftSyncKey(synced)) synced = next;

		expect(synced.gradient).toBeUndefined();
		expect(themeRequestFrom({ ...synced, primary: "#ff0000" })).toEqual({
			background: "#10131a",
			primary: "#ff0000",
		});
	});
});

describe("reflects a new snapshot into the draft — visible and hidden cells split", () => {
	const G1 = { to: "#4a1f5e", angle: 135 } as const;
	const G2 = { to: "#1f5e4a", angle: 20 } as const;

	const colors = {
		background: "#10131a",
		surface: "#181c26",
		primary: "#9a83ff",
	} as const;

	/** One server snapshot; every argument in this group comes from here. */
	const server = (patch: ThemeCustomizationDto = {}): ThemeDraft =>
		themeDraftFrom({ ...colors, ...patch });

	/** Snapshot unchanged: do nothing, so an in-progress draft is not overwritten each render. */
	it("returns the current draft as is when the server snapshot is unchanged", () => {
		const saved = server({ gradient: G1 });
		const current = { ...saved, primary: "#ff0000" };
		expect(syncThemeDraftFromServer(current, saved, saved)).toBe(current);
	});

	/**
	 * This is where this slice changed behavior. If a remote change that only changed the gradient
	 * erased unsaved color edits, the user sees an undo they never made, and nothing on screen
	 * explains it (this app does not draw the gradient).
	 */
	it("keeps unsaved color edits when only the gradient changes", () => {
		const previous = server({ gradient: G1 });
		const current = { ...previous, primary: "#ff0000" };
		const next = server({ gradient: G2 });

		expect(syncThemeDraftFromServer(current, previous, next)).toEqual({
			...colors,
			primary: "#ff0000",
			gradient: G2,
		});
	});

	/** A removed gradient is also a gradient-only change: the color edit stays and only the hidden slot goes. */
	it("keeps color edits even when the gradient disappears", () => {
		const previous = server({ gradient: G1 });
		const current = { ...previous, surface: "#010203" };
		const next = server();

		const merged = syncThemeDraftFromServer(current, previous, next);
		expect(merged.surface).toBe("#010203");
		expect(merged.gradient).toBeUndefined();
		/** It must be absent, not present-but-undefined: a key left in place would be restored by the next save. */
		expect("gradient" in merged).toBe(false);
	});

	/** A gradient that appears is handled the same way: if it is not taken in, the next save erases the web's new value. */
	it("keeps color edits even when a gradient appears", () => {
		const previous = server();
		const current = { ...previous, primary: "#ff0000" };
		const next = server({ gradient: G2 });

		expect(syncThemeDraftFromServer(current, previous, next)).toEqual({
			...colors,
			primary: "#ff0000",
			gradient: G2,
		});
	});

	/**
	 * Visible slots are server-authoritative. This app can edit them, so if another device changed
	 * them, that value wins. There is no merge UI and no per-field indication.
	 */
	it("a changed visible cell resets the whole draft", () => {
		const previous = server({ gradient: G1 });
		const current = { ...previous, primary: "#ff0000" };
		const next = server({ primary: "#00ff00", gradient: G2 });

		expect(syncThemeDraftFromServer(current, previous, next)).toEqual(next);
	});

	/**
	 * After a save finishes, the draft is normalized to the server's form: uppercase or unprefixed
	 * values typed by hand become the canonical shape the server returns.
	 */
	it("a successful save aligns the draft with the server's representation", () => {
		const previous = server({ gradient: G1 });
		const current = { ...previous, primary: "FF0000" };
		const next = server({ primary: "#ff0000", gradient: G1 });

		expect(syncThemeDraftFromServer(current, previous, next)).toEqual(next);
	});

	/** A reset also changes visible slots: no old draft remains after clearing. */
	it("reset aligns with the emptied snapshot", () => {
		const previous = server({ gradient: G1 });
		const current = { ...previous, primary: "#ff0000" };
		const next = themeDraftFrom({});

		expect(syncThemeDraftFromServer(current, previous, next)).toEqual(
			EMPTY_THEME_DRAFT,
		);
	});

	/**
	 * The classification uses the two server snapshots, not the current draft. Comparing `current`
	 * with `nextSaved` would read the user's unsaved edit as a server change, and then a gradient-only
	 * change would always fall into the wholesale realign branch (the very loss this slice fixed).
	 */
	it("compares two server snapshots, not the current draft", () => {
		const previous = server({ gradient: G1 });
		/** The draft differs from the server here, yet the server changed only the gradient. */
		const current = { ...previous, background: "#123456" };
		const next = server({ gradient: G2 });

		const merged = syncThemeDraftFromServer(current, previous, next);
		expect(merged.background).toBe("#123456");
		expect(merged.gradient).toEqual(G2);
	});

	/**
	 * A gradient-only change does not turn on `Save colors`. An untouched draft must equal the server even
	 * after the merge; if save turned on, the user would see an edit they never made.
	 */
	it("a reflection where only the gradient changed doesn't enable the save button", () => {
		const previous = server({ gradient: G1 });
		const next = server({ gradient: G2 });

		const merged = syncThemeDraftFromServer(previous, previous, next);
		expect(themeDraftEquals(merged, next)).toBe(true);
	});

	/**
	 * End-to-end regression test: checks both requirements together by value. Local edits are not
	 * lost, and a stale gradient is not sent.
	 */
	it("a save after reflection carries local edits and the latest gradient together", () => {
		/** 1. Screen opens. */
		const previous = server({ gradient: G1 });

		/** 2. Edit the primary color here, not yet saved. */
		const edited = { ...previous, primary: "#ff0000" };

		/** 3. The web changes only the gradient. 4. The new snapshot arrives and is applied. */
		const next = server({ gradient: G2 });
		const synced = syncThemeDraftFromServer(edited, previous, next);

		/** 5. Save; the local edit plus G2 goes out. */
		expect(themeRequestFrom(synced)).toEqual({
			...colors,
			primary: "#ff0000",
			gradient: G2,
		});
	});
});

describe("empty cells fall back to the chosen preset", () => {
	/**
	 * This rule is the basis of the word `Use preset color`. That it is not `Use default` must hold by value too:
	 * clearing a slot under the black preset returns the black preset's color, not the RowCat default
	 * purple.
	 */
	it("cells the preset covers use the preset color", () => {
		const black = themeSlotFallbackColors("black", BASE);
		const fallbackDefault = themeSlotFallbackColors("default", BASE);
		expect(black.background).not.toBe(fallbackDefault.background);
		/** `default` covers no slot, so it is the current appearance's default as-is. */
		expect(fallbackDefault.background).toBe(BASE.background);
		expect(fallbackDefault.primary).toBe(BASE.primary);
	});

	/** Card swatches go through the same resolver: the color advertised matches the color applied. */
	it("the swatch draws the same value as the fallback", () => {
		for (const preset of ["default", "white", "gray", "black"] as const) {
			const swatch = themePresetSwatch(preset, BASE);
			const fallback = themeSlotFallbackColors(preset, BASE);
			expect(swatch.background, preset).toBe(fallback.background);
			expect(swatch.surface, preset).toBe(fallback.surface);
			expect(swatch.primary, preset).toBe(fallback.primary);
		}
	});
});

describe("Preview", () => {
	it("an empty draft draws the chosen preset as is", () => {
		const preview = themePreviewColors("black", EMPTY_THEME_DRAFT, BASE);
		const fallback = themeSlotFallbackColors("black", BASE);
		expect(preview.background).toBe(fallback.background);
		expect(preview.surface).toBe(fallback.surface);
		expect(preview.primary).toBe(fallback.primary);
	});

	it("chosen colors layer over the preset", () => {
		const preview = themePreviewColors(
			"black",
			draft({ primary: "#ff0000" }),
			BASE,
		);
		expect(preview.primary).toBe("#ff0000");
	});

	/** Colors that cannot be drawn fall back to the preset color; the validation table states the hint. */
	it("invalid values draw with the preset color", () => {
		const preview = themePreviewColors(
			"black",
			draft({ background: "nope" }),
			BASE,
		);
		expect(preview.background).toBe(
			themeSlotFallbackColors("black", BASE).background,
		);
	});

	/**
	 * The foreground is derived: a readable color is taken on the chosen surface. Different answers on
	 * dark and light backgrounds are the minimal evidence of that fact.
	 */
	it("the foreground splits by surface", () => {
		const dark = themePreviewColors(
			"default",
			draft({ background: "#000000" }),
			BASE,
		);
		const light = themePreviewColors(
			"default",
			draft({ background: "#ffffff" }),
			BASE,
		);
		expect(dark.foreground).not.toBe(light.foreground);
	});
});

describe("screen state", () => {
	const state = {
		preset: "black" as const,
		customization: { primary: "#ff0000" },
	};

	/**
	 * Order is the whole function: held value → paused → failed → loading. A value already held stays
	 * true even when a background refresh fails; clearing it would make the user read their setting as
	 * gone.
	 */
	it("a held value comes before failure", () => {
		expect(
			themeCustomizationView({ state, isError: true, isPaused: true }),
		).toMatchObject({ kind: "ready" });
	});

	/** Paused comes before failed: a paused query is still `pending`, so it would otherwise become an endless loading state. */
	it("without a value: paused → failure → loading", () => {
		expect(
			themeCustomizationView({
				state: undefined,
				isError: true,
				isPaused: true,
			}).kind,
		).toBe("offline");
		expect(
			themeCustomizationView({
				state: undefined,
				isError: true,
				isPaused: false,
			}).kind,
		).toBe("error");
		expect(
			themeCustomizationView({
				state: undefined,
				isError: false,
				isPaused: false,
			}).kind,
		).toBe("loading");
	});

	it("the preset and saved colors arrive together", () => {
		const view = themeCustomizationView({
			state,
			isError: false,
			isPaused: false,
		});
		expect(view).toEqual({
			kind: "ready",
			preset: "black",
			customization: { primary: "#ff0000" },
		});
	});
});
