import type { AiEvidenceSelection } from "@rowcat/chat";
import { space } from "@rowcat/design";
import { Button, Panel, Text } from "@rowcat/ui-native";
import { StyleSheet, View } from "react-native";
import { ReportDialog } from "../../moderation/report-dialog.tsx";
import { AI_EVIDENCE_DISCLOSURE, EVIDENCE_LABEL } from "./ai-evidence.ts";

/**
 * AI-response report: the only place plaintext leaves for the server.
 *
 * Reason choice, description, duplicate-submit defence, receipt, failure copy and `My reports`
 * invalidation live in `features/moderation`, shared by story, comment and profile reports; two
 * copies would diverge in only one app without breaking compilation. What stays here is specific to
 * this report: what is sent, and whether to drop the preceding user message. Those are conversation
 * rules, and if the dialog learned them, public reports would be tied to the conversation contract.
 *
 * The container is a full-surface form. It was once a bottom sheet, but the content (eleven
 * reasons, a multi-line description, the preview, the preceding-message toggle, the disclosure, an
 * error and two buttons) pushed the disclosure and preview out of view in a half-screen panel, and
 * focusing the description let the keyboard cover the rest. `ReportDialog` owns that decision
 * (`size="full"`).
 *
 * Evidence is chosen by `buildAiResponseEvidence` (`@rowcat/chat`, same as web) and shown as is.
 * The preview derives from the evidence, so what is shown and what is sent cannot diverge, and
 * turning the toggle off shrinks both together.
 */
export function ReportMessageModal({
	selection,
	includePreceding,
	onIncludePrecedingChange,
	onClose,
}: {
	/**
	 * Evidence re-selected from the current list, built by the parent every render: if a sync changed
	 * the message while this was open, what the user confirms must change too.
	 */
	selection: AiEvidenceSelection;
	/** Whether to send the preceding user message; on by default (a response without context is hard to judge). */
	includePreceding: boolean;
	onIncludePrecedingChange: (next: boolean) => void;
	onClose: () => void;
}) {
	return (
		<ReportDialog
			/**
			 * This is the only target kind that carries evidence; the type enforces that, so the preview
			 * below can be passed only for this kind and is required here, making a dialog that uploads
			 * conversation without disclosure impossible.
			 */
			target={{ type: "ai_response", evidence: selection.evidence }}
			targetLabel="AI response"
			onClose={onClose}
			evidence={
				<>
					{/**
					 * Shows what will be sent as is, uncollapsed, because this is the substance of the
					 * disclosure and nobody expands a preview.
					 */}
					<Panel style={evidence.box}>
						<Text variant="label" tone="muted-foreground">
							What is sent
						</Text>
						{selection.preview.map((item) => (
							<View key={item.role} style={evidence.item}>
								<Text variant="caption" tone="muted-foreground">
									{EVIDENCE_LABEL[item.role]}
								</Text>
								{/**
								 * Drawn as plaintext, no markdown renderer, as with comments and more so here:
								 * content flagged for review is the least trustworthy input.
								 */}
								<Text variant="body">{item.content}</Text>
							</View>
						))}
					</Panel>

					{/**
					 * Drops the preceding user message. The package has no checkbox primitive yet, so
					 * this is one button stating on/off; state travels in `accessibilityState.selected`
					 * rather than the label (not by color alone).
					 */}
					<Button
						label={
							includePreceding
								? "Leave out my previous message"
								: "Include my previous message"
						}
						variant="outline"
						fullWidth
						onPress={() => onIncludePrecedingChange(!includePreceding)}
					/>

					<Text variant="caption" tone="muted-foreground">
						{AI_EVIDENCE_DISCLOSURE}
					</Text>
				</>
			}
		/>
	);
}

const evidence = StyleSheet.create({
	box: { gap: space.sm },
	item: { gap: space.xs },
});
