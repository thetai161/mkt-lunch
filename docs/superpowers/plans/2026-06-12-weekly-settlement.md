# Quyết toán cuối tuần — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thay mô hình "đóng quỹ 150k đầu tuần + rollover" bằng quyết toán cuối tuần: tính mỗi người đã ăn / đã chi bao nhiêu, ai ăn nhiều hơn chi chuyển tiền cho thủ quỹ, thủ quỹ trả lại người chi nhiều hơn ăn.

**Architecture:** App là 1 file `index.html` (inline HTML/CSS/JS, không build step) + 2 serverless functions. Người chi mỗi khoản được suy từ tab Phân việc (`assignments`); tab Quỹ được viết lại thành tab Quyết toán với 2 field mới mỗi tuần (`treasurerId`, `settledIds`), lưu qua bulk PUT `/api/data` sẵn có. Schema v3 → v4; field cũ `contributors`/`rolloverOverride` ngừng dùng nhưng không xoá khỏi dữ liệu lịch sử.

**Tech Stack:** Vanilla JS inline trong `index.html`, Vercel serverless (Node 20+, ES modules), persist bằng commit JSON lên branch `data` qua GitHub API.

**Spec:** `docs/superpowers/specs/2026-06-12-weekly-settlement-design.md`

**Lưu ý chung cho người thực hiện:**
- Repo **không có test suite, không lint, không package.json** — đây là chủ đích (xem CLAUDE.md). KHÔNG thêm test framework. Verify bằng `node --check` cho file API và mở `index.html` trong browser (không có server, `/api/data` 404 → app fallback 10 thành viên mặc định, đủ để kiểm tra UI).
- Chuỗi hiển thị cho người dùng luôn là **tiếng Việt**.
- `data-tab="fund"` giữ nguyên (chỉ đổi nhãn hiển thị) để không phá UI state đã lưu trong localStorage của người dùng cũ.
- Khi sửa `index.html`, các số dòng dưới đây là số dòng **trước khi sửa** — sau mỗi edit chúng sẽ trôi; tìm theo nội dung.

---

### Task 1: API + seed — schema v4, describeDiff mô tả treasurer/settlement

**Files:**
- Modify: `api/data.js` (hàm `describeDiff`, dòng 46–57)
- Modify: `lib/github.js` (`EMPTY_PAYLOAD`, dòng 12–16)
- Modify: `data.json` (repo root, file seed tham khảo — dòng 2)

- [ ] **Step 1: Sửa `describeDiff` trong `api/data.js`**

Thay block so sánh contributors + rolloverOverride (dòng 46–55):

```js
    const oc = JSON.stringify([...(ow.contributors || [])].sort((a,b)=>a-b));
    const nc = JSON.stringify([...(nw.contributors || [])].sort((a,b)=>a-b));
    if (oc !== nc) parts.push("contributors");

    const oro = ow.rolloverOverride === undefined ? null : ow.rolloverOverride;
    const nro = nw.rolloverOverride === undefined ? null : nw.rolloverOverride;
    if (oro !== nro) {
      if (nro === null) parts.push("reset rollover");
      else parts.push(`set rollover = ${nro}`);
    }
```

bằng:

```js
    const os = JSON.stringify([...(ow.settledIds || [])].sort((a,b)=>a-b));
    const ns = JSON.stringify([...(nw.settledIds || [])].sort((a,b)=>a-b));
    if (os !== ns) parts.push("settlement ticks");

    const ot = ow.treasurerId === undefined ? null : ow.treasurerId;
    const nt = nw.treasurerId === undefined ? null : nw.treasurerId;
    if (ot !== nt) {
      if (nt === null) parts.push("clear treasurer");
      else parts.push(`set treasurer = ${nt}`);
    }
```

- [ ] **Step 2: Bump `EMPTY_PAYLOAD` trong `lib/github.js`**

Dòng 13: `schemaVersion: 3,` → `schemaVersion: 4,`

- [ ] **Step 3: Bump seed `data.json` ở repo root**

