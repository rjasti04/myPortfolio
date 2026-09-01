import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';

const HTML = `<!DOCTYPE html><html><body>
  <main>
    <section id="about" class="active">
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-number">8+</div><div class="stat-label">Years Experience</div></div>
        <div class="stat-card"><div class="stat-number">99.9%</div><div class="stat-label">Uptime</div></div>
      </div>
    </section>
    <section id="resume"></section>
    <section id="contact"></section>
  </main>
</body></html>`;

function createMemoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
  };
}

describe('Terminal', () => {
  let dom;

  before(() => {
    dom = new JSDOM(HTML);
    global.window = dom.window;
    global.document = dom.window.document;
    global.Node = dom.window.Node;
    global.requestAnimationFrame = (cb) => setTimeout(() => cb(0), 0);
  });

  after(() => {
    delete global.window;
    delete global.document;
    delete global.Node;
    delete global.requestAnimationFrame;
  });

  describe('output builders escape by construction', () => {
    it('renders user text as text, never markup', async () => {
      const out = await import('../js/terminal/output.js');
      const node = out.text('<img src=x onerror=alert(1)>');
      assert.strictEqual(node.querySelector('img'), null);
      assert.match(node.innerHTML, /&lt;img/);
      assert.strictEqual(node.textContent, '<img src=x onerror=alert(1)>');
    });

    it('escapes inside list labels and values', async () => {
      const out = await import('../js/terminal/output.js');
      const node = out.list([['<b>k</b>', '<i>v</i>']]);
      assert.strictEqual(node.querySelectorAll('b, i').length, 0);
    });

    it('echoLine keeps the prompt span separate from the typed text', async () => {
      const out = await import('../js/terminal/output.js');
      const node = out.echoLine('<script>x</script>');
      assert.strictEqual(node.querySelector('script'), null);
      assert.strictEqual(node.querySelector('.prompt').textContent, '$');
    });

    it('columns pads keys to a common width', async () => {
      const out = await import('../js/terminal/output.js');
      const node = out.columns([['ls', 'list'], ['whoami', 'me']]);
      const keys = [...node.querySelectorAll('strong')].map((n) => n.textContent);
      assert.strictEqual(keys[0].length, keys[1].length);
      assert.strictEqual(keys[0], 'ls    ');
    });
  });

  describe('history', () => {
    let history;
    let storage;

    beforeEach(async () => {
      const { createHistory } = await import('../js/terminal/history.js');
      storage = createMemoryStorage();
      history = createHistory({ storage, key: 'test_history' });
    });

    it('collapses immediate repeats', () => {
      history.push('help');
      history.push('help');
      history.push('ls');
      assert.deepStrictEqual(history.all(), ['help', 'ls']);
    });

    it('walks backwards and forwards', () => {
      history.push('a');
      history.push('b');
      assert.strictEqual(history.prev(), 'b');
      assert.strictEqual(history.prev(), 'a');
      assert.strictEqual(history.prev(), 'a');
      assert.strictEqual(history.next(), 'b');
      assert.strictEqual(history.next(), '');
    });

    it('keeps surviving entries when one is oversized', async () => {
      const { createHistory } = await import('../js/terminal/history.js');
      const s = createMemoryStorage();
      s.setItem('test_history', JSON.stringify(['ok', 'x'.repeat(900), 'fine']));
      const h = createHistory({ storage: s, key: 'test_history' });
      const all = h.all();
      assert.strictEqual(all.length, 3);
      assert.strictEqual(all[1].length, 500);
      assert.strictEqual(all[2], 'fine');
    });

    it('survives unparseable stored data', async () => {
      const { createHistory } = await import('../js/terminal/history.js');
      const s = createMemoryStorage();
      s.setItem('test_history', 'not json');
      assert.deepStrictEqual(createHistory({ storage: s, key: 'test_history' }).all(), []);
    });

    it('persists on flush', () => {
      history.push('date');
      history.flush();
      assert.deepStrictEqual(JSON.parse(storage.getItem('test_history')), ['date']);
    });
  });

  describe('registry', () => {
    it('hides hidden commands from help, names and chips', async () => {
      const { createRegistry } = await import('../js/terminal/registry.js');
      const registry = createRegistry();
      assert.ok(registry.get('sudo'), 'sudo is still runnable');
      assert.ok(!registry.names().includes('sudo'), 'sudo is not completable');
      assert.ok(!registry.visible().some((c) => c.name === 'sudo'));
    });

    it('documents every runnable command (no help drift)', async () => {
      const { createRegistry } = await import('../js/terminal/registry.js');
      const registry = createRegistry();
      for (const command of registry.visible()) {
        assert.ok(command.summary, `${command.name} has a summary`);
        assert.ok(command.usage, `${command.name} has a usage`);
      }
      // echo used to be special-cased outside the command table.
      assert.ok(registry.get('echo'));
    });

  });

  describe('commands', () => {
    let registry;
    let ctx;
    let navigated;

    beforeEach(async () => {
      const { createRegistry } = await import('../js/terminal/registry.js');
      const { createHistory } = await import('../js/terminal/history.js');
      registry = createRegistry();
      navigated = [];
      ctx = {
        registry,
        history: createHistory({ storage: createMemoryStorage(), key: 'k' }),
        sections: () => ['about', 'resume', 'contact'],
        stats: () => [{ value: '8+', label: 'Years Experience' }],
        navigate: (t) => navigated.push(t),
        download: () => navigated.push('download'),
        toggleTheme: () => true,
        toggleMatrix: () => true,
        clear: () => navigated.push('clear'),
      };
    });

    // Commands may be sync or async; the runner awaits either, so tests do too.
    const run = async (name, args = []) => registry.get(name).run(ctx, args);

    it('help lists exactly the visible commands', async () => {
      const node = await run('help');
      assert.strictEqual(node.querySelectorAll('li').length, registry.visible().length);
    });

    it('cd rejects unknown sections and navigates to known ones', async () => {
      assert.match((await run('cd', ['nope'])).textContent, /No such directory/);
      assert.strictEqual(navigated.length, 0);
      await run('cd', ['resume']);
      assert.deepStrictEqual(navigated, ['resume']);
    });

    it('calc evaluates and rejects non-arithmetic input', async () => {
      assert.strictEqual((await run('calc', ['2', '+', '3', '*', '4'])).textContent, '14');
      assert.match((await run('calc', ['alert(1)'])).textContent, /invalid characters/);
      assert.match((await run('calc', ['1/0'])).textContent, /invalid expression/);
    });

    it('cowsay sizes its box from the raw text, not the escaped text', async () => {
      // Escaping before truncating used to turn `&` into `&amp;`, slicing
      // entities in half and drawing a box five characters too wide.
      const art = (await run('cowsay', ['a&b'])).textContent.split('\n');
      assert.strictEqual(art[1], '< a&b >');
      assert.strictEqual(art[0].trim().length, 5);
    });

    it('cowsay truncates to 40 raw characters', async () => {
      const said = (await run('cowsay', ['x'.repeat(80)])).textContent.split('\n')[1];
      assert.strictEqual(said, `< ${'x'.repeat(40)} >`);
    });



    it('stats reads the values it is given', async () => {
      assert.match((await run('stats')).textContent, /Years Experience/);
    });

    it('echo is a normal registry command', async () => {
      assert.strictEqual((await run('echo', ['hello', 'world'])).textContent, 'hello world');
    });
  });

  describe('completion', () => {
    let registry;
    let ctx;

    beforeEach(async () => {
      const { createRegistry } = await import('../js/terminal/registry.js');
      registry = createRegistry();
      ctx = { registry, sections: () => ['about', 'resume', 'contact'] };
    });

    it('finds the longest common prefix', async () => {
      const { commonPrefix } = await import('../js/terminal/keymap.js');
      assert.strictEqual(commonPrefix(['cat', 'car', 'cab']), 'ca');
      assert.strictEqual(commonPrefix(['ls']), 'ls');
      assert.strictEqual(commonPrefix(['ls', 'help']), '');
    });

    it('completes a unique command name', async () => {
      const { completeInput } = await import('../js/terminal/keymap.js');
      assert.strictEqual(completeInput('who', registry, ctx).value, 'whoami ');
    });

    it('completes command arguments, not just command names', async () => {
      const { completeInput } = await import('../js/terminal/keymap.js');
      assert.strictEqual(completeInput('cd re', registry, ctx).value, 'cd resume ');
    });

    it('reports ambiguity without over-inserting', async () => {
      const { completeInput } = await import('../js/terminal/keymap.js');
      const { value, matches } = completeInput('cd c', registry, ctx);
      assert.deepStrictEqual(matches, ['contact']);
      assert.strictEqual(value, 'cd contact ');
    });

    it('never completes a hidden command', async () => {
      const { completeInput } = await import('../js/terminal/keymap.js');
      assert.deepStrictEqual(completeInput('sud', registry, ctx).matches, []);
    });
  });

  describe('keymap', () => {
    it('maps keys to intents', async () => {
      const { intentFor, Intent } = await import('../js/terminal/keymap.js');
      const key = (k, extra = {}) => ({ key: k, ctrlKey: false, metaKey: false, ...extra });
      assert.strictEqual(intentFor(key('Enter')), Intent.SUBMIT);
      assert.strictEqual(intentFor(key('ArrowUp')), Intent.HIST_PREV);
      assert.strictEqual(intentFor(key('Tab')), Intent.COMPLETE);
      assert.strictEqual(intentFor(key('l', { ctrlKey: true })), Intent.CLEAR);
      assert.strictEqual(intentFor(key('c', { ctrlKey: true })), Intent.ABORT);
      assert.strictEqual(intentFor(key('a')), Intent.NONE);
    });
  });
});
