"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { FileTextIcon, FileUpIcon, FolderOpenIcon, RefreshCwIcon } from "lucide-react";
import type { MyPayDocs, OwnerPayDocs, PayDocsView } from "@/lib/types";
import {
  BANKS, PAY_DOC_LABEL, PAY_DOC_MAX_BYTES, cleanPayInfo, formatThaiId, type PayDocKind,
} from "@/lib/pay-docs";
import { shrinkImage } from "@/lib/image";
import { AppDialog, DialogActions, DialogBody, LoadingBlock, Notice, api, useToast } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const KINDS: PayDocKind[] = ["id_card", "bank_book"];
const OTHER_BANK = "__other";
const HINT: Record<PayDocKind, string> = {
  id_card: "ด้านหน้าบัตร เห็นชัดทั้งใบ (รูป หรือ PDF)",
  bank_book: "หน้าแรกที่มีชื่อและเลขบัญชี หรือแคปหน้าบัญชีจากแอปธนาคาร",
};
const fmtUpdated = new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" });

/**
 * เอกสารทำเบิกของตัวเอง (หน้าจอง Mc / Admin): ป้ายเตือนถ้ายังไม่ส่ง + หน้าต่างส่ง / แก้
 *   open = เปิดหน้าต่าง (จากป้ายเตือน หรือปุ่มใน "ตารางของฉัน")
 */
export function PayDocs({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [state, setState] = useState<MyPayDocs | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    api<MyPayDocs>("/api/my/pay-docs")
      .then((res) => {
        if (!alive) return;
        if (res.ok) setState({ required: res.required, onFile: res.onFile, docs: res.docs });
        else setError(res.message ?? "โหลดไม่สำเร็จ");
      })
      .catch((err) => { if (alive) setError((err as Error).message); });
    return () => { alive = false; };
  }, []);

  return (
    <>
      {state?.required && !state.docs ? (
        <Notice variant="warning" icon title="ยังไม่ได้ส่งเอกสารทำเบิก">
          <span className="block">ส่งรูปบัตรประชาชน รูปหน้าสมุดบัญชี และข้อมูลสำหรับโอนค่าจ้าง (ส่งครั้งเดียว แก้ทีหลังได้) — เห็นเฉพาะคุณและเจ้าของ</span>
          <span className="mt-2 flex">
            <Button size="sm" onClick={() => onOpenChange(true)}><FileUpIcon />ส่งเอกสาร</Button>
          </span>
        </Notice>
      ) : null}
      {open ? (
        state ? (
          <PayDocsDialog
            current={state.docs}
            onFile={state.onFile}
            onClose={(docs) => {
              onOpenChange(false);
              if (docs) setState({ ...state, docs });
            }}
          />
        ) : (
          <AppDialog open onClose={() => onOpenChange(false)} title="เอกสารทำเบิก">
            {error ? <Notice variant="warning" icon title="โหลดไม่สำเร็จ">{error}</Notice> : <LoadingBlock />}
          </AppDialog>
        )
      ) : null}
    </>
  );
}

type Picked = { blob: Blob; pdf: boolean; name: string; url?: string };

