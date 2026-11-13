#!/usr/bin/env node
// Mergea un PR con merge commit, por la API de GitHub, con la credencial de git
// del Credential Manager (hay organizaciones donde `gh` da 404 y el token bueno es el de git).
// Paso 10 del cierre de tarea (METODO.md): el merge se hace SOBRE el PR, nunca en local.
//
// Uso: node mergear-pr.js [--a-pedido] <carpeta> <numero> <sha-esperado>
//   --a-pedido: el dueño pidio el merge de este PR («mergealo»). Sin el, guard-git.js solo deja
//   correrlo en modo flujo; el script en si lo ignora.
//   <carpeta> es una clave de git.repos en .claude/duck.json (p. ej. backend): el nombre del
//   repo en GitHub y la organizacion salen de ahi y de git.orgGithub. Tambien vale `.` en un
//   proyecto de un solo repo (git.repos vacio) y la carpeta `docs` de duck.json cuando es su propio
//   repo: en esos dos casos owner/repo sale del origin de la carpeta.
//
// Se niega, sin mergear, si:
//   - la carpeta no esta en git.repos de .claude/duck.json;
//   - la base del PR no es git.ramaBase (a main nunca se mergea desde aqui);
//   - el PR no esta abierto, o su head no es el sha esperado (alguien empujo despues de verificar);
//   - algun check del head no termino en success o skipped (los jobs que solo corren en main
//     quedan skipped en un PR), o el status combinado del commit no es success;
//   - la API no devolvio los checks o el status (sin ellos no hay como saber si el CI paso).
// Un commit sin checks ni statuses (repo sin CI) se mergea, con un aviso.
// No toca la casilla de confirmacion del PR: esa la firma una persona (paso 9).

const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { cargar, repoDe } = require('./config');

const [repoArg = '', numArg = '', shaArg = ''] = process.argv.slice(2).filter((a) => a !== '--a-pedido');

function fallar(msg) {
  console.error(`mergear-pr: ${msg}`);
  process.exit(1);
}

const cfg = cargar();
if (!cfg) fallar('no hay .claude/duck.json en este proyecto');

// owner/repo de la carpeta: el de git.repos, o el del origin para `.` (un solo repo) y la de docs.
function repoDeCarpeta() {
  const repos = cfg.git.repos;
  const clave = Object.keys(repos).find((k) => k.toLowerCase() === repoArg.toLowerCase());
  if (clave) {
    if (!cfg.git.orgGithub) fallar('falta git.orgGithub en .claude/duck.json');
    return `${cfg.git.orgGithub}/${repos[clave]}`;
  }
  const otras = [...(Object.keys(repos).length ? [] : ['.']), ...(cfg.docs ? [cfg.docs] : [])];
  const carpeta = otras.find((c) => path.normalize(c) === path.normalize(repoArg || '?'));
  if (!carpeta) fallar(`carpeta «${repoArg}» no permitida; use una de: ${[...Object.keys(repos), ...otras].join(', ')}`);
  return repoDe(path.join(cfg.raiz, carpeta)) || fallar(`${carpeta} no tiene un origin de GitHub`);
}
const nombre = repoDeCarpeta();
const repo = nombre.split('/')[1];
if (!/^\d+$/.test(numArg)) fallar(`número de PR inválido: «${numArg}»`);
if (!/^[0-9a-f]{40}$/.test(shaArg)) fallar('falta el sha completo (40 hex) del head verificado');

const credencial = execFileSync('git', ['credential', 'fill'], {
  input: 'protocol=https\nhost=github.com\n\n',
  encoding: 'utf8',
});
const token = (credencial.match(/^password=(.*)$/m) || [])[1];
if (!token) fallar('no hay credencial de git para github.com');

const base = cfg.git.ramaBase;
const api = `https://api.github.com/repos/${nombre}`;
const cabeceras = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'duck-mergear-pr',
};

async function main() {
  const pr = await (await fetch(`${api}/pulls/${numArg}`, { headers: cabeceras })).json();
  if (!pr || !pr.base) fallar(`no se pudo leer el PR #${numArg}: ${pr && pr.message}`);
  if (pr.base.ref !== base) fallar(`la base del PR es «${pr.base.ref}», no ${base}`);
  if (pr.state !== 'open') fallar(`el PR #${numArg} está ${pr.state}`);
  if (pr.head.sha !== shaArg) fallar(`el head es ${pr.head.sha}, no el verificado ${shaArg}`);

  const checks = await (await fetch(`${api}/commits/${shaArg}/check-runs`, { headers: cabeceras })).json();
  if (!Array.isArray(checks.check_runs)) fallar(`no se pudieron leer los checks: ${checks.message}`);
  const malos = checks.check_runs.filter((c) => c.status !== 'completed' || !['success', 'skipped'].includes(c.conclusion));
  if (malos.length) fallar(`checks sin éxito: ${malos.map((c) => `${c.name}:${c.status}/${c.conclusion}`).join(', ')}`);

  // El CI que reporta por la API vieja de statuses no aparece entre los check runs.
  const status = await (await fetch(`${api}/commits/${shaArg}/status`, { headers: cabeceras })).json();
  if (typeof status.total_count !== 'number') fallar(`no se pudo leer el status del commit: ${status.message}`);
  if (status.total_count && status.state !== 'success') {
    fallar(`status del commit: ${status.state} (${status.statuses.map((s) => `${s.context}:${s.state}`).join(', ')})`);
  }
  if (!checks.check_runs.length && !status.total_count) {
    console.error('mergear-pr: aviso: el commit no tiene checks ni statuses (repo sin CI); se mergea igual.');
  }

  const r = await fetch(`${api}/pulls/${numArg}/merge`, {
    method: 'PUT',
    headers: { ...cabeceras, 'Content-Type': 'application/json' },
    body: JSON.stringify({ merge_method: 'merge', sha: shaArg }),
  });
  const res = await r.json();
  if (!res.merged) fallar(`GitHub no mergeó #${numArg}: ${res.message}`);
  // La rama va en la salida: cierre-finalizado.js saca de ahi el issue, aunque el checkout ya este en la base.
  console.log(`${repo} #${numArg} mergeado: ${res.sha} (${pr.head.ref})`);
}

main().catch((e) => fallar(e.message));
