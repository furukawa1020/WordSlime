struct SimParams {
  frame: vec4f,
  pointer: vec4f,
  behavior: vec4f,
  extra: vec4f,
  signature: vec4f,
  glyphs: vec4f,
  signal: vec4f,
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

  for (var index = 0; index < 4; index = index + 1) {
    value += noise(point * frequency) * amplitude;
    amplitude *= 0.5;
    frequency *= 2.08;
  }

  return value;
}

fn line_band(value: f32, line_center: f32, width: f32) -> f32 {
  return 1.0 - smoothstep(0.0, width, abs(value - line_center));
}

fn circle_line(distance: f32, radius: f32, width: f32) -> f32 {
  return 1.0 - smoothstep(0.0, width, abs(distance - radius));
}

fn signature_metric(row: f32, signature: vec4f, glyphs: vec4f) -> f32 {
  var value = glyphs.w;

  if (row < 0.5) {
    value = signature.x;
  } else if (row < 1.5) {
    value = signature.y;
  } else if (row < 2.5) {
    value = signature.z;
  } else if (row < 3.5) {
    value = signature.w;
  } else if (row < 4.5) {
    value = glyphs.x;
  } else if (row < 5.5) {
    value = glyphs.y;
  } else if (row < 6.5) {
    value = glyphs.z;
  }

  return clamp(value, 0.0, 1.0);
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
  let particle_count = params.behavior.z;
  let uv = input.uv;
  let aspect = vec2f(size.x / size.y, 1.0);
  let centered = (uv - 0.5) * aspect;
  let pointer_uv = params.pointer.xy / size;
  let pointer_delta = (uv - pointer_uv) * aspect;
  let pointer_dist = length(pointer_delta);
  let pointer_active = params.pointer.z;
  let pulse = params.extra.x;
  let vortex = params.extra.y;
  let signature = params.signature;
  let glyphs = params.glyphs;
  let signal = params.signal;
  let input_live = smoothstep(0.0, 0.02, signature.x + glyphs.x);
  let energy = signature.x;
  let viscosity = signature.y;
  let turbulence = signature.z;
  let fertility = signature.w;
  let length_pressure = glyphs.x;
  let repeat_pressure = glyphs.y;
  let symbol_pressure = glyphs.z;
  let glyph_complexity = glyphs.w;
  let spawn_age = signal.x;
  let seed_hash = signal.y;
  let spawn_impulse = exp(-spawn_age * (1.35 + turbulence * 0.55 + symbol_pressure * 0.7)) * input_live;
  var color = vec3f(0.0);
  var alpha = 0.0;

  if (mode < 0.5) {
    let warped = centered + vec2f(
      sin(centered.y * 8.0 + time * 0.4),
      cos(centered.x * 7.0 - time * 0.32)
    ) * 0.035;
    let blob =
      length(warped * vec2f(0.9, 1.18)) -
      (0.22 + viscosity * 0.06 + length_pressure * 0.05 + fbm(warped * (4.2 + glyph_complexity * 2.0) + time * 0.08) * 0.12);
    let membrane = 1.0 - smoothstep(0.0, 0.038, abs(blob));
    let inner = smoothstep(0.05, -0.12, blob);
    let pore = circle_line(length(warped - vec2f(0.1, -0.04)), 0.09, 0.022);
    let sheen = pow(max(0.0, 1.0 - length(centered - vec2f(-0.1, -0.14)) / 0.52), 3.0);
    color = vec3f(0.28, 0.95, 0.8) * membrane + vec3f(0.08, 0.38, 0.32) * inner + vec3f(0.65, 1.0, 0.95) * sheen * (0.18 + energy * 0.16);
    alpha = clamp(membrane * 0.5 + inner * 0.13 - pore * 0.22 + sheen * 0.08, 0.0, 0.58);
  } else if (mode < 1.5) {
    let distance = length(centered);
    let angle = atan2(centered.y, centered.x);
    let orbit1 = circle_line(distance, 0.27, 0.018);
    let orbit2 = circle_line(distance, 0.39 + sin(time * 0.3) * 0.025, 0.014);
    let arc = pow(max(0.0, sin(angle * (3.0 + glyph_complexity * 5.0) - time * (1.0 + energy * 1.4))), 12.0) * circle_line(distance, 0.32, 0.09 + repeat_pressure * 0.04);
    let cells = floor((uv + vec2f(time * (0.018 + turbulence * 0.022), -time * 0.01)) * vec2f(38.0 + glyphs.x * 18.0, 22.0 + glyph_complexity * 10.0));
    let spark = step(0.984 - symbol_pressure * 0.08, hash(cells)) * smoothstep(0.74, 0.12, distance);
    color = vec3f(0.98, 0.73, 0.16) * (orbit1 + arc) + vec3f(0.15, 0.82, 1.0) * (orbit2 * 0.55 + spark);
    alpha = clamp(orbit1 * 0.36 + orbit2 * 0.2 + arc * 0.34 + spark * 0.34, 0.0, 0.62);
  } else if (mode < 2.5) {
    let plume = smoothstep(0.86 + viscosity * 0.12, 0.18, abs(uv.x - 0.5)) * smoothstep(1.0, 0.28, uv.y);
    let layer1 = fbm(vec2f(uv.x * 5.0 + time * 0.06, uv.y * 9.0 - time * 0.15));
    let layer2 = fbm(vec2f(uv.x * 12.0 - time * 0.03, uv.y * 5.2 + time * 0.08));
    let vapor = plume * smoothstep(0.38 - turbulence * 0.08, 0.86, layer1) * (0.45 + layer2 * 0.55);
    let underglow = pow(max(0.0, 1.0 - abs(uv.y - 0.76) / 0.28), 2.0) * plume;
    color = vec3f(0.13, 0.32, 0.92) * vapor + vec3f(0.1, 0.78, 0.95) * underglow * 0.18;
    alpha = clamp(vapor * 0.26 + underglow * 0.08, 0.0, 0.46);
  } else if (mode < 3.5) {
    let root = vec2f(0.0, 0.22);
    let rel = centered - root;
    let distance = length(rel);
    let angle = atan2(rel.y, rel.x);
    let branch_a = pow(1.0 - abs(sin(angle * (6.0 + fertility * 5.0) + distance * 17.0 - time * 0.28)), 8.0);
    let branch_b = pow(1.0 - abs(sin(angle * (11.0 + glyph_complexity * 7.0) - distance * (24.0 + repeat_pressure * 16.0) + time * 0.18)), 11.0);
    let reach = smoothstep(0.7, 0.05, distance);
    let nodes = step(0.982, hash(floor((rel + 0.7) * 23.0))) * reach;
    let vein = (branch_a * 0.7 + branch_b * 0.42) * reach;
    color = vec3f(0.1, 0.95, 0.28) * vein + vec3f(0.86, 0.18, 0.7) * nodes;
    alpha = clamp(vein * 0.32 + nodes * 0.42, 0.0, 0.58);
  } else {
    let grid_x = line_band(fract(uv.x * 18.0 + time * 0.24), 0.02, 0.018);
    let grid_y = line_band(fract(uv.y * 11.0 - time * 0.18), 0.02, 0.016);
    let scan = step(0.82, fract(uv.y * 94.0 + time * 19.0));
    let block_cell = floor(uv * vec2f(28.0, 15.0) + vec2f(time * 4.0, -time * 2.0));
    let block = step(0.78 - symbol_pressure * 0.16, hash(block_cell));
    let tear = pow(max(0.0, sin((uv.x + fbm(uv * (8.0 + glyph_complexity * 7.0))) * (40.0 + turbulence * 28.0) + time * (8.0 + energy * 7.0))), 18.0);
    color = vec3f(0.02, 0.95, 1.0) * (grid_x + block * 0.7) +
      vec3f(0.88, 0.08, 1.0) * (grid_y + scan * 0.36 + tear * 0.4);
    alpha = clamp(grid_x * 0.32 + grid_y * 0.28 + block * 0.22 + scan * 0.12 + tear * 0.22, 0.0, 0.62);
  }

  if (pointer_active > 0.5) {
    let pressure = exp(-pointer_dist * 8.0);
    color += vec3f(0.8, 1.0, 0.9) * pressure * (0.16 + pulse * 0.32 + vortex * 0.18);
    alpha = max(alpha, pressure * 0.2);
  }

  let workgroups = max(1.0, ceil(particle_count / 64.0));
  let wg_cells = floor(uv * vec2f(32.0, 18.0));
  let wg_id = wg_cells.x + wg_cells.y * 32.0;
  let wg_active = step(wg_id, workgroups);
  let cell_uv = fract(uv * vec2f(32.0, 18.0));
  let cell_edge = max(
    1.0 - smoothstep(0.0, 0.035, min(cell_uv.x, 1.0 - cell_uv.x)),
    1.0 - smoothstep(0.0, 0.035, min(cell_uv.y, 1.0 - cell_uv.y))
  );
  let tick = step(0.94, hash(wg_cells + floor(time * 9.0)));
  let bit = step(0.78, hash(wg_cells + vec2f(floor(time * 5.0), particle_count * 0.001)));
  let lane = step(0.988, fract(uv.y * 64.0 - time * 2.4));
  let address_scan = pow(max(0.0, 1.0 - abs(fract(uv.x * 8.0 + time * 0.18) - 0.5) * 2.0), 22.0);
  let grid_alpha = wg_active * cell_edge * 0.055 + tick * bit * wg_active * 0.11 + lane * 0.035 + address_scan * 0.04;
  color += vec3f(0.1, 0.95, 0.78) * grid_alpha;
  alpha = max(alpha, grid_alpha);

  let analyzer_zone = input_live * step(uv.x, 0.22) * step(0.11, uv.y) * step(uv.y, 0.89);
  let analyzer_row = floor((uv.y - 0.11) / 0.095);
  let analyzer_row_uv = fract((uv.y - 0.11) / 0.095);
  let metric = signature_metric(analyzer_row, signature, glyphs);
  let analyzer_bar =
    analyzer_zone *
    step(0.028, uv.x) *
    step(uv.x, 0.035 + metric * 0.17) *
    step(0.18, analyzer_row_uv) *
    step(analyzer_row_uv, 0.72);
  let analyzer_tick =
    analyzer_zone *
    step(0.88, hash(vec2f(analyzer_row, floor(uv.x * 92.0) + floor(time * 8.0)))) *
    step(0.02, uv.x) *
    step(uv.x, 0.215) *
    step(0.12, analyzer_row_uv) *
    step(analyzer_row_uv, 0.82);
  color += vec3f(0.18, 1.0, 0.74) * analyzer_bar + vec3f(1.0, 0.2, 0.72) * analyzer_tick * symbol_pressure;
  alpha = max(alpha, analyzer_bar * 0.72 + analyzer_tick * 0.22);

  let matrix_zone = input_live * step(0.76, uv.x) * step(0.1, uv.y) * step(uv.y, 0.9);
  let matrix_grid = (uv - vec2f(0.76, 0.1)) * vec2f(54.0, 31.0);
  let matrix_cell = floor(matrix_grid);
  let matrix_uv = fract(matrix_grid);
  let matrix_core =
    step(0.26, matrix_uv.x) *
    step(matrix_uv.x, 0.74) *
    step(0.24, matrix_uv.y) *
    step(matrix_uv.y, 0.76);
  let matrix_threshold = 0.7 - glyph_complexity * 0.12 - symbol_pressure * 0.1;
  let matrix_bit = matrix_zone * matrix_core *
    step(matrix_threshold, hash(matrix_cell + vec2f(signature.x * 37.0 + floor(time * 5.0), glyphs.w * 41.0)));
  color += vec3f(0.08, 0.84, 1.0) * matrix_bit * (0.5 + turbulence);
  alpha = max(alpha, matrix_bit * 0.34);

  let seed_center = vec2f(
    sin(seed_hash * 6.2831853) * 0.12,
    cos(seed_hash * 10.681415) * 0.1
  );
  let seed_delta = centered - seed_center;
  let seed_radius = length(seed_delta);
  let seed_angle = atan2(seed_delta.y, seed_delta.x);
  let kernel_ring = circle_line(seed_radius, 0.11 + spawn_age * (0.2 + energy * 0.08), 0.018 + symbol_pressure * 0.014) * spawn_impulse;
  let kernel_spokes =
    pow(max(0.0, sin(seed_angle * (8.0 + floor(seed_hash * 13.0)) + seed_hash * 31.0 + time * (1.8 + turbulence * 2.4))), 14.0) *
    smoothstep(0.72, 0.04, seed_radius) *
    spawn_impulse;
  let kernel_hash = step(0.82 - symbol_pressure * 0.18, hash(floor((uv + seed_hash) * vec2f(74.0, 42.0) + floor(time * 8.0))));
  color += vec3f(0.78, 1.0, 0.9) * kernel_ring +
    vec3f(0.15, 0.95, 1.0) * kernel_spokes * (0.18 + glyph_complexity * 0.25) +
    vec3f(1.0, 0.16, 0.68) * kernel_hash * spawn_impulse * symbol_pressure * 0.18;
  alpha = max(alpha, kernel_ring * 0.78 + kernel_spokes * 0.24 + kernel_hash * spawn_impulse * symbol_pressure * 0.12);

  if (pointer_active > 0.5) {
    let cross_x = 1.0 - smoothstep(0.0, 0.006, abs(uv.x - pointer_uv.x));
    let cross_y = 1.0 - smoothstep(0.0, 0.006, abs(uv.y - pointer_uv.y));
    let scope = circle_line(pointer_dist, 0.075 + pulse * 0.035, 0.012);
    let cross = max(max(cross_x, cross_y) * 0.14, scope * 0.45);
    color += vec3f(0.65, 1.0, 0.86) * cross;
    alpha = max(alpha, cross * 0.72);
  }

  return vec4f(color, alpha);
}
