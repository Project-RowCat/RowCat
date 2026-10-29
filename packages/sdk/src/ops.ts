import { RuntimeConfigDto } from "@rowcat/contracts";
import type { RequestOptions, RowCatTransport } from "./client.ts";
import { invalidResponse } from "./errors.ts";

/**
 * Public runtime config, served at `GET /v2/runtime-config`.
 *
 * It is split from the `admin` resource. Both read the same values, but the callers are opposite:
 * this runs in the app before login, and the other is for operators. In one resource, web and
 * mobile would import the same namespace as the operator console functions, and some code would
 * eventually call one by mistake. That request returns 403, but the screen would draw it as an
 * error.
 *
 * This value is not authorization. A client that ignores a disabled feature and requests it anyway
 * is still rejected by the server. This is only the material needed to avoid drawing dead buttons.
 */
export interface OpsApi {
	runtimeConfig(options?: RequestOptions): Promise<RuntimeConfigDto>;
}

export function createOpsApi({ requestJson }: RowCatTransport): OpsApi {
	return {
		async runtimeConfig(options) {
			const json = await requestJson({
				method: "GET",
				path: "/runtime-config",
				signal: options?.signal,
			});
			const parsed = RuntimeConfigDto.safeParse(json);
			if (!parsed.success) throw invalidResponse("/runtime-config");
			return parsed.data;
		},
	};
}
