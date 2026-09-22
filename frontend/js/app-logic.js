(function attachAppLogic(globalObject) {
  function setActiveSection(target, sections, navLinks) {
    if (!target) return;

    sections.forEach((section) => {
      section.classList.toggle("active", section.id === target);
    });

    navLinks.forEach((link) => {
      const isActive = link.dataset.target === target;
      link.classList.toggle("active", isActive);

      if (isActive) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    });
  }

  function getValidHashTarget(hash, getElementById, fallback = "about") {
    // Only the first segment names a section. Anything after a slash is state
    // for a module inside it - "#apps/dev-tools" is the apps section with the
    // Dev Tools filter applied - and no section id contains a slash, so this
    // cannot swallow a real target.
    const target = (hash || "").replace(/^#/, "").split("/")[0].trim();

    if (target && getElementById(target)) {
      return target;
    }

    return fallback;
  }

  const exportsObject = {
    getValidHashTarget,
    setActiveSection,
  };

  globalObject.AppLogic = exportsObject;

  // CJS export for Node.js test runner (node --test). Remove if migrating to ESM tests.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = exportsObject;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
