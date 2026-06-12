# Spec: Quyết toán cuối tuần (bỏ đóng quỹ đầu tuần)

**Ngày:** 2026-06-12
**Trạng thái:** Đã duyệt thiết kế

## Bối cảnh & mục tiêu

Hiện tại app hoạt động theo mô hình quỹ: đầu tuần mỗi thành viên đóng `FUND_PER_PERSON = 150.000đ` (tick vào `contributors`), chi tiêu trong tuần trừ vào quỹ, dư/thiếu cuối tuần rollover sang tuần sau.

Mô hình mới: **không đóng gì đầu tuần**. Người nhận việc nấu/mua tự bỏ tiền túi. Cuối tuần app tổng hợp mỗi người *đã ăn* bao nhiêu và *đã chi* bao nhiêu:

- Ai ăn nhiều hơn chi → chuyển phần chênh cho **thủ quỹ** (quét QR).
- Thủ quỹ chuyển lại cho ai chi nhiều hơn ăn.
- Thủ quỹ là một thành viên trong team; phần của chính họ được cấn trừ tự động.

Hướng chia tiền là **hub qua thủ quỹ** (mọi giao dịch đi qua 1 người, 1 QR), không dùng peer-to-peer tối thiểu giao dịch.

## Mô hình tính toán

Mỗi tuần, với từng thành viên `m`:

- **Đã ăn** `eaten(m)` = Σ trên các ngày `m` có trong `attendees`: `dayTotal(day) ÷ attendees.length`. Đúng công thức tab Tổng hợp đang dùng (`renderSummaryTab`). Ngày không ai ăn → bỏ qua.
- **Đã chi** `paid(m)` = Σ tiền các khoản mà `m` là người nhận việc tương ứng trong `assignments` của ngày đó. Mapping cố định:
  - `Nấu món chính` (`main`) → tiền `day.main`
  - `Nấu canh` (`soup`) → tiền `day.soup`
  - `Mua hoa quả` (`fruit`) → tiền `day.fruit`
  - `Nấu cơm` (`rice`) → tiền `day.rice`
  - `washMain` / `washSub` không có tiền, không tham gia quyết toán.
  - Người chi không cần có mặt trong `attendees` ngày đó — chi vẫn được tính.
- **Chênh lệch** `net(m) = paid(m) − eaten(m)`:
  - `net < 0` → `m` chuyển `|net|` cho thủ quỹ.
  - `net > 0` → `m` nhận `net` từ thủ quỹ.
  - `net = 0` → cân bằng, không cần làm gì.
  - Thủ quỹ không chuyển cho chính mình; phần của họ cấn trừ trong tổng thu/chi của thủ quỹ.

### Khoản chi chưa rõ người chi

Nếu một khoản có tiền `> 0` nhưng ô phân việc tương ứng ngày đó còn trống (`null`): **không tự gán cho ai**. Tab Quyết toán hiển thị khối cảnh báo đỏ liệt kê từng khoản: ngày, tên món, số tiền (ví dụ: "T3 04/06 — Món chính 200.000đ chưa rõ người chi"). Khi còn khoản chưa rõ, tổng quyết toán không cân (Σ eaten > Σ paid) — chấp nhận, cảnh báo là đủ; người dùng quay lại tab Phân việc để nhận việc.

## Dữ liệu (schema v3 → v4)

Shape tuần mới:

```
weeks["YYYY-MM-DD"] = {
  days, assignments, qrImage,
  treasurerId: memberId | null,   // MỚI: thủ quỹ của tuần
  settledIds: [memberId, ...],    // MỚI: ai đã tick "đã chuyển / đã nhận xong"
  // contributors, rolloverOverride: NGỪNG DÙNG — giữ nguyên trong data cũ, code không đọc/ghi nữa
}
```

- `SCHEMA_VERSION` trong `index.html`: 3 → 4. Cập nhật `schemaVersion` trong file seed `data.json` ở repo root cho khớp shape mới.
- `treasurerId` mặc định `null`; khi render, nếu tuần hiện tại chưa có thì UI gợi ý (prefill) thủ quỹ của tuần gần nhất trước đó có `treasurerId`. Giá trị chỉ được ghi vào state khi user xác nhận/đổi (đi qua nút Lưu).
- `settledIds` reset rỗng mỗi tuần mới (mỗi tuần quyết toán độc lập).
- Dữ liệu tuần cũ (`contributors`, `rolloverOverride`) giữ nguyên trong `data.json` trên branch `data`, không migrate, không xoá. Tuần cũ xem lại hiển thị theo bảng quyết toán mới, tính từ chi phí + phân việc sẵn có.

