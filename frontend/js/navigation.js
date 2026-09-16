import { compactViewport, mobileDevice, prefersReducedMotion, supportsHover } from "./config.js";
import { handleFocusTrap, lockBodyScroll, unlockBodyScroll } from "./modal.js";
import { onOnline, onOffline, isNetworkOnline } from "./utils.js";
import { SwipeHandler } from "./swipe-handler.js";

let hamburger, navMenu, navLinks, sections;

/**
 * True while any dialog is on screen.
 *
 * `.pdf-modal` is shown by modal.js adding `.active`; the auth modal is a
 * separate implementation that toggles `.hidden` instead. Keyboard shortcuts
 * have to respect both, or they fire through an open dialog.
 */
function isModalOpen() {
  return Boolean(
    document.querySelector(".pdf-modal.active") ||
      document.querySelector("#auth-modal:not(.hidden)")
  );
}

/** True when focus is somewhere the user is typing, so single keys are text. */
function isTypingTarget(element) {
  if (!element) return false;
  if (element.isContentEditable) return true;
  const tag = element.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/* Tracked so the reference-counted lock is taken exactly once per open.
   setMobileMenuState(false) is called defensively from several paths - a
   dropdown opening, a resize, every navigation - and an unbalanced release
   would unlock the page under an open modal. */
let navScrollLocked = false;

function setMobileMenuState(isOpen) {
  if (!navMenu || !hamburger) return;

  const wasOpen = navMenu.classList.contains("show-menu");

  if (isOpen) {
    navMenu.classList.add("show-menu");
    navMenu.setAttribute("aria-hidden", "false");
    // The reference-counted lock from modal.js rather than a bare
    // `body.style.overflow`: it preserves the scroll offset and applies the
    // `position: fixed` that is what actually stops iOS scroll-chaining.
    if (!navScrollLocked) {
      lockBodyScroll();
      navScrollLocked = true;
    }
  } else {
    navMenu.classList.remove("show-menu");
    navMenu.setAttribute("aria-hidden", "true");
    if (navScrollLocked) {
      unlockBodyScroll();
      navScrollLocked = false;
    }
  }

  hamburger.setAttribute("aria-expanded", String(isOpen));
  document.body.classList.toggle("nav-open", Boolean(isOpen) && compactViewport.matches);

  const icon = hamburger.querySelector("i");
  if (icon) {
    icon.classList.toggle("fa-bars", !isOpen);
    icon.classList.toggle("fa-times", isOpen);
  }

  // Focus management, which this panel was the only one on the site to lack -
  // js/modal.js, the header dropdowns and the command palette all have it,
  // and on a phone THIS is the navigation. Opening it left focus on the
  // hamburger behind a scrim; closing it dropped focus entirely.
  if (isOpen && !wasOpen) {
    document.getElementById("nav-menu-close")?.focus();
  } else if (!isOpen && wasOpen) {
    // Only reclaim focus if it is still inside the panel being closed;
    // navigating away has already put it somewhere deliberate.
    if (navMenu.contains(document.activeElement)) hamburger.focus();
  }
}

export function closeAllDropdowns() {
  document.querySelectorAll('.header-dropdown.is-open').forEach(dropdown => {
    dropdown.classList.remove('is-open');
    dropdown.querySelector('button')?.setAttribute('aria-expanded', 'false');
    dropdown.querySelector('.header-dropdown-menu')?.setAttribute('aria-hidden', 'true');
  });

  const userDropdown = document.getElementById('nav-user-dropdown');
  const userBtn = document.getElementById('nav-user-btn');
  if (userDropdown) {
    userDropdown.classList.remove('show');
  }
  if (userBtn) {
    userBtn.setAttribute('aria-expanded', 'false');
  }

  document.body.classList.remove('dropdown-open');
}

function closeTransientUi() {
  setMobileMenuState(false);
  closeAllDropdowns();
}

/**
 * Retires the pre-boot router's marker.
 *
 * The inline script in index.html marks the section it activated
 * `is-boot-target`, which suppresses the entrance animation - that section is
 * the page as loaded, not a transition into it. The marker has to outlive this
 * module's own first sync, which re-applies the very same target, and die on
 * the first real navigation. `nav-ready` lands between the two, so it is the
 * flag that tells them apart.
 */
function clearBootTarget() {
  if (!document.documentElement.classList.contains("nav-ready")) return;
  document.querySelector("section.is-boot-target")?.classList.remove("is-boot-target");
}

/**
 * Per-view page metadata.
 *
 * The router renders one section at a time - every other section is
 * `display: none` - so each view is a page in every sense except the three
 * that were never updated: the title, the canonical URL and og:url. All eight
 * views shared "Rajeev Jasti | Principal Data Engineer" and the bare origin,
 * so the history dropdown read as eight identical entries, a bookmark of
 * #resume saved the generic title, and a shared #apps link previewed as the
 * home page. `label` is what the announcer says and is the section's own
 * visible name, not new copy.
 */
const ROUTE_META = {
  home: { title: "Rajeev Jasti | Principal Data Engineer", label: "Home" },
  about: { title: "About | Rajeev Jasti", label: "About" },
  resume: { title: "Experience | Rajeev Jasti", label: "Experience" },
  hobbies: { title: "Interests & Hobbies | Rajeev Jasti", label: "Interests & Hobbies" },
  apps: { title: "Apps | Rajeev Jasti", label: "Apps" },
  activity: { title: "Session Activity | Rajeev Jasti", label: "Session Activity" },
  contact: { title: "Contact | Rajeev Jasti", label: "Contact" },
  ai: { title: "Ask my AI | Rajeev Jasti", label: "Ask my AI" },
};

const SITE_ORIGIN = "https://rjasti.com/";

/** True until the first user-driven navigation. */
let routeSyncedOnce = false;

/**
 * Point the title, the canonical link and og:url at the view now showing.
 *
 * `home` keeps the bare origin: the landing view IS the site root, and giving
 * it a "#home" canonical would split it from the URL every inbound link uses.
 */
function applyRouteMeta(target) {
  const meta = ROUTE_META[target];
  if (!meta) return;

  document.title = meta.title;

  const url = target === "home" ? SITE_ORIGIN : `${SITE_ORIGIN}#${target}`;
  const canonical = document.querySelector('link[rel="canonical"]');
  if (canonical) canonical.setAttribute("href", url);
  const ogUrl = document.querySelector('meta[property="og:url"]');
  if (ogUrl) ogUrl.setAttribute("content", url);
}

/**
 * Move focus into the new view and name it for a screen reader.
 *
 * Neither happened before: the router toggled classes and fired a
 * `section-changed` event nothing listened to, so activating a nav link
 * produced no announcement, no focus move and - with the title frozen - no
 * signal at all beyond `aria-current` on the link itself.
 *
 * Skipped on the first sync. That one runs during boot to render whatever the
 * hash asked for, and stealing focus there would drop the visitor past the
 * skip link before they had a chance to use it.
 */
function announceRoute(target) {
  if (!routeSyncedOnce) {
    routeSyncedOnce = true;
    return;
  }

  const section = sections?.find((candidate) => candidate.id === target);
  if (section && typeof section.focus === "function") {
    section.focus({ preventScroll: true });
  }

  const announcer = document.getElementById("route-announcer");
  const label = ROUTE_META[target]?.label;
  if (announcer && label) announcer.textContent = label;
}

export function setActiveSection(target) {
  if (!target || !window.AppLogic?.setActiveSection) return;
  clearBootTarget();
  window.AppLogic.setActiveSection(target, sections, navLinks);
  updateMobileNavActive(target);
  applyRouteMeta(target);
  announceRoute(target);
  window.dispatchEvent(new CustomEvent("section-changed", { detail: { target } }));
}

export function navigateToSection(target, { updateHash = true } = {}) {
  if (!target) return;
  closeTransientUi();
  setActiveSection(target);

  if (updateHash) {
    const nextHash = `#${target}`;
    if (window.location.hash !== nextHash) history.pushState(null, "", nextHash);
  }

  window.scrollTo({ top: 0, behavior: prefersReducedMotion.matches ? "auto" : "smooth" });
}

/**
 * Resolves a fragment to a section this router owns, for getValidHashTarget.
 *
 * Passing `getElementById` here answered a laxer question - "is there any
 * element with this id?" - and <main> itself has one. The skip link points at
 * #main-content, so following it and then reloading routed to a "section" that
 * is not one: setActiveSection deactivated all eight real ones and the page
 * went blank. Only the sections count, which is also the rule the pre-boot
 * router in index.html applies, and the two have to agree or a refresh lands
 * somewhere the first paint did not.
 */
function resolveSection(id) {
  return sections?.find((section) => section.id === id) ?? null;
}

export function syncSectionWithHash(hash = window.location.hash) {
  if (!window.AppLogic?.getValidHashTarget) return;
  // A fragment that names no section leaves the view where it is, because the
  // skip link is one: following it must move focus into <main>, not navigate
  // away from whatever the visitor was reading. On the first sync "where it is"
  // is the section the pre-boot router in index.html already chose - or home,
  // which is what the markup ships, and so the fallback for a stale bookmark.
  const current = sections?.find((section) => section.classList.contains("active"));
  const target = window.AppLogic.getValidHashTarget(hash, resolveSection, current?.id ?? "home");
  setActiveSection(target);
}

export function initNavigation() {
  hamburger = document.getElementById("hamburger-toggle");
  navMenu = document.getElementById("nav-menu");
  navLinks = Array.from(document.querySelectorAll("nav a[data-target]"));
  sections = Array.from(document.querySelectorAll("main section"));

  if (hamburger) {
    hamburger.addEventListener("click", (event) => {
      event.stopPropagation();
      const isCurrentlyOpen = navMenu?.classList.contains("show-menu");
      setMobileMenuState(!isCurrentlyOpen);
      if (!isCurrentlyOpen) {
        closeAllDropdowns();
      }
    });
  }

  const navMenuClose = document.getElementById("nav-menu-close");
  if (navMenuClose) {
    navMenuClose.addEventListener("click", (event) => {
      event.stopPropagation();
      setMobileMenuState(false);
      hamburger?.focus();
    });
  }

  const themeCustomizerClose = document.getElementById("theme-customizer-close");
  if (themeCustomizerClose) {
    themeCustomizerClose.addEventListener("click", (event) => {
      event.stopPropagation();
      closeAllDropdowns();
      document.getElementById("palette-toggle")?.focus();
    });
  }

  // Close menu when clicking on backdrop
  document.addEventListener("click", (event) => {
    if (navMenu?.classList.contains("show-menu")) {
      const isClickInsideMenu = navMenu.contains(event.target);
      const isClickOnHamburger = hamburger?.contains(event.target);

      if (!isClickInsideMenu && !isClickOnHamburger) {
        setMobileMenuState(false);
      }
    }
  });

  navLinks.forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      navigateToSection(link.dataset.target);
    });
  });

  document.querySelectorAll("a.nav-cta[data-target]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      navigateToSection(link.dataset.target);
    });
  });

  document.querySelectorAll(".logo-text[data-target], #logo-home-link").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      navigateToSection(link.dataset.target || "home");
    });
  });

  // Generic Dropdown Logic
  const dropdownToggles = document.querySelectorAll('.header-dropdown > button');
  dropdownToggles.forEach(toggle => {
    toggle.addEventListener('click', (event) => {
      event.stopPropagation();
      const dropdown = toggle.closest('.header-dropdown');
      const menu = dropdown.querySelector('.header-dropdown-menu');
      const isOpen = dropdown.classList.contains('is-open');

      closeAllDropdowns();
      setMobileMenuState(false);

      if (!isOpen) {
        dropdown.classList.add('is-open');
        toggle.setAttribute('aria-expanded', 'true');
        if (menu) menu.setAttribute('aria-hidden', 'false');
        document.body.classList.add('dropdown-open');

        // Move focus into the panel. Opening one used to leave focus on the
        // toggle, so a keyboard user had to Tab forward blindly and could not
        // tell the panel had opened at all. Escape already returns focus here.
        // rAF because the panel transitions from visibility:hidden and cannot
        // take focus until that has applied.
        if (menu) {
          requestAnimationFrame(() => {
            const target = menu.querySelector(
              'input:not([type="hidden"]):not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
            );
            target?.focus();
          });
        }
      }
    });
  });

  document.addEventListener("click", (event) => {
    const userDropdown = document.getElementById('nav-user-dropdown');
    const userBtn = document.getElementById('nav-user-btn');
    if (userDropdown && !userDropdown.contains(event.target) && (!userBtn || !userBtn.contains(event.target))) {
      userDropdown.classList.remove('show');
      userBtn?.setAttribute('aria-expanded', 'false');
    }

    let hasOpenDropdown = false;
    document.querySelectorAll('.header-dropdown.is-open').forEach(dropdown => {
      if (!dropdown.contains(event.target)) {
        dropdown.classList.remove('is-open');
        dropdown.querySelector('button')?.setAttribute('aria-expanded', 'false');
        dropdown.querySelector('.header-dropdown-menu')?.setAttribute('aria-hidden', 'true');
      } else {
        hasOpenDropdown = true;
      }
    });

    if (!hasOpenDropdown) {
      document.body.classList.remove('dropdown-open');
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      const openDropdown = document.querySelector('.header-dropdown.is-open');
      const openToggle = openDropdown?.querySelector('button');
      // `openToggle` is null when the thing that was open is the nav menu, so
      // Escape used to drop focus there. setMobileMenuState now returns it to
      // the hamburger itself; this only handles the dropdown case.
      closeTransientUi();
      openToggle?.focus();
      return;
    }

    // Trap Tab inside an open panel. The theme customiser in particular is a
    // whole form - presets, three colour buttons, a nested popover, Apply and
    // Reset - and Tab used to walk straight out of it into the page behind.
    if (event.key === "Tab") {
      // The mobile nav is scrim-backed and scroll-locked, so Tab leaving it
      // put focus on a page the visitor could neither see nor click.
      if (navMenu?.classList.contains("show-menu")) {
        handleFocusTrap(event, navMenu);
        return;
      }
      const openDropdown = document.querySelector('.header-dropdown.is-open');
      const menu = openDropdown?.querySelector('.header-dropdown-menu');
      if (menu) handleFocusTrap(event, menu);
    }
  });

  window.addEventListener("hashchange", () => syncSectionWithHash());
  window.addEventListener("popstate", () => syncSectionWithHash());

  if (typeof compactViewport.addEventListener === "function") {
    compactViewport.addEventListener("change", (event) => {
      if (!event.matches) setMobileMenuState(false);
    });
  }

  syncSectionWithHash();

  // The router is live from here, so the pre-boot `:target` guard in
  // styles.css - which hides #home while the markup still says it is the
  // active section - has to stop applying: pushState leaves :target stale in
  // some browsers, and a stale match would hide whatever the router activated
  // next. See the SECTION ROUTER region for the pair of rules.
  document.documentElement.classList.add("nav-ready");

  // Initialize mobile bottom navigation
  initMobileBottomNav();

  // Swipe navigation, phones only.
  //
  // Was gated on compactViewport (<=1150px), so horizontal swipes navigated
  // sections on 1024px laptops and tablets with trackpads. `mobileDevice` is
  // the query that actually means "phone" - coarse pointer AND <=768px - and
  // is what chat.js already uses for its drawer layout.
  //
  // Re-evaluated on change, too: this ran once at load, so rotating a tablet
  // into portrait never enabled it and rotating out never disabled it.
  let swipeGestures = null;
  const syncSwipeGestures = () => {
    if (mobileDevice.matches && !swipeGestures) {
      swipeGestures = initSwipeGestures();
    } else if (!mobileDevice.matches && swipeGestures) {
      swipeGestures.destroy();
      swipeGestures = null;
    }
  };
  syncSwipeGestures();
  mobileDevice.addEventListener("change", syncSwipeGestures);

  // Compact header on scroll
  const headerEl = document.getElementById("header");
  if (headerEl) {
    let scrollTicking = false;
    const onScroll = () => {
      if (!scrollTicking) {
        requestAnimationFrame(() => {
          headerEl.classList.toggle("scrolled", window.scrollY > 32);
          scrollTicking = false;
        });
        scrollTicking = true;
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  // Force scroll to top on initial load if landing on home or #about
  const currentHash = window.location.hash;
  if (!currentHash || currentHash === "#about") {
    window.scrollTo(0, 0);
  }

  // Offline indicator.
  //
  // Appended EMPTY. role="alert" fires when content enters the live region, so
  // building this with its text already in place meant the announcement was
  // spent at page load - before there was anything to announce - and the real
  // offline transition later said nothing. Styling lives in the
  // .offline-banner rule; it used to be an inline cssText with hardcoded
  // colours, which is why it ignored the theme.
  const offlineBanner = document.createElement('div');
  offlineBanner.className = 'offline-banner';
  offlineBanner.setAttribute('role', 'alert');
  document.body.appendChild(offlineBanner);

  function showOfflineBanner() {
    if (offlineBanner.dataset.shown === 'true') return;
    offlineBanner.dataset.shown = 'true';
    // is-visible first, then the text. The pill is visibility:hidden at rest
    // now, and a live region that is not visible has nothing to announce, so
    // the content has to land in a region that is already showing.
    offlineBanner.classList.add('is-visible');
    offlineBanner.innerHTML =
      '<i class="fas fa-wifi offline-banner__icon" aria-hidden="true"></i> You are offline';
  }

  function hideOfflineBanner() {
    if (offlineBanner.dataset.shown !== 'true') return;
    delete offlineBanner.dataset.shown;
    offlineBanner.classList.remove('is-visible');
    // Emptied on the way out so the next offline event is a fresh insertion
    // into the live region, and so announces again.
    offlineBanner.addEventListener(
      'transitionend',
      () => {
        if (offlineBanner.dataset.shown !== 'true') offlineBanner.replaceChildren();
      },
      { once: true }
    );
  }

  if (!isNetworkOnline()) {
    showOfflineBanner();
  }

  onOffline(showOfflineBanner);
  onOnline(hideOfflineBanner);

  // Feature 4: Keyboard shortcut hints on nav links
  const visibleNavLinks = navLinks.filter((link) => !link.hasAttribute("hidden") && link.style.display !== "none");

  if (supportsHover.matches) {
    visibleNavLinks.forEach((link, index) => {
      const kbd = document.createElement("kbd");
      kbd.className = "nav-shortcut";
      // BUG FIX ROOT CAUSE: Guide numbers inside kbd tag are announced by screen readers, creating audio noise
      // (e.g. "About one, link"). We set aria-hidden="true" so screen readers ignore the helper number.
      kbd.setAttribute("aria-hidden", "true");
      kbd.textContent = String(index + 1);
      link.appendChild(kbd);
    });
  }

  // Number key navigation
  document.addEventListener("keydown", (event) => {
    // A number pressed over an open dialog used to change the section behind
    // it: the modal stayed up, the body stayed scroll-locked, and closing it
    // later restored a scroll offset from a section the user had left.
    if (isModalOpen()) return;
    if (isTypingTarget(document.activeElement)) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    const num = parseInt(event.key, 10);
    if (num >= 1 && num <= visibleNavLinks.length) {
      event.preventDefault();
      const target = visibleNavLinks[num - 1]?.dataset.target;
      if (target) navigateToSection(target);
    }
  });

  // Feature: Keyboard overlay toggle
  const overlay = document.getElementById("keyboard-overlay");
  const closeBtn = document.getElementById("close-overlay-btn");

  if (overlay && closeBtn) {
    const toggleOverlay = () => {
      const isActive = overlay.classList.contains("active");
      if (isActive) {
        overlay.classList.remove("active");
        overlay.setAttribute("aria-hidden", "true");
      } else {
        overlay.classList.add("active");
        overlay.setAttribute("aria-hidden", "false");
      }
    };

    document.addEventListener("keydown", (event) => {
      if (isTypingTarget(document.activeElement)) return;
      // Opening the shortcut overlay on top of a dialog stacks two things
      // competing for Escape.
      if (isModalOpen() && !overlay.classList.contains("active")) return;

      if (event.key === "?" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        toggleOverlay();
      }

      if (event.key === "Escape" && overlay.classList.contains("active")) {
        event.preventDefault();
        toggleOverlay();
      }
    });

    closeBtn.addEventListener("click", toggleOverlay);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) toggleOverlay();
    });
  }
}

