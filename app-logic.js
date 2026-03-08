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
    const target = (hash || "").replace(/^#/, "").trim();

    if (target && getElementById(target)) {
      return target;
    }

    return fallback;
  }

  const exportsObject = { setActiveSection, getValidHashTarget };

  globalObject.AppLogic = exportsObject;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = exportsObject;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
