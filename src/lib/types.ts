import type { GmvBefore } from "@/lib/gmv";

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
  };
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

export type SlotsResponse = {
  ok: true;
  siteNotice: string;
  scheduleNotice: string;
  slots: OpenSlot[];
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
};

export type ApiError = { ok: false; message: string; authError?: boolean };
