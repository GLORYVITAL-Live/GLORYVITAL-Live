import type { Instrumentation } from "next";

/**
 * เริ่มเซิร์ฟเวอร์: รอบงานทุก 15 นาที (src/lib/cron-timer.ts) เฉพาะเว็บจริงบน Render
 *   ไม่เริ่มบน localhost / ตอน build / เว็บทดสอบของ PR (กันแจ้งเตือนจริงซ้ำจากหลายที่)
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.RENDER !== "true" || process.env.IS_PULL_REQUEST === "true" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { startCronTimer } = await import("@/lib/cron-timer");
  startCronTimer();
}

/** error ฝั่งเซิร์ฟเวอร์ที่ไม่ได้ดักไว้ -> แจ้งทางอีเมล (src/lib/alert.ts · ส่งเฉพาะเว็บจริง) */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { alertError } = await import("@/lib/alert");
  const message = err instanceof Error ? err.message : String(err);
  const digest = typeof err === "object" && err !== null && "digest" in err ? String((err as { digest: unknown }).digest) : undefined;
  await alertError({ where: `${request.method} ${request.path.split("?")[0]} (${context.routeType})`, message, digest });
};
