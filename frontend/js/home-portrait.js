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

// Which face the card RESTS on, which is not the same face at every width.
// Above 900px the stylesheet trades the two faces over - the studio shot is
// the one in flow there and the outdoor shot is what the turn brings round -
// so `aria-pressed="true"` means the opposite photograph on either side of
// this line. See "Above 900px the card rests on the STUDIO face" in
// styles.css, which owns the swap; this is the same boundary, and the one
// number the two files have to agree on.
//
// Read live rather than once at startup: a laptop crossing 900px by being
// resized, or a tablet rotated, moves the rest face under a card whose
// `aria-pressed` has not changed, and the next announcement has to follow the
// layout rather than whatever was true when the module ran.
const STUDIO_LEADS = window.matchMedia("(width >= 901px)");

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
  //
  // Above 900px that image IS the LCP and index.html preloads it, so this is a
  // no-op there: `complete` is already true by the time anyone can hover. The
  // check is what makes it one - there is no width test to add here.
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
    // truth and no class to fall out of step with it. It means "turned from
    // rest", though, not "showing the back" - which is why the announcement
    // below resolves it against the rest face instead of reading it straight.
    const turned = flipButton.getAttribute("aria-pressed") !== "true";
    flipButton.setAttribute("aria-pressed", String(turned));

    if (status) {
      const showingBack = turned !== STUDIO_LEADS.matches;
      status.textContent = showingBack
        ? FACE_ANNOUNCEMENTS.back
        : FACE_ANNOUNCEMENTS.front;
    }
  });
}
