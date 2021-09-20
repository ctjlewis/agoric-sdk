// @ts-check

import { E } from '@agoric/eventual-send';
import { Far } from '@agoric/marshal';
import { makeSubscriptionKit } from '@agoric/notifier';
import { makeStore } from '@agoric/store';
import { AmountMath, AssetKind } from '@agoric/ertp';
import {
  startCounter,
  getOpenQuestions,
  getQuestion,
  getPoserInvitation,
} from './registrarTools';

const { details: X } = assert;

// The ClaimsRegistrar relies on an attestation contract to validate ownership
// of voting shares. The registrar provides voting facets corresponding to the
// attestations to ensure that only valid holders of shares have the ability to
// vote.

// The attestation contract is responsible for ensuring that each votable share
// has a persistent handle that survives through extending the duration of the
// lien and augmenting the number of shares it represents. This contract makes
// that persistent handle visible to ballotCounters.

/** @type {ContractStartFn} */
const start = zcf => {
  const {
    brands: { Attestation: attestationBrand },
  } = zcf.getTerms();
  const empty = AmountMath.makeEmpty(attestationBrand, AssetKind.SET);

  /** @type {Store<Handle<'Question'>, QuestionRecord>} */
  const allQuestions = makeStore('Question');
  const { subscription, publication } = makeSubscriptionKit();

  const makeVoterInvitation = attestations => {
    const voterDescription = 'something based on addresses and amounts';

    // The registrar doesn't know the clock, but it believes the times are
    // comparable between the clock for voting deadlines and lien expirations.

    return Far(`a voter ${voterDescription}`, {
      castBallotFor: (questionHandle, positions) => {
        const { voteCap, deadline } = allQuestions.get(questionHandle);
        return attestations
          .filter(({ expiration }) => expiration > deadline)
          .forEach(({ amountLiened, handle }) => {
            return E(voteCap).submitVote(handle, positions, amountLiened);
          });
      },
    });
  };

  /** @type {OfferHandler} */
  const vote = seat => {
    const attestation = seat.getAmountAllocated('Attestation');
    assert(
      AmountMath.isGTE(attestation, empty, attestationBrand),
      X`There was no attestation escrowed`,
    );
    // Give the user their attestation payment back
    seat.exit();

    return makeVoterInvitation((attestation.value));
  };

  /** @type {AddQuestion} */
  const addQuestion = async (voteCounter, questionSpec) => {
    return startCounter(
      zcf,
      questionSpec,
      0n,
      voteCounter,
      allQuestions,
      publication,
    );
  };

  /** @type {ClaimsRegistrarPublic} */
  const publicFacet = Far('publicFacet', {
    getQuestionSubscription: () => subscription,
    getOpenQuestions: () => getOpenQuestions(allQuestions),
    getInstance: zcf.getInstance,
    getQuestion: handleP => getQuestion(handleP, allQuestions),
    makeVoteInvitation: () => zcf.makeInvitation(vote, 'attestation vote'),
  });

  /** @type {RegistrarCreatorFacet} */
  const creatorFacet = Far('creatorFacet', {
    getPoserInvitation: () => getPoserInvitation(zcf, addQuestion),
    addQuestion,
    getQuestionSubscription: () => subscription,
    getPublicFacet: () => publicFacet,
  });

  return { publicFacet, creatorFacet };
};

harden(start);
export { start };
