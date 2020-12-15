//  Copyright (C) 2020 Éloïs SANCHEZ.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as
// published by the Free Software Foundation, either version 3 of the
// License, or (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

use crate::*;
use duniter_dbs::{databases::gva_v1::BalancesEvent, WalletHashWithBnV1Db};

pub(crate) type ScriptsHash = HashMap<WalletScriptV10, Hash>;

fn get_script_hash(script: &WalletScriptV10, scripts_hash: &mut ScriptsHash) -> Hash {
    if let Some(script_hash) = scripts_hash.get(script) {
        *script_hash
    } else {
        let script_hash = Hash::compute(script.to_string().as_bytes());
        scripts_hash.insert(script.clone(), script_hash);
        script_hash
    }
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn apply_tx<B: Backend>(
    current_blockstamp: Blockstamp,
    current_time: i64,
    gva_db: &GvaV1Db<B>,
    scripts_hash: &mut ScriptsHash,
    tx_hash: Hash,
    tx: &TransactionDocumentV10,
    txs_by_issuer_mem: &mut HashMap<WalletHashWithBnV1Db, BTreeSet<Hash>>,
    txs_by_recipient_mem: &mut HashMap<WalletHashWithBnV1Db, BTreeSet<Hash>>,
) -> KvResult<()> {
    (
        gva_db.scripts_by_pubkey_write(),
        gva_db.txs_write(),
        gva_db.gva_utxos_write(),
        gva_db.balances_write(),
    )
        .write(
            |(mut scripts_by_pubkey, mut txs, mut gva_utxos, mut balances)| {
                let mut issuers_scripts_hashs = BTreeSet::new();
                for input in tx.get_inputs() {
                    let (account_script_hash, account_script) = match input.id {
                        SourceIdV10::Utxo(utxo_id) => {
                            // Get issuer script & written block
                            let db_tx_origin = gva_db
                                .txs()
                                .get(&HashKeyV2::from_ref(&utxo_id.tx_hash))?
                                .ok_or_else(|| {
                                    KvError::DbCorrupted(format!(
                                        "Not found origin tx of uxto {}",
                                        utxo_id
                                    ))
                                })?;
                            let utxo_script = db_tx_origin.tx.get_outputs()[utxo_id.output_index]
                                .conditions
                                .script
                                .clone();
                            let utxo_script_hash = get_script_hash(&utxo_script, scripts_hash);

                            // Remove consumed UTXOs
                            super::utxos::remove_utxo_v10::<B>(
                                &mut scripts_by_pubkey,
                                &mut gva_utxos,
                                utxo_id,
                                &utxo_script,
                                utxo_script_hash,
                                db_tx_origin.written_block.number.0,
                            )?;

                            // Return utxo_script with hash
                            (utxo_script_hash, utxo_script)
                        }
                        SourceIdV10::Ud(UdSourceIdV10 { issuer, .. }) => {
                            let script = WalletScriptV10::single_sig(issuer);
                            (Hash::compute(script.to_string().as_bytes()), script)
                        }
                    };
                    issuers_scripts_hashs.insert(account_script_hash);
                    // Insert on col `txs_by_issuer`
                    txs_by_issuer_mem
                        .entry(WalletHashWithBnV1Db::new(
                            account_script_hash,
                            current_blockstamp.number,
                        ))
                        .or_default()
                        .insert(tx_hash);
                    // Decrease account balance
                    decrease_account_balance::<B>(account_script, &mut balances, input.amount)?;
                }

                for (output_index, output) in tx.get_outputs().iter().enumerate() {
                    let utxo_script_hash = get_script_hash(&output.conditions.script, scripts_hash);
                    // Insert created UTXOs
                    super::utxos::write_utxo_v10::<B>(
                        &mut scripts_by_pubkey,
                        &mut gva_utxos,
                        UtxoV10 {
                            id: UtxoIdV10 {
                                tx_hash,
                                output_index,
                            },
                            amount: output.amount,
                            script: &output.conditions.script,
                            written_block: current_blockstamp.number,
                        },
                        utxo_script_hash,
                    )?;

                    // Insert on col `txs_by_recipient`
                    if !issuers_scripts_hashs.contains(&utxo_script_hash) {
                        txs_by_recipient_mem
                            .entry(WalletHashWithBnV1Db::new(
                                utxo_script_hash,
                                current_blockstamp.number,
                            ))
                            .or_default()
                            .insert(tx_hash);
                    }

                    // Increase account balance
                    let balance = balances
                        .get(WalletConditionsV2::from_ref(&output.conditions.script))?
                        .unwrap_or_default();
                    balances.upsert(
                        WalletConditionsV2(output.conditions.script.clone()),
                        SourceAmountValV2(balance.0 + output.amount),
                    );
                }

                // Insert tx itself
                txs.upsert(
                    HashKeyV2(tx_hash),
                    TxDbV2 {
                        tx: tx.clone(),
                        written_block: current_blockstamp,
                        written_time: current_time,
                    },
                );

                Ok(())
            },
        )?;

    Ok(())
}

pub(crate) fn revert_tx<B: Backend>(
    block_number: BlockNumber,
    gva_db: &GvaV1Db<B>,
    scripts_hash: &mut ScriptsHash,
    tx_hash: &Hash,
) -> KvResult<Option<TransactionDocumentV10>> {
    if let Some(tx_db) = gva_db.txs().get(&HashKeyV2::from_ref(tx_hash))? {
        (
            gva_db.scripts_by_pubkey_write(),
            gva_db.txs_by_issuer_write(),
            gva_db.txs_by_recipient_write(),
            gva_db.txs_write(),
            gva_db.gva_utxos_write(),
            gva_db.balances_write(),
        )
            .write(
                |(
                    mut scripts_by_pubkey,
                    mut txs_by_issuer,
                    mut txs_by_recipient,
                    mut txs,
                    mut gva_utxos,
                    mut balances,
                )| {
                    use dubp::documents::transaction::TransactionDocumentTrait as _;
                    for (output_index, output) in tx_db.tx.get_outputs().iter().enumerate() {
                        let script = &output.conditions.script;
                        let utxo_script_hash = get_script_hash(&script, scripts_hash);

                        // Remove UTXOs created by this tx
                        super::utxos::remove_utxo_v10::<B>(
                            &mut scripts_by_pubkey,
                            &mut gva_utxos,
                            UtxoIdV10 {
                                tx_hash: *tx_hash,
                                output_index,
                            },
                            script,
                            utxo_script_hash,
                            block_number.0,
                        )?;

                        // Remove on col `txs_by_recipient`
                        txs_by_recipient
                            .remove(WalletHashWithBnV1Db::new(utxo_script_hash, block_number));

                        // Decrease account balance
                        decrease_account_balance::<B>(
                            script.clone(),
                            &mut balances,
                            output.amount,
                        )?;
                    }
                    // Recreate UTXOs consumed by this tx (and update balance)
                    for input in tx_db.tx.get_inputs() {
                        let (account_script_hash, account_script) = match input.id {
                            SourceIdV10::Utxo(utxo_id) => {
                                let db_tx_origin = gva_db
                                    .txs()
                                    .get(&HashKeyV2::from_ref(&utxo_id.tx_hash))?
                                    .ok_or_else(|| {
                                        KvError::DbCorrupted(format!(
                                            "Not found origin tx of uxto {}",
                                            utxo_id
                                        ))
                                    })?;
                                let utxo_script = db_tx_origin.tx.get_outputs()
                                    [utxo_id.output_index]
                                    .conditions
                                    .script
                                    .clone();
                                let utxo_script_hash = get_script_hash(&utxo_script, scripts_hash);
                                super::utxos::write_utxo_v10::<B>(
                                    &mut scripts_by_pubkey,
                                    &mut gva_utxos,
                                    UtxoV10 {
                                        id: utxo_id,
                                        amount: input.amount,
                                        script: &utxo_script,
                                        written_block: db_tx_origin.written_block.number,
                                    },
                                    utxo_script_hash,
                                )?;

                                // Return utxo_script
                                (utxo_script_hash, utxo_script)
                            }
                            SourceIdV10::Ud(UdSourceIdV10 { issuer, .. }) => {
                                let script = WalletScriptV10::single_sig(issuer);
                                (Hash::compute(script.to_string().as_bytes()), script)
                            }
                        };
                        // Remove on col `txs_by_issuer`
                        txs_by_issuer
                            .remove(WalletHashWithBnV1Db::new(account_script_hash, block_number));
                        // Increase account balance
                        let balance = balances
                            .get(WalletConditionsV2::from_ref(&account_script))?
                            .unwrap_or_default();

                        balances.upsert(
                            WalletConditionsV2(account_script),
                            SourceAmountValV2(balance.0 + input.amount),
                        );
                    }

                    // Remove tx itself
                    txs.remove(HashKeyV2(*tx_hash));

                    Ok(())
                },
            )?;

        Ok(Some(tx_db.tx))
    } else {
        Ok(None)
    }
}

fn decrease_account_balance<B: Backend>(
    account_script: WalletScriptV10,
    balances: &mut TxColRw<B::Col, BalancesEvent>,
    decrease_amount: SourceAmount,
) -> KvResult<()> {
    if let Some(SourceAmountValV2(balance)) =
        balances.get(WalletConditionsV2::from_ref(&account_script))?
    {
        let new_balance = balance - decrease_amount;
        if new_balance > SourceAmount::ZERO {
            balances.upsert(
                WalletConditionsV2(account_script),
                SourceAmountValV2(new_balance),
            );
        } else {
            balances.remove(WalletConditionsV2(account_script));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {

    use super::*;
    use dubp::{
        crypto::keys::ed25519::Ed25519KeyPair, crypto::keys::KeyPair as _,
        documents::smallvec::smallvec as svec, documents::transaction::v10::*,
        documents::transaction::UTXOConditions,
    };
    use duniter_dbs::BlockMetaV2;
    use maplit::btreeset;

    #[test]
    fn test_apply_tx() -> KvResult<()> {
        let kp = Ed25519KeyPair::generate_random().expect("gen rand kp");
        let kp2 = Ed25519KeyPair::generate_random().expect("gen rand kp");

        let ud0_amount = SourceAmount::with_base0(1000);
        let o1_amount = ud0_amount - SourceAmount::with_base0(600);
        let o2_amount = ud0_amount - SourceAmount::with_base0(400);

        let gva_db = duniter_dbs::databases::gva_v1::GvaV1Db::<Mem>::open(MemConf::default())?;

        let b0 = BlockMetaV2 {
            dividend: Some(ud0_amount),
            ..Default::default()
        };
        let current_blockstamp = b0.blockstamp();
        let pk = kp.public_key();
        //println!("TMP pk1={}", pk);
        let pk2 = kp2.public_key();
        //println!("TMP pk2={}", pk2);
        let script = WalletScriptV10::single_sig(pk);
        let script2 = WalletScriptV10::single_sig(pk2);
        let script_hash = Hash::compute(script.to_string().as_bytes());
        let script2_hash = Hash::compute(script2.to_string().as_bytes());

        gva_db.balances_write().upsert(
            WalletConditionsV2(script.clone()),
            SourceAmountValV2(ud0_amount),
        )?;

        let tx1 = TransactionDocumentV10Builder {
            currency: "test",
            blockstamp: current_blockstamp,
            locktime: 0,
            issuers: svec![pk],
            inputs: &[TransactionInputV10 {
                amount: ud0_amount,
                id: SourceIdV10::Ud(UdSourceIdV10 {
                    issuer: pk,
                    block_number: BlockNumber(0),
                }),
            }],
            unlocks: &[TransactionInputUnlocksV10::default()],
            outputs: svec![
                TransactionOutputV10 {
                    amount: o1_amount,
                    conditions: UTXOConditions::from(script2.clone()),
                },
                TransactionOutputV10 {
                    amount: o2_amount,
                    conditions: UTXOConditions::from(script.clone()),
                }
            ],
            comment: "",
            hash: None,
        }
        .build_and_sign(vec![kp.generate_signator()]);
        let tx1_hash = tx1.get_hash();

        let mut scripts_hash = HashMap::new();

        let mut txs_by_issuer_mem = HashMap::new();
        let mut txs_by_recipient_mem = HashMap::new();
        apply_tx(
            current_blockstamp,
            b0.median_time as i64,
            &gva_db,
            &mut scripts_hash,
            tx1_hash,
            &tx1,
            &mut txs_by_issuer_mem,
            &mut txs_by_recipient_mem,
        )?;

        assert_eq!(txs_by_issuer_mem.len(), 1);
        assert_eq!(
            txs_by_issuer_mem.get(&WalletHashWithBnV1Db::new(script_hash, BlockNumber(0))),
            Some(&btreeset![tx1_hash])
        );
        assert_eq!(txs_by_recipient_mem.len(), 1);
        assert_eq!(
            txs_by_recipient_mem.get(&WalletHashWithBnV1Db::new(script2_hash, BlockNumber(0))),
            Some(&btreeset![tx1_hash])
        );

        assert_eq!(
            gva_db
                .balances()
                .get(WalletConditionsV2::from_ref(&script2))?,
            Some(SourceAmountValV2(o1_amount))
        );
        assert_eq!(
            gva_db
                .balances()
                .get(WalletConditionsV2::from_ref(&script))?,
            Some(SourceAmountValV2(o2_amount))
        );

        let tx2 = TransactionDocumentV10Builder {
            currency: "test",
            blockstamp: current_blockstamp,
            locktime: 0,
            issuers: svec![pk2],
            inputs: &[TransactionInputV10 {
                amount: o1_amount,
                id: SourceIdV10::Utxo(UtxoIdV10 {
                    tx_hash: tx1_hash,
                    output_index: 0,
                }),
            }],
            unlocks: &[TransactionInputUnlocksV10::default()],
            outputs: svec![TransactionOutputV10 {
                amount: o1_amount,
                conditions: UTXOConditions::from(script.clone()),
            },],
            comment: "",
            hash: None,
        }
        .build_and_sign(vec![kp.generate_signator()]);
        let tx2_hash = tx2.get_hash();

        let mut txs_by_issuer_mem = HashMap::new();
        let mut txs_by_recipient_mem = HashMap::new();
        apply_tx(
            current_blockstamp,
            b0.median_time as i64,
            &gva_db,
            &mut scripts_hash,
            tx2_hash,
            &tx2,
            &mut txs_by_issuer_mem,
            &mut txs_by_recipient_mem,
        )?;

        assert_eq!(txs_by_issuer_mem.len(), 1);
        assert_eq!(
            txs_by_issuer_mem.get(&WalletHashWithBnV1Db::new(script2_hash, BlockNumber(0))),
            Some(&btreeset![tx2_hash])
        );
        assert_eq!(txs_by_recipient_mem.len(), 1);
        assert_eq!(
            txs_by_recipient_mem.get(&WalletHashWithBnV1Db::new(script_hash, BlockNumber(0))),
            Some(&btreeset![tx2_hash])
        );

        assert_eq!(
            gva_db
                .balances()
                .get(WalletConditionsV2::from_ref(&script2))?,
            None
        );
        assert_eq!(
            gva_db
                .balances()
                .get(WalletConditionsV2::from_ref(&script))?,
            Some(SourceAmountValV2(ud0_amount))
        );

        revert_tx(
            current_blockstamp.number,
            &gva_db,
            &mut scripts_hash,
            &tx2_hash,
        )?;

        assert_eq!(
            gva_db
                .balances()
                .get(WalletConditionsV2::from_ref(&script2))?,
            Some(SourceAmountValV2(o1_amount))
        );
        assert_eq!(
            gva_db
                .balances()
                .get(WalletConditionsV2::from_ref(&script))?,
            Some(SourceAmountValV2(o2_amount))
        );

        revert_tx(
            current_blockstamp.number,
            &gva_db,
            &mut scripts_hash,
            &tx1_hash,
        )?;

        assert_eq!(
            gva_db
                .balances()
                .get(WalletConditionsV2::from_ref(&script2))?,
            None
        );
        assert_eq!(
            gva_db
                .balances()
                .get(WalletConditionsV2::from_ref(&script))?,
            Some(SourceAmountValV2(ud0_amount))
        );

        Ok(())
    }
}