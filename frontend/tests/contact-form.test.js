import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

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
          <textarea id="contact-message" name="message" placeholder=" "
            aria-describedby="contact-message-count" required></textarea>
          <label class="form-label" for="contact-message">Message</label>
        </div>
        <p class="form-counter" id="contact-message-count" data-max="1200">0 / 1200</p>
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
  global.HTMLElement = window.HTMLElement;
  global.getComputedStyle = window.getComputedStyle.bind(window);
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
  delete global.HTMLElement;
  delete global.getComputedStyle;
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

// Regression: showFieldError assigned the error id straight over
// aria-describedby and clearFieldError removed the attribute outright, so the
// first validation error permanently detached the character counter from the
// only field that has one.
test("contact form keeps the counter description through a validation error", () => {
  resetContactDom();
  initContactForm();

  const message = document.getElementById("contact-message");
  message.value = "";
  message.dispatchEvent(new window.Event("blur", { bubbles: true }));

  const described = (message.getAttribute("aria-describedby") || "").split(/\s+/);
  assert.ok(described.includes("contact-message-count"), "counter stays described");
  assert.ok(described.includes("contact-message-error"), "error is announced too");

  message.value = "Hello there.";
  message.dispatchEvent(new window.Event("input", { bubbles: true }));
  message.dispatchEvent(new window.Event("blur", { bubbles: true }));

  const after = (message.getAttribute("aria-describedby") || "").split(/\s+/);
  assert.ok(after.includes("contact-message-count"), "counter survives the clear");
  assert.ok(!after.includes("contact-message-error"), "error id is dropped");
});

// Regression: blur validation was gated on `field.value`, so an untouched
// required field produced no inline error - the most common mistake was the
// one with no feedback.
test("contact form reports an empty required field on blur", () => {
  resetContactDom();
  initContactForm();

  const name = document.getElementById("contact-name");
  name.value = "";
  name.dispatchEvent(new window.Event("blur", { bubbles: true }));

  assert.equal(name.getAttribute("aria-invalid"), "true");
  assert.equal(document.getElementById("contact-name-error").dataset.active, "true");
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

// Regression: the honeypot is in the markup and rides a native form POST, but
// the AJAX payload is hand-built and used to drop it - so on the path virtually
// every submission takes, FormSubmit never saw it.
test("contact form forwards the honeypot in the ajax payload", async () => {
  const form = resetContactDom();
  fillValidContactForm();
  let body = null;
  window.fetch = global.fetch = async (_url, options) => {
    body = JSON.parse(options.body);
    return { ok: true };
  };
  initContactForm();
  form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await flushPromises();

  assert.ok(body, "the ajax request must have been made");
  assert.ok("_honey" in body, "FormSubmit cannot apply a honeypot it is not sent");
});

// Regression: aborting cancels the browser's wait, not the POST already in
// flight. Falling through to a native submit delivered slow-but-successful
// messages twice.
test("contact form does not resubmit natively when the request times out", async () => {
  const form = resetContactDom();
  fillValidContactForm();

  let fetchCalls = 0;
  window.fetch = global.fetch = async () => {
    fetchCalls += 1;
    const err = new Error("aborted");
    err.name = "AbortError";
    throw err;
  };
  let nativeSubmits = 0;
  form.submit = () => {
    nativeSubmits += 1;
  };

  initContactForm();
  form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await flushPromises();

  assert.equal(fetchCalls, 1);
  assert.equal(nativeSubmits, 0, "a timeout must not send the message a second time");

  const status = document.getElementById("contact-status");
  assert.equal(status.dataset.state, "error");
  assert.match(status.textContent, /may still have arrived/i);
});
