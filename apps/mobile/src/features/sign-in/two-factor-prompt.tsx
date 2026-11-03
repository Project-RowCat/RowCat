import { space } from "@rowcat/design";
import {
	AUTHENTICATOR_CODE_LENGTH,
	type TwoFactorCodeMethod,
	twoFactorCodeReady,
} from "@rowcat/domain";
import { Button, Input, LinkButton, Notice, Text } from "@rowcat/ui-native";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";
import { authFailureMessage } from "../../lib/auth-social.ts";
import { useMobileIdentity } from "../../lib/identity.tsx";

/**
 * Login challenge — **the password was right, and a second factor remains.**
 *
 * The same slot and the same two paths as web's `features/auth/two-factor-prompt.tsx`: six digits
 * from an authenticator app by default, and backup codes for a person who lost the app. The shape
 * rules pass through the **same function** as web (`two-factor.ts` in `@rowcat/domain`). If each
 * app wrote its own, one would accept `123 456` and the other would not.
 *
 * ## This app only answers the challenge
 *
 * Turning it on and off exists only on web's account screen. This slot must still exist: without
 * it, a person who turned on two-factor in web could never get in with a password here.
 *
 * ## It does not remember this device
 *
 * There is no "don't ask on this device". No screen exists to see and remove that state, and the
 * server refuses the request too (`apps/api/src/auth/two-factor-policy.ts`).
 */
export function TwoFactorPrompt() {
	const identity = useMobileIdentity();
	const { t } = useTranslation(["signIn", "common"]);
	const [method, setMethod] = useState<TwoFactorCodeMethod>("authenticator");
	const [code, setCode] = useState("");
	const busy = identity.pending !== null;
	const ready = twoFactorCodeReady(method, code);

	const switchMethod = () => {
		identity.clearFailure();
		setCode("");
		setMethod((current) =>
			current === "authenticator" ? "backup" : "authenticator",
		);
	};

	return (
		<View style={prompt.root}>
			<View style={prompt.head}>
				<Text accessibilityRole="header" variant="title">
					{t("twoFactor.title")}
				</Text>
				<Text variant="body" tone="muted-foreground">
					{method === "authenticator"
						? t("twoFactor.authenticatorPrompt")
						: t("twoFactor.backupPrompt")}
				</Text>
			</View>

			<Input
				/** Switching methods remounts the field, so the keyboard type and autofill do not mix. */
				key={method}
				label={
					method === "authenticator"
						? t("twoFactor.authenticatorLabel")
						: t("twoFactor.backupLabel")
				}
				value={code}
				onChangeText={setCode}
				autoFocus
				autoCapitalize="none"
				autoCorrect={false}
				autoComplete={method === "authenticator" ? "one-time-code" : "off"}
				textContentType={method === "authenticator" ? "oneTimeCode" : "none"}
				keyboardType={method === "authenticator" ? "number-pad" : "default"}
				maxLength={
					method === "authenticator" ? AUTHENTICATOR_CODE_LENGTH + 2 : 32
				}
				editable={!busy}
			/>

			{identity.failure ? (
				<Notice
					tone="destructive"
					message={authFailureMessage(identity.failure)}
				/>
			) : null}

			<Button
				label={t("common:actions.ok")}
				fullWidth
				busy={identity.pending === "two-factor"}
				disabled={busy || !ready}
				onPress={() => void identity.verifyTwoFactor({ method, code })}
			/>

			<View style={prompt.links}>
				<LinkButton
					label={
						method === "authenticator"
							? t("twoFactor.useBackupLabel")
							: t("twoFactor.useAuthenticator")
					}
					onPress={switchMethod}
					disabled={busy}
				>
					<Text variant="label" tone="muted-foreground">
						{method === "authenticator"
							? t("twoFactor.useBackup")
							: t("twoFactor.useAuthenticator")}
					</Text>
				</LinkButton>
				<LinkButton
					label={t("twoFactor.restart")}
					onPress={identity.cancelTwoFactor}
					disabled={busy}
				>
					<Text variant="label" tone="muted-foreground">
						{t("twoFactor.restart")}
					</Text>
				</LinkButton>
			</View>
		</View>
	);
}

const prompt = StyleSheet.create({
	root: { gap: space.md },
	head: { gap: space.xs },
	links: { alignItems: "center", gap: space.sm },
});
