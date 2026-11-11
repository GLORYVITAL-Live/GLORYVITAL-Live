// เทสเวลารอบงานทุก 15 นาที (bun test)
import { describe, expect, test } from "bun:test";
import { CRON_EVERY_MS, nextCronDelay } from "@/lib/cron-timer";

const at = (iso: string) => Date.parse(iso);

describe("รอบถัดไป", () => {
  test("ตรงต้นรอบ 15 นาทีของนาฬิกา + 20 วินาที", () => {
    expect(nextCronDelay(at("2026-11-11T10:07:00Z"))).toBe(at("2026-11-11T10:15:20Z") - at("2026-11-11T10:07:00Z"));
    expect(nextCronDelay(at("2026-11-11T10:59:30Z"))).toBe(at("2026-11-11T11:00:20Z") - at("2026-11-11T10:59:30Z"));
  });
  test("อยู่ในช่วง 20 วินาทีแรกของรอบ = รอบเดียวกันที่ยังไม่ถึง", () => {
    expect(nextCronDelay(at("2026-11-11T10:15:05Z"))).toBe(15_000);
  });
  test("พอดีเวลารอบ = รอบถัดไป (ไม่เรียกซ้ำทันที)", () => {
    expect(nextCronDelay(at("2026-11-11T10:15:20Z"))).toBe(CRON_EVERY_MS);
  });
  test("ไม่เกิน 15 นาทีเสมอ และมากกว่า 0", () => {
    for (let t = at("2026-11-11T00:00:00Z"); t < at("2026-11-11T01:00:00Z"); t += 7_919) {
      const d = nextCronDelay(t);
      expect(d).toBeGreaterThan(0);
      expect(d).toBeLessThanOrEqual(CRON_EVERY_MS);
      expect(new Date(t + d).getUTCMinutes() % 15).toBe(0);
      expect(new Date(t + d).getUTCSeconds()).toBe(20);
    }
  });
});
