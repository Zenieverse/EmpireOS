import { GoogleGenAI, Type } from "@google/genai";

// Initialize Gemini in the frontend
// The API key is available via process.env.GEMINI_API_KEY for free models
// or via the platform-provided key selection for paid models.
const getAI = () => {
  const apiKey = (process as any).env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set. Please configure it in the environment.");
  }
  return new GoogleGenAI({ apiKey });
};

export async function runStrategyAgent(goalId: string, goalName: string, goalDesc: string) {
  const ai = getAI();
  const model = "gemini-3.1-pro-preview";
  const prompt = `You are the Strategy Agent for EmpireOS. 
A new goal has been created: "${goalName}".
Description: ${goalDesc}

Your task:
1. Break this goal into 3-5 high-level Projects.
2. For each project, provide a name and a brief AI-generated plan.

Return the result as a JSON array of projects.`;

  const response = await ai.models.generateContent({
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
    const res = await fetch("/api/notion/create-project", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        goalId,
        name: p.name,
        plan: p.plan
      })
    });
    const projectData = await res.json();

    // Trigger Product Agent for each new project
    await runProductAgent(projectData.id, p.name, p.plan);
    
    // Trigger Marketing Agent for each new project
    await runMarketingAgent(projectData.id, p.name, p.plan);
  }

  // Update Goal status
  await fetch("/api/notion/update-status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pageId: goalId,
      status: "In Progress",
      type: "goal",
      notes: "Strategy Agent has processed this goal and created projects."
    })
  });

  // Log Agent action
  await logAgentAction("Strategy Agent", `Created ${projects.length} projects for goal: ${goalName}`);
}

export async function runProductAgent(projectId: string, projectName: string, projectPlan: string) {
  const ai = getAI();
  const model = "gemini-3.1-pro-preview";
  const prompt = `You are the Product Agent for EmpireOS.
Project: "${projectName}"
Plan: ${projectPlan}

Your task:
1. Break this project into 3-5 actionable Tasks.
2. For each task, provide a name and a brief AI note.

Return the result as a JSON array of tasks.`;

  const response = await ai.models.generateContent({
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
    await fetch("/api/notion/create-task", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        name: t.name,
        note: t.note
      })
    });
  }

  // Update Project status
  await fetch("/api/notion/update-status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pageId: projectId,
      status: "In Progress",
      type: "project"
    })
  });

  await logAgentAction("Product Agent", `Generated ${tasks.length} tasks for project: ${projectName}`);
}

export async function runMarketingAgent(projectId: string, projectName: string, projectPlan: string) {
  const ai = getAI();
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

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
  });

  const marketingPlan = response.text || "Failed to generate marketing plan.";

  // Log Agent action
  await logAgentAction("Marketing Agent", `Generated launch strategy for: ${projectName}`);
}

export async function runOperationsAgent(goals: any[], projects: any[], tasks: any[]) {
  const ai = getAI();
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

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
  });

  const reportContent = response.text || "Failed to generate report.";

  await logAgentAction("Operations Agent", "Generated Weekly CEO Report.");
  return reportContent;
}

async function logAgentAction(agentName: string, action: string) {
  await fetch("/api/agents/log-action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentName, action })
  });
}
