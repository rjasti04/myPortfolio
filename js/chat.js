import { API_BASE, apiFetch, ensureSession, isApiConfigured } from "./analytics.js";
import { prefersReducedMotion } from "./config.js";
import { copyText, escapeHTML, estimateTokens } from "./utils.js";

// Constants
const MAX_SESSIONS = 50;
const TOKEN_WARNING_THRESHOLD = 1500;
const TOKEN_ERROR_THRESHOLD = 1950;
const TOKEN_LIMIT = 2000;
const SUMMARIZE_TOKEN_THRESHOLD = 6000;
const MARKDOWN_PARSE_THROTTLE_MS = 100;
const STREAM_QUEUE_SIZE = 32;

/** Sanitize HTML through DOMPurify when available, escape otherwise. */
function sanitizeHTML(html) {
  if (typeof DOMPurify !== "undefined") return DOMPurify.sanitize(html);
  console.error("DOMPurify is unavailable; rendering escaped content.");
  return escapeHTML(html);
}

function renderBotHTML(text) {
  if (typeof marked === "undefined") {
    return escapeHTML(text).replace(/\n/g, "<br>");
  }
  return sanitizeHTML(marked.parse(text));
}

if (typeof marked !== 'undefined') {
  const renderer = new marked.Renderer();
  const originalCode = renderer.code.bind(renderer);
  renderer.code = function(token) {
    const text = typeof token === 'object' ? token.text : arguments[0];
    const escapedText = encodeURIComponent(text);
    const html = originalCode.apply(this, arguments);
    return html.replace(/^<pre([^>]*)>/i, `<pre$1><button type="button" class="code-copy-btn" data-code="${escapedText}" title="Copy code"><i class="fas fa-copy"></i></button>`);
  };
  marked.use({ renderer });

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('.code-copy-btn');
    if (btn) {
      try {
        const code = decodeURIComponent(btn.getAttribute('data-code'));
        await copyText(code);
        const icon = btn.querySelector('i');
        if (icon) {
          icon.className = 'fas fa-check';
          setTimeout(() => { icon.className = 'fas fa-copy'; }, 1500);
        }
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

  // Voice input support for mobile
  const initVoiceInput = () => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) return;
    
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';
    
    const addVoiceButton = (input, form) => {
      if (!input || !form) return;
      
      const voiceBtn = document.createElement('button');
      voiceBtn.type = 'button';
      voiceBtn.className = 'voice-input-btn';
      voiceBtn.innerHTML = '<i class="fas fa-microphone"></i>';
      voiceBtn.title = 'Voice input';
      voiceBtn.style.cssText = `
        background: transparent;
        border: none;
        color: var(--accent-text);
        cursor: pointer;
        padding: 8px;
        border-radius: 8px;
        transition: background-color 0.2s ease;
      `;
      
      let isListening = false;
      
      voiceBtn.addEventListener('click', () => {
        if (isListening) {
          recognition.stop();
          return;
        }
        
        recognition.start();
        isListening = true;
        voiceBtn.innerHTML = '<i class="fas fa-stop-circle"></i>';
        voiceBtn.style.color = 'var(--color-error)';
      });
      
      recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        input.value = transcript;
        input.dispatchEvent(new Event('input'));
        input.focus();
      };
      
      recognition.onend = () => {
        isListening = false;
        voiceBtn.innerHTML = '<i class="fas fa-microphone"></i>';
        voiceBtn.style.color = '';
      };
      
      recognition.onerror = () => {
        isListening = false;
        voiceBtn.innerHTML = '<i class="fas fa-microphone"></i>';
        voiceBtn.style.color = '';
      };
      
      const actions = form.querySelector('.ai-input-actions') || form;
      const sendBtn = form.querySelector('button[type="submit"]');
      if (sendBtn && actions) {
        actions.insertBefore(voiceBtn, sendBtn);
      }
    };
    
    if (aiPageInput && aiPageForm && window.innerWidth <= 768) {
      addVoiceButton(aiPageInput, aiPageForm);
    }
    
    if (chatInput && chatForm && window.innerWidth <= 768) {
      addVoiceButton(chatInput, chatForm);
    }
  };
  
  initVoiceInput();

  function updateTokenCounter() {
    if (!aiPageInput || !aiTokenCounter) return;
    const text = aiPageInput.value.trim();
    const tokens = estimateTokens(text);
    aiTokenCounter.textContent = `${tokens} token${tokens !== 1 ? 's' : ''}`;
    
    // Visual warning when approaching limits
    if (tokens > TOKEN_WARNING_THRESHOLD) {
      aiTokenCounter.style.color = 'var(--color-warning)';
      aiTokenCounter.style.fontWeight = '700';
    } else if (tokens > TOKEN_ERROR_THRESHOLD) {
      aiTokenCounter.style.color = 'var(--color-error)';
      aiTokenCounter.style.fontWeight = '800';
    } else {
      aiTokenCounter.style.color = '';
      aiTokenCounter.style.fontWeight = '';
    }
  }
  const newChatBtn = document.getElementById('new-chat-btn');
  const sidebarOpenBtn = document.getElementById('sidebar-open-btn');
  const sidebarCloseBtn = document.getElementById('sidebar-close-btn');
  const aiLayout = document.getElementById('ai-layout');
  const clearAllBtn = document.getElementById('clear-all-btn');
  const suggestedPrompts = document.querySelectorAll('.ai-suggestion-card');

  let isOpen = false;
  let isGenerating = false;

  // Persist sessions in localStorage
  const STORAGE_KEY = 'rj_chat_sessions';
  let sessions = [];
  let activeSessionId = null;

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
    } else {
      activeSessionId = sessions[0].id;
    }
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
    activeSessionId = newSession.id;
    saveSessions();
    restoreActiveSession();
  }

  function getActiveSession() {
    return sessions.find(s => s.id === activeSessionId) || sessions[0];
  }

  function renderSidebar() {
    if (!aiSidebarHistory) return;
    aiSidebarHistory.innerHTML = '';
    sessions.forEach(session => {
      const item = document.createElement('div');
      item.className = `history-item ${session.id === activeSessionId ? 'active' : ''}`;

      const titleSpan = document.createElement('span');
      titleSpan.textContent = session.title;
      item.appendChild(titleSpan);

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'delete-session-btn';
      deleteBtn.innerHTML = '<i class="fas fa-trash"></i>';
      deleteBtn.title = 'Delete chat';
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isGenerating) return;
        deleteSession(session.id);
      });
      item.appendChild(deleteBtn);

      item.addEventListener('click', () => {
        if (isGenerating) return;
        activeSessionId = session.id;
        renderSidebar();
        restoreActiveSession();
        if (window.innerWidth <= 768 && aiLayout) {
          aiLayout.classList.add('sidebar-hidden');
        }
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
      activeSessionId = sessions[0].id;
      restoreActiveSession();
    }
    saveSessions();
  }

  if (newChatBtn) {
    newChatBtn.addEventListener('click', () => {
      if (!isGenerating) createNewSession();
      if (window.innerWidth <= 768 && aiLayout) {
        aiLayout.classList.add('sidebar-hidden');
      }
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

  if (sidebarOpenBtn && aiLayout) {
    sidebarOpenBtn.addEventListener('click', () => {
      aiLayout.classList.remove('sidebar-hidden');
      // Save user preference
      localStorage.setItem('rj_sidebar_hidden', 'false');
    });
  }

  if (sidebarCloseBtn && aiLayout) {
    sidebarCloseBtn.addEventListener('click', () => {
      aiLayout.classList.add('sidebar-hidden');
      // Save user preference
      localStorage.setItem('rj_sidebar_hidden', 'true');
    });
  }

  // Restore user preference for sidebar state
  if (aiLayout) {
    const isHidden = localStorage.getItem('rj_sidebar_hidden') !== 'false';
    if (isHidden) {
      aiLayout.classList.add('sidebar-hidden');
    } else {
      aiLayout.classList.remove('sidebar-hidden');
    }
  }

  function createMessageActions(getText, isTruncated = false) {
    const container = document.createElement('div');
    container.className = 'msg-actions';

    if (isTruncated) {
      const warnIcon = document.createElement('i');
      warnIcon.className = 'fas fa-exclamation-triangle warning-icon';
      warnIcon.title = 'Response truncated due to length limit (2000 tokens).';
      warnIcon.style.marginRight = '8px';
      warnIcon.style.cursor = 'help';
      container.appendChild(warnIcon);
    }

    const tokenSpan = document.createElement('span');
    tokenSpan.className = 'msg-token-count';
    const textVal = typeof getText === 'function' ? getText() : getText;
    const tokens = estimateTokens(textVal);
    tokenSpan.textContent = `${tokens} token${tokens !== 1 ? 's' : ''}`;

    const btn = document.createElement('button');
    btn.className = 'msg-copy-btn';
    btn.title = 'Copy';
    btn.innerHTML = '<i class="fas fa-copy"></i>';
    btn.addEventListener('click', async () => {
      try {
        const textToCopy = typeof getText === 'function' ? getText() : getText;
        await copyText(textToCopy);
        btn.innerHTML = '<i class="fas fa-check"></i>';
        setTimeout(() => { btn.innerHTML = '<i class="fas fa-copy"></i>'; }, 1500);
      } catch (e) {
        console.error('Copy failed', e);
      }
    });

    container.appendChild(tokenSpan);
    container.appendChild(btn);
    return container;
  }

  function appendMessage(text, sender, { save = true, showCopy = save } = {}) {
    const isBot = sender === 'bot';
    const htmlContent = isBot ? renderBotHTML(text) : text;

    if (messagesContainer) {
      const msgEl = document.createElement('div');
      msgEl.className = `chat-message ${sender}`;
      if (isBot) msgEl.innerHTML = htmlContent;
      else msgEl.textContent = text;
      if (showCopy) msgEl.appendChild(createMessageActions(text));
      messagesContainer.appendChild(msgEl);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    if (aiPageMessages) {
      if (aiPageContainer && aiPageContainer.classList.contains('empty-state')) {
        aiPageContainer.classList.remove('empty-state');
      }
      const msgEl2 = document.createElement('div');
      msgEl2.className = `chat-message ${sender}`;
      if (isBot) msgEl2.innerHTML = htmlContent;
      else msgEl2.textContent = text;
      if (showCopy) msgEl2.appendChild(createMessageActions(text));
      aiPageMessages.appendChild(msgEl2);
      aiPageMessages.scrollTop = aiPageMessages.scrollHeight;
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
      appendMessage("Ask anything!", 'bot', { save: false, showCopy: false });
    } else {
      if (aiPageContainer) aiPageContainer.classList.remove('empty-state');
      // Temporarily disable auto-scroll to avoid jumping while rendering
      session.messages.forEach(msg => appendMessage(msg.text, msg.sender, { save: false, showCopy: true }));
    }
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

      const onPointerUp = (upEvent) => {
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
      isOpen = !isOpen;
      if (isOpen) {
        dialog.classList.remove('hidden');
        dialog.setAttribute('aria-hidden', 'false');
        toggleBtn.setAttribute('aria-expanded', 'true');
        setTimeout(() => chatInput && chatInput.focus(), 300);
        if (messagesContainer) messagesContainer.scrollTop = messagesContainer.scrollHeight;
      } else {
        dialog.classList.add('hidden');
        dialog.setAttribute('aria-hidden', 'true');
        toggleBtn.setAttribute('aria-expanded', 'false');
        if (e && e.currentTarget === closeBtn) toggleBtn.focus();
      }
    }

    toggleBtn.addEventListener('click', toggleChat);
    if (closeBtn) closeBtn.addEventListener('click', toggleChat);
  }

  function setInputState(disabled) {
    isGenerating = disabled;
    if (aiPageInput) aiPageInput.disabled = disabled;
    if (aiPageSendBtn) {
      aiPageSendBtn.disabled = disabled;
      aiPageSendBtn.innerHTML = disabled ? '<i class="fas fa-square"></i>' : '<i class="fas fa-arrow-up"></i>';
    }
    if (chatInput) chatInput.disabled = disabled;
    if (chatSendBtn) {
      chatSendBtn.disabled = disabled;
      chatSendBtn.innerHTML = disabled ? '<i class="fas fa-square"></i>' : '<i class="fas fa-arrow-up"></i>';
    }
    if (newChatBtn) newChatBtn.disabled = disabled;
  }

  function createTypingIndicator() {
    const indicator = document.createElement('div');
    indicator.className = 'chat-message bot typing-indicator';
    indicator.setAttribute('role', 'status');
    indicator.setAttribute('aria-live', 'polite');
    indicator.setAttribute('aria-label', 'Assistant is responding');
    if (prefersReducedMotion.matches) {
      indicator.textContent = 'Assistant is responding...';
    } else {
      indicator.innerHTML = '<div class="typing-dot" aria-hidden="true"></div><div class="typing-dot" aria-hidden="true"></div><div class="typing-dot" aria-hidden="true"></div>';
    }
    return indicator;
  }

  async function handleChatSubmit(text) {
    if (!isApiConfigured()) {
      appendMessage("AI service is not configured.", 'bot', { save: false, showCopy: false });
      return;
    }
    if (!(await ensureSession())) {
      appendMessage("AI service is not available.", 'bot', { save: false, showCopy: false });
      return;
    }

    appendMessage(text, 'user', { save: true, showCopy: true });
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
      aiPageMessages.scrollTop = aiPageMessages.scrollHeight;
    }

    const apiUrl = `${API_BASE}/chat`;

    const session = getActiveSession();
    
    // Summarize old messages if token count gets too high
    const totalTokens = session.messages.reduce((sum, msg) => sum + estimateTokens(msg.text), 0);
    if (totalTokens > SUMMARIZE_TOKEN_THRESHOLD) {
      // The current user message is the last entry (just pushed via appendMessage).
      const currentUserMsg = session.messages[session.messages.length - 1];
      // Everything before the current message gets summarized.
      const messagesToSummarize = session.messages.slice(0, session.messages.length - 1);
      const summaryPayload = messagesToSummarize.map(h => ({
        role: h.sender === 'bot' ? 'assistant' : 'user',
        content: h.text
      }));
      
      try {
        const sumRes = await apiFetch(`${API_BASE}/chat/summarize`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: summaryPayload })
        });
        if (sumRes.ok) {
          const sumData = await sumRes.json();
          // Rebuild as: user(synthetic) → bot(summary) → user(current)
          // This guarantees strict user/assistant alternation.
          session.messages = [
            { text: "Summarize our conversation so far.", sender: 'user' },
            { text: sumData.summary, sender: 'bot' },
            currentUserMsg
          ];
          saveSessions();
        }
      } catch (err) {
        console.error("Failed to summarize context:", err);
      }
    }

    const messages = session.messages.map(h => ({
      role: h.sender === 'bot' ? 'assistant' : 'user',
      content: h.text
    }));

    try {
      const response = await apiFetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages })
      });

      if (!response.ok) throw new Error('API Error');

      // Remove typing indicators
      if (widgetIndicator) widgetIndicator.remove();
      if (aiIndicator) aiIndicator.remove();

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');

      let widgetMsgEl = null;
      if (messagesContainer) {
        widgetMsgEl = document.createElement('div');
        widgetMsgEl.className = 'chat-message bot streaming';
        messagesContainer.appendChild(widgetMsgEl);
      }

      let aiMsgEl = null;
      if (aiPageMessages) {
        aiMsgEl = document.createElement('div');
        aiMsgEl.className = 'chat-message bot streaming';
        aiPageMessages.appendChild(aiMsgEl);
      }

      let botFullText = '';
      let parseTimer = null;

      const flushParse = () => {
        if (parseTimer) clearTimeout(parseTimer);
        parseTimer = null;
        const html = renderBotHTML(botFullText);
        if (widgetMsgEl) {
          widgetMsgEl.innerHTML = html;
          const isNearBottom = messagesContainer.scrollHeight - messagesContainer.scrollTop - messagesContainer.clientHeight < 100;
          if (isNearBottom) messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
        if (aiMsgEl) {
          aiMsgEl.innerHTML = html;
          const isNearBottom = aiPageMessages.scrollHeight - aiPageMessages.scrollTop - aiPageMessages.clientHeight < 100;
          if (isNearBottom) aiPageMessages.scrollTop = aiPageMessages.scrollHeight;
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        botFullText += decoder.decode(value, { stream: true });
        // Throttle markdown parsing to reduce CPU usage during streaming
        if (!parseTimer) {
          parseTimer = setTimeout(flushParse, MARKDOWN_PARSE_THROTTLE_MS);
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

      if (widgetMsgEl) {
        widgetMsgEl.classList.remove('streaming');
        widgetMsgEl.appendChild(createMessageActions(() => botFullText, isTruncated));
      }
      if (aiMsgEl) {
        aiMsgEl.classList.remove('streaming');
        aiMsgEl.appendChild(createMessageActions(() => botFullText, isTruncated));
      }

      session.messages.push({ text: botFullText, sender: 'bot' });
      saveSessions();
      
      // Announce completion to screen readers
      announceToScreenReader('Response received');

    } catch (err) {
      console.error('Chat API Error:', err);
      if (widgetIndicator) widgetIndicator.remove();
      if (aiIndicator) aiIndicator.remove();
      
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
    } finally {
      setInputState(false);
      if (aiPageInput) {
        aiPageInput.style.height = 'auto'; // Reset height
        aiPageInput.focus();
      }
      if (chatInput && isOpen) chatInput.focus();
    }
  }

  // Use event delegation for retry buttons
  document.addEventListener('click', (e) => {
    const retryBtn = e.target.closest('.retry-btn');
    if (retryBtn) {
      const retryText = retryBtn.getAttribute('data-retry-text');
      if (retryText) {
        retryBtn.closest('.chat-message')?.remove();
        handleChatSubmit(retryText);
      }
    }
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

  // Init UI
  loadSessions();
  renderSidebar();
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
