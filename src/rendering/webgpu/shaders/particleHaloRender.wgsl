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
  let mode = params.behavior.x;
  let base_radius = max(particle.radius, 1.0);
  let velocity_dir = normalize(particle.velocity + vec2f(0.01, 0.003));
  let side_dir = vec2f(-velocity_dir.y, velocity_dir.x);
  var x_scale = base_radius * (6.2 + particle.energy * 4.4);
  var y_scale = x_scale;
  var offset = corner * x_scale;

  if (mode > 0.5 && mode < 1.5) {
    x_scale = base_radius * (2.1 + particle.energy * 1.2);
    y_scale = x_scale;
    offset = corner * x_scale;
  } else if (mode > 1.5 && mode < 2.5) {
    x_scale = base_radius * (8.8 + particle.energy * 5.4);
    y_scale = base_radius * (2.2 + particle.energy * 1.6);
    offset = side_dir * corner.x * x_scale + velocity_dir * corner.y * y_scale;
  } else if (mode > 2.5 && mode < 3.5) {
    x_scale = base_radius * 1.6;
    y_scale = base_radius * (15.0 + particle.energy * 8.0);
    offset = side_dir * corner.x * x_scale + velocity_dir * corner.y * y_scale;
  } else if (mode > 3.5) {
    x_scale = base_radius * (4.8 + particle.energy * 2.6);
    y_scale = base_radius * (1.4 + particle.energy * 0.8);
    offset = vec2f(corner.x * x_scale, corner.y * y_scale);
  }

  let pixel_position = particle.position + offset;
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
  let mode = params.behavior.x;
  var dist = length(input.local);

  if (mode > 3.5) {
    dist = max(abs(input.local.x), abs(input.local.y));
  }

  if (dist > 1.0) {
    discard;
  }

  let glow = pow(1.0 - dist, 3.2);
  let smoke = pow(1.0 - dist, 1.55) * 0.18;
  let old_fade = mix(1.0, 0.22, smoothstep(0.62, 1.0, input.age_ratio));
  var tint = input.color.rgb * (0.82 + input.energy * 0.42);
  var halo_scale = 1.0;

  if (mode > 3.5) {
    tint = mix(tint, vec3f(0.96, 0.42, 0.86), 0.34);
    halo_scale = 0.34;
  } else if (mode > 2.5 && mode < 3.5) {
    tint = mix(tint, vec3f(0.56, 0.95, 0.64), 0.24);
    halo_scale = 0.36;
  } else if (mode > 1.5 && mode < 2.5) {
    tint = mix(tint, vec3f(0.62, 0.86, 1.0), 0.2);
    halo_scale = 0.46;
  } else if (mode > 0.5 && mode < 1.5) {
    tint = mix(tint, vec3f(1.0, 0.78, 0.24), 0.2);
    halo_scale = 0.32;
  }

  let alpha = input.color.a * (glow * 0.08 + smoke * 0.34) * old_fade;
  let density_fade = mix(0.55, 0.035, smoothstep(3000.0, 52000.0, params.behavior.z));
  return vec4f(tint * (0.54 + input.energy * 0.34), alpha * density_fade * halo_scale);
}
