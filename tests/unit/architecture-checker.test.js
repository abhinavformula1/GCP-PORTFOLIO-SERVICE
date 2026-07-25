'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { checkArchitecture } = require('../../scripts/check-architecture');

function fixture(files, { rootFiles = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'architecture-check-'));
  const src = path.join(root, 'src');
  for (const layer of ['domain', 'application', 'interfaces', 'infrastructure', 'main']) {
    fs.mkdirSync(path.join(src, layer), { recursive: true });
  }
  for (const [relative, source] of Object.entries(files)) {
    const file = path.join(src, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, source);
  }
  for (const [relative, source] of Object.entries(rootFiles)) {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, source);
  }
  return {
    root,
    src,
    check() {
      return checkArchitecture({
        repositoryRoot: root,
        srcRoot: src,
        envAllowed: [],
      });
    },
  };
}

test('architecture checker rejects forbidden layer edges', function () {
  const f = fixture({
    'interfaces/route.js': "require('../infrastructure/db');",
    'infrastructure/db.js': 'module.exports = {};',
  });
  assert.match(f.check().failures.join('\n'), /interfaces must not depend on infrastructure/);
});

test('architecture checker rejects unresolved local imports', function () {
  const f = fixture({ 'domain/policy.js': "require('./missing');" });
  assert.match(f.check().failures.join('\n'), /unresolved local import/);
});

test('architecture checker rejects imports escaping src', function () {
  const f = fixture({ 'main/app.js': "require('../../outside');" });
  assert.match(f.check().failures.join('\n'), /local import escapes src/);
});

test('architecture checker rejects environment access outside allowlist', function () {
  const f = fixture({ 'infrastructure/client.js': 'module.exports = process.env.SECRET;' });
  assert.match(f.check().failures.join('\n'), /process\.env access is not allowed/);
});

test('architecture checker reports readable dependency cycles', function () {
  const f = fixture({
    'application/a.js': "require('./b');",
    'application/b.js': "require('./a');",
  });
  const failures = f.check().failures.join('\n');
  assert.match(failures, /dependency cycle:/);
  assert.match(failures, /application\/a\.js -> .*application\/b\.js -> .*application\/a\.js/);
});

test('architecture checker ignores import-like text in comments and strings', function () {
  const f = fixture({
    'domain/policy.js': `
      // require('../infrastructure/database')
      const example = "import('../main/server')";
      const environmentExample = 'process.env.SECRET';
      module.exports = example + environmentExample;
    `,
  });
  assert.deepEqual(f.check().failures, []);
});

test('architecture checker parses ESM and CJS source extensions', function () {
  const f = fixture({
    'domain/index.mjs': "import value from './value.cjs'; export { answer } from './answer.js'; export default value;",
    'domain/value.cjs': 'module.exports = 42;',
    'domain/answer.js': 'export const answer = 42;',
  });
  assert.deepEqual(f.check().failures, []);
});

test('architecture checker tracks literal dynamic imports', function () {
  const allowed = fixture({
    'application/load.mjs': "export async function load() { return import('../domain/value.js'); }",
    'domain/value.js': 'module.exports = 1;',
  });
  assert.deepEqual(allowed.check().failures, []);

  const forbidden = fixture({
    'interfaces/load.js': "async function load() { return import('../infrastructure/value.js'); }",
    'infrastructure/value.js': 'module.exports = 1;',
  });
  assert.match(forbidden.check().failures.join('\n'), /interfaces must not depend on infrastructure/);
});

test('architecture checker rejects computed dynamic loading', function () {
  const f = fixture({
    'main/load.js': `
      const target = './dependency';
      require(target);
      require.resolve(target);
      import(target);
    `,
    'main/dependency.js': 'module.exports = {};',
  });
  const failures = f.check().failures.join('\n');
  assert.match(failures, /non-literal require\(\) is not allowed/);
  assert.match(failures, /non-literal require\.resolve\(\) is not allowed/);
  assert.match(failures, /non-literal import\(\) is not allowed/);
});

test('architecture checker tracks literal require.resolve calls', function () {
  const f = fixture({
    'interfaces/route.js': "module.exports = require.resolve('../infrastructure/database');",
    'infrastructure/database.js': 'module.exports = {};',
  });
  assert.match(f.check().failures.join('\n'), /interfaces must not depend on infrastructure/);
});

test('architecture checker rejects symlink imports escaping src', function (t) {
  const f = fixture({
    'domain/policy.js': "module.exports = require('./linked');",
  }, {
    rootFiles: { 'outside.js': 'module.exports = {};' },
  });
  try {
    fs.symlinkSync(path.join(f.root, 'outside.js'), path.join(f.src, 'domain', 'linked.js'));
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) {
      t.skip(`symlinks unavailable: ${error.code}`);
      return;
    }
    throw error;
  }
  assert.match(f.check().failures.join('\n'), /symlink\/path .*escapes src/);
});

test('architecture checker rejects unknown source layers', function () {
  const f = fixture({
    'experimental/feature.js': 'module.exports = {};',
  });
  assert.match(f.check().failures.join('\n'), /unknown top-level source layer "experimental"/);
});

test('architecture checker rejects root-level bridge imports', function () {
  const f = fixture({
    'main/app.js': "module.exports = require('../../bridge');",
    'main/self.js': "module.exports = require('fixture-service/bridge');",
  }, {
    rootFiles: {
      'bridge.js': "module.exports = require('./src/infrastructure/database');",
      'package.json': JSON.stringify({ name: 'fixture-service' }),
    },
  });
  const failures = f.check().failures.join('\n');
  assert.match(failures, /root-level bridge imports are not allowed/);
  assert.match(failures, /root-level bridge\/self import is not allowed/);
});

test('architecture checker rejects environment aliases and indirection', function () {
  const f = fixture({
    'infrastructure/client.js': `
      const proc = globalThis.process;
      const environment = proc.env;
      module.exports = environment.SECRET;
    `,
    'infrastructure/imported-process.mjs': `
      import processObject from 'node:process';
      export const secret = processObject.env.SECRET;
    `,
  });
  assert.match(f.check().failures.join('\n'), /including aliases\/indirection/);
});

test('interfaces framework allowlist supports package subpaths', function () {
  const f = fixture({
    'interfaces/router.js': "module.exports = require('express/lib/router');",
  });
  assert.deepEqual(f.check().failures, []);
});
