import type { AppContext } from '../core/context';
import type { Engine } from '../crud/engine';
import type { ResourceMap } from '../crud/types';
import { createTaskDomain, type TaskDomain } from '../domain/tasks';
import { billingResources } from './billing';
import { deliveryResources } from './delivery';
import { salesResources } from './sales';

/** Builds every resource definition. The engine and the task domain depend on each other, so the engine is looked up lazily. */
export function buildResources(ctx: AppContext, getEngine: () => Engine): { resources: ResourceMap; tasks: TaskDomain } {
  const tasks = createTaskDomain(ctx, getEngine);
  const deps = { ctx, getEngine, tasks };
  return { resources: { ...salesResources(deps), ...deliveryResources(deps), ...billingResources(deps) }, tasks };
}
