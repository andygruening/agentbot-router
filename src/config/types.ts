export type GitHubReactionContent =
  | "+1"
  | "-1"
  | "laugh"
  | "confused"
  | "heart"
  | "hooray"
  | "rocket"
  | "eyes";

export type CoreConfig = {
  host: string;
  port: number;
  eventDir: string;
  maxBodyBytes: number;
  allowedEvents: ReadonlySet<string> | undefined;
  dryRun: boolean;
  promptPrefix?: string;
};

export type AgentSelectionConfig = {
  triggerTag: string;
  defaultAgent: string;
  tags: string[];
};

export type ClaudeAgentRunnerConfig = {
  command: string;
  model?: string;
  extraArgs: string[];
  envPassthrough: string[];
  workingDirectory?: string;
  execTimeoutMs: number;
};

export type CodexAgentRunnerConfig = {
  command: string;
  defaultModel: string;
  extraArgs: string[];
  envPassthrough: string[];
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  approvalPolicy?: "untrusted" | "on-request" | "never";
  workingDirectory?: string;
  execTimeoutMs: number;
};

export type AgentConfig = {
  selection: AgentSelectionConfig;
  claude: ClaudeAgentRunnerConfig;
  codex: CodexAgentRunnerConfig;
};

export type GitHubIntegrationConfig = {
  webhookPath: string;
  webhookSecret?: string;
  responseEnabled: boolean;
  contextEnabled: boolean;
  contextInlineMaxBytes: number;
  command: string;
  completionReaction: Exclude<GitHubReactionContent, "eyes">;
  envPassthrough: string[];
};

export type IntegrationConfig = {
  github: GitHubIntegrationConfig;
};

export type AppConfig = {
  core: CoreConfig;
  agents: AgentConfig;
  integrations: IntegrationConfig;
};
