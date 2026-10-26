"use client";

import { useEffect, useId, useState } from "react";
import { LoadingBlock, Notice, StateBox, api, useConfirm, useToast } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { BONUS_TIERS, LATE_TIERS } from "@/lib/pay";
import type { OwnerScope } from "@/lib/types";

type Rules = { items: string[]; custom: boolean; defaults: string[] };

/** หน้าเจ้าของ > กฎการทำงาน: แก้ข้อความส่วน "อื่นๆ" ของหน้ากฎ (เฉพาะฝั่งที่มีสิทธิ์ · ดูได้อย่างเดียว = อ่านอย่างเดียว) */
export function RulesEditor({ scope, edit }: { scope: OwnerScope; edit: OwnerScope }) {
  const roles = (["mc", "admin"] as const).filter((r) => scope[r]);
  return (
    <div className="space-y-5 pb-10">
      <Notice>
        {roles.some((r) => edit[r]) ? "แก้ข้อความที่ Mc / Admin เห็นในหน้า \"กฎการทำงาน\" (เด้งวันละครั้งหลัง login) หนึ่งบรรทัด = หนึ่งข้อ"
          : "ข้อความที่ Mc / Admin เห็นในหน้า \"กฎการทำงาน\" (บัญชีนี้ดูได้อย่างเดียว)"}
      </Notice>
      {roles.map((r) => <RoleRules key={r} role={r} readOnly={!edit[r]} />)}
      {roles.length ? <LinkSetting field="adminChatUrl" role={roles[0]} readOnly={!(edit.mc || edit.admin)} /> : null}
      {roles.length ? <LinkSetting field="workLocationUrl" role={roles[0]} readOnly={!(edit.mc || edit.admin)} /> : null}
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

/**
 * ลิงก์ที่ Owner ตั้งได้ (settings) — ว่าง = ไม่มีปุ่ม
 *   adminChatUrl: ปุ่ม "ทักแชทแอดมิน" หลัง Mc / Admin เสริมยกเลิกคิว + ในตารางของฉัน
 *   workLocationUrl: ปุ่มโลเคชั่นที่ทำงาน (หัวเว็บ + ตารางของฉัน) เห็นเฉพาะคนที่มีบัญชี
 */
const LINK_TEXT = {
  adminChatUrl: {
    title: "ลิงก์แชทแอดมิน", placeholder: "https://line.me/...",
    hint: "ปุ่ม \"ทักแชทแอดมิน\" ที่ Mc / Admin เสริมเห็นหลังกดยกเลิกคิว และตอนยกเลิกผ่านเว็บไม่ได้แล้ว (เช่น ลิงก์ LINE OA / กลุ่ม LINE) · ว่าง = ไม่มีปุ่ม",
  },
  workLocationUrl: {
    title: "ลิงก์โลเคชั่นที่ทำงาน", placeholder: "https://maps.app.goo.gl/...",
    hint: "ปุ่มหมุดแผนที่ที่หัวเว็บ + ลิงก์ \"สถานที่ทำงาน\" ในตารางของฉัน · เห็นเฉพาะคนที่ login และมีบัญชีในระบบ · ว่าง = ไม่มีปุ่ม",
  },
} as const;

function LinkSetting({ field, role, readOnly }: { field: keyof typeof LINK_TEXT; role: "mc" | "admin"; readOnly: boolean }) {
  const toast = useToast();
  const [saved, setSaved] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const inputId = useId();
  const t = LINK_TEXT[field];

  useEffect(() => {
    let alive = true;
    api<Record<typeof field, string>>(`/api/rules?role=${role}`)
      .then((res) => { if (alive && res.ok) { setSaved(res[field] ?? ""); setText(res[field] ?? ""); } })
      .catch(() => {});
    return () => { alive = false; };
  }, [role, field]);

  const value = text.trim();
  // ตรวจในหน้าเว็บก่อน (เซิร์ฟเวอร์ตรวจซ้ำ): ว่าง = ไม่มีปุ่ม / ต้องเป็น https://
  const valid = !value || /^https:\/\/[^\s]+\.[^\s]+/i.test(value);

  async function save() {
    setSaving(true);
    try {
      const res = await api<{ message: string } & Record<typeof field, string>>("/api/rules", { [field]: value }, "PATCH");
      if (!res.ok) throw new Error(res.message);
      setSaved(res[field]);
      setText(res[field]);
      toast(res.message);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="font-bold">{t.title}</CardTitle>
        <CardDescription className="text-xs">{t.hint}</CardDescription>
      </CardHeader>
      <CardContent>
        {saved === null ? <LoadingBlock className="my-0 h-9 rounded-lg" /> : readOnly ? (
          <p className="text-sm break-all text-muted-foreground">{saved || "ยังไม่ได้ตั้ง"}</p>
        ) : (
          <>
            <Label htmlFor={inputId} className="sr-only">{t.title}</Label>
            <Input
              id={inputId} type="url" inputMode="url" value={text} disabled={saving}
              onChange={(e) => setText(e.target.value)} placeholder={t.placeholder} aria-invalid={!valid}
            />
            {!valid ? <p className="mt-1 text-xs text-destructive">ลิงก์ต้องขึ้นต้นด้วย https://</p> : null}
            <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
              {saved ? (
                <Button variant="link" asChild className="mr-auto h-auto px-0 text-xs">
                  <a href={saved} target="_blank" rel="noopener noreferrer">ลองเปิดลิงก์ปัจจุบัน</a>
                </Button>
              ) : null}
              <Button variant="outline" disabled={saving || value === saved} onClick={() => setText(saved)}>ยกเลิกที่แก้</Button>
              <Button disabled={saving || value === saved || !valid} onClick={save}>{saving ? "กำลังบันทึก..." : "บันทึก"}</Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function RoleRules({ role, readOnly }: { role: "mc" | "admin"; readOnly: boolean }) {
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
        {readOnly ? null : (
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={Math.max(5, lines.length + 2)}
            disabled={saving}
            aria-label={`กฎการทำงานของ ${label}`}
            className="leading-relaxed"
            placeholder="หนึ่งบรรทัด = หนึ่งข้อ"
          />
        )}
        <div className="mt-2 text-xs text-muted-foreground">{readOnly ? `ที่ ${label} เห็น` : `ตัวอย่างที่ ${label} จะเห็น`} ({lines.length} ข้อ):</div>
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
          {lines.map((l, i) => <li key={i}>{l}</li>)}
        </ul>
        <div className={readOnly ? "hidden" : "mt-3 flex flex-wrap items-center justify-end gap-2"}>
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
