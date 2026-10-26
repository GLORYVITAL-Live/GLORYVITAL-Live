// ขอยืมอุปกรณ์จากทีมอื่นในบริษัท — ใช้ทั้งเซิร์ฟเวอร์และหน้าเว็บ (เทสได้) · SQL 20261110000000_equipment_loans
//   ทีมอื่น (บัญชี borrower) ส่งคำขอ → คนที่เข้าหน้าอุปกรณ์ได้ อนุมัติ / ไม่อนุมัติ → ส่งของ (ยืมออก) → รับคืน
//   ของที่อนุมัติแล้ว / ยืมออกไปแล้ว = กันจำนวนไว้ในช่วงนั้น (คำขอที่รออนุมัติยังไม่กัน แต่บอกให้รู้)

export const LOAN_STATUSES = ["pending", "approved", "rejected", "borrowed", "returned", "cancelled"] as const;
export type LoanStatus = (typeof LOAN_STATUSES)[number];
export const LOAN_STATUS_TEXT: Record<LoanStatus, string> = {
  pending: "รออนุมัติ", approved: "อนุมัติแล้ว (รอรับของ)", rejected: "ไม่อนุมัติ", borrowed: "ยืมอยู่", returned: "คืนแล้ว", cancelled: "ยกเลิก",
};
/** สถานะที่กันจำนวนของไว้ */
export const HOLDING: LoanStatus[] = ["approved", "borrowed"];
/** สถานะที่ยังไม่จบ (แสดงเป็นรายการที่ต้องทำ) */
export const OPEN: LoanStatus[] = ["pending", "approved", "borrowed"];

export type LoanAction = "approve" | "reject" | "handover" | "return" | "cancel";
/** การกดแต่ละอย่างเปลี่ยนจากสถานะไหนได้บ้าง */
export const ACTION_FROM: Record<LoanAction, LoanStatus[]> = {
  approve: ["pending"],
  reject: ["pending", "approved"],
  handover: ["approved"],
  return: ["borrowed"],
  cancel: ["pending", "approved"],
};
export const ACTION_TO: Record<LoanAction, LoanStatus> = {
  approve: "approved", reject: "rejected", handover: "borrowed", return: "returned", cancel: "cancelled",
};
export const canAct = (status: LoanStatus, action: LoanAction) => ACTION_FROM[action].includes(status);

export type LoanItem = { equipmentId: number; quantity: number; name: string; code: string; category: string };
export type Loan = {
  id: number; status: LoanStatus;
  requester: { id: number | null; name: string; email: string; team: string; phone: string };
  location: string; purpose: string; startAt: string; endAt: string; items: LoanItem[];
  decidedBy: string | null; decidedAt: string | null; rejectReason: string;
  handedBy: string | null; handedAt: string | null; returnedBy: string | null; returnedAt: string | null; returnNote: string;
  createdAt: string;
};
/** อุปกรณ์ที่ให้ยืมได้ (สถานะใช้งานได้) — ไม่มีราคา / Serial */
export type CatalogItem = { id: number; code: string; name: string; category: string; quantity: number; photoUrl: string | null };
/** ช่วงที่ของถูกกันไว้ (คำขอที่อนุมัติแล้ว / ยืมอยู่ — ไม่บอกว่าใครยืม) */
export type Hold = { loanId: number; equipmentId: number; quantity: number; startMs: number; endMs: number };

/** คืนเลยกำหนด (ยืมอยู่ และเลยเวลาคืนแล้ว) */
export const isOverdue = (l: Pick<Loan, "status" | "endAt">, now = Date.now()) => l.status === "borrowed" && Date.parse(l.endAt) < now;

/**
 * จำนวนสูงสุดที่ถูกกันพร้อมกันในช่วง [start, end) ของอุปกรณ์ชิ้นนี้ (ไม่นับคำขอ exceptLoan)
 *   คำขอที่ไม่ซ้อนกันเอง (ยืมจันทร์ 1 / พุธ 1) ในช่วงจันทร์–พุธ = กันสูงสุด 1 ไม่ใช่ 2
 */
