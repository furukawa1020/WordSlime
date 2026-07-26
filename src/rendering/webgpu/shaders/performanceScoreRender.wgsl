struct SimParams {
  frame: vec4f,
  pointer: vec4f,
  behavior: vec4f,
  extra: vec4f,
  signature: vec4f,
  glyphs: vec4f,
  signal: vec4f,
  reservoir: vec4f,
  performance: vec4f,
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

fn line(value: f32, center: f32, width: f32) -> f32 {
  return 1.0 - smoothstep(0.0, width, abs(value - center));
}

fn palette(movement: f32, amount: f32) -> vec3f {
  let cold = mix(vec3f(0.04, 0.88, 0.72), vec3f(0.2, 0.62, 1.0), amount);
  let hot = mix(vec3f(1.0, 0.12, 0.72), vec3f(0.92, 1.0, 0.24), amount);
  let organic = mix(vec3f(0.28, 1.0, 0.38), vec3f(0.86, 0.96, 0.64), amount);

  if (movement < 1.5) {
    return cold;
  }

  if (movement < 4.5) {
    if (movement > 3.5) {
      return organic;
    }

    return mix(cold, hot, smoothstep(1.0, 3.0, movement));
  }

  return organic;
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
  let performance_active = params.performance.x;

  if (performance_active < 0.5) {
    return vec4f(0.0);
  }

  let size = max(params.frame.zw, vec2f(1.0));
  let time = params.frame.y;
  let progress = params.performance.y;
  let intensity = params.performance.z;
  let movement_phase = params.performance.w;
  let movement = floor(movement_phase);
  let local_progress = fract(movement_phase);
  let aspect = vec2f(size.x / size.y, 1.0);
  let centered = (input.uv - 0.5) * aspect;
  let distance = length(centered);
  let angle = atan2(centered.y, centered.x);
  let beat = pow(max(0.0, sin(time * (2.2 + movement * 0.44))), 12.0);
  let color_a = palette(movement, params.signature.x);
  let color_b = palette(5.0 - movement, params.glyphs.w);

  var score = 0.0;
  var score_color = vec3f(0.0);
  var orbit_weight = 0.18;
  var playhead_weight = 0.16;
  var ledger_weight = 0.12;
  var cell_weight = 0.1;
  var ribbon_weight = 0.1;
  var radial_weight = 0.12;

  if (movement < 0.5) {
    orbit_weight = 0.74;
    radial_weight = 0.42;
    cell_weight = 0.04;
  } else if (movement < 1.5) {
    ribbon_weight = 0.78;
    playhead_weight = 0.32;
    orbit_weight = 0.08;
  } else if (movement < 2.5) {
    cell_weight = 0.82;
    ledger_weight = 0.52;
    orbit_weight = 0.04;
  } else if (movement < 3.5) {
    ribbon_weight = 0.72;
    ledger_weight = 0.62;
    cell_weight = 0.46;
    radial_weight = 0.34;
  } else if (movement < 4.5) {
    radial_weight = 0.82;
    orbit_weight = 0.36;
    ribbon_weight = 0.18;
  } else {
    playhead_weight = 0.64;
    radial_weight = 0.22;
    orbit_weight = 0.03;
    cell_weight = 0.02;
  }

  for (var index = 0; index < 12; index = index + 1) {
    let fi = f32(index);
    let radius =
      0.09 + fi * 0.037 +
      sin(time * (0.13 + fi * 0.007) + fi * 1.7) * 0.012;
    let broken =
      pow(max(0.0, sin(angle * (3.0 + movement + fi * 0.18) - time * (0.32 + intensity) + fi)), 10.0);
    let orbit = line(distance, radius, 0.0025 + intensity * 0.0025) * broken;
    score += orbit * orbit_weight;
    score_color +=
      orbit *
      orbit_weight *
      mix(color_a, color_b, fi / 11.0);
  }

  let time_axis = input.uv.x - progress;
  let playhead = line(time_axis, 0.0, 0.002 + intensity * 0.002);
  let ledger =
    line(fract(input.uv.y * (12.0 + movement * 3.0) - time * 0.12), 0.5, 0.018) *
    line(fract(input.uv.x * 8.0 + movement * 0.13), 0.5, 0.32);
  let temporal_cells =
    step(0.92 - intensity * 0.08, hash(floor(input.uv * vec2f(38.0, 21.0) + vec2f(local_progress * 30.0, movement))));
  let hyper_ribbon =
    line(
      centered.y,
      sin(centered.x * (8.0 + movement * 1.7) + time * (0.44 + intensity)) *
        (0.08 + intensity * 0.12),
      0.006 + intensity * 0.008
    );
  let radial_ticks =
    pow(max(0.0, sin(angle * (18.0 + movement * 5.0) + local_progress * TAU)), 18.0) *
    line(distance, 0.34 + intensity * 0.08, 0.075);

  score_color +=
    color_a *
    playhead *
    playhead_weight *
    (0.28 + beat * 0.5);
  score_color += color_b * ledger * ledger_weight * 0.28;
  score_color +=
    mix(color_a, color_b, 0.5) *
    temporal_cells *
    cell_weight *
    0.22;
  score_color +=
    vec3f(0.72, 1.0, 0.92) *
    hyper_ribbon *
    ribbon_weight *
    (0.24 + intensity * 0.3);
  score_color +=
    color_b *
    radial_ticks *
    radial_weight *
    (0.26 + beat * 0.42);
  let alpha = clamp(
    score * (0.025 + intensity * 0.035) +
      playhead * playhead_weight * 0.34 +
      ledger * ledger_weight * 0.16 +
      temporal_cells * cell_weight * 0.16 +
      hyper_ribbon * ribbon_weight * 0.26 +
      radial_ticks * radial_weight * 0.3,
    0.0,
    0.58
  );
  let vignette = smoothstep(0.95, 0.1, distance);

  return vec4f(score_color * vignette, alpha * vignette);
}
