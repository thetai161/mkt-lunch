import { fetchCurrent, commitFile, EMPTY_PAYLOAD } from "../lib/github.js";

// Bulk GET/PUT for team-lunch data.
// PUT preserves `assignments` from the server — claims are owned by /api/claim,
// not by bulk save, to prevent overwriting others' claims during a slow edit.

/* --- Diff → commit message --- */
function describeDiff(oldData, newData) {
  const o = oldData || EMPTY_PAYLOAD;
  const n = newData || EMPTY_PAYLOAD;
  const changes = [];

  const oldM = new Map((o.members || []).map(m => [m.id, m]));
  const newM = new Map((n.members || []).map(m => [m.id, m]));
  for (const [id, m] of newM) {
    if (!oldM.has(id)) changes.push(`Add member: ${m.name}`);
    else if (oldM.get(id).name !== m.name) changes.push(`Rename member ${id}: ${oldM.get(id).name} → ${m.name}`);
  }
  for (const [id, m] of oldM) {
    if (!newM.has(id)) changes.push(`Remove member: ${m.name} (id=${id})`);
  }

  if ((o.startWeekKey || null) !== (n.startWeekKey || null)) {
    changes.push(`Set startWeekKey: ${n.startWeekKey}`);
  }

  const oldWeeks = o.weeks || {};
  const newWeeks = n.weeks || {};
  const weekKeys = new Set([...Object.keys(oldWeeks), ...Object.keys(newWeeks)]);
  for (const wk of [...weekKeys].sort()) {
    const ow = oldWeeks[wk] || {};
    const nw = newWeeks[wk] || {};
    const parts = [];

    const oldDays = ow.days || {};
    const newDays = nw.days || {};
    const dayKeys = new Set([...Object.keys(oldDays), ...Object.keys(newDays)]);
    const changedDays = [];
    for (const dk of [...dayKeys].sort()) {
      if (JSON.stringify(oldDays[dk] || null) !== JSON.stringify(newDays[dk] || null)) {
        changedDays.push(dk);
      }
    }
    if (changedDays.length) parts.push(`costs for ${changedDays.join(", ")}`);

    const oc = JSON.stringify([...(ow.contributors || [])].sort((a,b)=>a-b));
    const nc = JSON.stringify([...(nw.contributors || [])].sort((a,b)=>a-b));
    if (oc !== nc) parts.push("contributors");

    const oro = ow.rolloverOverride === undefined ? null : ow.rolloverOverride;
    const nro = nw.rolloverOverride === undefined ? null : nw.rolloverOverride;
    if (oro !== nro) {
      if (nro === null) parts.push("reset rollover");
      else parts.push(`set rollover = ${nro}`);
    }

    if ((ow.qrImage || null) !== (nw.qrImage || null)) parts.push("QR image");

    if (parts.length && !oldWeeks[wk]) changes.push(`Create week ${wk}: ${parts.join(", ")}`);
    else if (parts.length) changes.push(`Update week ${wk}: ${parts.join(", ")}`);
  }

  if (changes.length === 0) return "Save data (no functional changes)";
  if (changes.length === 1) return changes[0];
  return `${changes[0]} (+${changes.length - 1} more)\n\n${changes.map(c => "- " + c).join("\n")}`;
}

/* --- Merge: body has new cost/contributor/etc. edits, but assignments
       come from the server (managed by /api/claim). --- */
function mergePreservingAssignments(body, serverData) {
  const merged = { ...body };
  const clientWeeks = body.weeks || {};
  const serverWeeks = (serverData && serverData.weeks) || {};
  merged.weeks = {};

  for (const wk of Object.keys(clientWeeks)) {
    const cw = clientWeeks[wk] || {};
    const sw = serverWeeks[wk] || {};
    merged.weeks[wk] = {
      ...cw,
      assignments: sw.assignments !== undefined ? sw.assignments : (cw.assignments || {}),
    };
  }
  // Keep weeks that exist on server but not in client payload (don't delete them)
  for (const wk of Object.keys(serverWeeks)) {
    if (!(wk in merged.weeks)) merged.weeks[wk] = serverWeeks[wk];
  }
  return merged;
}

/* --- Handler --- */
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");

  try {
    if (req.method === "GET") {
      const { data } = await fetchCurrent();
      return res.status(200).json(data || EMPTY_PAYLOAD);
    }

    if (req.method === "PUT" || req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      if (!body || typeof body !== "object") {
        return res.status(400).json({ error: "Invalid body" });
      }

      for (let attempt = 0; attempt < 2; attempt++) {
        const { data: oldData, sha } = await fetchCurrent();
        const merged = mergePreservingAssignments(body, oldData);
        const msg = describeDiff(oldData, merged);
        const r = await commitFile(merged, msg, sha);
        if (r.ok) return res.status(200).json({ ok: true });
        if (r.status === 409 || r.status === 422) continue; // stale sha, retry
        const text = await r.text();
        return res.status(r.status).json({ error: `GitHub PUT ${r.status}: ${text}` });
      }
      return res.status(409).json({ error: "Conflicting concurrent saves; try again" });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("api/data error:", err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
