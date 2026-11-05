// Run: node --test plugins/duck/tests/*.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { GITHUB, JIRA, proyecto } = require('./helpers');

// --- config.estadosDe ---

test('estadosDe returns the states of the active provider', () => {
  const { cargar, estadosDe } = require('../scripts/config');
  process.env.CLAUDE_PROJECT_DIR = proyecto(GITHUB);
  assert.equal(estadosDe(cargar()).enProceso, 'In Progress');
  process.env.CLAUDE_PROJECT_DIR = proyecto(JIRA);
  assert.equal(estadosDe(cargar()).enProceso, 'En Proceso');
});
