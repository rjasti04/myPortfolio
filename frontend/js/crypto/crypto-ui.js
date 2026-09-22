/**
 * Crypto UI Controller
 *
 * Manages DOM interactions, event listeners, live input handling,
 * drag-and-drop file encoding, copy-to-clipboard feedback, and state wiping.
 */

import {
  encodeBase64,
  decodeBase64,
  fileToBase64DataUri,
  encodeUrl,
  decodeUrl,
  textToHex,
  hexToText,
  encodeHtmlEntities,
  decodeHtmlEntities,
  textToBinary,
  binaryToText,
} from "./encoders.js";

import { computeAllHashes, computeHmac } from "./hasher.js";

import { decodeJwt } from "./jwt.js";

import {
  generateUuidV4,
  generateUuidV7,
  extractTimestampFromUuidV7,
  generateSecureToken,
  generateBatch,
} from "./generators.js";

import {
  getLiveClock,
  epochToDetails,
  parseDateInput,
} from "./time-workbench.js";

/**
 * Initializes DOM interactions across all crypto workbench panels.
 * @param {object} [options]
 * @returns {object} Public controls
 */
export function initCryptoUI() {
  setupCopyButtons();
  setupEncodersUI();
  setupHasherUI();
  setupJwtUI();
  setupGeneratorsUI();
  setupTimeUI();
  setupPrivacyClear();
}

/**
 * Copies text to clipboard and provides visual feedback on the button.
 * @param {string} text
 * @param {HTMLElement} btn
 */
export async function copyWithFeedback(text, btn) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback for older environments
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }

  if (btn) {
    const originalHtml = btn.innerHTML;
    btn.classList.add("copied");
    btn.innerHTML = '<i class="fas fa-check" aria-hidden="true"></i> Copied!';
    setTimeout(() => {
      btn.classList.remove("copied");
      btn.innerHTML = originalHtml;
    }, 1600);
  }
}

/**
 * Global delegate for [data-copy-target] buttons.
 */
function setupCopyButtons() {
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-copy-target]");
    if (!btn) return;
    const targetId = btn.getAttribute("data-copy-target");
    const targetEl = document.getElementById(targetId);
    if (targetEl) {
      const text = targetEl.value !== undefined ? targetEl.value : targetEl.textContent;
      copyWithFeedback(text.trim(), btn);
    }
  });
}

/**
 * Encoders & Decoders Panel UI
 */
