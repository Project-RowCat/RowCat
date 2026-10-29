import type {
	DraftRuntimeAsset,
	DraftRuntimeFile,
	DraftRuntimeFilePatch,
	DraftRuntimeProject,
} from "@rowcat/authoring";
import type { RuntimeAiCorpus } from "@rowcat/runtime-ai-docs";
import type {
	RuntimeCompileInput,
	RuntimeCompileResult,
} from "@rowcat/runtime-compiler";
import type {
	RuntimeConsoleSink,
	RuntimePersistentStateSnapshot,
	RuntimeStoryStateSnapshot,
	RuntimeVmSession,
} from "@rowcat/runtime-host";

/**
 * Everything MCP requires from the outside world: a set of ports and one context.
 *
 * - RuntimeAuthoringPort reads and writes the draft's runtime source. AuthoringStore satisfies it
 *   structurally.
 * - RuntimeMcpHost compiles, creates VMs, and schedules idle cleanup. The Node adapter provides
 *   it.
 * - RuntimeAiCorpus is docs and API reference: a committed value with no read operations.
 *
 * Why not require AuthoringStore as-is: it also carries drafts, lore, start scenes, situation
 * images, and publishing, and MCP calls only nine of its methods. A broad port would force tests to
 * fake all of it, and it would put into the type surface that this layer can touch draft bodies,
 * lore, and publishing. The narrow port expresses that absence. AuthoringStore fits this shape, so
 * the app passes it through.
 *
 * No port takes an ownerId or viewerId. The authoring store already belongs to one member (one
 * local database per member), so a request to view another member's draft cannot be expressed. The
 * absence is the access control: an argument that does not exist, not code that checks.
 */

/** Draft fields MCP shows in lists. StoryDraft carries more than this. */
export interface RuntimeMcpDraftView {
	readonly id: string;
	readonly title: string;
	readonly updatedAt: string;
	readonly deletedAt?: string | null;
}

export interface RuntimeAuthoringPort {
	/**
	 * Brings this store up to the authoritative latest version. Called before every write. Optional,
	 * because stores disagree about what is authoritative. In the browser, Dexie is itself the
	 * authority, so there is nothing to do. The headless MCP device keeps its data in memory, so one
	 * pull is the answer. This layer does not know which case applies. It only requires that it never
	 * judge against a stale version.
	 *
	 * On failure it throws. Running an optimistic-concurrency check while unsure the data is latest
	 * would void the guarantee the check exists to give. Silently continuing would let that write
	 * through unprotected.
	 */
	refresh?(): Promise<void>;
	listDrafts(): Promise<readonly RuntimeMcpDraftView[]>;
	getDraft(id: string): Promise<RuntimeMcpDraftView | null>;
	getRuntimeProject(draftId: string): Promise<DraftRuntimeProject | null>;
	listRuntimeFiles(draftId: string): Promise<readonly DraftRuntimeFile[]>;
	createRuntimeFile(
		draftId: string,
		input: { path: string; content?: string },
	): Promise<DraftRuntimeFile | null>;
	updateRuntimeFile(id: string, patch: DraftRuntimeFilePatch): Promise<void>;
	deleteRuntimeFile(id: string): Promise<void>;
	listRuntimeAssets(draftId: string): Promise<readonly DraftRuntimeAsset[]>;
}

/**
 * Options passed to the host when creating one session. Same shape as what the preview worker
 * passes.
 */
export interface RuntimeMcpVmOptions {
	readonly artifact: unknown;
	readonly onConsole: RuntimeConsoleSink;
	readonly storyState: RuntimeStoryStateSnapshot;
	readonly persistentState: RuntimePersistentStateSnapshot;
	readonly onStoryStateCommit: (snapshot: RuntimeStoryStateSnapshot) => void;
	readonly onPersistentStateCommit: (
		snapshot: RuntimePersistentStateSnapshot,
	) => void;
}

/**
 * The execution environment: exactly two functions, one that makes the compiler and one that makes
 * the VM. The core does not import node:crypto or a QuickJS variant directly, for the same reason
 * as runtime-compiler's environment/node.ts. If this layer knew the platform, it could never run
 * elsewhere. Node is the only consumer today, so the adapter lives in this package
 * (./node/host.ts). Verifying this layer requires the real compiler and the real QuickJS.
 */
export interface RuntimeMcpHost {
	compile(input: RuntimeCompileInput): RuntimeCompileResult;
	createSession(options: RuntimeMcpVmOptions): Promise<RuntimeVmSession>;
	/**
	 * Maps content to a stable short string. Key for optimistic concurrency, not a basis for
	 * authorization.
	 */
	digest(content: string): string;
	now(): number;
	/**
	 * Schedules idle cleanup. The returned function cancels it. This port exists because of a defect
	 * in the earlier design. Idle cleanup ran only on the next tool call, so after preview_start on a
	 * connection that stopped calling tools, nothing cleaned up and the QuickJS/WASM session lived as
	 * long as the connection. For the advertised idle limit to hold, a timer must be scheduled.
	 *
	 * The core does not call setTimeout itself, the same placement as runtime-compiler's
	 * environment/node.ts. Also, scheduling alone must not keep the process alive. In Node, unref does
	 * that. That decision belongs to the adapter, not to this layer.
	 */
	schedule(callback: () => void, delayMs: number): () => void;
}

export interface RuntimeMcpContext {
	readonly authoring: RuntimeAuthoringPort;
	readonly host: RuntimeMcpHost;
	readonly corpus: RuntimeAiCorpus;
}
