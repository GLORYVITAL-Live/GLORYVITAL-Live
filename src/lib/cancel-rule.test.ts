// เทสกฎยกเลิกคิวช่วงกลางคืน (bun test)
import { describe, expect, test } from "bun:test";
import { NIGHT_CANCEL_TEXT, cancelContact, cancelLinesOf, isNightCancel } from "@/lib/cancel-rule";

const bkk = (hm: string) => Date.parse(`2026-11-03T${hm}:00+07:00`);

describe("ยกเลิกช่วงกลางคืน", () => {
  test("22:00–08:00 เวลาไทย = กลางคืน", () => {
    expect(NIGHT_CANCEL_TEXT).toBe("22:00–08:00");
    expect(isNightCancel(bkk("21:59"))).toBe(false);
    expect(isNightCancel(bkk("22:00"))).toBe(true);
    expect(isNightCancel(bkk("23:30"))).toBe(true);
    expect(isNightCancel(bkk("00:15"))).toBe(true);
    expect(isNightCancel(bkk("07:59"))).toBe(true);
    expect(isNightCancel(bkk("08:00"))).toBe(false);
    expect(isNightCancel(bkk("13:00"))).toBe(false);
  });
  test("ทักใคร: Mc TikTok / Mc Shopee / Admin เสริม → Owner · ไม่ได้ตั้ง = ลิงก์แชทแอดมินเดิม", () => {
    const lines = cancelLinesOf({ cancel_line_mc_tiktok: "https://line.me/t", cancel_line_mc_shopee: " https://line.me/s ", cancel_line_admin: null });
    expect(cancelContact("mc", false, lines, "https://chat")).toEqual({ url: "https://line.me/t", who: "แอดมินดูแล Mc TikTok" });
    expect(cancelContact("mc", true, lines, "https://chat")).toEqual({ url: "https://line.me/s", who: "แอดมินดูแล Mc Shopee" });
    expect(cancelContact("admin", false, lines, "https://chat")).toEqual({ url: "https://chat", who: "Owner" });
    expect(cancelContact("mc", false, null, "")).toEqual({ url: "", who: "แอดมินดูแล Mc TikTok" });
  });
});
