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
  const aiSidebarHistory = document.getElementById('ai-sidebar-history');
  const newChatBtn = document.getElementById('new-chat-btn');
  const sidebarOpenBtn = document.getElementById('sidebar-open-btn');
  const sidebarCloseBtn = document.getElementById('sidebar-close-btn');
  const aiLayout = document.getElementById('ai-layout');
  const aiSidebar = document.getElementById('ai-sidebar');

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
      item.textContent = session.title;
      item.addEventListener('click', () => {
        if (isGenerating) return; // Prevent switching while generating
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

  if (newChatBtn) {
    newChatBtn.addEventListener('click', () => {
      if (!isGenerating) createNewSession();
      if (window.innerWidth <= 768 && aiLayout) {
        aiLayout.classList.add('sidebar-hidden');
      }
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

  function appendMessage(text, sender, save = true) {
    const isBot = sender === 'bot';
    const htmlContent = isBot ? marked.parse(text) : text;

    if (messagesContainer) {
      const msgEl = document.createElement('div');
      msgEl.className = `chat-message ${sender}`;
      if (isBot) msgEl.innerHTML = htmlContent;
      else msgEl.textContent = text;
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
  }

  function restoreActiveSession() {
    if (messagesContainer) messagesContainer.innerHTML = '';
    if (aiPageMessages) aiPageMessages.innerHTML = '';
    
    const session = getActiveSession();
    if (session.messages.length === 0) {
      if (aiPageContainer) aiPageContainer.classList.add('empty-state');
      appendMessage("Hi there! I am an automated assistant powered by Bedrock. How can I help?", 'bot', false);
    } else {
      if (aiPageContainer) aiPageContainer.classList.remove('empty-state');
      // Temporarily disable auto-scroll to avoid jumping while rendering
      session.messages.forEach(msg => appendMessage(msg.text, msg.sender, false));
    }
  }

  // Auto-resize textarea
  if (aiPageInput) {
    aiPageInput.addEventListener('input', function() {
      this.style.height = 'auto';
      this.style.height = (this.scrollHeight) + 'px';
    });
    aiPageInput.addEventListener('keydown', function(e) {
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
      aiPageSendBtn.innerHTML = disabled ? '<i class="fas fa-square"></i>' : '<i class="fas fa-paper-plane"></i>';
    }
    if (chatInput) chatInput.disabled = disabled;
    if (chatSendBtn) {
      chatSendBtn.disabled = disabled;
      chatSendBtn.innerHTML = disabled ? '<i class="fas fa-square"></i>' : '<i class="fas fa-paper-plane"></i>';
    }
    if (newChatBtn) newChatBtn.disabled = disabled;
  }

  function createTypingIndicator() {
    const indicator = document.createElement('div');
    indicator.className = 'chat-message bot typing-indicator';
    indicator.innerHTML = '<div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>';
    return indicator;
  }

  async function handleChatSubmit(text) {
    appendMessage(text, 'user');
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

    const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
    let host = window.location.host;
    if (host.includes('localhost') || host.includes('127.0.0.1')) {
      host = host.split(':')[0] + ':8000';
    }
    const apiUrl = `${protocol}//${host}/api/chat`;

    const session = getActiveSession();
    // exclude the last message we just pushed to history because backend doesn't need it duplicated if we send history?
    // Wait, the backend needs the full conversation including the user's latest query.
    // The previous code mapped the entire history.
    const messages = session.messages.map(h => ({
      role: h.sender === 'bot' ? 'assistant' : 'user',
      content: h.text
    }));

    try {
      const response = await fetch(apiUrl, {
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

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        botFullText += chunk;
        const html = marked.parse(botFullText);
        
        if (widgetMsgEl) {
          widgetMsgEl.innerHTML = html;
          // Auto scroll smoothly if near bottom
          const isNearBottom = messagesContainer.scrollHeight - messagesContainer.scrollTop - messagesContainer.clientHeight < 100;
          if (isNearBottom) messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
        if (aiMsgEl) {
          aiMsgEl.innerHTML = html;
          const isNearBottom = aiPageMessages.scrollHeight - aiPageMessages.scrollTop - aiPageMessages.clientHeight < 100;
          if (isNearBottom) aiPageMessages.scrollTop = aiPageMessages.scrollHeight;
        }
      }

      if (widgetMsgEl) widgetMsgEl.classList.remove('streaming');
      if (aiMsgEl) aiMsgEl.classList.remove('streaming');

      session.messages.push({ text: botFullText, sender: 'bot' });
      saveSessions();

    } catch (err) {
      console.error('Chat API Error:', err);
      if (widgetIndicator) widgetIndicator.remove();
      if (aiIndicator) aiIndicator.remove();
      appendMessage('System: Connection failed.', 'bot', false);
    } finally {
      setInputState(false);
      if (aiPageInput) {
        aiPageInput.style.height = 'auto'; // Reset height
        aiPageInput.focus();
      }
      if (chatInput && isOpen) chatInput.focus();
    }
  }

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
      await handleChatSubmit(text);
    });
  }

  // Init UI
  loadSessions();
  renderSidebar();
}
