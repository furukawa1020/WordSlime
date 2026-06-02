struct SimParams {
  frame: vec4f,
  pointer: vec4f,
  behavior: vec4f,
  extra: vec4f,
};

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
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
  let size = max(params.frame.zw, vec2f(1.0));
  let time = params.frame.y;
  let mode = params.behavior.x;
  let reduce_motion = params.behavior.y;
  let pointer_uv = params.pointer.xy / size;
  let pointer_delta = input.uv - pointer_uv;
  let pointer_dist = length(pointer_delta);
  let pointer_active = params.pointer.z;
  let pointer_down = params.pointer.w;

  var uv = input.uv;
  uv += vec2f(
    sin(time * 0.39 + input.uv.y * 16.0),
    cos(time * 0.34 + input.uv.x * 14.0)
  ) * mix(0.0028, 0.0009, reduce_motion);

  if (mode > 0.5 && mode < 1.5) {
    let centered = input.uv - vec2f(0.5);
    uv += vec2f(-centered.y, centered.x) * 0.004;
  } else if (mode > 2.5 && mode < 3.5) {
    uv += vec2f(
      sin(input.uv.y * 28.0 + time * 0.22),
      cos(input.uv.x * 27.0 - time * 0.2)
    ) * 0.0027;
  } else if (mode > 3.5) {
    let snap = floor(input.uv * 42.0 + time * 3.0);
    uv += (fract(snap * vec2f(0.173, 0.281)) - 0.5) * 0.0038;
  }

  if (pointer_active > 0.5 && pointer_dist < 0.32) {
    let direction = pointer_delta / max(pointer_dist, 0.002);
    let influence = pow(1.0 - pointer_dist / 0.32, 1.8);
    uv -= direction * influence * mix(0.006, 0.016, pointer_down);
  }

  let sample_uv = clamp(uv, vec2f(0.001), vec2f(0.999));
  let sample = textureSample(trail_texture, trail_sampler, sample_uv);
  var fade = mix(0.918, 0.852, reduce_motion);
  if (mode > 0.5 && mode < 1.5) {
    fade *= 0.94;
  } else if (mode > 1.5 && mode < 2.5) {
    fade = max(fade, 0.934);
  } else if (mode > 2.5 && mode < 3.5) {
    fade *= 0.94;
  } else if (mode > 3.5) {
    fade *= 0.72;
  }
  let color = sample.rgb * fade;
  let alpha = sample.a * fade;

  return vec4f(color, alpha);
}
