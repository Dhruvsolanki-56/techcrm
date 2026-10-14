import type { Migration } from '../migrate';
import { baseline } from './0001_baseline';
import { changeRequests } from './0002_change_requests';
import { variableBillsAndIndexes } from './0003_variable_bills_and_indexes';
import { milestones } from './0004_milestones';
import { historySpecsScope } from './0005_history_specs_scope';
import { tds } from './0006_tds';
import { tdsOutsideInvoice } from './0007_tds_outside_invoice';

/** Ordered list. Add new migrations at the end; never edit one that has already been applied anywhere. */
export const MIGRATIONS: Migration[] = [baseline, changeRequests, variableBillsAndIndexes, milestones, historySpecsScope, tds, tdsOutsideInvoice];
