import type { Rev } from "@rowcat/contracts/sync";

/**
 * HLC total order, the same rule as `compareRev` in `@rowcat/sync`. This sameness is a contract.
 * The copy lives here because this package does not import the protocol package (layer rule). So
 * the sameness is enforced by a test at the assembly point, not by this comment.
 * codec-order.test.ts in apps/web/src/lib/local-sync runs this package's codec set through the same
 * matrix as the chat and authoring codecs. Inside this package, this file alone holds the rule, and
 * the save and library codecs both call the same function. Two copies inside one package would not
 * be checked against each other by any test. NaN, negative, and fractional values are folded once,
 * as in the original. The contract requires non-negative integers, but locally stored rows do not
 * pass that validation.
 */
const safeInt = (value: number): number =>
	Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;

export function compareRev(a: Rev, b: Rev): number {
	const at = safeInt(a.t);
	const bt = safeInt(b.t);
	if (at !== bt) return at < bt ? -1 : 1;
	const ac = safeInt(a.c);
	const bc = safeInt(b.c);
	if (ac !== bc) return ac < bc ? -1 : 1;
	if (a.d === b.d) return 0;
	return a.d < b.d ? -1 : 1;
}
