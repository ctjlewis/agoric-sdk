// @ts-check
/// <reference types="ses" />
import { trackTurns } from './track-turns.js';
import { localApplyFunction, localApplyMethod, localGet } from './local.js';
import { makePostponedHandler } from './postponed.js';

/**
 * @template T
 * @typedef {import('.').EHandler<T>} EHandler
 */

const {
  getOwnPropertyDescriptor,
  getOwnPropertyDescriptors,
  defineProperties,
  getPrototypeOf,
  setPrototypeOf,
  isFrozen,
} = Object;

// the following method (makeHandledPromise) is part
// of the shim, and will not be exported by the module once the feature
// becomes a part of standard javascript

/**
 * Create a HandledPromise class to have it support eventual send
 * (wavy-dot) operations.
 *
 * Based heavily on nanoq
 * https://github.com/drses/nanoq/blob/master/src/nanoq.js
 *
 * Original spec for the infix-bang (predecessor to wavy-dot) desugaring:
 * https://web.archive.org/web/20161026162206/http://wiki.ecmascript.org/doku.php?id=strawman:concurrency
 *
 * @returns {import('.').HandledPromiseConstructor} Handled promise
 */
export function makeHandledPromise() {
  // xs doesn't support WeakMap in pre-loaded closures
  // aka "vetted customization code"
  let presenceToHandler;
  let presenceToPromise;
  let promiseToPendingHandler;
  let promiseToPresence;
  let forwardedPromiseToPromise; // forwarding, union-find-ish
  function ensureMaps() {
    if (!presenceToHandler) {
      presenceToHandler = new WeakMap();
      presenceToPromise = new WeakMap();
      promiseToPendingHandler = new WeakMap();
      promiseToPresence = new WeakMap();
      forwardedPromiseToPromise = new WeakMap();
    }
  }

  /**
   * You can imagine a forest of trees in which the roots of each tree is an
   * unresolved HandledPromise or a non-Promise, and each node's parent is the
   * HandledPromise to which it was forwarded.  We maintain that mapping of
   * forwarded HandledPromise to its resolution in forwardedPromiseToPromise.
   *
   * We use something like the description of "Find" with "Path splitting"
   * to propagate changes down to the children efficiently:
   * https://en.wikipedia.org/wiki/Disjoint-set_data_structure
   *
   * @param {*} target Any value.
   * @returns {*} If the target was a HandledPromise, the most-resolved parent
   * of it, otherwise the target.
   */
  function shorten(target) {
    let p = target;
    // Find the most-resolved value for p.
    while (forwardedPromiseToPromise.has(p)) {
      p = forwardedPromiseToPromise.get(p);
    }
    const presence = promiseToPresence.get(p);
    if (presence) {
      // Presences are final, so it is ok to propagate
      // this upstream.
      while (target !== p) {
        const parent = forwardedPromiseToPromise.get(target);
        forwardedPromiseToPromise.delete(target);
        promiseToPendingHandler.delete(target);
        promiseToPresence.set(target, presence);
        target = parent;
      }
    } else {
      // We propagate p and remove all other pending handlers
      // upstream.
      // Note that everything except presences is covered here.
      while (target !== p) {
        const parent = forwardedPromiseToPromise.get(target);
        forwardedPromiseToPromise.set(target, p);
        promiseToPendingHandler.delete(target);
        target = parent;
      }
    }
    return target;
  }

  /**
   * This special handler accepts Promises, and forwards
   * handled Promises to their corresponding fulfilledHandler.
   *
   * @type {Required<EHandler<any>>}
   */
  let forwardingHandler;
  let handle;

  /**
   * @param {string} handlerName
   * @param {EHandler<any>} handler
   * @param {string} operation
   * @param {any} o
   * @param {any[]} opArgs
   * @param {any[]} [handlerLastArgs]
   * @returns {any}
   */
  const dispatchToHandler = (
    handlerName,
    handler,
    operation,
    o,
    opArgs,
    handlerLastArgs = [],
  ) => {
    let actualOp = operation;
    const triedOperations = [operation];
    const isSendOnly = actualOp.endsWith('SendOnly');
    const makeResult = result => (isSendOnly ? undefined : result);

    if (isSendOnly && typeof handler[actualOp] !== 'function') {
      // Substitute for sendonly with the corresponding non-sendonly operation.
      actualOp = actualOp.slice(0, -'SendOnly'.length);
      triedOperations.push(actualOp);
    }

    // Fast path: just call the actual operation.
    if (typeof handler[actualOp] === 'function') {
      return makeResult(handler[actualOp](o, ...opArgs, ...handlerLastArgs));
    }

    if (actualOp === 'applyMethod') {
      // Compose a missing applyMethod by get followed by applyFunction.
      const getResultP = handle(o, 'get', opArgs[0]);
      return makeResult(handle(getResultP, 'applyFunction', opArgs[1]));
    }

    if (actualOp === 'applyFunction') {
      actualOp = 'applyMethod';
      triedOperations.push(actualOp);
      if (typeof handler[actualOp] === 'function') {
        // Downlevel a missing applyFunction to applyMethod with undefined name.
        return makeResult(
          handler[actualOp](o, undefined, opArgs[0], ...handlerLastArgs),
        );
      }
    }

    const { details: X, quote: q } = assert;
    assert.fail(
      X`${q(handlerName)} is defined but has no methods needed for ${q(
        operation,
      )} (has ${q(Object.keys(handler).sort())})`,
      TypeError,
    );
  };

  /** @type {import('.').HandledPromiseConstructor} */
  let HandledPromise;

  /**
   * @template R
   * @param {import('.').HandledExecutor<R>} executor
   * @param {EHandler<Promise<R>>} [pendingHandler]
   * @returns {Promise<R>}
   */
  function HandledPromiseConstructor(executor, pendingHandler = undefined) {
    const { details: X } = assert;
    assert(new.target, X`must be invoked with "new"`);
    let handledResolve;
    let handledReject;
    let resolved = false;
    let resolvedTarget = null;
    let handledP;
    let continueForwarding = () => {};
    const superExecutor = (superResolve, superReject) => {
      handledResolve = value => {
        if (resolved) {
          return resolvedTarget;
        }
        assert(
          !forwardedPromiseToPromise.has(handledP),
          X`internal: already forwarded`,
          TypeError,
        );
        value = shorten(value);
        let targetP;
        if (
          promiseToPendingHandler.has(value) ||
          promiseToPresence.has(value)
        ) {
          targetP = value;
        } else {
          // We're resolving to a non-promise, so remove our handler.
          promiseToPendingHandler.delete(handledP);
          targetP = presenceToPromise.get(value);
        }
        // Ensure our data structure is a propert tree (avoid cycles).
        if (targetP && targetP !== handledP) {
          forwardedPromiseToPromise.set(handledP, targetP);
        } else {
          forwardedPromiseToPromise.delete(handledP);
        }

        // Remove stale pending handlers, set to canonical form.
        shorten(handledP);

        // Ensure our pendingHandler is cleaned up if not already.
        if (promiseToPendingHandler.has(handledP)) {
          handledP.then(_ => promiseToPendingHandler.delete(handledP));
        }

        // Finish the resolution.
        superResolve(value);
        resolved = true;
        resolvedTarget = value;

        // We're resolved, so forward any postponed operations to us.
        continueForwarding();
        return resolvedTarget;
      };
      handledReject = err => {
        if (resolved) {
          return;
        }
        assert(
          !forwardedPromiseToPromise.has(handledP),
          X`internal: already forwarded`,
          TypeError,
        );
        promiseToPendingHandler.delete(handledP);
        resolved = true;
        superReject(err);
        continueForwarding();
      };
    };
    handledP = harden(Reflect.construct(Promise, [superExecutor], new.target));

    ensureMaps();

    if (!pendingHandler) {
      // This is insufficient for actual remote handled Promises
      // (too many round-trips), but is an easy way to create a
      // local handled Promise.
      [pendingHandler, continueForwarding] = makePostponedHandler(
        HandledPromise,
      );
    }

    const validateHandler = h => {
      assert(Object(h) === h, X`Handler ${h} cannot be a primitive`, TypeError);
    };
    validateHandler(pendingHandler);

    // Until the handled promise is resolved, we use the pendingHandler.
    promiseToPendingHandler.set(handledP, pendingHandler);

    const rejectHandled = reason => {
      if (resolved) {
        return;
      }
      assert(
        !forwardedPromiseToPromise.has(handledP),
        X`internal: already forwarded`,
        TypeError,
      );
      handledReject(reason);
    };

    const resolveWithPresence = (presenceHandler, options = {}) => {
      if (resolved) {
        return resolvedTarget;
      }
      assert(
        !forwardedPromiseToPromise.has(handledP),
        X`internal: already forwarded`,
        TypeError,
      );
      try {
        // Sanity checks.
        validateHandler(presenceHandler);

        const { proxy: proxyOpts } = options;
        let presence;
        if (proxyOpts) {
          const {
            handler: proxyHandler,
            target: proxyTarget,
            revokerCallback,
          } = proxyOpts;
          if (revokerCallback) {
            // Create a proxy and its revoke function.
            const { proxy, revoke } = Proxy.revocable(
              proxyTarget,
              proxyHandler,
            );
            presence = proxy;
            revokerCallback(revoke);
          } else {
            presence = new Proxy(proxyTarget, proxyHandler);
          }
        } else {
          // Default presence.
          presence = Object.create(null);
        }

        // Validate and install our mapped target (i.e. presence).
        resolvedTarget = presence;

        // Create table entries for the presence mapped to the
        // fulfilledHandler.
        presenceToPromise.set(resolvedTarget, handledP);
        promiseToPresence.set(handledP, resolvedTarget);
        presenceToHandler.set(resolvedTarget, presenceHandler);

        // We committed to this presence, so resolve.
        handledResolve(resolvedTarget);
        return resolvedTarget;
      } catch (e) {
        assert.note(e, X`during resolveWithPresence`);
        handledReject(e);
        throw e;
      }
    };

    const resolveHandled = async target => {
      if (resolved) {
        return;
      }
      assert(
        !forwardedPromiseToPromise.has(handledP),
        X`internal: already forwarded`,
        TypeError,
      );
      try {
        // Resolve the target.
        handledResolve(target);
      } catch (e) {
        handledReject(e);
      }
    };

    // Invoke the callback to let the user resolve/reject.
    executor(
      (...args) => {
        resolveHandled(...args);
      },
      rejectHandled,
      resolveWithPresence,
    );

    return handledP;
  }

  function isFrozenPromiseThen(p) {
    return (
      isFrozen(p) &&
      getPrototypeOf(p) === Promise.prototype &&
      Promise.resolve(p) === p &&
      getOwnPropertyDescriptor(p, 'then') === undefined
    );
  }

  /** @type {import('.').HandledPromiseStaticMethods} */
  const staticMethods = {
    get(target, key) {
      return handle(target, 'get', key);
    },
    getSendOnly(target, key) {
      handle(target, 'getSendOnly', key);
    },
    applyFunction(target, args) {
      return handle(target, 'applyFunction', args);
    },
    applyFunctionSendOnly(target, args) {
      handle(target, 'applyFunctionSendOnly', args);
    },
    applyMethod(target, key, args) {
      return handle(target, 'applyMethod', key, args);
    },
    applyMethodSendOnly(target, key, args) {
      handle(target, 'applyMethodSendOnly', key, args);
    },
    resolve(value) {
      ensureMaps();
      // Resolving a Presence returns the pre-registered handled promise.
      let resolvedPromise = presenceToPromise.get(value);
      if (!resolvedPromise) {
        resolvedPromise = Promise.resolve(value);
      }
      // Prevent any proxy trickery.
      harden(resolvedPromise);
      if (isFrozenPromiseThen(resolvedPromise)) {
        return resolvedPromise;
      }
      // Assimilate the thenable.
      const executeThen = (resolve, reject) =>
        resolvedPromise.then(resolve, reject);
      return harden(
        Promise.resolve().then(_ => new HandledPromise(executeThen)),
      );
    },
  };

  function makeForwarder(operation, localImpl) {
    return (o, ...args) => {
      // We are in another turn already, and have the naked object.
      const presenceHandler = presenceToHandler.get(o);
      if (!presenceHandler) {
        return localImpl(o, ...args);
      }
      return dispatchToHandler(
        'presenceHandler',
        presenceHandler,
        operation,
        o,
        args,
      );
    };
  }

  // eslint-disable-next-line prefer-const
  forwardingHandler = {
    get: makeForwarder('get', localGet),
    getSendOnly: makeForwarder('getSendOnly', localGet),
    applyFunction: makeForwarder('applyFunction', localApplyFunction),
    applyFunctionSendOnly: makeForwarder(
      'applyFunctionSendOnly',
      localApplyFunction,
    ),
    applyMethod: makeForwarder('applyMethod', localApplyMethod),
    applyMethodSendOnly: makeForwarder('applyMethodSendOnly', localApplyMethod),
  };

  handle = (p, operation, ...opArgs) => {
    ensureMaps();
    const doDispatch = (handlerName, handler, o) =>
      dispatchToHandler(
        handlerName,
        handler,
        operation,
        o,
        opArgs,
        // eslint-disable-next-line no-use-before-define
        [returnedP],
      );
    const [trackedDoDispatch] = trackTurns([doDispatch]);
    const returnedP = new HandledPromise((resolve, reject) => {
      // We run in a future turn to prevent synchronous attacks,
      let raceIsOver = false;
      function win(handlerName, handler, o) {
        if (raceIsOver) {
          return;
        }
        try {
          resolve(trackedDoDispatch(handlerName, handler, o));
        } catch (reason) {
          reject(reason);
        }
        raceIsOver = true;
      }

      function lose(e) {
        if (raceIsOver) {
          return;
        }
        reject(e);
        raceIsOver = true;
      }

      // This contestant tries to win with the target's resolution.
      staticMethods
        .resolve(p)
        .then(o => win('forwardingHandler', forwardingHandler, o))
        .catch(lose);

      // This contestant sleeps a turn, but then tries to win immediately.
      staticMethods
        .resolve()
        .then(() => {
          p = shorten(p);
          const pendingHandler = promiseToPendingHandler.get(p);
          if (pendingHandler) {
            // resolve to the answer from the specific pending handler,
            win('pendingHandler', pendingHandler, p);
          } else if (Object(p) !== p || !('then' in p)) {
            // Not a Thenable, so use it.
            win('forwardingHandler', forwardingHandler, p);
          } else if (promiseToPresence.has(p)) {
            // We have the object synchronously, so resolve with it.
            const o = promiseToPresence.get(p);
            win('forwardingHandler', forwardingHandler, o);
          }
          // If we made it here without winning, then we will wait
          // for the other contestant to win instead.
        })
        .catch(lose);
    });

    // Workaround for Node.js: silence "Unhandled Rejection" by default when
    // using the static methods.
    returnedP.catch(_ => {});

    // We return a handled promise with the default pending handler.  This
    // prevents a race between the above Promise.resolves and pipelining.
    return returnedP;
  };

  // Add everything needed on the constructor.
  HandledPromiseConstructor.prototype = Promise.prototype;
  setPrototypeOf(HandledPromiseConstructor, Promise);
  defineProperties(
    HandledPromiseConstructor,
    getOwnPropertyDescriptors(staticMethods),
  );

  // FIXME: This is really ugly to bypass the type system, but it will be better
  // once we use Promise.delegated and don't have any [[Constructor]] behaviours.
  /** @type {unknown} */
  const HandledPromiseUnknown = HandledPromiseConstructor;
  HandledPromise = /** @type {typeof HandledPromise} */ (HandledPromiseUnknown);

  // We cannot harden(HandledPromise) because we're a vetted shim which
  // runs before lockdown() allows harden to function.  In that case,
  // though, globalThis.HandledPromise will be hardened after lockdown.
  return HandledPromise;
}
