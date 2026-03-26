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

  function filterProjects(projects, activeFilter = "all", searchTerm = "") {
    const normalizedFilter = (activeFilter || "all").toLowerCase();
    const normalizedSearch = (searchTerm || "").trim().toLowerCase();

    return projects.map((project) => {
      const tags = (project.tags || "").toLowerCase();
      const title = (project.title || "").toLowerCase();
      const description = (project.description || "").toLowerCase();
      const passesFilter = normalizedFilter === "all" || tags.includes(normalizedFilter);
      const passesSearch = !normalizedSearch
        || tags.includes(normalizedSearch)
        || title.includes(normalizedSearch)
        || description.includes(normalizedSearch);

      return { ...project, visible: passesFilter && passesSearch };
    });
  }

  function getShortcutLabel({ userAgent = "", platform = "" } = {}) {
    const isMacPlatform = platform === "macOS" || /Mac|iPhone|iPad|iPod/.test(userAgent);
    return isMacPlatform ? "Cmd+K" : "Ctrl+K";
  }

  const exportsObject = {
    filterProjects,
    getShortcutLabel,
    getValidHashTarget,
    setActiveSection,
  };

  globalObject.AppLogic = exportsObject;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = exportsObject;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
