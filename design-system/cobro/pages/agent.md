# Agent (`/app/rules`) — page rules

Overrides MASTER.md where they differ. Source: Plan 4 spec §4.3.

## Job

Show what the agent may do, change its rules, and see everything it did.

## Order

1. `PageHeader` "Your agent".
2. Proposal notice (highlight background) when a proposal waits, linking to Home.
3. Status card (`AgentStatus`): state chip, plain help with the check interval
   (`CHECK_INTERVAL_MINUTES`), limits, last action, pause / resume.
4. Value protected (`ProtectedCard`): figure compared with keeping every payment in the local currency;
   price-request volume behind "Details".
5. "Your rules": the "If the agent ran now…" preview and the rules form (the screen's primary action,
   Save rules). Advanced settings stay collapsed.
6. History (`ActivityFeed`, `id="history"`, 40 events). Routine events (`HIDE_WHY_EVENTS`) have no "Why?".

## Layout

Content width `max-w-3xl`; one column at every width.
