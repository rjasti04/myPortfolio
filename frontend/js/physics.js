/**
 * A lightweight spring physics engine for vanilla JS animations.
 * Mimics Framer Motion / Popmotion spring behavior.
 */

export class Spring {
  constructor({ stiffness = 400, damping = 30, mass = 1, restSpeed = 0.01, restDelta = 0.01 } = {}) {
    this.stiffness = stiffness;
    this.damping = damping;
    this.mass = mass;
    this.restSpeed = restSpeed;
    this.restDelta = restDelta;
  }

  /**
   * Calculates the next value in the spring animation.
   * @param {number} from - Current value
   * @param {number} to - Target value
   * @param {number} velocity - Current velocity
   * @param {number} dt - Delta time in seconds
   * @returns {{ value: number, velocity: number, done: boolean }}
   */
  next(from, to, velocity, dt) {
    const force = -this.stiffness * (from - to) - this.damping * velocity;
    const acceleration = force / this.mass;
    const newVelocity = velocity + acceleration * dt;
    const newValue = from + newVelocity * dt;

    const isResting = Math.abs(newVelocity) < this.restSpeed && Math.abs(newValue - to) < this.restDelta;

    return {
      value: isResting ? to : newValue,
      velocity: newVelocity,
      done: isResting
    };
  }
}

/**
 * Animate a value using spring physics.
 * @param {Object} options
 * @param {number} options.from - Initial value
 * @param {number} options.to - Target value
 * @param {Function} options.onUpdate - Callback for value changes
 * @param {Function} options.onComplete - Callback when animation finishes
 * @param {Object} options.config - Spring configuration (stiffness, damping)
 */
export function animateSpring({ from, to, onUpdate, onComplete, config = {} }) {
  const spring = new Spring(config);
  let current = from;
  let velocity = 0;
  let lastTime = performance.now();

  function tick(now) {
    const dt = (now - lastTime) / 1000;
    lastTime = now;

    // Cap dt to avoid explosions on long frame drops
    const cappedDt = Math.min(dt, 0.032);
    
    const result = spring.next(current, to, velocity, cappedDt);
    current = result.value;
    velocity = result.velocity;

    onUpdate(current);

    if (result.done) {
      if (onComplete) onComplete();
    } else {
      requestAnimationFrame(tick);
    }
  }

  requestAnimationFrame(tick);
}
