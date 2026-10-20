// เทสทีมไลฟ์ tiktok / shopee (bun test)
import { expect, test } from "bun:test";
import { isShopeeRole, liveTeamOf, tiktokOnly, withLiveTeam } from "@/lib/live-team";
import { staffChangeText } from "@/lib/staff-history";
import type { Me } from "@/lib/types";

const base: Me = { email: "a@x.com", mc: null, admin: null, owner: null, marketing: null, equipment: false };
const owner = { id: 9, name: "O", mc: true, admin: true, proofs: false, analytics: false, plan: false, see: { mc: true, admin: true, proofs: false, analytics: false, plan: false } };

test("ค่าว่าง / ค่าอื่น = tiktok", () => {
  expect(liveTeamOf(undefined)).toBe("tiktok");
  expect(liveTeamOf(null)).toBe("tiktok");
  expect(liveTeamOf("lazada")).toBe("tiktok");
  expect(liveTeamOf(" Shopee ")).toBe("shopee");
});

test("ตัดคน shopee ออก (ไม่มีคอลัมน์ = tiktok)", () => {
  expect(tiktokOnly([{ id: 1, live_platform: "shopee" }, { id: 2, live_platform: "tiktok" }, { id: 3 }]).map((p) => p.id)).toEqual([2, 3]);
});

test("บทบาท shopee", () => {
  const me: Me = { ...base, mc: { id: 1, name: "A", platform: "shopee" }, admin: { id: 2, name: "B", isExtra: true, platform: "tiktok" } };
  expect(isShopeeRole(me, "mc")).toBe(true);
  expect(isShopeeRole(me, "admin")).toBe(false);
  expect(isShopeeRole(me, "owner")).toBe(false);
  expect(isShopeeRole(null, "mc")).toBe(false);
});

test("Owner เปิดดูหน้าจองแบบ preview = ไม่ใช่ shopee", () => {
  expect(isShopeeRole({ ...base, owner }, "mc")).toBe(false);
});

test("ยังไม่ได้รัน SQL = select ใหม่แบบไม่มีคอลัมน์", async () => {
  const calls: string[] = [];
  const res = await withLiveTeam(async (extra) => {
    calls.push(extra);
    return extra ? { data: null, error: { message: "column staff.live_platform does not exist" } } : { data: [{ id: 1 }], error: null };
  });
  expect(calls).toEqual([", live_platform", ""]);
  expect(res.data).toEqual([{ id: 1 }]);
});

test("error อื่นไม่ลองใหม่", async () => {
  let n = 0;
  const res = await withLiveTeam(async () => { n++; return { data: null, error: { message: "timeout" } }; });
  expect(n).toBe(1);
  expect(res.error?.message).toBe("timeout");
});

test("ประวัติแก้พนักงาน: ทีมไลฟ์", () => {
  expect(staffChangeText({ live_platform: "tiktok" }, { live_platform: "shopee" })).toBe("ทีมไลฟ์ TikTok → Shopee");
  expect(staffChangeText({}, { live_platform: "shopee" })).toBe("ทีมไลฟ์ TikTok → Shopee");
  // ยังไม่ได้รัน SQL (ว่าง) = TikTok ไม่นับว่าเปลี่ยน
  expect(staffChangeText({ live_platform: undefined }, { live_platform: "tiktok" })).toBe("");
});
