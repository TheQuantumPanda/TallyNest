import {
  GroupFinancialCycle,
  groupFinancialCycleCollectionValidator,
} from '../models/group-financial-cycle.model.js';

// Installation only. Cycle reads/writes stay private to later protocol milestones.
export async function ensureGroupFinancialCycleIndexes() {
  const db = GroupFinancialCycle.db.db;
  const name = GroupFinancialCycle.collection.name;
  try {
    await db.createCollection(name, {
      validator: groupFinancialCycleCollectionValidator,
      validationLevel: 'strict',
      validationAction: 'error',
    });
  } catch (error) {
    if (error.code !== 48) throw error;
  }
  await db.command({
    collMod: name,
    validator: groupFinancialCycleCollectionValidator,
    validationLevel: 'strict',
    validationAction: 'error',
  });
  await GroupFinancialCycle.init();
}
