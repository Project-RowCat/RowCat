import { runtimeConfigQueryOptions } from "@rowcat/query";
import { useQuery } from "@tanstack/react-query";
import { getRowCatClient } from "./api.ts";
import { WEB_ORIGIN } from "./env.ts";
import { passwordResetWebUrl } from "./public-web.ts";

/**
 * The address the login screen's `Forgot your password?` link opens — **`null` unless both conditions
 * hold.**
 *
 * Both must hold:
 *
 * ```text
 * this deployment opens reset   passwordReset in the public runtime config (server mail transport + switch)
 * there is a web destination    EXPO_PUBLIC_WEB_ORIGIN
 * ```
 *
 * While the first is unknown (before lookup or after a failure) it reads as closed. Raising the
 * link on a closed deployment only leads to the web's "cannot send" page, a dead end for someone
 * who lost their password. The decision lives here rather than on the screen so the screen does not
 * re-write a rule that mixes the two facts — the web's same link checks the same two.
 */
export function usePasswordResetLink(): string | null {
	const config = useQuery(runtimeConfigQueryOptions(getRowCatClient()));
	if (config.data?.passwordReset !== true) return null;
	return passwordResetWebUrl(WEB_ORIGIN);
}
