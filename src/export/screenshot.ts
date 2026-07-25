import { openCanvasVideoSource } from "./canvasVideoSource";

export type ScreenshotOptions = {
  requestFrame?: () => void;
};

export async function saveCanvasPng(
  canvases: HTMLCanvasElement[],
  options: ScreenshotOptions = {},
): Promise<string> {
  const canvas = await composeCanvases(canvases, options);
  const blob = await canvasToBlob(canvas);
  const filename = `wordslime_${formatTimestamp(new Date())}.png`;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);

  return filename;
}

async function composeCanvases(
  canvases: HTMLCanvasElement[],
  options: ScreenshotOptions,
): Promise<HTMLCanvasElement> {
  const [base] = canvases;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!base || !context) {
    throw new Error("PNG export failed");
  }

  canvas.width = base.width;
  canvas.height = base.height;
  const source = await openCanvasVideoSource(base, 30, options.requestFrame);

  try {
    context.drawImage(source.video, 0, 0, canvas.width, canvas.height);

    for (const overlay of canvases.slice(1)) {
      context.drawImage(overlay, 0, 0, canvas.width, canvas.height);
    }
  } finally {
    source.close();
  }

  return canvas;
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
