// Source file from duniter: Crypto-currency software to manage libre currency such as Ğ1
// Copyright (C) 2018  Cedric Moreau <cem.moreau@gmail.com>
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.

import {parsers} from "../../../app/lib/common-libs/parsers/index"
import {Indexer} from "../../../app/lib/indexer"
import {LOCAL_RULES_FUNCTIONS} from "../../../app/lib/rules/local_rules"
import {ALIAS} from "../../../app/lib/rules/index"
import {BLOCK_TEST_DATA} from "../../data/blocks-data"
import {BlockDTO} from "../../../app/lib/dto/BlockDTO"

const should = require('should');

const conf = {

  sigQty: 1,
  powZeroMin: 1,
  powPeriod: 18,
  incDateMin: 10,
  avgGenTime: 60,
  medianTimeBlocks: 20,
  dt: 100,
  ud0: 100,
  c: 0.1
}

describe("Block local coherence", function(){

  it('a valid block should be well formatted',                                                      test(ALIAS.ALL_LOCAL_BUT_POW_AND_SIGNATURE, BLOCK_TEST_DATA.VALID_ROOT));

  describe("should be rejected", function(){

  it('if wrong signature block',                                                                    test(LOCAL_RULES_FUNCTIONS.checkBlockSignature, BLOCK_TEST_DATA.WRONG_SIGNATURE, 'Block\'s signature must match'));
  it('if root block does not have Parameters',                                                      test(LOCAL_RULES_FUNCTIONS.checkParameters, BLOCK_TEST_DATA.ROOT_WITHOUT_PARAMETERS, 'Parameters must be provided for root block'));
  it('if proof-of-work does not match PoWMin field',                                                test(LOCAL_RULES_FUNCTIONS.checkProofOfWork, BLOCK_TEST_DATA.WRONG_PROOF_OF_WORK, 'Not a proof-of-work'));
  it('if non-root has Parameters',                                                                  test(LOCAL_RULES_FUNCTIONS.checkParameters, BLOCK_TEST_DATA.NON_ROOT_WITH_PARAMETERS, 'Parameters must not be provided for non-root block'));
  it('if root block has PreviousHash',                                                              test(LOCAL_RULES_FUNCTIONS.checkPreviousHash, BLOCK_TEST_DATA.ROOT_WITH_PREVIOUS_HASH, 'PreviousHash must not be provided for root block'));
  it('if root block has PreviousIssuer',                                                            test(LOCAL_RULES_FUNCTIONS.checkPreviousIssuer, BLOCK_TEST_DATA.ROOT_WITH_PREVIOUS_ISSUER, 'PreviousIssuer must not be provided for root block'));
  it('if non-root block does not have PreviousHash',                                                test(LOCAL_RULES_FUNCTIONS.checkPreviousHash, BLOCK_TEST_DATA.NON_ROOT_WITHOUT_PREVIOUS_HASH, 'PreviousHash must be provided for non-root block'));
  it('if non-root block does not have PreviousIssuer',                                              test(LOCAL_RULES_FUNCTIONS.checkPreviousIssuer, BLOCK_TEST_DATA.NON_ROOT_WITHOUT_PREVIOUS_ISSUER, 'PreviousIssuer must be provided for non-root block'));
  it('a V2 block with Dividend must have UnitBase field',                                           test(LOCAL_RULES_FUNCTIONS.checkUnitBase, BLOCK_TEST_DATA.UD_BLOCK_WIHTOUT_BASE, 'Document has unkown fields or wrong line ending format'));
  it('a V3 root block must have UnitBase field',                                                    test(LOCAL_RULES_FUNCTIONS.checkUnitBase, BLOCK_TEST_DATA.V3_ROOT_BLOCK_NOBASE, 'Document has unkown fields or wrong line ending format'));
  it('a V3 root block must have UnitBase field equal 0',                                            test(LOCAL_RULES_FUNCTIONS.checkUnitBase, BLOCK_TEST_DATA.V3_ROOT_BLOCK_POSITIVE_BASE, 'UnitBase must equal 0 for root block'));
  it('a block with wrong date (in past)',                                                           test(LOCAL_RULES_FUNCTIONS.checkBlockTimes, BLOCK_TEST_DATA.WRONG_DATE_LOWER, 'A block must have its Time between MedianTime and MedianTime + 1440'));
  it('a block with wrong date (in future, but too far)',                                            test(LOCAL_RULES_FUNCTIONS.checkBlockTimes, BLOCK_TEST_DATA.WRONG_DATE_HIGHER_BUT_TOO_HIGH, 'A block must have its Time between MedianTime and MedianTime + 1440'));
  it('a root block with different time & medianTime should fail',                                   test(LOCAL_RULES_FUNCTIONS.checkBlockTimes, BLOCK_TEST_DATA.WRONG_ROOT_TIMES, 'Root block must have Time equal MedianTime'));
  it('a block with good date',                                                                      test(LOCAL_RULES_FUNCTIONS.checkBlockTimes, BLOCK_TEST_DATA.GOOD_DATE_HIGHER));
  it('Block cannot contain wrongly signed identities',                                              test(LOCAL_RULES_FUNCTIONS.checkIdentitiesSignature, BLOCK_TEST_DATA.WRONGLY_SIGNED_IDENTITIES, 'Identity\'s signature must match'));
  it('block with colliding uids in identities',                                                     test(LOCAL_RULES_FUNCTIONS.checkIdentitiesUserIDConflict, BLOCK_TEST_DATA.COLLIDING_UIDS, 'Block must not contain twice same identity uid'));
  it('a block with colliding pubkeys in identities',                                                test(LOCAL_RULES_FUNCTIONS.checkIdentitiesPubkeyConflict, BLOCK_TEST_DATA.COLLIDING_PUBKEYS, 'Block must not contain twice same identity pubkey'));
  it('a block with identities not matchin joins',                                                   test(LOCAL_RULES_FUNCTIONS.checkIdentitiesMatchJoin, BLOCK_TEST_DATA.WRONG_IDTY_MATCH_JOINS, 'Each identity must match a newcomer line with same userid and certts'));
  it('Block cannot contain wrongly signed join',                                                    test(LOCAL_RULES_FUNCTIONS.checkMembershipsSignature, BLOCK_TEST_DATA.WRONGLY_SIGNED_JOIN, 'Membership\'s signature must match'));
  it('Block cannot contain wrongly signed active',                                                  test(LOCAL_RULES_FUNCTIONS.checkMembershipsSignature, BLOCK_TEST_DATA.WRONGLY_SIGNED_ACTIVE, 'Membership\'s signature must match'));
  it('Block cannot contain wrongly signed leave',                                                   test(LOCAL_RULES_FUNCTIONS.checkMembershipsSignature, BLOCK_TEST_DATA.WRONGLY_SIGNED_LEAVE, 'Membership\'s signature must match'));
  it('Block cannot contain a same pubkey more than once in joiners',                                test(LOCAL_RULES_FUNCTIONS.checkPubkeyUnicity, BLOCK_TEST_DATA.MULTIPLE_JOINERS, 'Block cannot contain a same pubkey more than once in joiners, actives, leavers and excluded'));
  it('Block cannot contain a same pubkey more than once in actives',                                test(LOCAL_RULES_FUNCTIONS.checkPubkeyUnicity, BLOCK_TEST_DATA.MULTIPLE_ACTIVES, 'Block cannot contain a same pubkey more than once in joiners, actives, leavers and excluded'));
  it('Block cannot contain a same pubkey more than once in leavers',                                test(LOCAL_RULES_FUNCTIONS.checkPubkeyUnicity, BLOCK_TEST_DATA.MULTIPLE_LEAVES, 'Block cannot contain a same pubkey more than once in joiners, actives, leavers and excluded'));
  it('Block cannot contain a same pubkey more than once in excluded',                               test(LOCAL_RULES_FUNCTIONS.checkPubkeyUnicity, BLOCK_TEST_DATA.MULTIPLE_EXCLUDED, 'Block cannot contain a same pubkey more than once in joiners, actives, leavers and excluded'));
  it('Block cannot contain a same pubkey more than once in joiners, actives, leavers and excluded', test(LOCAL_RULES_FUNCTIONS.checkPubkeyUnicity, BLOCK_TEST_DATA.MULTIPLE_OVER_ALL, 'Block cannot contain a same pubkey more than once in joiners, actives, leavers and excluded'));
  it('Block cannot have revoked key in joiners,actives,leavers',                                    test(LOCAL_RULES_FUNCTIONS.checkMembershipUnicity, BLOCK_TEST_DATA.REVOKED_WITH_MEMBERSHIPS, 'Unicity constraint PUBLIC_KEY on MINDEX is not respected'));
  it('Block cannot have revoked key duplicates',                                                    test(LOCAL_RULES_FUNCTIONS.checkRevokedUnicity, BLOCK_TEST_DATA.REVOKED_WITH_DUPLICATES, 'A single revocation per member is allowed'));
  it('Block revoked keys must be in excluded',                                                      test(LOCAL_RULES_FUNCTIONS.checkRevokedAreExcluded, BLOCK_TEST_DATA.REVOKED_NOT_IN_EXCLUDED, 'A revoked member must be excluded'));
  it('Block cannot contain 2 certifications from same issuer',                                      test(LOCAL_RULES_FUNCTIONS.checkCertificationOneByIssuer, BLOCK_TEST_DATA.MULTIPLE_CERTIFICATIONS_FROM_SAME_ISSUER, 'Block cannot contain two certifications from same issuer'));
  it('Block cannot contain identical certifications',                                               test(LOCAL_RULES_FUNCTIONS.checkCertificationUnicity, BLOCK_TEST_DATA.IDENTICAL_CERTIFICATIONS, 'Block cannot contain identical certifications (A -> B)'));
  it('Block cannot contain certifications concerning a leaver',                                     test(LOCAL_RULES_FUNCTIONS.checkCertificationIsntForLeaverOrExcluded, BLOCK_TEST_DATA.LEAVER_WITH_CERTIFICATIONS, 'Block cannot contain certifications concerning leavers or excluded members'));
  it('Block cannot contain certifications concerning an excluded member',                           test(LOCAL_RULES_FUNCTIONS.checkCertificationIsntForLeaverOrExcluded, BLOCK_TEST_DATA.EXCLUDED_WITH_CERTIFICATIONS, 'Block cannot contain certifications concerning leavers or excluded members'));
  it('Block cannot contain transactions without issuers (1)',                                       test(LOCAL_RULES_FUNCTIONS.checkTxIssuers, BLOCK_TEST_DATA.TRANSACTION_WITHOUT_ISSUERS, 'A transaction must have at least 1 issuer'));
  it('Block cannot contain transactions without issuers (2)',                                       test(LOCAL_RULES_FUNCTIONS.checkTxSources, BLOCK_TEST_DATA.TRANSACTION_WITHOUT_SOURCES, 'A transaction must have at least 1 source'));
  it('Block cannot contain transactions without issuers (3)',                                       test(LOCAL_RULES_FUNCTIONS.checkTxRecipients, BLOCK_TEST_DATA.TRANSACTION_WITHOUT_RECIPIENT, 'A transaction must have at least 1 recipient'));
  it('Block cannot contain transactions with identical sources in one transaction',                 test(LOCAL_RULES_FUNCTIONS.checkTxSources, BLOCK_TEST_DATA.TRANSACTION_WITH_DUPLICATED_SOURCE_SINGLE_TX, 'It cannot exist 2 identical sources for transactions inside a given block'));
  it('Block cannot contain transactions with identical sources in a pack of transactions',          test(LOCAL_RULES_FUNCTIONS.checkTxSources, BLOCK_TEST_DATA.TRANSACTION_WITH_DUPLICATED_SOURCE_MULTIPLE_TX, 'It cannot exist 2 identical sources for transactions inside a given block'));
  it('Block cannot contain transactions with empty output conditions',                              test(LOCAL_RULES_FUNCTIONS.checkTxRecipients, BLOCK_TEST_DATA.TRANSACTION_WITH_EMPTY_TX_CONDITIONS, 'Empty conditions are forbidden'));
  it('Block cannot contain transactions with wrong total',                                          test(LOCAL_RULES_FUNCTIONS.checkTxAmounts, BLOCK_TEST_DATA.TRANSACTION_WRONG_TOTAL, 'Transaction inputs sum must equal outputs sum'));
  it('Block cannot contain transactions with wrong base transformation',                            test(LOCAL_RULES_FUNCTIONS.checkTxAmounts, BLOCK_TEST_DATA.TRANSACTION_WRONG_TRANSFORM, 'Transaction output base amount does not equal previous base deltas'));
  it('Block cannot contain transactions with unexisting lower base in sources',                     test(LOCAL_RULES_FUNCTIONS.checkTxAmounts, BLOCK_TEST_DATA.TRANSACTION_WRONG_TRANSFORM_LOW_BASE, 'Transaction output base amount does not equal previous base deltas'));
  it('Block cannot contain transactions with more than 100 lines',                                  test(LOCAL_RULES_FUNCTIONS.checkTxLen, BLOCK_TEST_DATA.TRANSACTION_TOO_LONG, 'A transaction has a maximum size of 100 lines'));
  it('Block cannot contain transactions with a too large output',                                   test(LOCAL_RULES_FUNCTIONS.checkTxLen, BLOCK_TEST_DATA.OUTPUT_TOO_LONG, 'A transaction output has a maximum size of 2000 characters'));
  it('Block cannot contain transactions with a too large unlock',                                   test(LOCAL_RULES_FUNCTIONS.checkTxLen, BLOCK_TEST_DATA.UNLOCK_TOO_LONG, 'A transaction unlock has a maximum size of 2000 characters'));
  it('Block cannot be refused with a good V3 transaction',                                          test(LOCAL_RULES_FUNCTIONS.checkTxAmounts, BLOCK_TEST_DATA.TRANSACTION_V3_GOOD_AMOUNTS));
  it('Block cannot contain transactions with wrong signatures',                                     test(LOCAL_RULES_FUNCTIONS.checkTxSignature, BLOCK_TEST_DATA.TRANSACTION_WITH_WRONG_SIGNATURES, 'Signature from a transaction must match'));
  });
  
});


function test (rule:any, raw:string, expectedMessage?:string) {
  return async () => {
    try {
      let obj = parsers.parseBlock.syncWrite(raw);
      let block = BlockDTO.fromJSONObject(obj);
      let index = Indexer.localIndex(block, conf as any)
      await rule(block, conf, index); // conf parameter is not always used
      if (expectedMessage) {
        throw 'Test should have thrown an error';
      }
    } catch (e) {
      if (!expectedMessage) {
        console.error(e.stack || e);
      }
      if (e.uerr) {
        // This is a controlled error
        e.uerr.message.should.equal(expectedMessage);
      } else if (e) {
        // This is a controlled error
        e.message.should.equal(expectedMessage);
      } else {
        // throw Error(e)
        // Display non wrapped errors (wrapped error is an error in constants.js)
        // console.error(e.stack || e);
      }
    }
  }
}
