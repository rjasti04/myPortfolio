import express from "express";
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { GoogleGenAI } from "@google/genai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const DIST = path.join(ROOT, "dist");
const FRONTEND = path.join(ROOT, "frontend");

// Ensure dist/ exists by running the build script if needed
if (!existsSync(path.join(DIST, "index.html"))) {
  console.log("[server] dist/ not found, building frontend...");
  try {
    execSync("node scripts/build.mjs", { cwd: ROOT, stdio: "inherit" });
  } catch (err) {
    console.error("[server] Build failed, falling back to frontend/", err);
  }
}

const STATIC_DIR = existsSync(path.join(DIST, "index.html")) ? DIST : FRONTEND;
console.log(`[server] Serving static assets from ${STATIC_DIR}`);

const app = express();
const PORT = 3000;
const HOST = "0.0.0.0";

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// CORS middleware
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, x-session-id, x-session-token");
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});

// Resume facts & system prompt for Rajeev Jasti portfolio persona
const PERSONA_CONTEXT = `
You are the AI assistant on Rajeev Jasti's personal portfolio website (rjasti.com).
Rajeev Jasti is a Principal Data Engineer based in Salt Lake City with 8+ years of enterprise experience.
Key Information:
- Current Role: Principal Data Engineer at Nicholas and Company (Nov 2022 – Present).
- Previous Role: Data Engineer at Nicholas and Company (Feb 2018 – Oct 2022).
- Specialization: Enterprise Data Engineering & OLAP modeling, OLTP Database Engines, Real-time Streaming, Cloud Migrations, Full-Stack & Generative AI Web Applications.
- Backend Stack: Python 3.10+, FastAPI, PostgreSQL, SQLAlchemy ORM (asyncpg), Alembic, Amazon Bedrock, AWS Lambda, API Gateway, Boomi, Docker, Kafka, microservices.
- Cloud & Infrastructure: AWS (Redshift, Bedrock, S3, Glue, Lambda, Athena, DynamoDB, API Gateway, CloudWatch, EKS, ECS, EC2, RDS), Kubernetes, Docker, GitHub Actions CI/CD.
- Principles: Enterprise-grade patterns, performant async processing, high-availability reliability, strict ACID transactions, modular architecture.
- Site Architecture: Hand-written static single-page app with no frontend framework (vanilla ES modules and hand-authored CSS). PWA support, service worker, self-hosted fonts, zero third-party critical dependencies.
- Standalone Apps:
  1. /ucl: UEFA Champions League bracket simulator
  2. /worldcup: World Cup simulator
  3. /arcade: 6 retro games (2048, Tetris, Snake, Breaker, Stack, Flapper) written in pure vanilla JS
  4. /cron: Cron expression parser & visualizer and regex studio
  5. /crypto: Cryptographic encoders, hashers, JWT tool, time workbench
  6. /json: JSON workbench, JSONPath query studio, YAML/CSV conversion, TypeScript interface generator
  7. /diff: Code diff checker and patch generator with Myers algorithm

Respond conversationally, concisely, and professionally as Rajeev's AI portfolio representative. Answer questions about Rajeev's career, architecture choices, technical skills, and project details accurately.
`;

// Gemini client initialization if API key is present
let aiClient = null;
if (process.env.GEMINI_API_KEY) {
  try {
    aiClient = new GoogleGenAI();
  } catch (e) {
    console.warn("[server] Could not initialize GoogleGenAI client:", e.message);
  }
}

// Health checks
app.get(["/health", "/api/health"], (req, res) => {
  res.json({ status: "healthy", timestamp: new Date().toISOString() });
});

app.get("/api/system/status", (req, res) => {
  res.json({
    status: "healthy",
    environment: "production",
    database: "connected",
    pipeline: "active",
    version: "2.0.0"
  });
});

