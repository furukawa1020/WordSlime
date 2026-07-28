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

@group(0) @binding(0) var<storage, read> performance_field: array<vec4f>;
@group(0) @binding(1) var<uniform> params: SimParams;

const FIELD_WIDTH = 256u;
const FIELD_HEIGHT = 144u;

const POSITIONS = array<vec2f, 3>(
  vec2f(-1.0, -1.0),
  vec2f(3.0, -1.0),
  vec2f(-1.0, 3.0)
);

fn field_index(cell: vec2i) -> u32 {
  let width = i32(FIELD_WIDTH);
  let height = i32(FIELD_HEIGHT);
  let wrapped_x = (cell.x + width) % width;
  let wrapped_y = (cell.y + height) % height;
  return u32(wrapped_y) * FIELD_WIDTH + u32(wrapped_x);
}

fn field_state(cell: vec2i) -> vec4f {
  return performance_field[field_index(cell)];
}

fn sample_field(uv: vec2f) -> vec4f {
  let field_size = vec2f(f32(FIELD_WIDTH), f32(FIELD_HEIGHT));
  let sample_position = clamp(
    uv * field_size,
    vec2f(0.0),
    field_size - vec2f(1.0)
  );
  return field_state(vec2i(sample_position));
}

fn field_palette(movement: f32, activity: f32) -> vec3f {
  let cyan = mix(
    vec3f(0.0, 0.16, 0.2),
    vec3f(0.08, 0.94, 0.74),
    activity
  );
  let magenta = mix(
    vec3f(0.18, 0.01, 0.28),
    vec3f(1.0, 0.08, 0.62),
    activity
  );
  let spore = mix(
    vec3f(0.04, 0.16, 0.04),
    vec3f(0.66, 0.96, 0.22),
    activity
  );

  if (movement < 2.5) {
    return mix(cyan, magenta, movement * 0.13);
  }
  if (movement < 3.5) {
    return magenta;
  }
  if (movement < 4.5) {
    return spore;
  }
  return mix(spore, cyan, 0.62);
}

@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> VertexOut {
  let position = POSITIONS[vertex_index];
  var output: VertexOut;
  output.position = vec4f(position, 0.0, 1.0);
  output.uv = position * 0.5 + vec2f(0.5);
  return output;
}

@fragment
fn fs_main(input: VertexOut) -> @location(0) vec4f {
  let performance = params.performance;
  let active = performance.x;

  if (active < 0.5) {
    return vec4f(0.0);
  }

  let state = sample_field(input.uv);
  let inhibitor = state.y;
  let activity = state.z;
  let movement = floor(performance.w);
  let intensity = performance.z;
  let membrane =
    smoothstep(0.08, 0.34, inhibitor) *
    (1.0 - smoothstep(0.5, 0.82, inhibitor));
  let contour_phase = abs(fract(inhibitor * 13.0 + activity * 2.0) * 2.0 - 1.0);
  let contour = pow(1.0 - contour_phase, 8.0);
  let vein = clamp(
    membrane * (0.72 + activity * 0.8) +
    contour * (0.18 + activity * 0.36),
    0.0,
    1.0
  );
  let vignette = smoothstep(0.82, 0.2, distance(input.uv, vec2f(0.5)));
  let color = field_palette(movement, clamp(vein + activity * 0.35, 0.0, 1.0));
  let alpha =
    vein *
    vignette *
    (0.08 + intensity * 0.24) *
    mix(1.0, 0.42, params.behavior.y);

  return vec4f(color, alpha);
}
