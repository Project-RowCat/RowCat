import type {
	ThemeCustomizationStateDto,
	ThemePreset,
} from "@rowcat/contracts";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { closeDb, db } from "../../db/client.ts";
import { member_theme_customization } from "../../db/schema.ts";
import { deleteAccountForUser } from "../../services/account/deletion.ts";
import { createTestMember } from "../../test/auth.ts";
import { connectTestDatabase, deleteTestUsers } from "../../test/database.ts";
import { api, apiGet, jsonOf } from "../../test/http.ts";

/**
 * Account theme checks:
 * - The preset and custom-color axes never erase each other, in either direction.
 * - Non-grammar values and unknown keys are rejected with 400 and never stored. This includes the
 *   old nested `light`/`dark` form, and a preset request carrying colors.
 * - Writes replace rather than merge.
 * - No row is the normal state: empty settings delete the row, and deletes are idempotent.
 *
 * Runs against real Postgres and the real Hono app, because the promise lives in the shape of the
 * service's `set` clause, and a mock would leave that outside the test. The subscriber-only tests
 * left with the entitlement gate (`docs/oss/PLAN.md`, stage 3).
 */

const EMAIL_PREFIX = "me-theme-test-";
const PATH = "/me/theme-customization";

let ready = false;

beforeAll(async () => {
	ready = await connectTestDatabase();
});

afterAll(async () => {
	if (ready) await deleteTestUsers(EMAIL_PREFIX);
	await closeDb();
});

const signUp = (name = "Theme test") =>
	createTestMember(EMAIL_PREFIX, { name });

const readRow = (memberId: string) =>
	db
		.select()
		.from(member_theme_customization)
		.where(eq(member_theme_customization.member_id, memberId))
		.limit(1)
		.then((rows) => rows[0]);

const get = (cookie: string) => apiGet(PATH, cookie);
const putPreset = (cookie: string, body: unknown) =>
	api(`${PATH}/preset`, { method: "PUT", body, cookie });
const putColors = (cookie: string, body: unknown) =>
	api(`${PATH}/colors`, { method: "PUT", body, cookie });
const delColors = (cookie: string) =>
	api(`${PATH}/colors`, { method: "DELETE", cookie });
const del = (cookie: string) => api(PATH, { method: "DELETE", cookie });

const SAMPLE = {
	background: "#10131a",
	surface: "#181c26",
	primary: "#9a83ff",
};

