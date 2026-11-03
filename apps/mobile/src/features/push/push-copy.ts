import { deferredGroup } from "../../lib/i18n/instance.ts";

/**
 * Copy for the push settings section. The sentences live in the dictionaries
 * (`notifications.push`, English and Korean); this module names them.
 *
 * The lock-screen banner text is not here. The server picks it
 * (`apps/api/src/services/push/copy.ts`), on a surface read by non-owners, and the app is not
 * running when that sentence is chosen.
 *
 * `Turn off on this device` reverts RowCat server delivery, not the OS permission. The copy must say so;
 * otherwise a user who sees notifications still allowed in system settings reads the button as a
 * no-op. The other cells follow the same honesty:
 *
 * - `offer` (not asked yet) says what the user would receive first.
 * - `blocked` does not only say "allow permission": the one thing the user can do is open system
 *   settings, so that path is offered too.
 * - `incomplete` (permission granted, no server registration) must not say "turned on": the device is
 *   not receiving, and showing it as on makes the user wait for notifications that never arrive.
 * - `failure` is one line per reason, without technical detail.
 * - `disableNote` says what turning off does not do: the app cannot revert the OS permission, and it
 *   stays allowed in system settings after turning off, which is the correct state.
 */
export const PUSH_COPY = deferredGroup("notifications", "push");
