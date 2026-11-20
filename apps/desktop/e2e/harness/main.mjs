/**
 * The desktop journey's entry (`../harness.ts`): moves the app folder to the run's throwaway
 * `appData`, then runs the unchanged main bundle. `main.ts` derives `userData` from `appData`, so
 * this is the only change, and it happens before that module is evaluated.
 */
import { app } from "electron";

const appData = process.env.ROWCAT_E2E_APPDATA;
const main = process.env.ROWCAT_E2E_MAIN;
if (!appData || !main) throw new Error("ROWCAT_E2E_APPDATA and ROWCAT_E2E_MAIN are required");
app.setPath("appData", appData);
await import(main);
