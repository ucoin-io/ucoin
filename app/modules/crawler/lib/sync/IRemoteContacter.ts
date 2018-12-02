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

import {JSONDBPeer} from "../../../../lib/db/DBPeer";
import {BlockDTO} from "../../../../lib/dto/BlockDTO";
import {HttpRequirements} from "../../../bma/lib/dtos";

export interface IRemoteContacter {

  getName(): string

  getPeers(): Promise<(JSONDBPeer|null)[]>

  getCurrent(): Promise<BlockDTO|null>

  getBlock(number: number): Promise<BlockDTO|null>

  getBlocks(count: number, from: number): Promise<BlockDTO[]>

  getRequirementsPending(number: number): Promise<HttpRequirements>

  hostName: string
}