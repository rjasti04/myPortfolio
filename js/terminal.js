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
          <li><strong>whoami</strong>   - Display details about me</li>
          <li><strong>projects</strong> - Current high-level focuses</li>
          <li><strong>skills</strong>   - Technologies I work with</li>
          <li><strong>cd</strong>       - Navigate sections (e.g., cd portfolio)</li>
          <li><strong>wget</strong>     - Download files (e.g., wget resume)</li>
          <li><strong>matrix</strong>   - Toggle Hacker Mode</li>
          <li><strong>calc</strong>     - Evaluate a math expression</li>
          <li><strong>clear</strong>    - Clear the terminal</li>
          <li><strong>theme</strong>    - Toggle dark/light theme</li>
          <li><strong>echo</strong>     - Print given arguments</li>
          <li><strong>date</strong>     - Print current date and time</li>
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
      return "Theme toggle not available.";
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
          const commandElement = document.createElement("p");
          commandElement.className = "terminal-line";
          commandElement.innerHTML = `<span class="prompt">$</span> ${escapeHTML(current)}`;
          terminalOutput.appendChild(commandElement);
          
          const resultElement = document.createElement("div");
          resultElement.innerHTML = `<p class="terminal-output-text">${matches.join("  ")}</p>`;
          terminalOutput.appendChild(resultElement);
          
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

      // Add to history and reset index
      if (commandHistory[commandHistory.length - 1] !== inputVal) {
        commandHistory.push(inputVal);
      }
      historyIndex = commandHistory.length;

      const commandElement = document.createElement("p");
      commandElement.className = "terminal-line";
      commandElement.innerHTML = `<span class="prompt">$</span> ${escapeHTML(inputVal)}`;
      terminalOutput.appendChild(commandElement);

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
        terminalOutput.appendChild(resultElement);
      }

      terminalInput.value = "";
      
      requestAnimationFrame(() => {
        terminalBody.scrollTop = terminalBody.scrollHeight;
      });
    }
  });


}
