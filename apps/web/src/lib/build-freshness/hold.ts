import { useEffect } from "react";
import { holdBuildSwitch } from "./index.ts";

/** Holds the switch to a new build while `active` (`holdBuildSwitch`). Released on unmount. */
export function useHoldBuildSwitch(active: boolean): void {
	useEffect(() => (active ? holdBuildSwitch() : undefined), [active]);
}
