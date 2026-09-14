import { API_BASE, ensureSession, isApiConfigured } from "./analytics.js";
import { prefersReducedMotion } from "./config.js";
import { copyText, escapeHTML, estimateTokens } from "./utils.js";
import { authenticatedFetch, getAuthToken } from "./auth.js";
import { highlightCode } from "./syntax-highlighter.js";
import { handleFocusTrap } from "./modal.js";
import { confirmAction } from "./confirm-dialog.js";

// Constants
const MAX_SESSIONS = 50;
const TOKEN_WARNING_THRESHOLD = 1500;
const TOKEN_ERROR_THRESHOLD = 1950;
const TOKEN_LIMIT = 2000;
const SUMMARIZE_TOKEN_THRESHOLD = 6000;
const MARKDOWN_PARSE_THROTTLE_MS = 100;

function renderBotHTML(text) {
  if (typeof marked === "undefined") {
    return escapeHTML(text).replace(/\n/g, "<br>");
  }

  if (typeof DOMPurify === "undefined") {
    console.error("DOMPurify unavailable - cannot render markdown safely");
    return escapeHTML(text).replace(/\n/g, "<br>");
  }

  return DOMPurify.sanitize(marked.parse(text));
}

if (typeof marked !== 'undefined') {
  const renderer = new marked.Renderer();
  renderer.code = function (token) {
    const text = typeof token === 'object' ? token.text : arguments[0];
    const lang = typeof token === 'object' ? (token.lang || '') : (arguments[1] || '');
    const escapedText = encodeURIComponent(text);
    const highlightedContent = highlightCode(text, lang);
    return `<pre><button type="button" class="code-copy-btn" data-code="${escapedText}" title="Copy code"><i class="fas fa-copy"></i> <span>Copy</span></button>${highlightedContent}</pre>`;
  };
  marked.use({ renderer });

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('.code-copy-btn');
    if (btn) {
      try {
        const code = decodeURIComponent(btn.getAttribute('data-code'));
        await copyText(code);
        btn.classList.add('copied');
        btn.innerHTML = '<i class="fas fa-check"></i> <span>Copied!</span>';
        setTimeout(() => {
          btn.classList.remove('copied');
          btn.innerHTML = '<i class="fas fa-copy"></i> <span>Copy</span>';
        }, 1500);
      } catch (err) {
        console.error('Failed to copy code', err);
      }
    }
  });
}
export function initChat() {
  const widget = document.querySelector('.chat-widget');
  const toggleBtn = document.getElementById('chat-toggle-btn');
  const dialog = document.getElementById('chat-dialog');
  const closeBtn = document.getElementById('chat-close-btn');
  const messagesContainer = document.getElementById('chat-messages');
  const chatForm = document.getElementById('chat-form');
  const chatInput = document.getElementById('chat-input');
  const chatSendBtn = chatForm ? chatForm.querySelector('button[type="submit"]') : null;

  const aiPageContainer = document.getElementById('ai-page-container');
  const aiPageMessages = document.getElementById('ai-page-messages');
  const aiPageForm = document.getElementById('ai-page-form');
  const aiPageInput = document.getElementById('ai-page-input');
  const aiPageSendBtn = document.getElementById('ai-page-send-btn');
  const aiTokenCounter = document.getElementById('ai-token-counter');
  const aiSidebarHistory = document.getElementById('ai-sidebar-history');
  const aiContentArea = document.querySelector('#ai .ai-content-area');
  const aiJumpBtn = document.getElementById('ai-jump-btn');
  const aiThreadTitle = document.getElementById('ai-thread-title');
  const usageEl = document.getElementById('ai-usage');
  const usageTokensEl = document.getElementById('ai-usage-tokens');
  const usageLatencyEl = document.getElementById('ai-usage-latency');
  const aiModelEl = document.getElementById('ai-topbar-model');
  const aiQuotaEl = document.getElementById('ai-quota');

  // Voice input support for mobile & desktop.
  //
  // BUG FIX ROOT CAUSE: SpeechRecognition was using a shared singleton
  // 'recognitionInstance'. This caused both voice buttons to share/override the
  // onresult callback, routing transcripts to the wrong text inputs. Each
  // composer now gets its own recognition object and its own state, built by
  // one helper rather than two copies of the same block.

  // Bar geometry, kept in step with .voice-wave in styles.css: a 4px bar on a
  // 3px gap. The count is measured from the composer rather than fixed, so the
  // row fills the page's wide input and the widget's narrow one alike.
  const VOICE_BAR_PITCH = 7;
  const VOICE_BAR_MIN = 12;
  const VOICE_BAR_MAX = 96;

  const initVoiceInput = () => {
    const aiPageMicBtn = document.getElementById('ai-page-mic-btn');
    const chatMicBtn = document.getElementById('chat-mic-btn');
    const hasSpeechSupport = ('webkitSpeechRecognition' in window) || ('SpeechRecognition' in window);

    if (!hasSpeechSupport) {
      if (aiPageMicBtn) {
        aiPageMicBtn.style.display = 'none';
      }
      if (chatMicBtn) {
        chatMicBtn.style.display = 'none';
      }
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    // Fills a .voice-wave with as many bars as its row holds. Every bar carries
    // its index and its own peak height as custom properties; the CSS does the
    // animating. The heights come off a fixed curve rather than Math.random(),
    // so a row keeps one profile instead of reshuffling on every open.
    //
    // Call it while the bar is visible - a hidden element measures 0 - and it
    // no-ops when the count is already right, so reopening rebuilds nothing.
    function buildWave(wave) {
      if (!wave) return;
      const count = Math.max(
        VOICE_BAR_MIN,
        Math.min(VOICE_BAR_MAX, Math.floor(wave.clientWidth / VOICE_BAR_PITCH))
      );
      if (wave.childElementCount === count) return;

      const bars = document.createDocumentFragment();
      for (let i = 0; i < count; i++) {
        const bar = document.createElement('span');
        const height = 0.775 + 0.225 * Math.sin(i * 0.9) * Math.cos(i * 0.35);
        bar.style.setProperty('--i', String(i));
        bar.style.setProperty('--h', height.toFixed(3));
        bars.appendChild(bar);
      }
      wave.replaceChildren(bars);
    }

    // One composer's worth of voice capture: the mic opens the recording bar
    // over the composer, and the bar's three controls are the only ways out.
    // Stop commits the transcript to the field, Send commits it and submits,
    // Cancel (and Escape) throws it away.
    function setupVoiceInput({ micBtn, input, form, bar }) {
      if (!micBtn || !input || !form || !bar) return;

      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = 'en-US';

      const wave = bar.querySelector('.voice-wave');

      let isListening = false;
      // What the run should do when it ends: 'insert', 'send' or 'cancel'. It is
      // set before stop()/abort() rather than read from the click, because onend
      // is the single place that applies a result - it also fires on silence, on
      // a permission refusal and on the engine's own timeout, and all three have
      // to land in the same restore path.
      let endIntent = 'insert';
      let transcript = '';

      function setRecording(recording) {
        isListening = recording;
        form.classList.toggle('is-recording', recording);
        bar.hidden = !recording;
      }

      function startRecording() {
        if (isListening) return;
        endIntent = 'insert';
        transcript = '';
        try {
          recognition.start();
        } catch {
          // start() throws if the engine is already running - a double click on
          // the mic, or a previous run still winding down. Nothing to recover.
          return;
        }
        setRecording(true);
        buildWave(wave);
        announceToScreenReader('Listening. Speak your message.');
        // Keyboard focus was on the mic, which the bar has just covered; Stop is
        // the control that button became.
        bar.querySelector('.voice-stop-btn')?.focus();
      }

      function endRecording(intent) {
        if (!isListening) return;
        endIntent = intent;
        if (intent === 'cancel') {
          // abort() drops whatever the engine is still holding. stop() would
          // deliver it as one final result, which is the opposite of cancelling.
          recognition.abort();
        } else {
          recognition.stop();
        }
      }

      micBtn.addEventListener('click', startRecording);

      bar.addEventListener('click', (e) => {
        const intent = e.target.closest('[data-voice]')?.dataset.voice;
        if (intent) endRecording(intent);
      });

      // The bar covers the composer while it is open, so Escape here cannot be
      // meant for anything else.
      bar.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          endRecording('cancel');
        }
      });

      recognition.onresult = (event) => {
        transcript = Array.from(event.results)
          .map((result) => result[0].transcript)
          .join(' ')
          .trim();
      };

      // onerror is always followed by onend, so it only has to record that the
      // run is void and let the one restore path below run.
      recognition.onerror = () => {
        endIntent = 'cancel';
      };

      recognition.onend = () => {
        const intent = endIntent;
        const text = transcript;
        setRecording(false);
        endIntent = 'insert';
        transcript = '';

        if (intent === 'cancel' || !text) {
          micBtn.focus();
          announceToScreenReader(intent === 'cancel' ? 'Voice input cancelled.' : 'No speech detected.');
          return;
        }

        input.value = text;
        // Autosize, the token counter and the send button's disabled state all
        // hang off 'input', which a programmatic value assignment does not fire.
        input.dispatchEvent(new Event('input'));
        input.focus();

        if (intent === 'send') {
          // requestSubmit() runs the form's submit handler and its validation;
          // submit() would skip both and navigate.
          if (typeof form.requestSubmit === 'function') {
            form.requestSubmit();
          } else {
            form.dispatchEvent(new Event('submit', { cancelable: true }));
          }
        }
      };
    }

    setupVoiceInput({
      micBtn: chatMicBtn,
      input: chatInput,
      form: chatForm,
      bar: document.getElementById('chat-voice-bar'),
    });

    setupVoiceInput({
      micBtn: aiPageMicBtn,
      input: aiPageInput,
      form: aiPageForm,
      bar: document.getElementById('ai-page-voice-bar'),
    });
  };

  initVoiceInput();

  function updateTokenCounter() {
    if (!aiPageInput || !aiTokenCounter) return;
    const text = aiPageInput.value.trim();
    const tokens = estimateTokens(text);
    // "0 tokens" never said what it was counting toward - the ceiling was
    // invisible until you crossed it and the send button went dead.
    aiTokenCounter.textContent = `${tokens} / ${TOKEN_LIMIT} tokens`;
    // An empty composer has nothing to report, and the count sits inside the
    // pill now - so it stays out of the resting bar and appears on first keypress.
    aiTokenCounter.hidden = tokens === 0;

    // Disable send button if over limit
    const isOverLimit = tokens > TOKEN_LIMIT;

    if (aiPageSendBtn) {
      aiPageSendBtn.disabled = isOverLimit || isGenerating;
      aiPageSendBtn.title = isOverLimit
        ? `Message too long (${tokens}/${TOKEN_LIMIT} tokens)`
        : 'Send message';
    }

    // Visual feedback
    if (isOverLimit) {
      aiTokenCounter.classList.add('is-over');
      aiTokenCounter.classList.remove('is-warn');
      aiPageInput.setAttribute('aria-invalid', 'true');
      aiPageInput.setAttribute('aria-describedby', 'token-error');

      // Add error message
      let errorMsg = document.getElementById('token-error');
      if (!errorMsg) {
        errorMsg = document.createElement('div');
        errorMsg.id = 'token-error';
        errorMsg.className = 'form-error-message';
        errorMsg.setAttribute('role', 'alert');
        // .form-error-message already carries the colour, size and offset; the
        // cssText that used to be here restated them as literals off the ramp.
        aiPageInput.parentElement.appendChild(errorMsg);
      }
      errorMsg.textContent = `Message exceeds the ${TOKEN_LIMIT} token limit. Please shorten it.`;
      errorMsg.setAttribute('data-active', 'true');
    } else {
      aiPageInput.removeAttribute('aria-invalid');
      aiPageInput.removeAttribute('aria-describedby');
      document.getElementById('token-error')?.remove();

      aiTokenCounter.classList.toggle('is-over', tokens > TOKEN_ERROR_THRESHOLD);
      aiTokenCounter.classList.toggle('is-warn',
        tokens > TOKEN_WARNING_THRESHOLD && tokens <= TOKEN_ERROR_THRESHOLD);
    }
  }
  const newChatBtn = document.getElementById('new-chat-btn');
  const sidebarOpenBtn = document.getElementById('sidebar-open-btn');
  const sidebarCloseBtn = document.getElementById('sidebar-close-btn');
  const sidebarScrim = document.getElementById('ai-sidebar-scrim');
  const aiSidebar = document.getElementById('ai-sidebar');
  const aiLayout = document.getElementById('ai-layout');
  const clearAllBtn = document.getElementById('clear-all-btn');

  // Matches the ≤768px breakpoint the AI page styles use for the drawer.
  const MOBILE_BREAKPOINT = 768;
  const isDrawerLayout = () => window.innerWidth <= MOBILE_BREAKPOINT;

  // Single writer for sidebar visibility. A collapsed sidebar is 0px wide but
  // still in the a11y tree, so it has to be made inert as well as hidden.
  function setSidebarHidden(hidden, { persist = true } = {}) {
    if (!aiLayout) return;
    aiLayout.classList.toggle('sidebar-hidden', hidden);
    if (sidebarOpenBtn) sidebarOpenBtn.setAttribute('aria-expanded', String(!hidden));
    if (sidebarCloseBtn) sidebarCloseBtn.setAttribute('aria-expanded', String(!hidden));
    if (aiSidebar) {
      aiSidebar.inert = hidden;
      aiSidebar.setAttribute('aria-hidden', String(hidden));
    }
    if (persist) {
      try {
        localStorage.setItem('rj_sidebar_hidden', String(hidden));
      } catch (e) {
        /* private mode / quota - preference is best-effort */
      }
    }
  }

  // Closing after picking a chat only makes sense while the sidebar overlays
  // the conversation.
  function closeSidebarOnDrawerLayout() {
    if (isDrawerLayout()) setSidebarHidden(true, { persist: false });
  }

  const suggestedPrompts = document.querySelectorAll('.ai-suggestion-card');

  let isOpen = false;
  let isGenerating = false;

  /* One owner for "the chat is open": the dialog's own state plus the body
     class the layout scrim hangs off. Every path that opens or closes the
     widget goes through here, so a blurred backdrop can never outlive the
     dialog that asked for it - a stray body class would leave the page
     blurred and unclickable with nothing on screen to dismiss. */
  function setChatOpen(open) {
    if (!dialog) return;
    isOpen = open;
    dialog.classList.toggle('hidden', !open);
    dialog.setAttribute('aria-hidden', String(!open));
    // `body.chat-open` paints a full-viewport scrim that takes pointer events,
    // so the widget IS modal for a mouse - it just never said so, and Tab
    // walked straight out of it into a page the visitor could no longer click.
    dialog.setAttribute('aria-modal', String(open));
    toggleBtn?.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('chat-open', open);
  }
  const FREE_MESSAGE_LIMIT = 6;

  // Persist sessions in localStorage
  const STORAGE_KEY = 'rj_chat_sessions';
  const ACTIVE_SESSION_KEY = 'rj_chat_active_session';
  let sessions = [];
  let activeSessionId = null;

  /* ── Conversation identity ──
     `id` stays what it has always been - a local key for localStorage and the
     active-session pointer. `conversationId` is a UUID the server understands,
     and it is what makes a transcript one row instead of one row per turn.

     Until this shipped the client sent no conversation_id at all, so
     save_or_update_conversation took its create branch on every assistant turn
     and wrote a fresh ai_conversations row carrying the whole transcript so
     far. Ten turns, ten rows. Nothing read the table, so nothing showed it.

     Two fields rather than one because existing stored sessions have ids like
     "1717171717171" - `Date.now().toString()` - which are not UUIDs. Reusing
     `id` would mean either rejecting those conversations or migrating the
     active-session pointer and every stored key along with them. */
  function newConversationId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    // RFC 4122 v4 from getRandomValues, for browsers without randomUUID
    // (Safari < 15.4). Math.random() is not used: a collision here would merge
    // two people's transcripts into one server row.
    const bytes = new Uint8Array(16);
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function setActiveSession(id) {
    activeSessionId = id;
    try {
      localStorage.setItem(ACTIVE_SESSION_KEY, id);
    } catch (e) {
      /* private mode / quota - the in-memory id still works this session */
    }
  }

  function loadSessions() {
    // Guarded like every other storage access in this file. `getItem` throws
    // outright where storage is blocked, and an unguarded read here took
    // initChat() down with it - the whole AI page, with no error state.
    let raw = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      raw = null;
    }
    if (raw) {
      try {
        // Shape, not just parseability. `JSON.parse` succeeding says nothing
        // about what came back: "null" gave `sessions = null` and the length
        // check below threw, while an object left `.length` undefined and
        // `sessions.some` threw instead. Either took initChat() down with it,
        // leaving the AI page with no transcript, no rail and no error state -
        // the failure the guard above was written to prevent, one layer up.
        const parsed = JSON.parse(raw);
        sessions = Array.isArray(parsed)
          ? parsed.filter(entry => entry && typeof entry === 'object' && entry.id)
          : [];
      } catch (e) {
        sessions = [];
      }
    }
    if (sessions.length === 0) {
      createNewSession();
      return;
    }
    let storedId = null;
    try {
      storedId = localStorage.getItem(ACTIVE_SESSION_KEY);
    } catch (e) {
      storedId = null;
    }
    const restored = sessions.some(sess => sess.id === storedId) ? storedId : sessions[0].id;
    setActiveSession(restored);
    backfillConversationIds();
  }

  /* Conversations stored before `conversationId` existed get one now, so the
     next turn in an old conversation still lands in a single server row. */
  function backfillConversationIds() {
    let changed = false;
    sessions.forEach(session => {
      if (!session.conversationId) {
        session.conversationId = newConversationId();
        changed = true;
      }
    });
    if (changed) saveSessions();
  }

  function saveSessions() {
    // Limit to MAX_SESSIONS to prevent localStorage quota issues
    if (sessions.length > MAX_SESSIONS) {
      sessions = sessions.slice(0, MAX_SESSIONS);
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
    } catch (e) {
      // Quota or blocked storage. The conversation still works for this view;
      // throwing here would abort the turn that is mid-flight.
      console.warn('Chat history could not be saved:', e);
    }
    renderSidebar();
  }

  function createNewSession() {
    const now = Date.now();
    const newSession = {
      id: now.toString(),
      conversationId: newConversationId(),
      title: 'New chat',
      messages: [],
      createdAt: now,
      updatedAt: now
    };
    sessions.unshift(newSession);
    setActiveSession(newSession.id);
    saveSessions();
    restoreActiveSession();
  }

  function getActiveSession() {
    return sessions.find(s => s.id === activeSessionId) || sessions[0];
  }

  /* ── When a conversation was last used ──
     The rail groups by this and orders by it. Sessions stored before
     `updatedAt` shipped have neither key, so the id is the last resort: it is
     `Date.now().toString()` at creation, which is exactly the timestamp those
     rows are missing. Hence a fallback rather than a migration. */
  function sessionTime(session) {
    if (!session) return 0;
    const stamp = session.updatedAt || session.createdAt || Number(session.id);
    return Number.isFinite(stamp) ? stamp : 0;
  }

  /* Boundaries are local midnights, not rolling 24-hour windows: "Yesterday"
     has to mean the calendar day the visitor remembers, not "between 24 and 48
     hours ago". */
  const DAY_MS = 86400000;

  function historyBucket(time, startOfToday) {
    if (time >= startOfToday) return 'Today';
    if (time >= startOfToday - DAY_MS) return 'Yesterday';
    if (time >= startOfToday - 7 * DAY_MS) return 'Previous 7 days';
    if (time >= startOfToday - 30 * DAY_MS) return 'Previous 30 days';
    return 'Older';
  }

  /* The top bar says which conversation is open. Every path that swaps the
     visible one already ends in renderSidebar() or restoreActiveSession(), so
     this hangs off those two rather than off each call site. */
  function renderConversationTitle() {
    if (!aiThreadTitle) return;
    const session = getActiveSession();
    aiThreadTitle.textContent = (session && session.title) || 'New chat';
  }

  /* ── Conversation usage ──
     The top bar reports what this conversation has cost so far, so the figures
     live on the session next to its messages: they survive a reload, they
     follow the sidebar's selection, and a New Chat starts them at zero
     without any extra bookkeeping. Sessions stored before this shipped have no
     `usage` key, hence the lazy default rather than a migration. */
  function getUsage(session) {
    if (!session) return null;
    if (!session.usage) {
      session.usage = { inputTokens: 0, outputTokens: 0, latencyMsTotal: 0, timedTurns: 0 };
    }
    return session.usage;
  }

  /* The top bar used to name a model in hand-written markup, beside a status
     dot nothing ever updated - and the <noscript> card 90 lines below named a
     different vendor. The server owns the model (ADR-023) and reports the one
     it actually used on the stream's metrics frame, so that is what this reads.
     Until a turn has been measured it stays on the neutral label it ships with. */
  function renderModelName(modelId) {
    if (!aiModelEl || typeof modelId !== 'string' || !modelId) return;
    const parts = modelId
      .replace(/^(us|eu|apac)\./, '')
      .replace(/^[a-z0-9-]+\./, '')
      .replace(/-v\d+:\d+$/, '')
      .replace(/-\d{8}$/, '')
      .split(/[-_]/)
      .filter(Boolean);
    // "claude","3","5","sonnet" -> "claude","3.5","sonnet"
    const merged = parts.reduce((acc, part) => {
      const last = acc[acc.length - 1];
      if (last && /^[\d.]+$/.test(last) && /^\d+$/.test(part)) acc[acc.length - 1] = `${last}.${part}`;
      else acc.push(part);
      return acc;
    }, []);
    const pretty = merged
      .map((w) => (/^[\d.]+$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
      .join(' ')
      .trim();
    if (pretty) aiModelEl.textContent = pretty;
  }

  /* Finding 1 of the flow walk: the six-message allowance was invisible until
     the seventh message bounced off it. Counting down from three left is late
     enough not to nag a visitor who only wants one answer, and early enough to
     be a warning rather than a wall. */
  function renderQuota() {
    if (!aiQuotaEl) return;
    if (getAuthToken()) { aiQuotaEl.hidden = true; return; }
    const session = getActiveSession();
    const used = session ? session.messages.filter((m) => m.sender === 'user').length : 0;
    const left = Math.max(0, FREE_MESSAGE_LIMIT - used);
    if (left > 3) { aiQuotaEl.hidden = true; return; }
    aiQuotaEl.textContent = left === 0
      ? 'Free messages used up in this chat. Sign in to keep going.'
      : `${left} free message${left === 1 ? '' : 's'} left in this chat. Sign in for more.`;
    aiQuotaEl.hidden = false;
  }

  function renderUsageSummary() {
    if (!usageTokensEl && !usageLatencyEl) return;
    const usage = getUsage(getActiveSession());
    // Nothing to report on an empty conversation, and "0 / 0" next to an em
    // dash is the loudest pair on the top bar while saying exactly that. The
    // strip earns its place on the first measured turn.
    if (usageEl) {
      usageEl.hidden = !usage
        || (usage.inputTokens === 0 && usage.outputTokens === 0 && usage.timedTurns === 0);
    }
    if (usageTokensEl) {
      const input = usage ? usage.inputTokens : 0;
      const output = usage ? usage.outputTokens : 0;
      usageTokensEl.textContent = `${input.toLocaleString()} / ${output.toLocaleString()}`;
    }
    if (usageLatencyEl) {
      // An em dash until a turn has actually been timed: 0 ms is a measurement,
      // and this is the absence of one.
      usageLatencyEl.textContent = usage && usage.timedTurns > 0
        ? `${Math.round(usage.latencyMsTotal / usage.timedTurns)} ms`
        : '—';
    }
  }

  function recordTurnUsage(session, metrics) {
    const usage = getUsage(session);
    if (!usage || !metrics) return;
    const input = Number(metrics.input_tokens);
    const output = Number(metrics.output_tokens);
    const latency = Number(metrics.latency_ms);
    if (Number.isFinite(input)) usage.inputTokens += input;
    if (Number.isFinite(output)) usage.outputTokens += output;
    // The mean is over the turns that reported a latency, not over every turn:
    // a stopped generation never sends a metrics frame, and folding it in as
    // 0 ms would report an average no request ever took.
    if (Number.isFinite(latency)) {
      usage.latencyMsTotal += latency;
      usage.timedTurns += 1;
    }
    renderUsageSummary();
    renderQuota();
  }

  const sidebarSearchContainer = document.getElementById('ai-sidebar-search-container');
  const sidebarSearchInput = document.getElementById('sidebar-search-input');
  let searchQuery = '';

  if (sidebarSearchInput) {
    sidebarSearchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value.trim().toLowerCase();
      renderSidebar();
    });
  }

  function renderSidebar() {
    if (!aiSidebarHistory) return;

    // Progressive disclosure: show search filter once history grows >= 4 items or if searching
    if (sidebarSearchContainer) {
      if (sessions.length >= 4 || searchQuery.length > 0) {
        sidebarSearchContainer.classList.remove('hidden');
      } else {
        sidebarSearchContainer.classList.add('hidden');
      }
    }

    aiSidebarHistory.innerHTML = '';
    renderConversationTitle();

    const filteredSessions = (searchQuery
      ? sessions.filter(s => s.title.toLowerCase().includes(searchQuery))
      : sessions.slice()
    ).sort((a, b) => sessionTime(b) - sessionTime(a));

    if (filteredSessions.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'ai-history-empty';
      const icon = document.createElement('i');
      icon.className = 'fas fa-file-lines';
      icon.setAttribute('aria-hidden', 'true');
      empty.appendChild(icon);
      empty.appendChild(document.createTextNode(
        searchQuery ? 'No chats match that search.' : 'No conversations yet.'
      ));
      aiSidebarHistory.appendChild(empty);
      return;
    }

    // One container per recency bucket, created on first use so an empty
    // bucket never paints its own heading.
    const startOfToday = new Date().setHours(0, 0, 0, 0);
    const groups = new Map();

    function groupFor(session) {
      const name = historyBucket(sessionTime(session), startOfToday);
      let group = groups.get(name);
      if (!group) {
        group = document.createElement('div');
        group.className = 'ai-history-group';
        const label = document.createElement('p');
        label.className = 'ai-history-group-label';
        label.textContent = name;
        group.appendChild(label);
        groups.set(name, group);
        aiSidebarHistory.appendChild(group);
      }
      return group;
    }

    filteredSessions.forEach(session => {
      const item = document.createElement('div');
      item.className = `history-item ${session.id === activeSessionId ? 'active' : ''}`;

      // The row used to be a bare div with a click listener: unreachable by
      // keyboard and invisible to assistive tech, which is most of a chat
      // history unusable without a mouse. The title is a real button now, and
      // the div is only the surface the hover and active states paint on.
      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'history-item-open';
      openBtn.textContent = session.title;
      openBtn.title = session.title;
      if (session.id === activeSessionId) openBtn.setAttribute('aria-current', 'true');
      item.appendChild(openBtn);

      // Three-dot menu button replacing persistent delete icon
      const menuBtn = document.createElement('button');
      menuBtn.type = 'button';
      menuBtn.className = 'session-menu-btn';
      menuBtn.innerHTML = '<i class="fas fa-ellipsis-v" aria-hidden="true"></i>';
      menuBtn.title = 'Chat options';
      // `title` is a tooltip, not an accessible name on every combination, and
      // the panel was a bare div: nothing announced that this opened a menu or
      // whether it was open.
      menuBtn.setAttribute('aria-label', `Options for ${session.title}`);
      menuBtn.setAttribute('aria-haspopup', 'menu');
      menuBtn.setAttribute('aria-expanded', 'false');

      // Dropdown menu
      const dropdown = document.createElement('div');
      dropdown.className = 'session-dropdown-menu hidden';
      dropdown.setAttribute('role', 'menu');
      dropdown.setAttribute('aria-label', `Options for ${session.title}`);

      const renameItem = document.createElement('button');
      renameItem.type = 'button';
      renameItem.setAttribute('role', 'menuitem');
      renameItem.className = 'dropdown-item';
      renameItem.innerHTML = '<i class="fas fa-pen"></i> Rename';
      // Nothing dismissed this by keyboard, and focus was neither moved into
      // the menu nor returned when it closed.
      dropdown.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        e.stopPropagation();
        dropdown.classList.add('hidden');
        menuBtn.classList.remove('active');
        menuBtn.setAttribute('aria-expanded', 'false');
        menuBtn.focus();
      });

      renameItem.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.classList.add('hidden');
        menuBtn.classList.remove('active');
        menuBtn.setAttribute('aria-expanded', 'false');

        // The open button steps aside for the field, and renderSidebar()
        // puts it back on save or on Escape.
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'session-rename-input';
        input.value = session.title;
        input.setAttribute('aria-label', 'Rename conversation');
        item.replaceChild(input, openBtn);
        input.focus();
        input.select();

        let isSaved = false;
        const saveRename = () => {
          if (isSaved) return;
          isSaved = true;
          const newTitle = input.value.trim();
          if (newTitle && newTitle !== session.title) {
            session.title = newTitle;
            saveSessions();
          } else {
            renderSidebar();
          }
        };

        input.addEventListener('keydown', (evt) => {
          if (evt.key === 'Enter') saveRename();
          if (evt.key === 'Escape') renderSidebar();
        });
        input.addEventListener('blur', saveRename);
      });

      const deleteItem = document.createElement('button');
      deleteItem.type = 'button';
      deleteItem.setAttribute('role', 'menuitem');
      deleteItem.className = 'dropdown-item danger';
      deleteItem.innerHTML = '<i class="fas fa-trash"></i> Delete';
      deleteItem.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (isGenerating) return;
        dropdown.classList.add('hidden');
        menuBtn.classList.remove('active');
        menuBtn.setAttribute('aria-expanded', 'false');
        // Deleting one conversation is as irreversible as clearing them all,
        // and it is the control that gets used - it asked nothing at all
        // while "Clear all history" two steps away asked via confirm().
        const ok = await confirmAction({
          title: 'Delete this chat?',
          body: `"${session.title}" and its messages will be removed from this browser. This cannot be undone.`,
          confirmLabel: 'Delete',
        });
        if (ok) deleteSession(session.id);
      });

      dropdown.appendChild(renameItem);
      dropdown.appendChild(deleteItem);
      item.appendChild(menuBtn);
      item.appendChild(dropdown);

      menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isHidden = dropdown.classList.contains('hidden');
        document.querySelectorAll('.session-dropdown-menu').forEach(m => m.classList.add('hidden'));
        document.querySelectorAll('.session-menu-btn').forEach(b => {
          b.classList.remove('active');
          b.setAttribute('aria-expanded', 'false');
        });
        if (isHidden) {
          dropdown.classList.remove('hidden');
          dropdown.classList.remove('drop-up');
          menuBtn.classList.add('active');
          menuBtn.setAttribute('aria-expanded', 'true');
          // .ai-sidebar-history scrolls, so a menu opened near its bottom edge
          // gets clipped. Flip it above the row when it would not fit below.
          if (aiSidebarHistory) {
            const historyRect = aiSidebarHistory.getBoundingClientRect();
            if (dropdown.getBoundingClientRect().bottom > historyRect.bottom) {
              dropdown.classList.add('drop-up');
            }
          }
          // Same reasoning as the header dropdowns in js/navigation.js: an
          // opened panel that leaves focus on its toggle gives a keyboard user
          // nothing to tell them it opened.
          renameItem.focus();
        }
      });

      openBtn.addEventListener('click', () => {
        if (isGenerating) return;
        openSession(session);
        closeSidebarOnDrawerLayout();
      });

      groupFor(session).appendChild(item);
    });
  }

  function deleteSession(id) {
    const removed = sessions.find(s => s.id === id);
    sessions = sessions.filter(s => s.id !== id);
    // Delete the server copy too, or it comes back on the next sync. Fire and
    // forget: the local removal has already happened and is what the visitor
    // asked for, so a failed request must not undo it or block the UI.
    if (removed) deleteRemoteConversation(removed);
    if (sessions.length === 0) {
      createNewSession();
      return;
    }
    if (activeSessionId === id) {
      setActiveSession(sessions[0].id);
      restoreActiveSession();
    }
    saveSessions();
  }

  /* ── Server-side conversation history ──
     ai_conversations, its service, its migration and three routed endpoints
     all shipped; nothing in the browser ever called them, so a signed-in
     visitor's transcripts lived only in localStorage. That loses them three
     ways: saveSessions() truncates at MAX_SESSIONS, a quota or blocked-storage
     error is caught and warned about, and nothing syncs between devices.

     Anonymous visitors keep the pure-localStorage path unchanged. POST /chat
     is deliberately anonymous and nothing here changes that. */

  function isSignedIn() {
    return Boolean(getAuthToken()) && isApiConfigured();
  }

  function remoteTime(value) {
    const parsed = Date.parse(value ?? '');
    return Number.isFinite(parsed) ? parsed : Date.now();
  }

  /* Empty the account's history in one request.

     Looping `deleteRemoteConversation()` over the rail would not do it:
     `GET /chat/history` is capped and `saveSessions()` truncates at
     MAX_SESSIONS, so a conversation older than the newest 50 is not in
     `sessions` to loop over - it is simply re-listed by the next sync. Returns
     false when the server copy is still there, so the caller can say so. */
  async function deleteAllRemoteConversations() {
    if (!isSignedIn()) return true;
    try {
      const res = await authenticatedFetch(`${API_BASE}/chat/history`, { method: 'DELETE' });
      return res.ok;
    } catch (e) {
      console.warn('Could not clear the server copy of this history:', e);
      return false;
    }
  }

  async function deleteRemoteConversation(session) {
    if (!session?.conversationId || !isSignedIn()) return;
    try {
      await authenticatedFetch(
        `${API_BASE}/chat/history/${session.conversationId}`,
        { method: 'DELETE' }
      );
    } catch (e) {
      // A 404 means it was never saved (an anonymous conversation, or one that
      // never got a reply); anything else is a transient failure the next
      // delete will retry. Either way the row is already gone from this view.
      console.warn('Could not delete the server copy of this conversation:', e);
    }
  }

  /* Pull the signed-in visitor's conversation list and merge it in.
     Summaries only - GET /chat/history deliberately omits the compressed
     payload - so a conversation that lives only on the server arrives as a
     stub and fetches its transcript when it is opened. */
  async function syncServerHistory() {
    if (!isSignedIn()) return;
    try {
      const res = await authenticatedFetch(`${API_BASE}/chat/history`);
      if (!res.ok) return;
      const data = await res.json();
      const conversations = Array.isArray(data?.conversations) ? data.conversations : [];
      if (!conversations.length) return;

      const byConversationId = new Map(
        sessions.filter(sess => sess.conversationId).map(sess => [sess.conversationId, sess])
      );

      conversations.forEach(remote => {
        const local = byConversationId.get(remote.id);
        if (local) {
          // The local copy is the fuller one: it has the rendered transcript
          // and any title the visitor typed. Only the clock is reconciled, so
          // a conversation continued on another device sorts correctly here.
          local.updatedAt = Math.max(local.updatedAt ?? 0, remoteTime(remote.updated_at));
          return;
        }
        sessions.push({
          id: `remote-${remote.id}`,
          conversationId: remote.id,
          title: remote.title || 'Conversation',
          messages: [],
          createdAt: remoteTime(remote.created_at),
          updatedAt: remoteTime(remote.updated_at),
          remote: true,
          messageCount: remote.message_count ?? 0
        });
      });

      sessions.sort((a, b) => sessionTime(b) - sessionTime(a));
      saveSessions();
    } catch (e) {
      // The portfolio never depends on the API being reachable. Local
      // conversations are already on screen; this only adds to them.
      console.warn('Could not load saved conversations:', e);
    }
  }

  /* Fetch one stub's transcript. Returns true when the caller should repaint. */
  async function hydrateSession(session) {
    if (!session?.remote || session.hydrated || session.hydrating) return false;
    if (!isSignedIn()) return false;

    session.hydrating = true;
    session.loadError = null;
    try {
      const res = await authenticatedFetch(`${API_BASE}/chat/history/${session.conversationId}`);
      if (res.status === 404) {
        // Deleted from another device. Drop the stub rather than leaving a row
        // that fails every time it is opened.
        sessions = sessions.filter(s => s.id !== session.id);
        if (sessions.length === 0) createNewSession();
        else if (activeSessionId === session.id) setActiveSession(sessions[0].id);
        saveSessions();
        return true;
      }
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const detail = await res.json();
      session.messages = (Array.isArray(detail?.messages) ? detail.messages : []).map(msg => ({
        text: typeof msg.content === 'string' ? msg.content : String(msg.content ?? ''),
        sender: msg.role === 'assistant' ? 'bot' : 'user'
      }));
      session.hydrated = true;
      session.remote = false;
      saveSessions();
      return true;
    } catch (e) {
      // Reported, not swallowed: a conversation that renders as empty is
      // indistinguishable from one the visitor never had.
      session.loadError = 'This conversation could not be loaded.';
      return true;
    } finally {
      session.hydrating = false;
    }
  }

  /* Open a stub: paint the loading state, fetch, then repaint. */
  async function openSession(session) {
    setActiveSession(session.id);
    renderSidebar();
    restoreActiveSession();
    if (session.remote && !session.hydrated) {
      await hydrateSession(session);
      if (activeSessionId === session.id) restoreActiveSession();
      renderSidebar();
    }
  }

  if (newChatBtn) {
    newChatBtn.addEventListener('click', () => {
      if (!isGenerating) createNewSession();
      closeSidebarOnDrawerLayout();
    });
  }

  // Clear all sessions
  if (clearAllBtn) {
    clearAllBtn.addEventListener('click', async () => {
      if (isGenerating) return;
      const signedIn = isSignedIn();
      const ok = await confirmAction({
        title: 'Delete all chat history?',
        body: `All ${sessions.length} conversation${sessions.length === 1 ? '' : 's'} `
          + (signedIn
            ? 'will be removed from this browser and from your account on every device.'
            : 'will be removed from this browser.')
          + ' This cannot be undone.',
        confirmLabel: 'Delete all',
      });
      if (ok) {
        // Local first: the clear is what the visitor asked for and must not
        // wait on - or be undone by - a request. Then the server copy, for the
        // same reason deleteSession() deletes one: history left in
        // ai_conversations is listed straight back by the next
        // syncServerHistory(), which is exactly what "I cleared it and it came
        // back" was.
        sessions = [];
        createNewSession();
        if (signedIn && !(await deleteAllRemoteConversations())) {
          renderTranscriptNotice({
            text: 'Cleared on this device. Your saved conversations could not be '
              + 'deleted from the server and may reappear - try again in a moment.',
            className: 'chat-transcript-error',
          });
        }
      }
    });
  }

  // Suggested prompt quick actions
  suggestedPrompts.forEach(btn => {
    btn.addEventListener('click', () => {
      if (isGenerating) return;
      const prompt = btn.getAttribute('data-prompt');
      if (!prompt) return;
      if (aiPageInput) {
        aiPageInput.value = '';
        aiPageInput.style.height = 'auto';
        updateTokenCounter();
      }
      handleChatSubmit(prompt);
    });
  });


  // Widget Header New Chat Action
  const widgetNewChatBtn = document.getElementById('widget-new-chat-btn');
  if (widgetNewChatBtn) {
    widgetNewChatBtn.addEventListener('click', () => {
      if (!isGenerating) createNewSession();
    });
  }

  if (sidebarOpenBtn) {
    sidebarOpenBtn.addEventListener('click', () => {
      setSidebarHidden(false);
      if (sidebarCloseBtn) sidebarCloseBtn.focus();
    });
  }

  if (sidebarCloseBtn) {
    sidebarCloseBtn.addEventListener('click', () => {
      setSidebarHidden(true);
      if (sidebarOpenBtn) sidebarOpenBtn.focus();
    });
  }

  // On the drawer layout the sidebar covers the conversation, so tapping the
  // scrim or pressing Escape has to dismiss it.
  if (sidebarScrim) {
    sidebarScrim.addEventListener('click', () => {
      setSidebarHidden(true, { persist: false });
      if (sidebarOpenBtn) sidebarOpenBtn.focus();
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !aiLayout) return;
    if (!isDrawerLayout() || aiLayout.classList.contains('sidebar-hidden')) return;
    setSidebarHidden(true, { persist: false });
    if (sidebarOpenBtn) sidebarOpenBtn.focus();
  });

  // Restore the stored preference without rewriting it.
  if (aiLayout) {
    let storedHidden = null;
    try {
      storedHidden = localStorage.getItem('rj_sidebar_hidden');
    } catch (e) {
      storedHidden = null;
    }
    setSidebarHidden(storedHidden !== 'false', { persist: false });
  }

  /* ── Jump to latest ──
     Scrolling up to re-read an earlier answer used to be a one-way trip: the
     only way back down was to drag the whole thread. The control appears once
     the scroller is roughly a screenful clear of the bottom - far enough that
     the gesture back is real work, near enough that a streaming reply growing
     under a reader who is already at the foot never makes it flicker. */
  const JUMP_THRESHOLD_PX = 260;

  function syncJumpBtn() {
    if (!aiContentArea || !aiJumpBtn) return;
    const slack = aiContentArea.scrollHeight - aiContentArea.scrollTop - aiContentArea.clientHeight;
    aiJumpBtn.hidden = slack < JUMP_THRESHOLD_PX;
  }

  if (aiContentArea && aiJumpBtn) {
    aiContentArea.addEventListener('scroll', syncJumpBtn, { passive: true });
    aiJumpBtn.addEventListener('click', () => {
      aiContentArea.scrollTo({ top: aiContentArea.scrollHeight, behavior: 'smooth' });
      aiJumpBtn.hidden = true;
      aiPageInput?.focus();
    });
  }

  function scrollToBottom(container, force = false) {
    const target = container || document.getElementById('ai-page-messages')?.parentElement || document.getElementById('chat-messages');
    if (!target) return;
    const isNearBottom = force || (target.scrollHeight - target.scrollTop - target.clientHeight < 150);
    if (isNearBottom) {
      target.scrollTo({
        top: target.scrollHeight,
        behavior: 'smooth'
      });
    }
    // A turn appended while the reader is scrolled up changes scrollHeight
    // without producing a scroll event, so the button would otherwise stay in
    // whatever state the last actual scroll left it in.
    syncJumpBtn();
  }

  // One hide timer per button. Two copies inside 1.4s used to leave the first
  // timer running, so the tooltip vanished while the second one was still up.
  const copyTooltipTimers = new WeakMap();

  function showCopyTooltip(targetBtn) {
    let tooltip = targetBtn.querySelector('.copy-tooltip');
    if (!tooltip) {
      tooltip = document.createElement('span');
      tooltip.className = 'copy-tooltip';
      tooltip.textContent = 'Copied!';
      targetBtn.appendChild(tooltip);
    }
    void tooltip.offsetWidth;
    tooltip.classList.add('show');
    clearTimeout(copyTooltipTimers.get(targetBtn));
    copyTooltipTimers.set(targetBtn, setTimeout(() => {
      tooltip.classList.remove('show');
      copyTooltipTimers.delete(targetBtn);
    }, 1400));
  }

  /**
   * Action buttons swap their icon to show state. Doing that through innerHTML
   * also destroys everything else the button owns - the copy tooltip is a child
   * of the copy button, so the icon restore was deleting it mid-fade. The icon
   * is a stable element now and only its class changes.
   */
  function createActionButton(className, title, iconClass) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `msg-action-btn ${className}`;
    btn.title = title;
    btn.setAttribute('aria-label', title);
    const icon = document.createElement('i');
    icon.className = iconClass;
    icon.setAttribute('aria-hidden', 'true');
    btn.appendChild(icon);
    return btn;
  }

  function setActionIcon(btn, iconClass) {
    const icon = btn.querySelector('i');
    if (icon) icon.className = iconClass;
  }

  function createMessageActions(getText, isBot = true, isTruncated = false) {
    const container = document.createElement('div');
    container.className = 'msg-actions';

    if (isTruncated) {
      const warnIcon = document.createElement('i');
      warnIcon.className = 'fas fa-exclamation-triangle warning-icon';
      warnIcon.title = 'Response truncated due to length limit (2000 tokens).';
      warnIcon.style.marginRight = '4px';
      warnIcon.style.cursor = 'help';
      container.appendChild(warnIcon);
    }

    if (isBot) {
      const thumbUpBtn = createActionButton('msg-thumb-up', 'Good response', 'far fa-thumbs-up');
      const thumbDownBtn = createActionButton('msg-thumb-down', 'Bad response', 'far fa-thumbs-down');

      // These are toggles, and the only thing that announced their state was
      // the swap between the outline and solid icon - invisible to a screen
      // reader, which read both as "Good response, button" either way.
      thumbUpBtn.setAttribute('aria-pressed', 'false');
      thumbDownBtn.setAttribute('aria-pressed', 'false');

      const setFeedback = (choice) => {
        const isUp = choice === 'up';
        const isDown = choice === 'down';
        thumbUpBtn.classList.toggle('active', isUp);
        thumbDownBtn.classList.toggle('active', isDown);
        thumbUpBtn.setAttribute('aria-pressed', String(isUp));
        thumbDownBtn.setAttribute('aria-pressed', String(isDown));
        setActionIcon(thumbUpBtn, isUp ? 'fas fa-thumbs-up' : 'far fa-thumbs-up');
        setActionIcon(thumbDownBtn, isDown ? 'fas fa-thumbs-down' : 'far fa-thumbs-down');
      };

      thumbUpBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        setFeedback(thumbUpBtn.classList.contains('active') ? null : 'up');
      });
      container.appendChild(thumbUpBtn);

      thumbDownBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        setFeedback(thumbDownBtn.classList.contains('active') ? null : 'down');
      });
      container.appendChild(thumbDownBtn);

      // Regenerate / Retry Button
      const regenBtn = createActionButton('msg-retry-btn', 'Regenerate response', 'fas fa-rotate-right');
      regenBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (isGenerating) return;
        const session = getActiveSession();
        const lastUserMsg = [...session.messages].reverse().find(m => m.sender === 'user');
        if (lastUserMsg && lastUserMsg.text) {
          await handleChatSubmit(lastUserMsg.text, { regenerate: true });
        }
      });
      container.appendChild(regenBtn);
    } else {
      // User Message: Edit Button
      const editBtn = createActionButton('msg-edit-btn', 'Edit prompt', 'fas fa-pen');
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const textVal = typeof getText === 'function' ? getText() : getText;
        if (aiPageInput) {
          aiPageInput.value = textVal;
          aiPageInput.dispatchEvent(new Event('input'));
          aiPageInput.focus();
        } else if (chatInput) {
          chatInput.value = textVal;
          chatInput.focus();
        }
      });
      container.appendChild(editBtn);
    }

    // Copy Button
    const copyBtn = createActionButton('msg-copy-btn', 'Copy text', 'fas fa-copy');
    let copyResetTimer = null;
    copyBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        const textToCopy = typeof getText === 'function' ? getText() : getText;
        await copyText(textToCopy);
        copyBtn.classList.add('copied');
        setActionIcon(copyBtn, 'fas fa-check');
        showCopyTooltip(copyBtn);
        // A second copy inside 1.5s used to be cut short by the first timer,
        // dropping the tick back to the clipboard icon while the tooltip for
        // the newer copy was still on screen.
        clearTimeout(copyResetTimer);
        copyResetTimer = setTimeout(() => {
          copyResetTimer = null;
          copyBtn.classList.remove('copied');
          setActionIcon(copyBtn, 'fas fa-copy');
        }, 1500);
      } catch (err) {
        console.error('Copy failed', err);
      }
    });
    container.appendChild(copyBtn);

    return container;
  }

  function appendMessage(text, sender, { save = true, showCopy = save, target = 'all' } = {}) {
    const isBot = sender === 'bot';
    const htmlContent = isBot ? renderBotHTML(text) : text;
    const renderWidget = target === 'all' || target === 'widget';
    const renderAiPage = target === 'all' || target === 'ai';
    const canRenderHTML = typeof DOMPurify !== "undefined" && typeof marked !== "undefined";

    if (renderWidget && messagesContainer) {
      const msgEl = document.createElement('div');
      msgEl.className = `chat-message ${sender}`;
      if (isBot && canRenderHTML) {
        msgEl.innerHTML = htmlContent;
      } else if (isBot) {
        msgEl.textContent = text;
      } else {
        msgEl.textContent = text;
      }
      if (showCopy) msgEl.appendChild(createMessageActions(text, isBot));
      messagesContainer.appendChild(msgEl);
      scrollToBottom(messagesContainer, true);
    }

    if (renderAiPage && aiPageMessages) {
      if (aiPageContainer && aiPageContainer.classList.contains('empty-state')) {
        aiPageContainer.classList.remove('empty-state');
      }
      const msgEl2 = document.createElement('div');
      msgEl2.className = `chat-message ${sender}`;
      if (isBot && canRenderHTML) {
        msgEl2.innerHTML = htmlContent;
      } else if (isBot) {
        msgEl2.textContent = text;
      } else {
        msgEl2.textContent = text;
      }
      // The page's questions carry no toolbar. Edit only retyped the prompt
      // into a composer that is always on screen here, and Copy offered back
      // text the visitor had just written - two controls hovering over every
      // question to save work neither of them saved. Answers keep theirs.
      // Widget-only: the corner bubbles above are a different surface and
      // still show both.
      if (showCopy && isBot) msgEl2.appendChild(createMessageActions(text, isBot));
      aiPageMessages.appendChild(msgEl2);
      const aiScrollContainer = aiPageMessages.parentElement || aiPageMessages;
      scrollToBottom(aiScrollContainer, true);
    }

    if (save) {
      const session = getActiveSession();
      session.messages.push({ text, sender });
      if (session.messages.length === 1 && sender === 'user') {
        session.title = text.slice(0, 30) + (text.length > 30 ? '...' : '');
      }
      // What the rail buckets and orders by. Written on every saved turn, so a
      // conversation reopened a week later moves back up to Today.
      session.updatedAt = Date.now();
      saveSessions();
    }
    return { showCopy };
  }

  /* One notice, painted into both surfaces the transcript renders into.
     Built as DOM nodes rather than innerHTML: the text is ours, but this is
     the same path server-supplied titles reach, and escapeHTML-by-construction
     is the house rule. */
  function renderTranscriptNotice({ text, className, busy = false, retry = null }) {
    const build = () => {
      const wrap = document.createElement('div');
      wrap.className = `chat-transcript-notice ${className}`;
      // Announced, because this replaces a transcript the visitor asked to see.
      wrap.setAttribute('role', busy ? 'status' : 'alert');

      const label = document.createElement('p');
      label.className = 'chat-transcript-notice-text';
      label.textContent = text;
      wrap.appendChild(label);

      if (busy) {
        const spinner = document.createElement('i');
        spinner.className = 'fas fa-spinner fa-spin';
        spinner.setAttribute('aria-hidden', 'true');
        wrap.insertBefore(spinner, label);
      }

      if (retry) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'chat-transcript-retry';
        button.textContent = 'Try again';
        button.addEventListener('click', retry);
        wrap.appendChild(button);
      }
      return wrap;
    };

    if (messagesContainer) messagesContainer.appendChild(build());
    if (aiPageMessages) aiPageMessages.appendChild(build());
  }

  function restoreActiveSession() {
    if (messagesContainer) messagesContainer.innerHTML = '';
    if (aiPageMessages) aiPageMessages.innerHTML = '';

    const session = getActiveSession();

    /* A conversation still arriving from the server, and one that failed to
       arrive, are both distinct from an empty one. Painting either as "Ask
       anything!" is the same defect this file's own activity dashboard was
       audited for: a failure reported as emptiness. */
    if (session.hydrating || (session.remote && !session.hydrated && !session.loadError)) {
      if (aiPageContainer) aiPageContainer.classList.remove('empty-state');
      renderTranscriptNotice({
        text: 'Loading this conversation…',
        className: 'chat-transcript-loading',
        busy: true
      });
      renderConversationTitle();
      renderUsageSummary();
      renderQuota();
      syncJumpBtn();
      return;
    }

    if (session.loadError) {
      if (aiPageContainer) aiPageContainer.classList.remove('empty-state');
      renderTranscriptNotice({
        text: session.loadError,
        className: 'chat-transcript-error',
        retry: () => openSession(session)
      });
      renderConversationTitle();
      renderUsageSummary();
      renderQuota();
      syncJumpBtn();
      return;
    }

    if (session.messages.length === 0) {
      if (aiPageContainer) aiPageContainer.classList.add('empty-state');
      appendMessage("Ask anything!", 'bot', { save: false, showCopy: false, target: 'widget' });
    } else {
      if (aiPageContainer) aiPageContainer.classList.remove('empty-state');
      // Temporarily disable auto-scroll to avoid jumping while rendering
      session.messages.forEach(msg => appendMessage(msg.text, msg.sender, { save: false, showCopy: true }));
    }

    // Every path that swaps the visible conversation - New Chat, a sidebar
    // pick, a delete - lands here, so the top bar's title and totals follow
    // from one call site rather than three.
    renderConversationTitle();
    renderUsageSummary();
    renderQuota();
    syncJumpBtn();
  }

  // Auto-resize textarea
  if (aiPageInput) {
    aiPageInput.addEventListener('input', function () {
      this.style.height = 'auto';
      this.style.height = (this.scrollHeight) + 'px';
      updateTokenCounter();
    });
    aiPageInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        aiPageForm.dispatchEvent(new Event('submit'));
      }
    });
  }

  // Widget dragging logic
  if (toggleBtn) {
    toggleBtn.style.touchAction = 'none';

    let wasDragged = false;
    let dragStartX = 0, dragStartY = 0;
    let initialTranslateX = 0, initialTranslateY = 0;
    let currentTranslateX = 0, currentTranslateY = 0;

    toggleBtn.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;

      wasDragged = false;
      dragStartX = e.clientX;
      dragStartY = e.clientY;

      toggleBtn.setPointerCapture(e.pointerId);
      toggleBtn.style.cursor = 'grabbing';

      const onPointerMove = (moveEvent) => {
        const dx = moveEvent.clientX - dragStartX;
        const dy = moveEvent.clientY - dragStartY;

        if (!wasDragged && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
          wasDragged = true;
        }

        if (wasDragged) {
          currentTranslateX = initialTranslateX + dx;
          currentTranslateY = initialTranslateY + dy;
          widget.style.transform = `translate(${currentTranslateX}px, ${currentTranslateY}px)`;
        }
      };

      const onPointerUp = () => {
        toggleBtn.releasePointerCapture(e.pointerId);
        toggleBtn.removeEventListener('pointermove', onPointerMove);
        toggleBtn.removeEventListener('pointerup', onPointerUp);
        toggleBtn.removeEventListener('pointercancel', onPointerUp);
        toggleBtn.style.cursor = '';

        if (wasDragged) {
          initialTranslateX = currentTranslateX;
          initialTranslateY = currentTranslateY;
        }
      };

      toggleBtn.addEventListener('pointermove', onPointerMove);
      toggleBtn.addEventListener('pointerup', onPointerUp);
      toggleBtn.addEventListener('pointercancel', onPointerUp);
    });

    function toggleChat(e) {
      if (wasDragged && e && e.currentTarget === toggleBtn) {
        wasDragged = false;
        return;
      }
      setChatOpen(!isOpen);
      if (isOpen) {
        // Focused directly. This used to wait for a `transitionend` on
        // `transform` that never fires: the global `.hidden` utility is
        // `display: none !important`, which beats .chat-dialog.hidden, and an
        // element leaving display:none does not run a transition. So the
        // composer only ever got focus on the reduced-motion branch, while
        // every open leaked another listener that later transitions - the
        // event bubbles from descendants - could fire to steal focus back.
        chatInput?.focus();
        if (messagesContainer) messagesContainer.scrollTop = messagesContainer.scrollHeight;
      } else if (e && e.currentTarget === closeBtn) {
        toggleBtn.focus();
      }
    }

    toggleBtn.addEventListener('click', toggleChat);
    if (closeBtn) closeBtn.addEventListener('click', toggleChat);
  }

  /* The scrim covers the page and takes pointer events, so without a way out
     the blurred area would be a dead zone - clicks land on it and nothing
     happens. Dismissal mirrors the header dropdowns: a document-level click
     that misses the widget closes it, and Escape does the same for a dialog
     that now reads as modal. The click that opens the widget is inside it,
     so it is filtered out here rather than reopening a race with itself. */
  if (dialog && widget) {
    document.addEventListener('click', (event) => {
      if (!isOpen || widget.contains(event.target)) return;
      setChatOpen(false);
    });

    document.addEventListener('keydown', (event) => {
      if (!isOpen) return;
      if (event.key === 'Escape') {
        setChatOpen(false);
        toggleBtn?.focus();
        return;
      }
      // Same trap js/modal.js gives every other dialog, and js/navigation.js
      // gives the header dropdowns. The widget was the one scrimmed surface
      // without it.
      if (event.key === 'Tab') handleFocusTrap(event, dialog);
    });
  }

  let currentAbortController = null;

  function abortGeneration() {
    if (currentAbortController) {
      currentAbortController.abort();
      currentAbortController = null;
    }
    setInputState(false);
  }

  function setInputState(busy) {
    isGenerating = busy;

    // `readOnly`, not `disabled`. The visitor is almost always focused in the
    // composer when they press Enter, and disabling the focused element drops
    // focus to <body> - a screen reader loses its place mid-turn. A readonly
    // field keeps focus and stays announced; both submit handlers already
    // guard on isGenerating, so Enter cannot re-send.
    if (aiPageInput) {
      aiPageInput.readOnly = busy;
      aiPageInput.setAttribute('aria-busy', String(busy));
    }
    if (aiPageForm) aiPageForm.setAttribute('aria-busy', String(busy));
    if (aiPageSendBtn) {
      aiPageSendBtn.disabled = false;
      aiPageSendBtn.innerHTML = busy ? '<i class="fas fa-square"></i>' : '<i class="fas fa-arrow-up"></i>';
      aiPageSendBtn.title = busy ? 'Stop generation' : 'Send message';
    }
    if (chatInput) {
      chatInput.readOnly = busy;
      chatInput.setAttribute('aria-busy', String(busy));
    }
    if (chatForm) chatForm.setAttribute('aria-busy', String(busy));
    if (chatSendBtn) {
      chatSendBtn.disabled = false;
      chatSendBtn.innerHTML = busy ? '<i class="fas fa-square"></i>' : '<i class="fas fa-arrow-up"></i>';
      chatSendBtn.title = busy ? 'Stop generation' : 'Send message';
    }
    if (newChatBtn) newChatBtn.disabled = busy;
  }

  if (aiPageSendBtn) {
    aiPageSendBtn.addEventListener('click', (e) => {
      if (isGenerating) {
        e.preventDefault();
        e.stopPropagation();
        abortGeneration();
      }
    });
  }

  if (chatSendBtn) {
    chatSendBtn.addEventListener('click', (e) => {
      if (isGenerating) {
        e.preventDefault();
        e.stopPropagation();
        abortGeneration();
      }
    });
  }

  /**
   * The waiting state for a turn in flight.
   *
   * This used to march "Initializing context -> Fetching profile data ->
   * Querying Bedrock LLM" forward on a fixed 700ms interval with nothing
   * behind it: on a slow turn all three read done while nothing had arrived,
   * and on a fast turn the visitor was shown steps for work that never
   * happened. There are only two states this code can actually observe -
   * waiting, and streaming, at which point the indicator is replaced by the
   * reply itself - so it reports the one it is in and nothing more.
   */
  /* Every non-401 failure used to surface as the same sentence: "Connection to
     AI service failed. Check your internet connection and try again." A 429 is
     not a connection problem, and telling a rate-limited visitor to go and check
     their wifi sends them to fix something that is not broken. The status is
     what decides the copy, and the copy names what the visitor can actually do
     about it. */
  function chatError(userMessage, opts = {}) {
    const err = new Error(opts.logMessage || userMessage);
    err.userMessage = userMessage;
    if (opts.status) err.status = opts.status;
    return err;
  }

  function describeHttpFailure(response) {
    switch (response.status) {
      case 429:
        // Covers both the per-IP budget and the four-slot concurrency semaphore.
        // Neither sends Retry-After, and server/main.py exposes only
        // Server-Timing and X-Request-ID through CORS, so there is no wait to
        // quote - both clear on their own within seconds.
        return 'The assistant is handling too many requests right now. Try again in a moment.';
      case 400:
      case 422:
        return 'That message could not be sent. It may be too long - try shortening it.';
      case 401:
      case 403:
        return 'Sign in to continue this conversation.';
      default:
        return response.status >= 500
          ? 'The assistant is temporarily unavailable. Try again in a moment.'
          : 'Something went wrong sending that message. Try again.';
    }
  }

  function createTypingIndicator() {
    const indicator = document.createElement('div');
    indicator.className = 'chat-message bot typing-indicator';
    indicator.setAttribute('role', 'status');
    indicator.setAttribute('aria-live', 'polite');
    indicator.setAttribute('aria-label', 'Assistant is responding');

    if (prefersReducedMotion.matches) {
      indicator.textContent = 'Assistant is responding...';
      return indicator;
    }

    indicator.innerHTML = `
      <div class="thinking-container">
        <span class="thinking-dots" aria-hidden="true">
          <span></span><span></span><span></span>
        </span>
        <span class="thinking-label">Thinking&hellip;</span>
      </div>
    `;

    return indicator;
  }

  /**
   * Drops the reply at the end of a transcript column so a regenerate can put
   * a new one in its place. Typing indicators also carry `.chat-message bot`,
   * hence the exclusion - though none exists this early in a turn.
   */
  function removeTrailingBotMessage(container) {
    if (!container) return;
    const replies = container.querySelectorAll(':scope > .chat-message.bot:not(.typing-indicator)');
    replies[replies.length - 1]?.remove();
  }

  async function handleChatSubmit(text, { regenerate = false } = {}) {
    if (!isApiConfigured()) {
      appendMessage("AI service is not configured.", 'bot', { save: false, showCopy: false });
      return;
    }
    if (!(await ensureSession())) {
      appendMessage("AI service is not available.", 'bot', { save: false, showCopy: false });
      return;
    }


    if (regenerate) {
      // Re-runs a prompt that is already in the transcript, so it must not be
      // appended a second time. Both entry points - the regenerate button on a
      // reply and Retry on an error card - used to call this like a fresh
      // submit, which grew a duplicate user bubble, persisted that duplicate to
      // localStorage and re-sent it as context on every later turn, while the
      // reply being replaced sat on screen above its replacement.
      const currentSession = getActiveSession();
      const history = currentSession.messages;
      const lastEntry = history[history.length - 1];

      // The stored reply and its two bubbles come off together. Retry arrives
      // here with no reply to replace - the turn that failed never saved one -
      // so dropping the bubbles unconditionally would delete the previous
      // reply, which is still in the history and still sent as context.
      if (lastEntry && lastEntry.sender === 'bot') {
        history.pop();
        saveSessions();
        removeTrailingBotMessage(messagesContainer);
        removeTrailingBotMessage(aiPageMessages);
      }

      // A session cleared while its error card was still on screen leaves
      // nothing to re-run: append the prompt rather than send a request whose
      // transcript never held it.
      const trailing = history[history.length - 1];
      if (!(trailing && trailing.sender === 'user' && trailing.text === text)) {
        appendMessage(text, 'user', { save: true, showCopy: true });
      }
    } else {
      appendMessage(text, 'user', { save: true, showCopy: true });
    }
    setInputState(true);

    let widgetIndicator = null;
    let aiIndicator = null;

    if (messagesContainer) {
      widgetIndicator = createTypingIndicator();
      messagesContainer.appendChild(widgetIndicator);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
    if (aiPageMessages) {
      aiIndicator = createTypingIndicator();
      aiPageMessages.appendChild(aiIndicator);
      // #ai-page-messages is the transcript, not the scrollport - .ai-content-area
      // above it is the element with `overflow-y: auto`. Setting scrollTop on the
      // transcript did nothing, so the indicator could appear below the fold.
      const aiScrollContainer = aiPageMessages.parentElement || aiPageMessages;
      scrollToBottom(aiScrollContainer, true);
    }

    const apiUrl = `${API_BASE}/chat/stream`;

    const session = getActiveSession();

    // Check if user is unauthenticated and reached limit
    const userMessageCount = session.messages.filter(m => m.sender === 'user').length;
    if (!getAuthToken() && userMessageCount > FREE_MESSAGE_LIMIT) {
      if (widgetIndicator) widgetIndicator.remove();
      if (aiIndicator) aiIndicator.remove();
      setInputState(false);
      window.dispatchEvent(new Event('request-login-modal'));
      appendMessage("Please log in to continue chatting with the AI. You have reached the free message limit.", 'bot', { save: false, showCopy: false });
      return;
    }

    // Set only when a summarisation round trip succeeds. Until the stream
    // completes it is the payload we send, never the stored transcript.
    let compactedMessages = null;

    // Summarize old messages if token count gets too high
    const totalTokens = session.messages.reduce((sum, msg) => sum + estimateTokens(msg.text), 0);
    if (totalTokens > SUMMARIZE_TOKEN_THRESHOLD) {
      // The current user message is the last entry (just pushed via appendMessage).
      const currentUserMsg = session.messages[session.messages.length - 1];
      // Everything before the current message gets summarized.
      const messagesToSummarize = session.messages.slice(0, session.messages.length - 1);
      const summaryPayload = messagesToSummarize
        .filter(h => h && typeof h.text === 'string' && h.text.trim().length > 0)
        .map(h => ({
          role: h.sender === 'bot' ? 'assistant' : 'user',
          content: h.text.trim()
        }));

      if (summaryPayload.length > 0) {
        try {
          const sumRes = await authenticatedFetch(`${API_BASE}/chat/summarize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: summaryPayload })
          });
          if (sumRes.ok) {
            const sumData = await sumRes.json();
            // Compacted as: user(synthetic) → bot(summary) → user(current),
            // which guarantees strict user/assistant alternation.
            //
            // Held out of `session.messages` until the turn actually succeeds.
            // This used to overwrite the transcript and call saveSessions()
            // immediately - before the request the compaction exists to enable
            // had even been attempted - so a failed stream left the user with a
            // summary they never asked for and no way back to their
            // conversation.
            compactedMessages = [
              { text: "Summarize our conversation so far.", sender: 'user' },
              { text: sumData.summary, sender: 'bot' },
              currentUserMsg
            ];
          }
        } catch (err) {
          console.error("Failed to summarize context:", err);
        }
      }
    }

    let messages = (compactedMessages ?? session.messages)
      .filter(h => h && typeof h.text === 'string' && h.text.trim().length > 0)
      .map(h => ({
        role: h.sender === 'bot' ? 'assistant' : 'user',
        content: h.text.trim()
      }));

    if (messages.length === 0) {
      messages = [{ role: 'user', content: text.trim() || 'Hello' }];
    }

    let widgetMsgEl = null;
    let aiMsgEl = null;

    try {
      currentAbortController = new AbortController();
      const response = await authenticatedFetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, stream: true, conversation_id: session.conversationId }),
        signal: currentAbortController.signal
      });

      if (!response.ok) {
        if (response.status === 401 && !getAuthToken()) {
          window.dispatchEvent(new Event('request-login-modal'));
          throw chatError(
            'You have used the free messages for this browser. Sign in to keep chatting.',
            { status: 401, logMessage: 'Chat free-message limit reached' }
          );
        }
        throw chatError(describeHttpFailure(response), {
          status: response.status,
          logMessage: `Chat API ${response.status}`
        });
      }

      /* The indicator used to be dropped here, the moment the response HEADERS
         arrived - but on Bedrock the first token can be a second or more behind
         them. That left a gap with the indicator gone, the reply not started and
         nothing on screen moving, which reads as a hang. It now survives until
         there is actual text to replace it with. */
      const dropIndicators = () => {
        if (widgetIndicator) { widgetIndicator.remove(); widgetIndicator = null; }
        if (aiIndicator) { aiIndicator.remove(); aiIndicator = null; }
      };

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');

      if (messagesContainer) {
        widgetMsgEl = document.createElement('div');
        widgetMsgEl.className = 'chat-message bot streaming';
        messagesContainer.appendChild(widgetMsgEl);
      }

      if (aiPageMessages) {
        aiMsgEl = document.createElement('div');
        aiMsgEl.className = 'chat-message bot streaming';
        aiPageMessages.appendChild(aiMsgEl);
      }

      let botFullText = '';
      let parseTimer = null;
      let streamMetrics = null;

      const flushParse = () => {
        if (parseTimer) clearTimeout(parseTimer);
        parseTimer = null;
        if (botFullText) dropIndicators();
        const html = renderBotHTML(botFullText);
        if (widgetMsgEl) {
          widgetMsgEl.innerHTML = html;
          scrollToBottom(messagesContainer);
        }
        if (aiMsgEl) {
          aiMsgEl.innerHTML = html;
          const aiScrollContainer = aiPageMessages.parentElement || aiPageMessages;
          scrollToBottom(aiScrollContainer);
        }
      };

      const handleMetrics = (metricsData) => {
        // Kept per turn as well as globally: the local copy is what the top
        // bar's running totals are credited from once this turn completes, so
        // a later turn moving the global on cannot double-count or overwrite
        // it. The global stays for console debugging.
        streamMetrics = metricsData;
        renderModelName(metricsData && metricsData.model_id);
        if (typeof window !== "undefined") {
          window.lastStreamMetrics = metricsData;
        }
        console.debug("SSE Stream Metrics received:", metricsData);
      };

      const processSSELine = (line) => {
        const trimmed = line.trim();
        if (!trimmed) return true;

        let dataStr = trimmed;
        if (trimmed.startsWith("data:")) {
          dataStr = trimmed.replace(/^data:\s*/, "");
        }

        if (!dataStr || dataStr === "[DONE]") {
          if (dataStr === "[DONE]") return false;
          return true;
        }

        try {
          const parsed = JSON.parse(dataStr);

          if (parsed.type === "metrics" || parsed.metrics) {
            handleMetrics(parsed.metrics || parsed);
            return true;
          }

          if (parsed.error) {
            console.error("Stream payload error:", parsed.error);
            botFullText += "\n\n*(The assistant stopped early. Try again.)*";
            flushParse();
            return false;
          }

          const textContent =
            parsed.text ??
            parsed.delta ??
            (parsed.type === "content" ? parsed.text : null);
          if (textContent !== null && textContent !== undefined) {
            botFullText += textContent;
          }
        } catch (e) {
          // Plain text fallback for non-JSON SSE payload
          if (typeof dataStr === "string" && dataStr.length > 0) {
            botFullText += dataStr;
          }
        }
        return true;
      };

      let buffer = "";
      try {
        streamLoop: while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          // Keep the last partial line in the buffer
          buffer = lines.pop() || "";

          for (const line of lines) {
            const shouldContinue = processSSELine(line);
            if (!shouldContinue) break streamLoop;
          }

          if (!parseTimer) {
            parseTimer = setTimeout(flushParse, MARKDOWN_PARSE_THROTTLE_MS);
          }
        }

        // Process any leftover trailing line in buffer
        if (buffer.trim()) {
          processSSELine(buffer);
        }
      } catch (streamError) {
        if (streamError.name === 'AbortError' || currentAbortController?.signal?.aborted) {
          console.log("Stream generation stopped by user.");
          if (botFullText.length > 0) {
            if (parseTimer) {
              clearTimeout(parseTimer);
              parseTimer = null;
            }
            flushParse();
            botFullText += "\n\n*(Generation stopped)*";
          }
        } else {
          console.error("Stream reading error:", streamError);

          // Gracefully handle partial response
          if (botFullText.length > 0) {
            if (parseTimer) {
              clearTimeout(parseTimer);
              parseTimer = null;
            }
            flushParse();
            botFullText += "\n\n*(Reply cut short - the connection dropped.)*";
          } else {
            throw streamError;
          }
        }
      }

      // Final flush to ensure all content is rendered
      if (parseTimer) { clearTimeout(parseTimer); parseTimer = null; }

      let isTruncated = false;
      if (botFullText.endsWith('\n[__TRUNCATED__]')) {
        isTruncated = true;
        botFullText = botFullText.replace('\n[__TRUNCATED__]', '');
      }

      flushParse();

      dropIndicators();

      // Always unmount streaming class before rendering final content or error states
      if (widgetMsgEl) widgetMsgEl.classList.remove('streaming');
      if (aiMsgEl) aiMsgEl.classList.remove('streaming');

      if (!botFullText.trim()) {
        const retryText = text;
        const emptyErrorMsg = `
          <div class="chat-error-boundary">
            <i class="fas fa-exclamation-triangle"></i>
            <span>The assistant did not return a response. Try again.</span>
            <button type="button" class="btn btn-outline retry-btn" data-retry-text="${escapeHTML(retryText)}">
              <i class="fas fa-sync-alt"></i> Retry
            </button>
          </div>
        `;
        if (widgetMsgEl) widgetMsgEl.innerHTML = emptyErrorMsg;
        if (aiMsgEl) aiMsgEl.innerHTML = emptyErrorMsg;
        announceToScreenReader('The assistant did not return a response.');
      } else {
        announceToScreenReader('Response received');
        if (widgetMsgEl) {
          widgetMsgEl.appendChild(createMessageActions(() => botFullText, true, isTruncated));
        }
        if (aiMsgEl) {
          aiMsgEl.appendChild(createMessageActions(() => botFullText, true, isTruncated));
        }

        // Metrics arrive on the stream's last frame, so the totals are credited
        // here rather than in handleMetrics(): by this point the turn has
        // produced text, and the saveSessions() below persists the figures with
        // the message they belong to.
        recordTurnUsage(session, streamMetrics);

        // The turn succeeded, so the compaction (if any) is now safe to keep.
        // The reply goes in before the re-render, or restoreActiveSession()
        // rebuilds the transcript from a history that does not contain it yet
        // and the message the user just watched arrive disappears.
        if (compactedMessages) {
          session.messages = [...compactedMessages, { text: botFullText, sender: 'bot' }];
          saveSessions();
          restoreActiveSession();
        } else {
          session.messages.push({ text: botFullText, sender: 'bot' });
          saveSessions();
        }
      }



    } catch (err) {
      console.error('Chat API Error:', err);
      if (widgetIndicator) widgetIndicator.remove();
      if (aiIndicator) aiIndicator.remove();

      // Unmount any active streaming placeholders on error to prevent orphan cursor blocks
      if (widgetMsgEl) {
        widgetMsgEl.classList.remove('streaming');
        widgetMsgEl.remove();
      }
      if (aiMsgEl) {
        aiMsgEl.classList.remove('streaming');
        aiMsgEl.remove();
      }

      // Store the original text for retry
      const retryText = text;
      // Written flat on purpose. This card is the one error path that goes
      // through appendMessage(), so it is parsed as Markdown before it is
      // rendered - and Markdown reads four leading spaces as a code fence. The
      // indented template that used to be here reached the transcript as a
      // syntax-highlighted dump of its own source, Retry button and all.
      // err.userMessage is set by chatError() and already says what happened.
      // A thrown TypeError from fetch() itself is the one case that really IS
      // the network, so that is the only path that still says so.
      const detail = err.userMessage
        || 'Could not reach the assistant. Check your connection and try again.';
      const errorMsg =
        '<div class="chat-error-boundary">' +
        '<i class="fas fa-exclamation-triangle"></i>' +
        `<span>${escapeHTML(detail)}</span>` +
        `<button type="button" class="btn btn-outline retry-btn" data-retry-text="${escapeHTML(retryText)}">` +
        '<i class="fas fa-sync-alt"></i> Retry' +
        '</button>' +
        '</div>';
      appendMessage(errorMsg, 'bot', { save: false, showCopy: false });

      // Bring the widget forward so the error and its Retry are reachable - but
      // only when the widget is the surface the visitor is on. appendMessage()
      // has just rendered the same card into the AI page, and opening the
      // dialog over it blurred the whole layout behind a second copy of an
      // error the visitor was already reading.
      const onAiPage = document.getElementById('ai')?.classList.contains('active');
      if (!onAiPage && dialog && dialog.classList.contains('hidden')) {
        setChatOpen(true);
      }
      if (widget) {
        widget.classList.remove('is-hidden');
      }
    } finally {
      // The controller belongs to the stream that just ended. Leaving it set
      // meant abortGeneration() held a reference to a finished request and the
      // AbortError branch could consult a stale signal.
      currentAbortController = null;
      setInputState(false);
      if (aiPageInput) {
        aiPageInput.style.height = 'auto'; // Reset height
        // Only if the AI page is still the section on screen. This refocused
        // unconditionally, so a turn that finished after the visitor had
        // navigated to Work or Contact pulled focus back to a composer they
        // could no longer see.
        if (document.getElementById('ai')?.classList.contains('active')) {
          aiPageInput.focus();
        }
      }
      if (chatInput && isOpen) chatInput.focus();
    }
  }

  // Use event delegation for retry buttons.
  //
  // Every other entry point into handleChatSubmit guards on isGenerating; this
  // one did not. A second submit overwrote currentAbortController, so Stop no
  // longer stopped the first stream and it kept billing tokens, and the two
  // streams raced to push into the same session transcript. The error boundary
  // is rendered into both the widget and the AI page, so there are two buttons
  // carrying the same text - all the more reason to guard.
  document.addEventListener('click', (e) => {
    const retryBtn = e.target.closest('.retry-btn');
    if (!retryBtn) return;
    if (isGenerating) return;

    const retryText = retryBtn.getAttribute('data-retry-text');
    if (!retryText) return;

    // Drop both copies of the error card, not just the clicked one.
    document.querySelectorAll('.retry-btn').forEach((button) => {
      button.closest('.chat-message')?.remove();
    });
    // The failed turn appended and saved this prompt already, so it re-runs
    // through the same path as regenerate. Sent fresh, it duplicated the user
    // bubble in the transcript, in localStorage and in every later payload.
    handleChatSubmit(retryText, { regenerate: true });
  });

  if (chatForm) {
    chatForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (isGenerating) return;
      const text = chatInput.value.trim();
      if (!text) return;
      chatInput.value = '';
      await handleChatSubmit(text);
    });
  }

  if (aiPageForm) {
    aiPageForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (isGenerating) return;
      const text = aiPageInput.value.trim();
      if (!text) return;
      aiPageInput.value = '';
      aiPageInput.style.height = 'auto';
      updateTokenCounter();
      await handleChatSubmit(text);
    });
  }

  // Close dropdown menus when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.history-item')) {
      document.querySelectorAll('.session-dropdown-menu').forEach(m => m.classList.add('hidden'));
      document.querySelectorAll('.session-menu-btn').forEach(b => b.classList.remove('active'));
    }
  });

  // Init UI
  loadSessions();
  renderSidebar();
  // Nothing painted the stored conversation on load: loadSessions() only
  // reaches restoreActiveSession() through createNewSession(), which it calls
  // when there is no history at all. So a returning visitor arrived to the
  // greeting and an empty widget while the rail listed the thread they had
  // just been reading, and only a click on that row brought it back.
  restoreActiveSession();

  /* Pull whatever the server holds for a signed-in visitor, then repaint. The
     local conversations are already on screen by this point, so this only ever
     adds rows to the rail - the portfolio never waits on the API. */
  async function refreshServerHistory() {
    if (!isSignedIn()) return;
    await syncServerHistory();
    renderSidebar();
  }

  refreshServerHistory();
  // auth-ui.js fires this on login, logout, magic-link verification and 2FA
  // completion, which is exactly when the set of readable conversations moves.
  window.addEventListener('auth-changed', refreshServerHistory);
}

// Screen reader announcements
function announceToScreenReader(message) {
  const announcement = document.createElement('div');
  announcement.setAttribute('role', 'status');
  announcement.setAttribute('aria-live', 'polite');
  announcement.className = 'sr-only';
  announcement.textContent = message;
  announcement.style.cssText = `
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  `;

  document.body.appendChild(announcement);

  setTimeout(() => {
    announcement.remove();
  }, 1000);
}
