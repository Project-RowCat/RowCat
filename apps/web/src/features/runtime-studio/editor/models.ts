import type { DraftRuntimeFile } from "@rowcat/authoring";
import { RUNTIME_VIRTUAL_ROOT } from "@rowcat/runtime-compiler";
import {
	type EditedValue,
	reconcileEditedValue,
} from "#/features/create/editor/edited-value.ts";
import {
	bindRuntimeAssetCatalog,
	type RuntimeAssetCatalogHandle,
	unbindRuntimeAssetCatalog,
} from "../assets/catalog.ts";

/**
 * Owns the Monaco models of one editor instance. Ownership is the whole job of this file.
 * - Monaco's model registry is global. While model URIs were built from the project path alone,
 *   two studios alive together could share one model object, so one editor's image bindings,
 *   setValue calls, and disposal could affect the other. A WeakMap keyed by model cannot prevent
 *   this, because the key is shared.
 * - The scope identifies an editor instance, not a draft id. A draft mounted twice (double mount,
 *   StrictMode, future split views) still gets distinct addresses. The scope is opaque and never
 *   contains author-chosen text.
 * - Models live one level below the project root (__studio__/<scope>/...). Parent-directory
 *   lookup still reaches <root>/node_modules, so runtime declarations keep a single source, and
 *   relative imports resolve within the scope.
 * - Authors never see the address. Diagnostics, tabs, and publishing read the record path, and
 *   this layer keeps both values together.
 * - Not here: Monaco itself (it is imported as a value only in monaco-setup.ts), view state and
 *   diagnostics (owned by the editor), and saving (onChange is called; autosave decides when to
 *   write).
 */

declare const RUNTIME_STUDIO_SCOPE: unique symbol;

/**
 * The type is branded so a plain string cannot be passed to address creation. This blocks
 * reintroducing scope-less addresses such as modelUri(path) at compile time. That regression raises
 * no runtime error (two editors silently share one model), so the type checker has to catch it, not
 * review.
 */
export type RuntimeStudioScope = string & {
	readonly [RUNTIME_STUDIO_SCOPE]: true;
};

/**
 * Folder under the virtual root that holds studio models. Scope folders sit beneath it, so author
 * paths cannot occupy the scope slot.
 */
export const RUNTIME_STUDIO_MODEL_ROOT = "__studio__";

let sequence = 0;

/**
 * Creates a new scope, once per mount.
 *
 * The random part is for HMR, not convenience. When a module is re-evaluated, the counter restarts
 * at 1. If the old mount's models are still in the registry, the new editor would receive the same
 * address, the very state this file exists to prevent. The counter is for people reading the value;
 * uniqueness comes from the random part. The suffix parameter exists so tests can check the rule
 * with fixed values. Product code never needs to supply one.
 */
export function createRuntimeStudioScope(
	suffix: string = crypto.randomUUID().replaceAll("-", "").slice(0, 12),
): RuntimeStudioScope {
	sequence += 1;
	return `s${sequence}-${suffix}` as RuntimeStudioScope;
}

/**
 * The address of one file in this editor. The root must match the compiler's: the runtime package
 * is mounted under <root>/node_modules, so an address outside that root cannot find @rowcat/runtime
 * (the symptom is a red line on the first line of every file).
 */
export const runtimeStudioModelUri = (
	scope: RuntimeStudioScope,
	path: string,
): string =>
	`file://${RUNTIME_VIRTUAL_ROOT}/${RUNTIME_STUDIO_MODEL_ROOT}/${scope}/${path}`;

/**
 * Prefix shared by all addresses of this scope. Ownership checks reduce to this one string prefix.
 */
export const runtimeStudioModelPrefix = (scope: RuntimeStudioScope): string =>
	`file://${RUNTIME_VIRTUAL_ROOT}/${RUNTIME_STUDIO_MODEL_ROOT}/${scope}/`;

export interface RuntimeEditorDisposable {
	dispose(): void;
}

