import { API_BASE, ensureSession, isApiConfigured } from "./analytics.js";
import { prefersReducedMotion } from "./config.js";
import { copyText, escapeHTML, estimateTokens } from "./utils.js";
import { authenticatedFetch, getAuthToken } from "./auth.js";
import { highlightCode } from "./syntax-highlighter.js";

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
  const usageTokensEl = document.getElementById('ai-usage-tokens');
  const usageLatencyEl = document.getElementById('ai-usage-latency');

  // Voice input support for mobile & desktop
  // BUG FIX ROOT CAUSE: SpeechRecognition was using a shared singleton 'recognitionInstance'.
  // This caused both voice buttons to share/override the onresult callback, routing transcripts 
  // to the wrong text inputs. We now instantiate a local SpeechRecognition inside each block
  // for separate lifecycle tracking.
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

    if (chatMicBtn && chatInput) {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = 'en-US';

      let isListening = false;

      chatMicBtn.addEventListener('click', () => {
        if (isListening) {
          recognition.stop();
          return;
        }

        recognition.start();
        isListening = true;
        chatMicBtn.innerHTML = '<i class="fas fa-stop-circle"></i>';
        chatMicBtn.classList.add('listening');
      });

      recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        chatInput.value = transcript;
        chatInput.dispatchEvent(new Event('input'));
        chatInput.focus();
      };

      recognition.onend = () => {
        isListening = false;
        chatMicBtn.innerHTML = '<i class="fas fa-microphone"></i>';
        chatMicBtn.classList.remove('listening');
      };

      recognition.onerror = () => {
        isListening = false;
        chatMicBtn.innerHTML = '<i class="fas fa-microphone"></i>';
        chatMicBtn.classList.remove('listening');
      };
    }

    if (aiPageMicBtn && aiPageInput) {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = 'en-US';

      let isListening = false;

      aiPageMicBtn.addEventListener('click', () => {
        if (isListening) {
          recognition.stop();
          return;
        }

        recognition.start();
        isListening = true;
        aiPageMicBtn.innerHTML = '<i class="fas fa-stop-circle"></i>';
        aiPageMicBtn.classList.add('listening');
      });

      recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        aiPageInput.value = transcript;
        aiPageInput.dispatchEvent(new Event('input'));
        aiPageInput.focus();
      };

      recognition.onend = () => {
        isListening = false;
        aiPageMicBtn.innerHTML = '<i class="fas fa-microphone"></i>';
        aiPageMicBtn.classList.remove('listening');
      };

      recognition.onerror = () => {
        isListening = false;
        aiPageMicBtn.innerHTML = '<i class="fas fa-microphone"></i>';
        aiPageMicBtn.classList.remove('listening');
      };
    }
  };

  initVoiceInput();

  function updateTokenCounter() {
    if (!aiPageInput || !aiTokenCounter) return;
    const text = aiPageInput.value.trim();
    const tokens = estimateTokens(text);
    aiTokenCounter.textContent = `${tokens} token${tokens !== 1 ? 's' : ''}`;
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
      aiTokenCounter.style.color = 'var(--color-error)';
      aiTokenCounter.style.fontWeight = '800';
      aiPageInput.setAttribute('aria-invalid', 'true');
      aiPageInput.setAttribute('aria-describedby', 'token-error');

      // Add error message
      let errorMsg = document.getElementById('token-error');
      if (!errorMsg) {
        errorMsg = document.createElement('div');
        errorMsg.id = 'token-error';
        errorMsg.className = 'form-error-message';
        errorMsg.setAttribute('role', 'alert');
        errorMsg.style.cssText = 'color: var(--color-error); font-size: 12px; margin-top: 4px;';
        aiPageInput.parentElement.appendChild(errorMsg);
      }
      errorMsg.textContent = `Message exceeds ${TOKEN_LIMIT} token limit. Please shorten your message.`;
    } else {
      aiPageInput.removeAttribute('aria-invalid');
      aiPageInput.removeAttribute('aria-describedby');
      document.getElementById('token-error')?.remove();

      if (tokens > TOKEN_ERROR_THRESHOLD) {
        aiTokenCounter.style.color = 'var(--color-error)';
        aiTokenCounter.style.fontWeight = '800';
      } else if (tokens > TOKEN_WARNING_THRESHOLD) {
        aiTokenCounter.style.color = 'var(--color-warning)';
        aiTokenCounter.style.fontWeight = '700';
      } else {
        aiTokenCounter.style.color = '';
        aiTokenCounter.style.fontWeight = '';
      }
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
    toggleBtn?.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('chat-open', open);
  }
  const FREE_MESSAGE_LIMIT = 6;

  // Persist sessions in localStorage
  const STORAGE_KEY = 'rj_chat_sessions';
  const ACTIVE_SESSION_KEY = 'rj_chat_active_session';
  let sessions = [];
  let activeSessionId = null;

  function setActiveSession(id) {
    activeSessionId = id;
    try {
      localStorage.setItem(ACTIVE_SESSION_KEY, id);
    } catch (e) {
      /* private mode / quota - the in-memory id still works this session */
    }
  }

  function loadSessions() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        sessions = JSON.parse(raw);
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
  }

  function saveSessions() {
    // Limit to MAX_SESSIONS to prevent localStorage quota issues
    if (sessions.length > MAX_SESSIONS) {
      sessions = sessions.slice(0, MAX_SESSIONS);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
    renderSidebar();
  }

  function createNewSession() {
    const newSession = {
      id: Date.now().toString(),
      title: 'New Chat',
      messages: []
    };
    sessions.unshift(newSession);
    setActiveSession(newSession.id);
    saveSessions();
    restoreActiveSession();
  }

  function getActiveSession() {
    return sessions.find(s => s.id === activeSessionId) || sessions[0];
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

  function renderUsageSummary() {
    if (!usageTokensEl && !usageLatencyEl) return;
    const usage = getUsage(getActiveSession());
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
    const filteredSessions = searchQuery
      ? sessions.filter(s => s.title.toLowerCase().includes(searchQuery))
      : sessions;

    filteredSessions.forEach(session => {
      const item = document.createElement('div');
      item.className = `history-item ${session.id === activeSessionId ? 'active' : ''}`;

      const titleSpan = document.createElement('span');
      titleSpan.textContent = session.title;
      item.appendChild(titleSpan);

      // Three-dot menu button replacing persistent delete icon
      const menuBtn = document.createElement('button');
      menuBtn.type = 'button';
      menuBtn.className = 'session-menu-btn';
      menuBtn.innerHTML = '<i class="fas fa-ellipsis-v"></i>';
      menuBtn.title = 'Chat options';

      // Dropdown menu
      const dropdown = document.createElement('div');
      dropdown.className = 'session-dropdown-menu hidden';

      const renameItem = document.createElement('button');
      renameItem.type = 'button';
      renameItem.className = 'dropdown-item';
      renameItem.innerHTML = '<i class="fas fa-pen"></i> Rename';
      renameItem.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.classList.add('hidden');
        menuBtn.classList.remove('active');

        // Convert titleSpan to inline input
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'session-rename-input';
        input.value = session.title;
        item.replaceChild(input, titleSpan);
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
      deleteItem.className = 'dropdown-item danger';
      deleteItem.innerHTML = '<i class="fas fa-trash"></i> Delete';
      deleteItem.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isGenerating) return;
        deleteSession(session.id);
      });

      dropdown.appendChild(renameItem);
      dropdown.appendChild(deleteItem);
      item.appendChild(menuBtn);
      item.appendChild(dropdown);

      menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isHidden = dropdown.classList.contains('hidden');
        document.querySelectorAll('.session-dropdown-menu').forEach(m => m.classList.add('hidden'));
        document.querySelectorAll('.session-menu-btn').forEach(b => b.classList.remove('active'));
        if (isHidden) {
          dropdown.classList.remove('hidden');
          dropdown.classList.remove('drop-up');
          menuBtn.classList.add('active');
          // .ai-sidebar-history scrolls, so a menu opened near its bottom edge
          // gets clipped. Flip it above the row when it would not fit below.
          if (aiSidebarHistory) {
            const historyRect = aiSidebarHistory.getBoundingClientRect();
            if (dropdown.getBoundingClientRect().bottom > historyRect.bottom) {
              dropdown.classList.add('drop-up');
            }
          }
        }
      });

      item.addEventListener('click', () => {
        if (isGenerating) return;
        setActiveSession(session.id);
        renderSidebar();
        restoreActiveSession();
        closeSidebarOnDrawerLayout();
      });
      aiSidebarHistory.appendChild(item);
    });
  }

  function deleteSession(id) {
    sessions = sessions.filter(s => s.id !== id);
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

  if (newChatBtn) {
    newChatBtn.addEventListener('click', () => {
      if (!isGenerating) createNewSession();
      closeSidebarOnDrawerLayout();
    });
  }

  // Clear all sessions
  if (clearAllBtn) {
    clearAllBtn.addEventListener('click', () => {
      if (isGenerating) return;
      if (confirm('Delete all chat history? This action cannot be undone.')) {
        sessions = [];
        createNewSession();
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
      if (showCopy) msgEl2.appendChild(createMessageActions(text, isBot));
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
      saveSessions();
    }
    return { showCopy };
  }

  function restoreActiveSession() {
    if (messagesContainer) messagesContainer.innerHTML = '';
    if (aiPageMessages) aiPageMessages.innerHTML = '';

    const session = getActiveSession();
    if (session.messages.length === 0) {
      if (aiPageContainer) aiPageContainer.classList.add('empty-state');
      appendMessage("Ask anything!", 'bot', { save: false, showCopy: false, target: 'widget' });
    } else {
      if (aiPageContainer) aiPageContainer.classList.remove('empty-state');
      // Temporarily disable auto-scroll to avoid jumping while rendering
      session.messages.forEach(msg => appendMessage(msg.text, msg.sender, { save: false, showCopy: true }));
    }

    // Every path that swaps the visible conversation - New Chat, a sidebar
    // pick, a delete - lands here, so the top bar's totals follow from one
    // call site rather than three.
    renderUsageSummary();
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
        if (prefersReducedMotion.matches) {
          chatInput?.focus();
        } else {
          dialog.addEventListener('transitionend', function focusInput(e) {
            if (e.propertyName === 'transform') {
              chatInput?.focus();
              dialog.removeEventListener('transitionend', focusInput);
            }
          });
        }
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
      if (event.key !== 'Escape' || !isOpen) return;
      setChatOpen(false);
      toggleBtn?.focus();
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

  function setInputState(disabled) {
    isGenerating = disabled;
    if (aiPageInput) aiPageInput.disabled = disabled;
    if (aiPageSendBtn) {
      aiPageSendBtn.disabled = false;
      aiPageSendBtn.innerHTML = disabled ? '<i class="fas fa-square"></i>' : '<i class="fas fa-arrow-up"></i>';
      aiPageSendBtn.title = disabled ? 'Stop generation' : 'Send message';
    }
    if (chatInput) chatInput.disabled = disabled;
    if (chatSendBtn) {
      chatSendBtn.disabled = false;
      chatSendBtn.innerHTML = disabled ? '<i class="fas fa-square"></i>' : '<i class="fas fa-arrow-up"></i>';
      chatSendBtn.title = disabled ? 'Stop generation' : 'Send message';
    }
    if (newChatBtn) newChatBtn.disabled = disabled;
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

    // Steps are addressed by data-step, not by id: every turn builds two of
    // these indicators - one in the widget, one on the AI page - so ids put
    // three duplicate ids in the document for the length of each request.
    indicator.innerHTML = `
      <div class="thinking-container">
        <div class="thinking-header">
          <i class="fas fa-cog fa-spin" aria-hidden="true"></i> Processing request...
        </div>
        <ul class="thinking-steps">
          <li class="thinking-step active" data-step="0">
            <i class="fas fa-circle-notch fa-spin" aria-hidden="true"></i> Initializing context
          </li>
          <li class="thinking-step" data-step="1">
            <i class="far fa-circle" aria-hidden="true"></i> Fetching profile data
          </li>
          <li class="thinking-step" data-step="2">
            <i class="far fa-circle" aria-hidden="true"></i> Querying Bedrock LLM
          </li>
        </ul>
      </div>
    `;

    const steps = [
      { activeIcon: 'fas fa-circle-notch fa-spin', doneIcon: 'fas fa-check-circle' },
      { activeIcon: 'fas fa-circle-notch fa-spin', doneIcon: 'fas fa-check-circle' },
      { activeIcon: 'fas fa-cog fa-spin', doneIcon: 'fas fa-check-circle' }
    ];

    const stepEl = (index) => indicator.querySelector(`[data-step="${index}"]`);

    let currentStep = 0;
    const interval = setInterval(() => {
      const currentEl = stepEl(currentStep);
      if (currentEl) {
        currentEl.className = 'thinking-step completed';
        const icon = currentEl.querySelector('i');
        if (icon) icon.className = steps[currentStep].doneIcon;
      }

      currentStep++;
      if (currentStep >= steps.length) {
        clearInterval(interval);
        return;
      }

      const nextEl = stepEl(currentStep);
      if (nextEl) {
        nextEl.className = 'thinking-step active';
        const icon = nextEl.querySelector('i');
        if (icon) icon.className = steps[currentStep].activeIcon;
      }
    }, 700);

    const originalRemove = indicator.remove.bind(indicator);
    indicator.remove = () => {
      clearInterval(interval);
      originalRemove();
    };

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
        body: JSON.stringify({ messages, stream: true }),
        signal: currentAbortController.signal
      });

      if (!response.ok) {
        if (response.status === 401 && !getAuthToken()) {
          window.dispatchEvent(new Event('request-login-modal'));
          throw new Error('Please log in to continue.');
        }
        throw new Error('API Error');
      }

      // Remove typing indicators
      if (widgetIndicator) widgetIndicator.remove();
      if (aiIndicator) aiIndicator.remove();

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
            botFullText += `\n\n*(Error: ${escapeHTML(parsed.error)})*`;
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
            botFullText += "\n\n[Connection interrupted]";
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

      // Always unmount streaming class before rendering final content or error states
      if (widgetMsgEl) widgetMsgEl.classList.remove('streaming');
      if (aiMsgEl) aiMsgEl.classList.remove('streaming');

      if (!botFullText.trim()) {
        const retryText = text;
        const emptyErrorMsg = `
          <div class="chat-error-boundary">
            <i class="fas fa-exclamation-triangle"></i>
            <span>AI service returned an empty response. Check backend credentials/model access and try again.</span>
            <button type="button" class="btn btn-outline retry-btn" data-retry-text="${escapeHTML(retryText)}">
              <i class="fas fa-sync-alt"></i> Retry
            </button>
          </div>
        `;
        if (widgetMsgEl) widgetMsgEl.innerHTML = emptyErrorMsg;
        if (aiMsgEl) aiMsgEl.innerHTML = emptyErrorMsg;
      } else {
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

      // Announce completion to screen readers
      announceToScreenReader('Response received');

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
      const errorMsg = `
        <div class="chat-error-boundary">
          <i class="fas fa-exclamation-triangle"></i>
          <span>Connection to AI service failed. Check your internet connection and try again.</span>
          <button type="button" class="btn btn-outline retry-btn" data-retry-text="${escapeHTML(retryText)}">
            <i class="fas fa-sync-alt"></i> Retry
          </button>
        </div>
      `;
      appendMessage(errorMsg, 'bot', { save: false, showCopy: false });

      // Ensure widget and dialog are visible so user can see error & access retry button
      if (dialog && dialog.classList.contains('hidden')) {
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
        aiPageInput.focus();
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
  renderUsageSummary();
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
