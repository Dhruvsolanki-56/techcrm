import type { Migration } from '../migrate';
import { baseline } from './0001_baseline';
import { changeRequests } from './0002_change_requests';
import { variableBillsAndIndexes } from './0003_variable_bills_and_indexes';

/** Ordered list. Add new migrations at the end; never edit one that has already been applied anywhere. */
export const MIGRATIONS: Migration[] = [baseline, changeRequests, variableBillsAndIndexes];
