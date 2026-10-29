import { RUNTIME_API_VERSION } from "@rowcat/runtime/declarations";
import { analyzeRuntimeProject } from "@rowcat/runtime-compiler";

/**
 * Structural check of the saved code: the line the draft editor's runtime section shows before
 * publishing. It analyzes the files actually stored in the repository, not the editor snapshot.
 * - The studio's check state lives on the editor snapshot and is shown only in the studio.
 *   Publishing happens on another screen, so an author may trust a last-seen `No problems` (no issues)
 *   after a synced change has removed the entry point.
 * - Not a compile. analyzeRuntimeProject checks entry point, module resolution, and forbidden
 *   syntax, but not types. Running the full compile here would bundle lib.es2022.d.ts into the
 *   editor. The label is `Structure check`, and its message says type checking and compilation happen on the
 *   server at publish time. Saying it publishes would mislead an author who then gets a server 400.
 * - The server stays the authority: it recompiles the submitted source. This line is guidance,
 *   not a gate. It does not lock the publish button, because a lock would hide the server's more
 *   precise diagnostics.
 */
export type RuntimeSavedCheck =
	| { status: "clean" }
	| { status: "problems"; errors: number }
	/** The checker itself failed. This is not something the author can fix. */
	| { status: "failed" };

export function runtimeSavedCheck(input: {
	entry: string;
	files: readonly { path: string; content: string }[];
}): RuntimeSavedCheck {
	try {
		const result = analyzeRuntimeProject({
			apiVersion: RUNTIME_API_VERSION,
			entry: input.entry,
			files: input.files.map((file) => ({
				path: file.path,
				content: file.content,
			})),
		});
		const errors = result.diagnostics.filter(
			(diagnostic) => diagnostic.severity === "error",
		).length;
		return errors === 0 ? { status: "clean" } : { status: "problems", errors };
	} catch {
		return { status: "failed" };
	}
}
