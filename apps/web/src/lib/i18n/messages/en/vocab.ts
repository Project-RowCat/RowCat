/**
 * Product vocabulary drawn on many screens, keyed by the codes in `@rowcat/domain` (orientation, rating, sort, period, visibility, play mode). The domain decides; this dictionary only names.
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
	unnamedProfile: "Unnamed creator",
	adultBadge: "Adult",
	untitled: "Untitled",
	pinnedNotice: {
		hidden:
			"Hidden under the operating policy, so it isn't shown on your profile.",
		private: "It's private, so it isn't shown on your profile.",
		unlisted: "It's link-only, so it isn't shown on your profile.",
		archived: "It's archived, so it isn't shown on your profile.",
		public: "",
	},
	filterToken: "{{axis}}: {{value}}",
	filterTag: "{{axis}}: #{{value}}",
	filterRemove: "Remove {{axis}} {{value}} filter",
	filterRemoveAxis: "Remove {{axis}} filter",
	sortTrigger: "{{sort}} · {{period}}",
};
