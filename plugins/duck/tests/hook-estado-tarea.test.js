// Run: node --test plugins/duck/tests/*.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { SCRIPTS, GITHUB, JIRA, proyecto, correr, leerSesion, mover, bash } = require('./helpers');

// --- estado-tarea ---

test('estado-tarea records a GitHub move from the ticket.js success line', () => {
  const raiz = proyecto(GITHUB);
  const r = correr('estado-tarea.js', raiz, mover('Issue (org/app#12) movido a (In Progress)\n'));
  assert.equal(r.status, 0);
  assert.equal(leerSesion(raiz, 's1').tareas['org/app#12'].estado, 'In Progress');
});

test('estado-tarea records a GitHub move when the Bash command failed after ticket.js succeeded', () => {
  // PostToolUseFailure: no tool_response, the output travels in `error`.
  const raiz = proyecto(GITHUB);
  const evento = { ...mover(''), tool_response: undefined, hook_event_name: 'PostToolUseFailure',
    error: 'Exit code 1\nIssue (org/app#12) movido a (In Progress)\n' };
  correr('estado-tarea.js', raiz, evento);
  assert.equal(leerSesion(raiz, 's1').tareas['org/app#12'].estado, 'In Progress');
});

test('hooks.json runs estado-tarea on PostToolUseFailure for Bash', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(SCRIPTS, '..', 'hooks', 'hooks.json'), 'utf8')).hooks;
  const bash = (hooks.PostToolUseFailure || []).find((m) => m.matcher === 'Bash');
  assert.ok(bash && bash.hooks.some((h) => h.command.includes('estado-tarea.js')));
});

test('estado-tarea ignores a ticket.js mover that printed no success line', () => {
  const raiz = proyecto(GITHUB);
  correr('estado-tarea.js', raiz, mover(''));
  assert.equal(fs.existsSync(path.join(raiz, '.claude', 'estado', 'sesiones', 's1.json')), false);
});

test('estado-tarea (jira) still records the acli transition line', () => {
  const raiz = proyecto(JIRA);
  correr('estado-tarea.js', raiz, {
    session_id: 's1',
    tool_name: 'Bash',
    tool_input: { command: 'acli jira workitem transition --key ABC-5 --status Finalizado' },
    tool_response: { stdout: '✓ Work item ABC-5 has been successfully transitioned to Finalizado\n' },
  });
  assert.equal(leerSesion(raiz, 's1').tareas['ABC-5'].estado, 'Finalizado');
});
