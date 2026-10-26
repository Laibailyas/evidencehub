const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Exercise the actual Sidebar component/effects with synthetic API responses.
// No DOM, credentials, network requests, or third-party test dependencies.
function sidebarHarness(listProjects, enabled = true) {
  const slots = [];
  let cursor = 0;
  let location = { key: 'initial' };
  let tree;
  const pending = [];
  const NavLink = () => {};
  const jsx = (type, props) => ({ type, props });
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], value => { slots[index] = value; }];
    },
    useEffect(effect, deps) {
      const index = cursor++;
      const previous = slots[index];
      if (!previous || deps.some((value, i) => value !== previous.deps[i])) {
        previous?.cleanup?.();
        slots[index] = { deps };
        pending.push(() => { slots[index].cleanup = effect(); });
      }
    },
  };
  const modules = {
    react: hooks,
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'fragment' },
    'react-router-dom': { NavLink, useLocation: () => location },
    'lucide-react': {},
    '../i18n/useTranslation': { useTranslation: () => ({ t: key => key }) },
    '../lib/session': {
      getSessionUser: () => ({ id: 'synthetic-owner', name: 'Synthetic owner', role: 'user' }),
      initials: () => 'SO',
    },
    '../lib/api': { API_ENABLED: enabled, api: { listProjects } },
    './Logo': { default: () => null },
  };
  const source = fs.readFileSync(path.join(__dirname, '../src/components/Sidebar.tsx'), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  vm.runInNewContext(output, {
    exports,
    require: name => { assert.ok(name in modules, `Unexpected dependency: ${name}`); return modules[name]; },
    console: { warn() {} },
  });
  function render(key = location.key) {
    location = { key };
    cursor = 0;
    tree = exports.default({});
    pending.splice(0).forEach(effect => effect());
  }
  function links(node) {
    if (!node || typeof node !== 'object') return [];
    if (Array.isArray(node)) return node.flatMap(links);
    const own = node.type === NavLink && node.props.to.startsWith('/project/') ? [node.props.to] : [];
    return own.concat(links(node.props?.children));
  }
  return { render, links: () => links(tree), settle: () => new Promise(resolve => setImmediate(resolve)) };
}

const project = id => ({ id, title: `Synthetic owned project ${id}`, domains: ['Energy'] });

test('History includes every owned result beyond five, with reopen links', async () => {
  const records = Array.from({ length: 8 }, (_, i) => project(`owned-${i}`));
  const h = sidebarHarness(async () => records);
  h.render(); await h.settle(); h.render();
  assert.deepEqual(h.links(), records.map(p => `/project/${encodeURIComponent(p.id)}`));
});

test('persistent Sidebar refreshes after navigation without refetching on ordinary renders', async () => {
  let records = [project('older')];
  let calls = 0;
  const h = sidebarHarness(async () => { calls++; return records; });
  h.render(); await h.settle(); h.render();
  assert.equal(calls, 1);
  records = [project('new'), project('older')];
  h.render('after-create'); await h.settle(); h.render();
  assert.equal(calls, 2);
  assert.deepEqual(h.links(), ['/project/new', '/project/older']);
});

test('a superseded response cannot overwrite the refreshed owner list', async () => {
  let resolveOld;
  let calls = 0;
  const h = sidebarHarness(() => ++calls === 1
    ? new Promise(resolve => { resolveOld = resolve; })
    : Promise.resolve([project('current')]));
  h.render(); h.render('next-page'); await h.settle();
  resolveOld([project('stale')]); await h.settle(); h.render();
  assert.deepEqual(h.links(), ['/project/current']);
});

test('API failure and disabled API never introduce demo/global project links', async () => {
  const h = sidebarHarness(async () => { throw new Error('Synthetic failure'); });
  h.render(); await h.settle(); h.render();
  assert.deepEqual(h.links(), []);
  const offline = sidebarHarness(() => { throw new Error('Must not call API'); }, false);
  offline.render(); await offline.settle(); offline.render();
  assert.deepEqual(offline.links(), []);
});
