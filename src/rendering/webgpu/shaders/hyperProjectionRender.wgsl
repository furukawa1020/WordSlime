struct SimParams {
  frame: vec4f,
  pointer: vec4f,
  behavior: vec4f,
  extra: vec4f,
  signature: vec4f,
  glyphs: vec4f,
  signal: vec4f,
  reservoir: vec4f,
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

const TAU = 6.28318530718;

fn hash(point: vec2f) -> f32 {
  let p = fract(vec3f(point.xyx) * 0.1031);
  let q = p + dot(p, p.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

fn rotate2(point: vec2f, angle: f32) -> vec2f {
  let c = cos(angle);
  let s = sin(angle);
  return vec2f(point.x * c - point.y * s, point.x * s + point.y * c);
}

fn smooth_min(a: f32, b: f32, k: f32) -> f32 {
  let h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

fn segment_distance(point: vec2f, a: vec2f, b: vec2f) -> f32 {
  let pa = point - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / max(dot(ba, ba), 0.0001), 0.0, 1.0);
  return length(pa - ba * h);
}

fn scene_sdf(
  position: vec3f,
  time: f32,
  signature: vec4f,
  glyphs: vec4f,
  reservoir: vec4f,
) -> f32 {
  var point = position;
  let xy = rotate2(point.xy, time * (0.21 + signature.z * 0.36) + glyphs.y * 2.4);
  point = vec3f(xy.x, xy.y, point.z);
  let xz = rotate2(point.xz, time * (0.16 + reservoir.z * 0.28) + glyphs.w * 1.7);
  point = vec3f(xz.x, point.y, xz.y);
  let yz = rotate2(point.yz, time * (0.12 + signature.w * 0.25));
  point = vec3f(point.x, yz.x, yz.y);

  let body_radius = 0.44 + signature.y * 0.18 + glyphs.x * 0.1 + reservoir.w * 0.08;
  var distance = length(point * vec3f(0.92, 1.08, 0.86)) - body_radius;

  for (var index = 0; index < 5; index = index + 1) {
    let fi = f32(index);
    let phase = time * (0.48 + signature.z * 0.58) + fi * 1.91 + glyphs.y * 3.2;
    let lobe_center = vec3f(
      sin(phase + reservoir.x * TAU),
      cos(phase * 0.83 + glyphs.w * 2.0),
      sin(phase * 1.17 + signature.x * TAU)
    ) * (0.22 + glyphs.y * 0.12 + reservoir.w * 0.16);
    let lobe_radius =
      0.14 + signature.w * 0.06 + glyphs.z * 0.04 +
      hash(vec2f(fi, signature.x + glyphs.w)) * 0.035;
    distance = smooth_min(distance, length(point - lobe_center) - lobe_radius, 0.17 + glyphs.w * 0.08);
  }

  let shell_radius = 0.82 + glyphs.w * 0.14 + reservoir.w * 0.12;
  let shell = abs(length(point) - shell_radius) - (0.008 + glyphs.z * 0.012);
  return smooth_min(distance, shell, 0.08);
}

fn scene_normal(
  position: vec3f,
  time: f32,
  signature: vec4f,
  glyphs: vec4f,
  reservoir: vec4f,
) -> vec3f {
  let eps = 0.006;
  let center = scene_sdf(position, time, signature, glyphs, reservoir);
  let dx = scene_sdf(position + vec3f(eps, 0.0, 0.0), time, signature, glyphs, reservoir) - center;
  let dy = scene_sdf(position + vec3f(0.0, eps, 0.0), time, signature, glyphs, reservoir) - center;
  let dz = scene_sdf(position + vec3f(0.0, 0.0, eps), time, signature, glyphs, reservoir) - center;
  return normalize(vec3f(dx, dy, dz) + vec3f(0.0001));
}

fn bit_sign(id: u32, bit: u32) -> f32 {
  if ((id & (1u << bit)) == 0u) {
    return -1.0;
  }

  return 1.0;
}

fn rotate4(point: vec4f, time: f32, signature: vec4f, glyphs: vec4f, seed_hash: f32) -> vec4f {
  var p = point;
  let xw = rotate2(p.xw, time * (0.33 + signature.z * 0.55) + seed_hash * TAU);
  p = vec4f(xw.x, p.y, p.z, xw.y);
  let yz = rotate2(p.yz, time * (0.27 + glyphs.y * 0.4) + glyphs.w * 2.2);
  p = vec4f(p.x, yz.x, yz.y, p.w);
  let zw = rotate2(p.zw, time * (0.19 + signature.w * 0.34) + signature.x * 1.7);
  p = vec4f(p.x, p.y, zw.x, zw.y);
  return p;
}

fn hyper_vertex(id: u32, time: f32, signature: vec4f, glyphs: vec4f, seed_hash: f32) -> vec4f {
  let raw = vec4f(
    bit_sign(id, 0u),
    bit_sign(id, 1u),
    bit_sign(id, 2u),
    bit_sign(id, 3u)
  );
  return rotate4(raw * (0.56 + glyphs.x * 0.12), time, signature, glyphs, seed_hash);
}

fn project_hyper(point: vec4f, aspect: vec2f, depth_bias: f32) -> vec2f {
  let w_perspective = 1.35 / (2.28 - point.w * 0.42);
  let p3 = point.xyz * w_perspective;
  let z_perspective = 1.18 / (2.34 - p3.z * 0.48 + depth_bias);
  return p3.xy * z_perspective * vec2f(1.0 / aspect.x, 1.0);
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
  let raw_time = params.frame.y;
  let reduce_motion = params.behavior.y;
  let time = raw_time * mix(1.0, 0.32, reduce_motion);
  let mode = params.behavior.x;
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
  let signature = params.signature;
  let glyphs = params.glyphs;
  let signal = params.signal;
  let reservoir = params.reservoir;
  let spawn_age = signal.x;
  let seed_hash = signal.y;
  let draft_strength = signal.z;
  let draft_hash = signal.w;
  let input_live = smoothstep(0.0, 0.02, signature.x + glyphs.x + reservoir.w + draft_strength);
  let spawn_impulse = exp(-spawn_age * (1.18 + signature.z * 0.62 + glyphs.z * 0.72)) * input_live;
  let memory_live = smoothstep(0.015, 0.32, reservoir.w);
  let dimensional_gain = clamp(
    0.18 + input_live * 0.42 + spawn_impulse * 0.68 + draft_strength * 0.5 + memory_live * 0.34,
    0.0,
    1.35
  );

  let camera_spin = seed_hash * TAU + time * (0.08 + signature.z * 0.12);
  let camera_offset = vec2f(sin(camera_spin), cos(camera_spin * 1.21)) * (0.08 + glyphs.w * 0.06);
  let ro = vec3f(camera_offset.x, camera_offset.y, 2.85 - spawn_impulse * 0.42 - draft_strength * 0.24);
  let rd = normalize(vec3f(centered * (1.05 + glyphs.x * 0.12), -1.72));

  var color = vec3f(0.0);
  var alpha = 0.0;
  let pop_center = vec2f(
    sin(seed_hash * TAU + time * 0.17) * 0.03,
    cos(seed_hash * TAU * 1.37 + time * 0.11) * 0.025
  );
  let pop_delta = centered - pop_center;
  let pop_depth = length(pop_delta * vec2f(1.0, 0.72));
  let pop_radius = 0.42 + glyphs.x * 0.12 + reservoir.w * 0.08 + spawn_impulse * 0.05;
  let pop_volume = pow(max(0.0, 1.0 - pop_depth / pop_radius), 2.4);
  let pop_rim = 1.0 - smoothstep(0.0, 0.055 + glyphs.z * 0.02, abs(pop_depth - pop_radius * 0.72));
  let pop_back_rim = 1.0 - smoothstep(0.0, 0.045, abs(pop_depth - pop_radius * 1.08));
  let pop_scan = pow(
    max(0.0, sin((pop_delta.x - pop_delta.y * 0.42) * (48.0 + glyphs.w * 30.0) - time * (2.1 + signature.z))),
    10.0
  );
  color += vec3f(0.03, 0.45, 0.38) * pop_volume * dimensional_gain * 0.32;
  color += vec3f(0.52, 1.0, 0.9) * pop_rim * dimensional_gain * (0.2 + signature.x * 0.14);
  color += vec3f(0.9, 0.16, 1.0) * pop_back_rim * dimensional_gain * (0.08 + glyphs.z * 0.08);
  color += vec3f(0.18, 0.95, 1.0) * pop_scan * pop_volume * dimensional_gain * 0.12;
  alpha = max(alpha, clamp((pop_volume * 0.18 + pop_rim * 0.36 + pop_back_rim * 0.12) * dimensional_gain, 0.0, 0.64));
  var ray_t = 0.0;
  var hit_position = ro;
  var hit = false;

  for (var step_index = 0; step_index < 38; step_index = step_index + 1) {
    hit_position = ro + rd * ray_t;
    let distance = scene_sdf(hit_position, time + draft_hash * 3.0, signature, glyphs, reservoir);

    if (abs(distance) < 0.0065) {
      hit = true;
      break;
    }

    ray_t += max(distance * 0.72, 0.014);

    if (ray_t > 5.2) {
      break;
    }
  }

  if (hit) {
    let normal = scene_normal(hit_position, time + draft_hash * 3.0, signature, glyphs, reservoir);
    let light_dir = normalize(vec3f(-0.34, 0.64, 0.68));
    let rim = pow(1.0 - clamp(dot(normal, -rd), 0.0, 1.0), 3.0);
    let diffuse = max(0.0, dot(normal, light_dir));
    let depth_fade = exp(-ray_t * 0.24);
    let inner = 0.45 + signature.x * 0.35 + glyphs.z * 0.16;
    let slime_color = mix(
      vec3f(0.08, 0.94, 0.74),
      vec3f(0.75, 1.0, 0.92),
      diffuse * 0.55 + rim * 0.28
    );
    let glitch_tint = vec3f(0.92, 0.08, 1.0) * step(3.5, mode) * (0.12 + glyphs.z * 0.18);
    color += (slime_color * (0.22 + diffuse * 0.52) + vec3f(0.2, 0.9, 1.0) * rim * inner + glitch_tint) *
      dimensional_gain * depth_fade;
    alpha = max(alpha, clamp((0.2 + rim * 0.4 + diffuse * 0.18) * dimensional_gain, 0.0, 0.74));
  }

  var wire = 0.0;
  var wire_color = vec3f(0.0);
  let hyper_center = pop_center;
  let wire_width = 0.0055 + glyphs.z * 0.0035 + spawn_impulse * 0.004;
  let depth_bias = -spawn_impulse * 0.44 - draft_strength * 0.18;

  for (var vertex_id = 0u; vertex_id < 16u; vertex_id = vertex_id + 1u) {
    for (var axis = 0u; axis < 4u; axis = axis + 1u) {
      let other_id = vertex_id ^ (1u << axis);

      if (other_id > vertex_id) {
        let a4 = hyper_vertex(vertex_id, time + draft_hash * 4.0, signature, glyphs, seed_hash);
        let b4 = hyper_vertex(other_id, time + draft_hash * 4.0, signature, glyphs, seed_hash);
        let a = project_hyper(a4, aspect, depth_bias) + hyper_center;
        let b = project_hyper(b4, aspect, depth_bias) + hyper_center;
        let distance = segment_distance(centered, a, b);
        let edge = smoothstep(wire_width * 2.5, 0.0, distance);
        let axis_mix = f32(axis) / 3.0;

        wire += edge;
        wire_color += edge * mix(
          vec3f(0.08, 0.92, 1.0),
          vec3f(1.0, 0.12, 0.78),
          axis_mix * 0.75 + glyphs.w * 0.18
        );
      }
    }
  }

  let wire_alpha = clamp(wire * (0.08 + dimensional_gain * 0.13), 0.0, 0.56);
  color += wire_color * (0.18 + dimensional_gain * 0.16);
  alpha = max(alpha, wire_alpha);

  if (pointer_active > 0.5) {
    let pop = exp(-pointer_dist * mix(7.2, 5.0, pointer_down));
    let ring = 1.0 - min(abs(pointer_dist - (0.16 + pulse * 0.09)) / 0.05, 1.0);
    color += vec3f(0.68, 1.0, 0.88) * pop * (0.22 + pointer_down * 0.28);
    color += vec3f(0.96, 0.18, 0.9) * max(0.0, ring) * (pulse + vortex * 0.35);
    alpha = max(alpha, pop * 0.22 + max(0.0, ring) * pulse * 0.3);
  }

  let vignette = smoothstep(0.92, 0.2, length(centered));
  alpha *= vignette;
  color *= vignette;

  return vec4f(color, clamp(alpha, 0.0, 0.82));
}
