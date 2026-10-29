/**
 * Pure conversion from TypeScript's semantic classification to Monaco's semantic tokens.
 *
 * Monaco's TypeScript contribution has no semantic token provider, and the lexical layer cannot
 * tell a type from a value, a function from a variable, or a property from a local. The language
 * service knows all of these.
 *
 * The encoding is TypeScript's: triplets of (start, length, classification), where classification =
 * (type + 1) << 8 | modifiers. The +1 is essential, since 0 means unclassified.
 *
 * The two legend arrays below are a contract and must match TypeScript's TokenType and
 * TokenModifier order. Sorting them alphabetically would paint classes as enums and parameters as
 * properties, with no error.
 *
 * JSX never arrives here: TypeScript's collector skips identifiers inside JSX, so tag and attribute
 * colors come from the lexical layer (runtime-tsx-grammar.ts).
 * runtime-semantic-tokens.monaco.test.ts records that absence against the real service.
 *
 * The value checks live in runtime-semantic-tokens.test.ts. Legend order is checked only in
 * runtime-semantic-tokens.monaco.test.ts, since an order shift passes every arithmetic check.
 */

/** Must match TypeScript's TokenType order. */
export const RUNTIME_SEMANTIC_TOKEN_TYPES = [
	"class",
	"enum",
	"interface",
	"namespace",
	"typeParameter",
	"type",
	"parameter",
	"variable",
	"enumMember",
	"property",
	"function",
	"member",
] as const;

/** Must match TypeScript's TokenModifier order. Each entry is a bit position. */
export const RUNTIME_SEMANTIC_TOKEN_MODIFIERS = [
	"declaration",
	"static",
	"async",
	"readonly",
	"defaultLibrary",
	"local",
] as const;

/** Shift and mask that split the classification integer, as TypeScript defines them. */
const TYPE_OFFSET = 8;
const MODIFIER_MASK = 255;

export interface RuntimeSemanticClassification {
	/** Index into the legend. An out-of-range index drops the token. */
	typeIndex: number;
	modifiers: number;
}

/**
 * Decodes one classification integer. Unknown values return null, never 0: 0 is class, so folding
 * unknowns to 0 would turn every unclassified name into a class.
 */
export function decodeSemanticClassification(
	classification: number,
): RuntimeSemanticClassification | null {
	if (!Number.isInteger(classification) || classification <= 0) return null;
	const typeIndex = (classification >> TYPE_OFFSET) - 1;
	if (typeIndex < 0 || typeIndex >= RUNTIME_SEMANTIC_TOKEN_TYPES.length)
		return null;
	return { typeIndex, modifiers: classification & MODIFIER_MASK };
}

/**
 * Zero-based line and character. The boundary of this layer separates them from Monaco's one-based
 * IPosition.
 */
export interface RuntimeTokenPosition {
	line: number;
	character: number;
}

/**
 * Converts triplets (start, length, classification) into Monaco's five-number delta-encoded groups.
 *
 * Deltas are line differences between lines, and character differences within the same line.
 * Breaking this rule paints tokens in the wrong place while the screen still looks plausible.
 *
 * Multi-line ranges are dropped. Monaco's encoding has no room for them (length counts characters
 * within one line). TypeScript classifies single identifiers, so they do not occur in practice.
 */
export function encodeSemanticTokens(
	spans: readonly number[],
	positionAt: (offset: number) => RuntimeTokenPosition,
): number[] {
	const data: number[] = [];
	let lastLine = 0;
	let lastCharacter = 0;

	for (let i = 0; i + 2 < spans.length; i += 3) {
		const start = spans[i] as number;
		const length = spans[i + 1] as number;
		const decoded = decodeSemanticClassification(spans[i + 2] as number);
		if (!decoded || length <= 0) continue;

		const from = positionAt(start);
		const to = positionAt(start + length);
		if (to.line !== from.line) continue;

		const deltaLine = from.line - lastLine;
		const deltaCharacter =
			deltaLine === 0 ? from.character - lastCharacter : from.character;
		/**
		 * Tokens that go backward are dropped. The language service returns them in order, but assuming
		 * that would paint the whole screen wrong on an out-of-order day, with no visible cause here.
		 */
		if (deltaLine < 0 || deltaCharacter < 0) continue;

		data.push(
			deltaLine,
			deltaCharacter,
			length,
			decoded.typeIndex,
			decoded.modifiers,
		);
		lastLine = from.line;
		lastCharacter = from.character;
	}

	return data;
}

/**
 * The classification format requested from the language service.
 *
 * The default 'original' is a different encoding, so the decoding above would return entirely wrong
 * answers. The value is a string because TypeScript's enum is a string. The worker and this module
 * read the same constant, so the worker side does not hardcode a literal that could drift.
 */
export const RUNTIME_SEMANTIC_FORMAT = "2020";

/**
 * Limited to the members this provider calls on ITextModel. Same narrowing as the model layer: the
 * web tests here have no editor, and converting a range to an offset and back is the most
 * error-prone part of this layer.
 */
export interface RuntimeSemanticModel {
	readonly uri: { toString(): string };
	getOffsetAt(position: { lineNumber: number; column: number }): number;
	getPositionAt(offset: number): { lineNumber: number; column: number };
	isDisposed(): boolean;
}

export interface RuntimeSemanticRange {
	startLineNumber: number;
	startColumn: number;
	endLineNumber: number;
	endColumn: number;
}

/** Worker-side contract. The method may be absent, which is a normal state. */
export interface RuntimeSemanticWorker {
	getEncodedSemanticClassifications?: (
		fileName: string,
		start: number,
		end: number,
	) => Promise<number[]>;
}

/**
 * Converts a range and returns Monaco's encoding. There are three null returns, all normal: the
 * worker is not ours (an instance left over from hot reload), the model disappeared in the
 * meantime, or the worker does not know the file yet. In each case the screen keeps its lexical
 * colors. The semantic layer paints over lexical colors; it is not the only source of color.
 */
export async function provideRuntimeSemanticTokens(
	model: RuntimeSemanticModel,
	range: RuntimeSemanticRange,
	resolve: (model: RuntimeSemanticModel) => Promise<RuntimeSemanticWorker>,
): Promise<{ data: Uint32Array } | null> {
	const worker = await resolve(model);
	if (!worker.getEncodedSemanticClassifications) return null;

	const spans = await worker.getEncodedSemanticClassifications(
		model.uri.toString(),
		model.getOffsetAt({
			lineNumber: range.startLineNumber,
			column: range.startColumn,
		}),
		model.getOffsetAt({
			lineNumber: range.endLineNumber,
			column: range.endColumn,
		}),
	);
	if (model.isDisposed()) return null;

	return {
		data: new Uint32Array(
			encodeSemanticTokens(spans, (offset) => {
				const position = model.getPositionAt(offset);
				return {
					line: position.lineNumber - 1,
					character: position.column - 1,
				};
			}),
		),
	};
}
