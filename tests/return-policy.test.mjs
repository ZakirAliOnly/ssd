import test from 'node:test';
import assert from 'node:assert/strict';
import { tsLoader } from './helpers/load-ts.mjs';
const {requiresLateConfirmation,businessDate}=tsLoader()('lib/returnPeriod.ts');
test('reversal window uses elapsed creation time and the business day uses Karachi',()=>{
 const created=new Date('2026-10-01T12:00:00Z');
 assert.equal(requiresLateConfirmation(created,new Date('2026-10-02T11:59:59.999Z')),false);
 assert.equal(requiresLateConfirmation(created,new Date('2026-10-02T12:00:00Z')),false);
 assert.equal(requiresLateConfirmation(created,new Date('2026-10-02T12:00:00.001Z')),true);
 assert.equal(businessDate(new Date('2026-10-02T20:00:00Z')),'2026-10-03');
});