function setupEncodersUI() {
  const inputEl = document.getElementById("encoder-input");
  const outputEl = document.getElementById("encoder-output");
  const formatSelect = document.getElementById("encoder-format");
  const encodeBtn = document.getElementById("encoder-encode-btn");
  const decodeBtn = document.getElementById("encoder-decode-btn");
  const swapBtn = document.getElementById("encoder-swap-btn");
  const clearBtn = document.getElementById("encoder-clear-btn");
  const dropZone = document.getElementById("file-dropzone");
  const dropZoneWrap = document.getElementById("file-dropzone-wrap");
  const fileInput = document.getElementById("file-input");
  const fileInfo = document.getElementById("file-info");
  const hexSpacedCheckbox = document.getElementById("hex-spaced-toggle");
  const hexOptionWrap = document.getElementById("hex-option-wrap");

  if (!inputEl || !outputEl) return;

  // The transform direction is a mode, not a one-shot command. It used to be
  // neither: typing always re-ran runTransform(true), so editing the input
  // after pressing Decode silently flipped you back to encoding.
  let isEncoding = true;

  function setDirection(nextIsEncoding) {
    isEncoding = nextIsEncoding;
    encodeBtn?.classList.toggle("active", isEncoding);
    encodeBtn?.setAttribute("aria-pressed", String(isEncoding));
    decodeBtn?.classList.toggle("active", !isEncoding);
    decodeBtn?.setAttribute("aria-pressed", String(!isEncoding));
    if (outputEl) {
      outputEl.placeholder = isEncoding
        ? "Encoded output will appear here..."
        : "Decoded output will appear here...";
    }
  }

  function runTransform(isEncode) {
    const text = inputEl.value;
    const format = formatSelect.value;
    try {
      let result = "";
      if (format === "base64") {
        result = isEncode ? encodeBase64(text) : decodeBase64(text);
      } else if (format === "url") {
        result = isEncode ? encodeUrl(text) : decodeUrl(text);
      } else if (format === "hex") {
        const delimiter = hexSpacedCheckbox && hexSpacedCheckbox.checked ? " " : "";
        result = isEncode ? textToHex(text, delimiter) : hexToText(text);
      } else if (format === "html") {
        result = isEncode ? encodeHtmlEntities(text) : decodeHtmlEntities(text);
      } else if (format === "binary") {
        result = isEncode ? textToBinary(text) : binaryToText(text);
      }
      outputEl.value = result;
      outputEl.classList.remove("has-error");
    } catch (err) {
      outputEl.value = `Error: ${err.message}`;
      outputEl.classList.add("has-error");
    }
    updateEncoderStats();
  }

  function updateEncoderStats() {
    const inStats = document.getElementById("encoder-in-stats");
    const outStats = document.getElementById("encoder-out-stats");
    if (inStats) {
      const bytes = new TextEncoder().encode(inputEl.value).byteLength;
      inStats.textContent = `${inputEl.value.length} chars | ${bytes} bytes`;
    }
    if (outStats) {
      const bytes = new TextEncoder().encode(outputEl.value).byteLength;
      outStats.textContent = `${outputEl.value.length} chars | ${bytes} bytes`;
    }
  }

  encodeBtn?.addEventListener("click", () => {
    setDirection(true);
    runTransform(true);
  });
  decodeBtn?.addEventListener("click", () => {
    setDirection(false);
    runTransform(false);
  });

  inputEl.addEventListener("input", () => {
    // Live transform, in whichever direction is currently selected.
    runTransform(isEncoding);
  });

  /**
   * Format-dependent controls. These used to carry `style="display:none"` in
   * the markup, which this page's CSP (`style-src 'self'`, no
   * `'unsafe-inline'`) refuses — so they painted visible until the deferred
   * module ran. The `hidden` attribute is styled by the stylesheet instead.
   */
  function syncFormatControls() {
    if (!formatSelect) return;
    if (hexOptionWrap) hexOptionWrap.hidden = formatSelect.value !== "hex";
    // File -> Data URI only makes sense for Base64.
    if (dropZoneWrap) dropZoneWrap.hidden = formatSelect.value !== "base64";
  }

  formatSelect?.addEventListener("change", () => {
    syncFormatControls();
    runTransform(isEncoding);
  });

  hexSpacedCheckbox?.addEventListener("change", () => {
    runTransform(isEncoding);
  });

  // Round-trip: the output becomes the input, and the direction inverts, so
  // Swap verifies a transform rather than leaving a stale output behind.
  swapBtn?.addEventListener("click", () => {
    inputEl.value = outputEl.value;
    setDirection(!isEncoding);
    runTransform(isEncoding);
  });

  clearBtn?.addEventListener("click", () => {
    inputEl.value = "";
    outputEl.value = "";
    outputEl.classList.remove("has-error");
    if (fileInfo) fileInfo.textContent = "";
    updateEncoderStats();
    inputEl.focus();
  });

  setDirection(true);
  syncFormatControls();

  // Drag and drop for Base64 Data URI conversion
  if (dropZone && fileInput) {
    dropZone.addEventListener("click", () => fileInput.click());
    dropZone.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        fileInput.click();
      }
    });

    ["dragenter", "dragover"].forEach((eventName) => {
      dropZone.addEventListener(eventName, (e) => {
        e.preventDefault();
        dropZone.classList.add("drag-over");
      });
    });

    ["dragleave", "drop"].forEach((eventName) => {
      dropZone.addEventListener(eventName, (e) => {
        e.preventDefault();
        dropZone.classList.remove("drag-over");
      });
    });

    dropZone.addEventListener("drop", async (e) => {
      const file = e.dataTransfer?.files?.[0];
      if (file) handleFile(file);
    });

    fileInput.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    });

    async function handleFile(file) {
      if (fileInfo) fileInfo.textContent = `Reading "${file.name}" (${(file.size / 1024).toFixed(1)} KB)...`;
      try {
        const dataUri = await fileToBase64DataUri(file);
        formatSelect.value = "base64";
        syncFormatControls();
        outputEl.value = dataUri;
        outputEl.classList.remove("has-error");
        if (fileInfo) fileInfo.textContent = `Converted "${file.name}" to Base64 Data URI.`;
        updateEncoderStats();
      } catch (err) {
        outputEl.value = `Error: ${err.message}`;
        outputEl.classList.add("has-error");
        if (fileInfo) fileInfo.textContent = err.message;
      }
    }
  }
}

/**
 * Hasher Panel UI
 */
