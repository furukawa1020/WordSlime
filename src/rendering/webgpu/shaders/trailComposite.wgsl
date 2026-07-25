struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
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

@group(0) @binding(0) var trail_sampler: sampler;
@group(0) @binding(1) var trail_texture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: SimParams;

const POSITIONS = array<vec2f, 3>(
  vec2f(-1.0, -1.0),
  vec2f(3.0, -1.0),
  vec2f(-1.0, 3.0)
);

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
  let mode = params.behavior.x;
  let signature = params.signature;
  let glyphs = params.glyphs;
  let signal = params.signal;
  let reservoir = params.reservoir;
  let performance = params.performance;
  let trail = textureSample(trail_texture, trail_sampler, input.uv);
  let luminance = dot(trail.rgb, vec3f(0.2126, 0.7152, 0.0722));
  let spawn_impulse = exp(-signal.x * (1.4 + glyphs.z * 0.6)) * smoothstep(0.0, 0.02, signature.x + glyphs.x);
  var alpha = clamp(trail.a * (0.66 + signature.y * 0.16 + glyphs.y * 0.12) + luminance * 0.2, 0.0, 0.68);
  var color = trail.rgb * (0.64 + luminance * 0.26 + signature.x * 0.08);
  color += vec3f(0.05, 0.48, 0.38) * glyphs.w * luminance * 0.16;
  color += vec3f(0.5, 0.08, 0.32) * glyphs.z * smoothstep(0.22, 0.9, luminance) * 0.16;
  color += vec3f(0.32, 0.9, 0.78) * spawn_impulse * luminance * 0.14;
  color += vec3f(0.12, 0.74, 0.34) * reservoir.w * luminance * 0.14;
  let performance_color = mix(
    vec3f(0.05, 0.96, 0.78),
    vec3f(0.88, 0.08, 0.92),
    fract(floor(performance.w) * 0.37)
  );
  color += performance_color * performance.x * performance.z * luminance * 0.34;
  alpha = clamp(
    alpha + performance.x * performance.z * luminance * 0.16,
    0.0,
    0.78
  );
  alpha = clamp(alpha + spawn_impulse * luminance * 0.08, 0.0, 0.7);

  if (mode > 0.5 && mode < 1.5) {
    color = mix(color, vec3f(0.95, 0.72, 0.22), smoothstep(0.12, 0.9, luminance) * 0.34);
    alpha *= 0.74;
  } else if (mode > 1.5 && mode < 2.5) {
    color = mix(color, vec3f(0.14, 0.28, 0.72), 0.38);
    alpha = clamp(alpha * 0.68 + luminance * 0.05, 0.0, 0.5);
  } else if (mode > 2.5 && mode < 3.5) {
    color = mix(color, vec3f(0.1, 0.82, 0.32), 0.32);
    alpha *= 0.68;
  } else if (mode > 3.5) {
    let scanline = 0.62 + step(0.5, fract(input.uv.y * 90.0 + params.frame.y * 18.0)) * 0.38;
    color = mix(color, vec3f(0.04, 0.95, 1.0), 0.28);
    color.r += smoothstep(0.34, 0.9, luminance) * 0.22;
    color *= scanline;
    alpha *= 0.92;
  }

  return vec4f(color, alpha);
}
