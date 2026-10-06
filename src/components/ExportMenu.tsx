"use client";

import { useState, type ComponentProps } from "react";
import { ChevronDownIcon, DownloadIcon, FileSpreadsheetIcon, SheetIcon } from "lucide-react";
import { downloadXlsx, type ExportBook } from "@/lib/export";
import { api, useToast } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * ปุ่มส่งออก + ดรอปดาวน์เลือกรูปแบบ: Microsoft Excel (.xlsx ดาวน์โหลด) / Google Sheet (สร้างไฟล์ใหม่ เปิดในแท็บใหม่)
 *   build = สร้างข้อมูลตอนกด (ใช้ตัวกรอง/ช่วงที่เลือกอยู่ตอนนั้น)
 */
export function ExportMenu({ label, build, variant = "outline", size = "lg", className }: {
  label: string;
  build: () => ExportBook;
  variant?: ComponentProps<typeof Button>["variant"];
  size?: ComponentProps<typeof Button>["size"];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  function excel() {
    setOpen(false);
    try {
      downloadXlsx(build());
    } catch (err) {
      toast(`สร้างไฟล์ไม่สำเร็จ: ${(err as Error).message}`, "error");
    }
  }

  async function googleSheet() {
    setOpen(false);
    // เปิดแท็บใหม่ทันทีตอนกด (ถ้ารอให้สร้างเสร็จก่อน เบราว์เซอร์จะบล็อกป๊อปอัป)
    const tab = window.open("", "_blank");
    if (tab) tab.document.title = "กำลังสร้าง Google Sheet…";
    if (tab) tab.document.body.innerHTML = '<p style="font-family:sans-serif;padding:24px">กำลังสร้าง Google Sheet…</p>';
    setBusy(true);
    try {
      const res = await api<{ url: string }>("/api/export/sheet", build());
      if (!res.ok) throw new Error(res.message);
      if (tab) tab.location.href = res.url;
      else window.open(res.url, "_blank");
      toast("สร้าง Google Sheet แล้ว (อยู่ใน \"แชร์กับฉัน\" ของ Google Drive)");
    } catch (err) {
      tab?.close();
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant={variant} size={size} disabled={busy} className={className}>
          <DownloadIcon />{busy ? "กำลังสร้าง Google Sheet…" : label}<ChevronDownIcon className="opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 gap-0 p-1">
        <Button variant="ghost" className="h-auto w-full justify-start gap-2.5 py-2 text-left" onClick={excel}>
          <FileSpreadsheetIcon className="text-[#1d6f42]" />
          <span><span className="block font-semibold">Microsoft Excel</span><span className="text-xs font-normal text-muted-foreground">ดาวน์โหลดไฟล์ .xlsx</span></span>
        </Button>
        <Button variant="ghost" className="h-auto w-full justify-start gap-2.5 py-2 text-left" onClick={googleSheet}>
          <SheetIcon className="text-[#188038]" />
          <span><span className="block font-semibold">Google Sheet</span><span className="text-xs font-normal text-muted-foreground">สร้างชีตใหม่ เปิดในแท็บใหม่</span></span>
        </Button>
      </PopoverContent>
    </Popover>
  );
}