/** onFile = ทีมงานมีเอกสารเดิมใน Drive แล้ว (ส่งทาง LINE) ส่งในเว็บได้ถ้าจะเปลี่ยน */
function PayDocsDialog({ current, onFile, onClose }: { current: PayDocsView | null; onFile: boolean; onClose: (docs?: PayDocsView) => void }) {
  const toast = useToast();
  const [form, setForm] = useState(() => ({
    fullName: current?.fullName ?? "",
    idCardNo: current ? formatThaiId(current.idCardNo) : "",
    address: current?.address ?? "",
    bank: current?.bank ?? "",
    accountNo: current?.accountNo ?? "",
    accountName: current?.accountName ?? "",
  }));
  const set = (k: keyof typeof form) => (v: string) => setForm({ ...form, [k]: v });
  const [otherBank, setOtherBank] = useState(() => !!current && !BANKS.includes(current.bank));
  // คนต่างชาติ: เลขพาสปอร์ตมีตัวอักษร (มือถือต้องใช้แป้นตัวอักษร ไม่ใช่แป้นตัวเลข)
  const [passport, setPassport] = useState(() => !!current && /[a-z]/i.test(current.idCardNo));
  const [files, setFiles] = useState<Partial<Record<PayDocKind, Picked>>>({});
  const [busy, setBusy] = useState(false);

  // ลบรูปตัวอย่างออกจากหน่วยความจำตอนปิด
  const urls = useRef<string[]>([]);
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  async function pick(kind: PayDocKind, file: File | undefined) {
    if (!file) return;
    try {
      let picked: Picked;
      if (file.type === "application/pdf") {
        if (file.size > PAY_DOC_MAX_BYTES) throw new Error("ไฟล์ PDF ใหญ่เกิน 2 MB ลองถ่ายรูปแทน");
        picked = { blob: file, pdf: true, name: file.name };
      } else if (file.type.startsWith("image/") || !file.type) {
        const blob = await shrinkImage(file, 1800);
        if (blob.size > PAY_DOC_MAX_BYTES) throw new Error("รูปใหญ่เกินไป ลองถ่ายใหม่ให้เห็นแค่บัตร / หน้าสมุด");
        const url = URL.createObjectURL(blob);
        urls.current.push(url);
        picked = { blob, pdf: false, name: file.name, url };
      } else {
        throw new Error("รองรับเฉพาะรูป หรือไฟล์ PDF");
      }
      setFiles((f) => ({ ...f, [kind]: picked }));
    } catch (err) {
      toast(`${PAY_DOC_LABEL[kind]}: ${(err as Error).message}`, "error");
    }
  }

  async function save() {
    // ชื่อบัญชีว่าง = ชื่อเดียวกับชื่อ-นามสกุล
    const info = { ...form, accountName: form.accountName.trim() || form.fullName };
    const check = cleanPayInfo(info);
    if ("error" in check) return toast(check.error, "error");
    const missing = KINDS.find((k) => !files[k] && !current);
    if (missing) return toast(`กรุณาแนบ${PAY_DOC_LABEL[missing]}`, "error");
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("info", JSON.stringify(check.info));
      for (const k of KINDS) {
        const f = files[k];
        if (f) fd.append(k, f.blob, f.pdf ? `${k}.pdf` : `${k}.jpg`);
      }
      const res = await fetch("/api/my/pay-docs", { method: "POST", body: fd });
      const json = await res.json().catch(() => null) as { ok?: boolean; message?: string; docs?: PayDocsView } | null;
      if (!json?.ok || !json.docs) throw new Error(json?.message ?? `ส่งเอกสารไม่สำเร็จ (HTTP ${res.status})`);
      toast(json.message ?? "บันทึกแล้ว");
      onClose(json.docs);
    } catch (err) {
      toast((err as Error).message, "error");
      setBusy(false);
    }
  }

  return (
    <AppDialog
      open
      onClose={() => onClose()}
      busy={busy}
      title={current ? "เอกสารทำเบิก" : "ส่งเอกสารทำเบิก"}
      description={current
        ? `ส่งแล้วเมื่อ ${fmtUpdated.format(new Date(current.updatedAt))} · แก้แล้วกดบันทึก (ไม่เลือกไฟล์ใหม่ = ใช้ไฟล์เดิม)`
        : onFile
          ? "ทีมงานมีเอกสารของคุณแล้ว (ที่เคยส่งทาง LINE) ไม่ต้องส่งซ้ำ — ส่งใหม่ที่นี่ได้ถ้าเปลี่ยนบัญชีธนาคารหรือข้อมูล"
          : "ใช้โอนค่าจ้างและทำเบิก เห็นเฉพาะคุณและเจ้าของ"}
    >
      <DialogBody className="space-y-3 text-sm">
        <Field label="ชื่อ-นามสกุลจริง (ตามบัตรประชาชน)">
          {(id) => <Input id={id} value={form.fullName} disabled={busy} onChange={(e) => set("fullName")(e.target.value)} placeholder="เช่น นางสาว มะนาว ใจดี" autoComplete="name" />}
        </Field>
        <Field
          label={passport ? "เลขพาสปอร์ต" : "เลขบัตรประชาชน 13 หลัก"}
          hint={(
            <button type="button" className="cursor-pointer font-semibold text-primary underline-offset-2 hover:underline" onClick={() => setPassport(!passport)}>
              {passport ? "ใช้เลขบัตรประชาชนไทย" : "คนต่างชาติ: ใช้เลขพาสปอร์ต"}
            </button>
          )}
        >
          {(id) => (
            <Input
              id={id} value={form.idCardNo} disabled={busy} inputMode={passport ? "text" : "numeric"} autoCapitalize={passport ? "characters" : "off"}
              onChange={(e) => set("idCardNo")(e.target.value)} placeholder={passport ? "เช่น AA1234567" : "x-xxxx-xxxxx-xx-x"} autoComplete="off"
            />
          )}
        </Field>
        <Field label="ที่อยู่ตามบัตรประชาชน">
          {(id) => <Textarea id={id} rows={2} value={form.address} disabled={busy} onChange={(e) => set("address")(e.target.value)} placeholder="บ้านเลขที่ ถนน แขวง/ตำบล เขต/อำเภอ จังหวัด รหัสไปรษณีย์" />}
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="ธนาคาร">
            {(id) => (
              <Select
                value={otherBank ? OTHER_BANK : form.bank}
                disabled={busy}
                onValueChange={(v) => {
                  setOtherBank(v === OTHER_BANK);
                  set("bank")(v === OTHER_BANK ? "" : v);
                }}
              >
                <SelectTrigger id={id} className="w-full"><SelectValue placeholder="เลือกธนาคาร" /></SelectTrigger>
                <SelectContent position="popper" className="max-h-72">
                  {BANKS.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                  <SelectItem value={OTHER_BANK}>อื่นๆ (พิมพ์เอง)</SelectItem>
                </SelectContent>
              </Select>
            )}
          </Field>
          <Field label="เลขบัญชี">
            {(id) => <Input id={id} value={form.accountNo} disabled={busy} inputMode="numeric" onChange={(e) => set("accountNo")(e.target.value)} placeholder="xxx-x-xxxxx-x" autoComplete="off" />}
          </Field>
        </div>
        {otherBank ? (
          <Field label="ชื่อธนาคาร">
            {(id) => <Input id={id} value={form.bank} disabled={busy} onChange={(e) => set("bank")(e.target.value)} placeholder="พิมพ์ชื่อธนาคาร" />}
          </Field>
        ) : null}
        <Field label="ชื่อบัญชี" hint="ว่าง = ชื่อเดียวกับชื่อ-นามสกุลด้านบน">
          {(id) => <Input id={id} value={form.accountName} disabled={busy} onChange={(e) => set("accountName")(e.target.value)} placeholder={form.fullName || "ชื่อบัญชีตามสมุดบัญชี"} />}
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          {KINDS.map((kind) => {
            const picked = files[kind];
            const sentPdf = kind === "id_card" ? current?.idCardPdf : current?.bankBookPdf;
            return (
              // ปุ่มเลือกไฟล์ชิดล่างทั้งสองการ์ด (คำอธิบายยาวไม่เท่ากัน)
              <div key={kind} className="flex flex-col rounded-lg border p-2.5">
                <span className="block font-semibold">{PAY_DOC_LABEL[kind]}</span>
                <span className="block text-xs text-muted-foreground">{HINT[kind]}</span>
                {picked?.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={picked.url} alt={`ตัวอย่าง${PAY_DOC_LABEL[kind]}`} className="mt-2 max-h-40 w-full rounded-md border object-contain" />
                ) : picked ? (
                  <span className="mt-2 flex items-center gap-1.5 text-xs"><FileTextIcon className="size-4" />{picked.name}</span>
                ) : current ? (
                  <a href={`/api/pay-docs/file?kind=${kind}`} target="_blank" rel="noopener" className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-primary underline-offset-2 hover:underline">
                    <FileTextIcon className="size-4" />ดู{sentPdf ? "ไฟล์" : "รูป"}ที่ส่งแล้ว
                  </a>
                ) : null}
                <div className="mt-auto pt-2">
                  <Button variant="outline" size="sm" className="w-full" disabled={busy} asChild>
                    <label className={cn("cursor-pointer", busy && "pointer-events-none opacity-50")}>
                      <FileUpIcon />{picked || current ? "เปลี่ยนไฟล์" : "เลือกรูป / ถ่ายรูป"}
                      {/* ล้างค่าหลังเลือก = เลือกไฟล์เดิมซ้ำได้ */}
                      <input type="file" accept="image/*,application/pdf" className="sr-only" disabled={busy}
                        onChange={(e) => { pick(kind, e.target.files?.[0]); e.target.value = ""; }} />
                    </label>
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </DialogBody>
      <DialogActions>
        <Button variant="outline" size="lg" disabled={busy} onClick={() => onClose()}>ยกเลิก</Button>
        <Button size="lg" disabled={busy} onClick={save}>{busy ? "กำลังส่ง..." : current ? "บันทึก" : "ส่งเอกสาร"}</Button>
      </DialogActions>
    </AppDialog>
  );
}

/** ช่องกรอก + ป้ายชื่อ + คำอธิบายใต้ช่อง */
function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div>
      <Label htmlFor={id} className="mb-1.5 font-semibold">{label}</Label>
      {children(id)}
      {hint ? <span className="mt-1 block text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

// ---------- Owner: ดูเอกสารของคนนี้ (หน้าต่างแก้ไขพนักงาน) ----------

/** เอกสารทำเบิกของ Mc / Admin คนนี้ (เฉพาะ Owner ที่ดูเอกสารได้) staffId = id ในรายชื่อ */
export function PayDocsPanel({ staffId }: { staffId: number }) {
  const toast = useToast();
  const [data, setData] = useState<OwnerPayDocs | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"sync" | "folders" | "link" | null>(null);
  const [pick, setPick] = useState("");
  const take = (res: OwnerPayDocs) => setData((old) => ({
    docs: res.docs, drive: res.drive, linked: res.linked, folders: res.folders ?? old?.folders,
  }));
  useEffect(() => {
    let alive = true;
    api<OwnerPayDocs>(`/api/owner/pay-docs?id=${staffId}`)
      .then((res) => {
        if (!alive) return;
        if (res.ok) take(res);
        else setError(res.message ?? "โหลดไม่สำเร็จ");
      })
      .catch((err) => { if (alive) setError((err as Error).message); });
    return () => { alive = false; };
  }, [staffId]);

  async function run(kind: "sync" | "folders" | "link", call: () => Promise<OwnerPayDocs & { ok: boolean; message?: string }>, done?: string) {
    setBusy(kind);
    try {
      const res = await call();
      if (!res.ok) throw new Error(res.message);
      take(res);
      if (done) toast(done);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }
  const resync = () => run("sync", () => api<OwnerPayDocs>("/api/owner/pay-docs", { id: staffId }), "ส่งขึ้น Google Drive แล้ว");
  const loadFolders = () => run("folders", () => api<OwnerPayDocs>(`/api/owner/pay-docs?id=${staffId}&folders=1`));
  const link = (folderId: string | null) => run(
    "link", () => api<OwnerPayDocs>("/api/owner/pay-docs", { id: staffId, folderId }, "PATCH"),
    folderId ? "ผูกโฟลเดอร์แล้ว คนนี้ไม่ต้องส่งเอกสารซ้ำ" : "ยกเลิกการผูกแล้ว",
  );

  const d = data?.docs;
  const row = (label: string, value: ReactNode) => (
    <div className="flex gap-2 py-0.5">
      <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 break-words">{value}</span>
    </div>
  );
  return (
    <fieldset className="rounded-lg border px-3 py-2 text-sm">
      <legend className="px-1 font-semibold">เอกสารทำเบิก</legend>
      {error ? <p className="text-xs text-destructive">{error}</p>
        : !data ? <p className="text-xs text-muted-foreground">กำลังโหลด...</p>
          : !d ? (
            <p className="text-xs text-muted-foreground">
              {data.linked ? "ยังไม่ได้ส่งในเว็บ — มีเอกสารเดิมใน Drive แล้ว (ไม่ขึ้นป้ายเตือน)" : "ยังไม่ได้ส่ง และยังไม่ได้ผูกโฟลเดอร์เอกสารเดิมใน Drive"}
            </p>
          ) : (
              <>
                {row("ชื่อ-นามสกุล", d.fullName)}
                {row("เลขบัตร", formatThaiId(d.idCardNo))}
                {row("ที่อยู่", d.address)}
                {row("ธนาคาร", d.bank)}
                {row("เลขบัญชี", <span className="tabular-nums">{d.accountNo}</span>)}
                {row("ชื่อบัญชี", d.accountName)}
                {row("ส่งเมื่อ", fmtUpdated.format(new Date(d.updatedAt)))}
                <div className="mt-2 flex flex-wrap gap-2">
                  {KINDS.map((kind) => (
                    <Button key={kind} variant="outline" size="sm" asChild>
                      <a href={`/api/pay-docs/file?kind=${kind}&staff=${staffId}`} target="_blank" rel="noopener">
                        <FileTextIcon />{PAY_DOC_LABEL[kind].replace("รูป", "")}
                      </a>
                    </Button>
                  ))}
                  {data.drive.folders.map((f) => (
                    <Button key={f.role} variant="outline" size="sm" asChild>
                      <a href={f.url} target="_blank" rel="noopener"><FolderOpenIcon />Drive ({f.role === "mc" ? "Mc" : "Admin"})</a>
                    </Button>
                  ))}
                </div>
                {data.drive.error || data.drive.pending ? (
                  <div className={cn("mt-2 flex flex-wrap items-center gap-2 text-xs", data.drive.error ? "text-destructive" : "text-muted-foreground")}>
                    <span className="min-w-0 flex-1">{data.drive.error ? `ขึ้น Google Drive ไม่สำเร็จ: ${data.drive.error}` : "กำลังส่งขึ้น Google Drive..."}</span>
                    <Button variant="outline" size="sm" disabled={!!busy} onClick={resync}>
                      <RefreshCwIcon className={cn(busy === "sync" && "animate-spin")} />{busy === "sync" ? "กำลังส่ง..." : "ส่งขึ้น Drive อีกครั้ง"}
                    </Button>
                  </div>
                ) : null}
              </>
            )}

      {/* โฟลเดอร์เอกสารเดิม (ส่งทาง LINE) — จับคู่ชื่ออัตโนมัติ หรือผูกเองตรงนี้ */}
      {data ? (
        <div className="mt-2 border-t pt-2 text-xs">
          {data.linked ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1">เอกสารเดิมใน Drive: <b>{data.linked.name || "(โฟลเดอร์ถูกย้าย / ลบ)"}</b></span>
              <Button variant="outline" size="sm" asChild>
                <a href={data.linked.url} target="_blank" rel="noopener"><FolderOpenIcon />เปิดโฟลเดอร์</a>
              </Button>
              <Button variant="ghost" size="sm" className="text-muted-foreground" disabled={!!busy} onClick={() => link(null)}>ยกเลิกการผูก</Button>
            </div>
          ) : !data.folders ? (
            <Button variant="outline" size="sm" disabled={!!busy} onClick={loadFolders}>
              <FolderOpenIcon />{busy === "folders" ? "กำลังโหลดโฟลเดอร์..." : "ผูกกับโฟลเดอร์เอกสารเดิมใน Drive"}
            </Button>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Select value={pick} onValueChange={setPick}>
                <SelectTrigger aria-label="โฟลเดอร์เอกสารเดิม" className="h-8 min-w-48 flex-1"><SelectValue placeholder="เลือกโฟลเดอร์ของคนนี้" /></SelectTrigger>
                <SelectContent position="popper" className="max-h-72">
                  {data.folders.map((f) => (
                    <SelectItem key={f.id} value={f.id}>{f.name}{f.usedBy ? ` (ผูกกับ ${f.usedBy} แล้ว)` : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" disabled={!pick || !!busy} onClick={() => link(pick)}>{busy === "link" ? "กำลังผูก..." : "ผูก"}</Button>
            </div>
          )}
        </div>
      ) : null}
    </fieldset>
  );
}
