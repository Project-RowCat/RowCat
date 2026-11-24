/** Packaging uses allowlists; this final scan catches accidental private state
 * from server outputs or a production dependency before an installer is written. */
import { lstatSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

export function auditPackage(root: string): void {
	const visit = (dir: string): void => {
		for (const name of readdirSync(dir)) {
			const path = join(dir, name);
			if (/^\.env(?:\.|$)/i.test(name) || /\.(?:db(?:-wal|-shm)?|sqlite(?:3)?|index\.pending)$/i.test(name) || [".git", ".desktop-data", "credentials.json"].includes(name))
				throw new Error(`private/development file in package: ${relative(root, path)}`);
			const stat = lstatSync(path);
			if (stat.isDirectory()) visit(path);
			// Platform PostgreSQL libraries use symlinks; their package-owned targets
			// are checked by the existing dependency staging, never followed here.
		}
	};
	visit(root);
}