Dòng 2: `"schemaVersion": 3,` → `"schemaVersion": 4,`
(File này chỉ là shape tham khảo, không runtime — không cần thêm field mới vào vì `weeks` rỗng.)

- [ ] **Step 4: Verify syntax**

Run: `node --check api/data.js; node --check lib/github.js; node -e "JSON.parse(require('fs').readFileSync('data.json','utf8')); console.log('json ok')"`
Expected: không có output lỗi, in `json ok`.

- [ ] **Step 5: Commit**

```bash
git add api/data.js lib/github.js data.json
git commit -m "feat(api): schema v4 — describe treasurer/settlement thay cho contributors/rollover"
```

---

### Task 2: index.html — data layer mới (schema v4, computeSettlement)

Task này **chỉ thêm/sửa data layer, chưa đụng UI** — các hàm rollover cũ vẫn giữ nguyên để tab Quỹ cũ còn chạy được (sẽ xoá ở Task 3).

**Files:**
- Modify: `index.html` — `SCHEMA_VERSION` (dòng 1191), `getOrCreateWeek` (dòng 1077–1092), 2 literal tạo tuần trong `sendClaim` (dòng 1390, 1400), thêm hàm mới sau `dayTotal` (dòng 1188)

- [ ] **Step 1: Bump schema version**

Dòng 1191: `const SCHEMA_VERSION = 3;` → `const SCHEMA_VERSION = 4;`

- [ ] **Step 2: Đổi shape tuần trong `getOrCreateWeek`**

Thay toàn bộ hàm (dòng 1077–1092) bằng:

```js
function getOrCreateWeek() {
  const k = currentWeekKey();
  if (!state.weeks[k]) {
    state.weeks[k] = {
      days: {},
      assignments: {},
      qrImage: null,
      treasurerId: null, // thủ quỹ tuần này (member id)
      settledIds: [],    // ai đã tick "đã chuyển / đã nhận xong"
    };
  }
  const w = state.weeks[k];
  if (w.treasurerId === undefined) w.treasurerId = null;
  if (!Array.isArray(w.settledIds)) w.settledIds = [];
  return w;
}
```

(Bỏ normalize `contributors`/`rolloverOverride` — field cũ trong dữ liệu lịch sử giữ nguyên, code không đọc nữa.)

- [ ] **Step 3: Cập nhật 2 literal tạo tuần trong `sendClaim`**

Có đúng 2 chỗ (dòng 1390 và 1400) cùng nội dung:

```js
if (!state.weeks[weekKey]) state.weeks[weekKey] = { days:{}, assignments:{}, qrImage:null, contributors:[], rolloverOverride:null };
```

thay cả hai bằng:

```js
if (!state.weeks[weekKey]) state.weeks[weekKey] = { days:{}, assignments:{}, qrImage:null, treasurerId:null, settledIds:[] };
```

- [ ] **Step 4: Thêm các hàm quyết toán mới**

Chèn ngay **sau** hàm `dayTotal` (sau dòng 1188), **trước** comment `/* --- Persistence ... --- */`:

