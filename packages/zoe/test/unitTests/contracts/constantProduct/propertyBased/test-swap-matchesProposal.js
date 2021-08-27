// @ts-check

// eslint-disable-next-line import/no-extraneous-dependencies
import { test } from '@agoric/zoe/tools/prepare-test-env-ava.js';

// eslint-disable-next-line import/no-extraneous-dependencies
import jsc from 'jsverify';
import { AmountMath } from '@agoric/ertp';

import { setupMintKits } from '../setupMints.js';
import { swapIn } from '../../../../../src/contracts/constantProduct/swapIn.js';
import { swapOut } from '../../../../../src/contracts/constantProduct/swapOut.js';
import { makeFeeRatio } from '../../../../../src/contracts/constantProduct/calcFees.js';
import {
  DEFAULT_POOL_FEE,
  DEFAULT_PROTOCOL_FEE,
} from '../../../../../src/contracts/constantProduct/defaults.js';

const proposalSatisfied = (r, given, wanted) =>
  AmountMath.isEmpty(r.swapperGives) ||
  (AmountMath.isGTE(given, r.swapperGives) &&
    AmountMath.isGTE(r.swapperGets, wanted));

const doRunInTest = (runPool, bldPool, given, wanted) => {
  const { run, bld, runKit, bldKit } = setupMintKits();
  if (wanted >= bldPool) {
    bldPool = 2 * wanted;
  }

  const pools = { Central: run(runPool), Secondary: bld(bldPool) };

  const fees = {
    protocolFee: makeFeeRatio(DEFAULT_PROTOCOL_FEE, runKit.brand),
    poolFee: makeFeeRatio(DEFAULT_POOL_FEE, bldKit.brand),
  };

  const results = swapIn(
    run(given),
    pools,
    bld(wanted),
    fees.protocolFee,
    fees.poolFee,
  );

  const validateDeltaXDeltaY = r =>
    AmountMath.isEqual(
      AmountMath.subtract(r.swapperGives, r.protocolFee),
      r.xIncrement,
    ) && AmountMath.isEqual(r.yDecrement, r.swapperGets);

  return (
    validateDeltaXDeltaY(results) &&
    proposalSatisfied(results, run(given), bld(wanted))
  );
};

const doRunOutTest = (runPool, bldPool, given, wanted) => {
  const { run, bld, runKit, bldKit } = setupMintKits();

  if (wanted >= runPool) {
    runPool = 2 * wanted;
  }
  const pools = { Central: run(runPool), Secondary: bld(bldPool) };

  const fees = {
    protocolFee: makeFeeRatio(DEFAULT_PROTOCOL_FEE, runKit.brand),
    poolFee: makeFeeRatio(DEFAULT_POOL_FEE, bldKit.brand),
  };

  const results = swapOut(
    bld(given),
    pools,
    run(wanted),
    fees.protocolFee,
    fees.poolFee,
  );

  const validateDeltaXDeltaY = r =>
    AmountMath.isEqual(r.swapperGives, r.xIncrement) &&
    AmountMath.isEqual(
      r.yDecrement,
      AmountMath.add(r.swapperGets, r.protocolFee),
    );

  return (
    validateDeltaXDeltaY(results) &&
    proposalSatisfied(results, bld(given), run(wanted))
  );
};

const doBldOutTest = (runPool, bldPool, given, wanted) => {
  const { run, bld, runKit } = setupMintKits();

  if (wanted >= bldPool) {
    bldPool = 2 * wanted;
  }
  const pools = { Central: run(runPool), Secondary: bld(bldPool) };

  const fees = {
    protocolFee: makeFeeRatio(DEFAULT_PROTOCOL_FEE, runKit.brand),
    poolFee: makeFeeRatio(DEFAULT_POOL_FEE, runKit.brand),
  };

  const results = swapOut(
    run(given),
    pools,
    bld(wanted),
    fees.protocolFee,
    fees.poolFee,
  );

  const validateDeltaXDeltaY = r =>
    AmountMath.isEqual(
      r.swapperGives,
      AmountMath.add(r.protocolFee, r.xIncrement),
    ) && AmountMath.isEqual(r.yDecrement, r.swapperGets);

  return (
    validateDeltaXDeltaY(results) &&
    proposalSatisfied(results, run(given), bld(wanted))
  );
};

const doBldInTest = (runPool, bldPool, given, wanted) => {
  const { run, bld, runKit } = setupMintKits();

  if (wanted >= runPool) {
    runPool = 2 * wanted;
  }
  const pools = { Central: run(runPool), Secondary: bld(bldPool) };

  const fees = {
    protocolFee: makeFeeRatio(DEFAULT_PROTOCOL_FEE, runKit.brand),
    poolFee: makeFeeRatio(DEFAULT_POOL_FEE, runKit.brand),
  };

  const results = swapIn(
    bld(given),
    pools,
    run(wanted),
    fees.protocolFee,
    fees.poolFee,
  );

  const validateDeltaXDeltaY = r =>
    AmountMath.isEqual(r.swapperGives, r.xIncrement) &&
    AmountMath.isEqual(
      r.yDecrement,
      AmountMath.add(r.swapperGets, r.protocolFee),
    );

  return (
    validateDeltaXDeltaY(results) &&
    proposalSatisfied(results, bld(given), run(wanted))
  );
};

