import type { GmvBefore } from "@/lib/gmv";
import type { LiveSession } from "@/lib/live-stats";

export type Role = "mc" | "admin" | "owner";

export type Me = {
  email: string;
  mc: { id: number; name: string } | null;
  admin: { id: number; name: string; isExtra: boolean } | null;
  /** mc / admin = สิทธิ์จัดการฝั่งนั้น (ติ๊กทั้งคู่ = จัดการได้ทั้งหมด รวมถึงรายชื่อ Owner) */
  /** proofs = จัดการหลักฐานไลฟ์ทุก slot (Owner ที่ติ๊ก Mc มีสิทธิ์นี้อยู่แล้ว) */
  /** analytics = เข้าหน้า Data analytics (สถิติไลฟ์) ได้ */
  /** plan = หน้า Plan Slot Live (แพลน slot ทั้งเดือน) */
  /** mc / admin / proofs / analytics / plan = "จัดการได้" · see = เปิดดูได้ (จัดการได้ หรือ ดูได้อย่างเดียว) */
  owner: {
    id: number; name: string; mc: boolean; admin: boolean; proofs: boolean; analytics: boolean; plan: boolean;
    see: { mc: boolean; admin: boolean; proofs: boolean; analytics: boolean; plan: boolean };
  } | null;
  /** Marketing = เห็นแค่หน้า CEO Live (ดูอย่างเดียว) */
  marketing: { id: number; name: string } | null;
  /** หน้าอุปกรณ์โปรดักชั่น (ดู / เพิ่ม / แก้ได้): Owner ที่จัดการ Mc หรือ Admin ได้ + Admin ที่ติ๊ก can_manage_equipment */
  equipment: boolean;
};

export const EQUIPMENT_STATUSES = ["ใช้งานได้", "ชำรุด", "ส่งซ่อม", "หาย", "เลิกใช้"] as const;
export type EquipmentStatus = (typeof EQUIPMENT_STATUSES)[number];
/** อุปกรณ์ 1 รายการ (photoUrl = ลิงก์ชั่วคราวของรูป หมดอายุใน 1 ชม.) */
export type Equipment = {
  id: number; code: string; name: string; category: string; quantity: number; status: EquipmentStatus; location: string;
  brand: string; model: string; serial: string; purchaseDate: string | null; price: number | null; note: string;
  photoUrl: string | null; updatedAt: string; updatedBy: string;
};

/** ครั้งที่มี CEO Live (จาก slot Mc ที่ชื่อแคมเปญมีคำว่า CEO) — date = วันไลฟ์ YYYY-MM-DD ตามเวลาไทย */
export type CeoEvent = {
  date: string;
  /** ชื่อแคมเปญใน slot เช่น "CEO Live" / "CEO PHONE IN" / "3.3 x CEO LIVE" */
  label: string;
  /** ช่วงเวลาที่ CEO ไลฟ์ (ชื่อช่องที่แสดง เช่น GLORY VITAL) */
  times: { platform: string; start: string; end: string }[];
  /** บัญชีในไฟล์ Export ของช่องที่ CEO ไลฟ์ ("TikTok|7126…") */
  accounts: string[];
};
/** ข้อมูล "รอบ CEO Live" ที่ track แยก (ช่วงที่ CEO ไลฟ์) — ctr / co เป็นสัดส่วน (0.2436 = 24.36%) */
export type CeoSession = {
  date: string;
  title: string;
  timeRange: string;
  durationHr: number | null;
  gmv: number | null;
  orders: number | null;
  viewers: number | null;
  views: number | null;
  peakViewers: number | null;
  peakTime: string;
  impressions: number | null;
  ctr: number | null;
  co: number | null;
};
/**
 * หน้า CEO Live: ไลฟ์ (sessions) มีเฉพาะของวัน CEO Live และวันก่อน · months = เดือนที่มีข้อมูลในระบบ
 *   tracked = ข้อมูลรอบ CEO · trackedReady = รัน SQL ตาราง ceo_sessions แล้ว · canEdit = อัปโหลด / ลบข้อมูลรอบ CEO ได้
 */
