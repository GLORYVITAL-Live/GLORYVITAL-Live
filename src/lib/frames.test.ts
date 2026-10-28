// เทสอ่านแท็บ "Frame live" (bun test)
import { describe, expect, test } from "bun:test";
import {
  briefKey, driveIdOf, frameFor, framePlatform, frameSheetError, parseFrameRange, parseFrameSheet, pickBrief, spreadsheetIdOf,
} from "@/lib/frames";

const TODAY = "2026-10-27";
const link = (id: string) => `https://drive.google.com/file/d/${id}/view?usp=sharing`;

describe("ช่วงวันในชีต", () => {
  test("รูปแบบที่ใช้ในชีต", () => {
    expect(parseFrameRange("25-31 Oct", TODAY)).toEqual({ from: "2026-10-25", to: "2026-10-31" });
    expect(parseFrameRange("1 Aug", TODAY)).toEqual({ from: "2026-08-01", to: "2026-08-01" });
    expect(parseFrameRange("1-3 Jul", TODAY)).toEqual({ from: "2026-07-01", to: "2026-07-03" });
    expect(parseFrameRange("28 Oct - 3 Nov", TODAY)).toEqual({ from: "2026-10-28", to: "2026-11-03" });
  });
  test("ข้ามปี / ปีที่ใกล้วันนี้ที่สุด", () => {
    expect(parseFrameRange("30 Dec - 2 Jan", TODAY)).toEqual({ from: "2026-12-30", to: "2027-01-02" });
    expect(parseFrameRange("5-7 Jan", "2026-12-20")).toEqual({ from: "2027-01-05", to: "2027-01-07" });
  });
  test("ไม่ใช่ช่วงวัน = null", () => {
    for (const x of ["sticker", "Frame Live", "GLORY MALL", "", "32 Oct", "3-1 Oct"]) expect(parseFrameRange(x, TODAY)).toBeNull();
  });
  test("ชื่อช่อง / ลิงก์ไดรฟ์", () => {
    expect(["GLORY MALL", "Cherry Glory", "GLORY Skin Expert", "GLORY Shopee"].map(framePlatform)).toEqual(["GLORY MALL", "Cherry Glory", "Skin Expert", "Shopee"]);
    expect(driveIdOf(link("1TestFrameFile_abc-123"))).toBe("1TestFrameFile_abc-123");
    expect(driveIdOf("https://drive.google.com/drive/folders/1TestFolder_xyz-789")).toBe("1TestFolder_xyz-789");
    expect(driveIdOf("ยังไม่มี")).toBeNull();
  });
});

describe("อ่านทั้งแท็บ", () => {
  // บล็อกละ 1 ช่อง: แถวหัวมีช่วงวัน (คอลัมน์ C, E, G) · ใต้ช่วงวันเขียนประเภท ลิงก์อยู่คอลัมน์ถัดไป · คอลัมน์ G ซ้ำกับ E (คัดลอกมา)
  const rows = [
    ["Oct", "GLORY MALL", "18-24 Oct", "", "25-31 Oct", "", "25-31 Oct"],
    [],
    ["", "", "sticker", "https://drive.google.com/drive/folders/folderAAAAAA", "sticker", "https://drive.google.com/drive/folders/folderBBBBBB"],
    ["", "", "Frame Live", link("frameAAAAAAAA"), "Frame Live", link("frameBBBBBBBB"), "Frame Live", link("frameBBBBBBBB")],
    ["", "", "Product", link("productAAAAAA"), "Product", ""],
    ["", "GLORY Skin Expert", "25-31 Oct"],
    ["", "", "Frame Live", link("frameSKINSKIN")],
  ];
  const w = parseFrameSheet(rows, TODAY);
  test("แยกช่อง + ช่วงวัน · คอลัมน์ซ้ำนับครั้งเดียว · ลิงก์ว่าง = null", () => {
    expect(w.map((x) => x.key)).toEqual(["GLORY MALL|2026-10-18|2026-10-24", "GLORY MALL|2026-10-25|2026-10-31", "Skin Expert|2026-10-25|2026-10-31"]);
    expect(w[0]).toMatchObject({ frameId: "frameAAAAAAAA", productId: "productAAAAAA", stickerId: "folderAAAAAA" });
    expect(w[1]).toMatchObject({ frameId: "frameBBBBBBBB", productId: null });
    // บล็อก Skin Expert ไม่เอาลิงก์ของบล็อกบน
    expect(w[2]).toMatchObject({ frameId: "frameSKINSKIN", productId: null, stickerId: null });
  });
  test("หาเฟรมของ slot: ช่องในระบบ (GLORY MALL) + วันไลฟ์ · ช่วงสั้นกว่าชนะ", () => {
    expect(frameFor(w, "GLORY MALL", "2026-10-27")?.frameId).toBe("frameBBBBBBBB");
    expect(frameFor(w, "Skin Expert", "2026-10-25")?.frameId).toBe("frameSKINSKIN");
    expect(frameFor(w, "Cherry Glory", "2026-10-27")).toBeNull();
    const special = [...w, { key: "x", platform: "GLORY MALL", from: "2026-10-27", to: "2026-10-27", frameId: "frameCEOLIVE1", productId: null, stickerId: null }];
    expect(frameFor(special, "GLORY MALL", "2026-10-27")?.frameId).toBe("frameCEOLIVE1");
  });
});

