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
  let signature = params.signature;
  let glyphs = params.glyphs;
  let signal = params.signal;
  let reservoir = params.reservoir;
  let data_noise = signature.z * 0.55 + glyphs.w * 0.35 + glyphs.z * 0.22;
  let spawn_impulse = exp(-signal.x * (1.5 + glyphs.z * 0.7)) * smoothstep(0.0, 0.02, signature.x + glyphs.x);

  var uv = input.uv;
  uv += vec2f(
    sin(time * (0.39 + glyphs.y * 0.42) + input.uv.y * (16.0 + glyphs.w * 8.0)),
    cos(time * (0.34 + glyphs.z * 0.46) + input.uv.x * (14.0 + signature.z * 9.0))
  ) * mix(0.0028 + data_noise * 0.0019, 0.0009, reduce_motion);

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
  var fade = mix(
    0.918 + signature.y * 0.028 + glyphs.y * 0.018 + reservoir.y * 0.028 + reservoir.w * 0.018,
    0.852,
    reduce_motion
  );
  fade -= glyphs.z * 0.024 + spawn_impulse * 0.035;
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