/**
 * Placeholder for Monaco's IRange. This layer neither creates nor reads ranges.
 *
 * It is `unknown` on purpose: spelling out Monaco's IRange would create a copy that could diverge,
 * even though this layer does nothing with the value. Its only job is to return a range to the same
 * model that gave it.
 */
export type RuntimeEditorRange = unknown;

/**
 * Only the ITextModel members this layer calls.
 *
 * The interface is narrow for tests. The web tests have no DOM, so Monaco cannot be instantiated
 * here. A narrow interface lets a fake reproduce the registry's uniqueness semantics while product
 * code runs unchanged. Model identity is the most expensive rule in this slice.
 */
export interface RuntimeEditorModel {
	readonly uri: { toString(): string };
	getValue(): string;
	setValue(value: string): void;
	getFullModelRange(): RuntimeEditorRange;
	pushEditOperations(
		beforeCursorState: null,
		/**
		 * `text` is `string | null` to match Monaco's contract exactly. Narrowing it would break type
		 * matching.
		 */
		operations: { range: RuntimeEditorRange; text: string | null }[],
		cursorStateComputer: () => null,
	): unknown;
	onDidChangeContent(listener: () => void): RuntimeEditorDisposable;
	dispose(): void;
}

/**
 * The model registry. Its being global is the point of this interface: getModel can return another
 * editor's model, and this layer must know that for the ownership check below to hold.
 */
export interface RuntimeModelRegistry<M extends RuntimeEditorModel> {
	getModel(uri: string): M | null;
	createModel(content: string, uri: string): M;
}

export interface RuntimeStudioModelEntry<M extends RuntimeEditorModel> {
	model: M;
	/**
	 * The path the author sees. It is not the address; diagnostics, tabs, and publishing read this
	 * value only.
	 */
	path: string;
}

export interface RuntimeStudioModelsHost<M extends RuntimeEditorModel> {
	registry: RuntimeModelRegistry<M>;
	/**
	 * This editor's image box. Each model is bound to it once, and the binding survives list changes;
	 * only the value inside the box changes.
	 */
	catalog: RuntimeAssetCatalogHandle;
	onChange(fileId: string, content: string): void;
	/**
	 * The file has disappeared from the editor. Discards editor-held byproducts such as view state.
	 */
	onForget(fileId: string): void;
	/** Deterministic scope, for tests. Product code never passes one. */
	scope?: RuntimeStudioScope;
}

export interface RuntimeStudioModels<M extends RuntimeEditorModel> {
	readonly scope: RuntimeStudioScope;
	uriFor(path: string): string;
	get(fileId: string): RuntimeStudioModelEntry<M> | undefined;
	entries(): [string, RuntimeStudioModelEntry<M>][];
	/** Whether this model belongs to this editor. A single address-prefix check answers it. */
	owns(model: RuntimeEditorModel): boolean;
	sync(files: readonly DraftRuntimeFile[]): void;
	dispose(): void;
}

