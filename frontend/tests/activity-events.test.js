// Escaping in the Activity dashboard's event sentences.
//
// `describeEvent` returns HTML - the path chips and the emphasis are the point
// - and `eventRow` puts it into the DOM through innerHTML. `event_data` is the
// visitor's own payload, stored by the API and handed back, so any branch that
// interpolates a field without escaping it is an injection sink. Every branch
// escaped except the click one, which read a raw `data.tag`.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';

describe('describeEvent escaping', () => {
  let dom;
  let describeEvent;

  before(async () => {
    dom = new JSDOM('<!doctype html><html><body></body></html>', {
      url: 'https://rjasti.com/',
    });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;
    global.sessionStorage = dom.window.sessionStorage;
    global.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
    ({ describeEvent } = await import('../js/activity.js'));
  });

  after(() => {
    delete global.window;
    delete global.document;
    delete global.localStorage;
    delete global.sessionStorage;
    delete global.fetch;
    dom?.window?.close();
  });

  it('escapes a click tag carrying markup', () => {
    const { text } = describeEvent({
      event_type: 'click',
      page_path: '/',
      event_data: { tag: '<img src=x onerror=alert(1)>' },
    });
    assert.ok(!text.includes('<img'), 'markup in event_data must not reach innerHTML');
    assert.ok(text.includes('&lt;img'), 'it should render as visible text instead');
  });

  it('does not resolve a click tag up the prototype chain', () => {
    const { text } = describeEvent({
      event_type: 'click',
      page_path: '/',
      event_data: { tag: 'constructor' },
    });
    assert.ok(
      !text.includes('native code'),
      'a bare object lookup returned Object and stringified the function into the sentence'
    );
    assert.ok(text.includes('constructor'), 'the tag is reported as the text it is');
  });

  it('still names the tags it knows', () => {
    const { text } = describeEvent({
      event_type: 'click',
      page_path: '/',
      event_data: { tag: 'A' },
    });
    assert.ok(text.includes('a link'), 'known tags keep their friendly name');
  });

  it('escapes a page_path carrying markup', () => {
    const { text } = describeEvent({
      event_type: 'page_view',
      page_path: '/"><script>alert(1)</script>',
      event_data: {},
    });
    assert.ok(!text.includes('<script>'), 'page_path is visitor-controlled and persisted');
  });
});
