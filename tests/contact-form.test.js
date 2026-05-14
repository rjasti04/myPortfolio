const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");

let dom;
let window;
let document;
let initContactForm;

function createContactMarkup() {
  return `
    <div id="toast-container"></div>
    <button type="button" class="contact-method-card copy-btn" id="copy-email-btn">
      <span class="contact-method-value">Click to copy</span>
    </button>
    <form class="contact-form premium-form" id="contact-form">
      <input type="hidden" name="_subject" value="New portfolio message from rjasti.com" />
      <input type="text" name="_honey" style="display:none" tabindex="-1" autocomplete="off" />
      <div class="form-group floating-label-group">
        <div class="input-wrapper">
          <input type="text" id="contact-name" name="name" placeholder=" " required />
          <label class="form-label" for="contact-name">Name</label>
        </div>
      </div>
      <div class="form-group floating-label-group">
        <div class="input-wrapper">
          <input type="email" id="contact-email" name="email" placeholder=" " required />
          <label class="form-label" for="contact-email">Email</label>
        </div>
      </div>
      <div class="form-group floating-label-group">
        <div class="input-wrapper">
          <textarea id="contact-message" name="message" placeholder=" " required></textarea>
          <label class="form-label" for="contact-message">Message</label>
        </div>
      </div>
      <button type="submit" class="btn contact-submit-btn">Send Message <i class="fas fa-paper-plane"></i></button>
      <p id="contact-status" class="form-status" role="status" aria-live="polite"></p>
    </form>
  `;
}

function resetContactDom() {
  document.body.innerHTML = createContactMarkup();
  const form = document.getElementById("contact-form");
  form.reportValidity = () => true;
  return form;
}

function fillValidContactForm() {
  document.getElementById("contact-name").value = "Rajeev Jasti";
  document.getElementById("contact-email").value = "rajeev@example.com";
  document.getElementById("contact-message").value = "Hello from a test.";
}

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test.before(async () => {
  dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://rjasti.com/#contact",
    pretendToBeVisual: true,
  });
  window = dom.window;
  document = window.document;

  window.matchMedia = () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  });
  window.requestAnimationFrame = () => 0;
  window.setTimeout = () => 0;
  window.HTMLCanvasElement.prototype.getContext = () => ({
    clearRect() {},
    save() {},
    translate() {},
    rotate() {},
    fillRect() {},
    restore() {},
    set fillStyle(value) {},
    set globalAlpha(value) {},
  });

  global.window = window;
  global.document = document;
  global.localStorage = window.localStorage;
  global.sessionStorage = window.sessionStorage;
  global.requestAnimationFrame = window.requestAnimationFrame;
  global.HTMLCanvasElement = window.HTMLCanvasElement;
  Object.defineProperty(global, "navigator", {
    configurable: true,
    value: window.navigator,
  });

  ({ initContactForm } = await import("../js/form.js"));
});

test.after(() => {
  delete global.window;
  delete global.document;
  delete global.localStorage;
  delete global.sessionStorage;
  delete global.requestAnimationFrame;
  delete global.HTMLCanvasElement;
  delete global.navigator;
});

test.afterEach(() => {
  window.dispatchEvent(new window.Event("online"));
  delete global.fetch;
  delete window.fetch;
});

test("contact form shows accessible invalid-field feedback", () => {
  resetContactDom();
  initContactForm();

  const email = document.getElementById("contact-email");
  email.value = "not-an-email";
  email.dispatchEvent(new window.Event("blur", { bubbles: true }));

  const error = document.getElementById("contact-email-error");
  assert.equal(email.getAttribute("aria-invalid"), "true");
  assert.equal(email.getAttribute("aria-describedby"), "contact-email-error");
  assert.equal(error.dataset.active, "true");
  assert.ok(error.textContent.length > 0);
});

test("contact form ignores FormSubmit honeypot during validation setup", () => {
  const form = resetContactDom();
  initContactForm();

  const honeypot = form.querySelector('input[name="_honey"]');
  assert.equal(document.getElementById("-error"), null);
  assert.equal(honeypot.getAttribute("aria-describedby"), null);
  assert.equal(form.querySelectorAll(".form-error-message").length, 3);
});

test("contact form blocks ajax submission while offline", async () => {
  const form = resetContactDom();
  fillValidContactForm();
  let fetchCalled = false;
  window.fetch = global.fetch = async () => {
    fetchCalled = true;
    return { ok: true };
  };
  initContactForm();

  window.dispatchEvent(new window.Event("offline"));
  form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await flushPromises();

  const status = document.getElementById("contact-status");
  const submitBtn = form.querySelector('button[type="submit"]');
  assert.equal(fetchCalled, false);
  assert.equal(status.dataset.state, "error");
  assert.match(status.textContent, /offline/i);
  assert.equal(submitBtn.disabled, false);
  assert.equal(form.hasAttribute("aria-busy"), false);
});

test("contact form exposes loading state and resets after successful ajax submission", async () => {
  const form = resetContactDom();
  fillValidContactForm();

  let resolveFetch;
  window.fetch = global.fetch = () => new Promise((resolve) => {
    resolveFetch = () => resolve({ ok: true });
  });
  initContactForm();

  form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await flushPromises();

  const submitBtn = form.querySelector('button[type="submit"]');
  assert.equal(submitBtn.disabled, true);
  assert.equal(form.getAttribute("aria-busy"), "");
  assert.match(submitBtn.textContent, /Sending/i);

  resolveFetch();
  await flushPromises();

  const status = document.getElementById("contact-status");
  assert.equal(status.dataset.state, "success");
  assert.equal(document.getElementById("contact-name").value, "");
  assert.equal(document.getElementById("contact-email").value, "");
  assert.equal(document.getElementById("contact-message").value, "");
  assert.equal(submitBtn.disabled, false);
  assert.equal(form.hasAttribute("aria-busy"), false);
});
