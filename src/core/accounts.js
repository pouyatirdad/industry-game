// Accounts are deliberately browser-local: this static game has no server to
// authenticate against. Passwords are hashed before storage, but this is not a
// replacement for real server-side authentication.
const ACCOUNTS_KEY = 'industry-game.accounts.v1';
const SESSION_KEY = 'industry-game.session.v1';

let activeUser = null;

function normalise(username) {
  return username.trim().toLowerCase();
}

function readAccounts() {
  try { return JSON.parse(localStorage.getItem(ACCOUNTS_KEY)) ?? {}; } catch { return {}; }
}

function writeAccounts(accounts) {
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
}

async function hash(password) {
  const bytes = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function signInOrCreate(username, password) {
  const name = username.trim();
  const id = normalise(name);
  if (name.length < 2 || name.length > 30) return { ok: false, reason: 'Username must be 2–30 characters.' };
  if (password.length < 4) return { ok: false, reason: 'Password must be at least 4 characters.' };
  const accounts = readAccounts();
  const passwordHash = await hash(password);
  if (accounts[id] && accounts[id].passwordHash !== passwordHash) return { ok: false, reason: 'That password is not correct.' };
  const created = !accounts[id];
  if (created) {
    accounts[id] = { username: name, passwordHash, createdAt: Date.now() };
    writeAccounts(accounts);
  }
  activeUser = { id, username: accounts[id].username, guest: false };
  sessionStorage.setItem(SESSION_KEY, id);
  return { ok: true, created };
}

export function continueAsGuest() {
  activeUser = { id: null, username: 'Guest', guest: true };
  sessionStorage.removeItem(SESSION_KEY);
}

export function restoreSession() {
  const id = sessionStorage.getItem(SESSION_KEY);
  const account = id && readAccounts()[id];
  if (!account) return null;
  activeUser = { id, username: account.username, guest: false };
  return activeUser;
}

export function currentUser() { return activeUser; }
export function saveKey() { return activeUser?.guest || !activeUser ? null : `industry-game.save.v9.user.${activeUser.id}`; }
export function signOut() { activeUser = null; sessionStorage.removeItem(SESSION_KEY); }