export function peakHeld(holds: Hold[], equipmentId: number, startMs: number, endMs: number, exceptLoan?: number) {
  const ev: [number, number][] = [];
  for (const h of holds) {
    if (h.equipmentId !== equipmentId || h.loanId === exceptLoan || h.endMs <= startMs || h.startMs >= endMs) continue;
    ev.push([Math.max(h.startMs, startMs), h.quantity], [Math.min(h.endMs, endMs), -h.quantity]);
  }
  // เวลาเท่ากัน: คืนก่อนยืม (คืน 10:00 แล้วอีกคนยืม 10:00 = ไม่ซ้อน)
  ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let cur = 0, peak = 0;
  for (const [, q] of ev) { cur += q; peak = Math.max(peak, cur); }
  return peak;
}

/** เหลือให้ยืมกี่ชิ้นในช่วงนี้ */
export const availableQty = (item: Pick<CatalogItem, "id" | "quantity">, holds: Hold[], startMs: number, endMs: number, exceptLoan?: number) =>
  Math.max(0, item.quantity - peakHeld(holds, item.id, startMs, endMs, exceptLoan));

/** ยืมได้นานสุดกี่วันต่อครั้ง */
export const MAX_LOAN_DAYS = 90;

export type LoanInput = { location: string; purpose: string; phone: string; team: string; startMs: number; endMs: number; items: { equipmentId: number; quantity: number }[] };

/** ตรวจ / ทำความสะอาดคำขอจากฟอร์ม (เวลาเป็น ISO) คืน error เป็นข้อความ */
export function cleanLoanInput(raw: Record<string, unknown>, now = Date.now()): { data: LoanInput } | { error: string } {
  const text = (v: unknown, max: number) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);
  const location = text(raw.location, 200);
  if (!location) return { error: "กรุณาใส่สถานที่ใช้งาน" };
  const startMs = Date.parse(String(raw.startAt ?? "")), endMs = Date.parse(String(raw.endAt ?? ""));
  if (!Number.isFinite(startMs)) return { error: "กรุณาเลือกวันเวลายืม" };
  if (!Number.isFinite(endMs)) return { error: "กรุณาเลือกวันเวลาคืน" };
  if (endMs <= startMs) return { error: "วันเวลาคืนต้องหลังวันเวลายืม" };
  // เผื่อกรอกฟอร์มนาน: ย้อนหลังได้ไม่เกิน 1 ชม.
  if (startMs < now - 3600_000) return { error: "วันเวลายืมผ่านไปแล้ว" };
  if (endMs - startMs > MAX_LOAN_DAYS * 86400_000) return { error: `ยืมได้ครั้งละไม่เกิน ${MAX_LOAN_DAYS} วัน` };
  const list: unknown[] = Array.isArray(raw.items) ? raw.items : [];
  const items = new Map<number, number>();
  for (const it of list.slice(0, 50) as { equipmentId?: unknown; quantity?: unknown }[]) {
    const id = Number(it?.equipmentId), q = Number(it?.quantity);
    if (!Number.isInteger(id) || id <= 0) continue;
    if (!Number.isInteger(q) || q <= 0) return { error: "จำนวนต้องเป็นเลขจำนวนเต็มมากกว่า 0" };
    items.set(id, (items.get(id) ?? 0) + q);
  }
  if (!items.size) return { error: "กรุณาเลือกอุปกรณ์ที่จะยืมอย่างน้อย 1 รายการ" };
  return {
    data: {
      location, purpose: text(raw.purpose, 500), phone: text(raw.phone, 30), team: text(raw.team, 100), startMs, endMs,
      items: [...items].map(([equipmentId, quantity]) => ({ equipmentId, quantity })),
    },
  };
}

