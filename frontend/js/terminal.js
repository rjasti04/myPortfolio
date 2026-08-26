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
  const placeholderSamples = ["help", "whoami", "skills", "fortune"];
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
        terminalInput.setAttribute("placeholder", sample.slice(0, charIdx) + "\u258E");
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
        terminalInput.setAttribute("placeholder", sample.slice(0, charIdx) + "\u258E");
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
          <li><strong>skills</strong>    - Technologies &amp; frameworks I work with</li>
          <li><strong>cd</strong>        - Navigate sections (e.g., cd portfolio)</li>
          <li><strong>ls</strong>        - List available sections</li>
          <li><strong>wget</strong>      - Download files (e.g., wget resume)</li>
          <li><strong>cowsay</strong>    - Make the cow say something</li>
          <li><strong>fortune</strong>   - Random wisdom</li>
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
          <li><strong>Role:</strong> Principal Data Engineer &amp; Architect</li>
          <li><strong>Experience:</strong> 8+ Years (Feb 2018 &mdash; Present at Nicholas and Company)</li>
          <li><strong>Location:</strong> Salt Lake City, UT (Remote)</li>
          <li><strong>Contact:</strong> inboxtorj@gmail.com</li>
          <li><strong>Focus:</strong> Enterprise data platforms (OLTP/OLAP), distributed systems, async backend APIs, and Generative AI solutions.</li>
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
    skills: () => {
      return `
        <ul class="terminal-list">
          <li><strong>Cloud &amp; Serverless:</strong> Amazon Redshift, Amazon Bedrock, S3, AWS Glue, Lambda, Athena, DynamoDB, EKS, ECS, RDS, CloudWatch</li>
          <li><strong>Backend &amp; APIs:</strong> Python, FastAPI, boto3, SQLAlchemy (asyncpg), Pydantic, Multiprocessing, Multithreading</li>
          <li><strong>Data Engineering &amp; BI:</strong> Matillion, PySpark, Looker, Pandas, NumPy</li>
          <li><strong>Databases &amp; Middleware:</strong> PostgreSQL, SQL Server, Amazon Redshift, MySQL, Dell Boomi, Redis, Apache Kafka, RabbitMQ, Elasticsearch, Alembic</li>
          <li><strong>Languages &amp; Scripting:</strong> Python, T-SQL, PL/pgSQL, SQL, Bash / Linux</li>
          <li><strong>DevOps &amp; Tooling:</strong> Git, Docker, Terraform, Kubernetes, GitHub Actions CI/CD, Pytest</li>
        </ul>
        <div class="terminal-tags" style="margin-top: 8px;">
          <span>AWS</span><span>Amazon Bedrock</span><span>Amazon Redshift</span><span>FastAPI</span><span>Python</span><span>PySpark</span><span>PostgreSQL</span><span>SQL Server</span><span>Looker</span><span>Matillion</span><span>Dell Boomi</span><span>Apache Kafka</span><span>Docker</span><span>Kubernetes</span><span>Terraform</span><span>GitHub Actions</span>
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
    ls: () => {
      return `<pre class="terminal-output-text" style="color:var(--terminal-green);white-space:pre">about/    resume/    portfolio/    hobbies/    contact/</pre>`;
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
        } catch (e) { }
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