function setupHasherUI() {
  const inputEl = document.getElementById("hasher-input");
  const uppercaseToggle = document.getElementById("hasher-uppercase");
  const sha256El = document.getElementById("hash-sha256");
  const sha512El = document.getElementById("hash-sha512");
  const sha1El = document.getElementById("hash-sha1");
  const metricsEl = document.getElementById("hasher-metrics");
  const sampleChips = document.querySelectorAll(".hasher-chip");
  const hmacKeyEl = document.getElementById("hmac-key");
  const hmacAlgEl = document.getElementById("hmac-alg");
  const hmacOutEl = document.getElementById("hmac-out");

  if (!inputEl) return;

  /**
   * HMAC over the same message the digests above are reading.
   *
   * With no key there is nothing to sign, and an empty key is a real HMAC but
   * a meaningless one - so the field stays empty and says why, rather than
   * printing a digest that looks authoritative.
   */
  async function updateHmac(isUpper) {
    if (!hmacOutEl) return;
    const key = hmacKeyEl?.value ?? "";
    const text = inputEl.value;

    if (!key || !text) {
      hmacOutEl.value = "";
      return;
    }

    try {
      const mac = await computeHmac(text, key, hmacAlgEl?.value || "SHA-256");
      hmacOutEl.value = isUpper ? mac.uppercaseHex : mac.hex;
    } catch (err) {
      hmacOutEl.value = `Error: ${err.message}`;
    }
  }

  let debounceTimer;

  async function updateHashes() {
    const text = inputEl.value;
    const isUpper = uppercaseToggle?.checked ?? false;

    if (!text) {
      if (sha256El) sha256El.value = "";
      if (sha512El) sha512El.value = "";
      if (sha1El) sha1El.value = "";
      if (hmacOutEl) hmacOutEl.value = "";
      if (metricsEl) metricsEl.textContent = "0 characters | 0 bytes";
      return;
    }

    await updateHmac(isUpper);

    try {
      const result = await computeAllHashes(text);
      if (sha256El) {
        sha256El.value = isUpper ? result["SHA-256"].uppercaseHex : result["SHA-256"].hex;
      }
      if (sha512El) {
        sha512El.value = isUpper ? result["SHA-512"].uppercaseHex : result["SHA-512"].hex;
      }
      if (sha1El) {
        sha1El.value = isUpper ? result["SHA-1"].uppercaseHex : result["SHA-1"].hex;
      }
      if (metricsEl) {
        metricsEl.textContent = `${result.metrics.charCount} characters | ${result.metrics.byteLength} UTF-8 bytes`;
      }
    } catch (err) {
      if (sha256El) sha256El.value = `Error: ${err.message}`;
    }
  }

  inputEl.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(updateHashes, 50);
  });

  uppercaseToggle?.addEventListener("change", updateHashes);
  hmacKeyEl?.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(updateHashes, 50);
  });
  hmacAlgEl?.addEventListener("change", updateHashes);

  sampleChips.forEach((chip) => {
    chip.addEventListener("click", () => {
      inputEl.value = chip.getAttribute("data-sample") || chip.textContent.trim();
      updateHashes();
    });
  });
}

/**
 * JWT Panel UI
 *
 * Everything untrusted here goes in through textContent. A JWT is attacker-
 * supplied by definition - it is the thing you were handed and do not yet
 * trust - so a decoder that built markup from its claims would be handing the
 * page to whoever wrote the token.
 */
function setupJwtUI() {
  const inputEl = document.getElementById("jwt-input");
  const statusEl = document.getElementById("jwt-status");
  const headerEl = document.getElementById("jwt-header");
  const payloadEl = document.getElementById("jwt-payload");
  const claimsBody = document.getElementById("jwt-claims-body");
  const clearBtn = document.getElementById("jwt-clear-btn");

  if (!inputEl) return;

  function reset() {
    if (headerEl) headerEl.textContent = "";
    if (payloadEl) payloadEl.textContent = "";
    if (claimsBody) claimsBody.textContent = "";
  }

  function render() {
    const result = decodeJwt(inputEl.value);

    if (!result.valid) {
      reset();
      if (statusEl) statusEl.textContent = result.error;
      return;
    }

    if (headerEl) headerEl.textContent = JSON.stringify(result.header, null, 2);
    if (payloadEl) payloadEl.textContent = JSON.stringify(result.payload, null, 2);

    if (claimsBody) {
      claimsBody.textContent = "";
      for (const claim of result.claims) {
        const row = document.createElement("tr");

        const keyCell = document.createElement("th");
        keyCell.scope = "row";
        keyCell.textContent = claim.label ? `${claim.key} — ${claim.label}` : claim.key;

        const valueCell = document.createElement("td");
        valueCell.textContent = claim.value;

        const whenCell = document.createElement("td");
        whenCell.textContent = claim.relative ?? "";

        row.append(keyCell, valueCell, whenCell);
        claimsBody.append(row);
      }
    }

    if (statusEl) {
      const alg = result.header?.alg ? String(result.header.alg) : "unspecified";
      const expiry =
        result.expired === null
          ? "no expiry claim"
          : result.expired
            ? "expired"
            : "not yet expired";
      statusEl.textContent = `Decoded. Algorithm ${alg}, ${expiry}. Signature not verified.`;
    }
  }

  let debounceTimer;
  inputEl.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(render, 80);
  });

  clearBtn?.addEventListener("click", () => {
    inputEl.value = "";
    reset();
    if (statusEl) statusEl.textContent = "";
    inputEl.focus();
  });
}

