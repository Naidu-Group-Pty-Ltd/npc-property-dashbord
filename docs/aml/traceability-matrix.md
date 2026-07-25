# AML Traceability Matrix (report §23)

Maps requirements → build artifacts → tests. Kept in sync with `acceptance-scenarios.md` and Launch Ops.

| Requirement | Phase | Tables | Edge fn | UI surface | Acceptance |
| --- | --- | --- | --- | --- | --- |
| Client intake + consent | 3 | `aml.cases`, `aml.consents` | `aml-cases`, `aml-client-portal` | Intake Queue, Client Portal | AS-01 |
| Verification (IDV) | 4 | `aml.verifications` | `aml-verification`, `aml-provider-webhook` | Verification | AS-01 |
| Screening (PEP / sanctions / adverse) | 4 | `aml.screenings`, `aml.matches` | `aml-provider-webhook` | Screening | AS-02 |
| Risk model | 5 | `aml.risk_scores` | `aml-risk` | Risk | AS-03 |
| Beneficial owners | 6 | `aml.counterparties`, `aml.counterparty_requests` | `aml-entities` | Counterparty | AS-04 |
| Finance handoff | 7 | `aml.handoff_tokens` (existing finance patterns) | `aml-finance` | Finance | AS-05 |
| Transactions | 8 | `aml.transactions` | `aml-transactions` | Transactions | AS-06 |
| Monitoring / rescreen | 9 | `aml.monitoring_rules`, `aml.alerts`, `aml.edd_cases` | `aml-monitoring` | Monitoring | AS-07 |
| AUSTRAC reporting | 10 | `aml.reports`, `aml.report_versions` | `aml-reporting` | AUSTRAC Reporting | AS-08 |
| Records + privacy | 11 | `aml.retention_schedules`, `aml.legal_holds`, `aml.retention_scans`, `aml.privacy_requests` | `aml-records` | Records & Privacy | AS-09 |
| Tenant / white-label / providers | 12 | `aml.tenant_settings`, `aml.plan_tiers`, `aml.provider_configs`, `aml.provider_metrics_daily` | `aml-tenant` | Configuration | AS-10 |
| Step-up + AI guardrail | 13 | `aml.step_up_challenges`, `aml.step_up_sessions`, `aml.ai_action_approvals`, `aml.release_gates`, `aml.resilience_drills` | `aml-step-up`, `aml-ai-guardrail`, `aml-release-gate`, `aml-resilience` | Governance | AS-11 |
| Rollout + acceptance + risk | 14 | `aml.rollout_stage_history`, `aml.acceptance_scenarios`, `aml.risk_register` | `aml-launch-ops` | Launch Ops | AS-12 |
| Non-AML regression | X | n/a | n/a | Command Centre / Client Portal / Finance Portal | AS-13 |
| Canonical workflow dimensions + activation contract + provenance (V2 directive Phase 1) | V2-1 | `aml.cases` (dimension/activation columns), `aml.workflow_dimension_migrations`, `aml.field_provenance` | `aml-cases`, `aml-finance` (`limited_status` finance-safe), `aml-client-portal` (portal-safe status) | Finance portal `LimitedAmlStatusCard`; contracts in `src/lib/aml/caseDimensions.ts` | `caseDimensions.test.ts`; docs/aml/canonical-contracts.md §7 |
| Operational Compliance Home + production-surface disclosure rules (V2 directive Phase 2) | V2-2 | n/a (uses existing case/monitoring/discrepancy reads) | `aml-cases` list, `aml-monitoring` summary, `aml-finance` list_discrepancies | `AmlComplianceHomeV3` (priority queue, next-best-action, operational metrics), `AmlCases`/`AmlOverview`/`AmlGuard` commercial copy | `amlUiDisclosure.source.test.ts` |
| Full-page case workspace + commercial register + restricted manual creation (V2 directive Phase 3) | V2-3 | existing case tables; `metadata.creation_exception` on exception cases | `aml-cases` (create restricted to MLRO exception; staff document/request ops) | `/admin/aml/cases/:caseId` (`AmlCaseWorkspace`: header, grouped nav, progress rail, action panel, Overview, Documents & Evidence, Requests), `AmlCases` table + saved views | `caseDimensions.test.ts` (rail), `amlPortalContracts.test.ts` (creation exception) |

Update this table whenever an AML surface adds or removes a table, edge function, or scenario.
