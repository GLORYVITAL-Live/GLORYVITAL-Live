"use client";

import { useEffect, useState } from "react";
import { StateBox, api, btn, useToast } from "@/components/ui";
import { BONUS_TIERS, LATE_TIERS } from "@/lib/pay";
import type { OwnerScope } from "@/lib/types";

type Rules = { items: string[]; custom: boolean; defaults: string[] };

/** หน้าเจ้าของ > กฎการทำงาน: แก้ข้อความส่วน "อื่นๆ" ของหน้ากฎ (เฉพาะฝั่งที่มีสิทธิ์) */
export function RulesEditor({ scope }: { scope: OwnerScope }) {
  const roles = (["mc", "admin"] as const).filter((r) => scope[r]);
  return (
    <div className="space-y-5 pb-10">
      <p className="my-2 rounded-xl bg-brand-soft px-3 py-2 text-sm text-info-ink">
        แก้ข้อความที่ Mc / Admin เห็นในหน้า &quot;กฎการทำงาน&quot; (เด้งวันละครั้งหลัง login) หนึ่งบรรทัด = หนึ่งข้อ
      </p>
      {roles.map((r) => <RoleRules key={r} role={r} />)}
      <section className="rounded-xl border border-line bg-surface p-3 text-sm">
        <h2 className="mb-1 font-bold">การมาสาย / ไลฟ์ชดเชย (แก้ที่นี่ไม่ได้)</h2>
        <p className="mb-2 text-xs text-muted">
          ดึงจากกฎคิดเงินจริง ตัวเลขที่พนักงานเห็นจึงตรงกับเงินเสมอ (พนักงานแต่ละคนเห็นเป็นบาทตามค่าจ้างของตัวเอง)
          ถ้าจะเปลี่ยนกฎต้องแก้ในโค้ด (src/lib/pay.ts)
        </p>
        <ul className="list-disc space-y-0.5 pl-5 text-muted">
          {LATE_TIERS.map((t) => <li key={t.label}>{t.label}: {t.cut ? `หัก ${Math.round(t.cut * 100)}%` : "ไม่หัก"}</li>)}
          {BONUS_TIERS.map((t) => <li key={t.label}>{t.label}: ได้ {t.share}</li>)}
        </ul>
        <p className="mt-2 text-xs text-muted">
          บันทึกในชีต: Mc = แท็บ Deal Mc คอลัมน์ L / Admin = แท็บ Admin เสริม คอลัมน์ M — สาย ใส่ &quot;15&quot; หรือ &quot;สาย 15&quot; · ชดเชย ใส่ &quot;+10&quot;
        </p>
      </section>
    </div>
  );
}

function RoleRules({ role }: { role: "mc" | "admin" }) {
  const toast = useToast();
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
      : <div className="h-40 animate-pulse rounded-xl bg-line/70" />;
  }
  const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const changed = lines.join("\n") !== data.items.join("\n");

  return (
    <section className="rounded-xl border border-line bg-surface p-3">
      <h2 className="mb-2 flex flex-wrap items-center gap-2 font-bold">
        กฎของ {label} (ส่วน &quot;อื่นๆ&quot;)
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${data.custom ? "bg-brand-soft text-brand" : "bg-bg text-muted"}`}>
          {data.custom ? "แก้แล้ว" : "ข้อความเริ่มต้น"}
        </span>
      </h2>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={Math.max(5, lines.length + 2)}
        disabled={saving}
        aria-label={`กฎการทำงานของ ${label}`}
        className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm leading-relaxed disabled:opacity-60"
        placeholder="หนึ่งบรรทัด = หนึ่งข้อ"
      />
      <div className="mt-1 text-xs text-muted">ตัวอย่างที่ {label} จะเห็น ({lines.length} ข้อ):</div>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-muted">
        {lines.map((l, i) => <li key={i}>{l}</li>)}
      </ul>
      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        {data.custom ? (
          <button
            type="button"
            className="mr-auto text-sm font-semibold text-muted hover:underline"
            disabled={saving}
            onClick={() => { if (confirm(`กลับไปใช้ข้อความเริ่มต้นของ ${label}?`)) save(""); }}
          >
            คืนค่าเริ่มต้น
          </button>
        ) : null}
        <button type="button" className={btn.ghost} disabled={saving || !changed} onClick={() => setText(data.items.join("\n"))}>ยกเลิกที่แก้</button>
        <button type="button" className={btn.primary} disabled={saving || !changed || !lines.length} onClick={() => save(text)}>
          {saving ? "กำลังบันทึก..." : "บันทึก"}
        </button>
      </div>
    </section>
  );
}
