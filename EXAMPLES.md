# Agent Tag Examples

Use these tags in a GitHub issue, pull request, or new comment. Put one agent tag in the request. On `issue_comment` events, the receiver scans only the new comment.

The tables list every model and reasoning combination bundled in `jev-choices.json`, plus the model-default forms supported by direct tags. A direct tag only works when its CLI is listed in `AGENT_TAGS` and authenticated on the server.

## Automatic and CLI defaults

| Tag | Example prompt |
| --- | --- |
| `$agent` | `$agent Investigate this failure, choose the best configured agent and model, and implement the fix.` |
| `$codex` | `$codex Review this issue and handle it with the configured Codex defaults.` |
| `$claude` | `$claude Review this issue and handle it with the configured Claude defaults.` |

`$agent` uses TypeSafe Jev when `TYPESAFE_API_KEY` is configured. Jev chooses only among agents listed in `AGENT_TAGS`; otherwise the receiver uses `AGENT_DEFAULT` with that CLI's configured model.

A model tag without a reasoning suffix uses that model's configured or CLI default effort. Use this form when you want a specific model and do not need to control reasoning depth.

## Codex tags

| Tag | Example prompt |
| --- | --- |
| `$codex:gpt-6-astra` | `$codex:gpt-6-astra Review this security-sensitive migration, implement the required fixes, and verify the complete workflow.` |
| `$codex:gpt-6-astra:low` | `$codex:gpt-6-astra:low Quickly identify the cause of this small validation bug and fix it.` |
| `$codex:gpt-6-astra:medium` | `$codex:gpt-6-astra:medium Implement the requested API endpoint and add focused tests.` |
| `$codex:gpt-6-astra:high` | `$codex:gpt-6-astra:high Diagnose this intermittent production failure and implement a verified fix.` |
| `$codex:gpt-6-astra:xhigh` | `$codex:gpt-6-astra:xhigh Redesign this cross-service workflow and migrate it without breaking compatibility.` |
| `$codex:gpt-6-astra:max` | `$codex:gpt-6-astra:max Investigate this critical data-corruption issue across the repository and produce a fully verified fix.` |
| `$codex:gpt-6-astra:ultra` | `$codex:gpt-6-astra:ultra Coordinate the implementation of this large platform migration across independent modules and verify the integrated result.` |
| `$codex:gpt-5.6-sol` | `$codex:gpt-5.6-sol Investigate this complex regression, implement the fix, and validate all affected paths.` |
| `$codex:gpt-5.6-sol:low` | `$codex:gpt-5.6-sol:low Review this focused patch for a clear correctness issue.` |
| `$codex:gpt-5.6-sol:medium` | `$codex:gpt-5.6-sol:medium Add retry handling to this integration and test the expected failure cases.` |
| `$codex:gpt-5.6-sol:high` | `$codex:gpt-5.6-sol:high Trace this concurrency bug across the worker pipeline and fix it safely.` |
| `$codex:gpt-5.6-sol:xhigh` | `$codex:gpt-5.6-sol:xhigh Refactor this subsystem while preserving its public API and migration path.` |
| `$codex:gpt-5.6-sol:max` | `$codex:gpt-5.6-sol:max Perform a deep security and correctness review, fix confirmed issues, and run comprehensive checks.` |
| `$codex:gpt-5.6-sol:ultra` | `$codex:gpt-5.6-sol:ultra Implement this repository-wide architecture change using parallel work where useful, then validate the integration.` |
| `$codex:gpt-5.6-terra` | `$codex:gpt-5.6-terra Implement this feature using the existing project patterns and run the relevant checks.` |
| `$codex:gpt-5.6-terra:low` | `$codex:gpt-5.6-terra:low Fix this typo and update the nearby assertion.` |
| `$codex:gpt-5.6-terra:medium` | `$codex:gpt-5.6-terra:medium Add pagination to this list endpoint with focused tests.` |
| `$codex:gpt-5.6-terra:high` | `$codex:gpt-5.6-terra:high Debug this failing background job and implement a robust fix.` |
| `$codex:gpt-5.6-terra:xhigh` | `$codex:gpt-5.6-terra:xhigh Plan and implement this multi-module feature with compatibility coverage.` |
| `$codex:gpt-5.6-terra:max` | `$codex:gpt-5.6-terra:max Resolve this difficult architectural defect and verify every affected workflow.` |
| `$codex:gpt-5.6-terra:ultra` | `$codex:gpt-5.6-terra:ultra Deliver this broad feature across the server, client, and tests, coordinating independent work as appropriate.` |
| `$codex:gpt-5.6-luna` | `$codex:gpt-5.6-luna Make this focused code change and run the relevant test.` |
| `$codex:gpt-5.6-luna:low` | `$codex:gpt-5.6-luna:low Rename this option and update its references.` |
| `$codex:gpt-5.6-luna:medium` | `$codex:gpt-5.6-luna:medium Add this small configuration field and test its parser.` |
| `$codex:gpt-5.6-luna:high` | `$codex:gpt-5.6-luna:high Find why this focused test suite is flaky and fix the root cause.` |
| `$codex:gpt-5.6-luna:xhigh` | `$codex:gpt-5.6-luna:xhigh Review this contained module and simplify it without changing behavior.` |
| `$codex:gpt-5.6-luna:max` | `$codex:gpt-5.6-luna:max Investigate this difficult but bounded bug and provide a verified fix.` |