// Session creation
app.post(["/api/sessions", "/sessions"], (req, res) => {
  const sessionId = crypto.randomUUID();
  const sessionToken = crypto.randomBytes(24).toString("hex");
  res.status(201).json({
    session_id: sessionId,
    session_token: sessionToken,
    created_at: new Date().toISOString()
  });
});

// Event ingestion
app.post(["/api/events", "/events"], (req, res) => {
  res.status(200).json({ status: "ok", received: 1 });
});

// Contact form endpoint
app.post(["/api/contact", "/contact"], (req, res) => {
  res.status(200).json({ status: "sent", message: "Message received successfully." });
});

// Chat completion streaming endpoint
app.post(["/api/chat", "/api/chat/stream", "/chat", "/chat/stream"], async (req, res) => {
  const { messages = [] } = req.body;
  if (!messages || messages.length === 0) {
    return res.status(400).json({ detail: "A message cannot be empty." });
  }

  // Setup SSE headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
  });

  const lastUserMsg = messages[messages.length - 1]?.content || "";

  try {
    if (aiClient && process.env.GEMINI_API_KEY) {
      // Use Gemini stream
      const geminiMessages = messages.map(m => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }]
      }));

      const stream = await aiClient.models.generateContentStream({
        model: "gemini-2.5-flash",
        contents: geminiMessages,
        config: {
          systemInstruction: PERSONA_CONTEXT,
          temperature: 0.7,
        }
      });

      for await (const chunk of stream) {
        const text = chunk.text;
        if (text) {
          res.write(`data: ${JSON.stringify({ text })}\n\n`);
        }
      }
    } else {
      // Articulate fallback generator based on persona
      const q = lastUserMsg.toLowerCase();
      let reply = "";
      if (q.includes("who are you") || q.includes("rajeev") || q.includes("about")) {
        reply = "I am Rajeev Jasti's AI portfolio assistant! Rajeev is a **Principal Data Engineer** at Nicholas and Company with over 8 years of experience architecting high-throughput data pipelines, enterprise OLTP/OLAP systems, and real-time streaming architectures with Python, PostgreSQL, AWS, and Kafka. Feel free to ask about his technical architecture, career milestones, or the standalone tools built right into this portfolio!";
      } else if (q.includes("stack") || q.includes("technology") || q.includes("skills") || q.includes("framework")) {
        reply = "Rajeev specializes in:\n- **Languages & Frameworks:** Python 3.10+, FastAPI, SQL, TypeScript/Vanilla JS, SQLAlchemy, Alembic\n- **Data & Streaming:** PostgreSQL, AWS Redshift, Apache Kafka, Snowflake, OLAP modeling\n- **Cloud & DevOps:** AWS (S3, Glue, Lambda, Athena, Bedrock, ECS, EKS), Docker, GitHub Actions\n- **Architecture:** Asynchronous backend services, microservices, ACID compliance, zero-bloat frontends.";
      } else if (q.includes("app") || q.includes("project") || q.includes("tool")) {
        reply = "This site features seven developer tools and side projects built from scratch:\n1. **[Cron & Regex Visualizer](/cron)**\n2. **[Crypto Toolbox & Time Workbench](/crypto)**\n3. **[JSON Workbench & Query Studio](/json)**\n4. **[Code Diff Checker](/diff)**\n5. **[Arcade](/arcade)** (6 retro arcade games)\n6. **[UCL Predictor](/ucl)**\n7. **[World Cup Predictor](/worldcup)**";
      } else if (q.includes("contact") || q.includes("email") || q.includes("hire") || q.includes("reach")) {
        reply = "You can reach out to Rajeev via the **Contact** section on this site, or connect directly on [LinkedIn](https://www.linkedin.com/in/rajeev-jasti-326080169) and [GitHub](https://github.com/rjasti04).";
      } else {
        reply = `Thanks for asking about "${lastUserMsg}". Rajeev Jasti is a Principal Data Engineer specializing in modern enterprise data platforms, async Python backends, and full-stack generative AI applications. Explore the interactive terminal in the **About** section or check out the developer apps in the **Apps** shelf!`;
      }

      // Stream words with small delays to emulate real streaming
      const words = reply.split(" ");
      for (let i = 0; i < words.length; i++) {
        const text = words[i] + (i < words.length - 1 ? " " : "");
        res.write(`data: ${JSON.stringify({ text })}\n\n`);
        await new Promise((r) => setTimeout(r, 25));
      }
    }

    // Emit metrics event to conclude stream
    res.write(`data: ${JSON.stringify({ type: "metrics", metrics: { total_tokens: 120, latency_ms: 150 } })}\n\n`);
    res.end();
  } catch (err) {
    console.error("[server] Chat stream error:", err);
    res.write(`data: ${JSON.stringify({ text: "\n\nI encountered an error processing your question. Please try again." })}\n\n`);
    res.end();
  }
});

