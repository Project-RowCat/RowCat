/**
 * Names of the trusted runtime assets. These are not generated.
 *
 * ```text
 * modules/rowcat-runtime-webview/assets/runtime/
 *   ├── harness.html          the document
 *   └── quickjs-ng.wasm       the document's sibling
 * ```
 *
 * Native packages this whole directory (Android as APK assets, iOS as a resource bundle), and the
 * transport layer places it at the **same origin** as the document. The harness only fetches the
 * WASM from beside its own document, so it does not need to know what that origin is.
 *
 * The names are hand-written constants because of a **cycle**: the harness imports this value, and
 * the generator must bundle the harness to produce the assets. Only values derived from the bytes
 * (hashes, sizes) live in the generated output (`runtime-assets.generated.ts`).
 *
 * **Not a dynamic path.** Neither creators nor requests can set this value, and changing these
 * constants means changing both transport implementations and the native packaging together.
 */

/** The packaged directory name: the Android asset path, and the folder inside the iOS resource bundle. */
export const RUNTIME_ASSET_DIR = "runtime";

/** The harness document. */
export const RUNTIME_HARNESS_FILE = "harness.html";

/** That document's **sibling**. Loaded by relative path, so the directory name does not appear here. */
export const RUNTIME_WASM_FILE = "quickjs-ng.wasm";