## UI

### Tab Quỹ → "💸 Quyết toán" (`renderFundTab` viết lại)

Thứ tự từ trên xuống:

1. **Chọn thủ quỹ**: dropdown danh sách thành viên (+ lựa chọn trống "— Chưa chọn —"). Đổi giá trị → `save()` (hiện thanh Lưu như các tab bulk).
2. **3 thẻ thống kê**: Tổng chi tuần / Thủ quỹ thu về (Σ |net| của người net âm, trừ thủ quỹ) / Thủ quỹ chi ra (Σ net của người net dương, trừ thủ quỹ).
3. **Khối cảnh báo** khoản chưa rõ người chi (chỉ hiện khi có).
4. **Bảng quyết toán**: mỗi thành viên một dòng: `Tên | Đã chi | Đã ăn | Chênh lệch | Hành động | Xong`.
   - Hành động: "Chuyển 35.000đ → thủ quỹ" / "Nhận 120.000đ ← thủ quỹ" / "✓ Cân bằng" / với thủ quỹ: nhãn "🏦 Thủ quỹ".
   - "Xong" là checkbox tick vào `settledIds`, lưu qua nút Lưu (bulk save, không động `/api/claim`).
   - Chưa chọn thủ quỹ → bảng vẫn hiện số liệu nhưng cột hành động ghi chú nhắc chọn thủ quỹ.
5. **Ảnh QR**: giữ nguyên cơ chế hiện tại (upload theo tuần, mặc định `qr-default.jpg`, nút phóng to).

### Xoá khỏi codebase

- Checklist đóng quỹ (contributors UI), nút "tất cả/xoá hết", thống kê "Đã đóng x/y".
- Ô nhập rollover + nút "↺ Tự động".
- Hằng `FUND_PER_PERSON`; các hàm `computeWeekEndingBalance`, `getWeekRollover`, `isRolloverManual`, `setWeekRolloverOverride`, `clearWeekRolloverOverride`.
- CSS không còn dùng (`.rollover-row`, `.contributors-*`) dọn theo.

### Tab Chi phí (`renderCostTab`) — bổ sung nhỏ

Dưới mỗi ô nhập tiền (món chính/canh/hoa quả/cơm) hiện dòng chữ nhỏ chỉ-đọc tên người chi lấy từ phân việc ngày đó, ví dụ "💳 Nguyễn A"; nếu chưa ai nhận: "⚠ chưa ai nhận việc". Cập nhật khi đổi ngày/refresh.

### Các tab khác

Tổng hợp, Phân việc, Team: **không đổi**.

## API

- `api/claim.js`: **không đổi**.
- `api/data.js`:
  - `mergePreservingAssignments` đã spread cả object tuần (`...cw`) nên `treasurerId`/`settledIds` tự đi qua bulk PUT — không sửa logic merge.
  - `describeDiff`: bỏ so sánh `contributors`/`rolloverOverride`; thêm so sánh `treasurerId` ("set treasurer ...") và `settledIds` ("settlement ticks").
- `lib/github.js`: không đổi. `EMPTY_PAYLOAD` nếu có khai `schemaVersion` thì cập nhật lên 4.

## Ngoài phạm vi

- Không migrate/xoá field cũ trong dữ liệu lịch sử.
- Không tối ưu số giao dịch peer-to-peer.
- Không thêm xác thực thật — danh tính tin cậy qua localStorage giữ nguyên.
- Không thông báo/nhắc nhở tự động cuối tuần.

## Tiêu chí hoàn thành

1. Tuần có dữ liệu chi phí + phân việc đầy đủ: bảng quyết toán cân (Σ chênh lệch = 0), số người chuyển/nhận và số tiền đúng theo công thức trên.
2. Khoản chi có tiền nhưng chưa ai nhận việc hiện đúng trong khối cảnh báo, không bị gán cho ai.
3. Thủ quỹ chọn được, lưu bền qua `/api/data`, prefill từ tuần trước; tick "Xong" lưu và đồng bộ giữa các thiết bị qua auto-refresh.
4. Không còn dấu vết UI đóng quỹ 150k/rollover; mở tuần cũ không lỗi console.
5. Commit message từ `describeDiff` mô tả đúng thay đổi treasurer/settlement.
