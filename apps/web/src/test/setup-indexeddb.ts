/**
 * IndexedDB polyfill, installed globally before any test runs. `fake-indexeddb/auto` fills
 * globalThis.indexedDB on import, so it must evaluate before Dexie. Importing it inside a test file
 * can let Dexie load first, depending on hoisting order, and fail with 'no IndexedDB'. setupFiles
 * guarantees the order.
 */
import "fake-indexeddb/auto";
