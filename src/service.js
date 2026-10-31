// GitHub keyvault: holds its person's GitHub App (GITHUB_APP: made once on GitHub, installed on their repositories;
// Weave keeps its key and signs its JWTs, the key never reaching this code) and mints their services short-lived
// installation tokens, cut to the repositories and permissions Weave asks for. Weave asks only after its checks: the
// service is its person's, its contract declares this use, and its person handed that project those repositories.
import { log, setting, sign } from 'weave:service/vaulting@0.1.0';

const API = 'https://api.github.com';
const encode = (text) => new TextEncoder().encode(text);
const base64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Its person's GitHub App: {id, slug, html_url, owner.login, permissions}. */
function app() {
  const a = JSON.parse(setting('GITHUB_APP') ?? 'null');
  if (!a?.id) throw new Error('no GitHub App yet: make yours in Keys & devices (GitHub keyvault)');
  return a;
}

/** The App's JWT, signed by Weave with its key. */
function jwt(id) {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${base64url(encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })))}.${base64url(encode(JSON.stringify({ iat: now - 60, exp: now + 540, iss: String(id) })))}`;
  return `${unsigned}.${base64url(sign('GITHUB_APP', 'RS256', encode(unsigned)))}`;
}

async function github(token, method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'weave-github-keyvault', 'x-github-api-version': '2022-11-28', authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(method === 'POST' ? { body: JSON.stringify(body ?? {}) } : {}),
  });
  if (!res.ok) {
    const said = await res.json().catch(() => ({}));
    throw new Error(`GitHub said ${res.status} for ${method} ${path}${said?.message ? `: ${said.message}` : ''}`);
  }
  return res.status === 204 ? {} : res.json();
}

/** An export's error, as its result's error: a string (an Error thrown as it is would trap). */
const said = (fn) => async (text) => {
  try {
    return await fn(text);
  } catch (error) {
    throw String(error?.message ?? error);
  }
};

/** The organizations someone shows they're in, without signing in: only those they made public on GitHub. */
export const owners = said(async (text) => {
  const { login } = JSON.parse(text);
  if (typeof login !== 'string' || !/^[A-Za-z0-9-]{1,39}$/.test(login)) return '[]';
  const res = await fetch(`${API}/users/${login}/orgs?per_page=100`, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'weave-github-keyvault', 'x-github-api-version': '2022-11-28' } });
  if (!res.ok) return '[]';
  return JSON.stringify((await res.json()).map((o) => ({ value: o.login })));
});

/** The repositories its App is installed on: to hand to projects. */
export const reachable = said(async () => {
  const a = app();
  const out = [];
  for (const installation of await github(jwt(a.id), 'GET', '/app/installations?per_page=100')) {
    const { token } = await github(jwt(a.id), 'POST', `/app/installations/${installation.id}/access_tokens`, { permissions: { metadata: 'read' } });
    const got = await github(token, 'GET', '/installation/repositories?per_page=100');
    for (const r of got.repositories ?? []) out.push({ value: r.full_name, ...(r.private || r.owner?.type !== 'Organization' ? { note: [r.private ? 'private' : '', r.owner?.type === 'Organization' ? '' : "a person's"].filter(Boolean).join(' · ') } : {}) });
  }
  if (!out.length) throw new Error(`${a.slug} isn't installed on any repository yet: install it (${a.html_url}/installations/new)`);
  return JSON.stringify(out);
});

/** Forgotten: uninstalled everywhere, so its access ends now. The App itself stays until its person deletes it. */
export const forget = said(async () => {
  const a = app();
  const all = await github(jwt(a.id), 'GET', '/app/installations?per_page=100');
  for (const installation of all) await github(jwt(a.id), 'DELETE', `/app/installations/${installation.id}`);
  log(`uninstalled ${a.slug} from ${all.map((i) => i.account?.login ?? i.id).join(', ') || 'nothing'}`);
  return JSON.stringify({ uninstalled: all.map((i) => i.account?.login ?? String(i.id)) });
});

/** An installation token for these repositories (one owner's), with exactly these permissions. */
export const mint = said(async (text) => {
  const { resources, rights } = JSON.parse(text);
  const a = app();
  const owners = new Set(resources.map((r) => r.split('/')[0].toLowerCase()));
  if (owners.size !== 1) throw new Error('one owner\'s repositories at a time');
  let installation;
  try {
    installation = (await github(jwt(a.id), 'GET', `/repos/${resources[0]}/installation`)).id;
  } catch (error) {
    const owner = resources[0].split('/')[0];
    // An app reaches only its own account's repositories: an organization's need one made for it.
    if (/ 404 /.test(error?.message ?? '') && a['owner.login'] && owner.toLowerCase() !== String(a['owner.login']).toLowerCase())
      throw new Error(`${a.slug} is ${a['owner.login']}'s and reaches only their repositories, not ${resources[0]}: make another app for ${owner} (Keys & devices, GitHub keyvault)`);
    if (/ 404 /.test(error?.message ?? '')) throw new Error(`${a.slug} isn't installed on ${resources[0]}: install it there (${a.html_url}/installations/new)`);
    throw error;
  }
  const minted = await github(jwt(a.id), 'POST', `/app/installations/${installation}/access_tokens`, { repositories: resources.map((r) => r.split('/')[1]), permissions: rights });
  log(`minted for ${resources.join(', ')}: ${Object.entries(rights).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  return JSON.stringify({ token: minted.token, expires: Date.parse(minted.expires_at) });
});
