export type InteractionSignal = {
  x: number;
  y: number;
  active: boolean;
  down: boolean;
  pulse: number;
  vortex: number;
  dragX: number;
  dragY: number;
};

type Ripple = {
  x: number;
  y: number;
  age: number;
  life: number;
  radius: number;
  strength: number;
  kind: "tap" | "vortex" | "pinch";
};

type Trail = {
  x: number;
  y: number;
  previousX: number;
  previousY: number;
  age: number;
  life: number;
  width: number;
};

type Spark = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  radius: number;
};

const maxTrails = 90;
const maxRipples = 18;
const maxSparks = 180;

export class InteractionLayer {
  private readonly context: CanvasRenderingContext2D;
  private frameHandle = 0;
  private lastTime = performance.now();
  private pointer: InteractionSignal | undefined;
  private trails: Trail[] = [];
  private ripples: Ripple[] = [];
  private sparks: Spark[] = [];

  constructor(private readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext("2d", { alpha: true });

    if (!context) {
      throw new Error("Interaction canvas unavailable");
    }

    this.context = context;
    this.resize();
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    this.clear();
  }

  interact(signal: InteractionSignal): void {
    const mapped = this.mapSignal(signal);
    const drag = Math.hypot(mapped.dragX, mapped.dragY);

    this.pointer = mapped.active ? mapped : undefined;

    if (drag > 1.2) {
      this.trails.push({
        x: mapped.x,
        y: mapped.y,
        previousX: mapped.x - mapped.dragX,
        previousY: mapped.y - mapped.dragY,
        age: 0,
        life: 0.62,
        width: Math.min(38, 10 + drag * 0.45),
      });
      this.trails = this.trails.slice(-maxTrails);
      this.emitSparks(mapped.x, mapped.y, mapped.dragX, mapped.dragY, Math.min(8, Math.ceil(drag / 14)));
    }

    if (mapped.pulse > 0.001) {
      this.addRipple(mapped.x, mapped.y, "tap", 220 + mapped.pulse * 90, mapped.pulse);
      this.emitSparks(mapped.x, mapped.y, 0, -18, 22);
    }

    if (mapped.vortex > 0.001) {
      this.addRipple(mapped.x, mapped.y, "vortex", 330, mapped.vortex);
      this.emitVortexSparks(mapped.x, mapped.y);
    }

    this.start();
  }

  showDensityPulse(scaleFactor: number): void {
    const pointer = this.pointer;

    if (!pointer) {
      return;
    }

    this.addRipple(
      pointer.x,
      pointer.y,
      "pinch",
      scaleFactor >= 1 ? 390 : 180,
      scaleFactor >= 1 ? 0.7 : 0.42,
    );
    this.start();
  }

