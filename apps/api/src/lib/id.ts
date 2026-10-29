import { randomUUID } from "node:crypto";

/**
 * Hyphenless 32-char UUIDv4. Not sequential, since that would leak story and member counts via
 * public URLs; generated here rather than by the DB so the id is known before INSERT and related
 * rows (covers etc.) can be written in the same transaction.
 */
export const newId = (): string => randomUUID().replaceAll("-", "");