export type CeoLiveData = {
  today: string; events: CeoEvent[]; sessions: LiveSession[]; months: string[];
  tracked: CeoSession[]; trackedReady: boolean; canEdit: boolean;
};

export type OwnerScope = { mc: boolean; admin: boolean };

/** หน้าแรกของเจ้าของ (งานค้าง) — slot หนึ่งรายการ */
export type HomeSlot = { id: number; date: string; platform: string; start: string; end: string; mc: string | null; admin: string | null };
export type HomeData = {
  today: string;
  scope: { mc: boolean; admin: boolean; proofs: boolean };
  /** slot ของ Mc วันนี้ (รวมช่วงหลังเที่ยงคืนของเมื่อวานที่ยังไม่จบ) */
  live: (HomeSlot & { status: "done" | "live" | "next"; proof: boolean; noProof: boolean; gmv: boolean })[];
  /** 7 วันข้างหน้า (รวมวันนี้) slot ที่ยังไม่มี Mc / ยังไม่มี Admin */
  noMc: HomeSlot[];
  noAdmin: HomeSlot[];
  /** 7 วันล่าสุด slot ที่จบแล้วแต่ยังไม่แนบหลักฐาน (ไม่นับ Mc ประจำ) / ยังไม่กรอก GMV */
  missingProof: HomeSlot[];
  missingGmv: HomeSlot[];
  /** แคมเปญที่กำลังดำเนินอยู่ + ภายใน 30 วันข้างหน้า */
  campaigns: { key: string; label: string; start: string; end: string; status: "live" | "upcoming"; daysUntil: number; slots: number; noMc: number }[];
  issues: {
    /** มีคิวข้างหน้าแต่ไม่มีอีเมล (login ไม่ได้ คิวไม่ลงปฏิทิน) */
    noEmail: { role: "mc" | "admin"; name: string; upcoming: number }[];
    noEmailTotal: number;
    /** เบอร์โทรเดียวกันหลายรายชื่อ (อาจเป็นคนเดียวกันที่ลงชื่อซ้ำ) */
    samePhone: { role: "mc" | "admin"; phone: string; names: string[] }[];
    /** สายไลฟ์ที่ GMV ที่กรอกรวมเกินยอดไลฟ์จริงใน Export (น่าจะกรอกยอดสะสมโดยไม่ได้หัก) */
    gmvOver: { date: string; platform: string; from: string; to: string; entered: number; actual: number }[];
    /** slot ที่ยอดที่กรอกสูงกว่า 3 เท่า (high) หรือต่ำกว่า 1/4 ของยอดประมาณจาก Export (est) */
    gmvOdd: { date: string; platform: string; time: string; mc: string; gmv: number; est: number; high: boolean }[];
  };
  /** ตรวจสุขภาพข้อมูล (src/lib/health.ts) */
  health: HealthIssues;
  /** คนดูสำรองข้อมูลได้ (Owner ที่ตั้ง can_close_periods) = แสดงส่วน "สำรองข้อมูล" ท้ายหน้า */
  canBackup?: boolean;
};

/** ตรวจสุขภาพข้อมูล: ต้นเดือนนี้ถึง 60 วันข้างหน้า เฉพาะฝั่งที่มีสิทธิ์ (time = "19:30–21:30") */
export type HealthIssues = {
  /** คนละคนอยู่ slot ช่องเดียวกันเวลาทับกัน (ชั่วโมง / ค่าจ้างนับทั้งคู่) */
  overlap: { role: "mc" | "admin"; date: string; platform: string; time: string; names: string[] }[];
  /** slot ข้างหน้าที่มีแถวซ้ำ (แถวว่างปน หรือคนเดิมซ้ำ) */
  dupRows: { role: "mc" | "admin"; date: string; platform: string; time: string; rows: number; note: string }[];
  /** slot ข้างหน้าที่มีแถวฝั่งเดียว — missing = ฝั่งที่ไม่มีแถว */
  noPair: { missing: "mc" | "admin"; date: string; platform: string; time: string }[];
  /** ไลฟ์ไปแล้วเดือนนี้ สถานะยัง "ไม่เฟิร์ม" แต่มีคน (นับค่าจ้างแล้ว) */
  notFirm: { role: "mc" | "admin"; date: string; platform: string; time: string; name: string }[];
  /** มีคิวเดือนนี้แต่ไม่มีค่าจ้าง (ไม่ใช่พนักงานประจำ) */
  noRate: { role: "mc" | "admin"; name: string; slots: number }[];
  /** มีคิวข้างหน้าแต่ไม่มีเบอร์โทร */
  noPhone: { role: "mc" | "admin"; name: string; upcoming: number }[];
  /** คิวข้างหน้าที่ยังไม่ขึ้นปฏิทิน */
  calendar: { role: "mc" | "admin"; name: string; count: number }[];
};

