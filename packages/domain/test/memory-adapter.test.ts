import type { Role } from '../src/context.ts';
import { MemoryUnitOfWork } from '../src/memory/index.ts';
import { defineWorkflowScenarios, SCENARIO_START } from '../src/testing/scenarios.ts';
import { fixedClock } from '../src/time.ts';

defineWorkflowScenarios('memory', async () => {
  const uow = new MemoryUnitOfWork();
  return {
    uow,
    clock: fixedClock(SCENARIO_START),
    createTenant: async () => crypto.randomUUID(),
    addMember: async (tenantId: string, role: Role, displayName: string) => {
      const userId = crypto.randomUUID();
      uow.seed((state) => {
        state.members.push({
          tenantId,
          userId,
          email: null,
          displayName,
          role,
          status: 'active',
          createdAt: SCENARIO_START,
          updatedAt: SCENARIO_START,
          revokedAt: null,
          revokedBy: null,
        });
      });
      return userId;
    },
    outbox: async (tenantId: string) =>
      uow.snapshot().outbox.filter((e) => e.tenantId === tenantId),
    close: async () => undefined,
  };
});
