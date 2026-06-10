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
};

@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(1) var<uniform> params: SimParams;

const TAU = 6.28318530718;

fn hash(point: vec2f) -> f32 {
  let p = fract(vec3f(point.xyx) * 0.1031);
  let q = p + dot(p, p.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) global_id: vec3u) {
  let index = global_id.x;
  let count = u32(params.behavior.z);

  if (index >= count) {
    return;
  }

  var particle = particles[index];
  let dt = min(params.frame.x, 0.033) * mix(1.0, 0.36, params.behavior.y);
  let time = params.frame.y;
  let size = max(params.frame.zw, vec2f(1.0));
  let mode = params.behavior.x;
  let signature = params.signature;
  let glyphs = params.glyphs;
  let signal = params.signal;
  let reservoir = params.reservoir;
  let input_live = smoothstep(0.0, 0.02, signature.x + glyphs.x);
  let memory_live = smoothstep(0.02, 0.3, reservoir.w);
  let spawn_impulse =
    exp(-signal.x * (1.65 + signature.z * 0.62 + glyphs.z * 0.82)) *
    input_live;
  let memory_energy = reservoir.x;
  let memory_viscosity = reservoir.y;
  let memory_turbulence = reservoir.z;
  let memory_complexity = reservoir.w;
  let random = hash(vec2f(f32(index), floor(time * 11.0) + signal.y * 997.0));

  if (spawn_impulse > 0.001) {
    let seed_center = vec2f(
      size.x * (0.5 + sin(signal.y * TAU) * 0.12),
      size.y * (0.52 + cos(signal.y * TAU * 1.7) * 0.1)
    );
    let from_seed = particle.position - seed_center;
    let seed_dist = max(length(from_seed), 1.0);
    let seed_dir = from_seed / seed_dist;
    let ring = 1.0 - min(abs(seed_dist - (40.0 + signal.x * (420.0 + signature.x * 220.0))) / 120.0, 1.0);
    let flash = ring * spawn_impulse;

    particle.velocity += seed_dir * flash * (24.0 + glyphs.z * 90.0 + signature.x * 52.0) * dt;
    particle.radius *= 1.0 + flash * (0.015 + glyphs.y * 0.035 + glyphs.z * 0.04);
    particle.energy = clamp(particle.energy + flash * (0.012 + signature.x * 0.03), 0.0, 1.0);
    particle.color.rgb = mix(
      particle.color.rgb,
      particle.color.rgb + vec3f(0.26 + glyphs.z * 0.22, 0.5 + signature.x * 0.2, 0.46 + glyphs.w * 0.22),
      flash * 0.1
    );
    particle.color.a = min(0.85, particle.color.a + flash * 0.018);
  }

  if (memory_live > 0.001) {
    let center = vec2f(
      size.x * (0.5 + sin(memory_energy * TAU + time * 0.05) * 0.18),
      size.y * (0.56 + cos(memory_turbulence * TAU + time * 0.04) * 0.12)
    );
    let from_memory = particle.position - center;
    let memory_dist = max(length(from_memory), 1.0);
    let memory_dir = from_memory / memory_dist;
    let tangent = vec2f(-memory_dir.y, memory_dir.x);
    let filament = pow(
      max(0.0, sin(memory_dist * (0.016 + memory_complexity * 0.02) - time * (0.9 + memory_energy))),
      10.0
    );
    let near_memory = 1.0 - smoothstep(130.0, 820.0, memory_dist);
    let condensation = filament * near_memory * memory_live;

    particle.velocity += tangent * condensation * (14.0 + memory_turbulence * 96.0) * dt;
    particle.velocity *= 1.0 - memory_viscosity * near_memory * dt * 0.11;
    particle.color.rgb += vec3f(0.02, 0.12, 0.05) * condensation * memory_complexity;
    particle.color.a = min(0.9, particle.color.a + condensation * 0.006);

    if (mode > 2.5 && mode < 3.5) {
      particle.radius *= 1.0 + condensation * 0.018;
    }
  }

  if (mode > 3.5) {
    let jump_gate = 0.996 - glyphs.z * 0.012 - reservoir.z * 0.006;
    if (random > jump_gate) {
      particle.position.x += (hash(vec2f(f32(index), time + 19.0)) - 0.5) *
        (36.0 + glyphs.z * 82.0);
      particle.color.rgb = particle.color.bgr;
    }
  } else if (mode > 1.5 && mode < 2.5) {
    particle.color.a *= 0.999 - glyphs.x * 0.0008;
  } else if (mode < 0.5) {
    particle.radius = mix(particle.radius, max(1.0, particle.radius * 0.995), dt * (0.6 + memory_viscosity));
  }

  particle.radius = clamp(particle.radius, 0.8, 36.0);
  particle.color.rgb = clamp(particle.color.rgb, vec3f(0.0), vec3f(1.35));
  particle.color.a = clamp(particle.color.a, 0.02, 0.95);
  particles[index] = particle;
}
