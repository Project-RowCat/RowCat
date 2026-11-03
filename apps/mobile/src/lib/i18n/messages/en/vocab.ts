/**
 * Product vocabulary drawn on many screens, keyed by the codes in `@rowcat/domain` (orientation,
 * rating, sort, period, filter axis, visibility, play mode). The domain decides; this dictionary only
 * names (`lib/i18n/vocab.ts`). The English is the domain's own, and the keys are the web's
 * (`apps/web` `vocab`), so the two apps call the same code by the same word.
 */
export const vocab = {
	orientation: { female: "For women", male: "For men", all: "All audiences" },
	rating: { any: "All", sfw: "All ages", adult: "Adult" },
	sort: { recent: "Newest", popular: "Popular", relevance: "Relevance" },
	period: {
		all: "All time",
		day: "Today",
		week: "Last 7 days",
		month: "Last 30 days",
	},
	filterAxis: {
		orientation: "Orientation",
		rating: "Rating",
		tag: "Tag",
		following: "Following",
	},
	visibility: {
		public: "Public",
		unlisted: "Link only",
		private: "Private",
		archived: "Archived",
	},
	start: { chat: "Start conversation", runtime: "Play" },
	deletedCreator: "Deleted creator",
	adultBadge: "Adult",
	deletedComment: "This comment was deleted.",
	viewReply: "View 1 reply",
	viewReplies: "View {{total}} replies",
	filterToken: "{{axis}}: {{value}}",
	filterTag: "{{axis}}: #{{value}}",
	filterRemove: "Remove {{axis}} {{value}} filter",
	filterRemoveAxis: "Remove {{axis}} filter",
	sortTrigger: "{{sort}} · {{period}}",
};
