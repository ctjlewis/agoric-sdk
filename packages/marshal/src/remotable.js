// eslint-disable-next-line spaced-comment
/// <reference types="ses"/>

import { assert, details as X, q } from '@agoric/assert';
import {
  PASS_STYLE,
  passStyleOf,
  getErrorConstructor,
  assertCanBeRemotable,
  assertIface,
} from './passStyleOf.js';

import './types.js';

const {
  getPrototypeOf,
  setPrototypeOf,
  create,
  isFrozen,
  prototype: objectPrototype,
} = Object;

const { prototype: functionPrototype } = Function;

/**
 * Do a deep copy of the object, handling Proxies and recursion.
 * The resulting copy is guaranteed to be pure data, as well as hardened.
 * Such a hardened, pure copy cannot be used as a communications path.
 *
 * @template {OnlyData} T
 * @param {T} val input value.  NOTE: Must be hardened!
 * @returns {T} pure, hardened copy
 */
export const pureCopy = val => {
  // passStyleOf now asserts that val has no pass-by-copy cycles.
  const passStyle = passStyleOf(val);
  switch (passStyle) {
    case 'bigint':
    case 'boolean':
    case 'null':
    case 'number':
    case 'string':
    case 'undefined':
    case 'symbol':
      return val;

    case 'copyArray':
    case 'copyRecord': {
      const obj = /** @type {Object} */ (val);

      // Create a new identity.
      const copy = /** @type {T} */ (passStyle === 'copyArray' ? [] : {});

      // Make a deep copy on the new identity.
      // Object.entries(obj) takes a snapshot (even if a Proxy).
      // Since we already know it is a copyRecord or copyArray, we
      // know that Object.entries is safe enough. On a copyRecord it
      // will represent all the own properties. On a copyArray it
      // will represent all the own properties except for the length.
      Object.entries(obj).forEach(([prop, value]) => {
        copy[prop] = pureCopy(value);
      });
      return harden(copy);
    }

    case 'copyError': {
      // passStyleOf is currently not fully validating error objects,
      // in order to tolerate malformed error objects to preserve the initial
      // complaint, rather than complain about the form of the complaint.
      // However, pureCopy(error) must be safe. We should obtain nothing from
      // the error object other than the `name` and `message` and we should
      // only copy stringified forms of these, where `name` must be an
      // error constructor name.
      const unk = /** @type {unknown} */ (val);
      const err = /** @type {Error} */ (unk);

      const { name, message } = err;

      const EC = getErrorConstructor(`${name}`) || Error;
      const copy = harden(new EC(`${message}`));
      // Even the cleaned up error copy, if sent to the console, should
      // cause hidden diagnostic information of the original error
      // to be logged.
      assert.note(copy, X`copied from error ${err}`);

      const unk2 = /** @type {unknown} */ (harden(copy));
      return /** @type {T} */ (unk2);
    }

    case 'remotable': {
      assert.fail(
        X`Input value ${q(
          passStyle,
        )} cannot be copied as it must be passed by reference`,
        TypeError,
      );
    }

    case 'promise': {
      assert.fail(X`Promises cannot be copied`, TypeError);
    }

    default:
      assert.fail(
        X`Input value ${q(passStyle)} is not recognized as data`,
        TypeError,
      );
  }
};
harden(pureCopy);

/**
 * @param {Object} remotable
 * @param {InterfaceSpec} iface
 * @returns {Object}
 */
const makeRemotableProto = (remotable, iface) => {
  const oldProto = getPrototypeOf(remotable);
  if (typeof remotable === 'object') {
    assert(
      oldProto === objectPrototype || oldProto === null,
      X`For now, remotables cannot inherit from anything unusual, in ${remotable}`,
    );
  } else if (typeof remotable === 'function') {
    assert(
      oldProto === functionPrototype ||
        getPrototypeOf(oldProto) === functionPrototype,
      X`Far functions must originally inherit from Function.prototype, in ${remotable}`,
    );
  } else {
    assert.fail(X`unrecognized typeof ${remotable}`);
  }
  // Assign the arrow function to a variable to set its .name.
  const toString = () => `[${iface}]`;
  return harden(
    create(oldProto, {
      [PASS_STYLE]: { value: 'remotable' },
      toString: { value: toString },
      [Symbol.toStringTag]: { value: iface },
    }),
  );
};

/**
 * Create and register a Remotable.  After this, getInterfaceOf(remotable)
 * returns iface.
 *
 * // https://github.com/Agoric/agoric-sdk/issues/804
 *
 * @param {InterfaceSpec} [iface='Remotable'] The interface specification for
 * the remotable. For now, a string iface must be "Remotable" or begin with
 * "Alleged: ", to serve as the alleged name. More general ifaces are not yet
 * implemented. This is temporary. We include the
 * "Alleged" as a reminder that we do not yet have SwingSet or Comms Vat
 * support for ensuring this is according to the vat hosting the object.
 * Currently, Alice can tell Bob about Carol, where VatA (on Alice's behalf)
 * misrepresents Carol's `iface`. VatB and therefore Bob will then see
 * Carol's `iface` as misrepresented by VatA.
 * @param {undefined} [props=undefined] Currently may only be undefined.
 * That plan is that own-properties are copied to the remotable
 * @param {object} [remotable={}] The object used as the remotable
 * @returns {object} remotable, modified for debuggability
 */
function Remotable(iface = 'Remotable', props = undefined, remotable = {}) {
  assertIface(iface);
  iface = pureCopy(harden(iface));
  assert(iface);
  // TODO: When iface is richer than just string, we need to get the allegedName
  // in a different way.
  assert(props === undefined, X`Remotable props not yet implemented ${props}`);

  // Fail fast: check that the unmodified object is able to become a Remotable.
  assertCanBeRemotable(remotable);

  // Ensure that the remotable isn't already marked.
  assert(
    !(PASS_STYLE in remotable),
    X`Remotable ${remotable} is already marked as a ${q(
      remotable[PASS_STYLE],
    )}`,
  );
  // Ensure that the remotable isn't already frozen.
  assert(!isFrozen(remotable), X`Remotable ${remotable} is already frozen`);
  const remotableProto = makeRemotableProto(remotable, iface);

  // Take a static copy of the enumerable own properties as data properties.
  // const propDescs = getOwnPropertyDescriptors({ ...props });
  const mutateHardenAndCheck = target => {
    // defineProperties(target, propDescs);
    setPrototypeOf(target, remotableProto);
    harden(target);
    assertCanBeRemotable(target);
  };

  // Fail fast: check a fresh remotable to see if our rules fit.
  mutateHardenAndCheck({});

  // Actually finish the new remotable.
  mutateHardenAndCheck(remotable);

  // COMMITTED!
  // We're committed, so keep the interface for future reference.
  assert(iface !== undefined); // To make TypeScript happy
  return remotable;
}

harden(Remotable);
export { Remotable };

/**
 * A concise convenience for the most common `Remotable` use.
 *
 * @template T
 * @param {string} farName This name will be prepended with `Alleged: `
 * for now to form the `Remotable` `iface` argument.
 * @param {T|undefined} [remotable={}] The object used as the remotable
 * @returns {T} remotable, modified for debuggability
 */
const Far = (farName, remotable = undefined) => {
  const r = remotable === undefined ? {} : remotable;
  return Remotable(`Alleged: ${farName}`, undefined, r);
};

harden(Far);
export { Far };