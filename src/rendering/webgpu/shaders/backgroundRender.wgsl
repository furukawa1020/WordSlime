struct SimParams {
  frame: vec4f,
  pointer: vec4f,
  behavior: vec4f,
  extra: vec4f,
};

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@group(0) @binding(0) var<uniform> params: SimParams;

const POSITIONS = array<vec2f, 3>(
  vec2f(-1.0, -1.0),
  vec2f(3.0, -1.0),
  vec2f(-1.0, 3.0)
);

fn hash(point: vec2f) -> f32 {
  let p = fract(vec3f(point.xyx) * 0.1031);
  let q = p + dot(p, p.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

fn noise(point: vec2f) -> f32 {
  let cell = floor(point);
  let local = fract(point);
  let curve = local * local * (3.0 - 2.0 * local);
  let a = hash(cell);
  let b = hash(cell + vec2f(1.0, 0.0));
  let c = hash(cell + vec2f(0.0, 1.0));
  let d = hash(cell + vec2f(1.0, 1.0));
  return mix(mix(a, b, curve.x), mix(c, d, curve.x), curve.y);
}

fn fbm(point: vec2f) -> f32 {
  var value = 0.0;
  var amplitude = 0.5;
  var frequency = 1.0;

  for (var i = 0; i < 5; i = i + 1) {
    value += noise(point * frequency) * amplitude;
    amplitude *= 0.48;
    frequency *= 2.04;
  }

  return value;
}

fn palette(background: f32, shade: f32) -> vec3f {
  if (background < 0.5) {
    return mix(vec3f(0.008, 0.016, 0.022), vec3f(0.034, 0.052, 0.064), shade);
  }

  if (background < 1.5) {
    return mix(vec3f(0.82, 0.85, 0.80), vec3f(0.67, 0.73, 0.70), shade);
  }

  if (background < 2.5) {
    return mix(vec3f(0.012, 0.055, 0.064), vec3f(0.032, 0.118, 0.135), shade);
  }

  return mix(vec3f(0.68, 0.70, 0.65), vec3f(0.56, 0.61, 0.57), shade);
}

@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> VertexOut {
  let position = POSITIONS[vertex_index];
  var out: VertexOut;
  out.position = vec4f(position, 0.0, 1.0);
  out.uv = position * 0.5 + vec2f(0.5);
  return out;
}

@fragment
fn fs_main(input: VertexOut) -> @location(0) vec4f {
  let size = max(params.frame.zw, vec2f(1.0));
  let time = params.frame.y;
  let mode = params.behavior.x;
  let background = params.behavior.w;
  let uv = input.uv;
  let aspect = vec2f(size.x / size.y, 1.0);
  let centered = (uv - 0.5) * aspect;
  let pointer_uv = params.pointer.xy / size;
  let pointer_delta = (uv - pointer_uv) * aspect;
  let pointer_dist = length(pointer_delta);
  let pointer_active = params.pointer.z;
  let pointer_down = params.pointer.w;
  let pulse = params.extra.x;
  let vortex = params.extra.y;

  var flow = centered;
  flow += vec2f(
    sin(time * 0.18 + uv.y * 8.0),
    cos(time * 0.16 + uv.x * 7.0)
  ) * 0.045;

  if (mode > 0.5 && mode < 1.5) {
    flow += vec2f(-centered.y, centered.x) * 0.24;
  } else if (mode > 1.5 && mode < 2.5) {
    flow += vec2f(time * 0.05, -time * 0.025);
  } else if (mode > 2.5 && mode < 3.5) {
    flow += vec2f(
      sin(uv.x * 16.0 + time * 0.25),
      cos(uv.y * 15.0 - time * 0.18)
    ) * 0.075;
  } else if (mode > 3.5) {
    flow += vec2f(
      hash(floor(uv * 52.0 + time * 9.0)),
      hash(floor(uv * 48.0 - time * 8.0))
    ) * 0.08;
  }

  let cellular = fbm(flow * 4.6 + time * 0.035);
  let fine = fbm(flow * 17.0 - time * 0.06);
  let band = pow(1.0 - abs(sin((flow.x + flow.y) * 14.0 + time * 0.46)), 7.0);
  var shade = cellular * 0.75 + fine * 0.18 + band * 0.18;
  var mode_tint = vec3f(0.0);

  if (mode > 0.5 && mode < 1.5) {
    let orbit = abs(length(centered) - 0.28);
    let arc = pow(1.0 - min(orbit / 0.16, 1.0), 3.0);
    let sparks = step(0.965, hash(floor((uv + time * 0.015) * 44.0)));
    shade += arc * 0.32 + sparks * 0.22;
    mode_tint += vec3f(0.34, 0.22, 0.03) * arc + vec3f(0.02, 0.16, 0.22) * sparks;
  } else if (mode > 1.5 && mode < 2.5) {
    let plume = pow(1.0 - abs(uv.x - 0.5) / 0.42, 2.0) *
      smoothstep(1.0, 0.2, uv.y);
    let fog = fbm(vec2f(uv.x * 5.0 + time * 0.06, uv.y * 9.0 - time * 0.12));
    shade += plume * fog * 0.46;
    mode_tint += vec3f(0.04, 0.12, 0.3) * plume;
  } else if (mode > 2.5 && mode < 3.5) {
    let veins = pow(
      1.0 - abs(sin(atan2(centered.y, centered.x) * 7.0 + length(centered) * 21.0 - time * 0.42)),
      8.0
    );
    let roots = veins * smoothstep(0.62, 0.08, length(centered - vec2f(0.0, 0.18)));
    shade += roots * 0.48;
    mode_tint += vec3f(0.05, 0.38, 0.08) * roots;
  } else if (mode > 3.5) {
    let grid = step(0.965, fract(uv.x * 18.0 + time * 1.1)) +
      step(0.972, fract(uv.y * 11.0 - time * 0.9));
    let blocks = step(0.74, hash(floor(uv * vec2f(22.0, 13.0) + time * 5.0)));
    shade += grid * 0.2 + blocks * 0.16;
    mode_tint += vec3f(0.2, 0.02, 0.32) * grid + vec3f(0.0, 0.28, 0.34) * blocks;
  }

  if (pointer_active > 0.5) {
    let pressure = exp(-pointer_dist * mix(9.0, 5.8, pointer_down));
    shade += pressure * mix(0.28, 0.62, pointer_down);
  }

  if (pulse > 0.001) {
    let ring = 1.0 - min(abs(pointer_dist - 0.18) / 0.055, 1.0);
    shade += ring * pulse * 0.35;
  }

  if (vortex > 0.001) {
    let angle = atan2(pointer_delta.y, pointer_delta.x);
    let spiral = sin(angle * 5.0 - pointer_dist * 42.0 + time * 7.0);
    shade += max(0.0, spiral) * exp(-pointer_dist * 4.2) * vortex * 0.46;
  }

  let vignette = smoothstep(0.88, 0.16, length(centered));
  let base = palette(background, clamp(shade, 0.0, 1.0));
  let glow = vec3f(0.36, 0.85, 0.76) * band * 0.035;
  let color = base * (0.76 + vignette * 0.24) + glow + mode_tint;

  return vec4f(color, 1.0);
}
