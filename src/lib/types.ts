import type { GmvBefore } from "@/lib/gmv";
import type { LiveSession } from "@/lib/live-stats";
import type { LiveTeam } from "@/lib/live-team";
import type { MyQuota } from "@/lib/mc-quota";

export type Role = "mc" | "admin" | "owner";

export type Me = {
  email: string;
  /** platform = ทีมไลฟ์ (shopee = ไม่เห็น / จองคิวไลฟ์ TikTok ไม่ได้ ใช้ได้แค่ "ตารางของฉัน") — src/lib/live-team.ts */
  mc: { id: number; name: string; platform: LiveTeam } | null;
  admin: { id: number; name: string; isExtra: boolean; platform: LiveTeam } | null;
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
  /** ทีมอื่นในบริษัท = เห็นแค่หน้า "ขอยืมอุปกรณ์" (SQL 20261110000000_equipment_loans) ไม่มี = ไม่ได้ส่งมา */
  borrower?: { id: number; name: string; team: string } | null;
  /** หน้าอุปกรณ์โปรดักชั่น (ดู / เพิ่ม / แก้ได้): Owner ที่จัดการ Mc หรือ Admin ได้ + Admin ที่ติ๊ก can_manage_equipment */
  equipment: boolean;
  /** จัดการบรีฟการแต่งตัว (เทรนนิ่ง > เฟรมไลฟ์): Owner ที่จัดการ Mc ได้ + Admin ที่ติ๊ก can_manage_briefs */
  briefs?: boolean;
};

/** ไฟล์ในไดรฟ์ที่แสดงในเว็บ (เปิดผ่าน /api/frames/media?id=) */
export type FrameFile = { id: string; kind: "video" | "image" | "file"; name: string };
/** บรีฟการแต่งตัวของช่วงวัน (ใช้กับทุกช่อง) · images = ลิงก์ชั่วคราว 1 ชม. */
export type BriefView = { note: string; images: { path: string; url: string }[]; updatedBy: string; updatedAt: string };
/** เฟรมไลฟ์ของช่อง + ช่วงวัน (จากแท็บ "Frame live" ในชีตวางแผน) + บรีฟการแต่งตัว */
export type FrameView = { key: string; platform: string; from: string; to: string; frame: FrameFile | null; product: FrameFile | null; brief: BriefView | null };
/** เทรนนิ่ง > เฟรมไลฟ์ · ready = ตั้งชีตแล้ว · message = อ่านชีตไม่สำเร็จ / ยังไม่ได้รัน SQL */
export type FramesResponse = {
  ready: boolean; message: string | null; canEdit: boolean; frames: FrameView[];
  /** บรีฟรวมของแต่ละช่วงวัน key = "วันเริ่ม|วันจบ" (ยังไม่เขียน = null) */
  briefs: Record<string, BriefView | null>;
};

export const EQUIPMENT_STATUSES = ["ใช้งานได้", "ชำรุด", "ส่งซ่อม", "หาย", "เลิกใช้"] as const;
export type EquipmentStatus = (typeof EQUIPMENT_STATUSES)[number];
/** อุปกรณ์ 1 รายการ (photoUrl = ลิงก์ชั่วคราวของรูป หมดอายุใน 1 ชม.) */
export type Equipment = {
  id: number; code: string; name: string; category: string; quantity: number; status: EquipmentStatus; location: string;
  brand: string; model: string; serial: string; purchaseDate: string | null; price: number | null; note: string;
  /** สเปค (หมวดคอมพิวเตอร์) key ตาม SPEC_FIELDS ใน src/lib/equipment.ts */
  specs: Record<string, string>;
  photoUrl: string | null; updatedAt: string; updatedBy: string;
  /** สำเนารูปใน Google Drive (ยังไม่ได้อัป = null) / อัปไม่สำเร็จเพราะอะไร */
  driveUrl: string | null; driveError: string | null;
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
  /** ช่วงเปิดจอง (ทั่วไป) ของฝั่งที่มีสิทธิ์ ที่หมดภายใน 2 วัน / หมดแล้ว — to = วันสุดท้าย, daysLeft 0 = วันนี้ */
  windows?: { role: "mc" | "admin"; ended: boolean; to: string; daysLeft: number }[];
  /** เอกสารรับเงินที่ยังส่งไม่ครบ (เฉพาะ Owner ที่ดูเอกสารทำเบิกได้ · ยังไม่บังคับ = ไม่มี) */
  receipts?: HomeReceipts | null;
  /** ใบ 50 ทวิที่ต้องจัดการ (เฉพาะ Owner ที่ดูเอกสารทำเบิกได้ · ยังไม่ได้ตั้งโฟลเดอร์ = ไม่มี) */
  tawi?: HomeTawi | null;
};

