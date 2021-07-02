// @ts-check

import { E } from '@agoric/eventual-send';
import { Far } from '@agoric/marshal';
import { observeIteration } from '@agoric/notifier';
import { sameStructure } from '@agoric/same-structure';

const { quote: q } = assert;

const verify = async (log, issue, registrarPublicFacet, instances) => {
  const questionHandles = await E(registrarPublicFacet).getOpenQuestions();
  const detailsP = questionHandles.map(h => {
    const question = E(registrarPublicFacet).getQuestion(h);
    return E(question).getDetails();
  });
  const detailsPlural = await Promise.all(detailsP);
  const details = detailsPlural.find(d => sameStructure(d.issue, issue));

  const { positions, method, issue: iss, maxChoices } = details;
  log(`verify question from instance: ${q(issue)}, ${q(positions)}, ${method}`);
  const c = await E(registrarPublicFacet).getName();
  log(`Verify: q: ${q(iss)}, max: ${maxChoices}, committee: ${c}`);
  const registrarInstance = await E(registrarPublicFacet).getInstance();
  log(
    `Verify instances: registrar: ${registrarInstance ===
      instances.registrarInstance}, counter: ${details.counterInstance ===
      instances.counterInstance}`,
  );
};

const build = async (log, zoe) => {
  return Far('voter', {
    createVoter: async (name, invitation, choice) => {
      const registrarInstance = await E(zoe).getInstance(invitation);
      const registrarPublicFacet = E(zoe).getPublicFacet(registrarInstance);
      const seat = E(zoe).offer(invitation);
      const voteFacet = E(seat).getOfferResult();

      const votingObserver = Far('voting observer', {
        updateState: details => {
          log(`${name} voted for ${q(choice)}`);
          return E(voteFacet).castBallotFor(details.questionHandle, [choice]);
        },
      });
      const subscription = E(registrarPublicFacet).getQuestionSubscription();
      observeIteration(subscription, votingObserver);

      return Far(`Voter ${name}`, {
        verifyBallot: (question, instances) =>
          verify(log, question, registrarPublicFacet, instances),
      });
    },
    createMultiVoter: async (name, invitation, choices) => {
      const registrarInstance = await E(zoe).getInstance(invitation);
      const registrarPublicFacet = E(zoe).getPublicFacet(registrarInstance);
      const seat = E(zoe).offer(invitation);
      const voteFacet = E(seat).getOfferResult();

      const voteMap = new Map();
      choices.forEach(entry => {
        const [issue, position] = entry;
        voteMap.set(issue.text, position);
      });
      const votingObserver = Far('voting observer', {
        updateState: details => {
          const choice = voteMap.get(details.issue.text);
          log(`${name} voted on ${q(details.issue)} for ${q(choice)}`);
          return E(voteFacet).castBallotFor(details.questionHandle, [choice]);
        },
      });
      const subscription = E(registrarPublicFacet).getQuestionSubscription();
      observeIteration(subscription, votingObserver);

      return Far(`Voter ${name}`, {
        verifyBallot: (question, instances) =>
          verify(log, question, registrarPublicFacet, instances),
      });
    },
  });
};

export const buildRootObject = vatPowers =>
  Far('root', {
    build: (...args) => build(vatPowers.testLog, ...args),
  });