```js
/* --- Quyết toán cuối tuần --- */
// 4 việc có tiền, map 1-1 với ô nhập ở tab Chi phí. washMain/washSub không có tiền.
const COST_TASKS = ["main", "soup", "fruit", "rice"];
const COST_TASK_LABELS = { main: "Món chính", soup: "Canh", fruit: "Hoa quả", rice: "Cơm" };

// Thủ quỹ mặc định = thủ quỹ của tuần gần nhất trước tuần hiện tại (nếu còn trong team)
function getDefaultTreasurerId() {
  const cur = currentWeekKey();
  const keys = Object.keys(state.weeks).filter(k => k < cur).sort().reverse();
  for (const k of keys) {
    const t = state.weeks[k] && state.weeks[k].treasurerId;
    if (t && state.members.some(m => m.id === t)) return t;
  }
  return null;
}

/**
 * Quyết toán tuần hiện tại.
 * - eaten: chia đều tổng chi ngày cho người ăn (cùng công thức tab Tổng hợp)
 * - paid: người nhận việc nào ở tab Phân việc thì là người chi khoản đó
 * - Ngày không có người ăn → bỏ qua hoàn toàn (cả eaten lẫn paid), khớp calcWeekTotalSpent
 * - Khoản có tiền nhưng chưa ai nhận việc (hoặc người nhận đã rời team) → unattributed
 */
function computeSettlement() {
  const week = getOrCreateWeek();
  const paid = new Map(state.members.map(m => [m.id, 0]));
  const eaten = new Map(state.members.map(m => [m.id, 0]));
  const unattributed = [];
  let totalSpent = 0;

  for (let i = 0; i < WEEKDAYS; i++) {
    const day = getDayData(i);
    const n = (day.attendees || []).length;
    if (n === 0) continue;

    const total = dayTotal(day);
    totalSpent += total;
    const share = total / n;
    day.attendees.forEach(id => {
      if (eaten.has(id)) eaten.set(id, eaten.get(id) + share);
    });

    const assn = getAssignments(i);
    COST_TASKS.forEach(task => {
      const amount = day[task] || 0;
      if (amount <= 0) return;
      const payerId = assn[task];
      if (payerId !== null && payerId !== undefined && paid.has(payerId)) {
        paid.set(payerId, paid.get(payerId) + amount);
      } else {
        unattributed.push({ dayIndex: i, task, amount });
      }
    });
  }

  const rows = state.members.map(m => ({
    id: m.id,
    name: m.name,
    paid: paid.get(m.id) || 0,
    eaten: eaten.get(m.id) || 0,
    net: (paid.get(m.id) || 0) - (eaten.get(m.id) || 0),
  }));

  const treasurerId = week.treasurerId || getDefaultTreasurerId();
  let toTreasurer = 0, fromTreasurer = 0;
  rows.forEach(r => {
    if (r.id === treasurerId) return; // thủ quỹ tự cấn trừ, không chuyển cho chính mình
    if (r.net < 0) toTreasurer += -r.net;
    else fromTreasurer += r.net;
  });

  return { rows, unattributed, totalSpent, toTreasurer, fromTreasurer, treasurerId };
}
```

- [ ] **Step 5: Verify trong browser**

Mở `index.html` trong browser (mở file trực tiếp là đủ). DevTools Console:

```js
computeSettlement()
```