/** ใบ 50 ทวิบนหน้าแรก: months = "YYYY-MM" เรียงเก่าไปใหม่ · missingMonth = เดือนก่อนที่ยังไม่มีใบเลย (เลยวันที่ 10 แล้ว) */
export type HomeTawi = {
  unmatched: { name: string; months: string[] }[];
  noEmail: { label: string; months: string[] }[];
  missingMonth: string | null;
};

/**
 * วิดีโอเทรนนิ่ง 1 คลิป: ref = 'drive:<id>' / 'youtube:<id>' · title = ชื่อที่แสดง (Owner แก้ได้) · fileTitle = ชื่อไฟล์เดิม
 *   minutes = ความยาว (ไม่รู้ = null) · hidden = Owner ซ่อนไว้ · added = เพิ่มจากลิงก์ (ไม่อยู่ในโฟลเดอร์)
 */
/** required = ต้องดูก่อนจองคิว (ติ๊กที่คลิป หรือทั้งกลุ่ม) */
export type TrainingVideo = {
  ref: string; kind: "drive" | "youtube"; id: string; title: string; fileTitle: string; minutes: number | null; hidden: boolean; added: boolean;
  required: boolean;
};
/** กลุ่มวิดีโอ: ref = 'folder:<id>' (โฟลเดอร์ในไดรฟ์ — ซ่อน / แก้ชื่อได้) · null = กลุ่มของคลิปที่เพิ่มจากลิงก์ · required = บังคับทั้งกลุ่ม */
export type TrainingGroup = { ref: string | null; name: string; folderName: string | null; hidden: boolean; required: boolean; videos: TrainingVideo[] };
/**
 * หน้าเทรนนิ่ง: ready = รัน SQL แล้ว · slides = id Google Slides · message = อ่านไดรฟ์ไม่สำเร็จ
 *   manage = Owner ที่จัดการได้ (null = ดูอย่างเดียว ไม่เห็นที่ซ่อน) · manage.ready = รัน SQL training_items แล้ว
 *   gate = คลิปบังคับก่อนจองคิว: on = เปิดใช้ · applies = คนดูอยู่ต้องดู (Mc / Admin เสริม) · passed = Owner ให้ผ่านแล้ว
 *     · done = ref ที่คนดูอยู่ดูจบแล้ว
 */
export type Training = {
  ready: boolean; message: string | null; slides: string | null; groups: TrainingGroup[];
  manage: { ready: boolean; message: string | null } | null;
  gate?: { on: boolean; applies: boolean; passed: boolean; done: string[] } | null;
  /** เห็นแท็บเฟรมไลฟ์ + จัดการบรีฟการแต่งตัวได้ (me.briefs) */
  frames?: boolean;
};

/** คลิปบังคับที่ยังไม่ได้ดู (หน้าจองคิว) — ไม่ส่ง = ไม่บังคับ / ดูครบแล้ว */
export type TrainingBlock = { total: number; done: number; missing: string[] };

/** ความคืบหน้าคลิปบังคับรายคน (Owner) */
export type TrainingProgress = {
  on: boolean; total: number;
  people: { id: number; who: string; role: "mc" | "admin"; done: number; passed: boolean }[];
};

/**
 * ประวัติการเข้าชมหน้าเทรนนิ่ง (days = ช่วงวันล่าสุด 0 = ทั้งหมด) · ต่อคน: pages = เปิดหน้า · slides = เปิดสไลด์ · plays = คลิปที่กดเล่น
 *   never = Mc / Admin (มีอีเมล) ที่ยังไม่เคยเข้าในช่วงนั้น · ready false = ยังไม่ได้รัน SQL
 */
