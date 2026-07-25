export type CanvasVideoSource = {
  video: HTMLVideoElement;
  close(): void;
};

export async function openCanvasVideoSource(
  canvas: HTMLCanvasElement,
  frameRate = 60,
  requestFrame?: () => void,
): Promise<CanvasVideoSource> {
  if (typeof canvas.captureStream !== "function") {
    throw new Error("Canvas capture is unavailable");
  }

  const stream = canvas.captureStream(frameRate);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;

  try {
    const playback = video.play();
    requestFrame?.();
    await playback;
    requestFrame?.();
    await waitForVideoFrame(video);
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    video.srcObject = null;
    throw error;
  }

  return {
    video,
    close() {
      stream.getTracks().forEach((track) => track.stop());
      video.pause();
      video.srcObject = null;
    },
  };
}

function waitForVideoFrame(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve, reject) => {
    let frameCallback = 0;
    const timeout = window.setTimeout(() => {
      video.cancelVideoFrameCallback(frameCallback);
      reject(new Error("Canvas capture timed out"));
    }, 2000);

    const finish = () => {
      window.clearTimeout(timeout);
      resolve();
    };

    frameCallback = video.requestVideoFrameCallback(() => finish());
  });
}