// ---------- ยืมไฟเป็นชุด (ไฟ + Softbox + ขา) ----------

/** หน้าที่ของอุปกรณ์หมวดไฟ (อ่านจากชื่อ) · ไม่ใช่หมวดไฟ = null */
export type LightRole = "light" | "stand" | "softbox" | "cable";
export function lightRole(c: Pick<CatalogItem, "name" | "category">): LightRole | null {
  if (!/ไฟ|light/i.test(c.category)) return null;
  const n = c.name.trim().toLowerCase();
  if (/^\(?ขา|light ?stand/.test(n)) return "stand";
  if (/softbox|light ?box|lantern/.test(n)) return "softbox";
  if (/^สายไฟ/.test(n)) return "cable";
  return "light";
}
/** รุ่นของไฟ ("Nanlite FS-150B + สายไฟ Nanlite FS-150B" → "nanlite fs-150b") ใช้จับคู่ขา / สายไฟรุ่นเดียวกัน */
const modelOf = (name: string) => name.split("+")[0].trim().toLowerCase();

/**
 * ของที่ยืมคู่กับไฟ 1 ดวง: ขา 1 + Softbox 1 (+ สายไฟของรุ่นนั้นถ้าแยกรายการ เช่น Godox P260C pro)
 *   ขา: รุ่นเดียวกันก่อน ("ขา leones haven 200bi") → ขาทั่วไป (OdigiLife / สแตนเลส) → ขาของรุ่นอื่น
 *   Softbox: ยี่ห้อเดียวกันก่อน → ตัวไหนก็ได้ · เลือกเฉพาะตัวที่ยังว่าง (free = ว่างในช่วงนั้น − ที่เลือกไว้แล้ว)
 *   ไม่มีของว่าง = ไม่มีรายการนั้น (บอกผู้ยืม)
 */
export function companionsFor(light: CatalogItem, catalog: CatalogItem[], free: (c: CatalogItem) => number) {
  const model = modelOf(light.name), brand = model.split(/\s+/)[0];
  const lightModels = catalog.filter((c) => lightRole(c) === "light").map((c) => modelOf(c.name));
  const score = (c: CatalogItem, role: LightRole) => {
    const n = c.name.toLowerCase();
    if (role === "softbox") return n.includes(brand) ? 2 : 1;
    if (n.includes(model)) return 3;
    if (role === "cable") return 0; // สายไฟของรุ่นอื่น = ไม่เอา
    return lightModels.some((m) => n.includes(m)) ? 1 : 2;
  };
  const best = (role: LightRole) => catalog
    .filter((c) => lightRole(c) === role && free(c) > 0 && score(c, role) > 0)
    .sort((a, b) => score(b, role) - score(a, role))[0];
  const cable = catalog.some((c) => lightRole(c) === "cable" && c.name.toLowerCase().includes(model)) ? best("cable") : undefined;
  return {
    items: [best("stand"), best("softbox"), cable].filter((c): c is CatalogItem => !!c),
    missing: [!best("stand") ? "ขาไฟ" : "", !best("softbox") ? "Softbox" : ""].filter(Boolean),
  };
}

/** รายการที่ขอเกินจำนวนที่เหลือในช่วงนั้น (ว่าง = ยืมได้ครบ) */
export function shortages(items: { equipmentId: number; quantity: number }[], catalog: CatalogItem[], holds: Hold[], startMs: number, endMs: number, exceptLoan?: number) {
  const byId = new Map(catalog.map((c) => [c.id, c]));
  return items.flatMap((it) => {
    const c = byId.get(it.equipmentId);
    if (!c) return [{ equipmentId: it.equipmentId, name: "อุปกรณ์ที่ให้ยืมไม่ได้แล้ว", want: it.quantity, left: 0 }];
    const left = availableQty(c, holds, startMs, endMs, exceptLoan);
    return it.quantity > left ? [{ equipmentId: c.id, name: c.name, want: it.quantity, left }] : [];
  });
}
