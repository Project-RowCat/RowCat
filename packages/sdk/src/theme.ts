import type {
	ThemeCustomizationUpdateRequest,
	ThemePreset,
} from "@rowcat/contracts";
import {
	ThemeCustomizationStateDto,
	ThemeCustomizationUpdateRequest as ThemeCustomizationUpdateSchema,
	ThemePresetUpdateRequest,
} from "@rowcat/contracts";
import type { RequestOptions, RowCatTransport } from "./client.ts";
import { invalidRequest, invalidResponse } from "./errors.ts";

/**
 * Account theme API at `/v2/me/theme-customization`. Kept separate from `me` even though it sits
 * under `/me`, because the lifetimes differ. The app reads `me` on nearly every render, while this
 * state is read only by the settings screen and the runtime theme layer. Merging them would make
 * the hottest read carry theme state.
 *
 * Functions are split by axis:
 * - savePreset: sets the preset name only; stored custom colors are untouched.
 * - saveColors: replaces the custom-color document; the preset is untouched.
 * - clearColors: removes custom colors only; the preset remains.
 * - reset: returns to no preset and no colors.
 *
 * They are not merged into one save(state). A call that changes only the preset would erase stored
 * colors whenever the color field was omitted, because save has replace semantics.
 *
 * No function takes a memberId. The target is always the requesting user, identified by the cookie.
 * The missing parameter is how that rule is expressed.
 */
export interface ThemeApi {
	/** Returns the preset and saved colors. Guests get a 401. */
	get(options?: RequestOptions): Promise<ThemeCustomizationStateDto>;
	/**
	 * Selects a preset. Saved custom colors are kept; the server does not touch that field.
	 */
	savePreset(
		preset: ThemePreset,
		options?: RequestOptions,
	): Promise<ThemeCustomizationStateDto>;
	/**
	 * Saves custom colors by replacing the whole document, not a partial update. What is sent becomes
	 * everything stored, so an empty document means the same as clearing the colors. The selected
	 * preset is kept.
	 */
	saveColors(
		customization: ThemeCustomizationUpdateRequest,
		options?: RequestOptions,
	): Promise<ThemeCustomizationStateDto>;
	/**
	 * Clears only the custom colors and keeps the preset. Succeeds even when none are stored
	 * (idempotent).
	 */
	clearColors(options?: RequestOptions): Promise<ThemeCustomizationStateDto>;
	/**
	 * Resets both the preset and the colors. Kept separate from clearColors(): someone who only wanted
	 * to clear colors would otherwise lose their chosen preset, a second change they never requested.
	 */
	reset(options?: RequestOptions): Promise<ThemeCustomizationStateDto>;
}

const PATH = "/me/theme-customization";
const PRESET_PATH = `${PATH}/preset`;
const COLORS_PATH = `${PATH}/colors`;

export function createThemeApi({ requestJson }: RowCatTransport): ThemeApi {
	const parse = (json: unknown, path: string): ThemeCustomizationStateDto => {
		/**
		 * Validation matters most here. Values in this response go straight into CSS custom properties
		 * and the native color parser, so an off-contract string from a server bug would become a style.
		 * The schema drops such values; skipping it would let unvalidated colors reach the screen.
		 * Presets pass the same gate. An unknown preset name cannot produce a color by itself, but if it
		 * were cached, the UI would draw a chip it cannot select.
		 */
		const parsed = ThemeCustomizationStateDto.safeParse(json);
		if (!parsed.success) throw invalidResponse(path);
		return parsed.data;
	};

	return {
		async get(options) {
			return parse(
				await requestJson({
					method: "GET",
					path: PATH,
					signal: options?.signal,
				}),
				PATH,
			);
		},

		async savePreset(preset, options) {
			/**
			 * Checks the preset against the vocabulary before sending, so an unknown preset does not make a
			 * round trip that returns 400. The error message does not include the input, the same rule as
			 * for colors.
			 */
			const request = ThemePresetUpdateRequest.safeParse({ preset });
			if (!request.success)
				throw invalidRequest(PRESET_PATH, "Unknown theme preset.");

			return parse(
				await requestJson({
					method: "PUT",
					path: PRESET_PATH,
					body: request.data,
					signal: options?.signal,
				}),
				PRESET_PATH,
			);
		},

		async saveColors(customization, options) {
			/**
			 * Checks the request against the contract before sending, so a non-grammatical color does not
			 * make a round trip that returns 400. The parsed result is sent, not the raw input. The schema
			 * normalizes to lowercase, so sending the raw input would let the same color travel as two
			 * different strings. The error message does not include the input. It is a color the user picked
			 * and has no reason to reach the error reporter.
			 */
			const request = ThemeCustomizationUpdateSchema.safeParse(customization);
			if (!request.success)
				throw invalidRequest(COLORS_PATH, "Only #rrggbb colors can be used.");

			return parse(
				await requestJson({
					method: "PUT",
					path: COLORS_PATH,
					body: request.data,
					signal: options?.signal,
				}),
				COLORS_PATH,
			);
		},

		async clearColors(options) {
			return parse(
				await requestJson({
					method: "DELETE",
					path: COLORS_PATH,
					signal: options?.signal,
				}),
				COLORS_PATH,
			);
		},

		async reset(options) {
			return parse(
				await requestJson({
					method: "DELETE",
					path: PATH,
					signal: options?.signal,
				}),
				PATH,
			);
		},
	};
}
