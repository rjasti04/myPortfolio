/**
 * The header app switcher, shared by all seven standalone apps.
 *
 * Every app used to be a dead end: the only way from one to the next was the
 * footer, and each footer named a different arbitrary pair - /cron pointed at
 * crypto and arcade, /json at crypto and cron, /diff at json and crypto. A
 * visitor who liked one tool had to scroll to the bottom or go back to the
 * shelf to find another. The header already holds the Back link and has the
 * room, so the shelf becomes navigable from inside the apps.
 *
 * Back to the portfolio is still the first entry, and still the default
 * action: the trigger is a disclosure button, not a link that used to be one, so
 * nothing that was one press away is now two.
 *
 * One module, one call per app. The apps stay self-contained: this reads no
 * page state and writes none.
 */

/**
 * The shelf, in the order `index.html` lists it. One array, so adding an app
 * to the shelf is one line here rather than seven edits across seven files.
 */
export const APPS = [
  { id: "ucl", href: "/ucl", name: "Champions League Predictor", icon: "fa-futbol" },
  { id: "worldcup", href: "/worldcup", name: "World Cup Predictor", icon: "fa-trophy" },
  { id: "arcade", href: "/arcade", name: "Arcade", icon: "fa-cubes" },
  { id: "cron", href: "/cron", name: "Cron & Regex Visualizer", icon: "fa-sliders" },
  { id: "crypto", href: "/crypto", name: "Crypto & Encoders", icon: "fa-shield-halved" },
  { id: "json", href: "/json", name: "JSON Workbench", icon: "fa-code" },
  { id: "diff", href: "/diff", name: "Diff Checker", icon: "fa-code-compare" },
];

/**
 * Turn an existing Back control into a switcher.
 *
 * @param {object} options
 * @param {string} options.current - the id of the app this is running in
 * @param {Document} [options.doc]
 * @returns {{ open: () => void, close: () => void } | null} null when the page
 *   has no Back control, which is the no-op every app tolerates.
 */
export function initAppSwitcher({ current, doc = document } = {}) {
  const back = doc.querySelector(".back-btn");
  if (!back) return null;

  const wrap = doc.createElement("div");
  wrap.className = "app-switcher";

  const trigger = doc.createElement("button");
  trigger.type = "button";
  trigger.className = "action-btn app-switcher-trigger";
  trigger.id = "app-switcher-trigger";
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-controls", "app-switcher-menu");
  trigger.setAttribute("aria-label", "Portfolio and other apps");
  trigger.title = "Portfolio and other apps";
  trigger.innerHTML =
    '<i class="fas fa-bars" aria-hidden="true"></i>' +
    '<span class="action-label">Apps</span>';

  // A disclosure of links, not an ARIA menu: role="menu" promises arrow-key
  // navigation and a single Tab stop, and this had neither, so a screen
  // reader announced a menu that did not behave like one. A <nav> of plain
  // links is what it actually is; Tab walks it while it is open.
  const menu = doc.createElement("nav");
  menu.className = "app-switcher-menu";
  menu.id = "app-switcher-menu";
  menu.setAttribute("aria-label", "Portfolio and other apps");
  menu.hidden = true;

  // The portfolio first: it is where Back went, and it is still the way out.
  menu.append(
    item(doc, { href: "/", name: "Portfolio home", icon: "fa-home" }, false),
    item(doc, { href: "/#apps", name: "All apps", icon: "fa-bars" }, false),
    separator(doc),
  );
  for (const app of APPS) {
    menu.append(item(doc, app, app.id === current));
  }

  back.parentNode.insertBefore(wrap, back);
  wrap.append(back, trigger, menu);

  function setOpen(open) {
    menu.hidden = !open;
    trigger.setAttribute("aria-expanded", String(open));
    if (open) menu.querySelector("a")?.focus();
  }

  trigger.addEventListener("click", () => setOpen(menu.hidden));

  // Escape closes and returns focus to the trigger, which is where the
  // keyboard user was before it opened.
  wrap.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || menu.hidden) return;
    event.stopPropagation();
    setOpen(false);
    trigger.focus();
  });

  doc.addEventListener("click", (event) => {
    if (menu.hidden || wrap.contains(event.target)) return;
    setOpen(false);
  });

  return { open: () => setOpen(true), close: () => setOpen(false) };
}

function item(doc, app, isCurrent) {
  const link = doc.createElement("a");
  link.className = "app-switcher-item";
  link.href = app.href;
  // The current app is marked rather than removed: a list whose contents
  // change per page is a list you have to re-read every time.
  // aria-current carries both jobs: the announcement and the styling hook, so
  // the two cannot drift apart.
  if (isCurrent) link.setAttribute("aria-current", "page");
  link.innerHTML = `<i class="fas ${app.icon}" aria-hidden="true"></i><span>${app.name}</span>`;
  return link;
}

function separator(doc) {
  const rule = doc.createElement("div");
  rule.className = "app-switcher-sep";
  rule.setAttribute("aria-hidden", "true");
  return rule;
}
