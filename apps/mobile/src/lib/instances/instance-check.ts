import {
	INSTANCE_PROTOCOL_MIN_SUPPORTED,
	INSTANCE_PROTOCOL_VERSION,
	type RuntimeConfigDto,
} from "@rowcat/contracts";
import { isRowCatApiError } from "@rowcat/sdk";

/**
 * Asks a server, **before anyone signs in to it**, whether it is a RowCat API this app can speak to
 * (`docs/mobile/INSTANCES.md` §인스턴스의 신원).
 *
 * The question is one unauthenticated read, `GET /v2/runtime-config`, and the answer is the
 * `instanceProtocol` it states:
 *
 * ```text
 * ok            the response has this contract's shape and a protocol in [MIN_SUPPORTED, VERSION]
 * unsupported   a protocol outside that range, or none stated — "update the app" or "not this app's server"
 * not_rowcat    something answered, but not with this contract (a 404, a web page, another API)
 * unreachable   no answer: offline, DNS, TLS, a 5xx — worth trying again
 * ```
 *
 * A missing protocol is `unsupported`, not `ok`: the contract gives the field no default precisely so that
 * a response which merely has the right shape does not pass as a current RowCat server. This is not a
 * security boundary — a malicious server can state any number — it keeps an honest mismatch from
 * surfacing as broken screens after sign-in. What protects the member from a malicious server is the
 * isolation of everything local (`local-scope.ts`).
 *
 * The read is passed in (the SDK's `ops.runtimeConfig` bound to that origin), so this file holds only the
 * judgement and is checked by value.
 */

export type InstanceCheck =
	| { status: "ok"; config: RuntimeConfigDto }
	| { status: "unsupported"; protocol: number | null }
	| { status: "not_rowcat" }
	| { status: "unreachable" };

export const protocolSupported = (protocol: number): boolean =>
	protocol >= INSTANCE_PROTOCOL_MIN_SUPPORTED &&
	protocol <= INSTANCE_PROTOCOL_VERSION;

export async function checkInstance(
	readRuntimeConfig: () => Promise<RuntimeConfigDto>,
): Promise<InstanceCheck> {
	let config: RuntimeConfigDto;
	try {
		config = await readRuntimeConfig();
	} catch (error) {
		if (!isRowCatApiError(error)) return { status: "unreachable" };
		return error.status >= 500
			? { status: "unreachable" }
			: { status: "not_rowcat" };
	}
	const protocol = config.instanceProtocol ?? null;
	if (protocol === null || !protocolSupported(protocol))
		return { status: "unsupported", protocol };
	return { status: "ok", config };
}
