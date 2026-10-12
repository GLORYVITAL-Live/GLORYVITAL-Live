// วิธีแชร์ปฏิทินให้บัญชีระบบ (ใช้ทั้งหน้าเว็บ / คู่มือ /guide / ข้อความส่ง LINE) — ไม่มีข้อมูลลับ ใช้ฝั่ง browser ได้

/** บัญชีที่พนักงานต้องแชร์ปฏิทินให้ (บัญชีระบบที่ลงนัดให้ทุกคน) */
export const CALENDAR_SHARE_TO = "kunraroj.d@glorythailand.com";

/** สิทธิ์ที่ต้องเลือก (ชื่อในแอป Google Calendar บนมือถือ / บนเว็บคอม) */
export const SHARE_PERMISSION_APP = "แก้ไขและดูรายละเอียดทั้งหมดของกิจกรรม";
export const SHARE_PERMISSION_WEB = "ทำการเปลี่ยนแปลงกิจกรรม";

/** ขั้นตอนในแอป Google Calendar (รูปอยู่ใน public/guide) copy = แสดงปุ่มคัดลอกอีเมล */
export const CALENDAR_STEPS: { text: string; image?: { src: string; h: number }; copy?: boolean }[] = [
  { text: "เปิดแอป Google Calendar แล้วกด ≡ มุมซ้ายบน", image: { src: "/guide/calendar-share-1.jpg", h: 1298 } },
  { text: "เลื่อนลงล่างสุด กด \"การตั้งค่า\"", image: { src: "/guide/calendar-share-2.jpg", h: 1298 } },
  { text: "ใต้อีเมลของคุณ กด \"ปฏิทินของฉัน\"", image: { src: "/guide/calendar-share-3.jpg", h: 807 } },
  { text: "กด \"แชร์กับ\"", image: { src: "/guide/calendar-share-4.jpg", h: 1298 } },
  {
    text: `ช่อง "เพิ่มคนหรือกลุ่ม" วางอีเมลด้านล่าง แล้วกดที่อีเมลนั้น เลือกสิทธิ์ "${SHARE_PERMISSION_APP}" แล้วกด "บันทึก" มุมขวาบน`,
    image: { src: "/guide/calendar-share-5.jpg", h: 1298 },
    copy: true,
  },
  { text: "กลับมาที่เว็บ GLORY VITAL Live กดปุ่ม \"แชร์แล้ว เช็กเลย\" ระบบจะลงคิวที่ค้างให้ทันที" },
];

/** ข้อความส่ง LINE ให้พนักงาน (origin = ที่อยู่เว็บ เช่น https://glory-vital-live.vercel.app) */
export const calendarShareMessage = (origin: string) => [
  "📅 ให้คิวไลฟ์ขึ้นใน Google Calendar ของคุณอัตโนมัติ",
  `แชร์ปฏิทินให้ ${CALENDAR_SHARE_TO}`,
  `สิทธิ์ "${SHARE_PERMISSION_APP}"`,
  `ดูวิธีทีละขั้น (มีรูป): ${origin}/guide`,
  "แชร์แล้วเข้าเว็บ กด \"แชร์แล้ว เช็กเลย\" ระบบจะลงคิวที่ค้างให้ทันที",
].join("\n");