export type TrainingViews = {
  ready: boolean; message: string | null; days: number;
  people: {
    email: string; who: string; role: string; lastAt: string; firstAt: string; pages: number; slides: number;
    plays: { ref: string; title: string; count: number; lastAt: string }[];
  }[];
  never: string[];
};

/** คนที่ยังส่งเอกสารรับเงินไม่ครบ: months = เดือนที่ยังไม่มีเอกสารที่ผ่าน ("YYYY-MM") · rejected = เดือนที่ส่งแล้วแต่ไม่ผ่าน */
export type HomeReceipts = {
  requiredFrom: string;
  people: { label: string; hasEmail: boolean; shopee: boolean; months: string[]; rejected: string[] }[];
};

/** ตรวจสุขภาพข้อมูล: ต้นเดือนนี้ถึง 60 วันข้างหน้า เฉพาะฝั่งที่มีสิทธิ์ (time = "19:30–21:30") */
export type HealthIssues = {
  /** คนละคนอยู่ slot ช่องเดียวกันเวลาทับกัน (ชั่วโมง / ค่าจ้างนับทั้งคู่) */
  overlap: { role: "mc" | "admin"; date: string; platform: string; time: string; names: string[] }[];
  /** คนเดียวกันอยู่ 2 slot ขึ้นไปเวลาทับกัน (ไลฟ์พร้อมกันไม่ได้ แต่ชั่วโมง / ค่าจ้างนับทุก slot) — slots = "GLORY VITAL 19:30–21:30" */
  selfOverlap: { role: "mc" | "admin"; date: string; name: string; slots: string[] }[];
  /** หมายเหตุมี "เข้า ..." แต่ใช้ไม่ได้ (อ่านเวลาไม่ได้ / นอกช่วง slot) = ยังจ่ายเต็ม slot */
  badCheckIn?: { role: "mc" | "admin"; date: string; platform: string; time: string; name: string; text: string; reason: string }[];
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
  /** slot ที่เว็บเปลี่ยนแล้วแต่ยังเขียนลงชีตไม่ได้เกิน 15 นาที (filtered = แท็บเปิดตัวกรองอยู่ แทรกแถวไม่ได้) */
  sheetStuck?: { role: "mc" | "admin"; date: string; platform: string; time: string; filtered: boolean; error: string }[];
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
  /** ยกเลิกผ่านเว็บได้ก่อนไลฟ์อย่างน้อยกี่ชั่วโมง (ค่าเดียวกับที่ /api/cancel ใช้) */
  cancelMinHours?: number;
  /** คิวข้างหน้าที่ยังไม่ขึ้นปฏิทินของคนนี้ (> 0 = แสดงแถบเตือนให้แชร์ปฏิทิน) */
  calendarMissing?: number;
  /** สิทธิ์จองต่อเดือนตามแร็งค์ของ Mc คนนี้ (ไม่ส่ง = ไม่จำกัด) — src/lib/mc-quota.ts */
  quota?: MyQuota[];
  /** ยังดูคลิปเทรนนิ่งที่บังคับไม่ครบ = จองไม่ได้ (src/lib/training.ts trainingBlock) */
  training?: TrainingBlock;
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
  /** เข้างานกลาง slot ("เข้า 10:00" ในหมายเหตุ) hours = ชั่วโมงจากเวลาเข้าแล้ว */
  checkIn?: { time: string; slotHours: number } | null;
  /** แคมเปญของ slot (ว่าง = วันปกติ) */
  campaign?: string;
  /** ห้องไลฟ์ของช่องนี้ (ชื่อห้องจากหน้าอุปกรณ์ · ไม่เจอ = null) */
  room?: string | null;
  /** เฟรมไลฟ์ + บรีฟการแต่งตัวของช่อง + วันนี้ (ไม่มี = ไม่แสดง) */
  frame?: FrameFile | null;
  brief?: BriefView | null;
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

/** เอกสารยืนยันการรับเงินของเดือนหนึ่ง: none = ไม่ต้องส่ง / ok = ส่งแล้ว / missing = ยังไม่ส่ง / rejected = ไม่ผ่าน */
export type ReceiptState = "none" | "ok" | "missing" | "rejected";
/** เอกสารรับเงินที่ส่งแล้ว (ของตัวเอง) · source: web = ส่งผ่านเว็บ / drive = ไฟล์เดิมใน Drive ที่จับคู่ให้ */
export type ReceiptView = {
  id: number; month: string; status: "ok" | "rejected"; reason: string | null; uploadedAt: string; pdf: boolean; source: "web" | "drive";
};
/**
 * ใบ 50 ทวิ 1 ไฟล์ (เดือน "YYYY-MM") · verified = เจ้าตัวยืนยันชื่อของใบนี้แล้ว
 *   receipt = เอกสารรับเงินของเดือนนี้ (ต้อง ok / none ถึงดาวน์โหลดได้)
 */
export type TawiDoc = { id: number; month: string; verified: boolean; receipt: ReceiptState };
/**
 * GET /api/my/tawi — ready = รัน SQL 20261029000000_tawi50 แล้ว (ไม่พร้อม = ซ่อนส่วนนี้)
 *   verifyReady = รัน SQL 20261030000000_tawi_verify แล้ว (ยัง = ดาวน์โหลดไม่ได้ชั่วคราว)
 *   locked = กรอกชื่อไม่ตรงครบจำนวนของวันนี้แล้ว
 *   receiptFrom = ต้องส่งเอกสารรับเงินตั้งแต่เดือนนี้ (null = ไม่บังคับ) · receipts = เอกสารรับเงินที่ส่งแล้ว
 */
export type MyTawi = {
  ready: boolean; verifyReady: boolean; locked: boolean; docs: TawiDoc[];
  receiptFrom: string | null; receipts: ReceiptView[];
};
/** คน 1 คนในหน้าเอกสารรับเงินของ Owner (key = อีเมล / รายชื่อที่ไม่มีอีเมล) */
export type OwnerReceiptPerson = {
  key: string; label: string; hasEmail: boolean;
  /** มีใบ 50 ทวิเดือนนี้ = ต้องส่ง */
  required: boolean;
  receipt: (ReceiptView & { reviewedAt: string | null }) | null;
  /** ไฟล์เดิมใน Drive ที่จับคู่กับคนนี้เดือนนี้ (รายชื่อที่ไม่มีอีเมล = มีแค่ตรงนี้ ไม่มี receipt) */
  driveFiles: { id: number; fileName: string; matchedBy: "auto" | "owner" | null }[];
};
/** ไฟล์เดิมใน Drive ที่ยังไม่จับคู่ (ignored = Owner ตั้งว่าไม่ใช่คนในระบบ) */
export type ReceiptDriveFile = {
  id: number; month: string; role: "mc" | "admin"; fileName: string; path: string; nick: string; realName: string | null;
  ignored: boolean; suggest: { id: number; score: number }[];
};
/**
 * GET /api/owner/receipts — ready = รัน SQL 20261101000000_pay_receipts แล้ว · folderSet = ตั้งโฟลเดอร์ Drive แล้ว
 *   requiredFrom = เดือนเริ่มบังคับที่ใช้จริง (null = ไม่บังคับ) · months = เดือนที่ต้องส่ง / มีคนส่ง / มีไฟล์ใน Drive (ใหม่ก่อน)
 *   months[].received = คนที่มีเอกสารผ่านแล้ว (รวมเดือนที่ไม่บังคับ) · unmatched = ไฟล์ใน Drive ที่ยังไม่จับคู่
 *   drive.ready = รัน SQL 20261102000000_receipt_files แล้ว · drive.files = ไฟล์ที่ยังไม่จับคู่ของเดือนที่เลือก
 */
export type OwnerReceipts = {
  ready: boolean; folderSet: boolean; requiredFrom: string | null; month: string | null;
  months: { month: string; required: number; sent: number; rejected: number; received: number; unmatched: number }[];
  people: OwnerReceiptPerson[];
  drive: { ready: boolean; files: ReceiptDriveFile[]; people: TawiPerson[] };
};
/** สถานะยืนยันตัวตนของเจ้าของไฟล์: ok = ยืนยันแล้ว / wait = รอเจ้าตัวยืนยัน / fail = กรอกไม่ตรง */
export type TawiVerifyState = { status: "ok" | "wait" | "fail"; fails: number; failedAt: string | null };
/**
 * ไฟล์ในหน้าจับคู่ของ Owner — matchedBy: auto = ระบบ / owner = Owner จับคู่ / self = เจ้าตัวกรอกชื่อ (แบบเดิม เลิกใช้แล้ว)
 *   verify = สถานะยืนยันตัวตน (ยังไม่จับคู่ / ยังไม่ได้รัน SQL ยืนยันตัวตน = null)
 */
export type TawiOwnerDoc = {
  id: number; month: string; realName: string; fileName: string;
  staffId: number | null; matchedBy: "auto" | "owner" | "self" | null;
  suggest: { id: number; score: number }[];
  verify: TawiVerifyState | null;
};
export type TawiPerson = { id: number; role: "mc" | "admin"; label: string; legalName: string | null; hasEmail: boolean };
/**
 * GET /api/owner/tawi — ready = รัน SQL แล้ว · folderSet = ตั้งโฟลเดอร์ Drive แล้ว
 *   verifyReady = รัน SQL ยืนยันตัวตน (20261030000000_tawi_verify) แล้ว
 *   months = ทุกเดือนที่มีไฟล์ (ใหม่ก่อน) · docs = ไฟล์ของเดือนที่เลือก
 */
export type OwnerTawi = {
  ready: boolean; folderSet: boolean; verifyReady: boolean; month: string | null;
  months: { month: string; total: number; matched: number }[];
  docs: TawiOwnerDoc[]; people: TawiPerson[];
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
  /** การโอนค่าจ้างของเดือนนี้ (ยังไม่มี / ยังไม่ได้รัน SQL = ว่าง) */
  payments?: { amount: number; paidOn: string }[];
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
  /**
   * เวลาเข้างานจริงจากหมายเหตุ ("เข้า 10:00") — มีค่า = hours เป็นชั่วโมงจากเวลาเข้าถึงจบ slot แล้ว (slotHours = ชั่วโมงเต็มของ slot)
   *   checkInBad = พิมพ์ "เข้า" แต่ใช้ไม่ได้ (อ่านไม่ได้ / นอกช่วง slot) จ่ายเต็ม slot · ไม่มีทั้งคู่ = ไม่ได้ใส่ (งวดที่ปิดก่อนมีฟีเจอร์นี้ก็ไม่มี)
   */
  checkIn?: { time: string; slotHours: number } | null;
  checkInBad?: string | null;
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
  /** id ในตาราง staff (ใช้บันทึกการโอน) */
  staffId?: number;
};

export type CommitTier = { hours: number; rate: number };

/** การโอนค่าจ้าง 1 ครั้ง (src/lib/pay-months.ts) */
export type PaymentView = { id: number; amount: number; paidOn: string; note: string; by: string; at: string };

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
  /** ฝั่งที่ดูใบ 50 ทวิ / เอกสารรับเงินได้ (แผงท้ายหน้าสรุปรายเดือน) */
  docs?: { mc: boolean; admin: boolean };
  /**
   * การโอนค่าจ้างของเดือนนี้ รายคน (key = staffId) — เฉพาะฝั่งที่จัดการได้ (เห็นค่าจ้าง)
   *   paySides = ฝั่งที่บันทึกโอนได้ · paySql = ยังไม่ได้รัน SQL pay_sync (ข้อความ)
   */
  payments?: Record<string, PaymentView[]>;
  paySides?: { mc: boolean; admin: boolean };
  paySql?: string;
};

/** ส่วนต่างของคนหนึ่ง: before = ตอนปิดงวด / after = ข้อมูลตอนนี้ */
export type PeriodChange = { name: string; items: { label: string; before: string; after: string }[] };

export type ApiError = { ok: false; message: string; authError?: boolean };
