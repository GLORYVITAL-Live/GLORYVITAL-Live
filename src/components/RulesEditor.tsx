"use client";

import { useEffect, useState } from "react";
import { LoadingBlock, Notice, StateBox, api, useConfirm, useToast } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { BONUS_TIERS, LATE_TIERS } from "@/lib/pay";
import type { OwnerScope } from "@/lib/types";

type Rules = { items: string[]; custom: boolean; defaults: string[] };

/** หน้าเจ้าของ > กฎการทำงาน: แก้ข้อความส่วน "อื่นๆ" ของหน้ากฎ (เฉพาะฝั่งที่มีสิทธิ์) */
export function RulesEditor({ scope }: { scope: OwnerScope }) {
  const roles = (["mc", "admin"] as const).filter((r) => scope[r]);
  return (
    <div className="space-y-5 pb-10">
      <Notice>แก้ข้อความที่ Mc / Admin เห็นในหน้า &quot;กฎการทำงาน&quot; (เด้งวันละครั้งหลัง login) หนึ่งบรรทัด = หนึ่งข้อ</Notice>
      {roles.map((r) => <RoleRules key={r} role={r} />)}
      <Card size="sm">
        <CardHeader>
          <CardTitle className="font-bold">การมาสาย / ไลฟ์ชดเชย (แก้ที่นี่ไม่ได้)</CardTitle>
          <CardDescription className="text-xs">
            ดึงจากกฎคิดเงินจริง ตัวเลขที่พนักงานเห็นจึงตรงกับเงินเสมอ (พนักงานแต่ละคนเห็นเป็นบาทตามค่าจ้างของตัวเอง)
            ถ้าจะเปลี่ยนกฎต้องแก้ในโค้ด (src/lib/pay.ts)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
            {LATE_TIERS.map((t) => <li key={t.label}>{t.label}: {t.cut ? `หัก ${Math.round(t.cut * 100)}%` : "ไม่หัก"}</li>)}
            {BONUS_TIERS.map((t) => <li key={t.label}>{t.label}: ได้ {t.share}</li>)}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            บันทึกในชีต: Mc = แท็บ Deal Mc คอลัมน์ L / Admin = แท็บ Admin เสริม คอลัมน์ M — สาย ใส่ &quot;15&quot; หรือ &quot;สาย 15&quot; ·
            ชดเชย ใส่ &quot;ชดเชย 10&quot; (หรือ &quot;+10&quot; ถ้าตั้งคอลัมน์เป็นข้อความธรรมดาแล้ว ไม่งั้น Sheets จะตัด + ทิ้งกลายเป็นสาย)
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Mc: ถ้าช่องในชีตว่าง ระบบคิดจากหลักฐานไลฟ์ให้เอง (เริ่มจริงช้ากว่า slot = สาย / จบจริงเกิน slot = ชดเชย ไม่นับเศษวินาที) ·
            ถ้าไม่ต้องการให้นับ ใส่ &quot;0&quot; (ไม่หักสาย) หรือ &quot;ชดเชย 0&quot; (ไม่นับชดเชย) ในชีต
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function RoleRules({ role }: { role: "mc" | "admin" }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [data, setData] = useState<Rules | null>(null);
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    api<Rules>(`/api/rules?role=${role}`)
      .then((res) => {
        if (!res.ok) throw new Error(res.message);
        if (alive) { setData(res); setText(res.items.join("\n")); setError(""); }
      })
      .catch((err) => { if (alive) setError((err as Error).message); });
    return () => { alive = false; };
  }, [role, tick]);

  async function save(next: string) {
    setSaving(true);
    try {
      const res = await api<{ message: string }>("/api/rules", { role, text: next }, "PUT");
      if (!res.ok) throw new Error(res.message);
      toast(res.message);
      setTick((n) => n + 1);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  const label = role === "mc" ? "Mc" : "Admin";
  if (!data) {
    return error
      ? <StateBox title={`โหลดกฎของ ${label} ไม่สำเร็จ`}>{error}</StateBox>
      : <LoadingBlock className="my-0 rounded-xl" />;
  }
  const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const changed = lines.join("\n") !== data.items.join("\n");

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base font-bold">
          กฎของ {label} (ส่วน &quot;อื่นๆ&quot;)
          <Badge variant={data.custom ? "secondary" : "outline"} className="font-medium">
            {data.custom ? "แก้แล้ว" : "ข้อความเริ่มต้น"}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={Math.max(5, lines.length + 2)}
          disabled={saving}
          aria-label={`กฎการทำงานของ ${label}`}
          className="leading-relaxed"
          placeholder="หนึ่งบรรทัด = หนึ่งข้อ"
        />
        <div className="mt-2 text-xs text-muted-foreground">ตัวอย่างที่ {label} จะเห็น ({lines.length} ข้อ):</div>
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
          {lines.map((l, i) => <li key={i}>{l}</li>)}
        </ul>
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
          {data.custom ? (
            <Button
              variant="ghost"
              className="mr-auto text-muted-foreground"
              disabled={saving}
              onClick={async () => {
                if (await confirm({ title: `กลับไปใช้ข้อความเริ่มต้นของ ${label}?`, confirmText: "คืนค่าเริ่มต้น" })) save("");
              }}
            >
              คืนค่าเริ่มต้น
            </Button>
          ) : null}
          <Button variant="outline" disabled={saving || !changed} onClick={() => setText(data.items.join("\n"))}>ยกเลิกที่แก้</Button>
          <Button disabled={saving || !changed || !lines.length} onClick={() => save(text)}>
            {saving ? "กำลังบันทึก..." : "บันทึก"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
