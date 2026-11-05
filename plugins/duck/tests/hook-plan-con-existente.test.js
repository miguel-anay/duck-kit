// Run: node --test plugins/duck/tests/*.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { GITHUB, proyecto, correr, repo } = require('./helpers');

// --- plan-con-existente: the story plan must say what already exists before proposing ---

const planDenegado = (r) => (r.stdout ? JSON.parse(r.stdout).hookSpecificOutput?.permissionDecision === 'deny' : false);
const CON_DISENO = { ...GITHUB, odd: { diseno: 'docs/disenos/{historia}.md' } };
const SECCION = '# Plan 12\n\n## Lo que ya existe\n\n- api/webhooks/yape.js:10 — webhook de Yape ya implementado\n';
const escribir = (raiz, ruta, content) => ({ session_id: 's1', tool_name: 'Write', cwd: raiz, tool_input: { file_path: path.join(raiz, ruta), content } });
const editar = (raiz, ruta, old_string, new_string) => ({ session_id: 's1', tool_name: 'Edit', cwd: raiz, tool_input: { file_path: path.join(raiz, ruta), old_string, new_string } });

test('plan-con-existente denies a story plan written without "## Lo que ya existe"', () => {
  const raiz = proyecto(CON_DISENO);
  for (const ruta of ['docs/disenos/12.md', 'docs-repo/docs/disenos/docs-12.md']) {
    const r = correr('plan-con-existente.js', raiz, escribir(raiz, ruta, '# Plan 12\n\n## Arquitectura\n'));
    assert.ok(planDenegado(r), ruta);
    assert.match(JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason, /## Lo que ya existe/);
  }
});

test('plan-con-existente lets a plan with the section, other files and projects without odd.diseno through', () => {
  const raiz = proyecto(CON_DISENO);
  assert.ok(!planDenegado(correr('plan-con-existente.js', raiz, escribir(raiz, 'docs/disenos/12.md', SECCION))));
  assert.ok(!planDenegado(correr('plan-con-existente.js', raiz, escribir(raiz, 'docs/otro/12.md', '# x\n'))));
  const sinDiseno = proyecto(GITHUB);
  assert.ok(!planDenegado(correr('plan-con-existente.js', sinDiseno, escribir(sinDiseno, 'docs/disenos/12.md', '# x\n'))));
});

test('plan-con-existente checks the plan as an Edit leaves it', () => {
  const raiz = proyecto(CON_DISENO);
  fs.mkdirSync(path.join(raiz, 'docs', 'disenos'), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'docs', 'disenos', '12.md'), '# Plan 12\n\n## Arquitectura\n');
  assert.ok(planDenegado(correr('plan-con-existente.js', raiz, editar(raiz, 'docs/disenos/12.md', '## Arquitectura', '## Arquitectura\n\nNueva'))));
  assert.ok(!planDenegado(correr('plan-con-existente.js', raiz, editar(raiz, 'docs/disenos/12.md', '# Plan 12\n', SECCION))));
  fs.writeFileSync(path.join(raiz, 'docs', 'disenos', '12.md'), SECCION);
  assert.ok(!planDenegado(correr('plan-con-existente.js', raiz, editar(raiz, 'docs/disenos/12.md', 'implementado', 'implementado y probado'))));
});

test('hooks.json runs plan-con-existente before Write and Edit', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'hooks', 'hooks.json'), 'utf8')).hooks;
  const entrada = hooks.PreToolUse.find((h) => h.matcher === 'Write|Edit');
  assert.ok(entrada.hooks.some((h) => /plan-con-existente\.js/.test(h.command)));
});
