// The command registry.
//
// Commands are DATA, not behaviour bolted onto a DOM closure. Each descriptor
// carries everything three surfaces need — the terminal, the mobile chip row,
// and the Ctrl+K palette — so `help`, tab-completion and the palette can never
// drift out of sync with what is actually implemented.
//
// Descriptor shape:
//   name      string   the word typed
//   summary   string   one line, shown by `help` and the palette
//   usage     string   argument form, shown on misuse
//   hidden    boolean  omitted from help, completion and the palette
//   chip      boolean  surfaced as a tappable starter chip
//   complete  (ctx, partial, argIndex) => string[]
//   run       (ctx, args) => Node | Promise<Node> | void
//
// `run` never touches `document` outside the output builders: every side
// effect goes through `ctx`, so a nav or theme refactor can't silently break a
// command the way the old `querySelector('nav a[data-target="ai"]')` did.

import * as out from "./output.js";
import { evaluateMathExpression } from "./math.js";
import { getResumeUrl } from "../utils.js";

const FORTUNES = [
  "The best way to predict the future is to implement it. — David Heinemeier Hansson",
  "First, solve the problem. Then, write the code. — John Johnson",
  "Data is the new oil, but pipelines are the new refineries.",
  "Any sufficiently advanced technology is indistinguishable from magic. — Arthur C. Clarke",
  "Talk is cheap. Show me the code. — Linus Torvalds",
  "The only way to go fast is to go well. — Robert C. Martin",
  "Premature optimization is the root of all evil. — Donald Knuth",
  "In God we trust. All others must bring data. — W. Edwards Deming",
  "Simplicity is the ultimate sophistication. — Leonardo da Vinci",
  "It works on my machine. — Every developer, ever.",
];

const SKILL_GROUPS = [
  ["Cloud & Serverless:", "Amazon Redshift, Amazon Bedrock, S3, AWS Glue, Lambda, Athena, DynamoDB, EKS, ECS, RDS, CloudWatch"],
  ["Backend & APIs:", "Python, FastAPI, boto3, SQLAlchemy (asyncpg), Pydantic, Multiprocessing, Multithreading"],
  ["Data Engineering & BI:", "Matillion, PySpark, Looker, Pandas, NumPy"],
  ["Databases & Middleware:", "PostgreSQL, SQL Server, Amazon Redshift, MySQL, Dell Boomi, Redis, Apache Kafka, RabbitMQ, Elasticsearch, Alembic"],
  ["Languages & Scripting:", "Python, T-SQL, PL/pgSQL, SQL, Bash / Linux"],
  ["DevOps & Tooling:", "Git, Docker, Terraform, Kubernetes, GitHub Actions CI/CD, Pytest"],
];

const SKILL_TAGS = [
  "AWS", "Amazon Bedrock", "Amazon Redshift", "FastAPI", "Python", "PySpark",
  "PostgreSQL", "SQL Server", "Looker", "Matillion", "Dell Boomi",
  "Apache Kafka", "Docker", "Kubernetes", "Terraform", "GitHub Actions",
];

