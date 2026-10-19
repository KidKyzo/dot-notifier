export type DemoStatus = "idle" | "running" | "done" | "error" | "needs_input";

export type DemoTask = {
  id: string;
  source: "codex" | "claude" | "antigravity-app" | "antigravity-cli" | "antigravity-ide" | "external";
  name: string;
  status: DemoStatus;
  title: string;
  detail?: string;
  progress: number;
  startedAt?: number;
  pid?: number;
  cwd?: string;
  usage?: { tokens?: number; quotaLeft?: number };
};

export type DemoMessage = {
  id: string;
  receivedAt: number;
  createdAt: number;
  sender: string;
  body: string;
  unread: boolean;
  app?: string;
};

export const initialTasks: DemoTask[] = [
  {
    id: "mock-codex-thread",
    source: "codex",
    name: "Codex",
    status: "running",
    title: "Editing code",
    progress: 0.42,
    startedAt: Date.now() - 134_000,
  },
];

export const emptyTasks: DemoTask[] = [
  {
    id: "codex-idle",
    source: "codex",
    name: "Codex",
    status: "idle",
    title: "No active task",
    progress: 0,
  },
];

export const initialMessages: DemoMessage[] = [
  { id: "mock-dimas", receivedAt: Date.now(), createdAt: Date.now(), sender: "Dimas", body: "I approved the pull request.", unread: false, app: "WhatsApp" },
];

export const incomingMessages: Array<Pick<DemoMessage, "sender" | "body">> = [
  { sender: "Rina", body: "Is the meeting at 3 or 4?" },
  { sender: "Budi", body: "The staging server is up." },
  { sender: "Sari", body: "I sent the photo from earlier." },
];
