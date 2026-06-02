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
};

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) local: vec2f,
  @location(1) color: vec4f,
  @location(2) age_ratio: f32,
  @location(3) energy: f32,
  @location(4) speed: f32,
};

@group(0) @binding(0) var<storage, read> particles: array<Particle>;
@group(0) @binding(1) var<uniform> params: SimParams;

const CORNERS = array<vec2f, 6>(
  vec2f(-1.0, -1.0),
  vec2f(1.0, -1.0),
  vec2f(-1.0, 1.0),
  vec2f(-1.0, 1.0),
  vec2f(1.0, -1.0),
  vec2f(1.0, 1.0)
);

@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> VertexOut {
  let particle_index = vertex_index / 6u;
  let corner = CORNERS[vertex_index % 6u];
  let particle = particles[particle_index];
  let radius = max(particle.radius, 1.0);
  let pixel_position = particle.position + corner * radius * 2.65;
  let size = max(params.frame.zw, vec2f(1.0));
  let clip = vec2f(
    pixel_position.x / size.x * 2.0 - 1.0,
    1.0 - pixel_position.y / size.y * 2.0
  );

  var out: VertexOut;
  out.position = vec4f(clip, 0.0, 1.0);
  out.local = corner;
  out.color = particle.color;
  out.age_ratio = clamp(particle.age / max(particle.life, 0.01), 0.0, 1.0);
  out.energy = particle.energy;
  out.speed = clamp(length(particle.velocity) / 420.0, 0.0, 1.0);
  return out;
}

@fragment
fn fs_main(input: VertexOut) -> @location(0) vec4f {
  let mode = params.behavior.x;
  var dist = length(input.local);

  if (mode > 3.5) {
    dist = max(abs(input.local.x), abs(input.local.y));
  }

  if (dist > 1.0) {
    discard;
  }

  var core = pow(1.0 - dist, 1.45);
  var rim = pow(smoothstep(1.0, 0.42, dist), 2.6) * 0.28;
  var hot = pow(1.0 - dist, 7.0) * (0.7 + input.energy * 0.72);

  if (mode > 1.5 && mode < 2.5) {
    core = pow(1.0 - dist, 0.92) * 0.42;
    rim = pow(smoothstep(1.0, 0.2, dist), 1.4) * 0.18;
    hot *= 0.16;
  } else if (mode > 3.5) {
    core = pow(1.0 - dist, 0.8);
    rim = step(0.78, dist) * 0.08;
    hot = pow(1.0 - dist, 3.0) * (0.35 + input.speed * 0.55);
  }

  let old_fade = mix(1.0, 0.34, smoothstep(0.68, 1.0, input.age_ratio));
  let density_fade = mix(1.0, 0.08, smoothstep(12000.0, 72000.0, params.behavior.z));
  var alpha = input.color.a * (core + rim) * old_fade * density_fade;
  var brightness = 0.54 + core * 0.68 + hot * 0.42 + input.speed * 0.24;

  if (mode > 0.5 && mode < 1.5) {
    alpha *= 0.68;
    brightness += input.speed * 0.36;
  } else if (mode > 1.5 && mode < 2.5) {
    alpha *= 0.54;
    brightness *= 0.68;
  } else if (mode > 2.5 && mode < 3.5) {
    alpha *= 0.82;
    brightness += 0.12;
  } else if (mode > 3.5) {
    alpha *= 0.74;
    brightness += 0.28;
  }

  return vec4f(input.color.rgb * brightness, alpha);
}
