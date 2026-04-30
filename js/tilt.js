import { prefersReducedMotion, supportsHover } from "./config.js";
import { animateSpring } from "./physics.js";

export function initTilt() {
  if (prefersReducedMotion.matches || !supportsHover.matches) return;
  
  const cards = document.querySelectorAll(".tilt-card");
  const springConfig = { stiffness: 400, damping: 30 };
  
  cards.forEach(card => {
    card.addEventListener("mousemove", (e) => {
      const rect = card.getBoundingClientRect();
      const relativeX = e.clientX - rect.left;
      const relativeY = e.clientY - rect.top;
      
      const multiplier = 8; // degrees max rotation
      const xCalc = (relativeX / rect.width - 0.5) * multiplier;
      const yCalc = (relativeY / rect.height - 0.5) * -multiplier; 
      
      card.style.transform = `perspective(1000px) rotateX(${yCalc}deg) rotateY(${xCalc}deg) translateY(-8px) scale3d(1.02, 1.02, 1.02)`;
      card.style.transition = "none";
    });
    
    card.addEventListener("mouseleave", () => {
      // Spring-animated return to rest
      const current = card.style.transform;
      const match = current.match(/rotateX\(([-\d.]+)deg\).*rotateY\(([-\d.]+)deg\).*translateY\(([-\d.]+)px\)/);
      
      if (!match) {
        card.style.transform = "";
        card.style.transition = "";
        return;
      }
      
      const startRotX = parseFloat(match[1]);
      const startRotY = parseFloat(match[2]);
      const startY = parseFloat(match[3]);
      let progress = { rotX: startRotX, rotY: startRotY, y: startY, scale: 1.02 };
      let done = { rotX: false, rotY: false, y: false, scale: false };

      animateSpring({
        from: startRotX, to: 0,
        onUpdate: (v) => { progress.rotX = v; applyTiltTransform(); },
        onComplete: () => { done.rotX = true; checkDone(); },
        config: springConfig
      });
      animateSpring({
        from: startRotY, to: 0,
        onUpdate: (v) => { progress.rotY = v; applyTiltTransform(); },
        onComplete: () => { done.rotY = true; checkDone(); },
        config: springConfig
      });
      animateSpring({
        from: startY, to: 0,
        onUpdate: (v) => { progress.y = v; applyTiltTransform(); },
        onComplete: () => { done.y = true; checkDone(); },
        config: springConfig
      });
      animateSpring({
        from: 1.02, to: 1,
        onUpdate: (v) => { progress.scale = v; applyTiltTransform(); },
        onComplete: () => { done.scale = true; checkDone(); },
        config: springConfig
      });

      function applyTiltTransform() {
        card.style.transform = `perspective(1000px) rotateX(${progress.rotX}deg) rotateY(${progress.rotY}deg) translateY(${progress.y}px) scale3d(${progress.scale}, ${progress.scale}, ${progress.scale})`;
      }

      function checkDone() {
        if (done.rotX && done.rotY && done.y && done.scale) {
          card.style.transform = "";
          card.style.transition = "";
        }
      }
    });
  });
}
