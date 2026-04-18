export function initChat() {
  const widget = document.querySelector('.chat-widget');
  if (!widget) return;

  const toggleBtn = document.getElementById('chat-toggle-btn');
  const dialog = document.getElementById('chat-dialog');
  const closeBtn = document.getElementById('chat-close-btn');
  const messagesContainer = document.getElementById('chat-messages');
  const chatForm = document.getElementById('chat-form');
  const chatInput = document.getElementById('chat-input');

  let ws = null;
  let isOpen = false;
  
  // Persist messages in sessionStorage
  const SESSION_KEY = 'chatHistory';

  function saveHistory(history) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(history));
  }

  function getHistory() {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : [];
  }

  function appendMessage(text, sender, save = true) {
    const msgEl = document.createElement('div');
    msgEl.className = `chat-message ${sender}`;
    msgEl.textContent = text;
    messagesContainer.appendChild(msgEl);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    if (save) {
      const history = getHistory();
      history.push({ text, sender });
      saveHistory(history);
    }
  }

  function restoreHistory() {
    messagesContainer.innerHTML = '';
    const history = getHistory();
    history.forEach(msg => appendMessage(msg.text, msg.sender, false));
  }

  function connectWebSocket() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    
    // Determine the host and protocol
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // Support local development ports
    let host = window.location.host;
    if (host.includes('localhost') || host.includes('127.0.0.1')) {
      host = host.split(':')[0] + ':8000';
    }
    const wsUrl = `${protocol}//${host}/ws/chat`;
    
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('Chat WebSocket connected');
    };

    ws.onmessage = (event) => {
      // Don't save server greetings into sessionStorage if we just establish connection,
      // actually let's save everything so context remains intact. Wait, if we keep saving 
      // the initial greeting on every open, it'll duplicate.
      // Let's just save all incoming messages.
      appendMessage(event.data, 'bot');
    };

    ws.onclose = () => {
      console.log('Chat WebSocket disconnected');
      ws = null;
    };
    
    ws.onerror = (error) => {
      console.error('Chat WebSocket error:', error);
    };
  }

  function toggleChat() {
    isOpen = !isOpen;
    if (isOpen) {
      dialog.classList.remove('hidden');
      dialog.setAttribute('aria-hidden', 'false');
      toggleBtn.setAttribute('aria-expanded', 'true');
      
      const history = getHistory();
      if (!ws && history.length === 0) {
        connectWebSocket();
      } else if (!ws) {
        connectWebSocket();
      }

      setTimeout(() => chatInput.focus(), 300);
      
      // Auto-scroll to bottom
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    } else {
      dialog.classList.add('hidden');
      dialog.setAttribute('aria-hidden', 'true');
      toggleBtn.setAttribute('aria-expanded', 'false');
    }
  }

  toggleBtn.addEventListener('click', toggleChat);
  closeBtn.addEventListener('click', toggleChat);

  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text) return;

    appendMessage(text, 'user');
    chatInput.value = '';

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(text);
    } else {
      appendMessage('System: Connection lost. Reconnecting...', 'bot', false);
      connectWebSocket();
      // Wait for open
      const onOpenOriginal = ws.onopen;
      ws.onopen = (evt) => {
        if (onOpenOriginal) onOpenOriginal(evt);
        ws.send(text);
      };
    }
  });

  // Init UI
  restoreHistory();
}
