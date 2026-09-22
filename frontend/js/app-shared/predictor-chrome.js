/**
 * Shared chrome for the two football predictors.
 *
 * /ucl and /worldcup are single self-contained files with everything else
 * inline, so they have no module entry point of their own to hang the switcher
 * and the shortcuts sheet on. This is that entry point, and the only external
 * script either page loads. The four Dev Tools apps call the same two modules
 * from inside their own bundles.
 *
 * Which app this is comes from the URL rather than from a per-page parameter,
 * so the two pages load byte-identical script and the build has one more entry
 * to hash rather than two.
 */

import { initAppSwitcher, APPS } from "./app-switcher.js";
import { initAppShortcuts } from "./app-shortcuts.js";

/** `/ucl`, `/ucl.html` and `/ucl#anything` all resolve to the same app. */
function currentApp(pathname = window.location.pathname) {
  const slug = pathname.replace(/\.html$/, "").replace(/\/+$/, "").split("/").pop();
  return APPS.some((app) => app.id === slug) ? slug : null;
}

initAppSwitcher({ current: currentApp() });
initAppShortcuts({ tabs: ".navigation-tabs .tab-btn" });
