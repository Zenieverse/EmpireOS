import React from 'react';
import { 
  LayoutDashboard, 
  Target, 
  Briefcase, 
  CheckSquare, 
  Users, 
  BarChart3, 
  RefreshCw,
  Plus,
  ChevronRight,
  Activity,
  AlertCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell
} from 'recharts';
import { cn } from './lib/utils';
import { 
  runStrategyAgent, 
  runProductAgent, 
  runMarketingAgent, 
  runOperationsAgent 
} from './services/agentService';

// --- Types ---

interface NotionData {
  goals: any[];
  projects: any[];
  tasks: any[];
  agents: any[];
}

// --- Components ---

const SidebarItem = ({ icon: Icon, label, active, onClick }: { icon: any, label: string, active: boolean, onClick: () => void }) => (
  <button
    onClick={onClick}
    className={cn(
      "w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200",
      active 
        ? "bg-purple-500/10 text-purple-400 border border-purple-500/20 shadow-[0_0_15px_rgba(168,85,247,0.1)]" 
        : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
    )}
  >
    <Icon size={20} />
    <span className="font-medium">{label}</span>
  </button>
);

const Card = ({ children, className, title, subtitle }: { children: React.ReactNode, className?: string, title?: string, subtitle?: string }) => (
  <div className={cn("bg-zinc-900/50 border border-zinc-800 rounded-xl overflow-hidden backdrop-blur-sm", className)}>
    {(title || subtitle) && (
      <div className="px-6 py-4 border-bottom border-zinc-800">
        {title && <h3 className="text-lg font-semibold text-zinc-100">{title}</h3>}
        {subtitle && <p className="text-sm text-zinc-500">{subtitle}</p>}
      </div>
    )}
    <div className="p-6">{children}</div>
  </div>
);

const Badge = ({ children, variant = 'default' }: { children: React.ReactNode, variant?: 'default' | 'success' | 'warning' | 'info' }) => {
  const variants = {
    default: "bg-zinc-800 text-zinc-400 border-zinc-700",
    success: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    warning: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    info: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  };
  return (
    <span className={cn("px-2 py-0.5 rounded-full text-xs font-medium border", variants[variant])}>
      {children}
    </span>
  );
};

// --- Main App ---

