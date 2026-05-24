export type WebGpuDevice = {
  adapter: GPUAdapter;
  device: GPUDevice;
  context: GPUCanvasContext;
  format: GPUTextureFormat;
};

export async function createWebGpuDevice(
  canvas: HTMLCanvasElement,
): Promise<WebGpuDevice> {
  if (!navigator.gpu) {
    throw new Error("WebGPU unavailable");
  }

  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: "high-performance",
  });

  if (!adapter) {
    throw new Error("WebGPU adapter unavailable");
  }

  const device = await adapter.requestDevice();
  const context = canvas.getContext("webgpu");

  if (!context) {
    throw new Error("WebGPU canvas context unavailable");
  }

  const format = navigator.gpu.getPreferredCanvasFormat();
  configureCanvas(context, device, format);

  return {
    adapter,
    device,
    context,
    format,
  };
}

export function configureCanvas(
  context: GPUCanvasContext,
  device: GPUDevice,
  format: GPUTextureFormat,
): void {
  context.configure({
    device,
    format,
    alphaMode: "premultiplied",
  });
}