/**
 * Generators Panel UI
 */
function setupGeneratorsUI() {
  const typeSelect = document.getElementById("gen-type");
  const lengthInput = document.getElementById("gen-length");
  const lengthVal = document.getElementById("gen-length-val");
  const batchSelect = document.getElementById("gen-batch");
  const generateBtn = document.getElementById("gen-btn");
  const outputEl = document.getElementById("gen-output");
  const detailsEl = document.getElementById("gen-details");
  const passwordOptionsWrap = document.getElementById("gen-password-options");

  if (!generateBtn || !outputEl) return;

  function syncVisibility() {
    const isPassword = typeSelect?.value === "password";
    const isToken = typeSelect?.value === "hex" || typeSelect?.value === "base64url";
    const needsLength = isPassword || isToken;

    // `hidden`, not an inline style: this page's CSP rejects style attributes.
    const lengthWrap = document.getElementById("gen-length-wrap");
    if (lengthWrap) lengthWrap.hidden = !needsLength;
    if (passwordOptionsWrap) passwordOptionsWrap.hidden = !isPassword;
  }

  typeSelect?.addEventListener("change", syncVisibility);
  syncVisibility();

  lengthInput?.addEventListener("input", () => {
    if (lengthVal) lengthVal.textContent = lengthInput.value;
  });

  function runGeneration() {
    const type = typeSelect ? typeSelect.value : "uuidv4";
    const length = lengthInput ? parseInt(lengthInput.value, 10) : 32;
    const batchCount = batchSelect ? parseInt(batchSelect.value, 10) : 1;

    const passwordOpts = {
      uppercase: document.getElementById("pwd-uppercase")?.checked ?? true,
      lowercase: document.getElementById("pwd-lowercase")?.checked ?? true,
      numbers: document.getElementById("pwd-numbers")?.checked ?? true,
      symbols: document.getElementById("pwd-symbols")?.checked ?? true,
    };

    let generatorFn;
    let extraDetails = "";

    if (type === "uuidv4") {
      generatorFn = () => generateUuidV4();
      extraDetails = "RFC 4122 Random UUID";
    } else if (type === "uuidv7") {
      generatorFn = () => generateUuidV7();
      const sample = generateUuidV7();
      const ts = extractTimestampFromUuidV7(sample);
      const dateStr = ts ? new Date(ts).toISOString() : "";
      extraDetails = `RFC 9562 Time-Ordered UUID (Current timestamp: ${dateStr})`;
    } else if (type === "hex" || type === "base64url") {
      generatorFn = () => generateSecureToken(length, type);
      extraDetails = `Cryptographically secure ${type} token (${length} chars)`;
    } else if (type === "password") {
      generatorFn = () => generateSecureToken(length, "password", passwordOpts);
      extraDetails = `Cryptographically secure password (${length} chars)`;
    }

    const results = generateBatch(generatorFn, batchCount);
    outputEl.value = results.join("\n");
    if (detailsEl) detailsEl.textContent = extraDetails;
  }

  generateBtn.addEventListener("click", runGeneration);

  // Run generation initially
  runGeneration();
}

/**
 * Unix Time Workbench UI
 */
