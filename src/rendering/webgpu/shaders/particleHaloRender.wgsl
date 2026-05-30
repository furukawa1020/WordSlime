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
  let base_radius = max(particle.radius, 1.0);
  let halo_radius = base_radius * (6.2 + particle.energy * 4.4);
  let pixel_position = particle.position + corner * halo_radius;
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
  return out;
}

@fragment
fn fs_main(input: VertexOut) -> @location(0) vec4f {
  let dist = length(input.local);

  if (dist > 1.0) {
    discard;
  }

  let mode = params.behavior.x;
  let glow = pow(1.0 - dist, 3.2);
  let smoke = pow(1.0 - dist, 1.55) * 0.18;
  let old_fade = mix(1.0, 0.22, smoothstep(0.62, 1.0, input.age_ratio));
  var tint = input.color.rgb * (0.82 + input.energy * 0.42);

  if (mode > 3.5) {
    tint = mix(tint, vec3f(0.96, 0.42, 0.86), 0.34);
  } else if (mode > 2.5 && mode < 3.5) {
    tint = mix(tint, vec3f(0.56, 0.95, 0.64), 0.24);
  } else if (mode > 1.5 && mode < 2.5) {
    tint = mix(tint, vec3f(0.62, 0.86, 1.0), 0.2);
  }

  let alpha = input.color.a * (glow * 0.22 + smoke) * old_fade;
  return vec4f(tint * (0.68 + input.energy * 0.54), alpha);
}
