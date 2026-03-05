import express from "express";
import { createServer as createViteServer } from "vite";
import { Client } from "@notionhq/client";
import { GoogleGenAI, Type } from "@google/genai";
import * as dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// In-memory session for demo purposes
let notionToken = process.env.NOTION_API_KEY || "";
let notionClient = notionToken ? new Client({ auth: notionToken }) : null;

// Gemini Client
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// --- Notion OAuth ---

app.get("/api/auth/notion/url", (req, res) => {
  const clientId = process.env.NOTION_CLIENT_ID;
  const redirectUri = process.env.NOTION_REDIRECT_URI || `${process.env.APP_URL}/auth/notion/callback`;
  
  if (!clientId) {
    return res.status(400).json({ error: "NOTION_CLIENT_ID not configured" });
  }

  const authUrl = `https://api.notion.com/v1/oauth/authorize?client_id=${clientId}&response_type=code&owner=user&redirect_uri=${encodeURIComponent(redirectUri)}`;
  res.json({ url: authUrl });
});

app.get("/auth/notion/callback", async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send("No code provided");

  try {
    const clientId = process.env.NOTION_CLIENT_ID;
    const clientSecret = process.env.NOTION_CLIENT_SECRET;
    const redirectUri = process.env.NOTION_REDIRECT_URI || `${process.env.APP_URL}/auth/notion/callback`;

    const response = await fetch("https://api.notion.com/v1/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }),
    });

    const data = await response.json() as any;
    if (data.access_token) {
      notionToken = data.access_token;
      notionClient = new Client({ auth: notionToken });
      
      res.send(`
        <html>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, '*');
                window.close();
              } else {
                window.location.href = '/';
              }
            </script>
            <p>Authentication successful. This window should close automatically.</p>
          </body>
        </html>
      `);
    } else {
      res.status(400).send("Failed to exchange token: " + JSON.stringify(data));
    }
  } catch (error) {
    console.error("OAuth error:", error);
    res.status(500).send("Internal Server Error during OAuth");
  }
});

// --- Notion Tools (MCP-like) ---

async function queryDatabase(databaseId: string, filter?: any) {
  if (!notionClient) return [];
  try {
    const response = await (notionClient.databases as any).query({
      database_id: databaseId,
      filter: filter,
    });
    return response.results;
  } catch (error) {
    console.error("Error querying database:", error);
    return [];
  }
}

async function createPage(databaseId: string, properties: any) {
  if (!notionClient) throw new Error("Notion not connected");
  try {
    const response = await notionClient.pages.create({
      parent: { database_id: databaseId },
      properties: properties,
    });
    return response;
  } catch (error) {
    console.error("Error creating page:", error);
    throw error;
  }
}

async function updatePage(pageId: string, properties: any) {
  if (!notionClient) throw new Error("Notion not connected");
  try {
    const response = await notionClient.pages.update({
      page_id: pageId,
      properties: properties,
    });
    return response;
  } catch (error) {
    console.error("Error updating page:", error);
    throw error;
  }
}

// --- API Routes ---

app.get("/api/config-status", (req, res) => {
  res.json({
    notionConfigured: !!notionToken && !!process.env.NOTION_GOALS_DB_ID,
    geminiConfigured: !!process.env.GEMINI_API_KEY,
    oauthAvailable: !!process.env.NOTION_CLIENT_ID,
  });
});

app.get("/api/notion/data", async (req, res) => {
  if (!notionToken) {
    return res.status(400).json({ error: "Notion not configured" });
  }
  try {
    const [goals, projects, tasks, agents] = await Promise.all([
      queryDatabase(process.env.NOTION_GOALS_DB_ID!),
      queryDatabase(process.env.NOTION_PROJECTS_DB_ID!),
      queryDatabase(process.env.NOTION_TASKS_DB_ID!),
      queryDatabase(process.env.NOTION_AGENTS_DB_ID!),
    ]);
    res.json({ goals, projects, tasks, agents });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch Notion data" });
  }
});

// --- Agent Orchestration ---

