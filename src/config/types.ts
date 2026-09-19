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

export type DockerAgentRunnerConfig = {
  command: string;
  image: string;
  pull: boolean;
  codexAuthVolume: string;
  claudeAuthVolume: string;
  execTimeoutMs: number;
};

export type CodexAgentRunnerConfig = {
  defaultModel: string;
};

export type AgentConfig = {
  selection: AgentSelectionConfig;
  docker: DockerAgentRunnerConfig;
  claude: { model?: string };
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