/** slot ที่ยังว่าง (หน้าแรกของ Mc / Admin) */
export type OpenSlot = {
  id: number;
  platform: string;
  date: string; // YYYY-MM-DD
  start: string; // HH:mm
  end: string;
  startMs: number;
  endMs: number;
  pairName?: string; // Admin เห็นว่า slot นี้ Mc คนไหนไลฟ์
};

/** โควต้าการจองต่อวัน (blocksPerDay = จำนวนช่วงต่อเนื่อง ใช้กับ Admin เสริม) */
export type BookingLimits = { slotsPerDay: number; hoursPerDay: number; blocksPerDay: number | null; perRequest: number };

export type SlotsResponse = {
  ok: true;
  siteNotice: string;
  scheduleNotice: string;
  slots: OpenSlot[];
  /** คิวที่จองไว้แล้วตั้งแต่วันนี้ (เซิร์ฟเวอร์เก่าไม่ส่ง = ไม่รู้) ใช้เช็กโควต้าก่อนกดจอง */
  mine?: { date: string; startMs: number; endMs: number }[];
  limits?: BookingLimits;
  /** คิวข้างหน้าที่ยังไม่ขึ้นปฏิทินของคนนี้ (> 0 = แสดงแถบเตือนให้แชร์ปฏิทิน) */
  calendarMissing?: number;
};

export type ActionResult = { id: number; success: boolean; message: string };

export type MyItem = {
  id: number;
  platform: string;
  date: string;
  start: string;
  end: string;
  hours: number;
  startMs: number;
  endMs: number;
  status: string;
  cancelled: boolean;
  lateMinutes: number | null; // นาทีที่มาสาย (จากชีต) ใช้หักเงิน
  bonusMinutes: number | null; // นาทีที่ไลฟ์ชดเชย ("+10" ในชีต) ได้เงินเพิ่ม
  lateFromProof: boolean; // ช่องในชีตว่าง ค่าสาย / ชดเชยคิดจากหลักฐานไลฟ์ (เฉพาะ Mc)
  bonusFromProof: boolean;
  pairName: string;
  pairPhone: string;
};

/** เอกสารทำเบิกที่ส่งแล้ว (ข้อมูลกรอก + มีไฟล์หรือยัง) — เห็นเฉพาะเจ้าตัว และ Owner ที่ดูเอกสารทำเบิกได้ */
export type PayDocsView = {
  fullName: string;
  idCardNo: string;
  address: string;
  bank: string;
  accountNo: string;
  accountName: string;
  /** ไฟล์บัตร / สมุดบัญชีเป็น PDF หรือรูป */
  idCardPdf: boolean;
  bankBookPdf: boolean;
  updatedAt: string;
};
/**
 * GET /api/my/pay-docs — required = ต้องส่ง (เพิ่มเข้าระบบหลังเปิดฟีเจอร์นี้ ไม่ใช่ Mc / Admin ประจำ และยังไม่มีใน Drive)
 *   onFile = ทีมงานมีเอกสารเดิมใน Google Drive แล้ว (ส่งทาง LINE)
 */
export type MyPayDocs = { required: boolean; onFile: boolean; docs: PayDocsView | null };
/** โฟลเดอร์รายคนในโฟลเดอร์เอกสารทำเบิก (Drive) — usedBy = รายชื่อที่ผูกอยู่แล้ว */
export type DocsFolder = { id: string; name: string; url: string; usedBy: string | null };
/**
 * GET /api/owner/pay-docs — ของคนที่เลือก + สถานะสำเนาใน Google Drive
 *   linked = โฟลเดอร์เอกสารเดิมที่ผูกไว้ (จับคู่ชื่ออัตโนมัติ / Owner ผูกเอง) · folders = ตัวเลือกให้ผูก (?folders=1)
 */
