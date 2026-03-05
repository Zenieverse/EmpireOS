import express from "express";
import { createServer as createViteServer } from "vite";
import { Client } from "@notionhq/client";
import * as dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// In-memory session for demo purposes
let notionToken = process.env.NOTION_API_KEY || "";
let notionClient = notionToken ? new Client({ auth: notionToken }) : null;

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

app.post("/api/notion/create-project", async (req, res) => {
  const { goalId, name, plan } = req.body;
  try {
    const response = await createPage(process.env.NOTION_PROJECTS_DB_ID!, {
      "Project Name": { title: [{ text: { content: name } }] },
      "Related Goal": { relation: [{ id: goalId }] },
      "Status": { select: { name: "Not Started" } },
      "AI Generated Plan": { rich_text: [{ text: { content: plan } }] },
    });
    res.json(response);
  } catch (error) {
    res.status(500).json({ error: "Failed to create project" });
  }
});

app.post("/api/notion/create-task", async (req, res) => {
  const { projectId, name, note } = req.body;
  try {
    const response = await createPage(process.env.NOTION_TASKS_DB_ID!, {
      "Task Name": { title: [{ text: { content: name } }] },
      "Project": { relation: [{ id: projectId }] },
      "Status": { select: { name: "To Do" } },
      "AI Notes": { rich_text: [{ text: { content: note } }] },
    });
    res.json(response);
  } catch (error) {
    res.status(500).json({ error: "Failed to create task" });
  }
});

app.post("/api/agents/log-action", async (req, res) => {
  const { agentName, action } = req.body;
  try {
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
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to log agent action" });
  }
});

app.post("/api/notion/sync", async (req, res) => {
  // Manual sync just returns success now, frontend will handle the agent triggering
  res.json({ success: true, message: "Sync triggered in frontend" });
});

app.post("/api/notion/update-status", async (req, res) => {
  const { pageId, status, type, notes } = req.body;
  if (!pageId || !status) return res.status(400).json({ error: "Missing parameters" });

  try {
    let properties: any = {};
    if (type === 'goal' || type === 'project' || type === 'task') {
      properties["Status"] = { select: { name: status } };
    }
    if (notes) {
      properties["AI Breakdown"] = { rich_text: [{ text: { content: notes } }] };
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
