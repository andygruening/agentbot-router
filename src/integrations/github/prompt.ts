import type { AppConfig } from "../../config/index.ts";
import type { WebhookContext } from "../../core/webhook-context.ts";
import type { IntegrationPromptSection } from "../types.ts";
import type { GitHubIssueContextState } from "./context.ts";

export function buildGitHubPromptSection(
  config: AppConfig,
  context: WebhookContext,
  githubContext: GitHubIssueContextState | undefined
): IntegrationPromptSection {
  const contextPrompt = githubIssueContextPrompt(githubContext);

  void config;
  return {
    savedFiles: contextPrompt.savedFiles,
    guidance: `${contextPrompt.guidance}

Repository delivery rule: a separate preparation container has already cloned and checked out the correct repository and, when supplied by the webhook, the correct branch. Work only in the current checkout. Git and GitHub CLI are intentionally unavailable in the agent container. Do not create branches, worktrees, commits, pushes, pull requests, GitHub comments, or reactions through any other tool. After you finish, a separate finalization container inspects the shared checkout. It pushes actual changes to the supplied branch, or creates a new branch and pull request when no branch was supplied. If you only answer a question and do not modify files, it creates no branch or pull request.`,
    responseInstructions:
      "The webhook receiver owns GitHub reactions and final result comments. Write the response file, but do not add reactions or post GitHub comments yourself.",
    publicResponseName: "GitHub response",
    inlineContext: contextPrompt.inlineContext
  };
}

function githubIssueContextPrompt(
  githubContext: GitHubIssueContextState | undefined
): {
  savedFiles: string;
  guidance: string;
  inlineContext: string;
} {
  if (!githubContext) {
    return {
      savedFiles: "",
      guidance: "No extended GitHub issue/PR context was fetched for this delivery.",
      inlineContext: ""
    };
  }

  if (githubContext.skippedReason) {
    return {
      savedFiles: `- GitHub issue/PR context: skipped (${githubContext.skippedReason})`,
      guidance: "No extended GitHub issue/PR context was fetched for this delivery.",
      inlineContext: ""
    };
  }

  const openPullRequests = githubContext.linkedOpenPullRequests
    .map((pullRequest) => `${pullRequest.repo}#${pullRequest.number}`)
    .join(", ");
  const savedFiles = [
    `- GitHub issue/PR context digest: ${githubContext.markdownPath}`,
    `- Raw GitHub issue/PR context JSON: ${githubContext.rawPath}`
  ].join("\n");
  const guidance = [
    "Read the GitHub issue/PR context digest before acting. Use the raw JSON when you need exact issue, comment, review, or pull request fields.",
    `The receiver detected code-change intent from the triggering text: ${githubContext.codeChangeRequested ? "yes" : "no"}.`,
    `Referenced open pull requests: ${openPullRequests || "none"}.`,
    githubContext.codeChangeRequested
      ? "Make the requested source changes in the current checkout. The container wrapper owns branch, commit, push, and pull request operations."
      : "Do not modify source files merely because a PR is referenced. Treat referenced PRs as context unless the triggering text asks for code changes."
  ].join("\n");
  const inlineContext = githubContext.inlineMarkdown
    ? `GitHub issue/PR context digest:\n\n\`\`\`markdown\n${githubContext.inlineMarkdown}\`\`\``
    : `The GitHub issue/PR context digest is ${githubContext.markdownBytes} bytes, so it was not inlined here. Read ${githubContext.markdownPath}.`;

  return {
    savedFiles,
    guidance,
    inlineContext
  };
}
