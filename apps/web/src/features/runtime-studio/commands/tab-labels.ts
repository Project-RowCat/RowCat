/**
 * Tab label for each open editor tab. The basename alone when it is unambiguous; parent folders are
 * added only when names collide. The starter project in this repo has many `index.ts` files, so
 * collisions are common.
 * - Never the full path always. Segments can be up to 64 characters, so one tab could grow to
 *   about 400px and push the others off the strip.
 * - Output is index-aligned with the input, not a path-to-label map. A map would collapse
 *   duplicate paths in an out-of-sync frame and drop a tab. Tab identity is the file id; this
 *   function only chooses the text drawn.
 * - No sorting or deduplication. Order belongs to the caller (open order); reordering here would
 *   misalign labels and tabs. Two identical paths both become full paths, and the loop stops.
 */

/**
 * Maps open file paths to the label drawn for each. The rule: while entries still share a label,
 * only those entries gain one more leading segment. Non-colliding entries are left alone, so in the
 * common case every label is just the file name.
 */
export function runtimeEditorTabLabels(paths: readonly string[]): string[] {
	const segments = paths.map((path) => path.split("/"));
	/** Number of trailing path segments used for each entry. 1 means just the file name. */
	const depth = segments.map(() => 1);

	const labelAt = (index: number): string =>
		segments[index].slice(-depth[index]).join("/");

	/**
	 * The round limit is the segment count of the deepest path, beyond which every entry is already a
	 * full path. Without the limit, two identical paths would loop forever.
	 */
	const rounds = segments.reduce(
		(max, parts) => Math.max(max, parts.length),
		1,
	);

	for (let round = 0; round < rounds; round++) {
		const groups = new Map<string, number[]>();
		for (let index = 0; index < paths.length; index++) {
			const label = labelAt(index);
			const group = groups.get(label);
			if (group) group.push(index);
			else groups.set(label, [index]);
		}

		let grew = false;
		for (const group of groups.values()) {
			if (group.length < 2) continue;
			for (const index of group) {
				/** Entries with no segments left to add stay as they are; they already show the full path. */
				if (depth[index] >= segments[index].length) continue;
				depth[index]++;
				grew = true;
			}
		}
		if (!grew) break;
	}

	return paths.map((_, index) => labelAt(index));
}
