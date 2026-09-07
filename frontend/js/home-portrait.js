// The landing portrait is a two-sided card. Clicking it rotates the studio
// shot that used to be the only portrait into view; clicking again turns it
// back. Everything about the turn itself is CSS - this module owns the state
// bit and the two things CSS cannot do: enabling a control that must not exist
// without JS, and saying out loud what changed.

// What #home-portrait-status announces after each flip. The two faces are both
// `alt=""` in the markup, because neither photograph carries information the
// name beside it does not, so this is the only place a screen reader is told
// that anything happened at all. Same pattern as the theme shuffle's status
// line two columns over.
const FACE_ANNOUNCEMENTS = {
  front: "Showing the outdoor photo.",
  back: "Showing the studio photo.",
};

export function initHomePortrait() {
  const flipButton = document.getElementById("home-portrait-flip");
  if (!flipButton) return;

  const status = document.getElementById("home-portrait-status");
  const backImage = flipButton.querySelector(".home-portrait-face--back img");

  // The markup ships this button `disabled`, so a page without JS never offers
  // a control that cannot work - it is not focusable and screen readers do not
  // announce it as actionable. This line is the whole of the upgrade.
  flipButton.disabled = false;

  // The back face is `fetchpriority="low"` so it queues behind the LCP, which
  // is right until someone actually reaches for it. The first hover or focus
  // is the earliest honest signal that a click is coming, and re-prioritising
  // there is the difference between a turn that lands on a photograph and one
  // that lands on nothing. Costs a property write, and only if the image has
  // not already arrived on its own.
  let warmed = false;
  const warmBackFace = () => {
    if (warmed) return;
    warmed = true;
    if (backImage && !backImage.complete) backImage.fetchPriority = "high";
  };

  flipButton.addEventListener("pointerenter", warmBackFace, { once: true });
  flipButton.addEventListener("focus", warmBackFace, { once: true });

  flipButton.addEventListener("click", () => {
    warmBackFace();

    // `aria-pressed` is the state, not a mirror of it: the CSS selector that
    // rotates the card reads this same attribute, so there is one source of
    // truth and no class to fall out of step with it.
    const showingBack = flipButton.getAttribute("aria-pressed") !== "true";
    flipButton.setAttribute("aria-pressed", String(showingBack));

    if (status) {
      status.textContent = showingBack
        ? FACE_ANNOUNCEMENTS.back
        : FACE_ANNOUNCEMENTS.front;
    }
  });
}
