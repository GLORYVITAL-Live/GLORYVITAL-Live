export type Role = "mc" | "admin" | "owner";

export type Me = {
  email: string;
  mc: { id: number; name: string } | null;
  admin: { id: number; name: string; isExtra: boolean } | null;
  owner: { id: number; name: string } | null;
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
  /** โปรไฟล์ของตัวเอง rate = ค่าจ้างต่อชั่วโมง (0 = ยังไม่ได้ตั้ง) */
  profile: { name: string; email: string; phone: string; rate: number };
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
};

/** paidHours = ชั่วโมงที่ได้เงินหลังหักมาสาย (ยอดเงิน = paidHours x ค่าจ้าง/ชม.) lateSlots = จำนวนคิวที่โดนหัก */
export type OwnerPerson = {
  name: string; slots: number; hours: number; paidHours: number; lateSlots: number; days: number; cancelled: number;
};

export type OwnerSummary = {
  ok: true;
  month: string;
  rates: { mc: Record<string, number>; admin: Record<string, number>; defaultMc: number; defaultAdmin: number };
  mc: OwnerPerson[];
  admin: OwnerPerson[];
  details: OwnerDetail[];
};

export type ApiError = { ok: false; message: string; authError?: boolean };
