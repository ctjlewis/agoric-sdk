// @ts-check
import { E } from '@agoric/eventual-send';

import liquidateBundle from './bundle-liquidateMinimum.js';
import autoswapBundle from './bundle-multipoolAutoswap.js';
import stablecoinBundle from './bundle-stablecoinMachine.js';

const SECONDS_PER_HOUR = 60n * 60n;
const SECONDS_PER_DAY = 24n * SECONDS_PER_HOUR;

const DEFAULT_POOL_FEE = 24n;
const DEFAULT_PROTOCOL_FEE = 6n;
/**
 * @param {Object} param0
 * @param {ERef<NameHub>} param0.agoricNames
 * @param {ERef<Board>} param0.board
 * @param {string} param0.centralName
 * @param {ERef<TimerService>} param0.chainTimerService
 * @param {Store<NameHub, NameAdmin>} param0.nameAdmins
 * @param {ERef<PriceAuthority>} param0.priceAuthority
 * @param {ERef<ZoeService>} param0.zoeWPurse
 * @param {Handle<'feeMintAccess'>} param0.feeMintAccess
 * @param {NatValue} param0.bootstrapPaymentValue
 * @param {NatValue} [param0.poolFee]
 * @param {NatValue} [param0.protocolFee]
 */
export async function installOnChain({
  agoricNames,
  board,
  centralName,
  chainTimerService,
  nameAdmins,
  priceAuthority,
  zoeWPurse,
  feeMintAccess,
  bootstrapPaymentValue,
  poolFee = DEFAULT_POOL_FEE,
  protocolFee = DEFAULT_PROTOCOL_FEE,
}) {
  // Fetch the nameAdmins we need.
  const [
    brandAdmin,
    installAdmin,
    instanceAdmin,
    issuerAdmin,
    uiConfigAdmin,
  ] = await Promise.all(
    ['brand', 'installation', 'instance', 'issuer', 'uiConfig'].map(
      async edge => {
        const hub = /** @type {NameHub} */ (await E(agoricNames).lookup(edge));
        return nameAdmins.get(hub);
      },
    ),
  );

  /** @type {Array<[string, SourceBundle]>} */
  const nameBundles = [
    ['liquidate', liquidateBundle],
    ['autoswap', autoswapBundle],
    ['stablecoin', stablecoinBundle],
  ];
  const [
    liquidationInstall,
    autoswapInstall,
    stablecoinMachineInstall,
  ] = await Promise.all(
    nameBundles.map(async ([name, bundle]) => {
      // Install the bundle in Zoe.
      const install = await E(zoeWPurse).install(bundle);
      // Advertise the installation in agoricNames.
      await E(installAdmin).update(name, install);
      // Return for variable assignment.
      return install;
    }),
  );

  const loanParams = {
    chargingPeriod: SECONDS_PER_HOUR,
    recordingPeriod: SECONDS_PER_DAY,
    poolFee,
    protocolFee,
  };

  const terms = harden({
    autoswapInstall,
    liquidationInstall,
    priceAuthority,
    loanParams,
    timerService: chainTimerService,
    bootstrapPaymentValue,
  });

  const privateArgs = harden({ feeMintAccess });

  const { instance, creatorFacet } = await E(zoeWPurse).startInstance(
    stablecoinMachineInstall,
    undefined,
    terms,
    privateArgs,
  );

  const [
    ammInstance,
    invitationIssuer,
    {
      issuers: { Governance: govIssuer, RUN: centralIssuer },
      brands: { Governance: govBrand, RUN: centralBrand },
    },
  ] = await Promise.all([
    E(creatorFacet).getAMM(),
    E(zoeWPurse).getInvitationIssuer(),
    E(zoeWPurse).getTerms(instance),
  ]);

  const treasuryUiDefaults = {
    CONTRACT_NAME: 'Treasury',
    AMM_NAME: 'autoswap',
    BRIDGE_URL: 'http://127.0.0.1:8000',
    // Avoid setting API_URL, so that the UI uses the same origin it came from,
    // if it has an api server.
    // API_URL: 'http://127.0.0.1:8000',
  };

  // Look up all the board IDs.
  const boardIdValue = [
    ['INSTANCE_BOARD_ID', instance],
    ['INSTALLATION_BOARD_ID', stablecoinMachineInstall],
    ['RUN_ISSUER_BOARD_ID', centralIssuer],
    ['RUN_BRAND_BOARD_ID', centralBrand],
    ['AMM_INSTALLATION_BOARD_ID', autoswapInstall],
    ['LIQ_INSTALLATION_BOARD_ID', liquidationInstall],
    ['AMM_INSTANCE_BOARD_ID', ammInstance],
    ['INVITE_BRAND_BOARD_ID', E(invitationIssuer).getBrand()],
  ];
  await Promise.all(
    boardIdValue.map(async ([key, valP]) => {
      const val = await valP;
      const boardId = await E(board).getId(val);
      treasuryUiDefaults[key] = boardId;
    }),
  );

  // Stash the defaults where the UI can find them.
  harden(treasuryUiDefaults);

  // Install the names in agoricNames.
  const nameAdminUpdates = [
    [uiConfigAdmin, treasuryUiDefaults.CONTRACT_NAME, treasuryUiDefaults],
    [instanceAdmin, treasuryUiDefaults.CONTRACT_NAME, instance],
    [instanceAdmin, treasuryUiDefaults.AMM_NAME, ammInstance],
    [brandAdmin, 'TreasuryGovernance', govBrand],
    [issuerAdmin, 'TreasuryGovernance', govIssuer],
    [brandAdmin, centralName, centralBrand],
    [issuerAdmin, centralName, centralIssuer],
  ];
  await Promise.all(
    nameAdminUpdates.map(([nameAdmin, name, value]) =>
      E(nameAdmin).update(name, value),
    ),
  );

  return creatorFacet;
}