describe("ค่า settings.frame_sheet_id", () => {
  const ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd";
  test("id อย่างเดียว / ลิงก์เต็ม / มีเครื่องหมายคำพูด", () => {
    expect(spreadsheetIdOf(ID)).toBe(ID);
    expect(spreadsheetIdOf(`https://docs.google.com/spreadsheets/d/${ID}/edit?gid=123#gid=123`)).toBe(ID);
    expect(spreadsheetIdOf(`https://docs.google.com/spreadsheets/u/1/d/${ID}/edit`)).toBe(ID);
    expect(spreadsheetIdOf(` '${ID}' `)).toBe(ID);
  });
  test("วาง id ซ้ำ 2 รอบ = ชุดเดียว", () => {
    expect(spreadsheetIdOf(ID + ID)).toBe(ID);
  });
  test("ไม่ใช่ลิงก์ / id", () => {
    expect(spreadsheetIdOf("ใส่ id ชีตตรงนี้")).toBeNull();
    expect(spreadsheetIdOf("1AbCdEfGh...XyZ")).toBeNull();
    expect(spreadsheetIdOf("")).toBeNull();
  });
  test("error จาก Google เป็นข้อความที่บอกว่าต้องแก้อะไร", () => {
    expect(frameSheetError("Requested entity was not found.")).toContain("ไม่พบชีต");
    expect(frameSheetError("This operation is not supported for this document")).toContain("ไม่ใช่ Google Sheets");
    expect(frameSheetError("The caller does not have permission")).toContain("แชร์ชีต");
    expect(frameSheetError("socket hang up")).toBeNull();
  });
});

describe("บรีฟการแต่งตัว 1 ชุดต่อช่วงวัน ใช้กับทุกช่อง", () => {
  const w = { key: "Cherry Glory|2026-10-25|2026-10-31", from: "2026-10-25", to: "2026-10-31" };
  test("บรีฟรวมของช่วงวันใช้กับทุกช่อง", () => {
    const byKey = new Map([[briefKey("2026-10-25", "2026-10-31"), "รวม"]]);
    expect(pickBrief(byKey, w)).toBe("รวม");
    expect(pickBrief(byKey, { ...w, key: "Shopee|2026-10-25|2026-10-31" })).toBe("รวม");
  });
  test("บรีฟรวมก่อนบรีฟแยกช่องแบบเดิม · ไม่มีบรีฟรวม = ใช้แบบเดิม", () => {
    expect(pickBrief(new Map([[w.key, "เดิม"], [briefKey(w.from, w.to), "รวม"]]), w)).toBe("รวม");
    expect(pickBrief(new Map([[w.key, "เดิม"]]), w)).toBe("เดิม");
  });
  test("ช่วงวันอื่น = ไม่มีบรีฟ", () => {
    expect(pickBrief(new Map([[briefKey("2026-11-01", "2026-11-07"), "รวม"]]), w)).toBeNull();
  });
});
