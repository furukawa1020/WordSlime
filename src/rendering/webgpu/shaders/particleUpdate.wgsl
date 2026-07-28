struct Particle {
  position: vec2f,
  velocity: vec2f,
  color: vec4f,
  age: f32,
  life: f32,
  radius: f32,
  energy: f32,
};

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

@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(1) var<uniform> params: SimParams;
@group(0) @binding(2) var<storage, read> performance_field: array<vec4f>;

const TAU = 6.28318530718;
const FIELD_WIDTH = 256u;
const FIELD_HEIGHT = 144u;

fn performance_field_index(cell: vec2i) -> u32 {
  let width = i32(FIELD_WIDTH);
  let height = i32(FIELD_HEIGHT);
  let wrapped_x = (cell.x + width) % width;
  let wrapped_y = (cell.y + height) % height;
  return u32(wrapped_y) * FIELD_WIDTH + u32(wrapped_x);
}

fn sample_performance_field(position: vec2f, size: vec2f) -> vec3f {
  let uv = clamp(
    position / max(size, vec2f(1.0)),
    vec2f(0.0),
    vec2f(0.9999)
  );
  let cell = vec2i(
    uv * vec2f(f32(FIELD_WIDTH), f32(FIELD_HEIGHT))
  );
  let center = performance_field[performance_field_index(cell)].y;
  let west =
    performance_field[performance_field_index(cell + vec2i(-1, 0))].y;
  let east =
    performance_field[performance_field_index(cell + vec2i(1, 0))].y;
  let north =
    performance_field[performance_field_index(cell + vec2i(0, -1))].y;
  let south =
    performance_field[performance_field_index(cell + vec2i(0, 1))].y;
  return vec3f(center, east - west, south - north);
}

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

fn curlFlow(position: vec2f, time: f32, energy: f32) -> vec2f {
  let point = position * 0.0046 + vec2f(time * 0.032, -time * 0.024);
  let step = 0.052;
  let up = noise(point + vec2f(0.0, step));
  let down = noise(point - vec2f(0.0, step));
  let right = noise(point + vec2f(step, 0.0));
  let left = noise(point - vec2f(step, 0.0));
  let gradient = vec2f(up - down, right - left);
  return normalize(vec2f(gradient.x, -gradient.y) + vec2f(0.001)) *
    (22.0 + energy * 94.0);
}

