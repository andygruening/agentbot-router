import { mkdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import type { AgentSelection } from "./agent-selection.ts";
import type { WebhookContext } from "./webhook-context.ts";
import type { AppConfig } from "../config/index.ts";
import type {
  IntegrationEvent,
  IntegrationPromptSection,
  WebhookIntegration
} from "../integrations/types.ts";

export async function persistWebhook(
  config: AppConfig,
  integration: WebhookIntegration,
  event: IntegrationEvent,
  rawBody: Buffer,
  agentSelection: AgentSelection,
  agentRunnerId: string,
  agentRunnerName: string
): Promise<WebhookContext> {
  const receivedAt = new Date().toISOString();
  const jobId = buildJobId(receivedAt, integration.id, event.eventName, event.deliveryId);
  const jobDir = path.join(config.core.eventDir, jobId);
  const envelopePath = path.join(jobDir, "webhook.json");
  const rawBodyPath = path.join(jobDir, "raw-body.json");
  const payloadPath = path.join(jobDir, "payload.json");
  const headersPath = path.join(jobDir, "headers.json");
  const promptPath = path.join(jobDir, "prompt.md");
  const agentOutputPath = path.join(jobDir, "agent-output.md");

  await mkdir(jobDir, { recursive: true });
  await Promise.all([
    writeFile(rawBodyPath, rawBody),
    writeFile(payloadPath, `${JSON.stringify(event.payload, null, 2)}\n`),
    writeFile(headersPath, `${JSON.stringify(event.headers, null, 2)}\n`)
  ]);

  const context: WebhookContext = {
    integrationId: integration.id,
    integrationName: integration.displayName,
    agentRunnerId,
    agentRunnerName,
    receivedAt,
    eventName: event.eventName,
    deliveryId: event.deliveryId,
    jobId,
    jobDir,
    envelopePath,
    rawBodyPath,
    payloadPath,
    headersPath,
    promptPath,
    agentOutputPath,
    agentSelection,
    integrationPrompt: emptyIntegrationPrompt(),
    metadata: event.metadata,
    payload: event.payload,
    headers: event.headers,
    rawBodyBytes: event.rawBodyBytes
  };

  await writeFile(
    envelopePath,
    `${JSON.stringify(
      {
        integration: {
          id: integration.id,
          name: integration.displayName
        },
        agentRunner: {
          id: agentRunnerId,
          name: agentRunnerName
        },
        receivedAt,
        eventName: event.eventName,
        deliveryId: event.deliveryId,
        jobId,
        agentSelection,
        headers: event.headers,
        payload: event.payload
      },
      null,
      2
    )}\n`
  );

  return context;
}

export async function claimWebhookDelivery(
  config: AppConfig,
  integration: WebhookIntegration,
  event: IntegrationEvent
): Promise<string | undefined> {
  const claimsDir = path.join(config.core.eventDir, ".deliveries");
  await mkdir(claimsDir, { recursive: true });
  const key = [integration.id, event.metadata.repositoryFullName ?? "", event.deliveryId].join(":");
  const claimPath = path.join(claimsDir, createHash("sha256").update(key).digest("hex"));
  try {
    await mkdir(claimPath);
    return claimPath;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return undefined;
    }
    throw error;
  }
}

export async function releaseWebhookDelivery(claimPath: string): Promise<void> {
  await rm(claimPath, { recursive: true, force: true });
}

function emptyIntegrationPrompt(): IntegrationPromptSection {
  return {
    savedFiles: "",
    guidance: "",
    responseInstructions: "",
    inlineContext: ""
  };
}

function buildJobId(
  receivedAt: string,
  integrationId: string,
  eventName: string,
  deliveryId: string
): string {
  const timestamp = receivedAt.replaceAll(":", "-").replaceAll(".", "-");
  return `${timestamp}_${sanitizePathSegment(integrationId)}_${sanitizePathSegment(eventName)}_${sanitizePathSegment(deliveryId)}`;
}

function sanitizePathSegment(value: string): string {
  const sanitized = value.replaceAll(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  return sanitized || "unknown";
}
