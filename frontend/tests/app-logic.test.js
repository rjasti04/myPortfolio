import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import "../js/app-logic.js";

const {
  getValidHashTarget,
  setActiveSection,
} = globalThis.AppLogic;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("setActiveSection updates active section and nav aria-current", () => {
  const dom = new JSDOM(`
    <main>
      <section id="about"></section>
      <section id="resume"></section>
    </main>
    <nav>
      <a data-target="about"></a>
      <a data-target="resume"></a>
    </nav>
  `);

  const sections = dom.window.document.querySelectorAll("main section");
  const navLinks = dom.window.document.querySelectorAll("nav a");

  setActiveSection("resume", sections, navLinks);

  assert.equal(dom.window.document.getElementById("resume").classList.contains("active"), true);
  assert.equal(dom.window.document.getElementById("about").classList.contains("active"), false);
  assert.equal(navLinks[1].classList.contains("active"), true);
  assert.equal(navLinks[1].getAttribute("aria-current"), "page");
  assert.equal(navLinks[0].classList.contains("active"), false);
  assert.equal(navLinks[0].hasAttribute("aria-current"), false);
});

test("getValidHashTarget returns matching section id", () => {
  const dom = new JSDOM(`<section id="about"></section><section id="contact"></section>`);
  const getById = (id) => dom.window.document.getElementById(id);

  assert.equal(getValidHashTarget("#contact", getById), "contact");
});

test("getValidHashTarget falls back for unknown hash", () => {
  const dom = new JSDOM(`<section id="about"></section>`);
  const getById = (id) => dom.window.document.getElementById(id);

  assert.equal(getValidHashTarget("#missing", getById), "about");
  assert.equal(getValidHashTarget("", getById), "about");
});

test("main lazily imports the activity module", () => {
  const mainSource = fs.readFileSync(path.join(__dirname, "../js/main.js"), "utf8");

  assert.equal(mainSource.includes('from "./activity.js"'), false);
  assert.equal(mainSource.includes('import("./activity.js")'), true);
  assert.equal(mainSource.includes("loadActivityModule"), true);
});
