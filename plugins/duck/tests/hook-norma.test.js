// Run: node --test plugins/duck/tests/*.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { SPEC, JIRA, proyecto, correr, contexto } = require('./helpers');

// --- norma: duck.json remembers the hash of the project norm it was derived from (#42) ---

function conNorma(texto, hash) {
  const raiz = proyecto({ ...SPEC, norma: { archivo: 'docs/convenciones.md', hash } });
  fs.mkdirSync(path.join(raiz, 'docs'));
  fs.writeFileSync(path.join(raiz, 'docs', 'convenciones.md'), texto);
  return raiz;
}

test('norma.js hash ignores line endings, so a Windows checkout is not drift', () => {
  const raiz = conNorma('a\nb\n');
  const lf = correr('norma.js', raiz, {}, { args: ['hash', 'docs/convenciones.md'] }).stdout.trim();
  fs.writeFileSync(path.join(raiz, 'docs', 'convenciones.md'), 'a\r\nb\r\n');
  const crlf = correr('norma.js', raiz, {}, { args: ['hash', 'docs/convenciones.md'] }).stdout.trim();
  assert.match(lf, /^sha256:[0-9a-f]{64}$/);
  assert.equal(crlf, lf);
});

test('norma.js revisar is silent while the norm matches and warns when it changed or is gone', () => {
  const raiz = conNorma('a\n');
  const hash = correr('norma.js', raiz, {}, { args: ['hash', 'docs/convenciones.md'] }).stdout.trim();
  const fijo = conNorma('a\n', hash);
  assert.equal(correr('norma.js', fijo, {}, { args: ['revisar'] }).stdout, '');
  fs.writeFileSync(path.join(fijo, 'docs', 'convenciones.md'), 'b\n');
  assert.match(correr('norma.js', fijo, {}, { args: ['revisar'] }).stdout, /docs\/convenciones\.md cambió desde que se aprobó duck\.json: corré \/duck:iniciar/);
  fs.rmSync(path.join(fijo, 'docs', 'convenciones.md'));
  assert.match(correr('norma.js', fijo, {}, { args: ['revisar'] }).stdout, /docs\/convenciones\.md no está/);
});

test('norma.js revisar says nothing without norma.hash', () => {
  assert.equal(correr('norma.js', conNorma('a\n'), {}, { args: ['revisar'] }).stdout, '');
  assert.equal(correr('norma.js', proyecto(JIRA), {}, { args: ['revisar'] }).stdout, '');
});

test('sesion-inicio warns when the norm changed, without blocking', () => {
  const fijo = conNorma('b\n', 'sha256:' + '0'.repeat(64));
  const r = correr('sesion-inicio.js', fijo, {});
  assert.equal(r.status, 0);
  assert.match(contexto(r), /docs\/convenciones\.md cambió desde que se aprobó duck\.json/);
});
