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

  if (mode < 0.5) {
    flow += normalize(to_center) * (8.0 + particle.energy * 18.0);
    particle.velocity *= 0.988;
  } else if (mode < 1.5) {
    let swirl = vec2f(-to_center.y, to_center.x) / center_dist;
    flow += swirl * (34.0 + particle.energy * 36.0);
    flow += normalize(to_center) * 12.0;
    particle.velocity *= 0.996;
  } else {
    flow += vec2f(22.0, -18.0) * (0.45 + particle.energy);
    particle.velocity *= 0.982;
  }

  let pointer_active = params.pointer.z;
  let pointer_down = params.pointer.w;
  let pointer_delta = particle.position - params.pointer.xy;
  let pointer_dist = max(length(pointer_delta), 1.0);

  if (pointer_active > 0.5 && pointer_dist < 220.0) {
    let influence = (1.0 - pointer_dist / 220.0);
    let direction = pointer_delta / pointer_dist;

    if (pointer_down > 0.5) {
      flow -= direction * influence * 180.0;
    } else {
      flow += direction * influence * 92.0;
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

  particles[index] = particle;
}
