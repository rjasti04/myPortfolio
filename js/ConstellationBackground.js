import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

export class ConstellationBackground {
  constructor(container) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000,
    );
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.nodes = [];
    this.logicalLines = [];
    this.dataPackets = [];
    this.mouse = new THREE.Vector2();
    this.raycaster = new THREE.Raycaster();
    this.animationSpeed = 1.0;
    this.colorIntensity = 1.0;

    this.init();
  }

  init() {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.container.appendChild(this.renderer.domElement);

    this.camera.position.z = 50;

    this.createNodes(80);
    this.createConnections();
    this.createDataPackets(15);

    window.addEventListener("resize", () => this.onResize());
    window.addEventListener("mousemove", (e) => this.onMouseMove(e));

    this.animate();
  }

  createNodes(count) {
    const geometry = new THREE.SphereGeometry(0.15, 8, 8);
    const material = new THREE.MeshBasicMaterial({ color: 0x00ffff });

    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(geometry, material.clone());
      mesh.position.set(
        (Math.random() - 0.5) * 100,
        (Math.random() - 0.5) * 100,
        (Math.random() - 0.5) * 60,
      );
      mesh.userData.originalPos = mesh.position.clone();
      mesh.userData.velocity = new THREE.Vector3(
        (Math.random() - 0.5) * 0.02,
        (Math.random() - 0.5) * 0.02,
        0,
      );
      this.scene.add(mesh);
      this.nodes.push(mesh);
    }
  }

  createConnections() {
    const lineMaterial = new THREE.LineBasicMaterial({
      color: 0x00ffff,
      transparent: true,
      opacity: 0.3,
    });

    for (let i = 0; i < this.nodes.length; i++) {
      for (let j = i + 1; j < this.nodes.length; j++) {
        const dist = this.nodes[i].position.distanceTo(this.nodes[j].position);
        if (dist < 15) {
          const geometry = new THREE.BufferGeometry().setFromPoints([
            this.nodes[i].position,
            this.nodes[j].position,
          ]);
          const line = new THREE.Line(geometry, lineMaterial.clone());
          line.userData.nodeA = this.nodes[i];
          line.userData.nodeB = this.nodes[j];
          this.scene.add(line);
          this.lines.push(line);
        }
      }
    }

    const positions = new Float32Array(this.logicalLines.length * 6);
    this.lineGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(positions, 3),
    );

    this.lineSegments = new THREE.LineSegments(
      this.lineGeometry,
      this.lineMaterial,
    );
    this.scene.add(this.lineSegments);
  }

  createDataPackets(count) {
    const geometry = new THREE.SphereGeometry(0.25, 8, 8);
    const material = new THREE.MeshBasicMaterial({
      color: 0xffaa00,
      transparent: true,
      opacity: 0.8,
    });

    for (let i = 0; i < count; i++) {
      if (this.logicalLines.length === 0) break;
      const mesh = new THREE.Mesh(geometry, material.clone());
      const line =
        this.logicalLines[Math.floor(Math.random() * this.logicalLines.length)];
      mesh.userData.line = line;
      mesh.userData.progress = Math.random();
      mesh.userData.speed = 0.002 + Math.random() * 0.003;
      this.scene.add(mesh);
      this.dataPackets.push(mesh);
    }
  }

  onMouseMove(event) {
    this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
  }

  updateNodeParallax() {
    const parallaxStrength = 2;

    for (const node of this.nodes) {
      const offsetX =
        this.mouse.x * parallaxStrength * (1 + node.position.z / 60);
      const offsetY =
        this.mouse.y * parallaxStrength * (1 + node.position.z / 60);

      node.position.x = node.userData.originalPos.x + offsetX;
      node.position.y = node.userData.originalPos.y + offsetY;

      node.userData.originalPos.add(node.userData.velocity);

      if (Math.abs(node.userData.originalPos.x) > 50)
        node.userData.velocity.x *= -1;
      if (Math.abs(node.userData.originalPos.y) > 50)
        node.userData.velocity.y *= -1;
    }
  }

  updateConnections() {
    const positions = this.lineGeometry.attributes.position.array;

    let idx = 0;
    for (const line of this.logicalLines) {
      positions[idx++] = line.nodeA.position.x;
      positions[idx++] = line.nodeA.position.y;
      positions[idx++] = line.nodeA.position.z;

      positions[idx++] = line.nodeB.position.x;
      positions[idx++] = line.nodeB.position.y;
      positions[idx++] = line.nodeB.position.z;
    }

    this.lineGeometry.attributes.position.needsUpdate = true;
  }

  updateDataPackets() {
    for (const packet of this.dataPackets) {
      packet.userData.progress += packet.userData.speed * this.animationSpeed;

      if (packet.userData.progress >= 1) {
        packet.userData.progress = 0;
        packet.userData.line =
          this.lines[Math.floor(Math.random() * this.lines.length)];
      }

      const line = packet.userData.line;
      const start = line.userData.nodeA.position;
      const end = line.userData.nodeB.position;

      packet.position.lerpVectors(start, end, packet.userData.progress);
    }
  }

  updateColors() {
    const baseColor = new THREE.Color(0x00ffff);
    const intensity = this.colorIntensity;

    for (const node of this.nodes) {
      node.material.color.setRGB(
        baseColor.r * intensity,
        baseColor.g * intensity,
        baseColor.b * intensity,
      );
    }

    for (const line of this.lines) {
      line.material.opacity = 0.3 * intensity;
    }
  }

  setAnimationSpeed(speed) {
    this.animationSpeed = speed;
  }

  setColorIntensity(intensity) {
    this.colorIntensity = intensity;
    this.updateColors();
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    this.updateNodeParallax();
    this.updateConnections();
    this.updateDataPackets();

    this.renderer.render(this.scene, this.camera);
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  destroy() {
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("mousemove", this.onMouseMove);
    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }
}