fn membraneForce(position: vec2f, size: vec2f) -> vec2f {
  let margin = 90.0;
  var force = vec2f(0.0);

  if (position.x < margin) {
    force.x += (margin - position.x) / margin;
  }
  if (position.x > size.x - margin) {
    force.x -= (position.x - (size.x - margin)) / margin;
  }
  if (position.y < margin) {
    force.y += (margin - position.y) / margin;
  }
  if (position.y > size.y - margin) {
    force.y -= (position.y - (size.y - margin)) / margin;
  }

  return force;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) global_id: vec3u) {
  let index = global_id.x;
  let count = u32(params.behavior.z);

  if (index >= count) {
    return;
  }

  var particle = particles[index];
  let raw_dt = min(params.frame.x, 0.033);
  let reduce_motion = params.behavior.y;
  let dt = raw_dt * mix(1.0, 0.32, reduce_motion);
  let time = params.frame.y;
  let size = max(params.frame.zw, vec2f(1.0));
  let mode = params.behavior.x;
  let signature = params.signature;
  let glyphs = params.glyphs;
  let signal = params.signal;
  let reservoir = params.reservoir;
  let performance = params.performance;
  let performance_active = performance.x;
  let performance_progress = performance.y;
  let performance_intensity = performance.z;
  let performance_movement = floor(performance.w);
  let performance_local = fract(performance.w);
  let global_energy = signature.x;
  let global_viscosity = signature.y;
  let global_turbulence = signature.z;
  let global_fertility = signature.w;
  let memory_energy = reservoir.x;
  let memory_viscosity = reservoir.y;
  let memory_turbulence = reservoir.z;
  let memory_complexity = reservoir.w;
  let length_pressure = glyphs.x;
  let repeat_pressure = glyphs.y;
  let symbol_pressure = glyphs.z;
  let glyph_complexity = glyphs.w;
  let spawn_age = signal.x;
  let seed_hash = signal.y;
  let draft_strength = signal.z;
  let draft_hash = signal.w;
  let spawn_impulse = exp(-spawn_age * (1.45 + symbol_pressure * 0.8 + global_turbulence * 0.6));

  if (performance_active > 0.5 && particle.life < 0.01) {
    let virtual_seed = vec2f(
      f32(index) * 0.7548777,
      f32(index) * 0.5698403 + performance_movement * 17.0
    );
    let random_a = hash(virtual_seed);
    let random_b = hash(virtual_seed + 19.37);
    let random_c = hash(virtual_seed + 47.11);
    let virtual_angle = random_a * TAU;
    let virtual_radius = sqrt(random_b) * min(size.x, size.y) * 0.48;
    let virtual_center = vec2f(size.x * 0.5, size.y * 0.52);

    particle.position =
      virtual_center +
      vec2f(cos(virtual_angle), sin(virtual_angle) * 0.76) *
        virtual_radius;
    particle.velocity =
      vec2f(-sin(virtual_angle), cos(virtual_angle)) *
      (18.0 + random_c * 82.0);
    particle.color = vec4f(
      mix(vec3f(0.04, 0.72, 0.58), vec3f(0.82, 0.08, 0.72), random_c),
      0.24 + random_a * 0.34
    );
    particle.age = random_b * 1.8;
    particle.life = 5.0 + random_c * 12.0;
    particle.radius = 0.7 + random_a * 2.6;
    particle.energy = 0.28 + random_c * 0.72;
  }

  let center = vec2f(size.x * 0.5, size.y * 0.54);
  let to_center = center - particle.position;
  let center_dist = max(length(to_center), 1.0);
  let seed_origin = vec2f(
    size.x * (0.5 + sin(seed_hash * TAU) * 0.12),
    size.y * (0.52 + cos(seed_hash * TAU * 1.7) * 0.1)
  );
  let from_seed = particle.position - seed_origin;
  let seed_dist = max(length(from_seed), 1.0);

  let wave = vec2f(
    sin(time * (0.72 + particle.energy) + particle.position.y * 0.006),
    cos(time * (0.61 + particle.energy) + particle.position.x * 0.005)
  );

  var common_scale = 1.0;
  if (mode > 0.5 && mode < 1.5) {
    common_scale = 0.42;
  } else if (mode > 1.5 && mode < 2.5) {
    common_scale = 0.72;
  } else if (mode > 2.5 && mode < 3.5) {
    common_scale = 0.28;
  } else if (mode > 3.5) {
    common_scale = 0.12;
  }
  common_scale *= 0.84 +
    global_turbulence * 0.38 +
    glyph_complexity * 0.18 +
    memory_turbulence * 0.18 +
    memory_complexity * 0.16;

  var flow = wave *
    (10.0 + particle.energy * 46.0 + global_energy * 26.0 + symbol_pressure * 34.0) *
    common_scale;
  flow += curlFlow(
    particle.position,
    time,
    particle.energy + global_turbulence * 0.52 + glyph_complexity * 0.22
  ) * common_scale;

  let glyph_wave = vec2f(
    sin(time * (1.1 + glyph_complexity * 2.6) + particle.position.y * (0.006 + glyphs.x * 0.012)),
    cos(time * (0.9 + symbol_pressure * 3.0) + particle.position.x * (0.005 + repeat_pressure * 0.016))
  );
  flow += glyph_wave * (repeat_pressure * 54.0 + symbol_pressure * 72.0) * common_scale;

  if (draft_strength > 0.001) {
    let draft_center = vec2f(
      size.x * (0.5 + sin(draft_hash * TAU) * 0.16),
      size.y * (0.5 + cos(draft_hash * TAU * 1.33) * 0.12)
    );
    let draft_delta = particle.position - draft_center;
    let draft_dist = max(length(draft_delta), 1.0);
    let draft_dir = draft_delta / draft_dist;
    let draft_tangent = vec2f(-draft_dir.y, draft_dir.x);
    let draft_band = pow(
      max(0.0, sin(draft_dist * (0.018 + glyph_complexity * 0.018) - time * (1.25 + draft_strength * 2.8))),
      6.0
    );
    let draft_well = 1.0 - smoothstep(110.0, 760.0, draft_dist);
    let draft_polarity = mix(-1.0, 1.0, step(0.5, hash(vec2f(f32(index), draft_hash * 997.0))));

    flow += draft_tangent * draft_band * draft_well * draft_strength *
      (92.0 + global_turbulence * 180.0 + symbol_pressure * 130.0) *
      draft_polarity;
    flow += draft_dir * sin(time * (2.0 + draft_strength) + draft_hash * TAU) *
      draft_well * draft_strength *
      (22.0 + global_energy * 72.0 + repeat_pressure * 64.0);
  }

  if (memory_complexity > 0.01) {
    let memory_center = vec2f(
      size.x * (0.5 + sin(memory_energy * TAU + time * 0.05) * 0.18),
      size.y * (0.55 + cos(memory_turbulence * TAU + time * 0.04) * 0.13)
    );
    let memory_delta = particle.position - memory_center;
    let memory_dist = max(length(memory_delta), 1.0);
    let memory_dir = memory_delta / memory_dist;
    let memory_tangent = vec2f(-memory_dir.y, memory_dir.x);
    let memory_band = sin(memory_dist * (0.008 + memory_complexity * 0.014) - time * (0.45 + memory_energy));
    let memory_well = 1.0 - smoothstep(180.0, 760.0, memory_dist);
    flow += memory_tangent * memory_band * memory_well *
      (28.0 + memory_turbulence * 118.0 + memory_complexity * 72.0);
    flow -= memory_dir * memory_well * memory_viscosity *
      (12.0 + memory_energy * 44.0);
  }

  if (performance_active > 0.5) {
    let gpu_field = sample_performance_field(particle.position, size);
    let field_gradient = gpu_field.yz;
    let field_gradient_length = max(length(field_gradient), 0.0001);
    let field_direction = field_gradient / field_gradient_length;
    let field_tangent = vec2f(-field_direction.y, field_direction.x);
    let field_membrane = smoothstep(0.035, 0.42, gpu_field.x);
    flow -= field_gradient *
      (820.0 + performance_intensity * 1680.0);
    flow += field_tangent *
      field_membrane *
      sin(
        gpu_field.x * TAU * 5.0 +
        time * (0.8 + performance_intensity * 2.4) +
        f32(index) * 0.0007
      ) *
      (42.0 + performance_intensity * 126.0);
    particle.energy = clamp(
      particle.energy +
      field_membrane * performance_intensity * dt * 0.035,
      0.0,
      1.0
    );

    let performance_shot = floor(performance_local * 4.0);
    let shot_progress = fract(performance_local * 4.0);
    let movement_phase =
      performance_progress * TAU * 3.0 +
      performance_movement * 1.0472;
    let conductor_center = vec2f(
      size.x * (
        0.5 +
        sin(time * (0.17 + performance_movement * 0.035) + movement_phase) *
          (0.08 + performance_intensity * 0.13)
      ),
      size.y * (
        0.52 +
        cos(time * (0.13 + performance_movement * 0.029) - movement_phase * 0.77) *
          (0.06 + performance_intensity * 0.1)
      )
    );
    let performance_delta = particle.position - conductor_center;
    let performance_dist = max(length(performance_delta), 1.0);
    let performance_dir = performance_delta / performance_dist;
    let performance_tangent = vec2f(-performance_dir.y, performance_dir.x);
    let ribbon = sin(
      performance_dist * (0.011 + performance_movement * 0.0018) -
      time * (0.9 + performance_intensity * 2.2) +
      f32(index) * 0.0017
    );
    let score_gate = pow(
      max(
        0.0,
        sin(
          time * (2.5 + performance_movement * 0.74) +
          performance_local * TAU
        )
      ),
      9.0
    );
    let score_well = 1.0 - smoothstep(120.0, 820.0, performance_dist);
    let direction_flip = mix(
      -1.0,
      1.0,
      step(0.5, fract(performance_movement * 0.618))
    );

    flow += performance_tangent * ribbon * score_well *
      (72.0 + performance_intensity * 278.0) * direction_flip;
    flow -= performance_dir * score_well *
      (18.0 + performance_intensity * 102.0);
    flow += performance_dir * score_gate *
      (80.0 + performance_intensity * 340.0);

    var four_d_force = vec2f(0.0);
    let normalized_position = particle.position / size - vec2f(0.5);

    for (var dimension = 0; dimension < 6; dimension = dimension + 1) {
      let dimension_index = f32(dimension);
      let fourth_axis = sin(
        time * (0.28 + dimension_index * 0.047) +
        performance_progress * TAU * (1.0 + dimension_index * 0.31) +
        f32(index) * (0.0007 + dimension_index * 0.00013)
      );
      let field_angle =
        atan2(normalized_position.y, normalized_position.x) +
        fourth_axis * (1.2 + dimension_index * 0.17);
      let field_radius =
        length(normalized_position) *
        (8.0 + dimension_index * 2.3) -
        time * (0.7 + dimension_index * 0.11);
      four_d_force += vec2f(
        cos(field_angle + field_radius),
        sin(field_angle - field_radius)
      ) * (0.22 + abs(fourth_axis) * 0.28);
    }

    flow += four_d_force *
      (26.0 + performance_intensity * 92.0);

    if (performance_shot > 0.5 && performance_shot < 1.5) {
      let split_side = select(
        -1.0,
        1.0,
        particle.position.x > size.x * 0.5
      );
      let split_center = vec2f(
        size.x * (0.5 + split_side * 0.25),
        size.y * (0.5 + sin(time * 0.8 + split_side) * 0.18)
      );
      let split_delta = particle.position - split_center;
      let split_distance = max(length(split_delta), 1.0);
      let split_direction = split_delta / split_distance;
      flow += vec2f(-split_direction.y, split_direction.x) *
        split_side *
        (210.0 + performance_intensity * 410.0);
      flow -= split_direction *
        (54.0 + performance_intensity * 170.0);
      particle.color.rgb = mix(
        particle.color.rgb,
        particle.color.gbr * vec3f(0.84, 1.16, 1.08),
        min(1.0, dt * 2.8)
      );
    } else if (performance_shot > 1.5 && performance_shot < 2.5) {
      let lattice_size = 34.0 + performance_movement * 5.0;
      let lattice_cell =
        floor(particle.position / lattice_size + vec2f(0.5)) *
        lattice_size;
      let lattice_pull = lattice_cell - particle.position;
      let fracture = vec2f(
        sin(particle.position.y * 0.031 + time * 4.2),
        cos(particle.position.x * 0.027 - time * 3.7)
      );
      flow += lattice_pull * (4.2 + performance_intensity * 7.4);
      flow += fracture *
        (160.0 + performance_intensity * 430.0) *
        score_gate;
      particle.color.rgb = mix(
        particle.color.rgb,
        particle.color.brg * vec3f(1.2, 0.82, 1.08),
        min(1.0, dt * 3.2)
      );
    } else if (performance_shot > 2.5) {
      let shot_center = vec2f(
        size.x * (0.5 + sin(time * 1.7) * 0.12),
        size.y * (0.5 + cos(time * 1.3) * 0.12)
      );
      let shot_delta = particle.position - shot_center;
      let shot_distance = max(length(shot_delta), 1.0);
      let shot_direction = shot_delta / shot_distance;
      let shock_ring = pow(
        max(0.0, sin(shot_distance * 0.032 - time * 5.4)),
        14.0
      );
      flow -= shot_direction *
        (130.0 + performance_intensity * 460.0);
      flow += shot_direction *
        shock_ring *
        (480.0 + performance_intensity * 920.0);
      particle.color.rgb = mix(
        particle.color.rgb,
        vec3f(
          1.08 - particle.color.b * 0.35,
          0.18 + particle.color.r * 0.72,
          1.16 - particle.color.g * 0.28
        ),
        min(1.0, dt * 2.6)
      );
    }

    if (performance_movement < 0.5) {
      let root_lane =
        sin(
          particle.position.x * 0.018 +
          time * 0.7 +
          f32(index % 17u)
        );
      let spore_gate = pow(
        max(0.0, sin(time * 1.4 + f32(index) * 0.013)),
        12.0
      );
      flow += vec2f(
        root_lane * (42.0 + performance_intensity * 78.0),
        -86.0 - performance_intensity * 124.0 +
          spore_gate * 260.0
      );
    } else if (performance_movement < 1.5) {
      let liquid_tangent = vec2f(-performance_dir.y, performance_dir.x);
      let liquid_breath = sin(
        time * 1.8 -
        performance_dist * 0.018
      );
      flow += liquid_tangent *
        (84.0 + performance_intensity * 188.0);
      flow += performance_dir * liquid_breath *
        (52.0 + performance_intensity * 146.0);
    } else if (performance_movement < 2.5) {
      let flock_id = f32(index % 3u);
      let flock_center = vec2f(
        size.x * (
          0.5 +
          sin(time * (0.8 + flock_id * 0.17) + flock_id * 2.094) * 0.3
        ),
        size.y * (
          0.5 +
          cos(time * (0.7 + flock_id * 0.13) + flock_id * 2.094) * 0.28
        )
      );
      let to_flock = flock_center - particle.position;
      let flock_distance = max(length(to_flock), 1.0);
      flow += to_flock / flock_distance *
        (130.0 + performance_intensity * 260.0);
      flow += vec2f(-to_flock.y, to_flock.x) / flock_distance *
        sin(time * 4.0 + f32(index) * 0.09) *
        (90.0 + performance_intensity * 220.0);
    } else if (performance_movement < 3.5) {
      let score_cell = vec2f(
        floor(particle.position.x / 68.0) * 68.0 + 34.0,
        floor(particle.position.y / 68.0) * 68.0 + 34.0
      );
      let score_snap = score_cell - particle.position;
      let axis = vec2f(
        sin(time * 3.1 + f32(index) * 0.17),
        cos(time * 2.7 + f32(index) * 0.13)
      );
      flow += score_snap * (1.4 + performance_intensity * 4.6);
      flow += axis * score_gate * (110.0 + performance_intensity * 360.0);
    } else if (performance_movement < 4.5) {
      let root_origin = vec2f(size.x * 0.5, size.y * 0.88);
      let from_root = particle.position - root_origin;
      let root_distance = max(length(from_root), 1.0);
      let root_direction = from_root / root_distance;
      let branch_angle = sin(
        root_distance * 0.025 -
        time * 0.6 +
        f32(index % 11u)
      );
      flow += root_direction *
        (72.0 + performance_intensity * 164.0);
      flow += vec2f(-root_direction.y, root_direction.x) *
        branch_angle *
        (110.0 + performance_intensity * 184.0);
      flow.y -= 54.0 + performance_intensity * 92.0;
    } else {
      let collapse_center = vec2f(size.x * 0.5, size.y * 0.48);
      let collapse_delta = particle.position - collapse_center;
      let collapse_distance = max(length(collapse_delta), 1.0);
      let collapse_direction = collapse_delta / collapse_distance;
      let collapse_tangent = vec2f(
        -collapse_direction.y,
        collapse_direction.x
      );
      let horizon = 1.0 - smoothstep(40.0, 760.0, collapse_distance);
      flow -= collapse_direction * horizon *
        (180.0 + performance_intensity * 380.0);
      flow += collapse_tangent * horizon *
        (120.0 + performance_intensity * 260.0);
      flow += collapse_direction * score_gate *
        (220.0 + performance_intensity * 520.0);
    }

    let stage_center = vec2f(size.x * 0.5, size.y * 0.5);
    let from_stage = particle.position - stage_center;
    let stage_distance = max(length(from_stage), 1.0);
    let stage_direction = from_stage / stage_distance;
    let stage_tangent = vec2f(-stage_direction.y, stage_direction.x);
    let cut_impulse = exp(-shot_progress * 18.0);

    flow += stage_direction * cut_impulse *
      (260.0 + performance_intensity * 620.0);

    if (performance_shot < 0.5) {
      flow += stage_tangent *
        sin(stage_distance * 0.024 - time * 3.4) *
        (80.0 + performance_intensity * 190.0);
    } else if (performance_shot < 1.5) {
      let scan_field = vec2f(
        sin(particle.position.y * 0.031 + time * 4.1),
        cos(particle.position.x * 0.019 - time * 2.7)
      );
      flow += scan_field *
        (150.0 + performance_intensity * 310.0);
    } else if (performance_shot < 2.5) {
      let cell_size = 74.0 + performance_movement * 9.0;
      let cell_center =
        floor(particle.position / cell_size + vec2f(0.5)) * cell_size;
      flow += (cell_center - particle.position) *
        (1.8 + performance_intensity * 5.2);
      flow += stage_tangent * score_gate *
        (180.0 + performance_intensity * 420.0);
    } else {
      let quadrant = sign(from_stage);
      let split_target =
        stage_center +
        quadrant * vec2f(size.x * 0.22, size.y * 0.17);
      let to_split = split_target - particle.position;
      let split_distance = max(length(to_split), 1.0);
      flow += to_split / split_distance *
        (220.0 + performance_intensity * 480.0);
      flow += vec2f(-to_split.y, to_split.x) / split_distance *
        sin(time * 5.2 + f32(index) * 0.021) *
        (140.0 + performance_intensity * 330.0);
    }
  }

  if (spawn_impulse > 0.002) {
    let seed_dir = from_seed / seed_dist;
    let wavefront = 1.0 - min(abs(seed_dist - (54.0 + spawn_age * (380.0 + global_energy * 220.0))) / 150.0, 1.0);
    let seeded_polarity = mix(-1.0, 1.0, step(0.5, hash(vec2f(f32(index), seed_hash * 997.0))));
    let tangent = vec2f(-seed_dir.y, seed_dir.x) * seeded_polarity;
    flow += seed_dir * wavefront * spawn_impulse *
      (170.0 + global_energy * 140.0 + symbol_pressure * 260.0);
    flow += tangent * spawn_impulse *
      (glyph_complexity * 92.0 + repeat_pressure * 180.0 + global_turbulence * 120.0);
  }

  let well = vec2f(
    size.x * (0.5 + sin(time * 0.19) * 0.21),
    size.y * (0.53 + cos(time * 0.17) * 0.17)
  );
  let to_well = well - particle.position;
  let well_dist = max(length(to_well), 1.0);
  let well_influence = 1.0 - smoothstep(120.0, 560.0, well_dist);
  flow += vec2f(-to_well.y, to_well.x) / well_dist *
    well_influence * (26.0 + particle.energy * 78.0) * common_scale;

  if (mode < 0.5) {
    flow += normalize(to_center) *
      (8.0 + particle.energy * 18.0 + global_viscosity * 15.0 + memory_viscosity * 12.0);
    particle.velocity *= 0.982 + global_viscosity * 0.012;
  } else if (mode < 1.5) {
    let swirl = vec2f(-to_center.y, to_center.x) / center_dist;
    let orbit_radius =
      min(size.x, size.y) * (0.2 + 0.08 * sin(f32(index) * 0.017 + time * 0.8));
    flow += swirl * (150.0 + particle.energy * 210.0);
    flow += normalize(to_center) * ((center_dist - orbit_radius) * 0.52);
    particle.velocity *= 0.997;
  } else if (mode < 2.5) {
    let smoke_wave = vec2f(
      sin(time * 0.42 + particle.position.y * 0.012 + f32(index) * 0.01),
      -1.0
    );
    flow += smoke_wave * (34.0 + particle.energy * 66.0);
    flow += vec2f(0.0, -18.0 - particle.radius * 2.8);
    particle.velocity.x *= 0.988;
    particle.velocity.y *= 0.996;
  } else if (mode < 3.5) {
    let root = vec2f(size.x * 0.5, size.y * 0.76);
    let from_root = particle.position - root;
    let root_dist = max(length(from_root), 1.0);
    let branch_dir = from_root / root_dist;
    let branch_tangent = vec2f(-branch_dir.y, branch_dir.x);
    let branch = vec2f(
      sin(time * 0.18 + particle.position.x * 0.02),
      cos(time * 0.16 + particle.position.y * 0.02)
    );
    flow += branch_dir * (38.0 + particle.energy * 96.0);
    flow += branch_tangent * sin(root_dist * 0.028 + time * 0.7) * 46.0;
    flow += branch * (28.0 + particle.energy * 32.0 + global_fertility * 48.0);
    flow += vec2f(0.0, -14.0);
    particle.velocity *= 0.956;
  } else {
    let row = floor(particle.position.y / 42.0) * 42.0 + 21.0;
    let column = floor(particle.position.x / 54.0) * 54.0 + 27.0;
    let snap = vec2f(column, row) - particle.position;
    let glitch = vec2f(
      sin(time * 23.0 + f32(index) * 0.37),
      cos(time * 19.0 + f32(index) * 0.41)
    );
    flow += glitch * (260.0 + particle.energy * 310.0);
    flow += snap * vec2f(18.0, 28.0);
    particle.velocity *= 0.86;

    if (hash(vec2f(f32(index), floor(time * (14.0 + symbol_pressure * 16.0)))) > 0.992 - symbol_pressure * 0.018) {
      particle.position.x += (hash(vec2f(f32(index), time)) - 0.5) * 260.0;
    }
  }

  let pointer_active = params.pointer.z;
  let pointer_down = params.pointer.w;
  let pointer_pulse = params.extra.x;
  let pointer_vortex = params.extra.y;
  let pointer_drag = params.extra.zw;
  let pointer_delta = particle.position - params.pointer.xy;
  let pointer_dist = max(length(pointer_delta), 1.0);

  if (pointer_active > 0.5 && pointer_dist < 360.0) {
    let influence = pow(1.0 - pointer_dist / 360.0, 1.35);
    let direction = pointer_delta / pointer_dist;

    if (pointer_down > 0.5) {
      flow -= direction * influence * 310.0;
      flow += pointer_drag * influence * 2.8;
    } else {
      flow += direction * influence * 126.0;
    }

    if (pointer_pulse > 0.001) {
      let ring = 1.0 - min(abs(pointer_dist - 128.0) / 128.0, 1.0);
      flow += direction * ring * pointer_pulse * 560.0;
    }

    if (pointer_vortex > 0.001) {
      let tangent = vec2f(-direction.y, direction.x);
      flow += tangent * influence * pointer_vortex * 760.0;
      flow -= direction * influence * pointer_vortex * 118.0;
    }
  }

  flow += membraneForce(particle.position, size) * 72.0;

  particle.velocity += flow * dt;
  particle.position += particle.velocity * dt;
  particle.age += dt;

  if (particle.age > particle.life) {
    particle.velocity *= 0.965;
    particle.position.y += dt * (16.0 + particle.radius);
    particle.color.a *= 0.998;
  }

  if (particle.age > particle.life * 1.72) {
    let cycle = floor(time * 0.29);
    let seed = vec2f(f32(index), cycle);
    let angle = hash(seed) * TAU;
    let rand_a = hash(seed + 13.7);
    let rand_b = hash(seed + 31.3);

    if (mode < 0.5) {
      let distance = 22.0 + rand_a * (160.0 + particle.energy * 180.0);
      particle.position = center + vec2f(cos(angle), sin(angle)) * distance;
      particle.velocity = vec2f(cos(angle + 1.57), sin(angle + 1.57)) *
        (18.0 + particle.energy * 78.0);
    } else if (mode < 1.5) {
      let distance = min(size.x, size.y) * (0.18 + rand_a * 0.24);
      particle.position =
        center + vec2f(cos(angle), sin(angle) * 0.72) * distance;
      particle.velocity = vec2f(cos(angle + 1.57), sin(angle + 1.57)) *
        (90.0 + particle.energy * 120.0);
    } else if (mode < 2.5) {
      particle.position = vec2f(
        size.x * (0.18 + rand_a * 0.64),
        size.y * (0.72 + rand_b * 0.18)
      );
      particle.velocity = vec2f(
        (hash(seed + 9.1) - 0.5) * 48.0,
        -36.0 - particle.energy * 74.0
      );
    } else if (mode < 3.5) {
      let root = vec2f(size.x * 0.5, size.y * 0.76);
      let branch_angle = -2.42 + rand_a * 3.04;
      let distance = 26.0 + rand_b * min(size.x, size.y) * 0.34;
      particle.position =
        root + vec2f(cos(branch_angle), sin(branch_angle) * 0.9) * distance;
      particle.velocity = vec2f(cos(branch_angle), sin(branch_angle)) *
        (28.0 + particle.energy * 92.0);
    } else {
      let cell = vec2f(
        floor(rand_a * 18.0),
        floor(rand_b * 10.0)
      );
      particle.position = vec2f(
        (cell.x + hash(seed + 5.7)) / 18.0 * size.x,
        (cell.y + 0.42 + hash(seed + 8.3) * 0.16) / 10.0 * size.y
      );
      particle.velocity = vec2f(
        mix(-1.0, 1.0, hash(seed + 10.2)) *
          (140.0 + particle.energy * 280.0),
        (hash(seed + 11.6) - 0.5) * 44.0
      );
    }

    particle.age = hash(seed + 31.3) * particle.life * 0.18;
    var restored_alpha = 0.42 + particle.energy * 0.28;
    if (mode > 1.5 && mode < 2.5) {
      restored_alpha = 0.16 + particle.energy * 0.16;
    } else if (mode > 3.5) {
      restored_alpha = 0.28 + particle.energy * 0.22;
    }
    particle.color.a = max(particle.color.a, restored_alpha);
  }

  particles[index] = particle;
}
