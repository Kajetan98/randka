// Uruchamiane przez GitHub Actions (.github/workflows/synchronizuj.yml).
// Pobiera nowe zdarzenia ze strony (/api/eksport), dopisuje je do
// odpowiedzi.csv, robi commit i push, a potem usuwa przeniesione zdarzenia.

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const SITE = (process.env.SITE_URL || "https://randka-tawny.vercel.app").replace(/\/$/, "");
const CSV = process.env.CSV_PATH || "odpowiedzi.csv";
const COLUMNS = ["czas_pl", "etap", "odpowiedz", "miejsce", "godzina_spotkania", "proby_nie", "wizyta", "czas_utc", "id"];
const HEADER = COLUMNS.join(",");

function csvCell(value) {
  let s = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // ochrona przed formułami w arkuszu
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();
}

async function oidcToken() {
  const url = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const token = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!url || !token) throw new Error("Brak tokenu OIDC: workflow potrzebuje uprawnienia id-token: write");
  const res = await fetch(`${url}&audience=randka-eksport`, { headers: { Authorization: `bearer ${token}` } });
  if (!res.ok) throw new Error(`OIDC ${res.status}`);
  return (await res.json()).value;
}

async function callExport(method, body) {
  const res = await fetch(`${SITE}/api/eksport`, {
    method,
    headers: {
      Authorization: `Bearer ${await oidcToken()}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`/api/eksport ${method}: HTTP ${res.status}`);
  return res.json();
}

function existingIds(text) {
  const ids = new Set();
  for (const line of text.split("\n").slice(1)) {
    const m = /,([0-9a-f]{16})\s*$/.exec(line);
    if (m) ids.add(m[1]);
  }
  return ids;
}

const { zdarzenia = [] } = await callExport("GET");
if (!zdarzenia.length) {
  console.log("Brak nowych odpowiedzi.");
  process.exit(0);
}

let text = "";
try {
  text = readFileSync(CSV, "utf8");
} catch {
  text = "";
}
const lines = text.split("\n");
if (!text.trim()) text = HEADER + "\n";
else if (lines[0] !== HEADER) text = [HEADER, ...lines.slice(1)].join("\n");
if (!text.endsWith("\n")) text += "\n";

const known = existingIds(text);
const fresh = zdarzenia.filter((z) => /^[0-9a-f]{16}$/.test(String(z.id)) && !known.has(z.id));

if (fresh.length) {
  text += fresh.map((z) => COLUMNS.map((c) => csvCell(z[c])).join(",")).join("\n") + "\n";
  writeFileSync(CSV, text);
  git("config", "user.name", "github-actions[bot]");
  git("config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com");
  git("add", CSV);
  git("commit", "-m", `Nowe odpowiedzi (${fresh.length})`);
  for (let attempt = 1; ; attempt++) {
    try {
      git("push");
      break;
    } catch (err) {
      if (attempt >= 3) throw err;
      git("pull", "--rebase");
    }
  }
}

const removed = await callExport("POST", { usun: zdarzenia.map((z) => z.pathname) });
console.log(`Dopisano ${fresh.length} wierszy, usunięto ${removed.usunieto} zdarzeń z magazynu.`);
