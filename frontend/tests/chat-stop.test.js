import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';

/* The Stop button and the busy flag (codebase review C12).

   (1) The AbortController was created only for the stream, so Stop pressed
       while a long conversation was being summarised reset the UI and aborted
       nothing: the turn carried on and could interleave with the next one.
   (2) Stopping before the response headers arrived rejected the fetch in the
       outer catch, which lacked the AbortError check the stream loop has, and
       showed "Could not reach the assistant" with a Retry.
   (3) The busy flag was set only after `await ensureSession()`, so two fast
       submits on a first visit both got past every isGenerating guard.

   Same shape of harness as chat-history-sync.test.js, plus the AI page's
   composer so a turn can be driven the way a visitor drives it. */

const BODY = `
  <p id="route-announcer" role="status" aria-live="polite" aria-atomic="true"></p>
  <span class="chat-status" id="chat-status" data-state="online">Online</span>
  <div id="chat-widget"><div id="chat-messages"></div></div>
  <div id="ai-sidebar-history"></div>
  <div id="ai-page-container">
    <div id="ai-page-messages"></div>
    <form id="ai-page-form">
      <textarea id="ai-page-input"></textarea>
      <button id="ai-page-send-btn" type="submit"></button>
    </form>
  </div>`;

const STORAGE_KEY = 'rj_chat_sessions';

function sseBody(frames) {
  const encoder = new TextEncoder();
  const chunks = frames.map((frame) => encoder.encode(`${frame}\n`));
  return {
    getReader() {
      let i = 0;
      return {
        read: async () => (i < chunks.length
          ? { value: chunks[i++], done: false }
          : { value: undefined, done: true }),
        cancel: async () => {},
        releaseLock() {},
      };
    },
  };
}

/** A request that never answers until its signal aborts - then rejects as fetch does. */
function pendingUntilAborted(options) {
  return new Promise((_resolve, reject) => {
    options.signal?.addEventListener('abort', () => {
      reject(new DOMException('The operation was aborted.', 'AbortError'));
    });
  });
}