Expected: object `{ rows: [...10 phần tử, paid/eaten/net đều 0], unattributed: [], totalSpent: 0, toTreasurer: 0, fromTreasurer: 0, treasurerId: null }`. Không có lỗi console khi load trang; cả 5 tab (kể cả tab Quỹ cũ) vẫn render bình thường.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat: data layer quyết toán — schema v4, treasurerId/settledIds, computeSettlement"
```

---

### Task 3: index.html — viết lại tab Quỹ thành tab Quyết toán

**Files:**
- Modify: `index.html`:
  - Nhãn tab (dòng 1015)
  - CSS: thay block `.rollover-row` + `.contributors-*` + `.contributor-row` (dòng 363–496, GIỮ `.stats-grid` dòng 357–362 và media query `.contributors-list` dòng 494–496 thì xoá cùng)
  - Xoá: `FUND_PER_PERSON` (dòng 1024), `computeWeekEndingBalance` + `getWeekRollover` + `isRolloverManual` + `setWeekRolloverOverride` + `clearWeekRolloverOverride` (dòng 1094–1156, cả comment JSDoc), `updateFundStats` (dòng 1977–1980)
  - Viết lại: `renderFundTab` (dòng 1779–1945) và `renderFundStatsInto` (dòng 1947–1975)

- [ ] **Step 1: Đổi nhãn tab**

Dòng 1015:

```html
<div class="tab" data-tab="fund" onclick="setTab('fund')"><span>💰</span> Quỹ</div>
```

→

```html
<div class="tab" data-tab="fund" onclick="setTab('fund')"><span>💸</span> Quyết toán</div>
```

(`data-tab="fund"` giữ nguyên.)

- [ ] **Step 2: Thay CSS**

Xoá toàn bộ các rule từ `.rollover-row` (dòng 363) đến hết media query `@media (max-width: 640px) { .contributors-list { ... } }` (dòng 496). **Giữ lại** `.stats-grid` (357–362) và mọi thứ từ `.stat-card` (497) trở đi. Chèn vào đúng chỗ vừa xoá:

```css
  .treasurer-row {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 16px 18px;
    margin-bottom: 16px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }
  .treasurer-row .treasurer-label {
    font-size: 13px;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .treasurer-row .treasurer-label .main-label {
    font-weight: 600;
    color: var(--text);
    font-size: 14px;
  }
  .treasurer-row select {
    padding: 10px 14px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: #fff;
    font-size: 15px;
    font-weight: 600;
    font-family: inherit;
    color: var(--primary);
    min-width: 180px;
    cursor: pointer;
  }
  .treasurer-row select:focus {
    outline: none;
    border-color: var(--primary);
    box-shadow: 0 0 0 3px rgba(234,88,12,0.12);
  }
  .settle-warning {
    background: #fef2f2;
    border: 1px solid #fecaca;
    border-radius: 12px;
    padding: 14px 18px;
    margin-bottom: 16px;
    font-size: 13px;
    color: #991b1b;
  }
  .settle-warning ul { margin: 8px 0 0 18px; padding: 0; }
  .settle-warning li { margin-top: 4px; }
  .settle-badge {
    display: inline-block;
    font-size: 12px;
    font-weight: 600;
    padding: 4px 10px;
    border-radius: 999px;
    white-space: nowrap;
  }
  .settle-badge.owe { background: #fef2f2; color: #dc2626; }
  .settle-badge.receive { background: var(--success-bg); color: var(--success); }
  .settle-badge.even { background: #f3f4f6; color: var(--text-muted); }
  .settle-badge.treasurer { background: var(--primary-soft); color: var(--primary); }
  .settle-badge.muted { background: #f3f4f6; color: #9ca3af; font-weight: 500; }
  .settle-pos { color: var(--success); font-weight: 600; }
  .settle-neg { color: #dc2626; font-weight: 600; }
  .settle-check {
    width: 18px;
    height: 18px;
    accent-color: var(--primary);
    cursor: pointer;
  }
```

- [ ] **Step 3: Xoá constant + các hàm rollover**

- Xoá dòng 1024: `const FUND_PER_PERSON = 150000;`
- Xoá toàn bộ từ comment JSDoc `/** Số dư cuối tuần = ... */` (dòng 1094) đến hết `clearWeekRolloverOverride` (dòng 1156) — gồm `computeWeekEndingBalance`, `getWeekRollover`, `isRolloverManual`, `setWeekRolloverOverride`, `clearWeekRolloverOverride`.
- Xoá hàm `updateFundStats` (dòng 1977–1980).

- [ ] **Step 4: Viết lại `renderFundTab` + `renderFundStatsInto`**

Thay toàn bộ 2 hàm hiện tại (từ `/* ---- Tab: Quỹ ---- */` dòng 1778 đến hết `renderFundStatsInto` dòng 1975, trừ `calcWeekTotalSpent` dòng 1982–1989 thì GIỮ) bằng:

```js
/* ---- Tab: Quyết toán ---- */
function renderFundTab(root) {
  const title = document.createElement("h2");
  title.className = "section-title";
  title.innerHTML = "💸 Quyết toán cuối tuần";
  root.appendChild(title);

  const week = getOrCreateWeek();
  const s = computeSettlement();

  // 1. Chọn thủ quỹ
  const trBox = document.createElement("div");
  trBox.className = "treasurer-row";
  const inherited = !week.treasurerId && s.treasurerId; // đang kế thừa từ tuần trước
  const opts = ['<option value="">— Chưa chọn —</option>']
    .concat(state.members.map(m =>
      `<option value="${m.id}"${m.id === s.treasurerId ? " selected" : ""}>${escapeHtml(m.name)}</option>`))
    .join("");
  trBox.innerHTML = `
    <div class="treasurer-label">
      <span class="main-label">🏦 Thủ quỹ</span>
      <span>nhận tiền qua QR rồi chia lại${inherited ? " · theo tuần trước" : ""}</span>
    </div>
    <select id="treasurerSelect">${opts}</select>
  `;
  root.appendChild(trBox);
  trBox.querySelector("#treasurerSelect").addEventListener("change", (e) => {
    const v = parseInt(e.target.value);
    week.treasurerId = isNaN(v) ? null : v;
    save();
    render();
  });

  // 2. Thẻ thống kê
  const grid = document.createElement("div");
  grid.className = "stats-grid";
  grid.id = "fundStatsGrid";
  root.appendChild(grid);
  renderFundStatsInto(grid);

  // 3. Cảnh báo khoản chưa rõ người chi
  if (s.unattributed.length > 0) {
    const warn = document.createElement("div");
    warn.className = "settle-warning";
    const items = s.unattributed.map(u => {
      const d = addDays(state.currentWeekStart, u.dayIndex);
      return `<li>${DAY_NAMES[u.dayIndex]} ${formatDM(d)} — ${COST_TASK_LABELS[u.task]} ${fmt(u.amount)}</li>`;
    }).join("");
    warn.innerHTML = `<strong>⚠ Có khoản chi chưa rõ người chi</strong>
      <div>Vào tab Phân việc để nhận các việc sau, nếu không bảng quyết toán sẽ không cân:</div>
      <ul>${items}</ul>`;
    root.appendChild(warn);
  }

  // 4. Bảng quyết toán
  const card = document.createElement("div");
  card.className = "card flush";
  let html = '<table class="summary"><thead><tr><th>Thành viên</th><th>Đã chi</th><th>Đã ăn</th><th>Chênh lệch</th><th>Hành động</th><th>Xong</th></tr></thead><tbody>';
  s.rows.forEach(r => {
    let action;
    if (r.id === s.treasurerId) {
      action = '<span class="settle-badge treasurer">🏦 Thủ quỹ</span>';
    } else if (!s.treasurerId) {
      action = '<span class="settle-badge muted">chọn thủ quỹ trước</span>';
    } else if (r.net < -0.5) {
      action = `<span class="settle-badge owe">Chuyển ${fmt(-r.net)} → thủ quỹ</span>`;
    } else if (r.net > 0.5) {
      action = `<span class="settle-badge receive">Nhận ${fmt(r.net)} ← thủ quỹ</span>`;
    } else {
      action = '<span class="settle-badge even">✓ Cân bằng</span>';
    }
    const checked = week.settledIds.includes(r.id) ? " checked" : "";
    html += `<tr>
      <td>${escapeHtml(r.name)}</td>
      <td>${fmt(r.paid)}</td>
      <td>${fmt(r.eaten)}</td>
      <td class="${r.net >= 0 ? "settle-pos" : "settle-neg"}">${r.net > 0 ? "+" : ""}${fmt(r.net)}</td>
      <td>${action}</td>
      <td><input type="checkbox" class="settle-check" data-mid="${r.id}"${checked}></td>
    </tr>`;
  });
  html += '</tbody></table>';
  card.innerHTML = html;
  root.appendChild(card);

  card.querySelectorAll(".settle-check").forEach(cb => {
    cb.addEventListener("change", () => {
      const mid = parseInt(cb.dataset.mid);
      if (cb.checked) {
        if (!week.settledIds.includes(mid)) week.settledIds.push(mid);
      } else {
        week.settledIds = week.settledIds.filter(id => id !== mid);
      }
      save();
    });
  });

  // 5. QR thủ quỹ (giữ nguyên cơ chế upload theo tuần)
  const DEFAULT_QR = "qr-default.jpg";
  const qrCard = document.createElement("div");
  qrCard.className = "card";
  qrCard.innerHTML = `
    <h2 class="section-title" style="margin-bottom:12px">📱 Mã QR thủ quỹ</h2>
    <label class="qr-upload">
      <input type="file" accept="image/*" id="qrInput">
      <div id="qrContent"></div>
    </label>
  `;
  root.appendChild(qrCard);

  const qrSrc = week.qrImage || DEFAULT_QR;
  const qrContent = qrCard.querySelector("#qrContent");
  qrContent.innerHTML = `<img src="${escapeHtml(qrSrc)}" alt="QR thủ quỹ"><div style="font-size:12px;color:#6b7280;margin-top:10px">Nhấn để đổi ảnh khác</div><button type="button" class="qr-zoom-btn" id="qrZoomBtn">🔍 Phóng to</button>`;

  qrCard.querySelector("#qrZoomBtn").addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const overlay = document.createElement("div");
    overlay.className = "qr-modal-overlay";
    overlay.innerHTML = `<img src="${escapeHtml(qrSrc)}" alt="QR thủ quỹ">`;
    overlay.addEventListener("click", () => overlay.remove());
    document.body.appendChild(overlay);
  });

  qrCard.querySelector("#qrInput").addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      week.qrImage = reader.result;
      save();
      render();
    };
    reader.readAsDataURL(file);
  });
}

