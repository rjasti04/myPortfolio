import { prefersReducedMotion, supportsHover } from "./config.js";

export function initTilt() {
  if (prefersReducedMotion.matches || !supportsHover.matches) return;
  
  const cards = document.querySelectorAll(".tilt-card");
  
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
      card.style.transform = "";
      card.style.transition = "";
    });
  });
}
