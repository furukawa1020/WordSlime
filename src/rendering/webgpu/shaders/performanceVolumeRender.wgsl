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
@group(0) @binding(1) var<storage, read> performance_field: array<vec4f>;

const FIELD_WIDTH = 256u;
const FIELD_HEIGHT = 144u;
const POSITIONS = array<vec2f, 3>(
  vec2f(-1.0, -1.0),
  vec2f(3.0, -1.0),
  vec2f(-1.0, 3.0)
);

fn gpu_field_sample(uv: vec2f) -> vec4f {
  let safe_uv = clamp(uv, vec2f(0.0), vec2f(0.9999));
  let cell = vec2u(
    safe_uv * vec2f(f32(FIELD_WIDTH), f32(FIELD_HEIGHT))
  );
  return performance_field[cell.y * FIELD_WIDTH + cell.x];
}

fn rotate2(point: vec2f, angle: f32) -> vec2f {
  let sine = sin(angle);
  let cosine = cos(angle);
  return vec2f(
    point.x * cosine - point.y * sine,
    point.x * sine + point.y * cosine
  );
}

fn volume_palette(movement: f32, depth: f32, phase: f32) -> vec3f {
  let cold = mix(vec3f(0.01, 0.42, 0.5), vec3f(0.08, 0.9, 0.66), depth);
  let electric = mix(vec3f(0.28, 0.04, 0.62), vec3f(0.96, 0.08, 0.64), phase);
  let spore = mix(vec3f(0.1, 0.52, 0.16), vec3f(0.72, 0.94, 0.32), depth);

  if (movement < 2.5) {
    return mix(
      cold,
      electric,
      0.18 + phase * 0.28 + movement * 0.08
    );
  }

  if (movement < 3.5) {
    return mix(electric, cold, phase * 0.26);
  }

  if (movement < 4.5) {
    return mix(spore, cold, phase * 0.2);
  }

  return mix(spore, cold, phase * 0.22);
}