function renderFundStatsInto(grid) {
  const s = computeSettlement();
  grid.innerHTML = `
    <div class="stat-card neutral">
      <div class="stat-label">Tổng chi tuần</div>
      <div class="stat-value">${fmt(s.totalSpent)}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Thủ quỹ thu về</div>
      <div class="stat-value">${fmt(s.toTreasurer)}</div>
      <div class="stat-sub">từ người ăn nhiều hơn chi</div>
    </div>
    <div class="stat-card highlight">
      <div class="stat-label">Thủ quỹ chi ra</div>
      <div class="stat-value">${fmt(s.fromTreasurer)}</div>
      <div class="stat-sub">trả cho người chi nhiều hơn ăn</div>
    </div>
  `;
}
```

**Lưu ý khi viết lại:** block QR ở trên copy nguyên từ `renderFundTab` cũ (dòng 1906–1945) — đối chiếu lại với code cũ trước khi xoá, đặc biệt handler `qrZoomBtn` và `FileReader`. Hàm `calcWeekTotalSpent` (dòng 1982–1989) GIỮ NGUYÊN, không đụng.

- [ ] **Step 5: Quét tham chiếu sót**

Run: `grep -n "FUND_PER_PERSON\|getWeekRollover\|computeWeekEndingBalance\|isRolloverManual\|RolloverOverride\|updateFundStats\|contributors" index.html`
Expected: **không còn kết quả nào**. Nếu còn → còn chỗ tham chiếu hàm đã xoá, sửa nốt.

- [ ] **Step 6: Verify trong browser**

Mở `index.html`, vào tab "💸 Quyết toán". Kiểm tra:
1. Console không có lỗi.
2. Có dropdown thủ quỹ, 3 thẻ thống kê (đều 0đ), ảnh QR mặc định. Bảng 10 người: khi chưa chọn thủ quỹ, cột Hành động của mọi dòng là badge "chọn thủ quỹ trước".
3. Chọn 1 người làm thủ quỹ → thanh "Lưu" hiện ra, dòng người đó thành badge "🏦 Thủ quỹ".
4. Tab Chi phí: nhập 100.000 món chính cho Thứ 2 → quay lại Quyết toán: khối cảnh báo đỏ "Thứ 2 … — Món chính 100.000đ", mỗi người Đã ăn 10.000đ, chênh lệch −10.000đ (trừ thủ quỹ), "Thủ quỹ thu về" = 90.000đ.
5. Tab Phân việc: chọn danh tính, nhận việc "Nấu món chính" Thứ 2 → Quyết toán: cảnh báo biến mất, người nhận có Đã chi 100.000đ, chênh +90.000đ, badge "Nhận 90.000đ ← thủ quỹ".
6. Tick checkbox "Xong" 1 người → thanh Lưu hiện.
7. Bấm "Không lưu" để bỏ thay đổi (đừng để dính state thử nghiệm).

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "feat: thay tab Quỹ bằng tab Quyết toán cuối tuần, bỏ đóng quỹ 150k + rollover"
```