describe('Chat Stop and busy state', () => {
  let dom;
  let initChat;
  let calls;
  let handlers;

  before(async () => {
    dom = new JSDOM(`<!DOCTYPE html><html><body>${BODY}</body></html>`, { url: 'http://localhost:8080/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;
    global.HTMLElement = dom.window.HTMLElement;
    global.requestAnimationFrame = (cb) => setTimeout(() => cb(0), 0);
    dom.window.matchMedia = () => ({
      matches: false,
      addEventListener() {}, removeEventListener() {},
      addListener() {}, removeListener() {},
    });
    dom.window.Element.prototype.scrollTo = function () {};
    dom.window.Element.prototype.scrollIntoView = function () {};

    global.fetch = async (url, options = {}) => {
      calls.push({ url: String(url), method: options.method || 'GET' });
      const key = Object.keys(handlers).find((k) => String(url).includes(k));
      const handler = key ? handlers[key] : null;
      if (!handler) return { ok: false, status: 404, json: async () => ({}) };
      return handler(String(url), options);
    };

    ({ initChat } = await import('../js/chat.js'));
  });

  after(() => {
    delete global.window;
    delete global.document;
    delete global.localStorage;
    delete global.HTMLElement;
    delete global.fetch;
  });

  beforeEach(() => {
    calls = [];
    handlers = {};
    dom.window.localStorage.clear();
    // Fresh elements each time: initChat() binds to them, and a second
    // initChat() on the same form would submit every turn twice.
    document.body.innerHTML = BODY;
  });

  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
  const streamCalls = () => calls.filter((c) => c.url.includes('/chat/stream'));
  const transcript = () => document.getElementById('ai-page-messages');
  const input = () => document.getElementById('ai-page-input');

  function submit(text) {
    input().value = text;
    document.getElementById('ai-page-form')
      .dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  }

  function pressStop() {
    document.getElementById('ai-page-send-btn')
      .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  }

  it('lets exactly one of two same-tick submits through on a first visit', async () => {
    handlers['/chat/stream'] = async () => ({
      ok: true, status: 200,
      body: sseBody(['data: {"type":"delta","text":"Hello"}', 'data: [DONE]']),
    });
    initChat();
    await settle();

    submit('first');
    submit('second');
    await settle();

    assert.equal(streamCalls().length, 1, 'the second submit must see the turn as busy');
  });

  /* Not Stop, but this is the harness that sends a turn. A turn sent signed in
     is saved to that account, so its row is the account's and must leave this
     browser at sign-out (S9); an anonymous one belongs to nobody. */
  it('tags a conversation with the account a turn was sent from', async () => {
    const jwt = (sub) => `h.${Buffer.from(JSON.stringify({ sub })).toString('base64url')}.s`;
    handlers['/chat/stream'] = async () => ({
      ok: true, status: 200,
      body: sseBody(['data: {"type":"delta","text":"Hello"}', 'data: [DONE]']),
    });
    const activeRow = () => {
      const rows = JSON.parse(dom.window.localStorage.getItem('rj_chat_sessions') || '[]');
      return rows.find((row) => row.id === dom.window.localStorage.getItem('rj_chat_active_session'));
    };

    initChat();
    await settle();
    submit('anonymous turn');
    await settle();
    assert.equal(activeRow().ownerId, undefined, 'an anonymous turn belongs to nobody');

    dom.window.localStorage.setItem('rj_access_token', jwt('user-7'));
    submit('signed-in turn');
    await settle();
    assert.equal(activeRow().ownerId, 'user-7');
  });

  it('Stop during a summary aborts the turn instead of only resetting the UI', async () => {
    // Long enough to cross SUMMARIZE_TOKEN_THRESHOLD, short enough to stay
    // under the anonymous free-message limit.
    const long = 'word '.repeat(6000);
    dom.window.localStorage.setItem(STORAGE_KEY, JSON.stringify([{
      id: '1717171717171', conversationId: '11111111-1111-4111-8111-111111111111', title: 'Long',
      messages: [{ text: long, sender: 'user' }, { text: long, sender: 'bot' }],
      createdAt: 1, updatedAt: 2,
    }]));
    let summaryAborted = false;
    handlers['/chat/summarize'] = async (_url, options) => {
      try {
        return await pendingUntilAborted(options);
      } catch (err) {
        summaryAborted = true;
        throw err;
      }
    };
    handlers['/chat/stream'] = async () => ({
      ok: true, status: 200,
      body: sseBody(['data: {"type":"delta","text":"should never stream"}', 'data: [DONE]']),
    });
    initChat();
    await settle();

    submit('one more question');
    await settle();
    assert.equal(calls.filter((c) => c.url.includes('/chat/summarize')).length, 1, 'precondition: summarising');

    pressStop();
    await settle();

    assert.equal(summaryAborted, true, 'Stop must reach the summary request');
    assert.equal(streamCalls().length, 0, 'a stopped turn must not go on to stream');
    assert.doesNotMatch(transcript().textContent, /should never stream/);
    assert.equal(input().readOnly, false, 'the composer is usable again');
  });

  it('Stop before the response headers is a clean stop, not a connection error', async () => {
    handlers['/chat/stream'] = async (_url, options) => pendingUntilAborted(options);
    initChat();
    await settle();

    submit('hello');
    await settle();
    assert.equal(streamCalls().length, 1, 'precondition: the stream request is in flight');

    pressStop();
    await settle();

    assert.doesNotMatch(transcript().textContent, /Could not reach the assistant/);
    assert.equal(transcript().querySelector('.retry-btn'), null, 'nothing failed, so there is nothing to retry');
    assert.equal(transcript().querySelector('.chat-error-boundary'), null);
    assert.equal(input().readOnly, false);
  });

  it('Stop before the first token does not claim the assistant returned nothing', async () => {
    handlers['/chat/stream'] = async (_url, options) => ({
      ok: true, status: 200,
      body: {
        getReader() {
          return {
            read: () => pendingUntilAborted(options),
            cancel: async () => {},
            releaseLock() {},
          };
        },
      },
    });
    initChat();
    await settle();

    submit('hello');
    await settle();
    pressStop();
    await settle();

    assert.doesNotMatch(transcript().textContent, /did not return a response/);
    assert.equal(transcript().querySelector('.retry-btn'), null);
    assert.equal(transcript().querySelector('.chat-message.bot.streaming'), null, 'no orphaned placeholder');
  });

  /* Codebase review U3 and U10: what a screen reader, and anyone reading the
     widget header, is told about a turn. */
  describe('what the chat announces (U3, U10)', () => {
    const sendBtn = () => document.getElementById('ai-page-send-btn');
    const list = () => document.getElementById('ai-page-messages');

    it('names Stop while streaming and marks the list busy, not the field', async () => {
      handlers['/chat/stream'] = async (_url, options) => pendingUntilAborted(options);
      initChat();
      await settle();

      submit('hello');
      await settle();
      assert.equal(sendBtn().getAttribute('aria-label'), 'Stop generating',
        'the static "Send message" label used to outrank the Stop title');
      assert.equal(list().getAttribute('aria-busy'), 'true');
      assert.equal(input().hasAttribute('aria-busy'), false);

      pressStop();
      await settle();
      assert.equal(sendBtn().getAttribute('aria-label'), 'Send message');
      assert.equal(list().hasAttribute('aria-busy'), false);
    });

    it('says a cut-off reply was cut off, in text, and announces the reply once', async () => {
      handlers['/chat/stream'] = async () => ({
        ok: true, status: 200,
        body: sseBody([
          'data: {"type":"delta","text":"Partial answer"}',
          'data: {"type":"delta","text":"\\n[__TRUNCATED__]"}',
          'data: [DONE]',
        ]),
      });
      initChat();
      await settle();

      const bodyNodes = document.body.children.length;
      submit('a long question');
      await settle();

      const note = transcript().querySelector('.msg-truncated');
      assert.ok(note, 'the truncation note is rendered');
      assert.match(note.textContent, /Cut off at the length limit/);
      assert.doesNotMatch(note.textContent, /2000/, 'the ceiling is the server\'s number, not the client\'s');
      assert.equal(document.getElementById('route-announcer').textContent, 'Response received');
      assert.equal(document.body.children.length, bodyNodes, 'no throwaway live region is appended');
    });

    it('reports offline and back online in the widget header', async () => {
      const realNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
      let online = true;
      Object.defineProperty(globalThis, 'navigator', {
        value: { get onLine() { return online; } }, configurable: true,
      });
      try {
        initChat();
        const status = document.getElementById('chat-status');
        assert.equal(status.textContent, 'Online');

        online = false;
        dom.window.dispatchEvent(new dom.window.Event('offline'));
        assert.equal(status.textContent, 'Offline');
        assert.equal(status.dataset.state, 'offline');

        online = true;
        dom.window.dispatchEvent(new dom.window.Event('online'));
        assert.equal(status.dataset.state, 'online');
      } finally {
        if (realNavigator) Object.defineProperty(globalThis, 'navigator', realNavigator);
        else delete globalThis.navigator;
      }
    });
  });
});