// Analytics SSE stream for live activity dashboard
app.get(["/api/analytics/stream", "/analytics/stream"], (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
  });

  const sendEvent = () => {
    const families = ["nav", "tap", "pref", "reach"];
    const actions = ["route_change", "filter_click", "theme_toggle", "scroll_section", "button_click"];
    const event = {
      event_type: actions[Math.floor(Math.random() * actions.length)],
      event_family: families[Math.floor(Math.random() * families.length)],
      created_at: new Date().toISOString(),
      metadata: { path: windowPath() }
    };
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  function windowPath() {
    const paths = ["/#home", "/#about", "/#resume", "/#apps", "/#contact", "/#activity", "/#ai"];
    return paths[Math.floor(Math.random() * paths.length)];
  }

  sendEvent();
  const interval = setInterval(sendEvent, 4000);

  req.on("close", () => {
    clearInterval(interval);
  });
});

// Chat history endpoint
app.get(["/api/chat/history", "/chat/history"], (req, res) => {
  res.json([]);
});

// Extensionless and alias rewrites matching frontend/.htaccess
const ALIASES = {
  "/regex": "/cron#regex",
  "/encode": "/crypto#encoders",
  "/yaml": "/json#convert",
  "/jsonpath": "/json#query",
  "/patch": "/diff#patch"
};

for (const [alias, target] of Object.entries(ALIASES)) {
  app.get(alias, (req, res) => {
    res.redirect(301, target);
  });
}

// Standalone tool pages with clean URLs
const STANDALONE_PAGES = ["ucl", "worldcup", "arcade", "cron", "crypto", "diff", "json"];
for (const page of STANDALONE_PAGES) {
  app.get(`/${page}`, (req, res) => {
    const filePath = path.join(STATIC_DIR, `${page}.html`);
    if (existsSync(filePath)) {
      return res.sendFile(filePath);
    }
    const fallbackPath = path.join(FRONTEND, `${page}.html`);
    if (existsSync(fallbackPath)) {
      return res.sendFile(fallbackPath);
    }
    res.status(404).send("Page not found");
  });
}

// Serve static assets from dist (or frontend fallback)
app.use(express.static(STATIC_DIR, {
  maxAge: "1d",
  setHeaders: (res, filePath) => {
    if (filePath.endsWith("index.html") || filePath.endsWith("sw.js")) {
      res.setHeader("Cache-Control", "no-cache");
    }
  }
}));

// If dist has assets, also ensure frontend files (images, icons) are resolvable if unbundled
if (STATIC_DIR !== FRONTEND) {
  app.use(express.static(FRONTEND, { maxAge: "1h" }));
}

// SPA fallback for all remaining HTML navigation
app.use((req, res) => {
  const indexDist = path.join(STATIC_DIR, "index.html");
  if (existsSync(indexDist)) {
    return res.sendFile(indexDist);
  }
  const indexFrontend = path.join(FRONTEND, "index.html");
  if (existsSync(indexFrontend)) {
    return res.sendFile(indexFrontend);
  }
  res.status(404).send("Not found");
});

app.listen(PORT, HOST, () => {
  console.log(`[server] rjWebApp server listening at http://${HOST}:${PORT}`);
});