async function runStrategyAgent(goalId: string, goalName: string, goalDesc: string) {
  const model = "gemini-3.1-pro-preview";
  const prompt = `You are the Strategy Agent for EmpireOS. 
A new goal has been created: "${goalName}".
Description: ${goalDesc}

Your task:
1. Break this goal into 3-5 high-level Projects.
2. For each project, provide a name and a brief AI-generated plan.

Return the result as a JSON array of projects.`;

  const response = await genAI.models.generateContent({
    model,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING },
            plan: { type: Type.STRING },
          },
          required: ["name", "plan"],
        },
      },
    },
  });

  const projects = JSON.parse(response.text || "[]");
  
  for (const p of projects) {
    const projectResponse = await createPage(process.env.NOTION_PROJECTS_DB_ID!, {
      "Project Name": { title: [{ text: { content: p.name } }] },
      "Related Goal": { relation: [{ id: goalId }] },
      "Status": { select: { name: "Not Started" } },
      "AI Generated Plan": { rich_text: [{ text: { content: p.plan } }] },
    });

    // Trigger Product Agent for each new project
    await runProductAgent(projectResponse.id, p.name, p.plan);
    
    // Trigger Marketing Agent for each new project
    await runMarketingAgent(projectResponse.id, p.name, p.plan);
  }

  // Update Goal status
  await updatePage(goalId, {
    "Status": { select: { name: "In Progress" } },
    "AI Breakdown": { rich_text: [{ text: { content: "Strategy Agent has processed this goal and created projects." } }] },
  });

  // Log Agent action
  await logAgentAction("Strategy Agent", `Created ${projects.length} projects for goal: ${goalName}`);
}

async function runProductAgent(projectId: string, projectName: string, projectPlan: string) {
  const model = "gemini-3.1-pro-preview";
  const prompt = `You are the Product Agent for EmpireOS.
Project: "${projectName}"
Plan: ${projectPlan}

Your task:
1. Break this project into 3-5 actionable Tasks.
2. For each task, provide a name and a brief AI note.

Return the result as a JSON array of tasks.`;

  const response = await genAI.models.generateContent({
    model,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING },
            note: { type: Type.STRING },
          },
          required: ["name", "note"],
        },
      },
    },
  });

  const tasks = JSON.parse(response.text || "[]");

  for (const t of tasks) {
    await createPage(process.env.NOTION_TASKS_DB_ID!, {
      "Task Name": { title: [{ text: { content: t.name } }] },
      "Project": { relation: [{ id: projectId }] },
      "Status": { select: { name: "To Do" } },
      "AI Notes": { rich_text: [{ text: { content: t.note } }] },
    });
  }

  // Update Project status
  await updatePage(projectId, {
    "Status": { select: { name: "In Progress" } },
  });

  await logAgentAction("Product Agent", `Generated ${tasks.length} tasks for project: ${projectName}`);
}

async function runMarketingAgent(projectId: string, projectName: string, projectPlan: string) {
  const model = "gemini-3.1-pro-preview";
  const prompt = `You are the Marketing Agent for EmpireOS.
Project: "${projectName}"
Plan: ${projectPlan}

Your task:
1. Create a marketing campaign for this project.
2. Generate:
   - Launch Strategy
   - Social Media Plan
   - Content Calendar
3. Return the result as a professional summary.`;

  const response = await genAI.models.generateContent({
    model,
    contents: prompt,
  });

  const marketingPlan = response.text || "Failed to generate marketing plan.";

  // In a real app, we might have a Marketing database.
  // For now, we'll append it to the Project's AI Generated Plan or log it.
  await logAgentAction("Marketing Agent", `Generated launch strategy for: ${projectName}`);
}

async function logAgentAction(agentName: string, action: string) {
  const agents = await queryDatabase(process.env.NOTION_AGENTS_DB_ID!, {
    property: "Agent Name",
    title: { equals: agentName }
  });

  if (agents.length > 0) {
    await updatePage(agents[0].id, {
      "Last Action": { rich_text: [{ text: { content: action } }] },
      "Status": { select: { name: "Active" } },
    });
  } else {
    await createPage(process.env.NOTION_AGENTS_DB_ID!, {
      "Agent Name": { title: [{ text: { content: agentName } }] },
      "Role": { rich_text: [{ text: { content: "Autonomous AI Agent" } }] },
      "Status": { select: { name: "Active" } },
      "Last Action": { rich_text: [{ text: { content: action } }] },
    });
  }
}

