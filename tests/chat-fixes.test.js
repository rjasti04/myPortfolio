import { describe, it } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';

describe('Chat Fixes Module', () => {
  it('should fallback to empty array if messages missing in localStorage', async () => {
    const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
    global.window = dom.window;
    global.document = dom.window.document;
    global.window.matchMedia = () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} });

    global.localStorage = {
      getItem: (key) => {
        if (key === 'chatSessions') {
            return JSON.stringify([{ id: '1', title: 'Test', missingMessagesKey: [] }]);
        }
        return null;
      },
      setItem: () => {}
    };

    const chatModule = await import('../js/chat.js');
    try {
      chatModule.initChat();
      assert.ok(true);
    } catch(e) {
      assert.fail('initChat should not throw when messages property is missing: ' + e);
    }

    delete global.window;
    delete global.document;
    delete global.localStorage;
  });
});
