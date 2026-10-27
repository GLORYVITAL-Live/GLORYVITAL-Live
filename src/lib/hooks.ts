"use client";

import { useSyncExternalStore } from "react";

// ---------- ค่าที่จำไว้ในเครื่อง ----------

/** หน้าเจ้าของ > ตาราง slot: มุมมองที่เลือกล่าสุด (อยู่ที่นี่ ไม่ใช่ใน SlotWorkspace เพื่อให้หน้านั้นโหลดแยกได้) */
export const SLOT_VIEW_KEY = "glory_slot_view";
/** หน้าที่เปิดอยู่ (App.tsx) — หน้าอื่นสั่งเปลี่ยนหน้าได้ด้วย writeLocal(PAGE_KEY, "training") */
export const PAGE_KEY = "glory_booking_role";

export function readLocal(key: string) {
  try { return localStorage.getItem(key); } catch { return null; }
}
export function writeLocal(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch {}
  window.dispatchEvent(new Event("glory-local"));
}

function subscribeLocal(cb: () => void) {
  window.addEventListener("glory-local", cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener("glory-local", cb);
    window.removeEventListener("storage", cb);
  };
}

/** ค่าใน localStorage แบบ reactive (ฝั่ง server / ตอน hydrate ใช้ค่า null) */
export function useLocal(key: string) {
  return useSyncExternalStore(subscribeLocal, () => readLocal(key), () => null);
}

const noopSubscribe = () => () => {};
/** true เมื่อทำงานใน browser แล้ว (false ตอน render ฝั่ง server และตอน hydrate) */
export function useIsHydrated() {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

function subscribeTheme(cb: () => void) {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => obs.disconnect();
}

/** ธีมมืดอยู่หรือไม่ (อ่านจาก class "dark" ที่ <html>) */
export function useIsDark() {
  return useSyncExternalStore(subscribeTheme, () => document.documentElement.classList.contains("dark"), () => false);
}
