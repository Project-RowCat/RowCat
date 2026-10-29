import type {
	ThemeCustomizationDto,
	ThemeCustomizationStateDto,
	ThemePreset,
} from "@rowcat/contracts";
import { DEFAULT_THEME_PRESET } from "@rowcat/contracts";
import { eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { member_theme_customization } from "../db/schema.ts";

/**
 * Account theme: preset and custom colors share one row but are written separately.
 *
 * - The preset stores a name (`default | white | gray | black`). Custom colors store values
 *   (background, surface, accent, and a background gradient) layered over the preset.
 * - Both are open to every member. The former subscriber gate left with billing
 *   (`docs/oss/PLAN.md`, stage 3).
 * - The two axes never erase each other. The preset write's `set` lists no color cells, and the
 *   color write's `set` has no `preset`. A `set` listing every column would reset the preset when
 *   saving colors, and erase colors when changing the preset. `routes/me/theme.test.ts` guards this
 *   in both directions.
 * - No row is the normal state. With preset `default` and no colors, the row is deleted.
 *   `shouldPersist` is deliberately a disjunction: checking the preset alone would lose saved
 *   colors as soon as someone reverts to `Default`.
 */

/** Everything a stored row carries; reads and writes share this shape. */
interface ThemeRow {
	preset: string;
	background: string | null;
	surface: string | null;
	primary: string | null;
	gradient_to: string | null;
	gradient_angle: number | null;
}

const COLUMNS = {
	preset: member_theme_customization.preset,
	background: member_theme_customization.background,
	surface: member_theme_customization.surface,
	primary: member_theme_customization.primary,
	gradient_to: member_theme_customization.gradient_to,
	gradient_angle: member_theme_customization.gradient_angle,
} as const;

/**
 * The read side re-checks the contract's color grammar. `@rowcat/design` is not imported because of
 * dependency direction (this app does not know it). The copy can drift, but safely: narrower here
 * means a gradient is not drawn, wider is re-filtered by the layer that draws the value.
 */
const HEX = /^#[0-9a-f]{6}$/;

/** Same predicate as the contract's `ThemeGradientDto`. */
const isAngle = (value: number | null): value is number =>
	value !== null && Number.isInteger(value) && value >= 0 && value <= 359;

/**
 * Row gradient to contract cell; if any of the three parts is off it folds to absent. The first
 * stop (`background`) is checked too: without it there is nothing drawable, and emitting such a
 * document would make the server break the contract's invariant (`.refine`), the SDK's response
 * validation would reject it, and one corrupt row would turn the whole settings screen into an
 * error. It does not throw for the same reason: losing the other colors and the preset over one bad
 * value would also take away the account's way to fix it.
 */
function gradientOf(
	row: ThemeRow | undefined,
): ThemeCustomizationDto["gradient"] {
	const from = row?.background;
	const to = row?.gradient_to;
	const angle = row?.gradient_angle ?? null;

	if (!from || !HEX.test(from)) return undefined;
	if (!to || !HEX.test(to)) return undefined;
	if (!isAngle(angle)) return undefined;

	return { to, angle };
}

/**
 * Folds `null` cells into key absence: "this cell is default" must have one representation, or a
 * reader would eventually handle only one of omission and `null`.
 */
const customizationOf = (row: ThemeRow | undefined): ThemeCustomizationDto => {
	const gradient = gradientOf(row);
	return {
		...(row?.background ? { background: row.background } : {}),
		...(row?.surface ? { surface: row.surface } : {}),
		...(row?.primary ? { primary: row.primary } : {}),
		...(gradient ? { gradient } : {}),
	};
};

/**
 * Unknown strings fold to `default`. The column is `text`, so out-of-vocabulary values are possible
 * (hand edits, old data); throwing would cost the account the whole settings screen, and this runs
 * just before the app's first render, where the worst outcome should be "shows the default theme".
 * The vocabulary's authority is the contract and is not repeated here.
 */
const presetOf = (row: ThemeRow | undefined): ThemePreset => {
	const value = row?.preset;
	return value === "white" || value === "gray" || value === "black"
		? value
		: DEFAULT_THEME_PRESET;
};

/**
 * Whether anything is left to store; if not, the row is deleted (see header). A disjunction on
 * purpose: preset alone loses saved colors on reverting to `Default`, colors alone fails to save a
 * member who picked only `Black`.
 */
const shouldPersist = (
	preset: ThemePreset,
	customization: ThemeCustomizationDto,
): boolean =>
	preset !== DEFAULT_THEME_PRESET ||
	Boolean(customization.background) ||
	Boolean(customization.surface) ||
	Boolean(customization.primary) ||
	// The gradient is never stored without a background (contract invariant), so this is already
	// covered above; it stays because this function is a list of disjuncts, and a new cell missing a
	// line here would be the one cell that never persists.
	Boolean(customization.gradient);

const stateOf = (row: ThemeRow | undefined): ThemeCustomizationStateDto => ({
	preset: presetOf(row),
	customization: customizationOf(row),
});

const readRow = (
	tx: Pick<typeof db, "select">,
	memberId: string,
): Promise<ThemeRow | undefined> =>
	tx
		.select(COLUMNS)
		.from(member_theme_customization)
		.where(eq(member_theme_customization.member_id, memberId))
		.limit(1)
		.then((rows) => rows[0]);

/** An account with no row is a normal response (`default` + empty palette); a 404 would leave the screen unable to tell "not chosen yet" from "lookup failed". */
export async function readThemeCustomizationState(
	memberId: string,
): Promise<ThemeCustomizationStateDto> {
	return stateOf(await readRow(db, memberId));
}

/**
 * Never touches color cells: `set` holds only `preset` and `updated_at`, and `insert` omits the
 * color cells for the same reason. Reverting to `default` also goes through here; with no colors
 * left the row disappears.
 */
export async function replaceThemePreset(
	memberId: string,
	preset: ThemePreset,
): Promise<ThemeCustomizationStateDto> {
	return db.transaction(async (tx) => {
		const customization = customizationOf(await readRow(tx, memberId));

		if (!shouldPersist(preset, customization)) {
			await tx
				.delete(member_theme_customization)
				.where(eq(member_theme_customization.member_id, memberId));
			return stateOf(undefined);
		}

		const [saved] = await tx
			.insert(member_theme_customization)
			.values({ member_id: memberId, preset })
			.onConflictDoUpdate({
				target: member_theme_customization.member_id,
				// No color cells here: that is all of "the preset does not erase colors".
				set: { preset, updated_at: new Date() },
			})
			.returning(COLUMNS);

		return stateOf(saved);
	});
}

/**
 * Keeps the preset: clearing colors that also reset the theme would be an unrequested second change
 * (full reset is its own operation). Idempotent; with no row or no colors it succeeds, since a 404
 * would make a retry that only lost its response look failed.
 */
export async function clearThemeCustomColors(
	memberId: string,
): Promise<ThemeCustomizationStateDto> {
	return db.transaction(async (tx) => {
		const preset = presetOf(await readRow(tx, memberId));

		if (!shouldPersist(preset, {})) {
			await tx
				.delete(member_theme_customization)
				.where(eq(member_theme_customization.member_id, memberId));
			return stateOf(undefined);
		}

		const [saved] = await tx
			.update(member_theme_customization)
			.set({
				background: null,
				surface: null,
				primary: null,
				// The gradient goes too (`Reset custom colors` leaves only the preset). Without these two lines a
				// gradient survives without a background, reads fold it away, and an unseeable value stays
				// forever.
				gradient_to: null,
				gradient_angle: null,
				updated_at: new Date(),
			})
			.where(eq(member_theme_customization.member_id, memberId))
			.returning(COLUMNS);

		return stateOf(saved);
	});
}

/**
 * Full reset as a single operation: if the screen chained "preset to default" and "clear colors", a
 * browser failing between them would be left half reset.
 */
export async function resetThemeState(
	memberId: string,
): Promise<ThemeCustomizationStateDto> {
	await db
		.delete(member_theme_customization)
		.where(eq(member_theme_customization.member_id, memberId));

	return stateOf(undefined);
}

/**
 * A replacement: what was sent is all that is stored. A merge would force a request reverting one
 * cell to distinguish `null` from omission, which every client implements differently; an empty
 * document means the same as clearing custom colors.
 *
 * Does not touch the preset: `set` has no `preset` and `insert` omits it (a new row takes the
 * column default `default`). Otherwise someone building `Gray + blue accent` would get the default theme
 * with only the blue accent.
 */
export async function replaceThemeCustomColors(
	memberId: string,
	customization: ThemeCustomizationDto,
): Promise<ThemeCustomizationStateDto> {
	return db.transaction(async (tx) => {
		const preset = presetOf(await readRow(tx, memberId));

		if (!shouldPersist(preset, customization)) {
			await tx
				.delete(member_theme_customization)
				.where(eq(member_theme_customization.member_id, memberId));
			return stateOf(undefined);
		}

		const values = {
			background: customization.background ?? null,
			surface: customization.surface ?? null,
			primary: customization.primary ?? null,
			/**
			 * The gradient is replaced too: if the request lacks it the stored value is erased, which is all
			 * the editor's `Turn off gradient` does. That is why it has no endpoint of its own (one save becoming two
			 * round trips makes a half-succeeded state representable) and why only cells with values are not
			 * updated.
			 */
			gradient_to: customization.gradient?.to ?? null,
			gradient_angle: customization.gradient?.angle ?? null,
		};

		const [row] = await tx
			.insert(member_theme_customization)
			.values({ member_id: memberId, ...values })
			// All three color cells and both gradient cells are rewritten; updating only cells with values
			// would turn this into a merge and a reverted cell would keep its old value. `preset` is
			// deliberately not in this list (see header).
			.onConflictDoUpdate({
				target: member_theme_customization.member_id,
				set: { ...values, updated_at: new Date() },
			})
			.returning(COLUMNS);

		return stateOf(row);
	});
}
