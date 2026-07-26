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

fn rotate2(point: vec2f, angle: f32) -> vec2f {
  let sine = sin(angle);
  let cosine = cos(angle);
  return vec2f(
    point.x * cosine - point.y * sine,
    point.x * sine + point.y * cosine
  );
}

fn hash21(point: vec2f) -> f32 {
  let mixed = fract(vec3f(point.xyx) * 0.1031);
  let shifted = mixed + dot(mixed, mixed.yzx + 33.33);
  return fract((shifted.x + shifted.y) * shifted.z);
}

fn sd_sphere(position: vec3f, radius: f32) -> f32 {
  return length(position) - radius;
}

fn sd_box(position: vec3f, bounds: vec3f) -> f32 {
  let offset = abs(position) - bounds;
  return length(max(offset, vec3f(0.0))) +
    min(max(offset.x, max(offset.y, offset.z)), 0.0);
}

fn sd_torus(position: vec3f, radii: vec2f) -> f32 {
  let ring = vec2f(length(position.xz) - radii.x, position.y);
  return length(ring) - radii.y;
}

fn sd_capsule(
  position: vec3f,
  start_point: vec3f,
  end_point: vec3f,
  radius: f32
) -> f32 {
  let start_to_position = position - start_point;
  let segment = end_point - start_point;
  let segment_ratio = clamp(
    dot(start_to_position, segment) / dot(segment, segment),
    0.0,
    1.0
  );
  return length(start_to_position - segment * segment_ratio) - radius;
}

fn smooth_min(first: f32, second: f32, radius: f32) -> f32 {
  let blend = max(radius - abs(first - second), 0.0) / radius;
  return min(first, second) - blend * blend * radius * 0.25;
}

