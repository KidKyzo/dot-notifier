export type DemoStatus = "idle" | "running" | "done" | "error" | "needs_input";

export type DemoTask = {
  id: string;
  source: "codex";
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
};

export const initialTasks: DemoTask[] = [
  {
    id: "mock-codex-thread",
    source: "codex",
    name: "Codex",
    status: "running",
    title: "refactor auth",
    detail: "Updated the token refresh flow and verified the auth tests.",
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
    title: "Tidak ada task aktif",
    progress: 0,
  },
];

export const initialMessages: DemoMessage[] = [
  { id: "mock-dimas", receivedAt: Date.now(), createdAt: Date.now(), sender: "Dimas", body: "PR-nya sudah saya approve.", unread: false },
];

export const incomingMessages: Array<Pick<DemoMessage, "sender" | "body">> = [
  { sender: "Rina", body: "Jadi meeting jam 3 atau jam 4?" },
  { sender: "Budi", body: "Server staging sudah naik." },
  { sender: "Sari", body: "Foto tadi sudah saya kirim ya." },
];
