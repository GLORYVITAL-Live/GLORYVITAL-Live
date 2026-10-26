"use client";

import { useEffect, useState } from "react";
import { MapPinIcon } from "lucide-react";
import { api } from "@/components/shared";
import { Button } from "@/components/ui/button";

/**
 * ลิงก์โลเคชั่นที่ทำงาน (Google Maps) — เห็นเฉพาะคนที่มีบัญชี (/api/location ตรวจ login + ลงทะเบียน)
 *   ไม่มีในโค้ด (repo เป็นสาธารณะ) ตั้งที่หน้าเจ้าของ > กฎการทำงาน · ว่าง = ไม่แสดงปุ่ม
 */

// โหลดครั้งเดียวต่อการเปิดเว็บ (ปุ่มหัวเว็บ + ลิงก์ในตารางของฉันใช้ร่วมกัน)
let cached: Promise<string> | null = null;
const loadUrl = () => {
  cached ??= api<{ url: string }>("/api/location")
    .then((res) => (res.ok ? res.url : ""))
    .catch(() => { cached = null; return ""; });
  return cached;
};

export function useWorkLocation(enabled: boolean) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    loadUrl().then((u) => { if (alive) setUrl(u); });
    return () => { alive = false; };
  }, [enabled]);
  return enabled ? url : "";
}

const LABEL = "สถานที่ทำงาน (เปิด Google Maps)";

/** ปุ่มหัวเว็บ */
export function WorkLocationButton() {
  const url = useWorkLocation(true);
  if (!url) return null;
  return (
    <Button variant="outline" size="icon-lg" asChild className="rounded-full bg-card shadow-card">
      <a href={url} target="_blank" rel="noopener noreferrer" aria-label={LABEL} title={LABEL}><MapPinIcon /></a>
    </Button>
  );
}

/** ลิงก์ในตารางของฉัน (แถวเดียวกับกฎการทำงาน / เอกสารทำเบิก) */
export function WorkLocationLink() {
  const url = useWorkLocation(true);
  if (!url) return null;
  return (
    <Button variant="link" asChild className="h-auto px-0 font-semibold">
      <a href={url} target="_blank" rel="noopener noreferrer"><MapPinIcon />สถานที่ทำงาน</a>
    </Button>
  );
}
