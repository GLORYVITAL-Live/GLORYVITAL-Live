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
/**
 * อุปกรณ์ที่ให้ยืมได้ (สถานะใช้งานได้) — ไม่มีราคา / Serial
 *   room = ที่เก็บเป็นห้องไลฟ์ ("ห้องไลฟ์ Cherry Glory") = ของประจำห้อง (ไม่ใช่ห้องไลฟ์ = null)
 */
export type CatalogItem = { id: number; code: string; name: string; category: string; quantity: number; photoUrl: string | null; room?: string | null };
/** ช่วงที่ของถูกกันไว้ (คำขอที่อนุมัติแล้ว / ยืมอยู่ — ไม่บอกว่าใครยืม) */
export type Hold = { loanId: number; equipmentId: number; quantity: number; startMs: number; endMs: number };
/** ช่วงที่ห้องไลฟ์มีไลฟ์ (จาก slot ของช่องนั้น — ต่อกันรวมเป็นช่วงเดียว) */
export type LiveBlock = { room: string; startMs: number; endMs: number };
/** ข้อมูลที่ใช้คิดของว่าง: อุปกรณ์ + ที่ถูกยืม + ไลฟ์ของแต่ละห้อง */
export type Stock = { catalog: CatalogItem[]; holds: Hold[]; live: LiveBlock[] };

/** คืนเลยกำหนด (ยืมอยู่ และเลยเวลาคืนแล้ว) */
export const isOverdue = (l: Pick<Loan, "status" | "endAt">, now = Date.now()) => l.status === "borrowed" && Date.parse(l.endAt) < now;

/**
 * จำนวนสูงสุดที่ถูกกันพร้อมกันในช่วง [start, end) ของอุปกรณ์ชิ้นนี้ (ไม่นับคำขอ exceptLoan)
 *   คำขอที่ไม่ซ้อนกันเอง (ยืมจันทร์ 1 / พุธ 1) ในช่วงจันทร์–พุธ = กันสูงสุด 1 ไม่ใช่ 2
 */
export function peakHeld(holds: Hold[], equipmentId: number, startMs: number, endMs: number, exceptLoan?: number) {
  return peakOf(holds.filter((h) => h.equipmentId === equipmentId && h.loanId !== exceptLoan), startMs, endMs);
}

/** จำนวนที่ใช้พร้อมกันสูงสุดในช่วง [start, end) จากหลายช่วง (ช่วงละ quantity) */
function peakOf(list: { quantity: number; startMs: number; endMs: number }[], startMs: number, endMs: number) {
  const ev: [number, number][] = [];
  for (const h of list) {
    if (h.endMs <= startMs || h.startMs >= endMs) continue;
    ev.push([Math.max(h.startMs, startMs), h.quantity], [Math.min(h.endMs, endMs), -h.quantity]);
  }
  // เวลาเท่ากัน: คืนก่อนยืม (คืน 10:00 แล้วอีกคนยืม 10:00 = ไม่ซ้อน)
  ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let cur = 0, peak = 0;
  for (const [, q] of ev) { cur += q; peak = Math.max(peak, cur); }
  return peak;
}

// ---------- ไฟ / กล้องประจำห้องไลฟ์ ----------

/** ห้องไลฟ์ต้องมีไฟประจำห้องกี่ชุดระหว่างมีไลฟ์ (ไฟ + ขา + Softbox อย่างละ 2) · ชุดกล้อง (กล้อง / แบตดัมมี่ / ขาตั้ง / Capture Card + สาย) = อย่างละ 1 */
export const ROOM_NEED = 2;
export const ROOM_CAMERA_NEED = 1;
const ROOM_ROLES: LightRole[] = ["light", "stand", "softbox"];
type CameraRole = "camera" | "cameraPower" | "tripod" | "capture" | "captureCable";
type RoomRole = LightRole | CameraRole;
const ROLE_TEXT: Record<RoomRole, string> = {
  light: "ไฟ", stand: "ขาไฟ", softbox: "Softbox", cable: "สายไฟ",
  camera: "กล้อง", cameraPower: "แบตดัมมี่ / อะแดปเตอร์กล้อง", tripod: "ขาตั้งกล้อง", capture: "Capture Card", captureCable: "สาย Capture Card",
};

/** ตัวกล้อง (หมวดกล้อง ไม่ใช่แบตดัมมี่ / สาย / อะแดปเตอร์ / เลนส์) */
export const isCameraBody = (c: Pick<CatalogItem, "name" | "category">) =>
  /กล้อง|camera/i.test(c.category) && !/ขาตั้ง/.test(c.category) && !/dummy|coupler|adapter|battery|แบต|สาย|lens|เลนส์/i.test(c.name);

