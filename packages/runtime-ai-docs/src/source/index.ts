/**
 * The Node-only surface for reading repository markdown. It exports only the doc reader. The API
 * extractor, which calls the TypeScript compiler, lives in `./api`. The split is deliberate:
 * apps/web's doc generator imports this module, and TypeScript must not come along with it. That
 * app's boundary test (`docs-boundaries.test.ts`) enforces this as a value check.
 */

export {
	RUNTIME_DOC_GROUPS,
	RUNTIME_DOCS_DIR,
	type RuntimeDocExample,
	type RuntimeDocExampleFile,
	type RuntimeDocGroupId,
	type RuntimeDocHeading,
	type RuntimeDocSource,
	type RuntimeDocsSource,
	readRuntimeDocs,
} from "./docs.ts";
