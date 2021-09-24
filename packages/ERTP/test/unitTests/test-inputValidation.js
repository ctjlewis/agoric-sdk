// @ts-check
// eslint-disable-next-line import/no-extraneous-dependencies
import { test } from '@agoric/swingset-vat/tools/prepare-test-env-ava.js';

import { E } from '@agoric/eventual-send';
import { Far } from '@agoric/marshal';
import { AssetKind, makeIssuerKit, AmountMath } from '../../src/index.js';

test('makeIssuerKit bad allegedName', async t => {
  // @ts-ignore Intentional wrong type for testing
  t.throws(() => makeIssuerKit({}), { message: `{} must be a string` });
});

test('makeIssuerKit bad assetKind', async t => {
  // @ts-ignore Intentional wrong type for testing
  t.throws(() => makeIssuerKit('myTokens', 'somethingWrong'), {
    message: `The assetKind "somethingWrong" must be either AssetKind.NAT or AssetKind.SET`,
  });
});

// We do not check the value of decimalPlaces
test.failing('makeIssuerKit bad displayInfo.decimalPlaces', async t => {
  t.throws(
    // @ts-ignore Intentional wrong type for testing
    () =>
      makeIssuerKit(
        'myTokens',
        AssetKind.NAT,
        harden({ decimalPlaces: 'hello' }),
      ),
    {
      message: `The assetKind "somethingWrong" must be either AssetKind.NAT or AssetKind.SET`,
    },
  );
});

test('makeIssuerKit bad displayInfo.assetKind', async t => {
  // The bad assetKind gets silently overridden
  const { issuer } = makeIssuerKit(
    'myTokens',
    AssetKind.NAT,
    // @ts-ignore Intentional wrong type for testing
    harden({
      assetKind: 'something',
    }),
  );
  t.deepEqual(issuer.getDisplayInfo(), {
    assetKind: 'nat',
  });
});

test('makeIssuerKit bad displayInfo.whatever', async t => {
  t.throws(
    () =>
      makeIssuerKit(
        'myTokens',
        AssetKind.NAT,
        // @ts-ignore Intentional wrong type for testing
        harden({
          whatever: 'something',
        }),
      ),
    {
      message:
        'key "whatever" was not one of the expected keys ["decimalPlaces","assetKind"]',
    },
  );
});

test('makeIssuerKit malicious displayInfo', async t => {
  t.throws(
    () =>
      makeIssuerKit(
        'myTokens',
        AssetKind.NAT,
        // @ts-ignore Intentional wrong type for testing
        Far('malicious', { doesSomething: () => {} }),
      ),
    {
      message:
        'A displayInfo can only be a pass-by-copy record: "[Alleged: malicious]"',
    },
  );
});

// Note: because optShutdownWithFailure should never be able to be
// reached, we can't easily test that pathway.
test('makeIssuerKit bad optShutdownWithFailure', async t => {
  t.throws(
    // @ts-ignore Intentional wrong type for testing
    () => makeIssuerKit('myTokens', AssetKind.NAT, undefined, 'not a function'),
    {
      message: '"not a function" must be a function',
    },
  );
});
