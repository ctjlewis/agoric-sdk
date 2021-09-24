// @ts-check
// eslint-disable-next-line import/no-extraneous-dependencies
import { test } from '@agoric/swingset-vat/tools/prepare-test-env-ava.js';

import { E } from '@agoric/eventual-send';
import { Far } from '@agoric/marshal';
import { AssetKind, makeIssuerKit, AmountMath } from '../../src/index.js';
import { assertAmountConsistent } from '../../src/paymentLedger.js';

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

test('makeIssuerKit bad displayInfo.decimalPlaces', async t => {
  t.throws(
    () =>
      makeIssuerKit(
        'myTokens',
        AssetKind.NAT,
        // @ts-ignore Intentional wrong type for testing
        harden({ decimalPlaces: 'hello' }),
      ),
    {
      message: `"hello" must be a number`,
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

test('brand.isMyIssuer bad issuer', async t => {
  const { brand } = makeIssuerKit('myTokens');
  // @ts-ignore Intentional wrong type for testing
  const result = await brand.isMyIssuer('not an issuer');
  t.false(result);
});

test('assertAmountConsistent bad amount', t => {
  const { brand } = makeIssuerKit('myTokens');
  t.throws(
    // @ts-ignore Intentional wrong type for testing
    () => assertAmountConsistent(AmountMath.make(brand, 10n), 'something'),
    {
      message:
        'The amount "something" doesn\'t look like an amount. Did you pass a value instead?',
    },
  );

  t.throws(
    () =>
      assertAmountConsistent(AmountMath.make(brand, 10n), {
        brand,
        // @ts-ignore Intentional wrong type for testing
        value: () => 10n,
      }),
    {
      message: 'value "[Function value]" must be a Nat or an array',
    },
  );
});

// Tested in the context of an issuer.claim call, as assertLivePayment is not exported
test('assertLivePayment', async t => {
  const { issuer, mint, brand } = makeIssuerKit('fungible');
  const { mint: mintB, brand: brandB } = makeIssuerKit('fungibleB');

  const paymentB = E(mintB).mintPayment(AmountMath.make(brandB, 837n));

  // payment is of the wrong brand
  await t.throwsAsync(() => E(issuer).claim(paymentB), {
    message:
      '"[Alleged: fungibleB payment]" was not a live payment for brand "[Alleged: fungible brand]". It could be a used-up payment, a payment for another brand, or it might not be a payment at all.',
  });

  // payment is used up
  const payment = E(mint).mintPayment(AmountMath.make(brand, 10n));
  // use up payment
  await E(issuer).claim(payment);

  await t.throwsAsync(() => E(issuer).claim(payment), {
    message:
      '"[Alleged: fungible payment]" was not a live payment for brand "[Alleged: fungible brand]". It could be a used-up payment, a payment for another brand, or it might not be a payment at all.',
  });
});

test('issuer.combine bad payments array', async t => {
  const { issuer } = makeIssuerKit('fungible');
  const notAnArray = harden({
    length: 2,
    split: () => {},
  });
  // @ts-ignore Intentional wrong type for testing
  await t.throwsAsync(() => E(issuer).combine(notAnArray), {
    message:
      'cannot serialize Remotables with non-methods like "length" in {"length":2,"split":"[Function split]"}',
  });

  const notAnArray2 = Far('notAnArray2', {
    length: () => 2,
    split: () => {},
  });
  // @ts-ignore Intentional wrong type for testing
  await t.throwsAsync(() => E(issuer).combine(notAnArray2), {
    message:
      'combine requires an array of payments, not [object Alleged: notAnArray2]',
  });
});
