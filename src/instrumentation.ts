import type { Instrumentation } from "next";

/** error ฝั่งเซิร์ฟเวอร์ที่ไม่ได้ดักไว้ -> แจ้งทางอีเมล (src/lib/alert.ts · ส่งเฉพาะเว็บจริง) */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { alertError } = await import("@/lib/alert");
  const message = err instanceof Error ? err.message : String(err);
  const digest = typeof err === "object" && err !== null && "digest" in err ? String((err as { digest: unknown }).digest) : undefined;
  await alertError({ where: `${request.method} ${request.path.split("?")[0]} (${context.routeType})`, message, digest });
};
