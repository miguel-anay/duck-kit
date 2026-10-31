#!/usr/bin/env node
// Mergea un PR con merge commit, por la API de GitHub, con la credencial de git
// del Credential Manager (hay organizaciones donde `gh` da 404 y el token bueno es el de git).
// Paso 10 del cierre de tarea (METODO.md): el merge se hace SOBRE el PR, nunca en local.
//
// Uso: node mergear-pr.js [--a-pedido] <carpeta> <numero> <sha-esperado>
//   --a-pedido: el dueño pidio el merge de este PR («mergealo»). Sin el, guard-git.js solo deja
//   correrlo en modo flujo; el script en si lo ignora.
//   <carpeta> es una clave de git.repos en .claude/duck.json (p. ej. backend); el nombre del
//   repo en GitHub y la organizacion salen de ahi y de git.orgGithub.
//
// Se niega, sin mergear, si:
//   - la carpeta no esta en git.repos de .claude/duck.json;
//   - la base del PR no es git.ramaBase (a main nunca se mergea desde aqui);
//   - el PR no esta abierto, o su head no es el sha esperado (alguien empujo despues de verificar);
//   - algun check del head no termino en success.
// No toca la casilla de confirmacion del PR: esa la firma una persona (paso 9).

const { execFileSync } = require('node:child_process');
const { cargar } = require('./config');

const [repoArg = '', numArg = '', shaArg = ''] = process.argv.slice(2).filter((a) => a !== '--a-pedido');

function fallar(msg) {
  console.error(`mergear-pr: ${msg}`);
  process.exit(1);
}

const cfg = cargar();
if (!cfg) fallar('no hay .claude/duck.json en este proyecto');
if (!cfg.git.orgGithub) fallar('falta git.orgGithub en .claude/duck.json');

const repos = cfg.git.repos;
const clave = Object.keys(repos).find((k) => k.toLowerCase() === repoArg.toLowerCase());
const repo = clave ? repos[clave] : null;
if (!repo) fallar(`carpeta «${repoArg}» no permitida; use una de: ${Object.keys(repos).join(', ') || '(git.repos vacio)'}`);
if (!/^\d+$/.test(numArg)) fallar(`número de PR inválido: «${numArg}»`);
if (!/^[0-9a-f]{40}$/.test(shaArg)) fallar('falta el sha completo (40 hex) del head verificado');

const credencial = execFileSync('git', ['credential', 'fill'], {
  input: 'protocol=https\nhost=github.com\n\n',
  encoding: 'utf8',
});
const token = (credencial.match(/^password=(.*)$/m) || [])[1];
if (!token) fallar('no hay credencial de git para github.com');

const base = cfg.git.ramaBase;
const api = `https://api.github.com/repos/${cfg.git.orgGithub}/${repo}`;
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
  const malos = (checks.check_runs || []).filter((c) => c.status !== 'completed' || c.conclusion !== 'success');
  if (malos.length) fallar(`checks sin éxito: ${malos.map((c) => `${c.name}:${c.status}/${c.conclusion}`).join(', ')}`);

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
