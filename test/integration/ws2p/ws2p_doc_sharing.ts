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

import {TestUser} from '../tools/TestUser';
import {simpleTestingConf, simpleTestingConfWithGva, simpleTestingServer, simpleUser, simpleWS2PNetwork, TestingServer} from "../tools/toolbox"
import {WS2PConstants} from "../../../app/modules/ws2p/lib/constants"

const assert = require('assert')

describe("WS2P doc sharing", function() {

  WS2PConstants.CONNEXION_TIMEOUT = 100
  WS2PConstants.REQUEST_TIMEOUT= 100

  const now = 1500000000
  let s1:TestingServer, s2:TestingServer, wss:any
  let cat:TestUser, tac:TestUser, toc:TestUser
  const catKeyring = { pub: 'HgTTJLAQ5sqfknMq7yLPZbehtuLSsKj9CxWN7k8QvYJd', sec: '51w4fEShBk1jCMauWu4mLpmDVfHksKmWcygpxriqCEZizbtERA6de4STKRkQBpxmMUwsKXRjSzuQ8ECwmqN1u2DP'}
  const tacKeyring = { pub: '2LvDg21dVXvetTD9GdkPLURavLYEqP3whauvPWX4c2qc', sec: '2HuRLWgKgED1bVio1tdpeXrf7zuUszv1yPHDsDj7kcMC4rVSN9RC58ogjtKNfTbH1eFz7rn38U1PywNs3m6Q7UxE'}
  const tocKeyring = { pub: 'DKpQPUL4ckzXYdnDRvCRKAm1gNvSdmAXnTrJZ7LvM5Qo', sec: '64EYRvdPpTfLGGmaX5nijLXRqWXaVz8r1Z1GtaahXwVSJGQRn7tqkxLb288zwSYzELMEG5ZhXSBYSxsTsz1m9y8F'}

  before(async () => {
    const conf1 = simpleTestingConf(now, catKeyring)
    const conf2 = simpleTestingConfWithGva(now, tacKeyring)
    s1 = simpleTestingServer(conf1)
    s2 = simpleTestingServer(conf2)
    cat = simpleUser('cat', catKeyring, s1)
    tac = simpleUser('tac', tacKeyring, s1)
    toc = simpleUser('toc', tocKeyring, s1)
    await s1.initDalBmaConnections()
    await s2.initDalBmaConnections()

    const network = await simpleWS2PNetwork(s1, s2)

    await cat.createIdentity();
    await tac.createIdentity();
    await cat.cert(tac);
    await tac.cert(cat);
    await cat.join();
    await tac.join();

    wss = network.wss
  })

  after(() => wss.close())

  it('should see the identity and certs of initial members in the docpool', async () => {
    await s2.expect('/wot/lookup/cat', (res:any) => {
      assert.equal(res.results.length, 1)
      assert.equal(res.results[0].uids[0].others.length, 1)
    })
    await s2.expect('/wot/lookup/tac', (res:any) => {
      assert.equal(res.results.length, 1)
      assert.equal(res.results[0].uids[0].others.length, 1)
    })
  })

  it('should have the same block#0 if we commit', async () => {
    await s1.commit({ time: now })
    await s1.commit({ time: now })
    await s1.waitToHaveBlock(1)
    await s2.waitToHaveBlock(1)
    const b1s1 = await s1.BlockchainService.current()
    const b1s2 = await s2.BlockchainService.current()
    assert.equal(b1s1 && b1s1.number, 1)
    assert.equal(b1s2 && b1s2.number, 1)
    assert.equal(b1s1 && b1s1.hash, b1s2 && b1s2.hash)
  })

  it('should see the identity, certs and memberships in the docpool', async () => {
    await toc.createIdentity();
    await cat.cert(toc);
    await toc.join();
    await s2.expect('/wot/lookup/toc', (res:any) => {
      assert.equal(res.results.length, 1)
      assert.equal(res.results[0].uids[0].others.length, 1)
    })
    await s2.commit({ time: now })
    await s1.waitToHaveBlock(2)
    await s2.waitToHaveBlock(2)
    const b2s1 = await s1.BlockchainService.current()
    const b2s2 = await s2.BlockchainService.current()
    assert.equal(b2s1 && b2s1.number, 2)
    assert.equal(b2s2 && b2s2.number, 2)
    assert.equal(b2s1 && b2s1.hash, b2s2 && b2s2.hash)
    assert.equal(b2s2 && b2s2.joiners.length, 1)
  })

  it('should see the transactions pending', async () => {
    await cat.sendMoney(54, toc)
    await s2.until('transaction', 1)
    await s2.expect('/tx/history/' + catKeyring.pub, (res:any) => {
      assert.equal(res.history.sending.length, 1)
    })
    await s2.expect('/tx/history/' + tocKeyring.pub, (res:any) => {
      assert.equal(res.history.pending.length, 1)
    })
    await s2.commit({ time: now })
    await s1.waitToHaveBlock(3)
    await s2.waitToHaveBlock(3)
    const b3s1 = await s1.BlockchainService.current()
    const b3s2 = await s2.BlockchainService.current()
    assert.equal(b3s1 && b3s1.number, 3)
    assert.equal(b3s2 && b3s2.number, 3)
    assert.equal(b3s1 && b3s1.hash, b3s2 && b3s2.hash)
    assert.equal(b3s2 && b3s2.transactions.length, 1)
  })

  it('should see the peer documents', async () => {
    await s1.getPeer()
    await s2.until('peer', 1)
    await s2.expect('/network/peers', (res:any) => {
      assert.equal(res.peers.length, 1)
    })
  })
})