export type OwnerPayDocs = {
  docs: PayDocsView | null;
  drive: { folders: { role: "mc" | "admin"; url: string }[]; error: string | null; syncedAt: string | null; pending: boolean };
  linked: { id: string; name: string; url: string } | null;
  folders?: DocsFolder[];
};

export type MyResponse = {
  ok: true;
  month: string;
  cancelMinHours: number;
  adminChatUrl: string;
  canCancel: boolean;
  items: MyItem[];
  /**
   * โปรไฟล์ของตัวเอง rate = ค่าจ้างต่อชั่วโมงปกติ (0 = ยังไม่ได้ตั้ง)
   * commitTiers = เทียร์ Commit (ว่าง = ไม่มี) จองถึงเทียร์ไหน ทุกชั่วโมงของเดือนคิดราคาเทียร์นั้น
   */
  profile: { name: string; email: string; phone: string; rate: number; commitTiers: CommitTier[] };
};

export type OwnerDetail = {
  type: "Mc" | "Admin";
  name: string;
  date: string;
  start: string;
  end: string;
  platform: string;
  hours: number;
  startMs: number;
  status: string;
  cancelled: boolean;
  /** ยกเลิกผ่านเว็บ (Mc / Admin เสริมกดเอง) เมื่อไร (ISO) · null = ไม่ได้ยกเลิกผ่านเว็บ (เช่น "แคน" ในชีต) */
  cancelledAt?: string | null;
  pair: string;
  lateMinutes: number | null;
  bonusMinutes: number | null;
  lateFromProof: boolean; // ช่องสายในชีตว่าง ค่านี้คิดจากหลักฐานไลฟ์
  bonusFromProof: boolean;
  proof: ProofInfo | null; // หลักฐานไลฟ์ (รูปแดชบอร์ด + เวลาจริง) ของ slot นี้
  noProof: boolean; // Mc ของ slot นี้เป็น Mc ประจำ (เงินเดือน) ไม่ต้องแนบหลักฐาน
  gmv: number | null; // ยอด GMV ของ slot นี้ (ฝั่ง Admin ใช้ยอดเดียวกับ slot ของ Mc) ว่าง = ยังไม่ได้กรอก
  gmvCoveredBy: string | null; // ยังไม่มี GMV แต่ยอดรวมอยู่ใน slot ถัดไปของ Mc คนเดียวกัน เช่น "21:30–23:30"
  campaign: string; // Campaign ของ slot ตามที่พิมพ์ในชีต (ตั้งในหน้า Plan Slot Live) ว่าง = วันปกติ
  remark?: string; // หมายเหตุของ slot ในชีต (ใช้ในไฟล์เบิก)
};

/** หลักฐานไลฟ์: เวลาเริ่ม/จบจริงเป็น ISO (ดูรูปที่ /api/proofs/image?id=) */
export type ProofInfo = {
  id: number; startedAt: string; endedAt: string; by: string;
  driveUrl: string | null; // สำเนาใน Google Drive (โฟลเดอร์ปี > เดือน > Mc) ว่าง = ยังไม่ได้อัป
  driveFolderUrl: string | null; // โฟลเดอร์ของ Mc เดือนนั้นใน Drive (รวมหลักฐานทั้งเดือนของคนนั้น)
};

/** ยอด GMV ของ slot (เก็บที่ mc_slots กรอกได้ทุก slot ไม่ต้องมีหลักฐาน) */
export type SlotGmv = {
  value: number; // ยอดของ slot นี้ (หักยอดของ slot ก่อนหน้าแล้ว)
  input: string | null; // ที่พิมพ์ไว้ (บวก/ลบกันได้)
  minus: number | null; // ยอดสะสมของ slot ก่อนหน้าที่ระบบหักให้อัตโนมัติ
};