---

### Task 4: index.html — hiện người chi ở tab Chi phí

**Files:**
- Modify: `index.html` — `renderCostTab` (dòng 1521–1620) và CSS (chèn cạnh `.input-group`, tìm selector `.input-group label` trong block style)

- [ ] **Step 1: Thêm CSS**

Chèn ngay sau rule `.settle-check { ... }` (thêm ở Task 3):

```css
  .payer-hint {
    font-size: 11px;
    color: var(--text-muted);
    margin-top: 4px;
    min-height: 14px;
  }
  .payer-hint.warn { color: #dc2626; }
```

- [ ] **Step 2: Thêm element hint vào card HTML**

Trong `renderCostTab`, template `card.innerHTML`: thêm 1 dòng `<div class="payer-hint" data-task="...">` ngay **sau mỗi input** của 4 ô. Ví dụ ô món chính:

```html
      <div class="input-group">
        <label>🍲 Món chính</label>
        <input type="number" min="0" step="1000" value="${day.main || 0}" data-field="main" placeholder="0">
        <div class="payer-hint" data-task="main"></div>
      </div>
```

Tương tự cho `soup`, `fruit` và `rice` (ô "🍚 Tiền cơm" ở `inputs-row` thứ hai): `data-task="soup"`, `data-task="fruit"`, `data-task="rice"`.

