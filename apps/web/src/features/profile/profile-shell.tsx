import type { ReactNode } from "react";
import { Canvas } from "#/components/app-shell/canvas.tsx";

/**
 * Shell for the public profile. It uses the same width and padding for every body state: profile,
 * placeholder, and error.
 *
 * No back link, unlike the work-detail shell. The work-detail back link has a clear destination
 * because it is reached through the gallery's preview. A profile is reached from many places (work
 * detail, comments, future notifications), so a label such as `Back to Discover` would name the wrong
 * destination. The browser's back button already does this exactly.
 *
 * The title is not here either. The title is the person's name, known only once data arrives. If a
 * placeholder imitated it, the text would change on arrival.
 */
export function ProfileShell({ children }: { children: ReactNode }) {
	return <Canvas>{children}</Canvas>;
}
