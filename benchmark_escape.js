const { performance } = require('perf_hooks');
const jsdom = require("jsdom");
const { JSDOM } = jsdom;
const dom = new JSDOM(`<!DOCTYPE html><p>Hello world</p>`);
const document = dom.window.document;

function escapeHTML_DOM(value) {
  const div = document.createElement("div");
  div.textContent = String(value);
  return div.innerHTML;
}

const entityMap = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '/': '&#x2F;',
  '`': '&#x60;',
  '=': '&#x3D;'
};

function escapeHTML_Regex(value) {
  return String(value).replace(/[&<>"'`=\/]/g, function (s) {
    return entityMap[s];
  });
}

const testStr = 'Hello <script>alert("world & friends"); </script>';

const N = 10000;

let start = performance.now();
for (let i = 0; i < N; i++) {
  escapeHTML_DOM(testStr);
}
let domTime = performance.now() - start;

start = performance.now();
for (let i = 0; i < N; i++) {
  escapeHTML_Regex(testStr);
}
let regexTime = performance.now() - start;

console.log(`DOM Time: ${domTime}ms`);
console.log(`Regex Time: ${regexTime}ms`);
console.log(`Improvement: ${(domTime / regexTime).toFixed(2)}x`);
