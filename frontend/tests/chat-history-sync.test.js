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

  /* C5: `hydrating` was persisted while still true, so after a reload the
     conversation painted "Loading this conversation…" and the hydrating guard
     refused to refetch it. Invariant: the spinner is painted only while a
     GET /chat/history/{id} is actually in flight. */
  const transcript = () => document.getElementById('ai-page-messages');
  const stubId = (n) => `${String(n).padStart(8, '0')}-7777-4777-8777-777777777777`;
  const storeActiveStub = (id, extra = {}) => {
    dom.window.localStorage.setItem(STORAGE_KEY, JSON.stringify([{
      id: `remote-${id}`, conversationId: id, title: 'Stub', messages: [],
      createdAt: 1, updatedAt: 2, remote: true, messageCount: 2, ...extra,
    }]));
    dom.window.localStorage.setItem('rj_chat_active_session', `remote-${id}`);
  };
  const transcriptHandler = (id, answer) => async (url) => {
    if (url.endsWith(`/chat/history/${id}`)) {
      return {
        ok: true, status: 200,
        json: async () => ({ id, messages: [
          { role: 'user', content: 'Q' }, { role: 'assistant', content: answer },
        ] }),
      };
    }
    return { ok: true, status: 200, json: async () => ({ conversations: [] }) };
  };

  it('never persists the per-view hydrating or loadError flags', async () => {
    dom.window.localStorage.setItem(AUTH_TOKEN_KEY, 'token');
    const id = stubId(1);
    handlers['/chat/history'] = async (url) => {
      if (url.endsWith(`/chat/history/${id}`)) return transcriptHandler(id, 'A')(url);
      return { ok: true, status: 200, json: async () => ({ conversations: [conversation(id, 'Hydrates', '2026-01-01T00:00:00Z')] }) };
    };
    initChat();
    await settle();
    [...document.querySelectorAll('.history-item-open')]
      .find((b) => b.textContent === 'Hydrates')
      .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await settle();

    const raw = dom.window.localStorage.getItem(STORAGE_KEY);
    assert.ok(!raw.includes('"hydrating"'), `hydrating was persisted: ${raw}`);
    assert.ok(!raw.includes('"loadError"'), `loadError was persisted: ${raw}`);
  });

  it('recovers a conversation stored mid-hydration by an older build', async () => {
    dom.window.localStorage.setItem(AUTH_TOKEN_KEY, 'token');
    const id = stubId(2);
    storeActiveStub(id, { hydrating: true });
    handlers['/chat/history'] = transcriptHandler(id, 'Recovered answer');
    initChat();
    await settle();

    assert.equal(calls.filter((c) => c.url.endsWith(`/chat/history/${id}`)).length, 1,
      'a stored hydrating flag must not block the fetch');
    assert.match(transcript().textContent, /Recovered answer/);
    assert.equal(transcript().querySelector('.chat-transcript-loading'), null);
  });

  it('fetches the active stub on load instead of painting a spinner forever', async () => {
    dom.window.localStorage.setItem(AUTH_TOKEN_KEY, 'token');
    const id = stubId(3);
    storeActiveStub(id);
    handlers['/chat/history'] = transcriptHandler(id, 'Loaded on reload');
    initChat();
    await settle();

    assert.equal(calls.filter((c) => c.url.endsWith(`/chat/history/${id}`)).length, 1);
    assert.match(transcript().textContent, /Loaded on reload/);
  });

  it('says why a stub cannot load when signed out, rather than spinning', async () => {
    // Signed out at load, a stub is dropped outright (S9, below). What is left
    // for this notice is a sign-out in *another* tab, which fires no
    // auth-changed here: the token goes from storage and the rail still
    // holds the account's stub.
    dom.window.localStorage.setItem(AUTH_TOKEN_KEY, 'token');
    const id = stubId(4);
    handlers['/chat/history'] = async () => ({
      ok: true, status: 200,
      json: async () => ({ conversations: [conversation(id, 'Elsewhere', '2026-01-01T00:00:00Z')] }),
    });
    initChat();
    await settle();

    dom.window.localStorage.removeItem(AUTH_TOKEN_KEY);
    [...document.querySelectorAll('.history-item-open')]
      .find((b) => b.textContent === 'Elsewhere')
      .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await settle();

    assert.equal(transcript().querySelector('.chat-transcript-loading'), null,
      'nothing is in flight, so nothing may say it is loading');
    const notice = transcript().querySelector('.chat-transcript-error');
    assert.ok(notice, 'a stub nobody can fetch must say so');
    assert.match(notice.textContent, /Sign in/);
  });

  /* C11 */
  it('repaints the newly active conversation when an opened stub 404s', async () => {
    dom.window.localStorage.setItem(AUTH_TOKEN_KEY, 'token');
    const id = stubId(5);
    handlers['/chat/history'] = async (url) => {
      if (url.endsWith(`/chat/history/${id}`)) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ conversations: [conversation(id, 'Gone', '2026-01-01T00:00:00Z')] }) };
    };
    initChat();
    await settle();
    [...document.querySelectorAll('.history-item-open')]
      .find((b) => b.textContent === 'Gone')
      .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await settle();

    assert.equal(transcript().querySelector('.chat-transcript-loading'), null,
      "the dropped stub's Loading… must not stay on screen");
  });

  for (const [status, expectNotice] of [[500, true], [429, true], [404, false]]) {
    it(`${expectNotice ? 'reports' : 'accepts'} a ${status} when deleting the server copy`, async () => {
      dom.window.localStorage.setItem(AUTH_TOKEN_KEY, 'token');
      const id = stubId(600 + status);
      handlers['/chat/history'] = async (url, options) => {
        if (options.method === 'DELETE') return { ok: false, status, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => ({ conversations: [conversation(id, 'Delete me', '2026-01-01T00:00:00Z')] }) };
      };
      initChat();
      await settle();

      const row = [...document.querySelectorAll('.history-item')]
        .find((el) => el.querySelector('.history-item-open')?.textContent === 'Delete me');
      row.querySelector('.session-menu-btn').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      row.querySelector('.dropdown-item.danger').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await settle();
      document.querySelector('.confirm-modal-confirm').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await settle();

      const notice = transcript().querySelector('.chat-transcript-error');
      if (expectNotice) {
        assert.ok(notice, `a ${status} leaves the server copy, which the next sync brings back`);
        assert.match(notice.textContent, /may reappear/);
      } else {
        assert.equal(notice, null, 'a 404 means it was never saved, which is as gone as deleted');
      }
    });
  }

  it('evicts server stubs before local-only conversations at the 50-row cap', async () => {
    dom.window.localStorage.setItem(AUTH_TOKEN_KEY, 'token');
    const locals = Array.from({ length: 45 }, (_, i) => ({
      id: String(1000 + i),
      conversationId: `${String(i).padStart(8, '0')}-1111-4111-8111-111111111111`,
      title: `Local ${i}`,
      messages: [{ text: 'only here', sender: 'user' }],
      createdAt: 1000 + i,
      updatedAt: 1000 + i,
    }));
    dom.window.localStorage.setItem(STORAGE_KEY, JSON.stringify(locals));
    // Ten server conversations, all newer than every local row.
    const remote = Array.from({ length: 10 }, (_, i) =>
      conversation(stubId(900 + i), `Server ${i}`, `2026-01-${String(10 + i).padStart(2, '0')}T00:00:00Z`));
    handlers['/chat/history'] = async () => ({ ok: true, status: 200, json: async () => ({ conversations: remote }) });

    initChat();
    await settle();

    const kept = stored();
    assert.equal(kept.length, 50);
    const keptLocal = kept.filter((row) => row.title.startsWith('Local '));
    assert.equal(keptLocal.length, 45, 'every local-only transcript survives the sign-in');
    assert.deepEqual(
      kept.filter((row) => row.remote).map((row) => row.title).sort(),
      ['Server 5', 'Server 6', 'Server 7', 'Server 8', 'Server 9'],
      'the newest stubs fill what is left',
    );
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

/* S9 (docs/review/codebase_review_20260924.md): `rj_chat_sessions` kept every
   transcript fetched from an account, so after sign-out the next person on
   the browser saw them in the rail, and a different account signing in
   inherited the previous one's conversation ids.

   A fresh window per test: these dispatch `auth-changed`, and every initChat()
   in a shared window leaves a listener holding its own copy of the rail, all
   of which would answer. */
describe('Chat history belongs to one account', () => {
  let dom;
  let initChat;
  let getTokenSubject;
  let handlers;

  const jwt = (sub) => `h.${Buffer.from(JSON.stringify({ sub })).toString('base64url')}.s`;
  const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
  const stored = () => JSON.parse(dom.window.localStorage.getItem(STORAGE_KEY) || '[]');
  const titles = () => stored().map((row) => row.title).sort();
  const signOut = () => {
    dom.window.localStorage.removeItem(AUTH_TOKEN_KEY);
    dom.window.dispatchEvent(new dom.window.Event('auth-changed'));
  };
  const listing = (...conversations) => async () => ({
    ok: true, status: 200, json: async () => ({ conversations }),
  });
  const local = (id, title, extra = {}) => ({
    id, conversationId: `${id}-0000-4000-8000-000000000000`.slice(0, 36), title,
    messages: [{ text: title, sender: 'user' }], createdAt: Number(id), updatedAt: Number(id),
    ...extra,
  });

  beforeEach(async () => {
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
    handlers = {};
    global.fetch = async (url, options = {}) => {
      const key = Object.keys(handlers).find((k) => String(url).includes(k));
      if (!key) return { ok: false, status: 404, json: async () => ({}) };
      return handlers[key](String(url), options);
    };
    ({ initChat } = await import('../js/chat.js'));
    ({ getTokenSubject } = await import('../js/auth.js'));
  });

  after(() => {
    delete global.window;
    delete global.document;
    delete global.localStorage;
    delete global.HTMLElement;
    delete global.fetch;
  });

  it('reads the account id out of the access token, and nothing out of junk', () => {
    dom.window.localStorage.setItem(AUTH_TOKEN_KEY, jwt('user-1'));
    assert.equal(getTokenSubject(), 'user-1');
    for (const junk of ['token', 'a.b.c', 'a.@@@.c']) {
      dom.window.localStorage.setItem(AUTH_TOKEN_KEY, junk);
      assert.equal(getTokenSubject(), null, junk);
    }
    dom.window.localStorage.removeItem(AUTH_TOKEN_KEY);
    assert.equal(getTokenSubject(), null);
  });

  it('tags the rows an account owns when the server lists them', async () => {
    dom.window.localStorage.setItem(AUTH_TOKEN_KEY, jwt('user-1'));
    const mine = local('1700000000001', 'Typed here, saved there');
    dom.window.localStorage.setItem(STORAGE_KEY, JSON.stringify([mine]));
    handlers['/chat/history'] = listing(
      conversation(mine.conversationId, 'Typed here, saved there', '2026-01-02T00:00:00Z'),
      conversation('99999999-9999-4999-8999-999999999999', 'From my phone', '2026-01-01T00:00:00Z'),
    );
    initChat();
    await settle();

    assert.deepEqual(stored().map((row) => row.ownerId), ['user-1', 'user-1']);
  });

  it('drops the account\'s rows at sign-out and keeps anonymous ones', async () => {
    dom.window.localStorage.setItem(AUTH_TOKEN_KEY, jwt('user-1'));
    dom.window.localStorage.setItem(STORAGE_KEY, JSON.stringify([
      local('1700000000002', 'Mine', { ownerId: 'user-1' }),
      local('1700000000001', 'Anonymous'),
    ]));
    initChat();
    await settle();
    assert.deepEqual(titles(), ['Anonymous', 'Mine']);

    signOut();
    await settle();

    assert.deepEqual(titles(), ['Anonymous'], 'the next person on this browser must not see it');
    assert.ok(!dom.window.localStorage.getItem(STORAGE_KEY).includes('Mine'));
    assert.ok(![...document.querySelectorAll('.history-item-open')].some((b) => b.textContent === 'Mine'));
  });

  it('drops the previous account\'s rows when another one signs in', async () => {
    dom.window.localStorage.setItem(AUTH_TOKEN_KEY, jwt('user-1'));
    dom.window.localStorage.setItem(STORAGE_KEY, JSON.stringify([
      local('1700000000002', 'First account', { ownerId: 'user-1' }),
      local('1700000000001', 'Anonymous'),
    ]));
    initChat();
    await settle();

    // Signed out in another tab, then in again as someone else in this one.
    dom.window.localStorage.setItem(AUTH_TOKEN_KEY, jwt('user-2'));
    handlers['/chat/history'] = listing();
    dom.window.dispatchEvent(new dom.window.Event('auth-changed'));
    await settle();

    assert.deepEqual(titles(), ['Anonymous']);
  });

  it('drops server stubs stored before tagging when nobody is signed in', async () => {
    dom.window.localStorage.setItem(STORAGE_KEY, JSON.stringify([
      local('1700000000002', 'Old stub', { remote: true }),
      local('1700000000001', 'Anonymous'),
    ]));
    initChat();
    await settle();

    assert.deepEqual(titles(), ['Anonymous'], 'an untagged stub is a server row only an account owns');
  });

  it('moves to the newest remaining conversation when the open one goes', async () => {
    dom.window.localStorage.setItem(AUTH_TOKEN_KEY, jwt('user-1'));
    dom.window.localStorage.setItem(STORAGE_KEY, JSON.stringify([
      local('1700000000003', 'Mine', { ownerId: 'user-1' }),
      local('1700000000002', 'Newer anonymous'),
      local('1700000000001', 'Older anonymous'),
    ]));
    dom.window.localStorage.setItem('rj_chat_active_session', '1700000000003');
    initChat();
    await settle();

    signOut();
    await settle();

    assert.equal(dom.window.localStorage.getItem('rj_chat_active_session'), '1700000000002');
    assert.match(document.getElementById('ai-page-messages').textContent, /Newer anonymous/);
    assert.doesNotMatch(document.getElementById('ai-page-messages').textContent, /Mine/);
  });
});