/**
 * True when the stylesheet says the bottom bar is switched on.
 *
 * The bar was built and appended on every load while `.mobile-bottom-nav` was
 * `display: none` at every width, so the JS and the CSS disagreed about
 * whether a whole navigation surface existed - and the comment below still
 * described it as the phone's primary navigation. The `--mobile-bottom-nav`
 * flag in the DESIGN TOKENS region is now the one switch both read.
 */
function bottomNavEnabled() {
  if (typeof getComputedStyle !== "function") return false;
  const flag = getComputedStyle(document.documentElement)
    .getPropertyValue("--mobile-bottom-nav")
    .trim();
  return flag === "1";
}

function initMobileBottomNav() {
  if (!bottomNavEnabled()) return;

  // Create mobile bottom navigation
  const mobileNav = document.createElement('nav');
  mobileNav.className = 'mobile-bottom-nav';
  mobileNav.setAttribute('aria-label', 'Mobile navigation');

  // Every section a visitor can reach, with the same icon, label, and order as
  // the header nav - the About entry read "Home" behind a house icon here while
  // the header called it "About" behind a person, so the two bars disagreed
  // about what the first section was.
  //
  // NOTE: this bar is currently switched off (see bottomNavEnabled above); the
  // centred hamburger is the phone navigation. The list is kept complete so
  // that turning the flag back on restores a bar that already agrees with the
  // header nav rather than one missing half its sections, which is what it
  // used to be.
  //
  // Eight entries since Apps joined the header nav. At 320px, the narrowest
  // width still worth supporting, `flex: 1 1 0` divides the bar into 40px
  // columns - 36px of content box once padding is taken, and too narrow for
  // "Activity" at the default label size. The <=380px block in the MOBILE
  // BOTTOM NAV region drops the label ramp to fit. That block is now sized for
  // eight and has no headroom left: a ninth entry needs an overflow affordance,
  // not a further shrink.
  //
  // Portfolio is deliberately absent: its nav link is still `hidden` pending
  // the decision recorded as BUG-02.
  const navItems = [
    { target: 'home', icon: 'fa-home', label: 'Home' },
    { target: 'about', icon: 'fa-user', label: 'About' },
    { target: 'resume', icon: 'fa-briefcase', label: 'Experience' },
    { target: 'hobbies', icon: 'fa-heart', label: 'Hobbies' },
    { target: 'apps', icon: 'fa-cubes', label: 'Apps' },
    { target: 'activity', icon: 'fa-chart-line', label: 'Activity' },
    { target: 'ai', icon: 'fa-robot', label: 'AI' },
    { target: 'contact', icon: 'fa-envelope', label: 'Contact' }
  ];

  navItems.forEach(item => {
    const link = document.createElement('a');
    link.href = `#${item.target}`;
    link.dataset.target = item.target;
    link.innerHTML = `
      <i class="fas ${item.icon}"></i>
      <span class="mobile-bottom-nav-label">${item.label}</span>
    `;

    link.addEventListener('click', (e) => {
      e.preventDefault();
      navigateToSection(item.target);
      updateMobileNavActive(item.target);
    });

    mobileNav.appendChild(link);
  });

  document.body.appendChild(mobileNav);

  // Set initial active state
  const currentSection = document.querySelector('main section.active')?.id || 'home';
  updateMobileNavActive(currentSection);
}

