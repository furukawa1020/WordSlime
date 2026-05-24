export async function saveCanvasPng(canvas: HTMLCanvasElement): Promise<string> {
  const blob = await canvasToBlob(canvas);
  const filename = `wordslime_${formatTimestamp(new Date())}.png`;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);

  return filename;
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("PNG export failed"));
      }
    }, "image/png");
  });
}

function formatTimestamp(date: Date): string {
  const yyyy = date.getFullYear().toString();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const mi = pad(date.getMinutes());
  const ss = pad(date.getSeconds());

  return `${yyyy}${mm}${dd}_${hh}${mi}${ss}`;
}

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}
