/**
 * `@rowcat/runtime-ai-docs`: the creator runtime as a corpus shaped for agents to read.
 *
 * The consumers (llms.txt, llms-full.txt, runtime-api.json, and the MCP tools runtime.search_docs
 * and runtime.get_api_reference) must state the same facts. Otherwise an agent can see one API
 * through a tool and a different one in the docs.
 *
 * Excluded dependencies: React, DOM, network, `apps/*`, the runtime compiler, and any VM. Node and
 * TypeScript exist only under ./source; the pure layer also loads in the browser.
 *
 * This package writes no product sentences. All prose comes from the markdown sources. Prose
 * written here would be a second source that can drift from the public docs, and the drift would
 * show only where agents read, so nobody would notice.
 */

export {
	findRuntimeAiDoc,
	findRuntimeAiSymbol,
	RUNTIME_AI_GROUPS,
	type RuntimeAiCorpus,
	type RuntimeAiDoc,
	type RuntimeAiExample,
	type RuntimeAiExampleFile,
	type RuntimeAiGroupId,
	type RuntimeAiHeading,
	type RuntimeAiSymbol,
	type RuntimeAiSymbolKind,
	runtimeDocsByGroup,
	runtimeDocUrl,
	runtimeSymbolsByKind,
} from "./corpus.ts";
export { RUNTIME_AI_CORPUS } from "./generated/corpus.ts";
export { headingAnchor } from "./heading-anchor.ts";
export {
	type RuntimeLlmsOptions,
	renderLlmsFullTxt,
	renderLlmsTxt,
	renderRuntimeApiJson,
} from "./llms.ts";
export {
	type RuntimeDocSearchHit,
	type RuntimeDocSearchOptions,
	searchRuntimeDocs,
	tokenizeSearchQuery,
} from "./search.ts";
