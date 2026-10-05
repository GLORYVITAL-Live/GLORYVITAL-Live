export type Role = "mc" | "admin" | "owner";

export type Me = {
  email: string;
  mc: { id: number; name: string } | null;
  admin: { id: number; name: string; isExtra: boolean } | null;
  /** mc / admin = สิทธิ์จัดการฝั่งนั้น (ติ๊กทั้งคู่ = จัดการได้ทั้งหมด รวมถึงรายชื่อ Owner) */
  owner: { id: number; name: string; mc: boolean; admin: boolean } | null;
};

export type OwnerScope = { mc: boolean; admin: boolean };

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
  pair: string;
  lateMinutes: number | null;
  bonusMinutes: number | null;
  lateFromProof: boolean; // ช่องสายในชีตว่าง ค่านี้คิดจากหลักฐานไลฟ์
  bonusFromProof: boolean;
  proof: ProofInfo | null; // หลักฐานไลฟ์ (รูปแดชบอร์ด + เวลาจริง) ของ slot นี้
  noProof: boolean; // Mc ของ slot นี้เป็น Mc ประจำ (เงินเดือน) ไม่ต้องแนบหลักฐาน
};

/** หลักฐานไลฟ์: เวลาเริ่ม/จบจริงเป็น ISO (ดูรูปที่ /api/proofs/image?id=) */
export type ProofInfo = {
  id: number; startedAt: string; endedAt: string; by: string;
  driveUrl: string | null; // สำเนาใน Google Drive (โฟลเดอร์ปี > เดือน > Mc) ว่าง = ยังไม่ได้อัป
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
  rates: { mc: Record<string, number>; admin: Record<string, number>; defaultMc: number; defaultAdmin: number };
  mc: OwnerPerson[];
  admin: OwnerPerson[];
  details: OwnerDetail[];
};

export type ApiError = { ok: false; message: string; authError?: boolean };
