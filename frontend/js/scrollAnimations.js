export class ScrollAnimationController {
  constructor(constellationBackground) {
    this.constellation = constellationBackground;
    this.sections = new Map();
    this.observer = null;
    this.init();
  }

  init() {
    const options = {
      root: null,
      rootMargin: '0px',
      threshold: [0, 0.25, 0.5, 0.75, 1.0]
    };

    this.observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        const config = this.sections.get(entry.target);
        if (!config) return;

        if (entry.isIntersecting) {
          const ratio = entry.intersectionRatio;
          this.applyAnimationConfig(config, ratio);
        }
      });
    }, options);
  }

  registerSection(element, config) {
    const defaultConfig = {
      speed: 1.0,
      colorIntensity: 1.0,
      ...config
    };
    
    this.sections.set(element, defaultConfig);
    this.observer.observe(element);
  }

  applyAnimationConfig(config, ratio) {
    const speed = config.speed * ratio + (1 - ratio);
    const intensity = config.colorIntensity * ratio + (1 - ratio);
    
    this.constellation.setAnimationSpeed(speed);
    this.constellation.setColorIntensity(intensity);
  }

  unregisterSection(element) {
    this.observer.unobserve(element);
    this.sections.delete(element);
  }

  destroy() {
    this.observer.disconnect();
    this.sections.clear();
  }
}

// Usage example:
// const constellation = new ConstellationBackground(document.getElementById('bg-container'));
// const scrollController = new ScrollAnimationController(constellation);
// 
// scrollController.registerSection(document.getElementById('hero'), {
//   speed: 1.5,
//   colorIntensity: 1.2
// });
// 
// scrollController.registerSection(document.getElementById('projects'), {
//   speed: 0.5,
//   colorIntensity: 0.7
// });