export default function App() {
  const [activeTab, setActiveTab] = React.useState('dashboard');
  const [data, setData] = React.useState<NotionData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [configStatus, setConfigStatus] = React.useState({ notionConfigured: false, geminiConfigured: false, oauthAvailable: false });

  const fetchData = async () => {
    try {
      const [configRes, dataRes] = await Promise.all([
        fetch('/api/config-status'),
        fetch('/api/notion/data')
      ]);
      
      const config = await configRes.json();
      setConfigStatus(config);

      if (dataRes.ok) {
        const notionData = await dataRes.json();
        setData(notionData);
      }
    } catch (err) {
      console.error("Fetch error:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleConnectNotion = async () => {
    try {
      const res = await fetch('/api/auth/notion/url');
      const { url } = await res.json();
      if (url) {
        window.open(url, 'notion_oauth', 'width=600,height=700');
      }
    } catch (err) {
      console.error("OAuth URL error:", err);
    }
  };

  React.useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        fetchData();
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  React.useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, []);

  // Frontend Polling for Agents
  React.useEffect(() => {
    if (!data || !configStatus.notionConfigured) return;

    const pollAgents = async () => {
      // 1. Check for new goals
      const newGoals = data.goals.filter(g => g.properties.Status?.select?.name === "To Do");
      for (const goal of newGoals) {
        const name = goal.properties["Goal Name"].title[0]?.plain_text;
        const desc = goal.properties["Description"].rich_text[0]?.plain_text || "";
        if (name) {
          console.log("Triggering Strategy Agent for:", name);
          await runStrategyAgent(goal.id, name, desc);
          await fetchData(); // Refresh data after agent run
        }
      }

      // 2. Check for new projects
      const newProjects = data.projects.filter(p => p.properties.Status?.select?.name === "Not Started");
      for (const project of newProjects) {
        const name = project.properties["Project Name"].title[0]?.plain_text;
        const plan = project.properties["AI Generated Plan"].rich_text[0]?.plain_text || "";
        if (name) {
          console.log("Triggering Product Agent for:", name);
          await runProductAgent(project.id, name, plan);
          await fetchData();
        }
      }
    };

    const interval = setInterval(pollAgents, 15000); // Poll every 15s
    return () => clearInterval(interval);
  }, [data, configStatus.notionConfigured]);

  const [command, setCommand] = React.useState('');
  const [executingCommand, setExecutingCommand] = React.useState(false);
  const [report, setReport] = React.useState<string | null>(null);
  const [generatingReport, setGeneratingReport] = React.useState(false);

  const handleCommand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!command.trim()) return;
    setExecutingCommand(true);
    try {
      const res = await fetch('/api/agents/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command })
      });
      if (res.ok) {
        const result = await res.json();
        setCommand('');
        await fetchData();
        // Trigger Strategy Agent immediately
        await runStrategyAgent(result.goalId, command, `Generated from command: ${command}`);
        await fetchData();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setExecutingCommand(false);
    }
  };

  const generateReport = async () => {
    if (!data) return;
    setGeneratingReport(true);
    try {
      const reportContent = await runOperationsAgent(data.goals, data.projects, data.tasks);
      setReport(reportContent);
    } catch (err) {
      console.error(err);
    } finally {
      setGeneratingReport(false);
    }
  };

  const [syncing, setSyncing] = React.useState(false);
  const handleSync = async () => {
    setSyncing(true);
    try {
      await fetch('/api/notion/sync', { method: 'POST' });
      await fetchData();
      
      // Manual trigger of agent scan
      if (data && configStatus.notionConfigured) {
        // 1. Check for new goals
        const newGoals = data.goals.filter(g => g.properties.Status?.select?.name === "To Do");
        for (const goal of newGoals) {
          const name = goal.properties["Goal Name"].title[0]?.plain_text;
          const desc = goal.properties["Description"].rich_text[0]?.plain_text || "";
          if (name) {
            await runStrategyAgent(goal.id, name, desc);
          }
        }

        // 2. Check for new projects
        const newProjects = data.projects.filter(p => p.properties.Status?.select?.name === "Not Started");
        for (const project of newProjects) {
          const name = project.properties["Project Name"].title[0]?.plain_text;
          const plan = project.properties["AI Generated Plan"].rich_text[0]?.plain_text || "";
          if (name) {
            await runProductAgent(project.id, name, plan);
          }
        }
        await fetchData();
      }
    } catch (err) {
      console.error("Sync error:", err);
    } finally {
      setSyncing(false);
    }
  };

  const [showNewGoalModal, setShowNewGoalModal] = React.useState(false);
  const [newGoal, setNewGoal] = React.useState({ name: '', description: '' });

  const handleCreateGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGoal.name.trim()) return;
    try {
      const res = await fetch('/api/notion/create-goal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newGoal)
      });
      if (res.ok) {
        setNewGoal({ name: '', description: '' });
        setShowNewGoalModal(false);
        fetchData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const updateStatus = async (pageId: string, status: string, type: string) => {
    try {
      const res = await fetch('/api/notion/update-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId, status, type })
      });
      if (res.ok) fetchData();
    } catch (err) {
      console.error(err);
    }
  };

  const renderGoals = () => (
    <div className="space-y-4">
      {data?.goals.map(goal => (
        <Card key={goal.id} className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold text-white">{goal.properties["Goal Name"].title[0]?.plain_text}</h3>
              <p className="text-sm text-zinc-500 mt-1">{goal.properties["Description"].rich_text[0]?.plain_text || "No description provided."}</p>
            </div>
            <div className="flex items-center gap-2">
              <select 
                value={goal.properties.Status?.select?.name || "To Do"}
                onChange={(e) => updateStatus(goal.id, e.target.value, 'goal')}
                className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-zinc-200 outline-none"
              >
                <option value="To Do">To Do</option>
                <option value="In Progress">In Progress</option>
                <option value="Done">Done</option>
              </select>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );

  const renderProjects = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {data?.projects.map(project => (
        <Card key={project.id} title={project.properties["Project Name"].title[0]?.plain_text}>
          <p className="text-sm text-zinc-500 mb-4 line-clamp-3">
            {project.properties["AI Generated Plan"].rich_text[0]?.plain_text || "Planning in progress..."}
          </p>
          <div className="flex items-center justify-between mt-auto pt-4 border-t border-zinc-800">
            <Badge variant="info">{project.properties.Status?.select?.name || "Not Started"}</Badge>
            <button className="text-xs text-purple-400 hover:text-purple-300 font-medium">View Plan</button>
          </div>
        </Card>
      ))}
    </div>
  );

  const renderTasks = () => (
    <div className="space-y-2">
      {data?.tasks.map(task => (
        <div key={task.id} className="flex items-center justify-between p-4 bg-zinc-900/50 border border-zinc-800 rounded-xl">
          <div className="flex items-center gap-4">
            <div className={cn(
              "w-5 h-5 rounded border flex items-center justify-center cursor-pointer transition-colors",
              task.properties.Status?.select?.name === "Done" ? "bg-emerald-500 border-emerald-500" : "border-zinc-700 hover:border-zinc-500"
            )} onClick={() => updateStatus(task.id, task.properties.Status?.select?.name === "Done" ? "To Do" : "Done", 'task')}>
              {task.properties.Status?.select?.name === "Done" && <CheckSquare size={14} className="text-white" />}
            </div>
            <div>
              <p className={cn("text-sm font-medium", task.properties.Status?.select?.name === "Done" ? "text-zinc-600 line-through" : "text-zinc-200")}>
                {task.properties["Task Name"].title[0]?.plain_text}
              </p>
              <p className="text-xs text-zinc-500 mt-0.5">{task.properties["AI Notes"].rich_text[0]?.plain_text || "No notes."}</p>
            </div>
          </div>
          <Badge variant={task.properties.Priority?.select?.name === "High" ? "warning" : "default"}>
            {task.properties.Priority?.select?.name || "Normal"}
          </Badge>
        </div>
      ))}
    </div>
  );

  const renderAgents = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {data?.agents.map(agent => (
        <Card key={agent.id} className="relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4">
            <div className={cn("w-2 h-2 rounded-full", agent.properties.Status?.select?.name === "Active" ? "bg-emerald-500 animate-pulse" : "bg-zinc-700")} />
          </div>
          <div className="flex flex-col items-center text-center py-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-500/20 to-blue-500/20 flex items-center justify-center mb-4 border border-white/5">
              <Users size={32} className="text-purple-400" />
            </div>
            <h3 className="text-lg font-bold text-white">{agent.properties["Agent Name"].title[0]?.plain_text}</h3>
            <p className="text-xs text-zinc-500 uppercase tracking-widest mt-1">{agent.properties["Role"].rich_text[0]?.plain_text || "AI Agent"}</p>
            <div className="mt-6 w-full p-3 bg-black/30 rounded-lg text-left">
              <p className="text-[10px] text-zinc-600 uppercase font-bold mb-1">Last Action</p>
              <p className="text-xs text-zinc-400 italic">"{agent.properties["Last Action"].rich_text[0]?.plain_text || "Waiting for tasks..."}"</p>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );

  const renderAnalytics = () => {
    const pieData = [
      { name: 'Completed', value: data?.tasks.filter(t => t.properties.Status?.select?.name === "Done").length || 0 },
      { name: 'Pending', value: data?.tasks.filter(t => t.properties.Status?.select?.name !== "Done").length || 0 },
    ];
    const COLORS = ['#10b981', '#3f3f46'];

    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Task Distribution" subtitle="Overall progress across all projects">
          <div className="h-[300px] w-full mt-4">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip 
                  contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '8px' }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex justify-center gap-6 mt-4">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-emerald-500" />
              <span className="text-xs text-zinc-400">Done</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-zinc-700" />
              <span className="text-xs text-zinc-400">Pending</span>
            </div>
          </div>
        </Card>

        <Card title="Performance Metrics" subtitle="Weekly efficiency and velocity">
          <div className="space-y-6 mt-4">
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span className="text-zinc-400">Project Completion Rate</span>
                <span className="text-zinc-100 font-bold">68%</span>
              </div>
              <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 w-[68%]" />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span className="text-zinc-400">Agent Efficiency</span>
                <span className="text-zinc-100 font-bold">92%</span>
              </div>
              <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
                <div className="h-full bg-emerald-500 w-[92%]" />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span className="text-zinc-400">Strategy Alignment</span>
                <span className="text-zinc-100 font-bold">85%</span>
              </div>
              <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
                <div className="h-full bg-purple-500 w-[85%]" />
              </div>
            </div>
          </div>
        </Card>
      </div>
    );
  };

  const renderDashboard = () => {
    if (!data) return null;

    const stats = [
      { label: "Active Goals", value: data.goals.filter(g => g.properties.Status?.select?.name === "In Progress").length, icon: Target, color: "text-purple-400" },
      { label: "Projects", value: data.projects.length, icon: Briefcase, color: "text-blue-400" },
      { label: "Pending Tasks", value: data.tasks.filter(t => t.properties.Status?.select?.name !== "Done").length, icon: CheckSquare, color: "text-amber-400" },
      { label: "Active Agents", value: data.agents.filter(a => a.properties.Status?.select?.name === "Active").length, icon: Users, color: "text-emerald-400" },
    ];

    const chartData = [
      { name: 'Mon', progress: 40 },
      { name: 'Tue', progress: 45 },
      { name: 'Wed', progress: 60 },
      { name: 'Thu', progress: 55 },
      { name: 'Fri', progress: 75 },
      { name: 'Sat', progress: 80 },
      { name: 'Sun', progress: 85 },
    ];

    return (
      <div className="space-y-6">
        {/* Command Bar */}
        <Card className="p-2 bg-zinc-900/80 border-purple-500/30 shadow-[0_0_30px_rgba(168,85,247,0.1)]">
          <form onSubmit={handleCommand} className="flex gap-2">
            <input 
              type="text" 
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="Type a startup command (e.g., 'Launch an AI productivity SaaS')" 
              className="flex-1 bg-transparent border-none outline-none px-4 py-2 text-zinc-100 placeholder:text-zinc-600"
              disabled={executingCommand}
            />
            <button 
              type="submit"
              disabled={executingCommand}
              className="px-6 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-lg font-medium transition-all flex items-center gap-2"
            >
              {executingCommand ? <RefreshCw size={18} className="animate-spin" /> : <Activity size={18} />}
              Execute
            </button>
          </form>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {stats.map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
            >
              <Card className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-zinc-500">{stat.label}</p>
                    <p className="text-2xl font-bold text-zinc-100 mt-1">{stat.value}</p>
                  </div>
                  <div className={cn("p-3 rounded-lg bg-zinc-800/50", stat.color)}>
                    <stat.icon size={24} />
                  </div>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2" title="Startup Velocity" subtitle="Task completion and project progress over time">
            <div className="h-[300px] w-full mt-4">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                  <XAxis dataKey="name" stroke="#71717a" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="#71717a" fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '8px' }}
                    itemStyle={{ color: '#a855f7' }}
                  />
                  <Line type="monotone" dataKey="progress" stroke="#a855f7" strokeWidth={2} dot={{ fill: '#a855f7' }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card title="Agent Activity Feed" subtitle="Real-time logs from autonomous agents">
            <div className="space-y-4 mt-4">
              {data.agents.map((agent, i) => (
                <div key={agent.id} className="flex gap-3 items-start">
                  <div className="mt-1 p-1.5 rounded-full bg-purple-500/10 text-purple-400">
                    <Activity size={14} />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-zinc-200">{agent.properties["Agent Name"].title[0]?.plain_text}</p>
                    <p className="text-xs text-zinc-500 mt-0.5">{agent.properties["Last Action"].rich_text[0]?.plain_text || "Idle"}</p>
                  </div>
                </div>
              ))}
              {data.agents.length === 0 && (
                <p className="text-sm text-zinc-600 italic">No agent activity recorded yet.</p>
              )}
            </div>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card title="Startup Hierarchy" subtitle="Goal → Projects → Tasks mapping">
            <div className="space-y-6 mt-4">
              {data.goals.map(goal => (
                <div key={goal.id} className="space-y-3">
                  <div className="flex items-center gap-3 p-2 rounded-lg bg-purple-500/5 border border-purple-500/10">
                    <Target size={16} className="text-purple-400" />
                    <span className="text-sm font-bold text-zinc-100">{goal.properties["Goal Name"].title[0]?.plain_text}</span>
                  </div>
                  <div className="pl-6 space-y-2 border-l border-zinc-800 ml-4">
                    {data.projects
                      .filter(p => p.properties["Related Goal"]?.relation?.some((r: any) => r.id === goal.id))
                      .map(project => (
                        <div key={project.id} className="space-y-2">
                          <div className="flex items-center gap-2 text-xs font-medium text-zinc-400">
                            <Briefcase size={12} className="text-blue-400" />
                            {project.properties["Project Name"].title[0]?.plain_text}
                          </div>
                          <div className="pl-4 space-y-1">
                            {data.tasks
                              .filter(t => t.properties["Project"]?.relation?.some((r: any) => r.id === project.id))
                              .map(task => (
                                <div key={task.id} className="flex items-center gap-2 text-[10px] text-zinc-600">
                                  <div className="w-1 h-1 rounded-full bg-zinc-700" />
                                  {task.properties["Task Name"].title[0]?.plain_text}
                                </div>
                              ))}
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              ))}
              {data.goals.length === 0 && (
                <p className="text-sm text-zinc-600 italic">No goals defined yet. Use the command bar to start.</p>
              )}
            </div>
          </Card>

          <Card title="Recent Projects" subtitle="AI-generated execution plans">
            <div className="space-y-3 mt-4">
              {data.projects.slice(0, 5).map(project => (
                <div key={project.id} className="flex items-center justify-between p-3 rounded-lg bg-zinc-800/30 border border-zinc-800/50">
                  <div className="flex items-center gap-3">
                    <Briefcase size={16} className="text-blue-400" />
                    <span className="text-sm font-medium text-zinc-200">{project.properties["Project Name"].title[0]?.plain_text}</span>
                  </div>
                  <Badge variant="success">Active</Badge>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    );
  };

  const renderNotionSetup = () => (
    <div className="flex flex-col items-center justify-center h-[60vh] text-center max-w-md mx-auto">
      <div className="p-4 rounded-full bg-amber-500/10 text-amber-500 mb-6">
        <AlertCircle size={48} />
      </div>
      <h2 className="text-2xl font-bold text-zinc-100 mb-2">Notion Not Connected</h2>
      <p className="text-zinc-400 mb-8">
        EmpireOS requires a Notion integration to function as your startup's command center. 
        Please configure your environment variables or connect your workspace.
      </p>
      <div className="w-full space-y-4">
        <button 
          onClick={handleConnectNotion}
          className="w-full py-3 bg-white text-black font-bold rounded-xl hover:bg-zinc-200 transition-all flex items-center justify-center gap-2"
        >
          <RefreshCw size={20} />
          Connect Notion Workspace
        </button>
        
        <div className="w-full space-y-3 text-left bg-zinc-900 p-6 rounded-xl border border-zinc-800">
          <p className="text-xs font-mono text-zinc-500 uppercase tracking-wider mb-4">Required Config</p>
          <div className="flex items-center justify-between text-sm">
            <span className="text-zinc-400">NOTION_CLIENT_ID</span>
            <Badge variant={configStatus.oauthAvailable ? "success" : "warning"}>
              {configStatus.oauthAvailable ? "Set" : "Missing"}
            </Badge>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-zinc-400">NOTION_GOALS_DB_ID</span>
            <Badge variant={configStatus.notionConfigured ? "success" : "warning"}>
              {configStatus.notionConfigured ? "Set" : "Missing"}
            </Badge>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-black text-zinc-200 font-sans selection:bg-purple-500/30">
      {/* Sidebar */}
      <div className="fixed left-0 top-0 bottom-0 w-64 bg-zinc-950 border-r border-zinc-800 hidden lg:flex flex-col p-6">
        <div className="flex items-center gap-3 mb-10 px-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-orange-500 flex items-center justify-center shadow-[0_0_20px_rgba(168,85,247,0.3)]">
            <span className="font-bold text-white text-lg">E</span>
          </div>
          <h1 className="text-xl font-bold tracking-tight text-white">EmpireOS</h1>
        </div>

        <nav className="flex-1 space-y-2">
          <SidebarItem icon={LayoutDashboard} label="Dashboard" active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} />
          <SidebarItem icon={Target} label="Goals" active={activeTab === 'goals'} onClick={() => setActiveTab('goals')} />
          <SidebarItem icon={Briefcase} label="Projects" active={activeTab === 'projects'} onClick={() => setActiveTab('projects')} />
          <SidebarItem icon={CheckSquare} label="Tasks" active={activeTab === 'tasks'} onClick={() => setActiveTab('tasks')} />
          <SidebarItem icon={Users} label="Agents" active={activeTab === 'agents'} onClick={() => setActiveTab('agents')} />
          <SidebarItem icon={BarChart3} label="Analytics" active={activeTab === 'analytics'} onClick={() => setActiveTab('analytics')} />
        </nav>

        <div className="mt-auto pt-6 border-t border-zinc-800">
          <div className="flex items-center justify-between px-2">
            <div className="flex items-center gap-2">
              <div className={cn("w-2 h-2 rounded-full animate-pulse", configStatus.notionConfigured ? "bg-emerald-500" : "bg-amber-500")} />
              <span className="text-xs font-medium text-zinc-500 uppercase tracking-widest">Notion Sync</span>
            </div>
            <RefreshCw size={14} className="text-zinc-600 cursor-pointer hover:text-zinc-400 transition-colors" onClick={fetchData} />
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="lg:ml-64 p-8 min-h-screen">
        <header className="flex items-center justify-between mb-10">
          <div>
            <h2 className="text-3xl font-bold text-white capitalize">{activeTab}</h2>
            <p className="text-zinc-500 mt-1">
              {activeTab === 'dashboard' ? 'Welcome back, Founder. Your autonomous startup is running.' : `Manage your ${activeTab} and AI orchestration.`}
            </p>
          </div>
          <div className="flex items-center gap-4">
            <button 
              onClick={handleSync}
              disabled={syncing}
              className="flex items-center gap-2 px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-sm font-medium hover:bg-zinc-800 transition-colors disabled:opacity-50"
            >
              <RefreshCw size={18} className={cn(syncing && "animate-spin")} />
              {syncing ? "Syncing..." : "Sync Notion"}
            </button>
            <button 
              onClick={() => setShowNewGoalModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-sm font-medium transition-colors"
            >
              <Plus size={18} />
              New Goal
            </button>
            <button 
              onClick={generateReport}
              disabled={generatingReport}
              className="flex items-center gap-2 px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-sm font-medium hover:bg-zinc-800 transition-colors disabled:opacity-50"
            >
              {generatingReport ? <RefreshCw size={18} className="animate-spin" /> : <BarChart3 size={18} />}
              Weekly Report
            </button>
            <div className="w-10 h-10 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center overflow-hidden">
              <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=Founder" alt="Avatar" referrerPolicy="no-referrer" />
            </div>
          </div>
        </header>

        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            transition={{ duration: 0.2 }}
          >
            {loading ? (
              <div className="flex items-center justify-center h-[50vh]">
                <RefreshCw className="animate-spin text-purple-500" size={32} />
              </div>
            ) : !configStatus.notionConfigured ? (
              renderNotionSetup()
            ) : (
              activeTab === 'dashboard' ? renderDashboard() : 
              activeTab === 'goals' ? renderGoals() :
              activeTab === 'projects' ? renderProjects() :
              activeTab === 'tasks' ? renderTasks() :
              activeTab === 'agents' ? renderAgents() :
              activeTab === 'analytics' ? renderAnalytics() : null
            )}
          </motion.div>
        </AnimatePresence>

        {/* New Goal Modal */}
        <AnimatePresence>
          {showNewGoalModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md overflow-hidden"
              >
                <div className="p-6 border-b border-zinc-800 flex items-center justify-between">
                  <h3 className="text-xl font-bold text-white">New Strategic Goal</h3>
                  <button onClick={() => setShowNewGoalModal(false)} className="text-zinc-500 hover:text-white">
                    <Plus size={24} className="rotate-45" />
                  </button>
                </div>
                <form onSubmit={handleCreateGoal} className="p-6 space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-zinc-500 uppercase mb-2">Goal Name</label>
                    <input 
                      type="text" 
                      required
                      value={newGoal.name}
                      onChange={(e) => setNewGoal({...newGoal, name: e.target.value})}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2 text-white outline-none focus:border-purple-500 transition-colors"
                      placeholder="e.g. Expand to European Market"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-zinc-500 uppercase mb-2">Description</label>
                    <textarea 
                      value={newGoal.description}
                      onChange={(e) => setNewGoal({...newGoal, description: e.target.value})}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2 text-white outline-none focus:border-purple-500 transition-colors h-32 resize-none"
                      placeholder="Describe the objective and success criteria..."
                    />
                  </div>
                  <button 
                    type="submit"
                    className="w-full py-3 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-xl transition-all shadow-[0_0_20px_rgba(168,85,247,0.2)]"
                  >
                    Create Goal
                  </button>
                </form>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Report Modal */}
        <AnimatePresence>
          {report && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-3xl max-h-[80vh] overflow-hidden flex flex-col"
              >
                <div className="p-6 border-b border-zinc-800 flex items-center justify-between">
                  <h3 className="text-xl font-bold text-white">Weekly CEO Report</h3>
                  <button onClick={() => setReport(null)} className="text-zinc-500 hover:text-white">
                    <Plus size={24} className="rotate-45" />
                  </button>
                </div>
                <div className="p-8 overflow-y-auto prose prose-invert max-w-none">
                  <div className="whitespace-pre-wrap text-zinc-300 leading-relaxed">
                    {report}
                  </div>
                </div>
                <div className="p-6 border-t border-zinc-800 flex justify-end">
                  <button 
                    onClick={() => setReport(null)}
                    className="px-6 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg font-medium transition-all"
                  >
                    Close
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
