import { after, NextResponse } from "next/server";
import { TABS, type TabKey } from "@/lib/sheet";
import { applySheetEdits } from "@/lib/sheet-sync";
import { processSyncJobs } from "@/lib/sync";

export const maxDuration = 60;

// Apps Script ในชีตเรียกที่นี่ทุกครั้งที่มีการแก้แถวในแท็บ Deal Mc / Admin เสริม
// body: { tab: ชื่อแท็บ, rows: [เลขแถว], firstCol, lastCol }   header: Authorization: Bearer <SHEET_SYNC_SECRET>
export async function POST(request: Request) {
  const secret = process.env.SHEET_SYNC_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, message: "unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const tab = (Object.keys(TABS) as TabKey[]).find((k) => TABS[k] === body?.tab || k === body?.tab);
  const rows: number[] = Array.isArray(body?.rows)
    ? [...new Set<number>(body.rows.map(Number).filter((n: number) => Number.isInteger(n) && n > 0))].slice(0, 1000)
    : [];
  if (!tab || !rows.length) return NextResponse.json({ ok: false, message: "ข้อมูลไม่ครบ" }, { status: 400 });
  const first = Number(body?.firstCol), last = Number(body?.lastCol);
  const cols: [number, number] | undefined = Number.isInteger(first) && Number.isInteger(last) ? [first, last] : undefined;

  try {
    const res = await applySheetEdits(tab, rows, cols);
    after(() => processSyncJobs().then(() => undefined));
    return NextResponse.json({ ok: true, ...res });
  } catch (err) {
    return NextResponse.json({ ok: false, message: String((err as Error)?.message ?? err) }, { status: 500 });
  }
}