test('jsverify constant swapInRun', t => {
  const runPoolAllocationArbitrary = jsc.suchthat(jsc.nat(), u => u > 1);
  const secondaryPoolAllocationArbitrary = jsc.suchthat(jsc.nat(), u => u > 5);
  const runValueInArbitrary = jsc.suchthat(jsc.nat(), u => u > 2);
  const bldValueOutArbitrary = jsc.suchthat(jsc.nat(), u => u > 1);

  const zeroOut = jsc.forall(
    runPoolAllocationArbitrary,
    secondaryPoolAllocationArbitrary,
    runValueInArbitrary,
    bldValueOutArbitrary,
    doRunInTest,
  );

  t.true(jsc.check(zeroOut));
});

test('jsverify constant swapOutRun', t => {
  const runPoolAllocationArbitrary = jsc.suchthat(jsc.nat(), u => u > 5);
  const secondaryPoolAllocationArbitrary = jsc.suchthat(jsc.nat(), u => u > 2);
  const runValueInArbitrary = jsc.suchthat(jsc.nat(), u => u > 2);
  const bldValueOutArbitrary = jsc.suchthat(jsc.nat(), u => u > 1);

  const zeroOut = jsc.forall(
    runPoolAllocationArbitrary,
    secondaryPoolAllocationArbitrary,
    runValueInArbitrary,
    bldValueOutArbitrary,
    doRunOutTest,
  );

  t.true(jsc.check(zeroOut));
});

test('jsverify constant swapOutBld', t => {
  const runPoolAllocationArbitrary = jsc.suchthat(jsc.nat(), u => u > 3);
  const secondaryPoolAllocationArbitrary = jsc.suchthat(jsc.nat(), u => u > 4);
  const runValueInArbitrary = jsc.suchthat(jsc.nat(), u => u > 2);
  const bldValueOutArbitrary = jsc.suchthat(jsc.nat(), u => u > 1);

  const zeroOut = jsc.forall(
    runPoolAllocationArbitrary,
    secondaryPoolAllocationArbitrary,
    runValueInArbitrary,
    bldValueOutArbitrary,
    doBldOutTest,
  );

  t.true(jsc.check(zeroOut));
});

test('jsverify constant swapInBld', t => {
  const runPoolAllocationArbitrary = jsc.suchthat(jsc.nat(), u => u > 3);
  const secondaryPoolAllocationArbitrary = jsc.suchthat(jsc.nat(), u => u > 4);
  const runValueInArbitrary = jsc.suchthat(jsc.nat(), u => u > 2);
  const bldValueOutArbitrary = jsc.suchthat(jsc.nat(), u => u > 1);

  const zeroOut = jsc.forall(
    runPoolAllocationArbitrary,
    secondaryPoolAllocationArbitrary,
    runValueInArbitrary,
    bldValueOutArbitrary,
    doBldInTest,
  );

  t.true(jsc.check(zeroOut));
});

test('jsverify constant swapOutRun large #s', t => {
  const runPoolAllocationArbitrary = jsc.suchthat(jsc.nat(), u => u > 5);
  const secondaryPoolAllocationArbitrary = jsc.suchthat(jsc.nat(), u => u > 2);
  const runValueInArbitrary = jsc.suchthat(jsc.nat(), u => u > 2);
  const bldValueOutArbitrary = jsc.suchthat(jsc.nat(), u => u > 1);

  const zeroOut = jsc.forall(
    runPoolAllocationArbitrary,
    secondaryPoolAllocationArbitrary,
    runValueInArbitrary,
    bldValueOutArbitrary,
    doRunOutTest,
  );

  t.true(jsc.check(zeroOut, { size: 1000000, tests: 50 }));
});

test('jsverify constant swapOutBld large #s', t => {
  const runPoolAllocationArbitrary = jsc.suchthat(jsc.nat(), u => u > 3);
  const secondaryPoolAllocationArbitrary = jsc.suchthat(jsc.nat(), u => u > 4);
  const runValueInArbitrary = jsc.suchthat(jsc.nat(), u => u > 2);
  const bldValueOutArbitrary = jsc.suchthat(jsc.nat(), u => u > 1);

  const zeroOut = jsc.forall(
    runPoolAllocationArbitrary,
    secondaryPoolAllocationArbitrary,
    runValueInArbitrary,
    bldValueOutArbitrary,
    doBldOutTest,
  );

  t.true(jsc.check(zeroOut, { size: 1000000, tests: 50 }));
});

test('jsverify constant swapInBld large #s', t => {
  const runPoolAllocationArbitrary = jsc.suchthat(jsc.nat(), u => u > 3);
  const secondaryPoolAllocationArbitrary = jsc.suchthat(jsc.nat(), u => u > 4);
  const runValueInArbitrary = jsc.suchthat(jsc.nat(), u => u > 2);
  const bldValueOutArbitrary = jsc.suchthat(jsc.nat(), u => u > 1);

  const zeroOut = jsc.forall(
    runPoolAllocationArbitrary,
    secondaryPoolAllocationArbitrary,
    runValueInArbitrary,
    bldValueOutArbitrary,
    doBldInTest,
  );

  t.true(jsc.check(zeroOut, { size: 1000000, tests: 50 }));
});

test('jsverify constant swapInRun Large #s', t => {
  const runPoolAllocationArbitrary = jsc.suchthat(jsc.nat(), u => u > 100000);
  const secondaryPoolAllocationArbitrary = jsc.suchthat(
    jsc.nat(),
    u => u > 100000,
  );
  const runValueInArbitrary = jsc.suchthat(jsc.nat(), u => u > 100);
  const bldValueOutArbitrary = jsc.suchthat(jsc.nat(), u => u > 50);

  const zeroOut = jsc.forall(
    runPoolAllocationArbitrary,
    secondaryPoolAllocationArbitrary,
    runValueInArbitrary,
    bldValueOutArbitrary,
    doRunInTest,
  );
  t.true(jsc.check(zeroOut, { size: 1000000, tests: 50 }));
});
