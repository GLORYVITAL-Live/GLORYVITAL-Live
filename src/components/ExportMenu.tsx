"use client";

import { useState, type ComponentProps, type ReactNode } from "react";
import { ChevronDownIcon, DownloadIcon, FileSpreadsheetIcon, PresentationIcon, SheetIcon } from "lucide-react";
import { downloadXlsx, fileTitle, type ExportBook } from "@/lib/export";
import { api, useToast } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type Option = { icon: ReactNode; title: string; desc: string; run: () => Promise<void> | void };

/** ปุ่ม + ดรอปดาวน์เลือกรูปแบบไฟล์ */
function Menu({ label, icon, busyText, options, variant, size, className }: {
  label: string;
  icon: ReactNode;
  busyText: string;
  options: Option[];
  variant?: ComponentProps<typeof Button>["variant"];
  size?: ComponentProps<typeof Button>["size"];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  async function run(o: Option) {
    setOpen(false);
    setBusy(true);
    try {
      await o.run();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant={variant} size={size} disabled={busy} className={className}>
          {icon}{busy ? busyText : label}<ChevronDownIcon className="opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 gap-0 p-1">
        {options.map((o) => (
          <Button key={o.title} variant="ghost" className="h-auto w-full justify-start gap-2.5 py-2 text-left" onClick={() => run(o)}>
            {o.icon}
            <span><span className="block font-semibold">{o.title}</span><span className="text-xs font-normal text-muted-foreground">{o.desc}</span></span>
          </Button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

/**
 * เปิดแท็บใหม่ทันทีตอนกด (ถ้ารอให้สร้างเสร็จก่อน เบราว์เซอร์จะบล็อกป๊อปอัป) แล้วพาไปลิงก์เมื่อเสร็จ
 *   create = สร้างไฟล์ใน Google แล้วคืนลิงก์
 */
async function openWhenReady(what: string, create: () => Promise<string>) {
  const tab = window.open("", "_blank");
  if (tab) {
    tab.document.title = `กำลังสร้าง ${what}…`;
    tab.document.body.innerHTML = `<p style="font-family:sans-serif;padding:24px">กำลังสร้าง ${what}…</p>`;
  }
  try {
    const url = await create();
    if (tab) tab.location.href = url;
    else window.open(url, "_blank");
  } catch (err) {
    tab?.close();
    throw err;
  }
}

function download(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/**
 * ส่งออกตาราง: Microsoft Excel (.xlsx ดาวน์โหลด) / Google Sheet (สร้างไฟล์ใหม่ เปิดในแท็บใหม่)
 *   build = สร้างข้อมูลตอนกด (ใช้ตัวกรอง/ช่วงที่เลือกอยู่ตอนนั้น)
 */
export function ExportMenu({ label, build, variant = "outline", size = "lg", className }: {
  label: string;
  /** สร้างข้อมูลตอนกด (รอโหลดข้อมูลเพิ่มได้ เช่น คนไลฟ์ของแต่ละไลฟ์) */
  build: () => ExportBook | Promise<ExportBook>;
  variant?: ComponentProps<typeof Button>["variant"];
  size?: ComponentProps<typeof Button>["size"];
  className?: string;
}) {
  const toast = useToast();
  return (
    <Menu
      label={label} icon={<DownloadIcon />} busyText="กำลังสร้างไฟล์…" variant={variant} size={size} className={className}
      options={[
        {
          icon: <FileSpreadsheetIcon className="text-[#1d6f42]" />, title: "Microsoft Excel", desc: "ดาวน์โหลดไฟล์ .xlsx",
          run: async () => downloadXlsx(await build()),
        },
        {
          icon: <SheetIcon className="text-[#188038]" />, title: "Google Sheet", desc: "สร้างชีตใหม่ เปิดในแท็บใหม่",
          run: async () => {
            await openWhenReady("Google Sheet", async () => {
              const res = await api<{ url: string }>("/api/export/sheet", await build());
              if (!res.ok) throw new Error(res.message);
              return res.url;
            });
            toast("สร้าง Google Sheet แล้ว (อยู่ใน \"แชร์กับฉัน\" ของ Google Drive)");
          },
        },
      ]}
    />
  );
}

/** สไลด์นำเสนอ: PowerPoint (.pptx ดาวน์โหลด) / Google Slides (แปลงไฟล์เดียวกัน เปิดในแท็บใหม่) */
export function SlidesMenu({ label, title, build, variant = "outline", size = "sm", className }: {
  label: string;
  title: string;
  /** pptx = กราฟจริงของ PowerPoint / gslides = กราฟวาดด้วยรูปทรง (แปลงเป็น Google Slides ได้คมชัด) */
  build: (target: "pptx" | "gslides") => Promise<Blob>;
  variant?: ComponentProps<typeof Button>["variant"];
  size?: ComponentProps<typeof Button>["size"];
  className?: string;
}) {
  const toast = useToast();
  return (
    <Menu
      label={label} icon={<PresentationIcon />} busyText="กำลังสร้างสไลด์…" variant={variant} size={size} className={className}
      options={[
        {
          icon: <PresentationIcon className="text-[#c43e1c]" />, title: "PowerPoint", desc: "ดาวน์โหลดไฟล์ .pptx",
          run: async () => download(await build("pptx"), `${fileTitle(title)}.pptx`),
        },
        {
          icon: <PresentationIcon className="text-[#f4b400]" />, title: "Google Slides", desc: "สร้างสไลด์ใหม่ เปิดในแท็บใหม่",
          run: async () => {
            await openWhenReady("Google Slides", async () => {
              const blob = await build("gslides");
              let res: Response;
              try {
                res = await fetch(`/api/export/slides?title=${encodeURIComponent(title)}`, { method: "POST", body: blob });
              } catch {
                throw new Error("เชื่อมต่อไม่สำเร็จ ตรวจสอบอินเทอร์เน็ต");
              }
              const data = await res.json().catch(() => null);
              if (!data?.ok) throw new Error(data?.message ?? `สร้าง Google Slides ไม่สำเร็จ (HTTP ${res.status})`);
              return data.url as string;
            });
            toast("สร้าง Google Slides แล้ว (อยู่ใน \"แชร์กับฉัน\" ของ Google Drive)");
          },
        },
      ]}
    />
  );
}
