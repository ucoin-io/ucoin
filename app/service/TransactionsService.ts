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

import { ConfDTO } from "../lib/dto/ConfDTO";
import { FileDAL } from "../lib/dal/fileDAL";
import { TransactionDTO } from "../lib/dto/TransactionDTO";
import { LOCAL_RULES_HELPERS } from "../lib/rules/local_rules";
import { GLOBAL_RULES_HELPERS } from "../lib/rules/global_rules";
import { FIFOService } from "./FIFOService";
import { GlobalFifoPromise } from "./GlobalFifoPromise";
import { DataErrors } from "../lib/common-libs/errors";
import { DBTx } from "../lib/db/DBTx";

const constants = require("../lib/constants");

export class TransactionService extends FIFOService {
  constructor(fifoPromiseHandler: GlobalFifoPromise) {
    super(fifoPromiseHandler);
  }

  conf: ConfDTO;
  dal: FileDAL;
  logger: any;

  setConfDAL(newConf: ConfDTO, newDAL: FileDAL) {
    this.dal = newDAL;
    this.conf = newConf;
    this.logger = require("../lib/logger").NewLogger(this.dal.profile);
  }

  // Called only when receiving a doc tx via BMA or WS2P
  processVerifiedTx(tx: TransactionDTO) {
    const hash = tx.getHash();
    return this.pushFIFO<TransactionDTO>(hash, async () => {
      try {
        this.logger.info(
          "⬇ TX %s:%s from %s",
          tx.output_amount,
          tx.output_base,
          tx.issuers
        );
        const existing = await this.dal.getTxByHash(tx.hash);
        const current = await this.dal.getCurrentBlockOrNull();
        if (!current) {
          throw Error(
            DataErrors[DataErrors.NO_TRANSACTION_POSSIBLE_IF_NOT_CURRENT_BLOCK]
          );
        }
        if (existing) {
          throw constants.ERRORS.TX_ALREADY_PROCESSED;
        }
        // Start checks...
        const fakeTimeVariation = current.medianTime + 1;
        const dto = TransactionDTO.fromJSONObject(tx);
        await GLOBAL_RULES_HELPERS.checkTxBlockStamp(tx, this.dal);
        await GLOBAL_RULES_HELPERS.checkSingleTransaction(
          dto,
          current.version,
          fakeTimeVariation,
          this.conf,
          this.dal,
          await this.dal.getTxByHash.bind(this.dal)
        );
        const server_pubkey = this.conf.pair && this.conf.pair.pub;
        if (!(await this.dal.rustServer.acceptNewTx(tx, server_pubkey))) {
          throw constants.ERRORS.SANDBOX_FOR_TRANSACTION_IS_FULL;
        }
        await this.dal.saveTransaction(tx);
        this.logger.info(
          "✔ TX %s:%s from %s",
          tx.output_amount,
          tx.output_base,
          tx.issuers
        );
        return tx;
      } catch (e) {
        this.logger.info(
          "✘ TX %s:%s from %s",
          tx.output_amount,
          tx.output_base,
          tx.issuers
        );
        throw e;
      }
    });
  }
}