  clear(): void {
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  destroy(): void {
    cancelAnimationFrame(this.frameHandle);
    this.frameHandle = 0;
    this.trails = [];
    this.ripples = [];
    this.sparks = [];
    this.pointer = undefined;
    this.clear();
  }

  private start(): void {
    if (this.frameHandle !== 0) {
      return;
    }

    this.lastTime = performance.now();
    this.frameHandle = requestAnimationFrame(this.frame);
  }

  private readonly frame = (now: number): void => {
    const dt = Math.min(0.033, Math.max(0, (now - this.lastTime) / 1000));
    this.lastTime = now;
    this.clear();
    this.drawPointerField(now / 1000);
    this.drawTrails(dt);
    this.drawRipples(dt, now / 1000);
    this.drawSparks(dt);

    if (this.hasWork()) {
      this.frameHandle = requestAnimationFrame(this.frame);
    } else {
      this.frameHandle = 0;
      this.clear();
    }
  };

  private hasWork(): boolean {
    return (
      this.trails.length > 0 ||
      this.ripples.length > 0 ||
      this.sparks.length > 0 ||
      Boolean(this.pointer?.active)
    );
  }

  private drawPointerField(time: number): void {
    const pointer = this.pointer;

    if (!pointer) {
      return;
    }

    const context = this.context;
    const pulse = 0.5 + Math.sin(time * 8) * 0.5;
    const radius = pointer.down ? 130 + pulse * 34 : 78 + pulse * 18;
    const gradient = context.createRadialGradient(
      pointer.x,
      pointer.y,
      0,
      pointer.x,
      pointer.y,
      radius,
    );
    gradient.addColorStop(0, pointer.down ? "rgba(185, 255, 228, 0.18)" : "rgba(145, 231, 255, 0.13)");
    gradient.addColorStop(0.45, pointer.down ? "rgba(86, 170, 150, 0.08)" : "rgba(110, 185, 210, 0.05)");
    gradient.addColorStop(1, "rgba(0, 0, 0, 0)");

    context.save();
    context.globalCompositeOperation = "lighter";
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(pointer.x, pointer.y, radius, 0, Math.PI * 2);
    context.fill();

    if (pointer.down) {
      context.strokeStyle = "rgba(209, 255, 238, 0.28)";
      context.lineWidth = 1.4;
      context.setLineDash([6, 12]);
      context.lineDashOffset = -time * 36;
      context.beginPath();
      context.arc(pointer.x, pointer.y, 74 + pulse * 12, 0, Math.PI * 2);
      context.stroke();
      context.setLineDash([]);
      this.drawAttractorTendrils(pointer.x, pointer.y, time);
    }

    context.restore();
  }

  private drawAttractorTendrils(x: number, y: number, time: number): void {
    const context = this.context;

    context.save();
    context.globalCompositeOperation = "lighter";
    context.strokeStyle = "rgba(190, 255, 230, 0.19)";
    context.lineWidth = 1.2;

    for (let index = 0; index < 12; index += 1) {
      const angle = (index / 12) * Math.PI * 2 + time * 0.9;
      const outer = 120 + Math.sin(time * 2.4 + index) * 20;
      const inner = 28 + Math.cos(time * 3.2 + index) * 8;

      context.beginPath();
      context.moveTo(x + Math.cos(angle) * outer, y + Math.sin(angle) * outer);
      context.quadraticCurveTo(
        x + Math.cos(angle + 0.9) * 56,
        y + Math.sin(angle + 0.9) * 56,
        x + Math.cos(angle + 1.7) * inner,
        y + Math.sin(angle + 1.7) * inner,
      );
      context.stroke();
    }

    context.restore();
  }

  private drawTrails(dt: number): void {
    const context = this.context;

    context.save();
    context.globalCompositeOperation = "lighter";
    context.lineCap = "round";
    context.lineJoin = "round";

    this.trails = this.trails.filter((trail) => {
      trail.age += dt;
      const progress = trail.age / trail.life;

      if (progress >= 1) {
        return false;
      }

      const alpha = (1 - progress) * 0.28;
      context.strokeStyle = `rgba(140, 234, 255, ${alpha})`;
      context.shadowColor = `rgba(134, 255, 229, ${alpha * 1.6})`;
      context.shadowBlur = trail.width * 0.9;
      context.lineWidth = trail.width * (1 - progress * 0.6);
      context.beginPath();
      context.moveTo(trail.previousX, trail.previousY);
      context.quadraticCurveTo(
        (trail.previousX + trail.x) * 0.5,
        (trail.previousY + trail.y) * 0.5 - trail.width,
        trail.x,
        trail.y,
      );
      context.stroke();
      return true;
    });

    context.restore();
  }

  private drawRipples(dt: number, time: number): void {
    const context = this.context;

    context.save();
    context.globalCompositeOperation = "lighter";

    this.ripples = this.ripples.filter((ripple) => {
      ripple.age += dt;
      const progress = ripple.age / ripple.life;

      if (progress >= 1) {
        return false;
      }

      const alpha = (1 - progress) * ripple.strength;
      const radius = ripple.radius * easeOutCubic(progress);

      context.lineWidth = ripple.kind === "vortex" ? 2.4 : 1.6;
      context.strokeStyle =
        ripple.kind === "pinch"
          ? `rgba(229, 255, 190, ${alpha * 0.32})`
          : `rgba(177, 242, 255, ${alpha * 0.36})`;
      context.beginPath();
      context.arc(ripple.x, ripple.y, radius, 0, Math.PI * 2);
      context.stroke();

      if (ripple.kind === "vortex") {
        this.drawSpiral(ripple.x, ripple.y, radius, alpha, time);
      } else if (ripple.kind === "tap") {
        context.strokeStyle = `rgba(211, 255, 239, ${alpha * 0.2})`;
        context.beginPath();
        context.arc(ripple.x, ripple.y, radius * 0.58, 0, Math.PI * 2);
        context.stroke();
      }

      return true;
    });

    context.restore();
  }

  private drawSpiral(x: number, y: number, radius: number, alpha: number, time: number): void {
    const context = this.context;

    context.save();
    context.strokeStyle = `rgba(225, 255, 244, ${alpha * 0.26})`;
    context.lineWidth = 1.3;

    for (let arm = 0; arm < 3; arm += 1) {
      context.beginPath();

      for (let step = 0; step < 48; step += 1) {
        const unit = step / 47;
        const angle = unit * Math.PI * 3.4 + arm * ((Math.PI * 2) / 3) + time * 1.8;
        const localRadius = unit * radius * 0.72;
        const px = x + Math.cos(angle) * localRadius;
        const py = y + Math.sin(angle) * localRadius;

        if (step === 0) {
          context.moveTo(px, py);
        } else {
          context.lineTo(px, py);
        }
      }

      context.stroke();
    }

    context.restore();
  }

  private drawSparks(dt: number): void {
    const context = this.context;

    context.save();
    context.globalCompositeOperation = "lighter";

    this.sparks = this.sparks.filter((spark) => {
      spark.age += dt;

      if (spark.age >= spark.life) {
        return false;
      }

      spark.vx *= 0.986;
      spark.vy *= 0.986;
      spark.x += spark.vx * dt;
      spark.y += spark.vy * dt;

      const progress = spark.age / spark.life;
      const alpha = Math.sin(Math.PI * progress) * 0.42;
      context.fillStyle = `rgba(166, 243, 255, ${alpha})`;
      context.beginPath();
      context.arc(spark.x, spark.y, spark.radius * (1 - progress * 0.3), 0, Math.PI * 2);
      context.fill();
      return true;
    });

    context.restore();
  }

  private addRipple(
    x: number,
    y: number,
    kind: Ripple["kind"],
    radius: number,
    strength: number,
  ): void {
    this.ripples.push({
      x,
      y,
      kind,
      radius,
      strength,
      age: 0,
      life: kind === "vortex" ? 1.65 : 1.08,
    });
    this.ripples = this.ripples.slice(-maxRipples);
  }

  private emitSparks(
    x: number,
    y: number,
    dragX: number,
    dragY: number,
    count: number,
  ): void {
    const baseAngle = Math.atan2(dragY, dragX || 0.01);

    for (let index = 0; index < count; index += 1) {
      const angle = baseAngle + (Math.random() - 0.5) * Math.PI * 1.35;
      const speed = 28 + Math.random() * 160;
      this.sparks.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        age: 0,
        life: 0.4 + Math.random() * 0.52,
        radius: 0.8 + Math.random() * 2.8,
      });
    }

    this.sparks = this.sparks.slice(-maxSparks);
  }

  private emitVortexSparks(x: number, y: number): void {
    for (let index = 0; index < 46; index += 1) {
      const angle = (index / 46) * Math.PI * 2;
      const speed = 52 + Math.random() * 160;
      this.sparks.push({
        x: x + Math.cos(angle) * (12 + Math.random() * 42),
        y: y + Math.sin(angle) * (12 + Math.random() * 42),
        vx: Math.cos(angle + Math.PI * 0.52) * speed,
        vy: Math.sin(angle + Math.PI * 0.52) * speed,
        age: 0,
        life: 0.62 + Math.random() * 0.5,
        radius: 1 + Math.random() * 3,
      });
    }

    this.sparks = this.sparks.slice(-maxSparks);
  }

  private mapSignal(signal: InteractionSignal): InteractionSignal {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / Math.max(rect.width, 1);
    const scaleY = this.canvas.height / Math.max(rect.height, 1);

    return {
      ...signal,
      x: signal.x * scaleX,
      y: signal.y * scaleY,
      dragX: signal.dragX * scaleX,
      dragY: signal.dragY * scaleY,
    };
  }
}

function easeOutCubic(value: number): number {
  return 1 - (1 - value) ** 3;
}