function updateMobileNavActive(target) {
  const mobileNav = document.querySelector('.mobile-bottom-nav');
  if (!mobileNav) return;

  mobileNav.querySelectorAll('a').forEach(link => {
    const isActive = link.dataset.target === target;
    link.classList.toggle('active', isActive);

    // This bar is the whole navigation on a phone, and the current section was
    // signalled only by colour and a 3px rule - nothing a screen reader could
    // read. The header nav has carried aria-current since app-logic.js:13; the
    // bar is built after initNavigation() captures `navLinks`, so it is not in
    // that list and has to set it here.
    if (isActive) {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  });
}

function initSwipeGestures() {
  const sectionOrder = ['home', 'about', 'resume', 'hobbies', 'apps', 'activity', 'ai', 'contact'];

  // Returned so the caller can tear it down when the viewport stops being a
  // phone; the handler binds to document, so leaving it attached would keep
  // navigating sections on a resized desktop window.
  return new SwipeHandler({
    threshold: 75,
    onSwipeLeft: () => {
      const currentSection = document.querySelector('main section.active')?.id;
      const currentIndex = sectionOrder.indexOf(currentSection);
      if (currentIndex !== -1 && currentIndex < sectionOrder.length - 1) {
        const nextSection = sectionOrder[currentIndex + 1];
        navigateToSection(nextSection);
        updateMobileNavActive(nextSection);
      }
    },
    onSwipeRight: () => {
      const currentSection = document.querySelector('main section.active')?.id;
      const currentIndex = sectionOrder.indexOf(currentSection);
      if (currentIndex > 0) {
        const prevSection = sectionOrder[currentIndex - 1];
        navigateToSection(prevSection);
        updateMobileNavActive(prevSection);
      }
    }
  });
}