fn scene_distance(
  source_position: vec3f,
  time: f32,
  movement: f32,
  intensity: f32
) -> vec2f {
  var position = source_position;
  let shot_phase = fract(params.performance.w) * 4.0;
  let shot = floor(shot_phase);
  let shot_progress = fract(shot_phase);

  if (shot > 0.5 && shot < 1.5) {
    let tilted_yz = rotate2(
      position.yz,
      0.72 + sin(time * 0.13) * 0.18
    );
    position = vec3f(position.x, tilted_yz.x, tilted_yz.y);
  } else if (shot > 1.5 && shot < 2.5) {
    let twisted_xy = rotate2(
      position.xy,
      position.z * (0.52 + intensity * 0.28) +
        shot_progress * 0.42
    );
    position = vec3f(
      twisted_xy,
      position.z + sin(position.x * 2.8 + time * 0.34) * 0.09
    );
  } else if (shot > 2.5) {
    position.xy =
      abs(position.xy) -
      vec2f(
        0.18 + sin(time * 0.23) * 0.08,
        0.12 + cos(time * 0.19) * 0.06
      );
    position.xz = rotate2(
      position.xz,
      -0.46 + shot_progress * 0.92
    );
  }

  if (movement < 0.5) {
    let cell = floor(position.xz / 0.72 + vec2f(0.5));
    let cell_random = hash21(cell);
    let local_xz = fract(position.xz / 0.72 + vec2f(0.5)) - vec2f(0.5);
    let local = vec3f(local_xz.x * 0.72, position.y, local_xz.y * 0.72);
    let height = 0.72 + cell_random * 0.72;
    var roots = sd_capsule(
      local,
      vec3f(0.0, -0.88, 0.0),
      vec3f(0.0, height - 0.72, 0.0),
      0.025 + cell_random * 0.022
    );
    roots = min(
      roots,
      sd_capsule(
        local,
        vec3f(0.0, -0.18, 0.0),
        vec3f(0.2 + cell_random * 0.12, 0.34, 0.08),
        0.018
      )
    );
    roots = min(
      roots,
      sd_capsule(
        local,
        vec3f(0.0, 0.08, 0.0),
        vec3f(-0.18, 0.52 + cell_random * 0.2, -0.16),
        0.014
      )
    );
    let spore_position = local - vec3f(
      sin(cell_random * 19.0 + time * 0.24) * 0.18,
      0.38 + cell_random * 0.62 + sin(time * 0.7 + cell_random * 9.0) * 0.08,
      cos(cell_random * 23.0 + time * 0.2) * 0.15
    );
    let spore = sd_sphere(spore_position, 0.025 + cell_random * 0.022);
    let ground = abs(
      position.y + 0.88 +
      sin(position.x * 3.0 + time * 0.18) * 0.04 +
      cos(position.z * 2.6) * 0.035
    ) - 0.018;
    let organic = min(roots, spore);

    if (ground < organic) {
      return vec2f(ground, 0.5);
    }

    return vec2f(organic, 0.0);
  }

  if (movement < 1.5) {
    let first_center = vec3f(
      sin(time * 0.7) * 0.48,
      cos(time * 0.53) * 0.24,
      sin(time * 0.41) * 0.32
    );
    let second_center = vec3f(
      cos(time * 0.61 + 1.7) * 0.52,
      sin(time * 0.49 + 0.8) * 0.32,
      cos(time * 0.37) * 0.26
    );
    let third_center = vec3f(
      sin(time * 0.43 + 3.1) * 0.34,
      cos(time * 0.79 + 2.2) * 0.42,
      sin(time * 0.57 + 1.2) * 0.4
    );
    var liquid = sd_sphere(position - first_center, 0.52);
    liquid = smooth_min(
      liquid,
      sd_sphere(position - second_center, 0.46),
      0.38
    );
    liquid = smooth_min(
      liquid,
      sd_sphere(position - third_center, 0.4),
      0.34
    );
    let liquid_floor =
      position.y +
      0.76 +
      sin(position.x * 4.2 + time) * 0.08 +
      cos(position.z * 3.7 - time * 0.8) * 0.07;

    return vec2f(smooth_min(liquid, liquid_floor, 0.18), 1.0);
  }

  if (movement < 2.5) {
    let tunnel_position = vec3f(
      rotate2(position.xy, position.z * 0.34 + time * 0.42),
      position.z
    );
    let tunnel = abs(length(tunnel_position.xy) - 1.02) - 0.024;
    let repeated_z =
      (fract((tunnel_position.z + time * 1.4) / 0.46 + 0.5) - 0.5) *
      0.46;
    let pulse_radius =
      0.68 +
      sin(floor((tunnel_position.z + time * 1.4) / 0.46) * 1.91) * 0.16;
    let ring = sd_torus(
      vec3f(tunnel_position.x, repeated_z, tunnel_position.y),
      vec2f(pulse_radius, 0.026 + intensity * 0.018)
    );
    let drone_cell = floor(
      vec2f(
        atan2(tunnel_position.y, tunnel_position.x) * 2.54,
        tunnel_position.z * 2.2 + time * 2.0
      )
    );
    let drone_random = hash21(drone_cell);
    let drone_angle =
      (drone_cell.x + drone_random) / 16.0 * 6.2831853 +
      time * (0.5 + drone_random);
    let drone_z = (drone_cell.y - time * 2.0) / 2.2;
    let drone_center = vec3f(
      cos(drone_angle) * (0.48 + drone_random * 0.42),
      sin(drone_angle) * (0.48 + drone_random * 0.42),
      drone_z
    );
    let drone = sd_box(
      tunnel_position - drone_center,
      vec3f(0.035 + drone_random * 0.04, 0.018, 0.08)
    );

    return vec2f(min(tunnel, min(ring, drone)), 2.0);
  }

  if (movement < 3.5) {
    var hyper_position = position;
    let rotated_xy = rotate2(hyper_position.xy, time * 0.52);
    hyper_position = vec3f(rotated_xy, hyper_position.z);
    let rotated_xz = rotate2(
      hyper_position.xz,
      time * 0.39 + sin(time * 0.21) * 0.8
    );
    hyper_position = vec3f(rotated_xz.x, hyper_position.y, rotated_xz.y);
    let outer = sd_box(hyper_position, vec3f(0.78));
    let inner = sd_box(hyper_position, vec3f(0.63));
    let shell = max(outer, -inner);
    let axis_x = sd_box(hyper_position, vec3f(0.86, 0.035, 0.035));
    let axis_y = sd_box(hyper_position, vec3f(0.035, 0.86, 0.035));
    let axis_z = sd_box(hyper_position, vec3f(0.035, 0.035, 0.86));
    let core_rotation = rotate2(
      hyper_position.xy,
      -time * 0.9 + position.z * 1.2
    );
    let core = sd_box(
      vec3f(core_rotation, hyper_position.z),
      vec3f(0.27 + intensity * 0.08)
    );

    return vec2f(min(shell, min(core, min(axis_x, min(axis_y, axis_z)))), 3.0);
  }

  if (movement < 4.5) {
    var root_position = position;
    root_position.xz = rotate2(
      root_position.xz,
      root_position.y * 0.72 + time * 0.12
    );
    let scale = 4.4 + intensity * 1.8;
    let gyroid = abs(
      dot(
        sin(root_position * scale + time * 0.22),
        cos(root_position.zxy * scale - time * 0.18)
      )
    ) / scale - (0.035 + intensity * 0.018);
    let bounded_gyroid = max(
      gyroid,
      sd_sphere(root_position, 1.12)
    );
    let chamber = sd_sphere(
      root_position - vec3f(
        sin(time * 0.22) * 0.3,
        cos(time * 0.18) * 0.2,
        0.0
      ),
      0.18 + intensity * 0.08
    );
    let soil =
      root_position.y +
      0.84 +
      sin(root_position.x * 3.7) * 0.05 +
      cos(root_position.z * 4.1) * 0.04;

    return vec2f(min(min(bounded_gyroid, chamber), soil), 4.0);
  }

  let disk_rotation = rotate2(position.yz, 0.34 + sin(time * 0.2) * 0.18);
  let disk_position = vec3f(position.x, disk_rotation.x, disk_rotation.y);
  let accretion = sd_torus(
    disk_position,
    vec2f(0.86 + sin(time * 0.31) * 0.08, 0.085 + intensity * 0.035)
  );
  let second_ring = sd_torus(
    disk_position,
    vec2f(1.12, 0.024)
  );
  let event_horizon = sd_sphere(position, 0.42 + intensity * 0.06);

  if (event_horizon < min(accretion, second_ring)) {
    return vec2f(event_horizon, 6.0);
  }

  return vec2f(min(accretion, second_ring), 5.0);
}

