import type { AppContext } from '../core/context';
import type { Engine } from '../crud/engine';
import type { TaskDomain } from '../domain/tasks';

/** What resource definitions are built from. The engine is looked up lazily because resources are created before it exists. */
export interface ResourceDeps {
  ctx: AppContext;
  getEngine: () => Engine;
  tasks: TaskDomain;
}