fn volume_field(
  source_position: vec3f,
  time: f32,
  movement: f32,
  intensity: f32
) -> vec4f {
  var position = source_position;
  let rotation_xy = rotate2(
    position.xy,
    time * (0.16 + movement * 0.024) + movement * 0.31
  );
  position = vec3f(rotation_xy, position.z);
  let rotation_xz = rotate2(
    position.xz,
    time * (0.11 + intensity * 0.1) - movement * 0.19
  );
  position = vec3f(rotation_xz.x, position.y, rotation_xz.y);

  let fourth_axis =
    sin(
      dot(position, vec3f(1.7, -1.3, 1.1)) +
      time * (0.72 + intensity * 0.58) +
      movement
    );
  let four_d_offset = vec3f(
    sin(fourth_axis * 2.1 + time * 0.31),
    cos(fourth_axis * 1.7 - time * 0.27),
    sin(fourth_axis * 2.7 + movement)
  ) * (0.08 + intensity * 0.1);
  let warped = position + four_d_offset;

  let sphere_shell = abs(
    length(warped) -
    (0.68 + sin(fourth_axis * 2.0 + time * 0.42) * 0.12)
  );
  let torus_axis = vec2f(length(warped.xz) - 0.48, warped.y);
  let torus_shell = abs(length(torus_axis) - (0.16 + intensity * 0.05));
  let folded = abs(warped) - vec3f(
    0.34 + fourth_axis * 0.045,
    0.28 + sin(time * 0.4) * 0.05,
    0.38 - fourth_axis * 0.04
  );
  let box_shell = abs(
    length(max(folded, vec3f(0.0))) +
    min(max(folded.x, max(folded.y, folded.z)), 0.0)
  );
  let frequency = 5.2 + movement * 0.74;
  let gyroid = abs(
    dot(
      sin(warped * frequency + time * 0.34),
      cos(warped.zxy * frequency - time * 0.29)
    )
  ) / 3.0;

  let shell_density = exp(-sphere_shell * (18.0 + intensity * 14.0));
  let torus_density = exp(-torus_shell * (24.0 + intensity * 18.0));
  let cube_density = exp(-box_shell * (26.0 + movement * 2.0));
  let gyroid_density = exp(-gyroid * (9.0 + intensity * 5.0));
  let boundary = smoothstep(1.6, 0.36, length(warped));
  let density = clamp(
    (
      shell_density * 0.42 +
      torus_density * 0.34 +
      cube_density * 0.24 +
      gyroid_density * 0.18
    ) * boundary,
    0.0,
    1.0
  );
  let depth = clamp(source_position.z * 0.26 + 0.5, 0.0, 1.0);
  let color = volume_palette(movement, depth, fourth_axis * 0.5 + 0.5);
  let electric_core = pow(
    max(0.0, 1.0 - length(warped.xy) * 0.8),
    5.0
  );

  return vec4f(
    color + vec3f(0.22, 0.56, 0.72) * electric_core * intensity,
    density
  );
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
  let aspect = size.x / size.y;
  let time = params.frame.y;
  let movement_phase = params.performance.w;
  let movement = floor(movement_phase);
  let local_progress = fract(movement_phase);
  let shot = floor(local_progress * 4.0);
  let shot_progress = fract(local_progress * 4.0);
  let stage_time = time + shot * 3.1;
  let intensity = params.performance.z;
  let gpu_field = gpu_field_sample(input.uv);
  let field_presence = smoothstep(
    0.025,
    0.42,
    gpu_field.y + gpu_field.z * 0.72
  );
  let coupled_intensity = clamp(
    intensity * (0.42 + field_presence * 0.72) + gpu_field.z * 0.22,
    0.0,
    1.0
  );
  let screen = vec2f(
    (input.uv.x * 2.0 - 1.0) * aspect,
    1.0 - input.uv.y * 2.0
  );
  let camera_orbit =
    time * (0.08 + coupled_intensity * 0.1) +
    movement * 0.34 +
    gpu_field.y * 0.18;
  var ray_origin = vec3f(
    sin(camera_orbit) * (0.16 + intensity * 0.12),
    cos(camera_orbit * 0.73) * 0.12,
    2.62
  );
  var staged_screen = screen;

  if (shot < 0.5) {
    ray_origin.z += 0.38;
    staged_screen *= 1.08;
  } else if (shot < 1.5) {
    ray_origin += vec3f(0.28, -0.14, -0.58 - shot_progress * 0.18);
    staged_screen = rotate2(screen, -0.1) * 0.78;
  } else if (shot < 2.5) {
    ray_origin += vec3f(-0.34, 0.52, -0.06);
    staged_screen = rotate2(screen, 0.34 + shot_progress * 0.16) * 0.92;
  } else {
    ray_origin += vec3f(-0.46 + shot_progress * 0.72, -0.26, 0.5);
    staged_screen = rotate2(screen, -0.2) * 1.2;
  }

  var ray_direction = normalize(vec3f(staged_screen * 0.72, -1.48));
  let camera_rotation = rotate2(ray_direction.xz, sin(camera_orbit) * 0.08);
  ray_direction = vec3f(camera_rotation.x, ray_direction.y, camera_rotation.y);

  var accumulated_color = vec3f(0.0);
  var transmission = 1.0;
  var travel = 0.0;
  let full_step_limit = select(56, 64, size.x >= 1000.0);
  let reduced_step_limit = select(36, 44, size.x >= 1000.0);
  let step_limit = select(
    reduced_step_limit,
    full_step_limit,
    params.behavior.z >= 100000.0
  );

  for (var step_index = 0; step_index < 64; step_index = step_index + 1) {
    if (step_index >= step_limit) {
      break;
    }

    let position = ray_origin + ray_direction * travel;
    let field_sample = volume_field(
      position,
      stage_time + shot_progress * 2.0,
      movement,
      coupled_intensity
    );
    let step_density =
      field_sample.a *
      (0.025 + coupled_intensity * 0.026) *
      (0.28 + field_presence * 0.92);
    let contribution = transmission * step_density;
    accumulated_color += field_sample.rgb * contribution;
    transmission *= 1.0 - step_density;
    travel += 0.055 + f32(step_index % 3) * 0.0025;
  }

  let volume_alpha = clamp(
    (1.0 - transmission) * (0.3 + coupled_intensity * 0.34),
    0.0,
    0.62
  );
  let vignette = smoothstep(1.25, 0.12, length(screen));
  let pulse = pow(
    max(0.0, sin(time * (2.1 + movement * 0.42))),
    10.0
  );
  let final_color =
    accumulated_color *
    (0.72 + coupled_intensity * 0.62 + pulse * 0.16) *
    vignette;

  return vec4f(
    final_color * (0.36 + field_presence * 0.8),
    volume_alpha * vignette * (0.22 + field_presence * 0.9)
  );
}