// Polling for changes (simplified for hackathon)
setInterval(async () => {
  if (!process.env.NOTION_API_KEY || !process.env.NOTION_GOALS_DB_ID) return;

  try {
    // Check for new goals with status "To Do" or empty
    const newGoals = await queryDatabase(process.env.NOTION_GOALS_DB_ID!, {
      property: "Status",
      select: { equals: "To Do" }
    });

    for (const goal of newGoals as any[]) {
      const name = goal.properties["Goal Name"].title[0]?.plain_text;
      const desc = goal.properties["Description"].rich_text[0]?.plain_text || "";
      if (name) {
        console.log(`Processing new goal: ${name}`);
        await runStrategyAgent(goal.id, name, desc);
      }
    }

    // Check for projects with status "Not Started"
    const newProjects = await queryDatabase(process.env.NOTION_PROJECTS_DB_ID!, {
      property: "Status",
      select: { equals: "Not Started" }
    });

    for (const project of newProjects as any[]) {
      const name = project.properties["Project Name"].title[0]?.plain_text;
      const plan = project.properties["AI Generated Plan"].rich_text[0]?.plain_text || "";
      if (name) {
        console.log(`Processing new project: ${name}`);
        await runProductAgent(project.id, name, plan);
      }
    }
  } catch (error) {
    console.error("Polling error:", error);
  }
}, 30000); // Poll every 30 seconds

// --- Advanced Features ---

app.post("/api/agents/command", async (req, res) => {
  const { command } = req.body;
  if (!command) return res.status(400).json({ error: "Command is required" });

  try {
    // 1. Create a new Goal from the command
    const goalResponse = await createPage(process.env.NOTION_GOALS_DB_ID!, {
      "Goal Name": { title: [{ text: { content: command } }] },
      "Status": { select: { name: "To Do" } },
      "Description": { rich_text: [{ text: { content: `Generated from command: ${command}` } }] },
    });

    // 2. Trigger Strategy Agent immediately
    await runStrategyAgent(goalResponse.id, command, `Generated from command: ${command}`);

    res.json({ success: true, message: "Startup command initiated. Strategy Agent is processing." });
  } catch (error) {
    console.error("Command error:", error);
    res.status(500).json({ error: "Failed to execute command" });
  }
});

app.post("/api/agents/ceo-report", async (req, res) => {
  try {
    const [goals, projects, tasks] = await Promise.all([
      queryDatabase(process.env.NOTION_GOALS_DB_ID!),
      queryDatabase(process.env.NOTION_PROJECTS_DB_ID!),
      queryDatabase(process.env.NOTION_TASKS_DB_ID!),
    ]);

    const model = "gemini-3.1-pro-preview";
    const prompt = `You are the Operations Agent for EmpireOS. 
Generate a Weekly CEO Report based on the following startup data:
Goals: ${JSON.stringify(goals)}
Projects: ${JSON.stringify(projects)}
Tasks: ${JSON.stringify(tasks)}

The report should include:
1. Progress Summary
2. Potential Blockers
3. Opportunities
4. Recommended Actions

Format the report as professional markdown.`;

    const response = await genAI.models.generateContent({
      model,
      contents: prompt,
    });

    const reportContent = response.text || "Failed to generate report.";

    // In a real app, we'd create a new page in a "Reports" database.
    // For now, we'll log it and return it.
    await logAgentAction("Operations Agent", "Generated Weekly CEO Report.");

    res.json({ report: reportContent });
  } catch (error) {
    console.error("Report error:", error);
    res.status(500).json({ error: "Failed to generate report" });
  }
});

app.post("/api/notion/update-status", async (req, res) => {
  const { pageId, status, type } = req.body;
  if (!pageId || !status) return res.status(400).json({ error: "Missing parameters" });

  try {
    let properties: any = {};
    if (type === 'goal' || type === 'project' || type === 'task') {
      properties["Status"] = { select: { name: status } };
    }

    await updatePage(pageId, properties);
    res.json({ success: true });
  } catch (error) {
    console.error("Update status error:", error);
    res.status(500).json({ error: "Failed to update status" });
  }
});

app.post("/api/notion/create-goal", async (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: "Name is required" });

  try {
    const goalResponse = await createPage(process.env.NOTION_GOALS_DB_ID!, {
      "Goal Name": { title: [{ text: { content: name } }] },
      "Status": { select: { name: "To Do" } },
      "Description": { rich_text: [{ text: { content: description || "" } }] },
    });

    // Trigger Strategy Agent
    runStrategyAgent(goalResponse.id, name, description || "");

    res.json({ success: true, goalId: goalResponse.id });
  } catch (error) {
    console.error("Create goal error:", error);
    res.status(500).json({ error: "Failed to create goal" });
  }
});

// --- Vite Middleware ---

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