- [ ] **Step 3: Thêm logic render hint**

Trong `renderCostTab`, ngay sau `updateTotals();` (dòng 1588) thêm:

```js
  // Người chi của từng khoản = người nhận việc tương ứng ở tab Phân việc
  const assn = getAssignments(dayIdx);
  const renderPayerHints = () => {
    card.querySelectorAll(".payer-hint").forEach(el => {
      const t = el.dataset.task;
      const payer = state.members.find(m => m.id === assn[t]);
      if (payer) {
        el.textContent = `💳 ${payer.name}`;
        el.classList.remove("warn");
      } else if ((day[t] || 0) > 0) {
        el.textContent = "⚠ chưa ai nhận việc";
        el.classList.add("warn");
      } else {
        el.textContent = "";
        el.classList.remove("warn");
      }
    });
  };
  renderPayerHints();
```

và trong listener input sẵn có (dòng 1590–1596), thêm gọi `renderPayerHints();` sau `updateTotals();`:

```js
  card.querySelectorAll("input[data-field]").forEach(inp => {
    inp.addEventListener("input", () => {
      day[inp.dataset.field] = parseFloat(inp.value) || 0;
      updateTotals();
      renderPayerHints();
      save();
    });
  });
```

(Dùng `textContent` nên tên người không cần escapeHtml.)

- [ ] **Step 4: Verify trong browser**