describe.skipIf(!process.env.DATABASE_URL)("account theme colors", () => {
	test("a guest can do none of the operations", async () => {
		if (!ready) return;
		for (const response of await Promise.all([
			get(""),
			putPreset("", { preset: "black" }),
			putColors("", SAMPLE),
			delColors(""),
			del(""),
		]))
			expect(response.status).toBe(401);
	});

	test("an account with no row is a normal response too — an empty palette", async () => {
		if (!ready) return;
		const member = await signUp();

		const body = await jsonOf<ThemeCustomizationStateDto>(
			await get(member.cookie),
		);
		expect(body).toEqual({
			preset: "default",
			customization: {},
		});
	});

	test("all four presets can be chosen", async () => {
		if (!ready) return;
		const member = await signUp();

		for (const preset of [
			"white",
			"gray",
			"black",
			"default",
		] as ThemePreset[]) {
			const response = await putPreset(member.cookie, { preset });
			expect(response.status, preset).toBe(200);

			const body = await jsonOf<ThemeCustomizationStateDto>(response);
			expect(body.preset, preset).toBe(preset);
		}
	});

	test("the preset is stored and read back", async () => {
		if (!ready) return;
		const member = await signUp();

		await putPreset(member.cookie, { preset: "gray" });
		expect((await readRow(member.memberId))?.preset).toBe("gray");
		expect(
			(await jsonOf<ThemeCustomizationStateDto>(await get(member.cookie)))
				.preset,
		).toBe("gray");
	});

	/** `default` means no account override, so with no colors there is nothing to keep and the row goes. */
	test("reverting to default removes the row when there are no colors", async () => {
		if (!ready) return;
		const member = await signUp();

		await putPreset(member.cookie, { preset: "black" });
		expect(await readRow(member.memberId)).toBeTruthy();

		const body = await jsonOf<ThemeCustomizationStateDto>(
			await putPreset(member.cookie, { preset: "default" }),
		);
		expect(body.preset).toBe("default");
		expect(await readRow(member.memberId)).toBeUndefined();
	});

	test("an unknown preset is a 400 and nothing is written", async () => {
		if (!ready) return;
		const member = await signUp();

		for (const body of [
			{ preset: "dark" },
			{ preset: "light" },
			{ preset: "custom" },
			{ preset: "WHITE" },
			{ preset: "Black" },
			{ preset: "" },
			{ preset: null },
			{ preset: 1 },
			{},
			/** A color value sent as a preset would make the preset a second custom-color surface. */
			{ preset: { background: "#ffffff" } },
			/** A preset request carrying a color cell is the same 400. */
			{ preset: "black", background: "#ffffff" },
			{ preset: "black", memberId: "someone-else" },
		])
			expect(
				(await putPreset(member.cookie, body)).status,
				JSON.stringify(body),
			).toBe(400);

		expect(await readRow(member.memberId)).toBeUndefined();
	});

	/**
	 * Checked in both directions. Listing every column in the service's `set` clause looks shorter,
	 * but then one of these two tests breaks, and users only see "why did my setting vanish".
	 */
	test("**changing the preset keeps the saved colors**", async () => {
		if (!ready) return;
		const member = await signUp();

		await putPreset(member.cookie, { preset: "white" });
		await putColors(member.cookie, { primary: "#ff4f9a" });

		const body = await jsonOf<ThemeCustomizationStateDto>(
			await putPreset(member.cookie, { preset: "black" }),
		);
		expect(body.preset).toBe("black");
		expect(body.customization).toEqual({ primary: "#ff4f9a" });
		expect(await readRow(member.memberId)).toMatchObject({
			preset: "black",
			primary: "#ff4f9a",
		});
	});

	test("**saving colors keeps the preset**", async () => {
		if (!ready) return;
		const member = await signUp();

		await putPreset(member.cookie, { preset: "gray" });

		const body = await jsonOf<ThemeCustomizationStateDto>(
			await putColors(member.cookie, { primary: "#55ccff" }),
		);
		expect(body.preset).toBe("gray");
		expect(body.customization).toEqual({ primary: "#55ccff" });
		expect(await readRow(member.memberId)).toMatchObject({
			preset: "gray",
			primary: "#55ccff",
		});
	});

	test("clearing only the colors keeps the preset", async () => {
		if (!ready) return;
		const member = await signUp();
		await putPreset(member.cookie, { preset: "black" });
		await putColors(member.cookie, SAMPLE);

		const body = await jsonOf<ThemeCustomizationStateDto>(
			await delColors(member.cookie),
		);
		expect(body.preset).toBe("black");
		expect(body.customization).toEqual({});
		expect(await readRow(member.memberId)).toMatchObject({
			preset: "black",
			background: null,
			surface: null,
			primary: null,
		});
	});

	/** The deletion condition is a conjunction over all four, so a preset alone keeps the row. */
	test("while a preset remains, clearing colors doesn't delete the row", async () => {
		if (!ready) return;
		const member = await signUp();
		await putPreset(member.cookie, { preset: "gray" });

		await delColors(member.cookie);
		expect((await readRow(member.memberId))?.preset).toBe("gray");
	});

	test("when the preset is default, clearing colors deletes the row", async () => {
		if (!ready) return;
		const member = await signUp();
		await putColors(member.cookie, SAMPLE);

		await delColors(member.cookie);
		expect(await readRow(member.memberId)).toBeUndefined();
	});

	test("stored and normalized to lowercase", async () => {
		if (!ready) return;
		const member = await signUp();

		const response = await putColors(member.cookie, {
			background: "#10131A",
			primary: "#9A83FF",
		});
		expect(response.status).toBe(200);

		const body = await jsonOf<ThemeCustomizationStateDto>(response);
		expect(body).toEqual({
			preset: "default",
			customization: { background: "#10131a", primary: "#9a83ff" },
		});

		const row = await readRow(member.memberId);
		expect(row?.background).toBe("#10131a");
		expect(row?.primary).toBe("#9a83ff");
		/** A cell not sent is not stored; `null` means use the default. */
		expect(row?.surface).toBeNull();
	});

	test("**it is a replacement** — cells missing from the resent document disappear", async () => {
		if (!ready) return;
		const member = await signUp();

		await putColors(member.cookie, {
			background: "#111111",
			primary: "#7755ff",
		});
		const body = await jsonOf<ThemeCustomizationStateDto>(
			await putColors(member.cookie, { background: "#222222" }),
		);

		expect(body.customization).toEqual({ background: "#222222" });
		expect(await readRow(member.memberId)).toMatchObject({
			background: "#222222",
			surface: null,
			primary: null,
		});
	});

	test("sending an empty document removes the row — when the preset is default too", async () => {
		if (!ready) return;
		const member = await signUp();

		await putColors(member.cookie, SAMPLE);
		expect(await readRow(member.memberId)).toBeTruthy();

		const body = await jsonOf<ThemeCustomizationStateDto>(
			await putColors(member.cookie, {}),
		);
		expect(body.customization).toEqual({});
		expect(await readRow(member.memberId)).toBeUndefined();
	});

	test("a color that isn't valid syntax isn't stored — there is no path for arbitrary CSS", async () => {
		if (!ready) return;
		const member = await signUp();

		for (const bad of [
			"red",
			"#fff",
			"#12345678",
			"rgb(1,2,3)",
			"hsl(0 0% 0%)",
			"oklch(0.5 0 0)",
			"var(--background)",
			"url(https://example.test/x.png)",
			"linear-gradient(#fff,#000)",
			'"; color:red',
			"#ffffff; background-image:url(x)",
			"",
		]) {
			const response = await putColors(member.cookie, { background: bad });
			expect(response.status, bad).toBe(400);
		}
		expect(await readRow(member.memberId)).toBeUndefined();
	});

	test("unknown keys are refused rather than dropped quietly — including the old nested format", async () => {
		if (!ready) return;
		const member = await signUp();

		for (const body of [
			{ foreground: "#ffffff" },
			{ "sidebar-ring": "#ffffff" },
			{ destructive: "#ffffff" },
			/**
			 * A color request cannot carry a preset: accepting it would let a color write touch the preset
			 * axis, making "saved colors, preset changed" representable.
			 */
			{ background: "#101010", preset: "black" },
			{ preset: "black" },
			/**
			 * The old nested form must not pass: without `.strict()` it folds into an empty document and
			 * erases saved colors while the sender believes theirs were saved.
			 */
			{ light: { background: "#ffffff" } },
			{ dark: { background: "#000000" } },
			{ light: {}, dark: {} },
			{ background: "#101010", memberId: "someone-else" },
			/** The removed entitlement cell is an unknown key too; old clients sending it get nothing stored. */
			{ background: "#101010", customColorsActive: true },
			{ background: "#101010", scheme: "dark" },
		])
			expect(
				(await putColors(member.cookie, body)).status,
				JSON.stringify(body),
			).toBe(400);

		expect(await readRow(member.memberId)).toBeUndefined();
	});

	test("**clearing colors is idempotent — the preset stays**", async () => {
		if (!ready) return;
		const member = await signUp();
		await putPreset(member.cookie, { preset: "black" });
		await putColors(member.cookie, SAMPLE);

		const first = await delColors(member.cookie);
		expect(first.status).toBe(200);
		expect(await jsonOf<ThemeCustomizationStateDto>(first)).toEqual({
			preset: "black",
			customization: {},
		});
		expect((await readRow(member.memberId))?.preset).toBe("black");

		/** Clearing again succeeds. */
		expect((await delColors(member.cookie)).status).toBe(200);
	});

	test("**a full reset reverts the preset too — and is idempotent**", async () => {
		if (!ready) return;
		const member = await signUp();
		await putPreset(member.cookie, { preset: "gray" });
		await putColors(member.cookie, SAMPLE);

		const response = await del(member.cookie);
		expect(response.status).toBe(200);
		expect(await jsonOf<ThemeCustomizationStateDto>(response)).toEqual({
			preset: "default",
			customization: {},
		});
		expect(await readRow(member.memberId)).toBeUndefined();

		expect((await del(member.cookie)).status).toBe(200);
	});

	test("someone else's colors are neither visible nor changeable", async () => {
		if (!ready) return;
		const [alice, bob] = await Promise.all([signUp("Alice"), signUp("Bob")]);
		await putPreset(alice.cookie, { preset: "black" });
		await putColors(alice.cookie, SAMPLE);

		const bobState = await jsonOf<ThemeCustomizationStateDto>(
			await get(bob.cookie),
		);
		expect(bobState.customization).toEqual({});
		/** The preset does not leak either. */
		expect(bobState.preset).toBe("default");

		/** Bob's deletes leave Alice's row alone; the target comes only from the session. */
		await del(bob.cookie);
		await delColors(bob.cookie);
		await putPreset(bob.cookie, { preset: "white" });
		expect(await readRow(alice.memberId)).toBeTruthy();
		expect((await readRow(alice.memberId))?.preset).toBe("black");
	});

	/**
	 * The gradient is part of custom colors, not a fourth axis; replacement and deletion paths are the
	 * same as above. What is new here:
	 *
	 * 1. A gradient without its first stop is not stored (it cannot be drawn).
	 * 2. No CSS string reaches the store; `to` is one `#rrggbb`.
	 * 3. Omitting the cell clears it (replacement semantics apply to the gradient too).
	 * 4. Preset writes leave it alone; it stays with the colors.
	 */

	const GRADIENT_SAMPLE = {
		...SAMPLE,
		gradient: { to: "#4a1f5e", angle: 135 },
	};

	test("stored and read back", async () => {
		if (!ready) return;
		const member = await signUp();

		const response = await putColors(member.cookie, GRADIENT_SAMPLE);
		expect(response.status).toBe(200);
		expect(
			(await jsonOf<ThemeCustomizationStateDto>(response)).customization
				.gradient,
		).toEqual({ to: "#4a1f5e", angle: 135 });

		/** Stored structurally: one color and one integer, not CSS. */
		const row = await readRow(member.memberId);
		expect(row?.gradient_to).toBe("#4a1f5e");
		expect(row?.gradient_angle).toBe(135);

		expect(
			(await jsonOf<ThemeCustomizationStateDto>(await get(member.cookie)))
				.customization.gradient,
		).toEqual({ to: "#4a1f5e", angle: 135 });
	});

	/** `0` and `359` are both valid directions. */
	test("angles 0 and 359 are stored", async () => {
		if (!ready) return;
		const member = await signUp();

		for (const angle of [0, 359]) {
			const response = await putColors(member.cookie, {
				...SAMPLE,
				gradient: { to: "#4a1f5e", angle },
			});
			expect(response.status, String(angle)).toBe(200);
			expect((await readRow(member.memberId))?.gradient_angle).toBe(angle);
		}
	});

	/**
	 * A gradient without its first stop is a 400, not silently folded: the sender would get a success
	 * and believe it was saved, and the next read would lack it.
	 */
	test("a gradient without a background is refused and nothing is written", async () => {
		if (!ready) return;
		const member = await signUp();

		const response = await putColors(member.cookie, {
			surface: SAMPLE.surface,
			gradient: { to: "#4a1f5e", angle: 135 },
		});
		expect(response.status).toBe(400);
		expect(await readRow(member.memberId)).toBeUndefined();
	});

	/** No path lets arbitrary CSS through the store: same grammar as the color cells, and the angle admits neither fractions nor out-of-range values. */
	test("a gradient that isn't valid syntax isn't stored", async () => {
		if (!ready) return;
		const member = await signUp();

		const bad: unknown[] = [
			{ to: "linear-gradient(135deg,#000,#fff)", angle: 135 },
			{ to: "#4a1f5eaa", angle: 135 },
			{ to: "red", angle: 135 },
			{ to: "#4a1f5e", angle: 360 },
			{ to: "#4a1f5e", angle: -1 },
			{ to: "#4a1f5e", angle: 45.5 },
			{ to: "#4a1f5e" },
			{ angle: 135 },
			/** Unknown keys are not silently dropped; there is no door for stops, radial or CSS. */
			{ to: "#4a1f5e", angle: 135, stops: ["#000", "#fff"] },
			{ to: "#4a1f5e", angle: 135, type: "radial" },
			{ to: "#4a1f5e", angle: 135, css: "linear-gradient(1deg,#000,#fff)" },
			"linear-gradient(135deg,#000,#fff)",
		];

		for (const gradient of bad) {
			const response = await putColors(member.cookie, { ...SAMPLE, gradient });
			expect(response.status, JSON.stringify(gradient)).toBe(400);
		}
		expect(await readRow(member.memberId)).toBeUndefined();
	});

	/** Replacement: resending without the cell clears the stored gradient. */
	test("omitting the cell clears the gradient", async () => {
		if (!ready) return;
		const member = await signUp();
		await putColors(member.cookie, GRADIENT_SAMPLE);

		const state = await jsonOf<ThemeCustomizationStateDto>(
			await putColors(member.cookie, SAMPLE),
		);
		expect(state.customization.gradient).toBeUndefined();
		expect(state.customization.background).toBe(SAMPLE.background);

		const row = await readRow(member.memberId);
		expect(row?.gradient_to).toBeNull();
		expect(row?.gradient_angle).toBeNull();
	});

	/** A resent gradient overwrites rather than merges. */
	test("a resent gradient overwrites the old value", async () => {
		if (!ready) return;
		const member = await signUp();
		await putColors(member.cookie, GRADIENT_SAMPLE);

		await putColors(member.cookie, {
			...SAMPLE,
			gradient: { to: "#1f5e4a", angle: 45 },
		});
		const row = await readRow(member.memberId);
		expect(row?.gradient_to).toBe("#1f5e4a");
		expect(row?.gradient_angle).toBe(45);
	});

	/** Clearing colors takes the gradient too; otherwise a value nobody can see would linger forever. */
	test("resetting custom settings clears the gradient too", async () => {
		if (!ready) return;
		const member = await signUp();
		await putPreset(member.cookie, { preset: "black" });
		await putColors(member.cookie, GRADIENT_SAMPLE);

		const state = await jsonOf<ThemeCustomizationStateDto>(
			await delColors(member.cookie),
		);
		expect(state.customization).toEqual({});
		/** The preset stays, so someone clearing only colors does not lose the chosen theme. */
		expect(state.preset).toBe("black");

		const row = await readRow(member.memberId);
		expect(row?.gradient_to).toBeNull();
		expect(row?.gradient_angle).toBeNull();
	});

	/** Preset writes leave the gradient alone; the `set` clause has no such cell. */
	test("changing the preset keeps the gradient", async () => {
		if (!ready) return;
		const member = await signUp();
		await putColors(member.cookie, GRADIENT_SAMPLE);

		const state = await jsonOf<ThemeCustomizationStateDto>(
			await putPreset(member.cookie, { preset: "gray" }),
		);
		expect(state.preset).toBe("gray");
		expect(state.customization.gradient).toEqual({ to: "#4a1f5e", angle: 135 });
	});

	/** A row that also held a gradient disappears on color reset when the preset is the default. */
	test("clearing colors doesn't leave a row with only a gradient", async () => {
		if (!ready) return;
		const member = await signUp();
		await putColors(member.cookie, GRADIENT_SAMPLE);

		expect(
			(await jsonOf<ThemeCustomizationStateDto>(await delColors(member.cookie)))
				.customization,
		).toEqual({});
		expect(await readRow(member.memberId)).toBeUndefined();
	});

	/**
	 * A mismatched row folds quietly. A gradient left without a background (old data, hand edits)
	 * would make the server break the contract invariant in its own response, the SDK's response
	 * validation would reject it, and the account would lose the whole settings screen.
	 */
	test("a stored row's gradient without a background is left out of the response", async () => {
		if (!ready) return;
		const member = await signUp();
		await putColors(member.cookie, GRADIENT_SAMPLE);

		/** Builds by hand a state the contract cannot produce, to test the read's leniency. */
		await db
			.update(member_theme_customization)
			.set({ background: null })
			.where(eq(member_theme_customization.member_id, member.memberId));

		const state = await jsonOf<ThemeCustomizationStateDto>(
			await get(member.cookie),
		);
		expect(state.customization.gradient).toBeUndefined();
		/** The remaining colors and preset stay usable; one bad value does not lose everything. */
		expect(state.customization.surface).toBe(SAMPLE.surface);
	});

	/** A row with only the angle out of range gets the same answer (the read re-checks integer and range). */
	test("a row with an out-of-range angle is left out of the response too", async () => {
		if (!ready) return;
		const member = await signUp();
		await putColors(member.cookie, GRADIENT_SAMPLE);

		await db
			.update(member_theme_customization)
			.set({ gradient_angle: 999 })
			.where(eq(member_theme_customization.member_id, member.memberId));

		expect(
			(await jsonOf<ThemeCustomizationStateDto>(await get(member.cookie)))
				.customization.gradient,
		).toBeUndefined();
	});

	test("account deletion takes the theme along — cascade does that", async () => {
		if (!ready) return;
		const member = await signUp();
		await putPreset(member.cookie, { preset: "black" });
		await putColors(member.cookie, SAMPLE);
		expect(await readRow(member.memberId)).toBeTruthy();

		await deleteAccountForUser(member.authUserId);
		expect(await readRow(member.memberId)).toBeUndefined();
	});
});
