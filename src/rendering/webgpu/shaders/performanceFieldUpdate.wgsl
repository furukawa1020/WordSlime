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
  gpu_field: vec4f,
};

@group(0) @binding(0) var<storage, read> source_field: array<vec4f>;
@group(0) @binding(1) var<storage, read_write> target_field: array<vec4f>;
@group(0) @binding(2) var<uniform> params: SimParams;

const FIELD_WIDTH = 256u;
const FIELD_HEIGHT = 144u;
const TAU = 6.28318530718;

fn field_index(cell: vec2i) -> u32 {
  let width = i32(FIELD_WIDTH);
  let height = i32(FIELD_HEIGHT);
  let wrapped_x = (cell.x + width) % width;
  let wrapped_y = (cell.y + height) % height;
  return u32(wrapped_y) * FIELD_WIDTH + u32(wrapped_x);
}

fn field_state(cell: vec2i) -> vec4f {
  return source_field[field_index(cell)];
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3u) {
  if (global_id.x >= FIELD_WIDTH || global_id.y >= FIELD_HEIGHT) {
    return;
  }

  let cell = vec2i(global_id.xy);
  let center = field_state(cell);
  let north = field_state(cell + vec2i(0, -1));
  let south = field_state(cell + vec2i(0, 1));
  let west = field_state(cell + vec2i(-1, 0));
  let east = field_state(cell + vec2i(1, 0));
  let north_west = field_state(cell + vec2i(-1, -1));
  let north_east = field_state(cell + vec2i(1, -1));
  let south_west = field_state(cell + vec2i(-1, 1));
  let south_east = field_state(cell + vec2i(1, 1));
  let laplacian =
    (north.xy + south.xy + west.xy + east.xy) * 0.2 +
    (north_west.xy + north_east.xy + south_west.xy + south_east.xy) * 0.05 -
    center.xy;

  let time = params.frame.y;
  let reduce_motion = params.behavior.y;
  let performance = params.performance;
  let intensity = performance.z;
  let movement = floor(performance.w);
  let movement_local = fract(performance.w);
  let uv =
    (vec2f(global_id.xy) + vec2f(0.5)) /
    vec2f(f32(FIELD_WIDTH), f32(FIELD_HEIGHT));

  var feed = 0.032 + intensity * 0.018;
  var kill = 0.058 + movement * 0.0009;

  if (movement < 0.5) {
    feed = 0.028 + intensity * 0.012;
    kill = 0.057;
  } else if (movement < 1.5) {
    feed = 0.038 + intensity * 0.014;
    kill = 0.061;
  } else if (movement < 2.5) {
    feed = 0.046 + intensity * 0.012;
    kill = 0.063;
  } else if (movement < 3.5) {
    feed = 0.022 + intensity * 0.024;
    kill = 0.055 + sin(time * 0.17) * 0.003;
  } else if (movement < 4.5) {
    feed = 0.026 + intensity * 0.01;
    kill = 0.056;
  } else {
    feed = 0.031;
    kill = 0.06 + (1.0 - intensity) * 0.004;
  }

  let activator = center.x;
  let inhibitor = center.y;
  let reaction = activator * inhibitor * inhibitor;
  let normalized_frame_step = clamp(
    params.gpu_field.y * 60.0,
    0.05,
    1.5
  ) / max(params.gpu_field.x, 1.0);
  let field_dt =
    mix(0.68, 1.08, intensity) *
    mix(1.0, 0.42, reduce_motion) *
    normalized_frame_step;
  var next_activator =
    activator +
    (
      laplacian.x * 1.0 -
      reaction +
      feed * (1.0 - activator)
    ) *
    field_dt;
  var next_inhibitor =
    inhibitor +
    (
      laplacian.y * 0.5 +
      reaction -
      (kill + feed) * inhibitor
    ) *
    field_dt;

  let orbit = vec2f(
    0.5 +
      sin(time * (0.13 + movement * 0.018) + movement_local * TAU) *
        (0.16 + intensity * 0.12),
    0.5 +
      cos(time * (0.11 + movement * 0.014) - movement_local * TAU * 0.7) *
        (0.12 + intensity * 0.08)
  );
  let counter_orbit = vec2f(
    0.5 + cos(time * 0.09 + movement * 1.7) * 0.31,
    0.5 + sin(time * 0.12 - movement * 1.3) * 0.24
  );
  let orbit_injection =
    1.0 - smoothstep(0.018, 0.075 + intensity * 0.018, distance(uv, orbit));
  let counter_injection =
    1.0 - smoothstep(0.014, 0.052, distance(uv, counter_orbit));
  let score_wave = pow(
    max(
      0.0,
      sin(
        (uv.x * (10.0 + movement * 2.0) + uv.y * 7.0) * TAU -
        time * (0.35 + intensity * 1.4)
      )
    ),
    12.0
  );
  let score_injection =
    score_wave *
    smoothstep(0.72, 0.12, abs(uv.y - 0.5)) *
    (0.008 + intensity * 0.024);

  var pointer_injection = 0.0;
  if (params.pointer.z > 0.5) {
    let canvas_size = max(params.frame.zw, vec2f(1.0));
    let pointer_uv = params.pointer.xy / canvas_size;
    pointer_injection =
      (1.0 - smoothstep(0.012, 0.075, distance(uv, pointer_uv))) *
      mix(0.04, 0.16, params.pointer.w);
  }

  let injection =
    orbit_injection * (0.018 + intensity * 0.08) +
    counter_injection * (0.012 + intensity * 0.045) +
    score_injection +
    pointer_injection;
  next_inhibitor = max(next_inhibitor, inhibitor + injection);
  next_activator -= injection * 0.34;

  let clamped_activator = clamp(next_activator, 0.0, 1.0);
  let clamped_inhibitor = clamp(next_inhibitor, 0.0, 1.0);
  let activity = mix(
    center.z,
    clamp(
      abs(clamped_inhibitor - inhibitor) * 18.0 +
      orbit_injection * 0.3 +
      counter_injection * 0.18,
      0.0,
      1.0
    ),
    0.24
  );

  target_field[field_index(cell)] = vec4f(
    clamped_activator,
    clamped_inhibitor,
    activity,
    center.w
  );
}
