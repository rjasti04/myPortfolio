import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';

/* The owner-only aggregate panel. Everything else in the Activity section is
   the visitor's own session; this reads across every session, so the gating
   matters more than the rendering. */

const AUTH_TOKEN_KEY = 'rj_access_token';

describe('Owner analytics panel', () => {
  let dom;
  let initOwnerAnalytics;
  let respond;
  let calls;

  before(async () => {
    dom = new JSDOM('<!DOCTYPE html><html><body><div id="act-owner" hidden></div></body></html>', {
      url: 'http://localhost:8080/',
    });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;
    global.HTMLElement = dom.window.HTMLElement;
    global.fetch = async (url) => {
      calls.push(String(url));
      return respond(String(url));
    };
    ({ initOwnerAnalytics } = await import('../js/owner-analytics.js'));
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
    dom.window.localStorage.clear();
    const root = document.getElementById('act-owner');
    root.hidden = true;
    root.replaceChildren();
  });

  const ok = (body) => ({ ok: true, status: 200, json: async () => body });
  const status = (code) => ({ ok: false, status: code, json: async () => ({}) });

  const FIXTURES = {
    overview: {
      window_days: 30, sessions: 12, distinct_ips: 9, active_sessions: 1,
      devices: [{ device: 'desktop', count: 8 }, { device: 'mobile', count: 4 }],
      event_types: [{ type: 'page_view', count: 40 }, { type: 'click', count: 12 }],
      daily_events: [{ day: '2026-09-01', count: 20 }],
    },
    funnel: {
      window_days: 30, total_hits: 40,
      steps: [{ path: '/#resume', hits: 25, sessions: 8, share: 0.62 }],
      transitions: [{ from: '/#resume', to: '/#contact', weight: 6 }],
    },
    commands: {
      window_days: 30,
      commands: [
        { command: 'skills', runs: 9, sessions: 5, recognised: 9 },
        { command: '__unknown__', runs: 3, sessions: 3, recognised: 0 },
      ],
    },
    llm: {
      window_days: 30, turns: 20, input_tokens: 5000, output_tokens: 1800,
      cache_read_tokens: 400, cache_creation_tokens: 100, cache_hits: 15,
      cache_hit_rate: 0.75, mean_latency_ms: 812.4,
      by_model: [{ model_id: 'test-model', turns: 20, input_tokens: 5000, output_tokens: 1800 }],
    },
  };

  const serveAll = () => (url) => {
    const key = Object.keys(FIXTURES).find((k) => url.includes(`/analytics/${k}`));
    return key ? ok(FIXTURES[key]) : status(404);
  };

  it('asks for nothing when signed out', async () => {
    respond = serveAll();
    await initOwnerAnalytics();
    assert.equal(calls.length, 0);
    assert.equal(document.getElementById('act-owner').hidden, true);
  });

  it('stays hidden for a signed-in visitor who is not the owner', async () => {
    dom.window.localStorage.setItem(AUTH_TOKEN_KEY, 'token');
    respond = () => status(403);
    await initOwnerAnalytics();
    const root = document.getElementById('act-owner');
    assert.equal(root.hidden, true, 'a 403 must leave the section as a visitor sees it');
    assert.equal(root.textContent, '', 'and must not ship an empty shell');
  });

  it('renders every panel for the owner', async () => {
    dom.window.localStorage.setItem(AUTH_TOKEN_KEY, 'token');
    respond = serveAll();
    await initOwnerAnalytics();

    const root = document.getElementById('act-owner');
    assert.equal(root.hidden, false);
    const titles = [...root.querySelectorAll('.act-owner-card-title')].map((n) => n.textContent);
    assert.deepEqual(titles, [
      'Reach', 'Event mix', 'Devices', 'Where visitors go', 'Terminal commands', 'Bedrock usage',
    ]);
    assert.match(root.textContent, /12/);          // sessions
    assert.match(root.textContent, /\/#resume/);   // reused renderPaths output
    assert.match(root.textContent, /75%/);         // cache hit rate
  });

  it('flags commands that were typed but not recognised', async () => {
    dom.window.localStorage.setItem(AUTH_TOKEN_KEY, 'token');
    respond = serveAll();
    await initOwnerAnalytics();
    // A command typed but not recognised is a feature request in disguise.
    assert.match(document.getElementById('act-owner').textContent, /not recognised/);
  });

  it('reports a failed panel instead of rendering it as zeroes', async () => {
    dom.window.localStorage.setItem(AUTH_TOKEN_KEY, 'token');
    const all = serveAll();
    respond = (url) => (url.includes('/analytics/llm') ? status(500) : all(url));
    await initOwnerAnalytics();

    const failed = document.querySelector('.act-owner-card--error');
    assert.ok(failed, 'a 500 must not be painted as a measurement');
    assert.equal(failed.querySelector('.act-owner-empty').getAttribute('role'), 'alert');
    // The panels that did load are unaffected.
    assert.match(document.getElementById('act-owner').textContent, /Reach/);
  });

  it('requests every panel over the same window, and can change it', async () => {
    dom.window.localStorage.setItem(AUTH_TOKEN_KEY, 'token');
    respond = serveAll();
    await initOwnerAnalytics();
    assert.equal(calls.filter((u) => u.includes('days=30')).length, 4);

    calls.length = 0;
    document.querySelector('.act-owner-window-btn[data-days="90"]')
      .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(calls.filter((u) => u.includes('days=90')).length, 4);
  });

  it('takes the panel down on sign-out', async () => {
    dom.window.localStorage.setItem(AUTH_TOKEN_KEY, 'token');
    respond = serveAll();
    await initOwnerAnalytics();
    assert.equal(document.getElementById('act-owner').hidden, false);

    // Whoever is at the browser next must not see the previous owner's figures.
    dom.window.localStorage.clear();
    await initOwnerAnalytics();
    const root = document.getElementById('act-owner');
    assert.equal(root.hidden, true);
    assert.equal(root.textContent, '');
  });
});
