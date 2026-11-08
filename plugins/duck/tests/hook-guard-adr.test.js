// Run: node --test plugins/duck/tests/*.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { GITHUB, temporales, proyecto, correr, git, negado } = require('./helpers');

// --- guard-adr: an ADR Accepted on the base branch is not edited, only its Status line changes ---

const CON_ADR = { ...GITHUB, adr: 'doc/adr' };
const ADR = (estado) => `# 0001 Decision\n\nStatus: ${estado}\n\nWe do X.\n`;
const CAMBIADO = ADR('Accepted').replace('We do X.', 'We do Y.');
const escribir = (raiz, archivo, content) => ({ session_id: 's1', tool_name: 'Write', cwd: raiz, tool_input: { file_path: archivo, content } });
const editar = (raiz, archivo, old_string, new_string) => ({ session_id: 's1', tool_name: 'Edit', cwd: raiz, tool_input: { file_path: archivo, old_string, new_string } });

// Project whose docs repo (doc/, cloned from a bare origin) holds the ADR in `enBase` on main
// (null = not on main), checked out on docs/1-x with the ADR already saying Accepted.
function conDocs(enBase, duck = CON_ADR) {
  const raiz = proyecto(duck);
  const origen = path.join(raiz, 'origen.git');
  const doc = path.join(raiz, 'doc');
  git(raiz, 'init', '-q', '--bare', '-b', 'main', origen);
  git(raiz, 'clone', '-q', origen, doc);
  fs.mkdirSync(path.join(doc, 'adr'));
  const archivo = path.join(doc, 'adr', '0001-decision.md');
  fs.writeFileSync(path.join(doc, 'README.md'), 'docs\n');
  if (enBase) fs.writeFileSync(archivo, ADR(enBase));
  git(doc, 'add', '-A');
  git(doc, 'commit', '-q', '-m', 'base');
  git(doc, 'push', '-q', 'origin', 'HEAD:main');
  git(doc, 'remote', 'set-head', 'origin', 'main');
  git(doc, 'switch', '-q', '-c', 'docs/1-x');
  fs.writeFileSync(archivo, ADR('Accepted'));
  return { raiz, doc, archivo };
}

test('guard-adr denies changing an ADR that is Accepted on the base branch', () => {
  const { raiz, archivo } = conDocs('Accepted');
  const r = correr('guard-adr.js', raiz, escribir(raiz, archivo, CAMBIADO));
  assert.ok(negado(r));
  assert.match(JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason, /0001-decision\.md.*Status/s);
  assert.ok(negado(correr('guard-adr.js', raiz, editar(raiz, archivo, 'We do X.', 'We do Y.'))));
});

test('guard-adr lets the Status line of an accepted ADR change', () => {
  const { raiz, archivo } = conDocs('Accepted');
  assert.ok(!negado(correr('guard-adr.js', raiz, escribir(raiz, archivo, ADR('Superseded by 0002')))));
  assert.ok(!negado(correr('guard-adr.js', raiz, escribir(raiz, archivo, ADR('Deprecated').trimEnd()))), 'final newline does not count');
  assert.ok(!negado(correr('guard-adr.js', raiz, editar(raiz, archivo, 'Status: Accepted', 'Status: Deprecated'))));
});

test('guard-adr keeps an ADR editable in its PR while it is new or Proposed on the base', () => {
  for (const enBase of [null, 'Proposed']) {
    const { raiz, archivo } = conDocs(enBase);
    assert.ok(!negado(correr('guard-adr.js', raiz, escribir(raiz, archivo, CAMBIADO))), String(enBase));
  }
});

test('guard-adr also guards a worktree of the docs repo outside the project', () => {
  const { raiz, doc } = conDocs('Accepted');
  const fuera = fs.mkdtempSync(path.join(os.tmpdir(), 'duck-adr-wt-'));
  temporales.push(fuera);
  git(doc, 'worktree', 'add', '-q', '-b', 'docs/2-y', path.join(fuera, 'wt'), 'origin/main');
  const archivo = path.join(fuera, 'wt', 'adr', '0001-decision.md');
  assert.ok(negado(correr('guard-adr.js', raiz, escribir(raiz, archivo, CAMBIADO))));
});

test('guard-adr without git: Accepted in the file means locked', () => {
  const raiz = proyecto(CON_ADR);
  const archivo = path.join(raiz, 'doc', 'adr', '0001-decision.md');
  fs.mkdirSync(path.dirname(archivo), { recursive: true });
  fs.writeFileSync(archivo, ADR('Accepted'));
  assert.ok(negado(correr('guard-adr.js', raiz, escribir(raiz, archivo, CAMBIADO))));
  fs.writeFileSync(archivo, ADR('Proposed'));
  assert.ok(!negado(correr('guard-adr.js', raiz, escribir(raiz, archivo, CAMBIADO))));
});

test('guard-adr does nothing without adr in duck.json or outside the ADR folder', () => {
  const sinAdr = conDocs('Accepted', GITHUB);
  assert.ok(!negado(correr('guard-adr.js', sinAdr.raiz, escribir(sinAdr.raiz, sinAdr.archivo, CAMBIADO))));
  const { raiz, doc } = conDocs('Accepted');
  const otro = path.join(doc, 'notas', '0001-decision.md');
  fs.mkdirSync(path.dirname(otro));
  fs.writeFileSync(otro, ADR('Accepted'));
  assert.ok(!negado(correr('guard-adr.js', raiz, escribir(raiz, otro, CAMBIADO))));
});

test('hooks.json runs guard-adr before Write and Edit', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'hooks', 'hooks.json'), 'utf8')).hooks;
  const entrada = hooks.PreToolUse.find((h) => h.matcher === 'Write|Edit');
  assert.ok(entrada.hooks.some((h) => /guard-adr\.js/.test(h.command)));
});
