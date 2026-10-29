import { space } from "@rowcat/design";
import {
	AppBar,
	Button,
	ListRow,
	ListSection,
	ScrollScreen,
	Text,
} from "@rowcat/ui-native";
import { Redirect, useGlobalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";
import { RuntimeNativeLab } from "../features/runtime-native-lab/runtime-native-lab.tsx";
import { RuntimeVmLab } from "../features/runtime-vm-lab/runtime-vm-lab.tsx";
import { Wordmark } from "../features/shell/wordmark.tsx";
import { useMobileIdentity } from "../lib/identity.tsx";
import {
	clearSelfCheckData,
	runLocalStorageSelfCheck,
	type SelfCheckStep,
} from "../lib/local-data/dev-harness.ts";
import { useMobileLocalScope } from "../lib/local-data/scope.tsx";
import { sharedPackageProbes } from "../lib/shared-packages.ts";

/**
 * Dev diagnostics: not in release UI. This content used to live in a `__DEV__` block of the first
 * screen, which fit while that screen was a session diagnostic; now that spot is the product's
 * discovery screen, a package-load table and a SQLite self-check under the gallery grid are hard to
 * read and the code would grow into product UI.
 *
 * There is no way in from product UI (a `Diagnostic` button in the discovery header was removed, since each
 * extra cell in the identity row shrinks the brand and controls on the narrowest devices); in a dev
 * build the only way is typing `/dev-tools`.
 *
 * The route file itself exists in release bundles because expo-router reads every file under
 * `src/app/`, and avoiding that would need a separate entry point outside the router, not worth it
 * for one screen. Instead the line below sends releases back to the first screen, so deep links and
 * hand-typed addresses do not open it.
 *
 * No fake login state is planted. It only reads current state and runs two things unit tests cannot
 * reach: whether `expo-sqlite` writes to a file, and whether `expo-secure-store` keeps a value and
 * does not cross members.
 */
export default function DevTools() {
	const scope = useMobileLocalScope();
	const identity = useMobileIdentity();
	const router = useRouter();
	/**
	 * `rowcat://dev-tools?vm=run` auto-runs the VM suite on open. It is the way to script the harness
	 * (an emulator's `input tap` has failed to reach the button); other values are ignored. The screen
	 * does not open in release.
	 */
	const { vm } = useGlobalSearchParams<{ vm?: string }>();

	if (!__DEV__) return <Redirect href="/" />;

	return (
		<ScrollScreen contentStyle={dev.content}>
			<AppBar
				onBack={() => router.back()}
				backLabel="Back to Discover"
				title={<Wordmark />}
			/>

			<ListSection title="Session">
				<ListRow label="buckets" value={identity.session.phase} />
				{/**
				 * Nickname only. Member id, database file name, device identifier and session token are not drawn
				 * even here, since one screenshot would carry them out.
				 */}
				<ListRow
					label="Nickname"
					value={identity.session.viewer?.nickname ?? "-"}
				/>
			</ListSection>

			<ListSection title="Foundation">
				<ListRow label="Local scope" value={scope.status} />
				{sharedPackageProbes().map((probe) => (
					<ListRow key={probe.name} label={probe.name} value={probe.detail} />
				))}
			</ListSection>

			<SelfCheck />

			{/**
			 * Phase 3 native PoC: the WASM VM runs in a WebView, not Hermes. It lives on the diagnostics screen
			 * for the same reason as `/dev-tools`: not in release UI, opened by address only.
			 */}
			<RuntimeVmLab autoRun={vm === "run"} />

			{/**
			 * Phase 5B native playback: the creator's screen is actually drawn over the same bridge. Everything
			 * under the boxes here belongs to the runtime renderer, and the code that built that tree ran in
			 * the WASM VM inside the WebView.
			 */}
			<RuntimeNativeLab />
		</ScrollScreen>
	);
}

/**
 * Native self-check: only the two things unit tests cannot reach. Procedure and verdicts live in
 * `dev-harness.ts`.
 */
function SelfCheck() {
	const [steps, setSteps] = useState<SelfCheckStep[] | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const run = useCallback(async () => {
		setBusy(true);
		setError(null);
		try {
			setSteps(await runLocalStorageSelfCheck());
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setBusy(false);
		}
	}, []);

	const clear = useCallback(async () => {
		setBusy(true);
		try {
			await clearSelfCheckData();
			setSteps(null);
		} finally {
			setBusy(false);
		}
	}, []);

	return (
		<ListSection title="Local storage self-check">
			<View style={dev.actions}>
				<Button
					label={busy ? "Running" : "Run"}
					variant="secondary"
					size="sm"
					onPress={() => void run()}
					busy={busy}
				/>
				<Button
					label="Reset"
					variant="outline"
					size="sm"
					onPress={() => void clear()}
					busy={busy}
				/>
			</View>
			{error ? (
				<Text variant="label" tone="destructive">
					{error}
				</Text>
			) : null}
			{steps?.map((step) => (
				<ListRow
					key={step.label}
					label={`${step.ok ? "PASS" : "FAIL"} · ${step.label}`}
					value={step.detail}
				/>
			))}
		</ListSection>
	);
}

const dev = StyleSheet.create({
	content: { gap: space.xl, paddingHorizontal: space.lg },
	actions: { flexDirection: "row", gap: space.sm },
});
