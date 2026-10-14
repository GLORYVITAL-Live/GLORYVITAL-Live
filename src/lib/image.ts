/** ย่อรูปในเครื่อง (browser) ให้กว้างไม่เกิน maxWidth px เป็น JPG — ตัวหนังสือในรูปยังอ่านได้ ไฟล์เล็กลงมาก */
export async function shrinkImage(file: File, maxWidth = 1600): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("เปิดรูปนี้ไม่ได้ ลองใช้ไฟล์ JPG หรือ PNG"));
      el.src = url;
    });
    const scale = Math.min(1, maxWidth / img.naturalWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob) throw new Error("ย่อรูปไม่สำเร็จ");
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}
