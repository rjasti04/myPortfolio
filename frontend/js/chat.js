import { API_BASE, apiFetch, ensureSession, isApiConfigured } from "./analytics.js";
import { prefersReducedMotion } from "./config.js";
import { copyText, escapeHTML, estimateTokens } from "./utils.js";
import { authenticatedFetch, getAuthToken, logoutUser } from "./auth.js";
import { highlightCode } from "./syntax-highlighter.js";

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
  
  if (typeof DOMPurify === "undefined") {
    console.error("DOMPurify unavailable - cannot render markdown safely");
    return escapeHTML(text).replace(/\n/g, "<br>");
  }
  
  return DOMPurify.sanitize(marked.parse(text));
}

if (typeof marked !== 'undefined') {
  const renderer = new marked.Renderer();
  renderer.code = function(token) {
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
  const aiLayout = document.getElementById('ai-layout');
  const clearAllBtn = document.getElementById('clear-all-btn');
  const suggestedPrompts = document.querySelectorAll('.ai-suggestion-card');

  let isOpen = false;
  let isGenerating = false;
  const FREE_MESSAGE_LIMIT = 6;

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


  // Widget Header New Chat Action
  const widgetNewChatBtn = document.getElementById('widget-new-chat-btn');
  if (widgetNewChatBtn) {
    widgetNewChatBtn.addEventListener('click', () => {
      if (!isGenerating) createNewSession();
    });
  }

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
      if (showCopy) msgEl.appendChild(createMessageActions(text));
      messagesContainer.appendChild(msgEl);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
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
      appendMessage("Ask anything!", 'bot', { save: false, showCopy: false, target: 'widget' });
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
      return indicator;
    }

    indicator.innerHTML = `
      <div class="thinking-container">
        <div class="thinking-header">
          <i class="fas fa-cog fa-spin" aria-hidden="true"></i> Processing request...
        </div>
        <ul class="thinking-steps">
          <li class="thinking-step active" id="thinking-step-0">
            <i class="fas fa-circle-notch fa-spin" aria-hidden="true"></i> Initializing context
          </li>
          <li class="thinking-step" id="thinking-step-1">
            <i class="far fa-circle" aria-hidden="true"></i> Fetching profile data
          </li>
          <li class="thinking-step" id="thinking-step-2">
            <i class="far fa-circle" aria-hidden="true"></i> Querying Bedrock LLM
          </li>
        </ul>
      </div>
    `;

    const steps = [
      { id: 'thinking-step-0', activeIcon: 'fas fa-circle-notch fa-spin', doneIcon: 'fas fa-check-circle' },
      { id: 'thinking-step-1', activeIcon: 'fas fa-circle-notch fa-spin', doneIcon: 'fas fa-check-circle' },
      { id: 'thinking-step-2', activeIcon: 'fas fa-cog fa-spin', doneIcon: 'fas fa-check-circle' }
    ];

    let currentStep = 0;
    const interval = setInterval(() => {
      const currentEl = indicator.querySelector(`#${steps[currentStep].id}`);
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

      const nextEl = indicator.querySelector(`#${steps[currentStep].id}`);
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
    }

    let messages = session.messages
      .filter(h => h && typeof h.text === 'string' && h.text.trim().length > 0)
      .map(h => ({
        role: h.sender === 'bot' ? 'assistant' : 'user',
        content: h.text.trim()
      }));

    if (messages.length === 0) {
      messages = [{ role: 'user', content: text.trim() || 'Hello' }];
    }

    try {
      const response = await authenticatedFetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages })
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

      let buffer = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          // Keep the last partial line in the buffer
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data: ')) continue;
            const dataStr = trimmed.slice(6).trim();
            if (!dataStr || dataStr === '[DONE]') continue;

            try {
              const parsed = JSON.parse(dataStr);
              if (parsed.error) {
                console.error('Stream payload error:', parsed.error);
                continue;
              }
              const textContent = parsed.text || parsed.delta || (parsed.type === 'content' ? parsed.text : null);
              if (textContent) {
                botFullText += textContent;
              }
            } catch (e) {
              // Skip non-JSON or invalid chunks
            }
          }

          if (!parseTimer) {
            parseTimer = setTimeout(flushParse, MARKDOWN_PARSE_THROTTLE_MS);
          }
        }

        // Process any leftover trailing line in buffer
        if (buffer.trim()) {
          const trimmed = buffer.trim();
          if (trimmed.startsWith('data: ')) {
            const dataStr = trimmed.slice(6).trim();
            if (dataStr && dataStr !== '[DONE]') {
              try {
                const parsed = JSON.parse(dataStr);
                const textContent = parsed.text || parsed.delta || (parsed.type === 'content' ? parsed.text : null);
                if (textContent) {
                  botFullText += textContent;
                }
              } catch (e) {
                // Ignore parse errors on trailing buffer
              }
            }
          }
        }
      } catch (streamError) {
        console.error('Stream reading error:', streamError);
        
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

      // Ensure widget and dialog are visible so user can see error & access retry button
      if (dialog && dialog.classList.contains('hidden')) {
        dialog.classList.remove('hidden');
        dialog.setAttribute('aria-hidden', 'false');
        isOpen = true;
      }
      if (widget) {
        widget.classList.remove('is-hidden');
      }
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