/** ของชุดกล้องที่ห้องไลฟ์ต้องใช้ (อ่านจากหมวด + ชื่อ) · ไม่ใช่ = null */
export function cameraRole(c: Pick<CatalogItem, "name" | "category">): CameraRole | null {
  if (/capture/i.test(c.category)) return /^สาย/.test(c.name.trim()) ? "captureCable" : "capture";
  if (/ขาตั้งกล้อง/.test(c.category)) return "tripod";
  if (isCameraBody(c)) return "camera";
  if (/กล้อง|camera/i.test(c.category) && /dummy|coupler|adapter|battery|แบต/i.test(c.name)) return "cameraPower";
  return null;
}

/** หน้าที่ในห้องไลฟ์ + ห้องต้องเหลือไว้กี่ชิ้นตอนมีไลฟ์ (ไฟ / ขา / Softbox ห้องละ 2 · ชุดกล้องอย่างละ 1) · ของที่ไม่ต้องกันไว้ = null */
function roomRole(c: CatalogItem): { role: RoomRole; need: number } | null {
  const l = lightRole(c);
  if (l && ROOM_ROLES.includes(l)) return { role: l, need: ROOM_NEED };
  const cam = cameraRole(c);
  return cam ? { role: cam, need: ROOM_CAMERA_NEED } : null;
}

/** ของประจำห้องไลฟ์ที่ทำหน้าที่เดียวกัน (ไฟของห้อง Cherry Glory ทั้งหมด) · ไม่ใช่ของประจำห้อง = null */
function roomGroup(stock: Stock, c: CatalogItem) {
  const r = roomRole(c);
  if (!c.room || !r) return null;
  return { room: c.room, role: r.role, need: r.need, items: stock.catalog.filter((x) => x.room === c.room && roomRole(x)?.role === r.role) };
}

/**
 * ของประจำห้องที่ยังยืมได้ในช่วงนี้ = ทั้งหมดในห้อง − (ที่ห้องต้องใช้ตอนมีไลฟ์ + ที่ถูกยืมไปแล้ว) ณ เวลาที่ใช้มากสุด
 *   เช่น ห้องมีไฟ 3 ดวง ไลฟ์ 19:00–23:00 ยืม 18:00–20:00 ได้ 1 ดวง · ห้องมี 2 ดวง = ยืมได้เฉพาะช่วงที่ไม่มีไลฟ์
 */
function roomLeft(stock: Stock, g: NonNullable<ReturnType<typeof roomGroup>>, startMs: number, endMs: number, exceptLoan?: number) {
  const ids = new Set(g.items.map((x) => x.id));
  const total = g.items.reduce((a, x) => a + x.quantity, 0);
  const used = [
    ...stock.holds.filter((h) => ids.has(h.equipmentId) && h.loanId !== exceptLoan),
    ...stock.live.filter((b) => b.room === g.room).map((b) => ({ ...b, quantity: g.need })),
  ];
  return Math.max(0, total - peakOf(used, startMs, endMs));
}

/** เหลือให้ยืมกี่ชิ้นในช่วงนี้ (นับทั้งที่ถูกยืม และไฟที่ห้องไลฟ์ต้องใช้) */
export function leftOf(stock: Stock, c: CatalogItem, startMs: number, endMs: number, exceptLoan?: number) {
  const own = availableQty(c, stock.holds, startMs, endMs, exceptLoan);
  const g = roomGroup(stock, c);
  return g ? Math.min(own, roomLeft(stock, g, startMs, endMs, exceptLoan)) : own;
}

/** ที่เก็บที่เป็นห้องไลฟ์ (ของในห้องนี้ = ของประจำห้อง) */
export const isLiveRoom = (location: string) => /ห้องไลฟ์/.test(location);
// ชื่อช่องใน slot → คำในชื่อห้อง (ช่อง GLORY MALL แสดงเป็น GLORY VITAL · ห้องชื่อ "ห้องไลฟ์ Glory Vital (Mall)")
const ROOM_ALIASES: Record<string, string[]> = { "glory mall": ["mall", "glory vital"], "cherry glory": ["cherry"], "skin expert": ["skin expert"] };

/** ห้องไลฟ์ของช่องนี้ (ไม่เจอ = null) */
export function roomForPlatform(platform: string, rooms: string[]) {
  const p = platform.trim().toLowerCase();
  const keys = [p, ...(ROOM_ALIASES[p] ?? [])];
  return rooms.find((r) => keys.some((k) => r.toLowerCase().includes(k))) ?? null;
}

