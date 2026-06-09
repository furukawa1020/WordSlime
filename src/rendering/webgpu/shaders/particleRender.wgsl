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
  let mode = params.behavior.x;
  let signature = params.signature;
  let glyphs = params.glyphs;
  let radius = max(particle.radius, 1.0);
  let velocity_dir = normalize(particle.velocity + vec2f(0.01, 0.003));
  let side_dir = vec2f(-velocity_dir.y, velocity_dir.x);
  var x_scale = radius * (2.55 + signature.y * 0.32 + glyphs.z * 0.42);
  var y_scale = radius * (2.55 + signature.y * 0.32 + glyphs.y * 0.34);
  var offset = corner * x_scale;

  if (mode > 0.5 && mode < 1.5) {
    x_scale = radius * 0.95;
    y_scale = radius * 0.95;
    offset = corner * x_scale;
  } else if (mode > 1.5 && mode < 2.5) {
    x_scale = radius * (5.2 + particle.energy * 2.8);
    y_scale = radius * (1.35 + particle.energy * 1.1);
    offset = side_dir * corner.x * x_scale + velocity_dir * corner.y * y_scale;
  } else if (mode > 2.5 && mode < 3.5) {
    x_scale = radius * 0.62;
    y_scale = radius * (9.5 + particle.energy * 7.0);
    offset = side_dir * corner.x * x_scale + velocity_dir * corner.y * y_scale;
  } else if (mode > 3.5) {
    x_scale = radius * (2.4 + particle.energy * 1.5);
    y_scale = radius * (0.72 + particle.energy * 0.48);
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
  out.speed = clamp(length(particle.velocity) / 420.0, 0.0, 1.0);
  return out;
}

@fragment
fn fs_main(input: VertexOut) -> @location(0) vec4f {
  let mode = params.behavior.x;
  let signature = params.signature;
  let glyphs = params.glyphs;
  var dist = length(input.local);

  if (mode > 3.5) {
    dist = max(abs(input.local.x), abs(input.local.y));
  } else if (mode > 2.5 && mode < 3.5) {
    dist = max(abs(input.local.x) * 1.8, abs(input.local.y) * 0.74);
  } else if (mode > 1.5 && mode < 2.5) {
    dist = length(input.local * vec2f(0.45, 1.05));
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
  } else if (mode > 2.5 && mode < 3.5) {
    core = pow(1.0 - dist, 1.15);
    rim = pow(smoothstep(1.0, 0.58, dist), 4.0) * 0.18;
    hot *= 0.28;
  } else if (mode > 3.5) {
    core = pow(1.0 - dist, 0.8);
    rim = step(0.78, dist) * 0.08;
    hot = pow(1.0 - dist, 3.0) * (0.35 + input.speed * 0.55);
  }

  let old_fade = mix(1.0, 0.34, smoothstep(0.68, 1.0, input.age_ratio));
  let density_fade = mix(0.82, 0.055, smoothstep(3000.0, 52000.0, params.behavior.z));
  var alpha = input.color.a * (core + rim) * old_fade * density_fade;
  var brightness = 0.54 + core * 0.68 + hot * (0.42 + signature.x * 0.18) + input.speed * 0.24;
  var tint = input.color.rgb;
  tint += vec3f(0.04, 0.34, 0.28) * glyphs.w * core * 0.2;
  tint += vec3f(0.52, 0.02, 0.36) * glyphs.z * hot * 0.16;

  if (mode > 0.5 && mode < 1.5) {
    alpha *= 0.56;
    brightness += input.speed * 0.36;
  } else if (mode > 1.5 && mode < 2.5) {
    let vapor = 0.58 + sin(input.local.x * 21.0 + input.local.y * 9.0 + input.age_ratio * 14.0) * 0.32;
    alpha *= 0.34 * vapor;
    brightness *= 0.58;
  } else if (mode > 2.5 && mode < 3.5) {
    alpha *= 0.5;
    brightness += 0.12;
  } else if (mode > 3.5) {
    alpha *= 0.42;
    brightness += 0.28;
  }

  return vec4f(tint * brightness, alpha);
}
