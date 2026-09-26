import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

describe("Technical skill tags staggered entrance animation", () => {
  it("styles.css defines the staggered entrance rules for #about skill tags", () => {
    const css = read("styles.css");
    assert.match(
      css,
      /\.reveals-armed\s+#about\s+\.skill-tags:not\(\.tags-revealed\)\s+\.skill-tag/,
      "missing hidden initial state rule under .reveals-armed"
    );
    assert.match(
      css,
      /\.reveals-armed\s+#about\s+\.skill-tags\.tags-revealed\s+\.skill-tag/,
      "missing revealed state rule"
    );
    assert.match(
      css,
      /--tag-delay/,
      "missing --tag-delay reference in styles.css"
    );
  });

  it("index.html contains skill-tags and skill-tag items inside #about", () => {
    const html = read("index.html");
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    const aboutSection = doc.getElementById("about");
    assert.ok(aboutSection, "no #about section found");

    const containers = aboutSection.querySelectorAll(".skill-tags");
    assert.ok(containers.length >= 6, "expected at least 6 skill-tags groups in #about");

    const totalTags = aboutSection.querySelectorAll(".skill-tags .skill-tag");
    assert.ok(totalTags.length >= 40, "expected multiple skill tags in #about");
  });

  it("animations.js defines staggered entrance timing constants and tags observer", () => {
    const js = read("js/animations.js");
    assert.match(js, /SKILL_TAG_BASE_DELAY_MS/, "missing SKILL_TAG_BASE_DELAY_MS");
    assert.match(js, /SKILL_TAG_STAGGER_MS/, "missing SKILL_TAG_STAGGER_MS");
    assert.match(js, /tags-revealed/, "missing tags-revealed class assignment in animations.js");
    assert.match(js, /--tag-delay/, "missing --tag-delay property setting in animations.js");
  });

  it("reduced-motion media query includes #about .skill-tag override", () => {
    const css = read("styles.css");
    assert.match(
      css,
      /@media[^{]*prefers-reduced-motion[^{]*\{[\s\S]*?\.reveals-armed\s+#about\s+\.skill-tag/
    );
  });

  it("styles.css defines interactive hover effects on .skill-tag", () => {
    const css = read("styles.css");
    assert.match(
      css,
      /\.skill-tag:hover\s*\{[^}]*scale\(/,
      "expected scale transform on .skill-tag:hover"
    );
    assert.match(
      css,
      /\.skill-tag:hover\s*\{[^}]*border-color:/,
      "expected border-color shift on .skill-tag:hover"
    );
    assert.match(
      css,
      /\.skill-tag:hover\s*\{[^}]*box-shadow:/,
      "expected box-shadow glow on .skill-tag:hover"
    );
  });
});
