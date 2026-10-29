/**
 * Source map tracing: emitted position to the creator's source position.
 *
 * An artifact module is emitted JavaScript, and the VM's stack reports lines and columns in that
 * code. The creator sees TSX in the editor, so drawing the emitted line number directly would point
 * at the wrong place in the source. A wrong position is worse than none. The compiler embeds a
 * source map per module (RuntimeArtifactModule.map), so tracing answers here.
 *
 * The map format is the compiler's emit format (normalizeSourceMap in compile.ts folds sources into
 * a single module id). If a React component or worker parsed the string itself, the screen would go
 * stale whenever the emit format changed. No dependency is added because this file also runs in
 * browser workers; only a VLQ decoder is needed, roughly twenty lines.
 *
 * If tracing is impossible the result is null. A position is never invented when the line has no
 * mapping, the map is broken, or its version differs.
 */

export interface RuntimeSourcePosition {
	line: number;
	column: number;
}

const BASE64 =
	"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Decodes one VLQ segment into integers. An unknown character makes the segment invalid (null), so
 * it is discarded.
 */
function decodeVlq(segment: string): number[] | null {
	const values: number[] = [];
	let shift = 0;
	let value = 0;
	for (const char of segment) {
		const digit = BASE64.indexOf(char);
		if (digit < 0) return null;
		value += (digit & 31) << shift;
		if (digit & 32) {
			shift += 5;
			continue;
		}
		const negative = value & 1;
		value >>= 1;
		values.push(negative ? -value : value);
		value = 0;
		shift = 0;
	}
	return shift === 0 ? values : null;
}

interface ParsedSourceMap {
	mappings: string;
}

function parseSourceMap(json: string): ParsedSourceMap | null {
	let raw: unknown;
	try {
		raw = JSON.parse(json);
	} catch {
		return null;
	}
	if (typeof raw !== "object" || raw === null) return null;
	const map = raw as { version?: unknown; mappings?: unknown };
	if (map.version !== 3 || typeof map.mappings !== "string") return null;
	return { mappings: map.mappings };
}

/**
 * Maps an emitted (line, column) to the source's (line, column), both 1-based like the engine's
 * stack and the editor's coordinates. A source map records only where each segment starts, so
 * columns between segments belong to the previous segment. On the same line, pick the last segment
 * whose column does not exceed the target. If the target is before the line's first segment, it
 * cannot be traced.
 */
export function originalPositionFor(
	mapJson: string,
	generated: RuntimeSourcePosition,
): RuntimeSourcePosition | null {
	if (
		!Number.isInteger(generated.line) ||
		!Number.isInteger(generated.column) ||
		generated.line < 1 ||
		generated.column < 1
	)
		return null;
	const map = parseSourceMap(mapJson);
	if (!map) return null;

	const lines = map.mappings.split(";");
	const targetLine = generated.line - 1;
	if (targetLine >= lines.length) return null;

	/**
	 * Source-side values accumulate across lines, so every previous line must be read before this
	 * line's absolute value is known.
	 */
	let sourceLine = 0;
	let sourceColumn = 0;
	let best: RuntimeSourcePosition | null = null;

	for (let lineIndex = 0; lineIndex <= targetLine; lineIndex += 1) {
		const line = lines[lineIndex] ?? "";
		if (line === "") continue;
		let generatedColumn = 0;
		for (const segment of line.split(",")) {
			if (segment === "") continue;
			const fields = decodeVlq(segment);
			if (fields === null) return null;
			generatedColumn += fields[0] ?? 0;
			if (fields.length < 4) continue;
			sourceLine += fields[2] ?? 0;
			sourceColumn += fields[3] ?? 0;
			if (lineIndex === targetLine && generatedColumn <= generated.column - 1)
				best = { line: sourceLine + 1, column: sourceColumn + 1 };
		}
	}
	return best;
}
