import { openModal, closeModal } from "./modal.js";

const hideTimeouts = new WeakMap();

let projectDetailModal, projectDetailClose, projectDetailIcon, projectDetailTitle, projectDetailDescription, projectDetailStack, projectDetailOutcomes;

export function fillProjectDetails(card) {
  if (!card) return;
  const icon = card.dataset.icon || "fas fa-code";
  const title = card.dataset.title || "";
  const description = card.dataset.description || "";
  const stack = (card.dataset.stack || "").split(",").map(v => v.trim()).filter(Boolean);
  const outcomes = (card.dataset.outcomes || "").split("|").map(v => v.trim()).filter(Boolean);

  if (projectDetailIcon) {
    const iconElement = document.createElement("i");
    iconElement.className = icon;
    projectDetailIcon.replaceChildren(iconElement);
  }
  if (projectDetailTitle) projectDetailTitle.textContent = title;
  if (projectDetailDescription) projectDetailDescription.textContent = description;
  if (projectDetailStack) {
    projectDetailStack.replaceChildren(...stack.map(item => {
      const tag = document.createElement("span"); tag.className = "detail-tag"; tag.textContent = item; return tag;
    }));
  }
  if (projectDetailOutcomes) {
    projectDetailOutcomes.replaceChildren(...outcomes.map(outcome => {
      const li = document.createElement("li"); li.textContent = outcome; return li;
    }));
  }
}

export function filterProjects() {
  const projectCards = Array.from(document.querySelectorAll(".project-card"));
  const projectFilters = Array.from(document.querySelectorAll(".project-filter"));
  const projectSearchInput = document.getElementById("project-search");
  const projectResults = document.getElementById("project-results");
  
  // Restore saved filter state
  let activeFilter = localStorage.getItem('rj_project_filter') || "all";
  
  // Set initial active filter button
  projectFilters.forEach(button => {
    const isActive = button.dataset.filter === activeFilter;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });

  const syncVisibleCards = () => {
    const projects = projectCards.map(card => ({
      card, description: card.dataset.description || "", tags: card.dataset.tags || "", title: card.dataset.title || "",
    }));

    const filteredProjects = window.AppLogic?.filterProjects 
      ? window.AppLogic.filterProjects(projects, activeFilter, projectSearchInput?.value || "")
      : projects.map(p => ({ ...p, visible: activeFilter === 'all' || p.tags.includes(activeFilter) }));

    const visibleCount = filteredProjects.reduce((count, project) => {
      if (project.visible) {
        project.card.hidden = false;
        requestAnimationFrame(() => project.card.classList.remove("fade-out"));
      } else {
        project.card.classList.add("fade-out");
        clearTimeout(hideTimeouts.get(project.card));
        hideTimeouts.set(project.card, setTimeout(() => {
          if (project.card.classList.contains("fade-out")) project.card.hidden = true;
        }, 400));
      }
      return count + (project.visible ? 1 : 0);
    }, 0);

    if (projectResults) {
      if (visibleCount === 0) {
        projectResults.textContent = "No projects found. Try a different search or filter.";
        projectResults.dataset.empty = "true";
      } else {
        projectResults.textContent = `${visibleCount} project${visibleCount === 1 ? "" : "s"} shown`;
        delete projectResults.dataset.empty;
      }
    }
  };

  projectFilters.forEach(button => {
    button.addEventListener("click", () => {
      activeFilter = button.dataset.filter || "all";
      
      // Save filter state
      localStorage.setItem('rj_project_filter', activeFilter);
      
      projectFilters.forEach((fb) => {
        const isActive = fb === button;
        fb.classList.toggle("active", isActive);
        fb.setAttribute("aria-pressed", String(isActive));
      });
      syncVisibleCards();
    });
  });

  let searchTimeout;
  projectSearchInput?.addEventListener("input", () => {
    clearTimeout(searchTimeout);
    // Show loading state
    if (projectResults) {
      projectResults.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Filtering...';
    }
    searchTimeout = setTimeout(syncVisibleCards, 150);
  });
  
  // Initial sync
  syncVisibleCards();
}

export function initProjects() {
  projectDetailModal = document.getElementById("project-detail-modal");
  projectDetailClose = document.getElementById("project-detail-close");
  projectDetailIcon = document.getElementById("project-detail-icon");
  projectDetailTitle = document.getElementById("project-detail-title");
  projectDetailDescription = document.getElementById("project-detail-description");
  projectDetailStack = document.getElementById("project-detail-stack");
  projectDetailOutcomes = document.getElementById("project-detail-outcomes");

  document.querySelectorAll(".project-details-btn").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      fillProjectDetails(button.closest(".project-card"));
      openModal(projectDetailModal, { initialFocus: projectDetailClose || projectDetailModal });
    });
  });

  projectDetailClose?.addEventListener("click", () => closeModal(projectDetailModal));
  projectDetailModal?.addEventListener("click", (event) => {
    if (event.target === projectDetailModal) closeModal(projectDetailModal);
  });
  
  filterProjects();
}
