import type { AgentSelectionConfig } from "../config/index.ts";

export type AgentTagSource = "label" | "text";

export type AgentSelection = {
  agent: string;
  tag: string;
  source: AgentTagSource;
  usesDefaultAgent: boolean;
  model?: string;
  reasoning?: string;
};

export type AgentTagCandidate = {
  value: string;
  source: AgentTagSource;
};

export class AmbiguousAgentTagError extends Error {
  readonly selections: string[];
  readonly agents: string[];

  constructor(selections: string[]) {
    super(`Multiple agent tags matched: ${selections.join(", ")}`);
    this.selections = selections;
    this.agents = Array.from(new Set(selections.map((selection) => selection.split(":")[0] ?? selection)));
  }
}

export class InvalidAgentTagError extends Error {}

type ConfiguredAgentTag = {
  normalized: string;
  agent: string;
};

type ParsedAgentTag = ConfiguredAgentTag & {
  model?: string;
  reasoning?: string;
};

export function selectAgentFromCandidates(
  candidates: AgentTagCandidate[],
  config: AgentSelectionConfig
): AgentSelection | undefined {
  const configuredTags = configuredAgentTagsFromConfig(config);
  const directAgentMatches = candidates.flatMap((candidate) => {
    const parsedTag = parseAgentTag(candidate.value, configuredTags);
    return parsedTag ? [{ candidate, parsedTag }] : [];
  });
  const uniqueSelections = Array.from(
    new Set(directAgentMatches.map(({ parsedTag }) =>
      [parsedTag.agent, parsedTag.model ?? "", parsedTag.reasoning ?? ""].join(":")))
  );

  if (uniqueSelections.length > 1) {
    throw new AmbiguousAgentTagError(uniqueSelections);
  }

  const directAgentMatch = directAgentMatches[0];
  if (directAgentMatch) {
    return {
      agent: directAgentMatch.parsedTag.agent,
      tag: directAgentMatch.candidate.value,
      source: directAgentMatch.candidate.source,
      usesDefaultAgent: false,
      ...(directAgentMatch.parsedTag.model ? { model: directAgentMatch.parsedTag.model } : {}),
      ...(directAgentMatch.parsedTag.reasoning ? { reasoning: directAgentMatch.parsedTag.reasoning } : {})
    };
  }

  const triggerTag = normalizeAgentTag(config.triggerTag);
  const defaultTrigger = candidates.find(
    (candidate) => normalizeAgentTag(candidate.value) === triggerTag
  );
  if (!defaultTrigger) {
    return undefined;
  }

  return {
    agent: config.defaultAgent,
    tag: defaultTrigger.value,
    source: defaultTrigger.source,
    usesDefaultAgent: true
  };
}

export function extractDollarTags(text: string): string[] {
  const matches = text.matchAll(/(^|[\s([{<])\$([a-zA-Z0-9][a-zA-Z0-9._:-]{0,160})(?![a-zA-Z0-9._:-])/g);
  return Array.from(matches, (match) => (match[2] ?? "").replace(/[.;,!?]+$/, ""));
}

export function normalizeAgentTag(value: string): string {
  return value.trim().toLowerCase().replaceAll(/\s+/g, "-");
}

function configuredAgentTagsFromConfig(
  config: AgentSelectionConfig
): ConfiguredAgentTag[] {
  const seen = new Set<string>();
  const agents = [config.defaultAgent, ...config.tags];

  return agents.flatMap((agent) => {
    const normalized = normalizeAgentTag(agent);
    if (!normalized || seen.has(normalized)) {
      return [];
    }

    seen.add(normalized);
    return [{ normalized, agent }];
  });
}

function parseAgentTag(value: string, configuredTags: ConfiguredAgentTag[]): ParsedAgentTag | undefined {
  const normalized = normalizeAgentTag(value);
  const [agentName, model, reasoning, ...extra] = normalized.split(":");
  const configuredTag = configuredTags.find((tag) => tag.normalized === agentName);
  if (!configuredTag) return undefined;
  if (extra.length > 0 || (model !== undefined && !isModelName(model)) || (reasoning !== undefined && !reasoning)) {
    throw new InvalidAgentTagError(`Invalid agent tag: ${value}`);
  }
  if (reasoning && !supportedReasoning(configuredTag.agent).includes(reasoning)) {
    throw new InvalidAgentTagError(`Unsupported reasoning "${reasoning}" for ${configuredTag.agent}`);
  }
  return { ...configuredTag, ...(model ? { model } : {}), ...(reasoning ? { reasoning } : {}) };
}

function isModelName(value: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{0,79}$/i.test(value) && !value.startsWith("-");
}

function supportedReasoning(agent: string): string[] {
  return agent === "codex"
    ? ["minimal", "low", "medium", "high", "xhigh"]
    : ["low", "medium", "high", "xhigh", "max"];
}
