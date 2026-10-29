// เทสทีมไลฟ์ tiktok / shopee / both (bun test)
import { expect, test } from "bun:test";
import { boardsOf, canShopee, canTiktok, liveTeamLabel, liveTeamOf, shopeeCrew, tiktokOnly, withLiveTeam } from "@/lib/live-team";
import { staffChangeText } from "@/lib/staff-history";
import type { Me } from "@/lib/types";

const base: Me = { email: "a@x.com", mc: null, admin: null, owner: null, marketing: null, equipment: false };
const owner = { id: 9, name: "O", mc: true, admin: true, proofs: false, analytics: false, plan: false, see: { mc: true, admin: true, proofs: false, analytics: false, plan: false } };

test("ค่าว่าง / ค่าอื่น = tiktok", () => {
  expect(liveTeamOf(undefined)).toBe("tiktok");
  expect(liveTeamOf(null)).toBe("tiktok");
  expect(liveTeamOf("lazada")).toBe("tiktok");
  expect(liveTeamOf(" Shopee ")).toBe("shopee");
  expect(liveTeamOf("BOTH")).toBe("both");
});

test("ทีม TikTok + Shopee จองได้ทั้งสองคิว", () => {
  expect([canTiktok("tiktok"), canShopee("tiktok")]).toEqual([true, false]);
  expect([canTiktok("shopee"), canShopee("shopee")]).toEqual([false, true]);
  expect([canTiktok("both"), canShopee("both")]).toEqual([true, true]);
  expect(liveTeamLabel("both")).toBe("TikTok + Shopee");
});

test("ตัดคนตามคิว (ไม่มีคอลัมน์ = tiktok)", () => {
  const rows = [{ id: 1, live_platform: "shopee" }, { id: 2, live_platform: "tiktok" }, { id: 3 }, { id: 4, live_platform: "both" }];
  expect(tiktokOnly(rows).map((p) => p.id)).toEqual([2, 3, 4]);
  expect(shopeeCrew(rows).map((p) => p.id)).toEqual([1, 4]);
});

test("หน้าจองของแต่ละทีม", () => {
  const me = (platform: "tiktok" | "shopee" | "both"): Me => ({ ...base, mc: { id: 1, name: "A", platform }, admin: { id: 2, name: "B", isExtra: true, platform } });
  expect(boardsOf(me("tiktok"), "mc")).toEqual(["tiktok"]);
  expect(boardsOf(me("shopee"), "mc")).toEqual(["shopee"]);
  expect(boardsOf(me("both"), "mc")).toEqual(["tiktok", "shopee"]);
  // Admin: Shopee ไม่มีแถว Admin
  expect(boardsOf(me("shopee"), "admin")).toEqual([]);
  expect(boardsOf(me("both"), "admin")).toEqual(["tiktok"]);
  expect(boardsOf(me("tiktok"), "owner")).toEqual([]);
});

test("Owner เปิดดูหน้าจองแบบ preview เห็นทั้งสองหน้า", () => {
  expect(boardsOf({ ...base, owner }, "mc")).toEqual(["tiktok", "shopee"]);
  expect(boardsOf({ ...base, owner }, "admin")).toEqual(["tiktok"]);
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
  expect(staffChangeText({ live_platform: "shopee" }, { live_platform: "both" })).toBe("ทีมไลฟ์ Shopee → TikTok + Shopee");
  // ยังไม่ได้รัน SQL (ว่าง) = TikTok ไม่นับว่าเปลี่ยน
  expect(staffChangeText({ live_platform: undefined }, { live_platform: "tiktok" })).toBe("");
});
