import { trackEvent } from "./analytics.js";
import { prefersReducedMotion } from "./config.js";
import { escapeHTML } from "./utils.js";

function evaluateMathExpression(expr) {
  let index = 0;

  function skipSpaces() {
    while (/\s/.test(expr[index] || "")) index++;
  }

  function parseNumber() {
    skipSpaces();
    const start = index;
    while (/[\d.]/.test(expr[index] || "")) index++;
    const raw = expr.slice(start, index);
    if (!raw || raw.split(".").length > 2) {
      throw new Error("invalid number");
    }
    return Number(raw);
  }

  function parseFactor() {
    skipSpaces();
    if (expr[index] === "+") {
      index++;
      return parseFactor();
    }
    if (expr[index] === "-") {
      index++;
      return -parseFactor();
    }
    if (expr[index] === "(") {
      index++;
      const value = parseExpression();
      skipSpaces();
      if (expr[index] !== ")") throw new Error("missing closing paren");
      index++;
      return value;
    }
    return parseNumber();
  }

  function parseTerm() {
    let value = parseFactor();
    while (true) {
      skipSpaces();
      const op = expr[index];
      if (op !== "*" && op !== "/") break;
      index++;
      const right = parseFactor();
      value = op === "*" ? value * right : value / right;
    }
    return value;
  }

  function parseExpression() {
    let value = parseTerm();
    while (true) {
      skipSpaces();
      const op = expr[index];
      if (op !== "+" && op !== "-") break;
      index++;
      const right = parseTerm();
      value = op === "+" ? value + right : value - right;
    }
    return value;
  }

  const result = parseExpression();
  skipSpaces();
  if (index !== expr.length || !Number.isFinite(result)) {
    throw new Error("invalid expression");
  }
  return result;
}

