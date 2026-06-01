struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@group(0) @binding(0) var trail_sampler: sampler;
@group(0) @binding(1) var trail_texture: texture_2d<f32>;

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
  let trail = textureSample(trail_texture, trail_sampler, input.uv);
  let luminance = dot(trail.rgb, vec3f(0.2126, 0.7152, 0.0722));
  let alpha = clamp(trail.a + luminance * 0.32, 0.0, 0.82);
  let color = trail.rgb * (0.82 + luminance * 0.34);

  return vec4f(color, alpha);
}
