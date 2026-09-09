import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';

/* The chat UI's server-history path. ai_conversations, its service, its
   migration and three routed endpoints all shipped with no browser caller, so
   a signed-in visitor's transcripts lived only in localStorage. */

const HTML = `<!DOCTYPE html><html><body>
  <div id="chat-widget"><div id="chat-messages"></div></div>
  <div id="ai-sidebar-history"></div>
  <button id="clear-all-btn" type="button">Clear all</button>
  <div id="ai-page-container"><div id="ai-page-messages"></div></div>
</body></html>`;

const AUTH_TOKEN_KEY = 'rj_access_token';
const STORAGE_KEY = 'rj_chat_sessions';

function conversation(id, title, updated) {
  return {
    id,
    title,
    model_id: 'test-model',
    message_count: 2,
    created_at: updated,
    updated_at: updated,
  };
}

describe('Chat server-history sync', () => {
  let dom;
  let initChat;
  let calls;
  let handlers;

  before(async () => {
    dom = new JSDOM(HTML, { url: 'http://localhost:8080/' });
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
    document.getElementById('ai-sidebar-history').replaceChildren();
    document.getElementById('ai-page-messages').replaceChildren();
    document.getElementById('chat-messages').replaceChildren();
  });

  const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
  const stored = () => JSON.parse(dom.window.localStorage.getItem(STORAGE_KEY) || '[]');
  const rows = () => [...document.querySelectorAll('.history-item-open')].map((b) => b.textContent);

  it('gives every conversation a UUID the server will accept', async () => {
    initChat();
    await settle();
    const [session] = stored();
    assert.match(
      session.conversationId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      'conversation_id must be a v4 UUID: the route parses it with uuid.UUID() and skips the save on ValueError'
    );
  });

  for (const [label, corrupt] of [
    ['null', 'null'],
    ['an object', '{"a":1}'],
    ['a bare number', '42'],
    ['a string', '"nope"'],
  ]) {
    it(`survives ${label} in stored history instead of taking the page down`, async () => {
      // JSON.parse succeeding says nothing about the shape. `null` made the
      // length check throw and an object left `.length` undefined so `.some`
      // threw instead - either way initChat() died and the AI page rendered
      // with no transcript, no rail and no error state.
      dom.window.localStorage.setItem(STORAGE_KEY, corrupt);
      assert.doesNotThrow(() => initChat(), `stored ${label} must not break initChat`);
      await settle();
      assert.ok(Array.isArray(stored()), 'a usable session list is restored');
      assert.equal(stored().length, 1, 'a fresh conversation replaces the unusable value');
    });
  }

  it('drops entries that are not conversation objects', async () => {
    dom.window.localStorage.setItem(STORAGE_KEY, JSON.stringify([
      null,
      'not-a-session',
      { id: '1717171717171', title: 'Real', messages: [], createdAt: 1, updatedAt: 2 },
    ]));
    initChat();
    await settle();
    assert.equal(stored().length, 1, 'only the real conversation survives');
    assert.equal(stored()[0].title, 'Real');
  });

  it('backfills conversations stored before conversationId existed', async () => {
    // Exactly the shape saveSessions() wrote before this shipped.
    dom.window.localStorage.setItem(STORAGE_KEY, JSON.stringify([
      { id: '1717171717171', title: 'Old chat', messages: [], createdAt: 1, updatedAt: 2 },
    ]));
    initChat();
    await settle();
    const [session] = stored();
    assert.equal(session.id, '1717171717171', 'the local key must not move');
    assert.ok(session.conversationId, 'but it needs a server id now');
  });

  it('does not call the history API when signed out', async () => {
    initChat();
    await settle();
    assert.equal(calls.filter((c) => c.url.includes('/chat/history')).length, 0);
  });

  it('merges server conversations into the rail when signed in', async () => {
    dom.window.localStorage.setItem(AUTH_TOKEN_KEY, 'token');
    handlers['/chat/history'] = async () => ({
      ok: true, status: 200,
      json: async () => ({ conversations: [conversation('11111111-1111-4111-8111-111111111111', 'From another device', '2026-01-01T00:00:00Z')] }),
    });
    initChat();
    await settle();
    assert.ok(rows().includes('From another device'), `expected the remote row in ${JSON.stringify(rows())}`);
  });

  it('fetches a stub transcript only when it is opened', async () => {
    dom.window.localStorage.setItem(AUTH_TOKEN_KEY, 'token');
    const id = '22222222-2222-4222-8222-222222222222';
    handlers['/chat/history'] = async (url) => {
      if (url.endsWith(`/chat/history/${id}`)) {
        return {
          ok: true, status: 200,
          json: async () => ({ id, title: 'Remote', messages: [
            { role: 'user', content: 'Question from my phone' },
            { role: 'assistant', content: 'Answer from my phone' },
          ] }),
        };
      }
      return { ok: true, status: 200, json: async () => ({ conversations: [conversation(id, 'Remote', '2026-01-01T00:00:00Z')] }) };
    };
    initChat();
    await settle();

    // The listing is summaries only; nothing has asked for the payload yet.
    assert.equal(calls.filter((c) => c.url.endsWith(`/chat/history/${id}`)).length, 0);

    [...document.querySelectorAll('.history-item-open')]
      .find((b) => b.textContent === 'Remote')
      .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await settle();

    assert.equal(calls.filter((c) => c.url.endsWith(`/chat/history/${id}`)).length, 1);
    assert.match(document.getElementById('ai-page-messages').textContent, /Answer from my phone/);
  });

  it('reports a failed transcript load instead of rendering it empty', async () => {
    dom.window.localStorage.setItem(AUTH_TOKEN_KEY, 'token');
    const id = '33333333-3333-4333-8333-333333333333';
    handlers['/chat/history'] = async (url) => {
      if (url.endsWith(`/chat/history/${id}`)) return { ok: false, status: 500, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ conversations: [conversation(id, 'Breaks', '2026-01-01T00:00:00Z')] }) };
    };
    initChat();
    await settle();
    [...document.querySelectorAll('.history-item-open')]
      .find((b) => b.textContent === 'Breaks')
      .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await settle();

    const notice = document.querySelector('#ai-page-messages .chat-transcript-error');
    assert.ok(notice, 'a failed load must not look like an empty conversation');
    assert.equal(notice.getAttribute('role'), 'alert');
    assert.ok(notice.querySelector('.chat-transcript-retry'), 'and must offer a retry');
  });

  it('drops a stub the server no longer has', async () => {
    dom.window.localStorage.setItem(AUTH_TOKEN_KEY, 'token');
    const id = '44444444-4444-4444-8444-444444444444';
    handlers['/chat/history'] = async (url) => {
      if (url.endsWith(`/chat/history/${id}`)) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ conversations: [conversation(id, 'Deleted elsewhere', '2026-01-01T00:00:00Z')] }) };
    };
    initChat();
    await settle();
    [...document.querySelectorAll('.history-item-open')]
      .find((b) => b.textContent === 'Deleted elsewhere')
      .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await settle();

    assert.ok(!rows().includes('Deleted elsewhere'), 'a 404 stub must not stay in the rail');
  });

  it('deletes the server copy too, or the next sync brings it back', async () => {
    dom.window.localStorage.setItem(AUTH_TOKEN_KEY, 'token');
    const id = '55555555-5555-4555-8555-555555555555';
    handlers['/chat/history'] = async (url, options) => {
      if (options.method === 'DELETE') return { ok: true, status: 200, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ conversations: [conversation(id, 'Goes away', '2026-01-01T00:00:00Z')] }) };
    };
    initChat();
    await settle();

    const row = [...document.querySelectorAll('.history-item')]
      .find((el) => el.querySelector('.history-item-open')?.textContent === 'Goes away');
    row.querySelector('.session-menu-btn').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    row.querySelector('.dropdown-item.danger').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await settle();
    document.querySelector('.confirm-modal-confirm').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await settle();

    const deletes = calls.filter((c) => c.method === 'DELETE' && c.url.endsWith(`/chat/history/${id}`));
    assert.equal(deletes.length, 1, `expected one DELETE, saw ${JSON.stringify(calls)}`);
    assert.ok(!rows().includes('Goes away'));
  });

  it('clears the server history too, in one request, on Delete all', async () => {
    dom.window.localStorage.setItem(AUTH_TOKEN_KEY, 'token');
    const id = '66666666-6666-4666-8666-666666666666';
    handlers['/chat/history'] = async (url, options) => {
      if (options.method === 'DELETE') return { ok: true, status: 200, json: async () => ({ deleted: 1 }) };
      return { ok: true, status: 200, json: async () => ({ conversations: [conversation(id, 'Comes back', '2026-01-01T00:00:00Z')] }) };
    };
    initChat();
    await settle();
    assert.ok(rows().includes('Comes back'));

    document.getElementById('clear-all-btn')
      .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await settle();
    document.querySelector('.confirm-modal-confirm')
      .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await settle();

    const deletes = calls.filter((c) => c.method === 'DELETE');
    assert.deepEqual(
      deletes.map((c) => c.url.replace(/^.*\/chat/, '/chat')),
      ['/chat/history'],
      `Delete all must issue one bulk DELETE, not a per-row loop and not nothing: ${JSON.stringify(calls)}`
    );
    assert.ok(!rows().includes('Comes back'));
  });

  it('leaves the server alone when a signed-out visitor clears history', async () => {
    initChat();
    await settle();
    document.getElementById('clear-all-btn')
      .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await settle();
    document.querySelector('.confirm-modal-confirm')
      .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await settle();

    assert.equal(calls.filter((c) => c.url.includes('/chat/history')).length, 0);
  });

  it('says so when the server copy could not be cleared', async () => {
    dom.window.localStorage.setItem(AUTH_TOKEN_KEY, 'token');
    handlers['/chat/history'] = async (url, options) => {
      if (options.method === 'DELETE') return { ok: false, status: 500, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ conversations: [] }) };
    };
    initChat();
    await settle();
    document.getElementById('clear-all-btn')
      .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await settle();
    document.querySelector('.confirm-modal-confirm')
      .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await settle();

    const notice = document.querySelector('#ai-page-messages .chat-transcript-error');
    assert.ok(notice, 'a history that will reappear must not report as cleared');
    assert.equal(notice.getAttribute('role'), 'alert');
  });

  it('survives an unreachable history API', async () => {
    dom.window.localStorage.setItem(AUTH_TOKEN_KEY, 'token');
    handlers['/chat/history'] = async () => { throw new Error('offline'); };
    initChat();
    await settle();
    // The portfolio never depends on the API: a local conversation is still there.
    assert.equal(rows().length, 1);
  });
});