/** slot ในหน้าหลักฐานไลฟ์ (slot ของ Mc ที่มีคนไลฟ์และไม่ถูกยกเลิก) */
export type ProofSlot = {
  mcSlotId: number;
  platform: string;
  date: string;
  start: string;
  end: string;
  startMs: number;
  endMs: number;
  mcName: string;
  adminName: string;
  proof: (ProofInfo & { canDelete: boolean }) | null;
  /** Mc ประจำ (เงินเดือน) ไม่ต้องแนบหลักฐาน แต่กรอก GMV ได้ */
  salaried: boolean;
  gmv: SlotGmv | null;
  /** ยอด GMV สะสมของ slot ก่อนหน้าที่ไลฟ์ต่อกันมา (แพลตฟอร์มเดียวกัน เวลาต่อกัน) ใช้หักให้อัตโนมัติ */
  gmvBefore: GmvBefore | null;
  /** ยังไม่มี GMV แต่ยอดรวมอยู่ใน slot ถัดไปของ Mc คนเดียวกัน (ไลฟ์ต่อกันไม่สลับคน) เช่น "21:30–23:30" */
  gmvCoveredBy: string | null;
};

/**
 * paidHours = ชั่วโมงที่ได้เงิน (หักมาสาย + ไลฟ์ชดเชย) ยอดเงิน = paidHours x ค่าจ้าง/ชม.
 * lateSlots = จำนวนคิวที่โดนหัก / bonusMinutes = นาทีไลฟ์ชดเชยรวม (ปัดแล้ว)
 */
export type OwnerPerson = {
  name: string; slots: number; hours: number; paidHours: number; lateSlots: number; bonusMinutes: number; days: number; cancelled: number;
  /** Mc ประจำ / Admin ประจำ (ได้เงินเดือน) = ไม่คิดค่าจ้างรายชั่วโมง และไม่อยู่ในไฟล์เบิก */
  salaried?: boolean;
  /** Commit แบบเทียร์ (null = ไม่มี) tier = เทียร์ที่เดือนนี้จองถึง (null = ยังไม่ถึงเทียร์แรก ใช้ baseRate) */
  commit: { tiers: CommitTier[]; baseRate: number; tier: CommitTier | null; next: CommitTier | null } | null;
};

export type CommitTier = { hours: number; rate: number };

export type OwnerSummary = {
  ok: true;
  month: string;
  scope: OwnerScope; // ฝั่งที่ Owner คนนี้เห็นได้ (ฝั่งที่ไม่มีสิทธิ์ส่งมาเป็นรายการว่าง)
  /** ฝั่งที่ดูได้อย่างเดียว = ไม่ส่งค่าจ้างมา (ซ่อนคอลัมน์ยอดเงิน) */
  payHidden?: { mc: boolean; admin: boolean };
  rates: { mc: Record<string, number>; admin: Record<string, number>; defaultMc: number; defaultAdmin: number };
  mc: OwnerPerson[];
  admin: OwnerPerson[];
  details: OwnerDetail[];
  /** ฝั่งที่ปิดงวดแล้ว: ตัวเลขของฝั่งนั้นมาจากตอนปิด (src/lib/periods.ts) */
  periods?: Partial<Record<"mc" | "admin", { at: string; by: string }>>;
  /** ข้อมูลจริงเปลี่ยนหลังปิดงวด (รายคน) — ไว้ปรับในงวดถัดไป */
  changes?: Partial<Record<"mc" | "admin", PeriodChange[]>>;
  /** ประวัติปิด / เปิดงวดของเดือนนี้ (ใหม่ก่อน) */
  periodLog?: { side: "mc" | "admin"; closedAt: string; closedBy: string; reopenedAt: string | null; reopenedBy: string | null }[];
  /** คนที่ดูอยู่ปิด / เปิดงวดได้ (Owner ที่ตั้ง can_close_periods) */
  canClose?: boolean;
};

/** ส่วนต่างของคนหนึ่ง: before = ตอนปิดงวด / after = ข้อมูลตอนนี้ */
export type PeriodChange = { name: string; items: { label: string; before: string; after: string }[] };

export type ApiError = { ok: false; message: string; authError?: boolean };