export const commands = [
  {
    name: "help",
    summary: "List available commands",
    usage: "help [command]",
    chip: true,
    complete: (ctx, partial) => ctx.registry.names().filter((n) => n.startsWith(partial)),
    run(ctx, args) {
      if (args.length) {
        const target = ctx.registry.get(args[0]);
        if (!target || target.hidden) {
          return out.err(`help: no entry for '${args[0]}'`);
        }
        return out.frag(
          out.text(target.summary),
          out.pre(`usage: ${target.usage ?? target.name}`),
        );
      }
      // Generated from the registry, so it cannot document a command that does
      // not exist or omit one that does.
      return out.columns(ctx.registry.visible().map((c) => [c.name, c.summary]));
    },
  },
  {
    name: "whoami",
    summary: "Display details about me",
    usage: "whoami",
    chip: true,
    run: () =>
      out.list([
        ["Name:", "Rajeev Jasti"],
        ["Role:", "Principal Data Engineer & Architect"],
        ["Experience:", "8+ Years (Feb 2018 — Present at Nicholas and Company)"],
        ["Location:", "Salt Lake City, UT (Remote)"],
        ["Contact:", "inboxtorj@gmail.com"],
        ["Focus:", "Enterprise data platforms (OLTP/OLAP), distributed systems, async backend APIs, and Generative AI solutions."],
      ]),
  },
  {
    name: "skills",
    summary: "Technologies & frameworks I work with",
    usage: "skills",
    chip: true,
    run: () => out.frag(out.list(SKILL_GROUPS), out.tags(SKILL_TAGS)),
  },
  {
    name: "stats",
    summary: "Show headline numbers from this page",
    usage: "stats",
    run(ctx) {
      const rows = ctx.stats();
      if (!rows.length) return out.text("stats: no figures published on this page.");
      // Read from the rendered stat cards rather than a second hardcoded copy,
      // so the terminal can never disagree with the page above it.
      return out.columns(rows.map(({ label, value }) => [value, label]));
    },
  },
  {
    name: "ls",
    summary: "List available sections",
    usage: "ls",
    run: (ctx) => out.pre(ctx.sections().map((id) => `${id}/`).join("    "), "output-ok"),
  },
  {
    name: "cd",
    summary: "Navigate sections (e.g. cd portfolio)",
    usage: "cd <section>",
    navigates: true,
    complete: (ctx, partial) => ctx.sections().filter((id) => id.startsWith(partial.toLowerCase())),
    async run(ctx, args) {
      if (!args.length) {
        return out.text("cd: missing operand. Try 'cd portfolio', 'cd resume', 'cd contact'");
      }
      const target = args[0].toLowerCase();
      if (target === ".." || target === "~" || target === "/") {
        await ctx.navigate("about");
        return out.text("Navigating to root...");
      }
      if (!ctx.sections().includes(target)) {
        return out.err(`bash: cd: ${target}: No such directory`);
      }
      await ctx.navigate(target);
      return out.text(`Navigating to /${target}...`);
    },
  },
  {
    name: "ask",
    summary: "Ask the AI assistant a question",
    usage: "ask <question>",
    chip: true,
    navigates: true,
    async run(ctx, args) {
      if (!args.length) {
        return out.text("ask: missing question. Try 'ask what is your Kafka experience?'");
      }
      const question = args.join(" ").slice(0, 500);
      const delivered = await ctx.ask(question);
      return delivered
        ? out.text(`Routing to the assistant: "${question}"`)
        : out.err("ask: the assistant is not available on this page.");
    },
  },
  {
    name: "ai",
    summary: "Open the AI assistant",
    usage: "ai",
    navigates: true,
    async run(ctx) {
      await ctx.navigate("ai");
      return out.text("Initializing neural interface... Redirecting to AI portal.");
    },
  },
  {
    name: "wget",
    summary: "Download files (e.g. wget resume)",
    usage: "wget <file>",
    complete: (ctx, partial) => ["resume"].filter((f) => f.startsWith(partial.toLowerCase())),
    run(ctx, args) {
      if (!args.length) return out.text("wget: missing URL");
      const target = args[0].toLowerCase();
      if (target === "resume" || target.includes("pdf")) {
        // Not a literal filename: the build content-hashes the PDF and rewrites
        // references in the HTML only, so a hardcoded name 404s in dist/.
        ctx.download(getResumeUrl(), "Rajeev_Jasti_Resume.pdf");
        return out.frag(
          out.text("Resolving resume... connected."),
          out.text("Downloading 'Rajeev_Jasti_Resume.pdf'..."),
        );
      }
      return out.err(`wget: unable to resolve host address '${target}'`);
    },
  },
  {
    name: "calc",
    summary: "Evaluate a math expression",
    usage: "calc <expression>",
    run(ctx, args) {
      if (!args.length) return out.text("calc: missing expression. Try 'calc 5 * 10'");
      const expr = args.join(" ");
      if (expr.length > 120) return out.err("calc: expression is too long");
      if (!/^[\d+\-*/().\s]+$/.test(expr)) {
        return out.err("calc: invalid characters in expression. Only numbers and basic operators are allowed.");
      }
      try {
        return out.text(String(evaluateMathExpression(expr)));
      } catch {
        return out.err("calc: invalid expression");
      }
    },
  },
  {
    name: "echo",
    summary: "Print given arguments",
    usage: "echo <text>",
    run: (ctx, args) => out.text(args.join(" ")),
  },
  {
    name: "cowsay",
    summary: "Make the cow say something",
    usage: "cowsay <text>",
    run(ctx, args) {
      // Truncate the RAW text and measure the RAW length. The previous version
      // escaped first, so `&` became `&amp;` before the 40-char cut — slicing
      // entities in half and drawing a box sized to the escaped string.
      const body = (args.length ? args.join(" ") : "moo").slice(0, 40);
      const rule = "─".repeat(body.length + 2);
      return out.pre(
        ` ${rule}\n< ${body} >\n ${rule}\n        \\   ^__^\n         \\  (oo)\\_______\n            (__)\\       )\\/\\\n                ||----w |\n                ||     ||`,
      );
    },
  },
  {
    name: "fortune",
    summary: "Random wisdom",
    usage: "fortune",
    chip: true,
    run() {
      const node = out.text(FORTUNES[Math.floor(Math.random() * FORTUNES.length)]);
      node.style.fontStyle = "italic";
      return node;
    },
  },
  {
    name: "history",
    summary: "Show command history",
    usage: "history",
    run(ctx) {
      const entries = ctx.history.all();
      if (!entries.length) return out.text("No commands in history.");
      return out.pre(entries.map((cmd, i) => `  ${i + 1}  ${cmd}`).join("\n"));
    },
  },
  {
    name: "matrix",
    summary: "Toggle Hacker Mode",
    usage: "matrix",
    run: (ctx) =>
      out.text(
        ctx.toggleMatrix()
          ? "Wake up, Neo... The Matrix has you."
          : "Matrix mode disabled. Returning to reality.",
      ),
  },
  {
    name: "theme",
    summary: "Toggle dark/light theme",
    usage: "theme",
    run: (ctx) => out.text(`Theme switched to ${ctx.toggleTheme() ? "dark" : "light"} mode.`),
  },
  {
    name: "date",
    summary: "Print current date and time",
    usage: "date",
    run: () => out.text(new Date().toString()),
  },
  {
    name: "clear",
    summary: "Clear the terminal",
    usage: "clear",
    run(ctx) {
      ctx.clear();
    },
  },
  {
    name: "sudo",
    summary: "Elevate privileges",
    usage: "sudo <command>",
    hidden: true,
    run: () => out.err("rjasti is not in the sudoers file. This incident will be reported."),
  },
];

export function createRegistry(list = commands) {
  const byName = new Map(list.map((command) => [command.name, command]));
  const visible = list.filter((command) => !command.hidden);
  return {
    get: (name) => byName.get(String(name).toLowerCase()) ?? null,
    has: (name) => byName.has(String(name).toLowerCase()),
    all: () => list.slice(),
    visible: () => visible.slice(),
    /** Completion and the palette deliberately exclude hidden commands. */
    names: () => visible.map((command) => command.name),
    chips: () => visible.filter((command) => command.chip),
  };
}
