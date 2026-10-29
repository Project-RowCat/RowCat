import type { ThemeCustomizationStateDto } from "@rowcat/contracts";
import {
	ThemeCustomizationUpdateRequest,
	ThemePresetUpdateRequest,
} from "@rowcat/contracts";
import { Hono } from "hono";
import type { AppEnv } from "../../app.ts";
import { invalidInput } from "../../lib/errors.ts";
import { requireViewer } from "../../lib/gates.ts";
import { getViewer } from "../../middleware/viewer.ts";
import {
	clearThemeCustomColors,
	readThemeCustomizationState,
	replaceThemeCustomColors,
	replaceThemePreset,
	resetThemeState,
} from "../../services/theme-customization.ts";

/**
 * Account theme routes (`/v2/me/theme-customization`). Writes are split by axis so that one write
 * has no slot to touch the other:
 *
 * - `PUT /preset`: choose a preset, leaves the color cells alone.
 * - `PUT /colors`: save custom colors, leaves the preset alone, replaces the whole document.
 * - `DELETE /colors`: clear custom colors, keeps the preset.
 * - `DELETE /`: reset everything.
 *
 * A single `PUT /` taking both would look shorter, but a request that only changes the preset would
 * erase saved colors by omitting them under replacement semantics. Splitting was first justified by
 * authorization. Billing is gone (`docs/oss/PLAN.md`, stage 3), but the replacement reason remains.
 *
 * The owner comes only from the session. A request carrying `memberId`, a color cell on `PUT
 * /preset`, or `preset` on `PUT /colors` fails the `.strict()` contract with 400 rather than being
 * ignored.
 *
 * All gates are `requireViewer`. The value changes only the person's own screen, so a sanctioned
 * account is not blocked. Every response is `no-store`, so a back-navigation after an account
 * switch cannot show the previous person's theme.
 */
export const meTheme = new Hono<AppEnv>()
	.get("/", async (c) => {
		const viewer = requireViewer(await getViewer(c));
		const body: ThemeCustomizationStateDto = await readThemeCustomizationState(
			viewer.id,
		);
		c.header("Cache-Control", "no-store");
		return c.json(body);
	})

	/** Choosing a preset leaves saved custom colors alone; the service's `set` clause holds that promise. */
	.put("/preset", async (c) => {
		const viewer = requireViewer(await getViewer(c));
		const parsed = ThemePresetUpdateRequest.safeParse(
			await c.req.json().catch(() => null),
		);
		if (!parsed.success) throw invalidInput(parsed.error);

		const body: ThemeCustomizationStateDto = await replaceThemePreset(
			viewer.id,
			parsed.data.preset,
		);
		c.header("Cache-Control", "no-store");
		return c.json(body);
	})

	/**
	 * Replaces the whole custom-color document. Not a `PATCH`: merging would force clients to
	 * distinguish `null` from omission to clear one cell, and clients implement that differently. The
	 * response is the server-normalized state so clients do not cache what they sent (uppercase colors
	 * are stored lowercase).
	 */
	.put("/colors", async (c) => {
		const viewer = requireViewer(await getViewer(c));
		const parsed = ThemeCustomizationUpdateRequest.safeParse(
			await c.req.json().catch(() => null),
		);
		if (!parsed.success) throw invalidInput(parsed.error);

		const body: ThemeCustomizationStateDto = await replaceThemeCustomColors(
			viewer.id,
			parsed.data,
		);
		c.header("Cache-Control", "no-store");
		return c.json(body);
	})

	/**
	 * Clears custom colors only; the preset stays. Idempotent. Kept apart from `DELETE /` because
	 * losing the chosen preset would be a second change nobody asked for.
	 */
	.delete("/colors", async (c) => {
		const viewer = requireViewer(await getViewer(c));
		const body: ThemeCustomizationStateDto = await clearThemeCustomColors(
			viewer.id,
		);
		c.header("Cache-Control", "no-store");
		return c.json(body);
	})

	/**
	 * Full reset. Returns the normalized state instead of 204 so the screen does not invent the empty
	 * state. It is one operation because a client chaining preset-reset and color-clear could fail
	 * between them and leave a half-reset state.
	 */
	.delete("/", async (c) => {
		const viewer = requireViewer(await getViewer(c));
		const body: ThemeCustomizationStateDto = await resetThemeState(viewer.id);
		c.header("Cache-Control", "no-store");
		return c.json(body);
	});
