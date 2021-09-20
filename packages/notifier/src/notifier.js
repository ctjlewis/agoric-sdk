// @ts-check
// eslint-disable-next-line spaced-comment
/// <reference types="ses"/>

import { makePromiseKit } from '@agoric/promise-kit';
import { assert } from '@agoric/assert';
import { Far } from '@agoric/marshal';
import {
  makeAsyncIterableFromNotifier,
  observeIteration,
} from './asyncIterableAdaptor.js';

import './types.js';

/**
 * @template T
 * @param {BaseNotifier<T>} baseNotifierP
 * @returns {AsyncIterable<T> & SharableNotifier}
 */
export const makeNotifier = baseNotifierP => {
  const asyncIterable = makeAsyncIterableFromNotifier(baseNotifierP);

  return Far('notifier', {
    ...asyncIterable,

    /**
     * Use this to distribute a Notifier efficiently over the network,
     * by obtaining this from the Notifier to be replicated, and applying
     * `makeNotifier` to it at the new site to get an equivalent local
     * Notifier at that site.
     *
     * @returns {NotifierInternals}
     */
    getSharableNotifierInternals: () => baseNotifierP,
  });
};

/**
 * Produces a pair of objects, which allow a service to produce a stream of
 * update promises.
 *
 * The initial state argument has to be truly optional even though it can
 * be any first class value including `undefined`. We need to distinguish the
 * presence vs the absence of it, which we cannot do with the optional argument
 * syntax. Rather we use the arity of the `args` array.
 *
 * If no initial state is provided to `makeNotifierKit`, then it starts without
 * an initial state. Its initial state will instead be the state of the first
 * update.
 *
 * @template T
 * @param {[] | [T]} args the first state to be returned
 * @returns {NotifierRecord<T>} the notifier and updater
 */
export const makeNotifierKit = (...args) => {
  /** @type {PromiseRecord<UpdateRecord<T>>|undefined} */
  let nextPromiseKit = makePromiseKit();
  /** @type {UpdateCount} */
  let currentUpdateCount = 1; // avoid falsy numbers
  /** @type {UpdateCount} */
  let lastObservedUpdateCount;
  /** @type {UpdateRecord<T>|undefined} */
  let currentResponse;

  /** @type {Set<OnObservedCallback>|undefined} */
  let onObservedCallbacks = new Set();

  const hasState = () => currentResponse !== undefined;

  const final = () => currentUpdateCount === undefined;

  const baseNotifier = Far('baseNotifier', {
    // NaN matches nothing
    getUpdateSince(updateCount = NaN) {
      if (
        hasState() &&
        (final() ||
          (currentResponse && currentResponse.updateCount !== updateCount))
      ) {
        // If hasState() and either it is final() or it is
        // not the state of updateCount, return the current state.
        assert(currentResponse !== undefined);
        return Promise.resolve(currentResponse);
      }

      if (
        currentUpdateCount &&
        (!lastObservedUpdateCount ||
          lastObservedUpdateCount <= currentUpdateCount)
      ) {
        // Notice that the promise for the next state has just now been observed.
        lastObservedUpdateCount = currentUpdateCount + 1;

        // Queue the callbacks in a later turn so that they can't interfere with
        // our plans.
        const observedUpdateCount = lastObservedUpdateCount;
        Promise.resolve().then(() => {
          if (!onObservedCallbacks) {
            return;
          }
          onObservedCallbacks.forEach(cb => {
            try {
              cb(observedUpdateCount);
            } catch (e) {
              console.error(
                `Error observing notifier update ${observedUpdateCount}:`,
                e,
              );
            }
          });
        });
      }

      // return a promise for the next state.
      assert(nextPromiseKit);
      return nextPromiseKit.promise;
    },
  });

  const notifier = Far('notifier', {
    ...makeNotifier(baseNotifier),
    // TODO stop exposing baseNotifier methods directly
    ...baseNotifier,
  });

  const updater = harden({
    updateState(state) {
      if (final()) {
        throw new Error('Cannot update state after termination.');
      }

      // become hasState() && !final()
      assert(nextPromiseKit && currentUpdateCount);
      currentUpdateCount += 1;
      currentResponse = harden({
        value: state,
        updateCount: currentUpdateCount,
      });
      assert(currentResponse);
      nextPromiseKit.resolve(currentResponse);
      nextPromiseKit = makePromiseKit();
    },

    finish(finalState) {
      if (final()) {
        throw new Error('Cannot finish after termination.');
      }

      // become hasState() && final()
      assert(nextPromiseKit);
      currentUpdateCount = undefined;
      onObservedCallbacks = undefined;
      currentResponse = harden({
        value: finalState,
        updateCount: currentUpdateCount,
      });
      assert(currentResponse);
      nextPromiseKit.resolve(currentResponse);
      nextPromiseKit = undefined;
    },

    fail(reason) {
      if (final()) {
        throw new Error('Cannot fail after termination.');
      }

      // become !hasState() && final()
      assert(nextPromiseKit);
      currentUpdateCount = undefined;
      onObservedCallbacks = undefined;
      currentResponse = undefined;
      // Don't trigger Node.js's UnhandledPromiseRejectionWarning
      nextPromiseKit.promise.catch(_ => {});
      nextPromiseKit.reject(reason);
    },
  });

  if (args.length >= 1) {
    updater.updateState(args[0]);
  }

  /** @type {RegisterOnObserved} */
  const registerOnObserved = onObserved => {
    if (onObservedCallbacks) {
      onObservedCallbacks.add(onObserved);
    }
    return () => {
      if (!onObservedCallbacks) {
        return;
      }
      onObservedCallbacks.delete(onObserved);
    };
  };

  // notifier facet is separate so it can be handed out while updater
  // is tightly held
  return harden({ notifier, updater, registerOnObserved });
};

/**
 * Adaptor from async iterable to notifier.
 *
 * @template T
 * @param {AsyncIterable<T>} asyncIterable
 * @returns {Notifier<T>}
 */
export const makeNotifierFromAsyncIterable = asyncIterable => {
  const { notifier, updater } = makeNotifierKit();
  observeIteration(asyncIterable, updater);
  return notifier;
};
