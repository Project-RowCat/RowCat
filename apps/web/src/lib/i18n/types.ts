import type { en } from "./messages/en/index.ts";

/**
 * The same tree as the English source with every leaf widened to `string`. Typing each locale's
 * dictionary as this makes a missing or misspelled key a compile error in that locale's file,
 * rather than a key string that silently renders on screen.
 */
type Widen<T> = { [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };

export type Messages = Widen<typeof en>;
export type Namespace = keyof Messages;
