import { PortalHost } from "@rn-primitives/portal";

/**
 * The single place where floating layers render, at the app root. Sheet sends its content here (via
 * Dialog.Portal), because a sheet drawn in place can be clipped by a parent's overflow, zIndex, or
 * scroll container. Mount it after the navigator, inside the full-screen container; placed before,
 * the sheet draws below the screen. The wiring is in apps/mobile/src/app/_layout.tsx. The package
 * is re-exported under this name so the app never imports @rn-primitives/portal directly. If it
 * did, screens would open their own portals and the stacking order could not be explained.
 */
export function PortalOutlet() {
	return <PortalHost />;
}
