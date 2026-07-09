// Chat export and search utilities

/**
 * Export chat conversation to JSON
 * @param {Array} messages - Array of message objects
 * @param {string} sessionTitle - Title of the chat session
 */
export function exportChatJSON(messages, sessionTitle = 'Chat Export') {
  const exportData = {
    title: sessionTitle,
    exportedAt: new Date().toISOString(),
    messageCount: messages.length,
    messages: messages.map(msg => ({
      role: msg.sender === 'bot' ? 'assistant' : 'user',
      content: msg.text,
      timestamp: new Date().toISOString()
    }))
  };
  
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `chat-export-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Export chat conversation to Markdown
 * @param {Array} messages - Array of message objects
 * @param {string} sessionTitle - Title of the chat session
 */
export function exportChatMarkdown(messages, sessionTitle = 'Chat Export') {
  let markdown = `# ${sessionTitle}\n\n`;
  markdown += `Exported: ${new Date().toLocaleString()}\n\n`;
  markdown += `---\n\n`;
  
  messages.forEach((msg, index) => {
    const role = msg.sender === 'bot' ? 'Assistant' : 'User';
    markdown += `## ${role}\n\n`;
    markdown += `${msg.text}\n\n`;
    if (index < messages.length - 1) {
      markdown += `---\n\n`;
    }
  });
  
  const blob = new Blob([markdown], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `chat-export-${Date.now()}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Search through chat messages
 * @param {Array} messages - Array of message objects
 * @param {string} query - Search query
 * @returns {Array} Filtered messages matching the query
 */
export function searchMessages(messages, query) {
  if (!query || query.trim().length === 0) {
    return messages;
  }
  
  const lowerQuery = query.toLowerCase();
  
  return messages.filter(msg => 
    msg.text.toLowerCase().includes(lowerQuery)
  );
}

/**
 * Highlight search terms in text
 * @param {string} text - Text to highlight
 * @param {string} query - Search query
 * @returns {string} HTML with highlighted terms
 */
export function highlightSearchTerms(text, query) {
  if (!query || query.trim().length === 0) {
    return text;
  }
  
  const regex = new RegExp(`(${query})`, 'gi');
  return text.replace(regex, '<mark>$1</mark>');
}

/**
 * Get chat statistics
 * @param {Array} messages - Array of message objects
 * @returns {Object} Statistics object
 */
export function getChatStats(messages) {
  const userMessages = messages.filter(m => m.sender === 'user');
  const botMessages = messages.filter(m => m.sender === 'bot');
  
  const totalChars = messages.reduce((sum, m) => sum + m.text.length, 0);
  const avgMessageLength = messages.length > 0 ? Math.round(totalChars / messages.length) : 0;
  
  return {
    totalMessages: messages.length,
    userMessages: userMessages.length,
    botMessages: botMessages.length,
    totalCharacters: totalChars,
    averageMessageLength: avgMessageLength
  };
}

/**
 * Copy conversation to clipboard
 * @param {Array} messages - Array of message objects
 * @param {string} format - Format ('plain' or 'markdown')
 */
export async function copyConversation(messages, format = 'plain') {
  let text = '';
  
  if (format === 'markdown') {
    messages.forEach(msg => {
      const role = msg.sender === 'bot' ? '**Assistant**' : '**You**';
      text += `${role}: ${msg.text}\n\n`;
    });
  } else {
    messages.forEach(msg => {
      const role = msg.sender === 'bot' ? 'Assistant' : 'You';
      text += `${role}: ${msg.text}\n\n`;
    });
  }
  
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    console.error('Failed to copy conversation:', err);
    return false;
  }
}
