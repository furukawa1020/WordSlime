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

@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(1) var<uniform> params: SimParams;

const TAU = 6.28318530718;

fn hash(point: vec2f) -> f32 {
  let p = fract(vec3f(point.xyx) * 0.1031);
  let q = p + dot(p, p.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

fn noise(point: vec2f) -> f32 {
  let cell = floor(point);
  let local = fract(point);
  let curve = local * local * (3.0 - 2.0 * local);
  let a = hash(cell);
  let b = hash(cell + vec2f(1.0, 0.0));
  let c = hash(cell + vec2f(0.0, 1.0));
  let d = hash(cell + vec2f(1.0, 1.0));
  return mix(mix(a, b, curve.x), mix(c, d, curve.x), curve.y);
}

fn curlFlow(position: vec2f, time: f32, energy: f32) -> vec2f {
  let point = position * 0.0046 + vec2f(time * 0.032, -time * 0.024);
  let step = 0.052;
  let up = noise(point + vec2f(0.0, step));
  let down = noise(point - vec2f(0.0, step));
  let right = noise(point + vec2f(step, 0.0));
  let left = noise(point - vec2f(step, 0.0));
  let gradient = vec2f(up - down, right - left);
  return normalize(vec2f(gradient.x, -gradient.y) + vec2f(0.001)) *
    (22.0 + energy * 94.0);
}

fn membraneForce(position: vec2f, size: vec2f) -> vec2f {
  let margin = 90.0;
  var force = vec2f(0.0);

  if (position.x < margin) {
    force.x += (margin - position.x) / margin;
  }
  if (position.x > size.x - margin) {
    force.x -= (position.x - (size.x - margin)) / margin;
  }
  if (position.y < margin) {
    force.y += (margin - position.y) / margin;
  }
  if (position.y > size.y - margin) {
    force.y -= (position.y - (size.y - margin)) / margin;
  }

  return force;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) global_id: vec3u) {
  let index = global_id.x;
  let count = u32(params.behavior.z);

  if (index >= count) {
    return;
  }

  var particle = particles[index];
  let raw_dt = min(params.frame.x, 0.033);
  let reduce_motion = params.behavior.y;
  let dt = raw_dt * mix(1.0, 0.32, reduce_motion);
  let time = params.frame.y;
  let size = max(params.frame.zw, vec2f(1.0));
  let mode = params.behavior.x;

  let center = vec2f(size.x * 0.5, size.y * 0.54);
  let to_center = center - particle.position;
  let center_dist = max(length(to_center), 1.0);

  let wave = vec2f(
    sin(time * (0.72 + particle.energy) + particle.position.y * 0.006),
    cos(time * (0.61 + particle.energy) + particle.position.x * 0.005)
  );

  var flow = wave * (10.0 + particle.energy * 46.0);
  flow += curlFlow(particle.position, time, particle.energy);

  let well = vec2f(
    size.x * (0.5 + sin(time * 0.19) * 0.21),
    size.y * (0.53 + cos(time * 0.17) * 0.17)
  );
  let to_well = well - particle.position;
  let well_dist = max(length(to_well), 1.0);
  let well_influence = 1.0 - smoothstep(120.0, 560.0, well_dist);
  flow += vec2f(-to_well.y, to_well.x) / well_dist *
    well_influence * (26.0 + particle.energy * 78.0);

  if (mode < 0.5) {
    flow += normalize(to_center) * (8.0 + particle.energy * 18.0);
    particle.velocity *= 0.988;
  } else if (mode < 1.5) {
    let swirl = vec2f(-to_center.y, to_center.x) / center_dist;
    flow += swirl * (34.0 + particle.energy * 36.0);
    flow += normalize(to_center) * 12.0;
    particle.velocity *= 0.996;
  } else if (mode < 2.5) {
    flow += vec2f(22.0, -18.0) * (0.45 + particle.energy);
    particle.velocity *= 0.982;
  } else if (mode < 3.5) {
    let branch = vec2f(
      sin(time * 0.18 + particle.position.x * 0.018),
      cos(time * 0.16 + particle.position.y * 0.018)
    );
    flow += normalize(to_center) * (3.0 + particle.energy * 7.0);
    flow += branch * (18.0 + particle.energy * 16.0);
    particle.velocity *= 0.972;
  } else {
    let glitch = vec2f(
      sin(time * 23.0 + f32(index) * 0.37),
      cos(time * 19.0 + f32(index) * 0.41)
    );
    flow += glitch * (130.0 + particle.energy * 160.0);
    particle.velocity *= 0.94;
  }

  let pointer_active = params.pointer.z;
  let pointer_down = params.pointer.w;
  let pointer_pulse = params.extra.x;
  let pointer_vortex = params.extra.y;
  let pointer_drag = params.extra.zw;
  let pointer_delta = particle.position - params.pointer.xy;
  let pointer_dist = max(length(pointer_delta), 1.0);

  if (pointer_active > 0.5 && pointer_dist < 360.0) {
    let influence = pow(1.0 - pointer_dist / 360.0, 1.35);
    let direction = pointer_delta / pointer_dist;

    if (pointer_down > 0.5) {
      flow -= direction * influence * 310.0;
      flow += pointer_drag * influence * 2.8;
    } else {
      flow += direction * influence * 126.0;
    }

    if (pointer_pulse > 0.001) {
      let ring = 1.0 - min(abs(pointer_dist - 128.0) / 128.0, 1.0);
      flow += direction * ring * pointer_pulse * 560.0;
    }

    if (pointer_vortex > 0.001) {
      let tangent = vec2f(-direction.y, direction.x);
      flow += tangent * influence * pointer_vortex * 760.0;
      flow -= direction * influence * pointer_vortex * 118.0;
    }
  }

  flow += membraneForce(particle.position, size) * 72.0;

  particle.velocity += flow * dt;
  particle.position += particle.velocity * dt;
  particle.age += dt;

  if (particle.age > particle.life) {
    particle.velocity *= 0.965;
    particle.position.y += dt * (16.0 + particle.radius);
    particle.color.a *= 0.998;
  }

  if (particle.age > particle.life * 1.72) {
    let cycle = floor(time * 0.29);
    let seed = vec2f(f32(index), cycle);
    let angle = hash(seed) * TAU;
    let distance = 22.0 + hash(seed + 13.7) * (160.0 + particle.energy * 180.0);
    particle.position = center + vec2f(cos(angle), sin(angle)) * distance;
    particle.velocity = vec2f(cos(angle + 1.57), sin(angle + 1.57)) *
      (18.0 + particle.energy * 78.0);
    particle.age = hash(seed + 31.3) * particle.life * 0.18;
    particle.color.a = max(particle.color.a, 0.42 + particle.energy * 0.28);
  }

  particles[index] = particle;
}