Mở `index.html`, tab Chi phí:
1. Dưới 4 ô tiền có khoảng trống hint, ban đầu trống (tiền 0, chưa ai nhận việc).
2. Nhập 50.000 vào Canh → hint dưới ô Canh thành "⚠ chưa ai nhận việc" màu đỏ.
3. Sang tab Phân việc nhận "Nấu canh" hôm đó (chọn danh tính trước) → quay lại Chi phí: hint thành "💳 <tên>".
4. Console không lỗi. Bấm "Không lưu" để bỏ state thử nghiệm.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: hiện người chi (theo phân việc) dưới ô nhập tiền tab Chi phí"
```

---

### Task 5: Kiểm tra đầu-cuối + đối chiếu spec

**Files:** không sửa code (chỉ fix nếu phát hiện lỗi)

- [ ] **Step 1: Syntax check toàn bộ JS server**

Run: `node --check api/data.js; node --check api/claim.js; node --check lib/github.js`
Expected: không lỗi.

- [ ] **Step 2: Kịch bản đầy đủ trong browser (UI-only, không cần token)**

Mở `index.html`, dựng kịch bản 1 tuần:
1. Tab Team: đảm bảo có ≥3 thành viên (mặc định 10).
2. Chọn danh tính (member A). Tab Phân việc: A nhận "Nấu món chính" T2; đổi danh tính sang B (nút "đổi"), B nhận "Nấu canh" T2.
3. Tab Chi phí T2: món chính 200.000, canh 100.000, bỏ bớt người ăn chỉ còn 5 người (trong đó có A và B).
4. Tab Quyết toán, chọn thủ quỹ = C (người chỉ ăn):
   - Tổng chi tuần = 300.000đ; mỗi người ăn = 60.000đ.
   - A: chi 200.000, ăn 60.000 → "+140.000đ", badge "Nhận 140.000đ ← thủ quỹ".
   - B: chi 100.000, ăn 60.000 → "+40.000đ", badge "Nhận 40.000đ ← thủ quỹ".
   - C (thủ quỹ, có ăn): −60.000đ nhưng badge "🏦 Thủ quỹ".
   - 2 người ăn còn lại: badge "Chuyển 60.000đ → thủ quỹ".
   - Người không ăn: "✓ Cân bằng".
   - Đối chiếu: Thủ quỹ thu về 120.000đ, chi ra 180.000đ, lệch 60.000đ = đúng phần C tự cấn trừ.
   - Không có khối cảnh báo.
5. Huỷ việc "Nấu canh" của B → Quyết toán hiện cảnh báo "Canh 100.000đ", tổng không cân (B về −60.000đ... kiểm tra B thành "Chuyển 60.000đ → thủ quỹ").
6. Đổi tuần (‹ ›) qua lại: không lỗi console, tuần mới bảng toàn 0.
7. Reload trang: không lỗi (state không lưu do không có API — đúng kỳ vọng).

- [ ] **Step 3: Đối chiếu tiêu chí spec**

So với mục "Tiêu chí hoàn thành" trong `docs/superpowers/specs/2026-06-12-weekly-settlement-design.md`: tiêu chí 1, 2, 4 verify được offline (đã làm ở Step 2); tiêu chí 3 (lưu bền qua API, prefill tuần trước, đồng bộ auto-refresh) và 5 (commit message) cần môi trường có `GITHUB_TOKEN` — verify bằng `vercel dev` nếu có `.env.local`, nếu không thì ghi chú lại cho user kiểm tra trên production sau khi deploy.

- [ ] **Step 4: Commit cuối (nếu có sửa lỗi phát sinh)**

```bash
git add -A
git commit -m "fix: hoàn thiện quyết toán cuối tuần sau kiểm tra đầu-cuối"
```

(Bỏ qua nếu không có gì để sửa.)

---

## Đối chiếu spec → task

| Yêu cầu trong spec | Task |
|---|---|
| Công thức eaten/paid/net, bỏ qua ngày không ai ăn | Task 2 (`computeSettlement`) |
| Khoản chưa rõ người chi → cảnh báo, không tự gán | Task 2 (unattributed) + Task 3 (khối cảnh báo) |
| Schema v4: `treasurerId`, `settledIds`; ngừng dùng field cũ | Task 1 + Task 2 |
| Prefill thủ quỹ từ tuần trước | Task 2 (`getDefaultTreasurerId`) + Task 3 (hint "theo tuần trước") |
| Tab Quyết toán: dropdown, 3 thẻ, bảng, tick Xong, QR | Task 3 |
| Xoá UI/hàm đóng quỹ + rollover + CSS | Task 3 |
| Tab Chi phí hiện người chi | Task 4 |
| `describeDiff` mô tả treasurer/settlement | Task 1 |
| `api/claim.js`, merge logic: không đổi | (không có task — chủ đích) |
| Tiêu chí hoàn thành 1–5 | Task 5 |
