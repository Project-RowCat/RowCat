import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { member } from "./member.ts";

/**
 * The account's saved theme: one row per member holding a preset, three color cells and one
 * background gradient. Every axis is free to every member.
 *
 * The two axes share a row but are independent, because their writes are split
 * (`services/theme-customization.ts`): the preset statement never touches the color cells and the
 * color statement never touches the preset. That independence lives in the shape of the UPDATE
 * statements, not in columns, and is the easiest thing to break in that file.
 *
 * ```text
 * preset                      default | white | gray | black
 * background·surface·primary  all optional
 * gradient_to·gradient_angle  one expression of the background; the first end is `background`
 * ```
 *
 * One palette, not light/dark pairs: the account picks one color set and the device appearance only
 * decides the tokens it did not pick. Two palettes would make users decide twice and double
 * storage, forms and checks; legibility is derived from the chosen colors (`@rowcat/design`) and
 * holds under either appearance.
 *
 * Not columns on `member`: that is the hot row of the auth path (every request's viewer resolution
 * reads it and root SSR embeds the result), and rarely-read optional columns there would slow every
 * request and turn it into a dump for account-attached choices.
 *
 * No row is the normal state. Nobody who chose nothing gets a row, and a row whose preset is
 * `default` with every color cell empty is deleted, so a later change of defaults can still tell
 * who explicitly reverted. The delete condition is a disjunction: deleting on the preset alone
 * would erase saved colors when someone reverts to `default`, and deleting on colors alone would
 * drop a chosen `black` preset.
 *
 * Deliberately absent:
 *
 * ```text
 * appearance (system|light|dark)   a device value; lifting it to the account would strip guests of a dark screen
 * actual preset color values       owned by `@rowcat/design`; stored here, refining the palette would leave
 *                                  members who already chose stuck on old colors (the NAME is stored)
 * per-appearance palettes          see above
 * foreground color                 derived (contrast); storing it makes white-on-white savable
 * gradient_from                    `background` is that value; two cells would hold one color and drift
 * CSS gradient string              built by the web from structure; storing it would carry arbitrary style
 * token-name → color map (JSONB)   same: the store would carry arbitrary style
 * ```
 *
 * Colors are `text` because Postgres has no `#rrggbb` type; the grammar is guarded by the contract
 * (`ThemeColorHex`) and the service. No `CHECK`, since that would be a second rule that must move
 * with the contract or reject valid values. Reads are lenient: unknown shapes fold to defaults in
 * the resolver (`@rowcat/design`).
 */
export const member_theme_customization = pgTable(
	"member_theme_customization",
	{
		/**
		 * One per member; the primary key is the unique constraint. `cascade` is the whole of this
		 * slice's account-deletion cleanup, so no separate line in the deletion service exists to be
		 * forgotten.
		 */
		member_id: text("member_id")
			.primaryKey()
			.references(() => member.id, { onDelete: "cascade" }),

		/**
		 * The chosen preset, NOT NULL because "not chosen" already has a name (`default`); allowing null
		 * would let two rows (`null` and `'default'`) mean the same fact. Plain `text` rather than a
		 * Postgres enum so adding a preset is not a schema migration; the contract (`ThemePreset`) is the
		 * grammar's authority and unknown values fold to `default` on read.
		 */
		preset: text("preset").notNull().default("default"),

		/** The page floor. `null` means use the RowCat default. */
		background: text("background"),
		/** The main surface carrying text (cards, popovers, sidebar). */
		surface: text("surface"),
		/** Emphasis controls and focus indication. */
		primary: text("primary"),

		/**
		 * The second end and the direction of the background gradient; both `null` means a solid
		 * background.
		 *
		 * There is no `gradient_from` column on purpose: the first end is `background`, whose value also
		 * derives the foreground and, on mobile (no gradient layer), is the background itself. Two cells
		 * would store one color twice and eventually diverge. The invariant is that `gradient_to` implies
		 * `background`: the contract rejects violating requests (`ThemeCustomizationDto`'s `.refine`),
		 * and a stray row that violates it is folded by the read into an absent key.
		 *
		 * No CSS string is stored (the web builds it, so a stored value never becomes style directly).
		 * The angle is an integer in `[0, 359]`: a float would make "did it change" depend on
		 * floating-point error and allowing `360` would give one direction two values. No range `CHECK`,
		 * for the same reason as the color columns.
		 */
		gradient_to: text("gradient_to"),
		gradient_angle: integer("gradient_angle"),

		/** Last change time, for operations and support; not in responses (a visible time invites a history screen). */
		updated_at: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	/**
	 * No indexes: the primary key is the only access path. The one query is `member_id = :member the
	 * session resolved`, and code scanning this table by another axis would be asking "who uses what
	 * color".
	 */
	() => [],
);
