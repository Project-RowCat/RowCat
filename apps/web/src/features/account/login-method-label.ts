import type { LoginMethodProvider } from "@rowcat/domain";
import { translator } from "#/lib/i18n/current.ts";

/**
 * Technical provider name to the name people read.
 *
 * Kept in one place because four consumers use it: the method list, the disconnect confirmation,
 * the "remaining method" sentence in that confirmation, and error copy. Written separately, one of
 * them will eventually show a raw word like `credential` to the user.
 *
 * Provider-side account identifiers never reach the contract, so there is nothing to hide here.
 */
export function loginMethodLabel(provider: LoginMethodProvider): string {
	/**
	 * Brand names are not translated. The screen the user sees after pressing uses the brand name,
	 * and a different spelling would leave them unsure whether it is the same thing.
	 */
	if (provider === "google") return "Google";
	if (provider === "apple") return "Apple";
	/**
	 * Kakao names itself in the reader's language on its own screens, so this follows its convention
	 * rather than breaking the rule.
	 */
	if (provider === "kakao")
		return translator("account")("loginMethodLabel.kakao");
	return translator("account")("loginMethodLabel.email");
}

/** Every provider this screen can label. A `Record` so adding a provider breaks compilation here. */
const LABELED: Record<LoginMethodProvider, true> = {
	credential: true,
	google: true,
	apple: true,
	kakao: true,
};

export const isLabeledLoginMethod = (
	value: string,
): value is LoginMethodProvider => value in LABELED;