export function initTerminal() {
  const terminalInput = document.getElementById("terminal-input");
  const terminalOutput = document.getElementById("terminal-output");
  const terminalBody = document.getElementById("terminal-body");

  if (!terminalInput || !terminalOutput || !terminalBody) return;

  // State for command history
  const HISTORY_KEY = "rj_terminal_history";
  let commandHistory = [];
  try {
    const saved = localStorage.getItem(HISTORY_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      // BUG FIX ROOT CAUSE: If a single entry exceeded 500 characters, the entire history list was
      // discarded due to parsed.every() validation failure. We now sanitize, truncate, and map
      // individual entries to retain the rest of the history.
      if (Array.isArray(parsed)) {
        commandHistory = parsed
          .filter(item => typeof item === 'string')
          .map(item => item.slice(0, 500))
          .slice(-100);
      }
    }
  } catch (e) {
    // Ignore parse errors — start with empty history
  }
  let historyIndex = commandHistory.length;

  // Ensure clicking anywhere in the terminal focuses the input
  terminalBody.addEventListener("click", () => {
    terminalInput.focus();
  });

  // Animated placeholder: cycles through example commands until the user interacts
  const placeholderSamples = ["help", "whoami", "skills", "projects", "neofetch", "fortune"];
  const basePlaceholder = "Type 'help' to see commands...";
  let placeholderAnimationId = null;
  let placeholderStopped = false;

  function stopPlaceholderAnimation() {
    if (placeholderStopped) return;
    placeholderStopped = true;
    if (placeholderAnimationId !== null) {
      clearTimeout(placeholderAnimationId);
      placeholderAnimationId = null;
    }
    terminalInput.setAttribute("placeholder", basePlaceholder);
  }

  function runPlaceholderAnimation() {
    if (prefersReducedMotion.matches) return;
    let sampleIdx = 0;
    let charIdx = 0;
    let phase = "typing"; // typing | holding | erasing | pausing

    const tick = () => {
      if (placeholderStopped) return;
      const sample = placeholderSamples[sampleIdx];
      let delay = 110;

      if (phase === "typing") {
        charIdx++;
        terminalInput.setAttribute("placeholder", sample.slice(0, charIdx) + "\u2588");
        if (charIdx >= sample.length) {
          phase = "holding";
          delay = 1200;
        }
      } else if (phase === "holding") {
        terminalInput.setAttribute("placeholder", sample);
        phase = "erasing";
        delay = 500;
      } else if (phase === "erasing") {
        charIdx--;
        terminalInput.setAttribute("placeholder", sample.slice(0, charIdx) + "\u2588");
        if (charIdx <= 0) {
          phase = "pausing";
          delay = 400;
        } else {
          delay = 55;
        }
      } else if (phase === "pausing") {
        sampleIdx = (sampleIdx + 1) % placeholderSamples.length;
        charIdx = 0;
        phase = "typing";
        delay = 250;
      }

      placeholderAnimationId = setTimeout(tick, delay);
    };

    placeholderAnimationId = setTimeout(tick, 600);
  }

  terminalInput.addEventListener("focus", stopPlaceholderAnimation, { once: true });
  terminalInput.addEventListener("input", stopPlaceholderAnimation, { once: true });
  runPlaceholderAnimation();

  const commands = {
    help: () => {
      return `
        <ul class="terminal-list">
          <li><strong>whoami</strong>    - Display details about me</li>
          <li><strong>ai</strong>        - Launch the AI assistant</li>
          <li><strong>projects</strong>  - Current high-level focuses</li>
          <li><strong>skills</strong>    - Technologies I work with</li>
          <li><strong>cd</strong>        - Navigate sections (e.g., cd portfolio)</li>
          <li><strong>ls</strong>        - List available sections</li>
          <li><strong>cat</strong>       - View a file (e.g., cat contact.md)</li>
          <li><strong>wget</strong>      - Download files (e.g., wget resume)</li>
          <li><strong>neofetch</strong>  - System info card</li>
          <li><strong>system-stats</strong> - Display real-time data pipelines & system load</li>
          <li><strong>cowsay</strong>    - Make the cow say something</li>
          <li><strong>fortune</strong>   - Random wisdom</li>
          <li><strong>ping</strong>      - Ping a host</li>
          <li><strong>uptime</strong>    - How long I've been engineering</li>
          <li><strong>history</strong>   - Show command history</li>
          <li><strong>matrix</strong>    - Toggle Hacker Mode</li>
          <li><strong>calc</strong>      - Evaluate a math expression</li>
          <li><strong>theme</strong>     - Toggle dark/light theme</li>
          <li><strong>echo</strong>      - Print given arguments</li>
          <li><strong>date</strong>      - Print current date and time</li>
          <li><strong>clear</strong>     - Clear the terminal</li>
        </ul>
      `;
    },
    whoami: () => {
      return `
        <ul class="terminal-list">
          <li><strong>Name:</strong> Rajeev Jasti</li>
          <li><strong>Role:</strong> Principal Data Engineer</li>
          <li><strong>Location:</strong> Earth (Remote)</li>
          <li><strong>Contact:</strong> inboxtorj@gmail.com</li>
          <li><strong>Bio:</strong> Architecting low-latency distributed systems and massive-scale ETL pipelines.</li>
        </ul>
      `;
    },
    ai: () => {
      setTimeout(() => {
        const aiLink = document.querySelector('nav a[data-target="ai"]');
        if (aiLink) aiLink.click();
      }, 500);
      return `<p class="terminal-output-text">Initializing neural interface... Redirecting to AI portal.</p>`;
    },
    projects: () => {
      return `
        <ul class="terminal-list">
          <li>Realtime lakehouse observability rollout</li>
          <li>Self-serve pipeline templates for domain teams</li>
          <li>P95 latency reduction optimizations</li>
        </ul>
      `;
    },
    skills: () => {
      return `
        <div class="terminal-tags">
          <span>Kafka</span><span>Spark</span><span>Airflow</span>
          <span>Snowflake</span><span>Terraform</span><span>Kubernetes</span>
          <span>Python</span><span>Scala</span><span>AWS</span>
        </div>
      `;
    },
    cd: (args) => {
      if (!args.length) return `<p class="terminal-output-text">cd: missing operand. Try 'cd portfolio', 'cd resume', 'cd contact'</p>`;
      const target = args[0].toLowerCase();
      if (target === ".." || target === "~") {
        window.location.hash = "about";
        return `<p class="terminal-output-text">Navigating to root...</p>`;
      }
      const section = document.getElementById(target);
      if (section && section.tagName.toUpperCase() === "SECTION") {
        window.location.hash = target;
        return `<p class="terminal-output-text">Navigating to /${escapeHTML(target)}...</p>`;
      }
      return `<p class="terminal-output-text">bash: cd: ${escapeHTML(target)}: No such directory</p>`;
    },
    wget: (args) => {
      if (!args.length) return `<p class="terminal-output-text">wget: missing URL</p>`;
      const target = args[0].toLowerCase();
      if (target === "resume" || target.includes("pdf")) {
        const a = document.createElement("a");
        a.href = "rajeev_jasti.pdf";
        a.download = "Rajeev_Jasti_Resume.pdf";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        return `<p class="terminal-output-text">Resolving resume... connected.<br>Downloading 'Rajeev_Jasti_Resume.pdf'...</p>`;
      }
      return `<p class="terminal-output-text">wget: unable to resolve host address '${escapeHTML(target)}'</p>`;
    },
    matrix: () => {
      const panel = document.querySelector(".terminal-panel");
      if (!panel) return `<p class="terminal-output-text">Error: Terminal panel not found.</p>`;
      const isMatrix = panel.classList.toggle("matrix-mode");
      if (isMatrix) {
        return `<p class="terminal-output-text">Wake up, Neo... The Matrix has you.</p>`;
      } else {
        return `<p class="terminal-output-text">Matrix mode disabled. Returning to reality.</p>`;
      }
    },
    clear: () => {
      setTimeout(() => {
        terminalOutput.innerHTML = "";
      }, 10);
      return "";
    },
    theme: () => {
      const themeToggleBtn = document.getElementById("theme-toggle");
      if (themeToggleBtn) {
        themeToggleBtn.click();
        const isDark = document.body.classList.contains("dark-theme");
        return `<p class="terminal-output-text">Theme switched to ${isDark ? "dark" : "light"} mode.</p>`;
      }
      return `<p class="terminal-output-text">Theme toggle not available.</p>`;
    },
    date: () => {
      return `<p class="terminal-output-text">${new Date().toString()}</p>`;
    },
    calc: (args) => {
      if (!args.length) return `<p class="terminal-output-text">calc: missing expression. Try 'calc 5 * 10'</p>`;
      const expr = args.join(" ");
      if (expr.length > 120) {
        return `<p class="terminal-output-text">calc: expression is too long</p>`;
      }
      if (!/^[\d+\-*/().\s]+$/.test(expr)) {
        return `<p class="terminal-output-text">calc: invalid characters in expression. Only numbers and basic operators are allowed.</p>`;
      }
      if (/[a-zA-Z_$]/.test(expr)) {
        return `<p class="terminal-output-text">calc: letters are not allowed in expressions</p>`;
      }
      try {
        const result = evaluateMathExpression(expr);
        return `<p class="terminal-output-text">${escapeHTML(String(result))}</p>`;
      } catch (e) {
        return `<p class="terminal-output-text">calc: invalid expression</p>`;
      }
    },
    neofetch: () => {
      const isDark = document.body.classList.contains("dark-theme");
      const w = window.innerWidth;
      const h = window.innerHeight;
      return `
        <pre class="terminal-output-text" style="line-height:1.4;white-space:pre">  ____     _ 
 |  _ \   | |
 | |_) |  | |
 |  _ < _ | |
 |_| \_(_)|_|</pre>
        <ul class="terminal-list">
          <li><strong>rjasti</strong>@portfolio</li>
          <li>─────────────────</li>
          <li><strong>OS:</strong> Portfolio v1.0</li>
          <li><strong>Host:</strong> rjasti.com</li>
          <li><strong>Uptime:</strong> 10+ years in engineering</li>
          <li><strong>Shell:</strong> bash</li>
          <li><strong>Theme:</strong> ${isDark ? "dark \uD83C\uDF19" : "light \u2600\uFE0F"}</li>
          <li><strong>Resolution:</strong> ${w}\u00D7${h}</li>
          <li><strong>Stack:</strong> Kafka, Spark, Airflow, Snowflake</li>
          <li><strong>Contact:</strong> inboxtorj@gmail.com</li>
        </ul>
      `;
    },
    cowsay: (args) => {
      const text = args.length ? escapeHTML(args.join(" ")).substring(0, 40) : "moo";
      const line = "\u2500".repeat(text.length + 2);
      return `<pre class="terminal-output-text" style="line-height:1.4;white-space:pre"> ${line}\n&lt; ${text} &gt;\n ${line}\n        \\   ^__^\n         \\  (oo)\\_______\n            (__)\\       )\\/\\\n                ||----w |\n                ||     ||</pre>`;
    },
    fortune: () => {
      const quotes = [
        "The best way to predict the future is to implement it. \u2014 David Heinemeier Hansson",
        "First, solve the problem. Then, write the code. \u2014 John Johnson",
        "Data is the new oil, but pipelines are the new refineries.",
        "Any sufficiently advanced technology is indistinguishable from magic. \u2014 Arthur C. Clarke",
        "Talk is cheap. Show me the code. \u2014 Linus Torvalds",
        "The only way to go fast is to go well. \u2014 Robert C. Martin",
        "Premature optimization is the root of all evil. \u2014 Donald Knuth",
        "In God we trust. All others must bring data. \u2014 W. Edwards Deming",
        "Simplicity is the ultimate sophistication. \u2014 Leonardo da Vinci",
        "It works on my machine. \u2014 Every developer, ever.",
      ];
      const quote = quotes[Math.floor(Math.random() * quotes.length)];
      return `<p class="terminal-output-text" style="font-style:italic">${escapeHTML(quote)}</p>`;
    },
    ping: (args) => {
      const host = args[0] || "google.com";
      const safeHost = escapeHTML(host.substring(0, 40));
      const ip = "142.250.80." + Math.floor(Math.random() * 255);
      const t1 = (10 + Math.random() * 8).toFixed(1);
      const t2 = (10 + Math.random() * 8).toFixed(1);
      const t3 = (10 + Math.random() * 8).toFixed(1);
      const times = [t1, t2, t3].map(Number);
      const avg = (times.reduce((a, b) => a + b, 0) / 3).toFixed(1);
      return `<pre class="terminal-output-text" style="line-height:1.5;white-space:pre">PING ${safeHost} (${ip}): 56 data bytes\n64 bytes from ${ip}: icmp_seq=0 ttl=117 time=${t1} ms\n64 bytes from ${ip}: icmp_seq=1 ttl=117 time=${t2} ms\n64 bytes from ${ip}: icmp_seq=2 ttl=117 time=${t3} ms\n\n--- ${safeHost} ping statistics ---\n3 packets transmitted, 3 received, 0% packet loss\nround-trip min/avg/max = ${Math.min(...times)}/${avg}/${Math.max(...times)} ms</pre>`;
    },
    ls: () => {
      return `<pre class="terminal-output-text" style="color:var(--terminal-green);white-space:pre">about/    resume/    portfolio/    hobbies/    contact/</pre>`;
    },
    cat: (args) => {
      if (!args.length) return `<p class="terminal-output-text">cat: missing file operand</p>`;
      const file = args[0].toLowerCase().replace(/\.md$/, "");
      if (file === "contact") {
        return `
          <ul class="terminal-list">
            <li><strong>Email:</strong> inboxtorj@gmail.com</li>
            <li><strong>LinkedIn:</strong> linkedin.com/in/rajeev-jasti-326080169</li>
            <li><strong>GitHub:</strong> github.com/rjasti04</li>
            <li><strong>Website:</strong> rjasti.com</li>
          </ul>
        `;
      }
      if (file === "readme" || file === "about") {
        return `<p class="terminal-output-text">Principal Data Engineer with 10+ years building distributed systems and massive-scale ETL pipelines.</p>`;
      }
      if (file === "current_focus") {
        return `
          <ul class="terminal-list">
            <li>Realtime lakehouse observability rollout</li>
            <li>Self-serve pipeline templates for domain teams</li>
          </ul>
        `;
      }
      return `<p class="terminal-output-text">cat: ${escapeHTML(args[0])}: No such file or directory</p>`;
    },
    uptime: () => {
      const start = new Date(2016, 0, 1);
      const now = new Date();
      const years = now.getFullYear() - start.getFullYear();
      const days = Math.floor((now - start) / (1000 * 60 * 60 * 24));
      return `<p class="terminal-output-text">${escapeHTML(now.toLocaleTimeString())} up ${years} years, ${days} days, 50+ projects shipped</p>`;
    },
    history: () => {
      if (commandHistory.length === 0) {
        return `<p class="terminal-output-text">No commands in history.</p>`;
      }
      const items = commandHistory.map((cmd, i) => `  ${i + 1}  ${escapeHTML(cmd)}`).join("\n");
      return `<pre class="terminal-output-text" style="white-space:pre">${items}</pre>`;
    },
    sudo: () => {
      return `<p class="terminal-line terminal-error">rjasti is not in the sudoers file. This incident will be reported.</p>`;
    },
    "system-stats": () => {
      const cpuPercent = Math.floor(25 + Math.random() * 40);
      const memPercent = Math.floor(55 + Math.random() * 20);
      
      const cpuBarLength = Math.round(cpuPercent / 5);
      const memBarLength = Math.round(memPercent / 5);
      
      const cpuBar = "█".repeat(cpuBarLength) + "░".repeat(20 - cpuBarLength);
      const memBar = "█".repeat(memBarLength) + "░".repeat(20 - memBarLength);
      
      return `
        <pre class="terminal-output-text" style="line-height:1.5;white-space:pre;font-family:monospace">
  HOST: rjasti.com      OS: DataOS v2.4      UPTIME: 10+ Years      LOAD: 0.28, 0.44, 0.32

  CPU [${cpuBar}] ${cpuPercent}.0% (8 Cores active)
  MEM [${memBar}] ${memPercent}.0% (${(16 * memPercent / 100).toFixed(1)} GB / 16.0 GB)

  ACTIVE STREAMS & DATA PIPELINES:
  ┌──────────────────────┬─────────────┬──────────────┬─────────────┐
  │ Pipeline Name        │ Source      │ Target       │ Status      │
  ├──────────────────────┼─────────────┼──────────────┼─────────────┤
  │ clickstream-ingress  │ Kafka       │ Snowflake    │ <span style="color:var(--terminal-green)">ACTIVE (OK)</span> │
  │ sessions-heartbeat   │ Website API │ PostgreSQL   │ <span style="color:var(--terminal-green)">ACTIVE (OK)</span> │
  │ model-training-job   │ S3 Bucket   │ Bedrock LLM  │ <span style="color:var(--terminal-muted)">COMPLETED</span>   │
  └──────────────────────┴─────────────┴──────────────┴─────────────┘

  INFRASTRUCTURE STATUS:
  - Kafka Brokers:  [<span style="color:var(--terminal-green)">3/3 ONLINE</span>]  (Broker-1: OK, Broker-2: OK, Broker-3: OK)
  - Spark Cluster:  [8 Workers active, 64 Cores, 256GB Memory]
  - PostgreSQL:     [Connection Pool: 8/10 active connections]
  - AWS Bedrock:    [US-EAST-1 Endpoint: <span style="color:var(--terminal-green)">ONLINE</span>, Gemma-3-12B]
        </pre>
      `;
    }
  };

  const commandList = Object.keys(commands).concat(["echo"]);

  terminalInput.addEventListener("keydown", (e) => {
    // Trigger WebGL surge on typing
    if (typeof window.triggerWebGlSurge === "function") {
      window.triggerWebGlSurge();
    }

    // History up
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (commandHistory.length > 0) {
        historyIndex = Math.max(0, historyIndex - 1);
        terminalInput.value = commandHistory[historyIndex] || "";
      }
    } 
    // History down
    else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIndex < commandHistory.length - 1) {
        historyIndex++;
        terminalInput.value = commandHistory[historyIndex] || "";
      } else {
        historyIndex = commandHistory.length;
        terminalInput.value = "";
      }
    }
    // Tab completion
    else if (e.key === "Tab") {
      e.preventDefault();
      const current = terminalInput.value.trim().toLowerCase();
      if (current) {
        const matches = commandList.filter(c => c.startsWith(current));
        if (matches.length === 1) {
          terminalInput.value = matches[0] + " ";
        } else if (matches.length > 1) {
          // If multiple matches exist, print them
          const fragment = document.createDocumentFragment();
          const commandElement = document.createElement("p");
          commandElement.className = "terminal-line";
          commandElement.innerHTML = `<span class="prompt">$</span> ${escapeHTML(current)}`;
          fragment.appendChild(commandElement);
          
          const resultElement = document.createElement("div");
          resultElement.innerHTML = `<p class="terminal-output-text">${matches.join("  ")}</p>`;
          fragment.appendChild(resultElement);
          
          terminalOutput.appendChild(fragment);
          
          requestAnimationFrame(() => {
            terminalBody.scrollTop = terminalBody.scrollHeight;
          });
        }
      }
    }
    // Command execution
    else if (e.key === "Enter") {
      e.preventDefault();
      const inputVal = terminalInput.value.trim();
      if (!inputVal) return;

      // BUG FIX ROOT CAUSE: Clean input to max 500 characters before checking history to prevent
      // exceeding limits and triggering validation failures on reload.
      const sanitizedInput = inputVal.substring(0, 500);

      // Add to history and reset index (capped at 100 entries)
      if (commandHistory[commandHistory.length - 1] !== sanitizedInput) {
        commandHistory.push(sanitizedInput);
        if (commandHistory.length > 100) commandHistory.shift();
        try {
          localStorage.setItem(HISTORY_KEY, JSON.stringify(commandHistory));
        } catch (e) {}
      }
      historyIndex = commandHistory.length;

      const fragment = document.createDocumentFragment();
      const commandElement = document.createElement("p");
      commandElement.className = "terminal-line";
      commandElement.innerHTML = `<span class="prompt">$</span> ${escapeHTML(inputVal)}`;
      fragment.appendChild(commandElement);

      const parts = inputVal.split(" ");
      const cmd = parts[0].toLowerCase();
      const args = parts.slice(1);

      trackEvent("terminal_command", { command: cmd, args: args });

      const resultElement = document.createElement("div");

      if (commands[cmd]) {
        resultElement.innerHTML = commands[cmd](args);
      } else if (cmd === "echo") {
        resultElement.innerHTML = `<p class="terminal-output-text">${escapeHTML(args.join(" "))}</p>`;
      } else {
        resultElement.innerHTML = `<p class="terminal-line terminal-error">bash: ${escapeHTML(cmd)}: command not found. Type 'help' for available commands.</p>`;
      }

      if (resultElement.innerHTML) {
        fragment.appendChild(resultElement);
      }
      
      terminalOutput.appendChild(fragment);

      terminalInput.value = "";
      
      requestAnimationFrame(() => {
        terminalBody.scrollTop = terminalBody.scrollHeight;
      });
    }
  });


}