Codex reasoning levels are `low`, `medium`, `high`, `xhigh`, `max`, and `ultra`. GPT 5.6 Luna supports levels through `max`; the other bundled Codex models also support `ultra`.

## Claude tags

| Tag | Example prompt |
| --- | --- |
| `$claude:fable` | `$claude:fable Investigate this ambiguous repository-wide problem and implement the best supported solution.` |
| `$claude:fable:low` | `$claude:fable:low Quickly explain this function and correct the obvious bug.` |
| `$claude:fable:medium` | `$claude:fable:medium Implement this feature from the issue description and add targeted tests.` |
| `$claude:fable:high` | `$claude:fable:high Diagnose this complex failure using the issue history and repository evidence.` |
| `$claude:fable:xhigh` | `$claude:fable:xhigh Design and implement this major subsystem change with a safe migration.` |
| `$claude:fable:max` | `$claude:fable:max Resolve this high-impact architectural problem after a thorough repository investigation.` |
| `$claude:fable:ultracode` | `$claude:fable:ultracode Execute this large coding project across multiple components and verify the final integrated behavior.` |
| `$claude:opus` | `$claude:opus Review this architecture proposal, implement the agreed design, and verify it carefully.` |
| `$claude:opus:low` | `$claude:opus:low Review this small patch and fix any clear defect.` |
| `$claude:opus:medium` | `$claude:opus:medium Implement this service integration with focused error-handling tests.` |
| `$claude:opus:high` | `$claude:opus:high Debug this subtle state-management regression and implement a durable fix.` |
| `$claude:opus:xhigh` | `$claude:opus:xhigh Restructure this complex domain module while preserving external contracts.` |
| `$claude:opus:max` | `$claude:opus:max Analyze this critical design failure deeply and deliver a thoroughly tested correction.` |
| `$claude:opus:ultracode` | `$claude:opus:ultracode Implement this extensive refactor across packages and coordinate the required validation work.` |
| `$claude:sonnet` | `$claude:sonnet Implement this everyday feature cleanly and run the relevant checks.` |
| `$claude:sonnet:low` | `$claude:sonnet:low Update this error message and its test.` |
| `$claude:sonnet:medium` | `$claude:sonnet:medium Add filtering to this endpoint and cover the main cases.` |
| `$claude:sonnet:high` | `$claude:sonnet:high Investigate this difficult integration test failure and fix the underlying issue.` |
| `$claude:sonnet:xhigh` | `$claude:sonnet:xhigh Implement this multi-step feature across the API and worker layers.` |
| `$claude:sonnet:max` | `$claude:sonnet:max Resolve this demanding repository-wide regression with comprehensive validation.` |
| `$claude:sonnet:ultracode` | `$claude:sonnet:ultracode Carry out this large refactor across modules, tests, and documentation.` |
| `$claude:haiku` | `$claude:haiku Summarize the cause of this straightforward error and suggest the smallest fix.` |

Claude Fable, Opus, and Sonnet support `low`, `medium`, `high`, `xhigh`, `max`, and `ultracode`. Haiku uses its default effort and therefore has no reasoning suffix in the supported catalog.

## Choosing a reasoning level

| Level | Typical use |
| --- | --- |
| `low` | Small, clear, latency-sensitive requests. |
| `medium` | Routine implementation, review, and analysis. |
| `high` | Difficult debugging and substantial multi-step changes. |
| `xhigh` | Highly complex work where deeper analysis is worth more time. |
| `max` | The hardest high-value problems requiring maximum reasoning depth. |
| `ultra` | Codex work that can benefit from maximum reasoning and automatic delegation. |
| `ultracode` | Large Claude Code workflows that benefit from deep reasoning and orchestration. |

## Tag rules

- Use only one agent/model/reasoning selection in a request. Conflicting tags are rejected as ambiguous.
- The form is `$codex:<model>:<reasoning>` or `$claude:<model>:<reasoning>`.
- Omit the reasoning suffix to use the selected model's default effort.
- Omit both model and reasoning to use the CLI defaults.
- `$agent` does not accept model or reasoning suffixes; it delegates the choice to Jev or falls back to `AGENT_DEFAULT`.
- Labels can trigger an agent, but put the complete task instructions in the issue, pull request, or comment body.
