import type { RuntimeTemplateId } from "@rowcat/authoring";
import { BlankPreview } from "./previews/blank-preview.tsx";
import { IdolDebutPreview } from "./previews/idol-debut-preview.tsx";
import { InvestigationPreview } from "./previews/investigation-preview.tsx";
import { MessengerPreview } from "./previews/messenger-preview.tsx";
import { RelationshipPreview } from "./previews/relationship-preview.tsx";
import { VisualNovelPreview } from "./previews/visual-novel-preview.tsx";

/**
 * Maps template id to its picture. Being a `Record` is the point. When a seventh template joins the
 * registry, this file fails to compile, so a card cannot silently show an empty box. The same shape
 * is already used by the repo's shared vocabularies (`ChatMarkdownNodeType`, `RoomActionId`). A
 * ternary or a `switch` with a `default` would let the gap pass silently, and the author adding a
 * template would learn there was no picture only by opening the gallery.
 */
const PREVIEW: Record<RuntimeTemplateId, () => React.JSX.Element> = {
	blank: BlankPreview,
	"idol-debut": IdolDebutPreview,
	"visual-novel": VisualNovelPreview,
	messenger: MessengerPreview,
	investigation: InvestigationPreview,
	"relationship-profile": RelationshipPreview,
};

export function RuntimeTemplatePreview({ id }: { id: RuntimeTemplateId }) {
	const Preview = PREVIEW[id];
	return <Preview />;
}
