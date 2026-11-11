// รอบงานทุก 15 นาที (เตือนก่อนไลฟ์ / งานค้าง / ตรวจสลิป ...) ที่เว็บเรียกเอง — เริ่มจาก src/instrumentation.ts เฉพาะเว็บจริงบน Render
//   เดิมพึ่ง GitHub Actions อย่างเดียว ซึ่งถูกหน่วงจนเหลือวันละ 3–4 รอบ (1–10 พ.ย. 2026 คิว Mc ได้เตือนก่อนไลฟ์แค่ 16 จาก 101 คิว)
//   GitHub ยังเรียกได้เป็นรอบสำรอง: หน้า /api/cron/notify มีล็อกกันรันซ้อน และแจ้งเตือนทุกชนิดมี dedupe ไม่ส่งซ้ำ

export const CRON_EVERY_MS = 15 * 60_000;
/** เลยต้นรอบ (:00 :15 :30 :45) ไปกี่วินาที — ให้เซิร์ฟเวอร์ที่เพิ่งเริ่มพร้อมรับคำขอก่อน */
const OFFSET_MS = 20_000;

/** ถึงรอบถัดไปอีกกี่ ms (ตรงต้นรอบ 15 นาทีของนาฬิกา + OFFSET) — รอบที่ :00 = รอบต้นชั่วโมง (ตรวจสลิป / ใบ 50 ทวิ) */
export function nextCronDelay(now = Date.now()) {
  const into = (now - OFFSET_MS) % CRON_EVERY_MS;
  return CRON_EVERY_MS - (into < 0 ? into + CRON_EVERY_MS : into);
}

/** เริ่มนับรอบ (เรียกซ้ำได้ ทำงานครั้งเดียวต่อเซิร์ฟเวอร์) · ไม่มี CRON_SECRET = ไม่เริ่ม */
export function startCronTimer() {
  const g = globalThis as { __gloryCronTimer?: boolean };
  const secret = process.env.CRON_SECRET;
  if (g.__gloryCronTimer || !secret) return;
  g.__gloryCronTimer = true;
  const url = `http://127.0.0.1:${process.env.PORT || "3000"}/api/cron/notify`;
  const tick = async () => {
    try {
      const res = await fetch(url, { headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(5 * 60_000) });
      if (!res.ok) console.error(`[cron] /api/cron/notify ตอบ ${res.status}`);
    } catch (err) {
      console.error("[cron] เรียก /api/cron/notify ไม่สำเร็จ", err);
    }
  };
  const schedule = () => {
    // unref = ไม่รั้งเซิร์ฟเวอร์ไว้ตอนปิด (deploy ใหม่)
    setTimeout(() => { void tick().finally(schedule); }, nextCronDelay()).unref();
  };
  schedule();
}
