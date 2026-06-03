struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

struct SimParams {
  frame: vec4f,
  pointer: vec4f,
  behavior: vec4f,
  extra: vec4f,
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
  let trail = textureSample(trail_texture, trail_sampler, input.uv);
  let luminance = dot(trail.rgb, vec3f(0.2126, 0.7152, 0.0722));
  var alpha = clamp(trail.a * 0.72 + luminance * 0.2, 0.0, 0.64);
  var color = trail.rgb * (0.66 + luminance * 0.26);

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
