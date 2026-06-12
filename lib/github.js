// Shared GitHub Contents API helpers for serverless functions.
// Reads/writes a single JSON file on a dedicated branch.

export const OWNER = process.env.GITHUB_OWNER || "thetai161";
export const REPO = process.env.GITHUB_REPO || "mkt-lunch";
export const BRANCH = process.env.GITHUB_BRANCH || "data";
export const FILE_PATH = process.env.GITHUB_DATA_PATH || "data.json";
export const COMMITTER_NAME = process.env.GIT_COMMITTER_NAME || "Team Lunch Bot";
export const COMMITTER_EMAIL = process.env.GIT_COMMITTER_EMAIL || "bot@mkt-lunch.local";
const GH_API = "https://api.github.com";

export const EMPTY_PAYLOAD = {
  schemaVersion: 4,
  members: [],
  weeks: {},
  startWeekKey: null,
};

function ghHeaders() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN env var is not set");
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "mkt-lunch-app",
  };
}

export async function fetchCurrent() {
  const url = `${GH_API}/repos/${OWNER}/${REPO}/contents/${encodeURIComponent(FILE_PATH)}?ref=${encodeURIComponent(BRANCH)}`;
  const r = await fetch(url, { headers: ghHeaders() });
  if (r.status === 404) return { data: null, sha: null };
  if (!r.ok) throw new Error(`GitHub GET ${r.status}: ${await r.text()}`);
  const j = await r.json();
  const text = Buffer.from(j.content || "", j.encoding || "base64").toString("utf-8");
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  return { data, sha: j.sha };
}

export async function commitFile(newData, message, sha) {
  const url = `${GH_API}/repos/${OWNER}/${REPO}/contents/${encodeURIComponent(FILE_PATH)}`;
  const body = {
    message,
    content: Buffer.from(JSON.stringify(newData, null, 2), "utf-8").toString("base64"),
    branch: BRANCH,
    committer: { name: COMMITTER_NAME, email: COMMITTER_EMAIL },
    author: { name: COMMITTER_NAME, email: COMMITTER_EMAIL },
  };
  if (sha) body.sha = sha;
  const r = await fetch(url, {
    method: "PUT",
    headers: { ...ghHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return r;
}
