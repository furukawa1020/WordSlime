export type ActiveRecording = {
  stop(): void;
  done: Promise<string>;
};

export type RecordingOptions = {
  audioStream?: MediaStream;
};

const MAX_RECORDING_MS = 30_000;

export function startCanvasRecording(
  canvases: HTMLCanvasElement[],
  options: RecordingOptions = {},
): ActiveRecording {
  const [base] = canvases;

  if (!base || !("captureStream" in base) || typeof MediaRecorder === "undefined") {
    throw new Error("Recording is unavailable in this browser");
  }

  const captureCanvas = document.createElement("canvas");
  const captureContext = captureCanvas.getContext("2d");

  if (!captureContext) {
    throw new Error("Recording is unavailable in this browser");
  }

  captureCanvas.width = base.width;
  captureCanvas.height = base.height;

  let frameHandle = 0;
  const paint = () => {
    captureContext.clearRect(0, 0, captureCanvas.width, captureCanvas.height);

    for (const canvas of canvases) {
      captureContext.drawImage(canvas, 0, 0, captureCanvas.width, captureCanvas.height);
    }

    frameHandle = requestAnimationFrame(paint);
  };

  paint();

  const stream = captureCanvas.captureStream(60);
  const audioTracks =
    options.audioStream?.getAudioTracks().map((track) => track.clone()) ?? [];

  for (const track of audioTracks) {
    stream.addTrack(track);
  }

  const mimeType = selectMimeType();
  const recorder = new MediaRecorder(
    stream,
    mimeType ? { mimeType } : undefined,
  );
  const chunks: BlobPart[] = [];
  let stopped = false;
  let failed = false;
  let timeout = 0;

  const done = new Promise<string>((resolve, reject) => {
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) {
        chunks.push(event.data);
      }
    });

    recorder.addEventListener("error", () => {
      failed = true;
      cleanup();
      reject(new Error("Recording failed"));
    });

    recorder.addEventListener("stop", () => {
      cleanup();

      if (failed) {
        return;
      }

      const blob = new Blob(chunks, {
        type: recorder.mimeType || "video/webm",
      });
      const filename = `wordslime_${formatTimestamp(new Date())}.webm`;
      downloadBlob(blob, filename);
      resolve(filename);
    });
  });

  const stop = () => {
    if (stopped) {
      return;
    }

    stopped = true;
    if (recorder.state !== "inactive") {
      recorder.stop();
    }
  };

  try {
    recorder.start(250);
    timeout = window.setTimeout(stop, MAX_RECORDING_MS);
  } catch (error) {
    cleanup();
    throw error;
  }

  return {
    stop,
    done,
  };

  function cleanup(): void {
    cancelAnimationFrame(frameHandle);
    window.clearTimeout(timeout);
    stream.getTracks().forEach((track) => track.stop());
  }
}

function selectMimeType(): string {
  const candidates = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];

  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? "";
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
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