export function createRuntimeStudioModels<M extends RuntimeEditorModel>(
	host: RuntimeStudioModelsHost<M>,
): RuntimeStudioModels<M> {
	const scope = host.scope ?? createRuntimeStudioScope();
	const prefix = runtimeStudioModelPrefix(scope);
	const models = new Map<
		string,
		RuntimeStudioModelEntry<M> & { listener: RuntimeEditorDisposable }
	>();
	const edited = new Map<string, EditedValue<string>>();

	const uriFor = (path: string): string => runtimeStudioModelUri(scope, path);

	/**
	 * Drops the listener, the binding, and the model together, in one place. Dropping only one of the
	 * three produces silent symptoms.
	 */
	function drop(fileId: string): string | null {
		const entry = models.get(fileId);
		if (!entry) return null;
		const carried = entry.model.getValue();
		entry.listener.dispose();
		unbindRuntimeAssetCatalog(entry.model);
		entry.model.dispose();
		models.delete(fileId);
		return carried;
	}

	function attach(fileId: string, path: string, content: string): void {
		const uri = uriFor(path);
		/**
		 * If the address is already taken, do nothing.
		 *
		 * Each editor has its own scope, so no other editor's model can hold this address. sync disposes
		 * every model whose path changed before attaching, so a name swap leaves the address free. If it
		 * is still taken, two live records claim the same path. Authoring rules already prevent this, but
		 * a record from another device may have skipped that check. Sharing the existing model would make
		 * two files edit one document. A file with no model is visible on screen; a silently merged
		 * document is not.
		 */
		if (host.registry.getModel(uri) !== null) return;

		const model = host.registry.createModel(content, uri);
		const listener = model.onDidChangeContent(() => {
			const value = model.getValue();
			edited.set(fileId, { value, pending: value });
			host.onChange(fileId, value);
		});
		/**
		 * Binds the model to this editor's catalog here, which decides its ownership. A model that misses
		 * this line gets no image intelligence, and the absence is silent: autocomplete just never
		 * appears.
		 */
		bindRuntimeAssetCatalog(model, host.catalog);
		models.set(fileId, { model, path, listener });
	}

	return {
		scope,
		uriFor,
		get: (fileId) => models.get(fileId),
		entries: () =>
			[...models].map(
				([fileId, entry]) =>
					[fileId, { model: entry.model, path: entry.path }] as [
						string,
						RuntimeStudioModelEntry<M>,
					],
			),
		owns: (model) => model.uri.toString().startsWith(prefix),

		/**
		 * Syncs the repository's file list with this editor's model set.
		 *
		 * Dropping comes before attaching. In a single pass that drops and attaches per file, a name swap
		 * would move the first file into the second file's address, which is still occupied. The shortest
		 * implementation (use the existing model if there is one) would then make two files share one
		 * model. Emptying first prevents that state from arising.
		 */
		sync(files) {
			const live = new Set(files.map((file) => file.id));

			/**
			 * Removed files. Keeping them would leave the type service aware of files that no longer exist.
			 */
			for (const fileId of [...models.keys()])
				if (!live.has(fileId)) {
					drop(fileId);
					edited.delete(fileId);
					host.onForget(fileId);
				}

			/**
			 * A file whose path changed. A model's URI is immutable, so a new model must be created.
			 *
			 * The content carries over the model's current value, not the record's. Using the record's value
			 * would lose unsaved edits at the moment of rename.
			 */
			const carried = new Map<string, string>();
			for (const file of files) {
				const existing = models.get(file.id);
				if (!existing || existing.path === file.path) continue;
				const value = drop(file.id);
				if (value !== null) carried.set(file.id, value);
			}

			for (const file of files) {
				const existing = models.get(file.id);

				if (!existing) {
					const value = carried.get(file.id);
					attach(file.id, file.path, value ?? file.content);
					/** Only newly arrived files get fresh edit state. A rename takes over the previous state. */
					if (value === undefined)
						edited.set(file.id, { value: file.content, pending: null });
					continue;
				}

				/**
				 * Did the record actually change, or did it come back carrying the value we sent? The check is
				 * the same pure function the editor's input fields use. Pushing a record the editor has not
				 * caught up with would erase the characters just typed and jump the cursor to the end.
				 */
				const state = edited.get(file.id) ?? {
					value: existing.model.getValue(),
					pending: null,
				};
				const next = reconcileEditedValue(state, file.content);
				edited.set(file.id, next);
				if (next !== state && next.pending === null)
					if (existing.model.getValue() !== next.value)
						/**
						 * Uses pushEditOperations, not setValue. setValue clears the undo history and moves the
						 * cursor to the start of the document. Each edit arriving from another device would make the
						 * person viewing this screen lose their place.
						 */
						existing.model.pushEditOperations(
							null,
							[
								{
									range: existing.model.getFullModelRange(),
									text: next.value,
								},
							],
							() => null,
						);
			}
		},

		/**
		 * Disposes only this editor's models. The table is per editor and the addresses are scoped, so
		 * this loop has no path to a model another editor is using. The guarantee is structural, not a
		 * matter of discipline.
		 */
		dispose() {
			for (const fileId of [...models.keys()]) drop(fileId);
			edited.clear();
		},
	};
}
