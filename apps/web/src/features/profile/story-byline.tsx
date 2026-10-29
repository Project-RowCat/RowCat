import { creatorLabel, type Story } from "@rowcat/domain";
import { Link } from "@tanstack/react-router";

/**
 * - The author's name links to the profile here, and this is the only place a name links to a
 *   profile. Branching lives in one place, not per screen. A screen that missed the branch would
 *   produce a dead link to a deleted member's id, which would rebuild the identity that was erased.
 * - `StoryDto.creator` is typed as nullable, so the type enforces the branch. Do not collapse it
 *   with optional chaining, or that protection disappears.
 * - The free-text `author` field is never passed here. It is not tied to any account, and the
 *   same name could belong to anyone. Linking it would separate the name from the person it points
 *   to. Credited authorship is shown in the work's metadata section instead.
 */
export function StoryByline({
	story,
	className,
}: {
	story: Story;
	/** Font size and color vary by screen. The link's behavior is not changed by this prop. */
	className?: string;
}) {
	const label = creatorLabel(story);

	/**
	 * When the creator is missing, the text stays. The line is not removed, because list geometry
	 * assumes one byline line per card. An empty space would also say nothing: readers would stop at
	 * "why is the name missing?" The wording describes the state rather than a name
	 * (`DELETED_CREATOR_LABEL`).
	 */
	if (!story.creator) return <p className={className}>by {label}</p>;

	return (
		<p className={className}>
			by {/*
			 * A real link. Open-in-new-tab and copy-address still work, and clicking before JavaScript loads
			 * still
			 * navigates. The address uses the member id, so it survives a name change; a nickname in the URL
			 * would
			 * break on rename.
			 *
			 * The underline appears only on hover because the byline is secondary information. An
			 * always-underlined
			 * byline would draw the eye ahead of the title in lists.
			 */}
			<Link
				to="/creators/$creatorId"
				params={{ creatorId: story.creator.id }}
				className="rounded-sm underline-offset-2 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
			>
				{label}
			</Link>
		</p>
	);
}
