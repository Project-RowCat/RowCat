import type { DraftRuntimeAssetKind } from "@rowcat/authoring";
import type * as monaco from "monaco-editor/editor/editor.api";
import { deferredTranslator } from "#/lib/i18n/current.ts";
import {
	type RuntimeAssetEditorCatalog,
	runtimeAssetCatalogFor,
	runtimeAssetDetail,
} from "./catalog.ts";
import { runtimeAssetConsumerAt, runtimeAssetLiteralAt } from "./source.ts";

const tr = deferredTranslator("runtimeStudio");

/**
 * Suggests this project's image and sound names inside `asset("`. The rule is a pure function; only
 * the wiring is Monaco-specific.
 * - Context (runtime-asset-source.ts) decides whether the cursor is inside the string and which
 *   range to replace. The catalog (runtime-asset-catalog.ts) decides which draft the model belongs
 *   to and that draft's names. This file joins the two into items.
 * - No network calls. Items come only from authoring records already on the device. Fetching
 *   images to show the list would turn one `asset("` into one request per project image.
 * - No remote addresses. Neither `artifact.remoteAssets` nor addresses scanned from source appear
 *   here; both differ in both models. Typing `asset("https://` correctly leaves nothing in the
 *   filter.
 * - No wrong-kind names. `<Image source={asset("` offers images only, and `<Audio
 *   source={asset("` offers sound only (`runtimeAssetConsumerAt`). A wrong-kind name is never drawn
 *   at that position, because the trusted host does not assemble addresses. Where the consumer is
 *   unknown, both kinds appear.
 * - Not a replacement for TypeScript completion. Outside this context the provider returns
 *   nothing, and Monaco keeps proposing symbols, imports, and props exactly as before.
 */

/**
 * One row of the list. It is our own value rather than Monaco's shape, so tests can check it
 * without an editor.
 */
export interface RuntimeAssetCompletionItem {
	/** The value inserted into the string on selection: the name only, nothing else. */
	path: string;
	/** Image or sound. Shown as a word beside the name in the list (`RUNTIME_ASSET_KIND_LABEL`). */
	kind: DraftRuntimeAssetKind;
	/** Secondary text such as `640 × 640 · WebP`. It sits beside the name and is not part of it. */
	detail: string;
	/** The key that keeps Monaco in our order. Name order is exactly the order of this value. */
	sortText: string;
}

export interface RuntimeAssetCompletionPlan {
	/** Range to replace: the inside of the quotes. Parentheses and quotes are left untouched. */
	start: number;
	end: number;
	/**
	 * The kind of primitive that accepts a name at this position. `null` when unknown, in which case
	 * both kinds appear. When known, only that kind appears.
	 */
	expected: DraftRuntimeAssetKind | null;
	items: readonly RuntimeAssetCompletionItem[];
}

/** The word shown beside a name in the list. It matches the name the asset panel uses. */
export const RUNTIME_ASSET_KIND_LABEL: Record<DraftRuntimeAssetKind, string> = {
	get image() {
		return tr("assetKind.image");
	},
	get audio() {
		return tr("assetKind.audio");
	},
};

/**
 * What to suggest at this position; `null` when the cursor is not in a suggestion context.
 *
 * Nothing is filtered here. Monaco filters by the text from the range start to the cursor (typing
 * `characters/` keeps only lines with that prefix). Filtering here too would create a second copy
 * of the rule, and the copy would diverge the day Monaco's filter changes.
 */
export function planRuntimeAssetCompletions(
	catalog: RuntimeAssetEditorCatalog,
	source: string,
	offset: number,
): RuntimeAssetCompletionPlan | null {
	const literal = runtimeAssetLiteralAt(source, offset);
	if (literal === null) return null;
	const expected = runtimeAssetConsumerAt(source, literal.start);
	const entries =
		expected === null
			? catalog.entries
			: catalog.entries.filter((entry) => entry.kind === expected);
	return {
		start: literal.start,
		end: literal.end,
		expected,
		items: entries.map((entry, index) => ({
			path: entry.path,
			kind: entry.kind,
			detail: runtimeAssetDetail(entry),
			/**
			 * Pads the index to four digits. Strings compare lexically, so this stops `10` from sorting
			 * before `2`, and it passes the list order (the sort result) to Monaco unchanged.
			 */
			sortText: index.toString().padStart(4, "0"),
		})),
	};
}

/**
 * Monaco provider. Registered once globally; the list is answered by the model.
 *
 * `monaco` is an argument on purpose: this folder takes Monaco as a value only in `monaco-setup.ts`
 * (the boundary check enforces it). That is half of the guarantee that workers, language, and
 * ambient types are set up exactly once.
 */
export function createRuntimeAssetCompletionProvider(
	api: typeof monaco,
): monaco.languages.CompletionItemProvider {
	return {
		/**
		 * Quote characters and `/`. The `/` is there because this name space looks like a path; someone
		 * who typed `characters/` wants to look inside.
		 *
		 * This list decides only where it opens automatically. Invoking completion with `Ctrl+Space`
		 * makes Monaco call this provider regardless of the trigger characters, so the list also opens
		 * after characters that are not triggers.
		 */
		triggerCharacters: ['"', "'", "`", "/"],

		provideCompletionItems(model, position) {
			const catalog = runtimeAssetCatalogFor(model);
			if (catalog === null || catalog.entries.length === 0) return null;

			const plan = planRuntimeAssetCompletions(
				catalog,
				model.getValue(),
				model.getOffsetAt(position),
			);
			/**
			 * This position accepts no names of the relevant kind. Shows nothing rather than an empty list.
			 */
			if (plan === null || plan.items.length === 0) return null;

			const from = model.getPositionAt(plan.start);
			const to = model.getPositionAt(plan.end);
			const range: monaco.IRange = {
				startLineNumber: from.lineNumber,
				startColumn: from.column,
				endLineNumber: to.lineNumber,
				endColumn: to.column,
			};

			return {
				suggestions: plan.items.map((item) => ({
					/**
					 * The kind is a word beside the name (`description`). Mixing it into the name would make the
					 * chosen value differ from the displayed one. An icon alone would hide the difference from
					 * people who cannot read color and shape.
					 */
					label: {
						label: item.path,
						description: RUNTIME_ASSET_KIND_LABEL[item.kind],
					},
					kind: api.languages.CompletionItemKind.File,
					insertText: item.path,
					/**
					 * The filter target is also the name. Including the detail (dimensions or format) here would
					 * make typing `640` suggest an image.
					 */
					filterText: item.path,
					sortText: item.sortText,
					detail: item.detail,
					range,
				})),
			};
		},
	};
}