/** slot ไลฟ์ → ช่วงที่แต่ละห้องมีไลฟ์ (slot ต่อกัน / ซ้อนกันในห้องเดียวกัน = ช่วงเดียว) */
export function liveBlocks(slots: { platform: string; startMs: number; endMs: number }[], rooms: string[]): LiveBlock[] {
  const byRoom = new Map<string, { startMs: number; endMs: number }[]>();
  for (const s of slots) {
    const room = roomForPlatform(s.platform, rooms);
    if (room) byRoom.set(room, [...(byRoom.get(room) ?? []), s]);
  }
  const out: LiveBlock[] = [];
  for (const [room, list] of byRoom) {
    list.sort((a, b) => a.startMs - b.startMs);
    let cur: LiveBlock | null = null;
    for (const s of list) {
      if (cur && s.startMs <= cur.endMs) cur.endMs = Math.max(cur.endMs, s.endMs);
      else { if (cur) out.push(cur); cur = { room, startMs: s.startMs, endMs: s.endMs }; }
    }
    if (cur) out.push(cur);
  }
  return out;
}

/** ห้องไลฟ์ที่ทำให้ชิ้นนี้ยืมได้น้อยลงในช่วงนี้ ("" = ไม่ติดไลฟ์) */
export function liveConflict(stock: Stock, c: CatalogItem, startMs: number, endMs: number) {
  const g = roomGroup(stock, c);
  if (!g || !stock.live.some((b) => b.room === g.room && b.startMs < endMs && b.endMs > startMs)) return "";
  return leftOf(stock, c, startMs, endMs) < availableQty(c, stock.holds, startMs, endMs) ? g.room : "";
}

/**
 * ห้องไลฟ์ของชิ้นนี้ที่มีไลฟ์ในช่วงนี้ + ยืมได้รวมทั้งห้องกี่ชิ้น (หน้าที่เดียวกัน) · ไม่ใช่ของประจำห้อง / ห้องไม่มีไลฟ์ = null
 *   key = กลุ่มเดียวกัน (ห้อง + หน้าที่) ใช้หักชิ้นอื่นในห้องเดียวกันที่เลือกไว้แล้ว
 */
export function roomInfo(stock: Stock, c: CatalogItem, startMs: number, endMs: number) {
  const g = roomGroup(stock, c);
  if (!g || !stock.live.some((b) => b.room === g.room && b.startMs < endMs && b.endMs > startMs)) return null;
  return { key: `${g.room}|${g.role}`, room: g.room, left: roomLeft(stock, g, startMs, endMs), ids: g.items.map((x) => x.id) };
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

/**
 * รายการที่ขอเกินจำนวนที่เหลือในช่วงนั้น (ว่าง = ยืมได้ครบ)
 *   ของประจำห้องไลฟ์ตรวจรวมทั้งกลุ่มด้วย (ขอไฟห้องเดียวกัน 2 ดวง แต่ห้องเหลือให้ยืม 1 = ไม่พอ)
 */
export function shortages(items: { equipmentId: number; quantity: number }[], stock: Stock, startMs: number, endMs: number, exceptLoan?: number) {
  const byId = new Map(stock.catalog.map((c) => [c.id, c]));
  const out: { equipmentId: number; name: string; want: number; left: number }[] = [];
  const groups = new Map<string, { g: NonNullable<ReturnType<typeof roomGroup>>; want: number; first: number }>();
  for (const it of items) {
    const c = byId.get(it.equipmentId);
    if (!c) { out.push({ equipmentId: it.equipmentId, name: "อุปกรณ์ที่ให้ยืมไม่ได้แล้ว", want: it.quantity, left: 0 }); continue; }
    const left = leftOf(stock, c, startMs, endMs, exceptLoan);
    if (it.quantity > left) { out.push({ equipmentId: c.id, name: c.name, want: it.quantity, left }); continue; }
    const g = roomGroup(stock, c);
    if (g) {
      const k = `${g.room}|${g.role}`;
      const cur = groups.get(k) ?? { g, want: 0, first: c.id };
      cur.want += it.quantity;
      groups.set(k, cur);
    }
  }
  for (const { g, want, first } of groups.values()) {
    const left = roomLeft(stock, g, startMs, endMs, exceptLoan);
    if (want > left) out.push({ equipmentId: first, name: `${ROLE_TEXT[g.role]}ของ${g.room} (ต้องเหลือไว้ไลฟ์)`, want, left });
  }
  return out;
}