fn scene_normal(
  position: vec3f,
  time: f32,
  movement: f32,
  intensity: f32
) -> vec3f {
  let step_size = 0.006;
  let x_offset = vec3f(step_size, 0.0, 0.0);
  let y_offset = vec3f(0.0, step_size, 0.0);
  let z_offset = vec3f(0.0, 0.0, step_size);
  return normalize(vec3f(
    scene_distance(position + x_offset, time, movement, intensity).x -
      scene_distance(position - x_offset, time, movement, intensity).x,
    scene_distance(position + y_offset, time, movement, intensity).x -
      scene_distance(position - y_offset, time, movement, intensity).x,
    scene_distance(position + z_offset, time, movement, intensity).x -
      scene_distance(position - z_offset, time, movement, intensity).x
  ));
}

fn material_color(material_id: f32, position: vec3f, time: f32) -> vec3f {
  if (material_id < 0.75) {
    return mix(
      vec3f(0.12, 0.84, 0.28),
      vec3f(0.95, 1.0, 0.34),
      smoothstep(-0.8, 0.9, position.y)
    );
  }

  if (material_id < 1.5) {
    return mix(
      vec3f(0.02, 0.68, 1.0),
      vec3f(1.0, 0.12, 0.52),
      sin(position.x * 3.0 + position.y * 2.0 + time) * 0.5 + 0.5
    );
  }

  if (material_id < 2.5) {
    return mix(
      vec3f(1.0, 0.42, 0.04),
      vec3f(0.04, 0.82, 1.0),
      fract(position.z * 1.7 - time)
    );
  }

  if (material_id < 3.5) {
    return mix(
      vec3f(0.98, 0.04, 0.8),
      vec3f(0.02, 0.92, 1.0),
      smoothstep(-0.8, 0.8, position.z)
    );
  }

  if (material_id < 4.5) {
    return mix(
      vec3f(0.08, 0.58, 0.14),
      vec3f(0.78, 1.0, 0.58),
      smoothstep(-0.7, 0.7, position.y)
    );
  }

  if (material_id < 5.5) {
    return mix(
      vec3f(1.0, 0.16, 0.02),
      vec3f(0.72, 0.06, 1.0),
      sin(atan2(position.z, position.x) * 5.0 - time * 2.0) * 0.5 + 0.5
    );
  }

  return vec3f(0.002, 0.003, 0.006);
}

