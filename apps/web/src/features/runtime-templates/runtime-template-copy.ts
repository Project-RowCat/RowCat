import type {
	RuntimeTemplateCategory,
	RuntimeTemplateComplexity,
} from "@rowcat/authoring";
import { deferredTranslator } from "#/lib/i18n/current.ts";
import { runtimeTemplates as runtimeTemplateNames } from "#/lib/i18n/messages/en/runtime-templates.ts";

const tr = deferredTranslator("runtimeTemplates");

/**
 * What the template gallery says to the user, gathered in one place and guarded by tests.
 *
 * It is split out for the same reason as the studio's `runtime-copy.ts`. One promise needs care: a
 * template is a starting point, not a kind of work. Read as 'what kind of work do you want to
 * make?', the creator believes the choice locks them in, which is false. Once created, the template
 * is an ordinary file that can become anything.
 *
 * The category and difficulty labels live here for the same reason. The registry holds only
 * machine-readable strings (`category: 'social'`), and the human-readable words belong to this app.
 * Keeping both in one place would make the pure package carry product copy.
 *
 * The same holds for each starter template's name, description and `demonstrates` list: the
 * registry's values are the authoring package's, and this app names them by template id
 * (`runtimeTemplateText`) so they follow the render's locale.
 */

export const RUNTIME_TEMPLATE_GALLERY = {
	get title() {
		return tr("gallery.title");
	},
	get description() {
		return tr("gallery.description");
	},
	/** The `All` value in the filter row is not a category; it turns the filter off. */
	get all() {
		return tr("gallery.all");
	},
	get filterLabel() {
		return tr("gallery.filterLabel");
	},
	get listLabel() {
		return tr("gallery.listLabel");
	},
	get demonstrates() {
		return tr("gallery.demonstrates");
	},
	get files() {
		return tr("gallery.files");
	},
	fileCount: (count: number) => tr("gallery.fileCount", { count }),
	get featured() {
		return tr("gallery.featured");
	},
	confirm: (name: string) => tr("gallery.confirm", { name }),
	get cancel() {
		return tr("gallery.cancel");
	},
	/** Shown while creating. The action cannot be pressed again while this text is showing. */
	get creating() {
		return tr("gallery.creating");
	},
	/**
	 * Failure. It stays inside the gallery. A toast with a closed dialog would discard the selected
	 * template and make the user choose again from the start. Inline is right because the interaction
	 * surface remains here (`docs/design/FAILURE-FEEDBACK.md`).
	 */
	get failed() {
		return tr("gallery.failed");
	},
	get retry() {
		return tr("gallery.retry");
	},
} as const;

/** The human-readable name of each category. The registry holds only machine-readable strings. */
export const runtimeTemplateCategoryLabel = (
	category: RuntimeTemplateCategory,
): string => tr(`category.${category}`);

/**
 * Difficulty is an expectation, not a gate. The word is chosen so `Advanced` does not read as 'cannot
 * use'. Nothing is locked; the value answers one question: how much is there to read when you open
 * it?
 */
export const runtimeTemplateComplexityLabel = (
	complexity: RuntimeTemplateComplexity,
): string => tr(`complexity.${complexity}`);

/**
 * The English dictionary is the source the other locales mirror (parity is tested), so whether a
 * template id or one of its `demonstrates` lines is named is read from it — rather than from a
 * second table here that would repeat the registry's ids.
 */
type TemplateId = keyof typeof runtimeTemplateNames.template;

const isTemplateId = (id: string): id is TemplateId =>
	Object.hasOwn(runtimeTemplateNames.template, id);

/**
 * A template's name, description and `demonstrates` lines in the render's locale. A template the
 * dictionary does not know (a fork adding one before naming it) falls back to the registry's own
 * values rather than drawing a blank card.
 */
export function runtimeTemplateText(template: {
	id: string;
	name: string;
	description: string;
	demonstrates: readonly string[];
}): { name: string; description: string; demonstrates: readonly string[] } {
	if (!isTemplateId(template.id)) return template;
	const id = template.id;
	return {
		name: tr(`template.${id}.name`),
		description: tr(`template.${id}.description`),
		demonstrates: template.demonstrates.map((line, index) => {
			const slot = `demonstrates${index + 1}`;
			return Object.hasOwn(runtimeTemplateNames.template[id], slot)
				? tr(`template.${id}.${slot}` as `template.blank.demonstrates1`)
				: line;
		}),
	};
}
