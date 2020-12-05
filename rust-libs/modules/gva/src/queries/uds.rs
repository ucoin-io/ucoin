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
use async_graphql::connection::*;
use duniter_dbs::bc_v2::BcV2DbReadable;
use duniter_gva_dbs_reader::{uds_of_pubkey::UdsWithSum, PagedData};

#[derive(Default)]
pub(crate) struct UdsQuery;
#[async_graphql::Object]
impl UdsQuery {
    /// Current universal dividends amount
    async fn current_ud(
        &self,
        ctx: &async_graphql::Context<'_>,
    ) -> async_graphql::Result<Option<CurrentUdGva>> {
        let data = ctx.data::<SchemaData>()?;
        let dbs_reader = data.dbs_reader();

        Ok(data
            .dbs_pool
            .execute(move |dbs| dbs_reader.get_current_ud(&dbs.bc_db))
            .await??
            .map(|sa| CurrentUdGva {
                amount: sa.amount(),
                base: sa.base(),
            }))
    }
    /// Universal dividends issued by a public key
    #[allow(clippy::clippy::too_many_arguments)]
    async fn uds_of_pubkey(
        &self,
        ctx: &async_graphql::Context<'_>,
        #[graphql(desc = "Ed25519 public key on base 58 representation")] pubkey: String,
        #[graphql(default)] filter: UdsFilter,
        #[graphql(desc = "pagination", default)] pagination: Pagination,
        #[graphql(desc = "Amount needed")] amount: Option<i64>,
    ) -> async_graphql::Result<Connection<String, UdGva, AggregateSum, EmptyFields>> {
        let pagination = Pagination::convert_to_page_info(pagination)?;

        let pubkey = PublicKey::from_base58(&pubkey)?;

        let data = ctx.data::<SchemaData>()?;
        let dbs_reader = data.dbs_reader();

        let (
            PagedData {
                data: UdsWithSum { uds, sum },
                has_previous_page,
                has_next_page,
            },
            times,
        ) = data
            .dbs_pool
            .execute(move |dbs| {
                if let Some(current_block) =
                    duniter_dbs_read_ops::get_current_block_meta(&dbs.bc_db)?
                {
                    let paged_data = match filter {
                        UdsFilter::All => duniter_gva_dbs_reader::uds_of_pubkey::all_uds_of_pubkey(
                            &dbs.bc_db,
                            &dbs.gva_db,
                            pubkey,
                            pagination,
                        ),
                        UdsFilter::Unspent => {
                            duniter_gva_dbs_reader::uds_of_pubkey::unspent_uds_of_pubkey(
                                &dbs.bc_db,
                                pubkey,
                                pagination,
                                None,
                                amount.map(|amount| {
                                    SourceAmount::new(amount, current_block.unit_base as i64)
                                }),
                            )
                        }
                    }?;

                    let mut times = Vec::with_capacity(paged_data.data.uds.len());
                    for (bn, _sa) in &paged_data.data.uds {
                        times.push(dbs_reader.get_blockchain_time(&dbs.gva_db, *bn)?);
                    }
                    Ok::<_, anyhow::Error>((paged_data, times))
                } else {
                    Err(anyhow::Error::msg("no blockchain"))
                }
            })
            .await??;

        let mut conn = Connection::with_additional_fields(
            has_previous_page,
            has_next_page,
            AggregateSum {
                aggregate: Sum {
                    sum: AmountWithBase {
                        amount: sum.amount() as i32,
                        base: sum.base() as i32,
                    },
                },
            },
        );
        let uds_timed =
            uds.into_iter()
                .zip(times.into_iter())
                .map(|((bn, sa), blockchain_time)| {
                    Edge::new(
                        bn.0.to_string(),
                        UdGva {
                            amount: sa.amount(),
                            base: sa.base(),
                            issuer: pubkey.to_string(),
                            block_number: bn.0,
                            blockchain_time,
                        },
                    )
                });
        if pagination.order() {
            conn.append(uds_timed);
        } else {
            conn.append(uds_timed.rev());
        }
        Ok(conn)
    }
    /// Universal dividends revaluations
    async fn uds_reval(
        &self,
        ctx: &async_graphql::Context<'_>,
    ) -> async_graphql::Result<Vec<RevalUdGva>> {
        let data = ctx.data::<SchemaData>()?;

        Ok(data
            .dbs_pool
            .execute(move |dbs| {
                dbs.bc_db.uds_reval().iter(.., |it| {
                    it.map_ok(|(block_number, sa)| RevalUdGva {
                        amount: sa.0.amount(),
                        base: sa.0.base(),
                        block_number: block_number.0,
                    })
                    .collect::<KvResult<Vec<_>>>()
                })
            })
            .await??)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tests::*;

    #[tokio::test]
    async fn query_current_ud() -> anyhow::Result<()> {
        let mut dbs_reader = MockDbsReader::new();
        use duniter_dbs::bc_v2::BcV2Db;
        dbs_reader
            .expect_get_current_ud::<BcV2Db<FileBackend>>()
            .times(1)
            .returning(|_| Ok(Some(SourceAmount::with_base0(100))));
        let schema = create_schema(dbs_reader)?;
        assert_eq!(
            exec_graphql_request(&schema, r#"{ currentUd {amount} }"#).await?,
            serde_json::json!({
                "data": {
                    "currentUd": {
                      "amount": 100
                    }
                }
            })
        );
        Ok(())
    }
}
