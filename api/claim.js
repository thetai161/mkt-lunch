import { fetchCurrent, commitFile, EMPTY_PAYLOAD } from "../lib/github.js";

// Atomic claim/release for task assignments.
// First-writer-wins at the GitHub sha level — retries once on stale sha
// so two non-conflicting claims both succeed. If the same slot is claimed
// concurrently, the second attempt will see the slot taken and return 409.

const DAY_NAMES = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
const TASK_LABELS = {
  main: "Món chính",
  soup: "Canh",
  fruit: "Trái cây",
  rice: "Cơm",
};
const VALID_TASKS = new Set(Object.keys(TASK_LABELS));

function formatCommitMessage(memberName, action, task, dayKey) {
  const d = new Date(dayKey);
  const dayName = DAY_NAMES[d.getDay()];
  const dm = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
  const verb = action === "claim" ? "nhận" : "huỷ";
  return `${memberName} ${verb} ${TASK_LABELS[task]} (${dayName} ${dm})`;
}

function ensureWeek(d, weekKey) {
  if (!d.weeks[weekKey]) {
    d.weeks[weekKey] = {
      days: {},
      assignments: {},
      qrImage: null,
      contributors: [],
      rolloverOverride: null,
    };
  }
  const w = d.weeks[weekKey];
  if (!w.assignments) w.assignments = {};
  return w;
}

function ensureDayAssignment(w, dayKey) {
  if (!w.assignments[dayKey]) {
    w.assignments[dayKey] = { main: null, soup: null, fruit: null, rice: null };
  }
  return w.assignments[dayKey];
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");

  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const { weekKey, dayKey, task, memberId, action } = body || {};

    if (!weekKey || !dayKey || !task || !memberId || !action) {
      return res.status(400).json({ error: "Missing fields" });
    }
    if (action !== "claim" && action !== "release") {
      return res.status(400).json({ error: "Invalid action" });
    }
    if (!VALID_TASKS.has(task)) {
      return res.status(400).json({ error: "Invalid task" });
    }
    const mid = Number(memberId);
    if (!Number.isFinite(mid)) {
      return res.status(400).json({ error: "Invalid memberId" });
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      const { data: raw, sha } = await fetchCurrent();
      const d = raw ? { ...raw, weeks: { ...(raw.weeks || {}) } } : { ...EMPTY_PAYLOAD, weeks: {} };

      const member = (d.members || []).find(m => m.id === mid);
      if (!member) return res.status(400).json({ error: "Member not found" });

      const w = ensureWeek(d, weekKey);
      const assn = ensureDayAssignment(w, dayKey);
      const current = assn[task];

      if (action === "claim") {
        if (current === mid) {
          return res.status(200).json({ ok: true, noop: true, assignments: assn });
        }
        if (current !== null && current !== undefined) {
          const claimer = (d.members || []).find(m => m.id === current);
          return res.status(409).json({
            error: "Already claimed",
            currentClaimerId: current,
            currentClaimerName: claimer ? claimer.name : "Người khác",
            assignments: assn,
          });
        }
        assn[task] = mid;
      } else {
        if (current === null || current === undefined) {
          return res.status(200).json({ ok: true, noop: true, assignments: assn });
        }
        if (current !== mid) {
          const claimer = (d.members || []).find(m => m.id === current);
          return res.status(403).json({
            error: "Not your claim",
            currentClaimerName: claimer ? claimer.name : "Người khác",
            assignments: assn,
          });
        }
        assn[task] = null;
      }

      const msg = formatCommitMessage(member.name, action, task, dayKey);
      const r = await commitFile(d, msg, sha);
      if (r.ok) {
        return res.status(200).json({ ok: true, assignments: assn });
      }
      if (r.status === 409 || r.status === 422) continue; // sha stale, retry
      const text = await r.text();
      return res.status(r.status).json({ error: `GitHub PUT ${r.status}: ${text}` });
    }

    return res.status(409).json({ error: "Repeated sha conflicts; try again" });
  } catch (err) {
    console.error("api/claim error:", err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
