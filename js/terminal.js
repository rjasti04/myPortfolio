function escapeHTML(str) {
  return str.replace(/[&<>'"]/g,
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag])
  );
}

export function initTerminal() {
  const terminalInput = document.getElementById("terminal-input");
  const terminalOutput = document.getElementById("terminal-output");
  const terminalBody = document.getElementById("terminal-body");

  if (!terminalInput || !terminalOutput || !terminalBody) return;

  // State for command history
  let commandHistory = [];
  let historyIndex = -1;

  // Ensure clicking anywhere in the terminal focuses the input
  terminalBody.addEventListener("click", () => {
    terminalInput.focus();
  });

  const commands = {
    help: () => {
      return `
        <ul class="terminal-list">
          <li><strong>whoami</strong>    - Display details about me</li>
          <li><strong>projects</strong>  - Current high-level focuses</li>
          <li><strong>skills</strong>    - Technologies I work with</li>
          <li><strong>cd</strong>        - Navigate sections (e.g., cd portfolio)</li>
          <li><strong>ls</strong>        - List available sections</li>
          <li><strong>cat</strong>       - View a file (e.g., cat contact.md)</li>
          <li><strong>wget</strong>      - Download files (e.g., wget resume)</li>
          <li><strong>neofetch</strong>  - System info card</li>
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
      if (!/^[\d+\-*/().\s]+$/.test(expr)) {
        return `<p class="terminal-output-text">calc: invalid characters in expression. Only numbers and basic operators are allowed.</p>`;
      }
      // Secondary guard: reject any alphabetic/identifier characters that
      // could have slipped through the dot (.) in the character class.
      if (/[a-zA-Z_$]/.test(expr)) {
        return `<p class="terminal-output-text">calc: letters are not allowed in expressions</p>`;
      }
      try {
        const result = Function('"use strict"; return (' + expr + ')')();
        if (typeof result !== 'number' || !isFinite(result)) {
          return `<p class="terminal-output-text">calc: expression did not evaluate to a valid number</p>`;
        }
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
          <li><strong>Host:</strong> rajeevjasti.com</li>
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
            <li><strong>Website:</strong> rajeevjasti.com</li>
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
      return `<p class="terminal-line" style="color: #fb7185;">rjasti is not in the sudoers file. This incident will be reported.</p>`;
    }
  };

  const commandList = Object.keys(commands).concat(["echo"]);

  terminalInput.addEventListener("keydown", (e) => {
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

      // Add to history and reset index (capped at 100 entries)
      if (commandHistory[commandHistory.length - 1] !== inputVal) {
        commandHistory.push(inputVal);
        if (commandHistory.length > 100) commandHistory.shift();
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

      const resultElement = document.createElement("div");

      if (commands[cmd]) {
        resultElement.innerHTML = commands[cmd](args);
      } else if (cmd === "echo") {
        resultElement.innerHTML = `<p class="terminal-output-text">${escapeHTML(args.join(" "))}</p>`;
      } else {
        resultElement.innerHTML = `<p class="terminal-line" style="color: #fb7185;">bash: ${escapeHTML(cmd)}: command not found. Type 'help' for available commands.</p>`;
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