fn camera_ray(
  origin: vec3f,
  target_position: vec3f,
  screen: vec2f
) -> vec3f {
  let forward = normalize(target_position - origin);
  let right = normalize(cross(forward, vec3f(0.0, 1.0, 0.0)));
  let upward = cross(right, forward);
  return normalize(
    forward * 1.62 +
    right * screen.x +
    upward * screen.y
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
  if (params.performance.x < 0.5) {
    return vec4f(0.0);
  }

  let size = max(params.frame.zw, vec2f(1.0));
  let aspect = size.x / size.y;
  let screen = vec2f(
    (input.uv.x * 2.0 - 1.0) * aspect,
    1.0 - input.uv.y * 2.0
  );
  let time = params.frame.y;
  let movement = floor(params.performance.w);
  let local_progress = fract(params.performance.w);
  let shot = floor(local_progress * 4.0);
  let shot_progress = fract(local_progress * 4.0);
  let stage_time = time + shot * 4.7;
  let intensity = params.performance.z;
  var camera_origin = vec3f(0.0, 0.05, 3.25);
  var camera_target = vec3f(0.0);

  if (movement < 0.5) {
    camera_origin = vec3f(
      sin(time * 0.11) * 2.1,
      0.22 + sin(time * 0.17) * 0.18,
      3.0
    );
    camera_target = vec3f(0.0, -0.18, 0.0);
  } else if (movement < 1.5) {
    camera_origin = vec3f(
      sin(time * 0.22) * 1.1,
      cos(time * 0.16) * 0.5,
      2.75
    );
  } else if (movement < 2.5) {
    camera_origin = vec3f(
      sin(time * 0.3) * 0.16,
      cos(time * 0.26) * 0.16,
      2.5 - local_progress * 0.8
    );
    camera_target = vec3f(0.0, 0.0, -1.8);
  } else if (movement < 3.5) {
    camera_origin = vec3f(
      sin(time * 0.24) * 4.15,
      cos(time * 0.19) * 2.25,
      cos(time * 0.24) * 4.15
    );
  } else if (movement < 4.5) {
    camera_origin = vec3f(
      sin(time * 0.1) * 1.7,
      0.44,
      3.0
    );
    camera_target = vec3f(0.0, -0.14, 0.0);
  } else {
    camera_origin = vec3f(
      sin(time * 0.16) * 2.85,
      1.0 + sin(time * 0.12) * 0.28,
      cos(time * 0.16) * 2.85
    );
  }

  var camera_offset = camera_origin - camera_target;
  var staged_screen = screen;
  var lens = 0.78;

  if (shot < 0.5) {
    camera_offset *= 1.18 - shot_progress * 0.08;
    lens = 0.96;
  } else if (shot < 1.5) {
    let close_rotation = rotate2(camera_offset.xz, 0.48);
    camera_offset = vec3f(
      close_rotation.x,
      camera_offset.y * 0.58 + 0.16,
      close_rotation.y
    ) * (0.7 - shot_progress * 0.08);
    camera_target += vec3f(
      sin(time * 0.31) * 0.16,
      cos(time * 0.27) * 0.12,
      0.0
    );
    staged_screen = rotate2(screen, -0.08);
    lens = 0.66;
  } else if (shot < 2.5) {
    let overhead_rotation = rotate2(camera_offset.xz, 1.18);
    let orbit_radius = max(length(camera_offset), 1.0);
    camera_offset = vec3f(
      overhead_rotation.x * 0.68,
      orbit_radius * (0.62 + shot_progress * 0.12),
      overhead_rotation.y * 0.68
    );
    camera_target += vec3f(0.0, -0.2, sin(time * 0.19) * 0.16);
    staged_screen = rotate2(screen, 0.22 + shot_progress * 0.18);
    lens = 0.86;
  } else {
    let tracking_rotation = rotate2(
      camera_offset.xz,
      -0.94 + shot_progress * 0.38
    );
    camera_offset = vec3f(
      tracking_rotation.x,
      camera_offset.y * 0.34 - 0.24,
      tracking_rotation.y
    ) * 0.9;
    camera_target += vec3f(
      cos(time * 0.23) * 0.24,
      sin(time * 0.29) * 0.15,
      0.0
    );
    staged_screen = rotate2(screen, -0.16);
    lens = 1.08;
  }

  camera_origin = camera_target + camera_offset;
  let ray_direction = camera_ray(
    camera_origin,
    camera_target,
    staged_screen * lens
  );
  var travel = 0.0;
  var hit_position = camera_origin;
  var hit_material = -1.0;
  var hit = false;
  let step_limit = select(80, 96, size.x >= 1000.0);

  for (var step_index = 0; step_index < 96; step_index = step_index + 1) {
    if (step_index >= step_limit) {
      break;
    }

    hit_position = camera_origin + ray_direction * travel;
    let scene = scene_distance(
      hit_position,
      stage_time,
      movement,
      intensity
    );

    if (abs(scene.x) < 0.0045) {
      hit = true;
      hit_material = scene.y;
      break;
    }

    travel += clamp(abs(scene.x) * 0.72, 0.012, 0.16);

    if (travel > 6.2) {
      break;
    }
  }

  if (!hit) {
    return vec4f(0.0);
  }

  let normal = scene_normal(
    hit_position,
    stage_time,
    movement,
    intensity
  );
  let primary_light = normalize(vec3f(-0.54, 0.72, 0.46));
  let secondary_light = normalize(vec3f(0.62, -0.18, 0.76));
  let diffuse = max(0.0, dot(normal, primary_light));
  let secondary = max(0.0, dot(normal, secondary_light));
  let facing = clamp(dot(normal, -ray_direction), 0.0, 1.0);
  let fresnel = pow(1.0 - facing, 3.0);
  let material = material_color(hit_material, hit_position, stage_time);
  let pulse = pow(
    max(0.0, sin(time * (2.1 + movement * 0.47))),
    9.0
  );
  var color =
    material * (0.16 + diffuse * 0.78 + secondary * 0.26) +
    mix(vec3f(0.02, 0.88, 1.0), vec3f(1.0, 0.06, 0.68), movement / 5.0) *
      fresnel *
      (0.48 + intensity * 0.72);
  color += material * pulse * fresnel * 0.32;
  var alpha = 0.82 + fresnel * 0.14;

  if (hit_material > 2.5 && hit_material < 3.5) {
    color += material * (0.42 + pulse * 0.24);
    alpha = 0.92;
  }

  if (hit_material > 5.5) {
    color = vec3f(0.0) + vec3f(0.12, 0.02, 0.2) * fresnel;
    alpha = 0.96;
  }

  let distance_fade = smoothstep(6.2, 1.2, travel);
  return vec4f(color * distance_fade, alpha * distance_fade);
}