function setupTimeUI() {
  const liveEpochSecEl = document.getElementById("live-epoch-sec");
  const liveEpochMsEl = document.getElementById("live-epoch-ms");
  const liveUtcEl = document.getElementById("live-utc");
  const liveLocalEl = document.getElementById("live-local");

  const epochInput = document.getElementById("time-epoch-input");
  const epochToIsoBtn = document.getElementById("time-epoch-btn");
  const epochNowBtn = document.getElementById("time-epoch-now-btn");
  const epochIsoOut = document.getElementById("time-epoch-iso-out");
  const epochLocalOut = document.getElementById("time-epoch-local-out");
  const epochRelOut = document.getElementById("time-epoch-rel-out");

  const dateInput = document.getElementById("time-date-input");
  const dateToEpochBtn = document.getElementById("time-date-btn");
  const dateSecOut = document.getElementById("time-date-sec-out");
  const dateMsOut = document.getElementById("time-date-ms-out");
  const dateRelOut = document.getElementById("time-date-rel-out");

  // Live ticking clock (only updates when panel is active and document visible)
  function tick() {
    const panelTime = document.getElementById("panel-time");
    if (panelTime && panelTime.hidden) return;
    if (document.hidden) return;
    const clock = getLiveClock();
    if (liveEpochSecEl) liveEpochSecEl.textContent = clock.epochSeconds;
    if (liveEpochMsEl) liveEpochMsEl.textContent = clock.epochMs;
    if (liveUtcEl) liveUtcEl.textContent = clock.utcString;
    if (liveLocalEl) liveLocalEl.textContent = clock.localString;
  }

  tick();
  setInterval(tick, 500);

  function convertEpoch() {
    if (!epochInput) return;
    const details = epochToDetails(epochInput.value);
    if (details.valid) {
      if (epochIsoOut) epochIsoOut.value = details.iso;
      if (epochLocalOut) epochLocalOut.value = details.localString;
      if (epochRelOut) epochRelOut.textContent = details.relative;
    } else {
      if (epochIsoOut) epochIsoOut.value = details.error || "Invalid";
      if (epochLocalOut) epochLocalOut.value = "";
      if (epochRelOut) epochRelOut.textContent = "";
    }
  }

  function convertDate() {
    if (!dateInput) return;
    const details = parseDateInput(dateInput.value);
    if (details.valid) {
      if (dateSecOut) dateSecOut.value = details.epochSeconds;
      if (dateMsOut) dateMsOut.value = details.epochMs;
      if (dateRelOut) dateRelOut.textContent = details.relative;
    } else {
      if (dateSecOut) dateSecOut.value = details.error || "Invalid";
      if (dateMsOut) dateMsOut.value = "";
      if (dateRelOut) dateRelOut.textContent = "";
    }
  }

  epochToIsoBtn?.addEventListener("click", convertEpoch);
  epochInput?.addEventListener("input", convertEpoch);

  epochNowBtn?.addEventListener("click", () => {
    if (epochInput) {
      epochInput.value = Math.floor(Date.now() / 1000);
      convertEpoch();
    }
  });

  dateToEpochBtn?.addEventListener("click", convertDate);
  dateInput?.addEventListener("input", convertDate);

  const dateNowBtn = document.getElementById("time-date-now-btn");
  dateNowBtn?.addEventListener("click", () => {
    if (dateInput) {
      dateInput.value = new Date().toISOString();
      convertDate();
    }
  });

  // Set initial converter sample values
  if (epochInput && !epochInput.value) {
    epochInput.value = Math.floor(Date.now() / 1000);
    convertEpoch();
  }
  if (dateInput && !dateInput.value) {
    dateInput.value = new Date().toISOString();
    convertDate();
  }
}

/**
 * Privacy Reset & State Clear Action
 */
function setupPrivacyClear() {
  const clearBtn = document.getElementById("privacy-clear-all-btn");
  if (!clearBtn) return;

  let confirmTimeout = null;
  const originalHtml = clearBtn.innerHTML;

  clearBtn.addEventListener("click", () => {
    if (!clearBtn.classList.contains("confirming")) {
      clearBtn.classList.add("confirming");
      clearBtn.innerHTML = '<i class="fas fa-exclamation-triangle" aria-hidden="true"></i> <span class="action-label">Confirm?</span>';
      clearTimeout(confirmTimeout);
      confirmTimeout = setTimeout(() => {
        clearBtn.classList.remove("confirming");
        clearBtn.innerHTML = originalHtml;
      }, 3000);
      return;
    }

    clearTimeout(confirmTimeout);
    clearBtn.classList.remove("confirming");

    // Clear all inputs and textareas
    document.querySelectorAll("input[type=text], input[type=number], textarea").forEach((el) => {
      el.value = "";
    });

    // Clear stats and info spans
    document.querySelectorAll(".io-stats, .file-info-pill, .output-details").forEach((el) => {
      el.textContent = "";
    });

    // Remove local storage state for crypto
    try {
      localStorage.removeItem("rj-crypto:preferences");
    } catch {
      // Ignore storage errors
    }

    // Flash visual confirmation
    clearBtn.innerHTML = '<i class="fas fa-check" aria-hidden="true"></i> <span>Cleared!</span>';
    clearBtn.classList.add("cleared");
    setTimeout(() => {
      clearBtn.innerHTML = originalHtml;
      clearBtn.classList.remove("cleared");
    }, 2000);
  });
}
