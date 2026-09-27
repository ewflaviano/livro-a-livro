use crate::{
    config::{ABSOLUTE_TTL, LEASE_TTL, SESSION_TTL},
    ports::*,
    service::random,
};
use async_trait::async_trait;
use aws_sdk_dynamodb::{
    Client,
    primitives::Blob,
    types::{
        AttributeValue as A, ConditionCheck, Delete, Get, Put, TransactGetItem, TransactWriteItem,
        Update,
    },
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
type Item = HashMap<String, A>;
const DAY: u64 = 86400;
const CONTROL: &str = "CONTROL#grants";
fn n(value: u64) -> A {
    A::N(value.to_string())
}
fn s(value: impl Into<String>) -> A {
    A::S(value.into())
}
fn number(item: &Item, name: &str) -> Result<u64, Error> {
    item.get(name)
        .and_then(|a| a.as_n().ok())
        .and_then(|v| v.parse().ok())
        .ok_or(Error::Unavailable)
}
fn string(item: &Item, name: &str) -> Result<String, Error> {
    item.get(name)
        .and_then(|a| a.as_s().ok())
        .cloned()
        .ok_or(Error::Unavailable)
}
fn add(a: u64, b: u64) -> Result<u64, Error> {
    a.checked_add(b)
        .filter(|v| *v <= i64::MAX as u64)
        .ok_or(Error::Unavailable)
}
fn decode<T: serde::de::DeserializeOwned>(item: &Item) -> Result<T, Error> {
    serde_json::from_str(&string(item, "data")?).map_err(|_| Error::Unavailable)
}
fn data<T: Serialize>(pk: String, value: &T) -> Result<Item, Error> {
    Ok([
        ("pk".into(), s(pk)),
        (
            "data".into(),
            s(serde_json::to_string(value).map_err(|_| Error::Unavailable)?),
        ),
    ]
    .into())
}
#[derive(Clone, Serialize, Deserialize, PartialEq)]
enum Status {
    Active,
    Pending,
    Uncertain,
    Revoked,
}
#[derive(Clone, Serialize, Deserialize, PartialEq)]
enum Phase {
    Queued,
    Dispatching,
    Uncertain,
}
#[derive(Clone, Serialize, Deserialize)]
struct Revocation {
    id: String,
    requested: u64,
    delete_at: u64,
    due: u64,
    attempts: u64,
    owner: Option<String>,
    lease_until: u64,
    phase: Phase,
}
#[derive(Clone, Serialize, Deserialize)]
struct Connection {
    generation: u64,
    version: u64,
    status: Status,
    activity: u64,
    owner: Option<String>,
    lease_until: u64,
    last_attempt: Option<u64>,
    revocation: Option<Revocation>,
    #[serde(skip)]
    encrypted: Vec<u8>,
}
impl Connection {
    fn active(&self, generation: u64, now: u64) -> Result<(), Error> {
        if self.status != Status::Active
            || self.generation != generation
            || add(self.activity, ABSOLUTE_TTL)? <= now
        {
            return Err(Error::Unauthorized);
        }
        Ok(())
    }
    fn key(&self, id: &str) -> Result<RevocationKey, Error> {
        Ok(RevocationKey {
            connection_id: id.into(),
            generation: self.generation,
            revocation_id: self
                .revocation
                .as_ref()
                .ok_or(Error::Unauthorized)?
                .id
                .clone(),
        })
    }
    fn revocation(&self, key: &RevocationKey) -> Result<&Revocation, Error> {
        let r = self.revocation.as_ref().ok_or(Error::Unauthorized)?;
        if self.generation != key.generation
            || r.id != key.revocation_id
            || !matches!(self.status, Status::Pending | Status::Uncertain)
        {
            return Err(Error::Unauthorized);
        }
        Ok(r)
    }
    fn claim(&self, claim: &RevocationClaim, now: u64) -> Result<&Revocation, Error> {
        let r = self.revocation(&claim.key)?;
        if r.owner.as_deref() != Some(&claim.owner) || r.lease_until <= now || r.delete_at <= now {
            return Err(Error::Unauthorized);
        }
        Ok(r)
    }
}
pub enum DueOutcome {
    Revocation(RevocationKey),
    Uncertain,
    Purged,
    NotDue,
}
#[derive(Clone)]
pub struct DynamoStore {
    client: Client,
    table: String,
}
impl DynamoStore {
    pub fn new(client: Client, table: String) -> Result<Self, Error> {
        if table.is_empty() {
            return Err(Error::Configuration);
        }
        Ok(Self { client, table })
    }
    async fn get(&self, pk: &str) -> Result<Option<Item>, Error> {
        self.client
            .get_item()
            .table_name(&self.table)
            .key("pk", s(pk))
            .consistent_read(true)
            .send()
            .await
            .map(|o| o.item)
            .map_err(|_| Error::Unavailable)
    }
    async fn connection(&self, id: &str) -> Result<Option<Connection>, Error> {
        self.get(&format!("CONNECTION#{id}"))
            .await?
            .map(|item| Self::decode_connection(&item))
            .transpose()
    }
    fn decode_connection(item: &Item) -> Result<Connection, Error> {
        let mut connection: Connection = decode(item)?;
        if number(item, "recordVersion")? != connection.version {
            return Err(Error::Unavailable);
        }
        connection.encrypted = item
            .get("encryptedRefresh")
            .and_then(|a| a.as_b().ok())
            .map(|b| b.as_ref().to_vec())
            .unwrap_or_default();
        Ok(connection)
    }
    fn connection_item(id: &str, connection: &Connection) -> Result<Item, Error> {
        let mut item = data(format!("CONNECTION#{id}"), connection)?;
        item.insert("recordVersion".into(), n(connection.version));
        if !connection.encrypted.is_empty() {
            item.insert(
                "encryptedRefresh".into(),
                A::B(Blob::new(connection.encrypted.clone())),
            );
        }
        if connection.status == Status::Active {
            item.insert("workType".into(), s("INACTIVITY"));
            item.insert("workAt".into(), n(add(connection.activity, ABSOLUTE_TTL)?));
        } else if let Some(r) = &connection.revocation
            && !connection.encrypted.is_empty()
        {
            item.insert("workType".into(), s("REVOCATION"));
            item.insert("workAt".into(), n(r.due.min(r.delete_at)));
        }
        Ok(item)
    }
    fn put_connection(
        &self,
        id: &str,
        value: &Connection,
        previous: Option<u64>,
    ) -> Result<TransactWriteItem, Error> {
        let mut put = Put::builder()
            .table_name(&self.table)
            .set_item(Some(Self::connection_item(id, value)?));
        put = match previous {
            Some(version) => put
                .condition_expression("recordVersion = :v")
                .expression_attribute_values(":v", n(version)),
            None => put.condition_expression("attribute_not_exists(pk)"),
        };
        Ok(TransactWriteItem::builder()
            .put(put.build().map_err(|_| Error::Unavailable)?)
            .build())
    }
    fn identity_check(
        &self,
        hash: &str,
        identity: &PendingIdentity,
        now: u64,
        consume: bool,
    ) -> Result<TransactWriteItem, Error> {
        if identity.expires_at <= now {
            return Err(Error::IdentityExpired);
        }
        let value = s(serde_json::to_string(identity).map_err(|_| Error::Unavailable)?);
        if consume {
            Ok(TransactWriteItem::builder()
                .delete(
                    Delete::builder()
                        .table_name(&self.table)
                        .key("pk", s(format!("IDENTITY#{hash}")))
                        .condition_expression("#d = :d AND deleteAfter > :now")
                        .expression_attribute_names("#d", "data")
                        .expression_attribute_values(":d", value)
                        .expression_attribute_values(":now", n(now))
                        .build()
                        .map_err(|_| Error::Unavailable)?,
                )
                .build())
        } else {
            Ok(TransactWriteItem::builder()
                .condition_check(
                    ConditionCheck::builder()
                        .table_name(&self.table)
                        .key("pk", s(format!("IDENTITY#{hash}")))
                        .condition_expression("#d = :d AND deleteAfter > :now")
                        .expression_attribute_names("#d", "data")
                        .expression_attribute_values(":d", value)
                        .expression_attribute_values(":now", n(now))
                        .build()
                        .map_err(|_| Error::Unavailable)?,
                )
                .build())
        }
    }
    fn oauth_put(&self, hash: &str, transaction: Transaction) -> Result<TransactWriteItem, Error> {
        let purpose =
            serde_json::to_string(&transaction.purpose).map_err(|_| Error::Unavailable)?;
        Ok(TransactWriteItem::builder()
            .put(
                Put::builder()
                    .table_name(&self.table)
                    .item("pk", s(format!("OAUTH#{hash}")))
                    .item("purpose", s(purpose))
                    .item("cookieHash", s(transaction.cookie_hash))
                    .item("nonce", s(transaction.nonce.0.clone()))
                    .item("verifier", s(transaction.verifier.0.clone()))
                    .item("expiresAt", n(transaction.expires_at))
                    .item("deleteAfter", n(transaction.expires_at))
                    .condition_expression("attribute_not_exists(pk)")
                    .build()
                    .map_err(|_| Error::Unavailable)?,
            )
            .build())
    }
    fn put_session(&self, hash: &str, session: &Session) -> Result<TransactWriteItem, Error> {
        let mut item = data(format!("SESSION#{hash}"), session)?;
        item.insert("deleteAfter".into(), n(session.expires_at));
        Ok(TransactWriteItem::builder()
            .put(
                Put::builder()
                    .table_name(&self.table)
                    .set_item(Some(item))
                    .condition_expression("attribute_not_exists(pk)")
                    .build()
                    .map_err(|_| Error::Unavailable)?,
            )
            .build())
    }
    fn session_check(
        &self,
        hash: &str,
        session: &Session,
        delete: bool,
    ) -> Result<TransactWriteItem, Error> {
        let value = s(serde_json::to_string(session).map_err(|_| Error::Unavailable)?);
        if delete {
            Ok(TransactWriteItem::builder()
                .delete(
                    Delete::builder()
                        .table_name(&self.table)
                        .key("pk", s(format!("SESSION#{hash}")))
                        .condition_expression("#d = :d")
                        .expression_attribute_names("#d", "data")
                        .expression_attribute_values(":d", value)
                        .build()
                        .map_err(|_| Error::Unavailable)?,
                )
                .build())
        } else {
            Ok(TransactWriteItem::builder()
                .condition_check(
                    ConditionCheck::builder()
                        .table_name(&self.table)
                        .key("pk", s(format!("SESSION#{hash}")))
                        .condition_expression("#d = :d")
                        .expression_attribute_names("#d", "data")
                        .expression_attribute_values(":d", value)
                        .build()
                        .map_err(|_| Error::Unavailable)?,
                )
                .build())
        }
    }
    fn epoch_check(&self, epoch: u64) -> Result<TransactWriteItem, Error> {
        Ok(TransactWriteItem::builder()
            .condition_check(
                ConditionCheck::builder()
                    .table_name(&self.table)
                    .key("pk", s(CONTROL))
                    .condition_expression("epoch = :e")
                    .expression_attribute_values(":e", n(epoch))
                    .build()
                    .map_err(|_| Error::Unavailable)?,
            )
            .build())
    }
    fn bump_epoch(&self) -> Result<TransactWriteItem, Error> {
        Ok(TransactWriteItem::builder()
            .update(
                Update::builder()
                    .table_name(&self.table)
                    .key("pk", s(CONTROL))
                    .update_expression("SET epoch = epoch + :one")
                    .condition_expression("epoch < :max")
                    .expression_attribute_values(":one", n(1))
                    .expression_attribute_values(":max", n(i64::MAX as u64))
                    .build()
                    .map_err(|_| Error::Unavailable)?,
            )
            .build())
    }
    async fn write(&self, items: Vec<TransactWriteItem>) -> Result<(), Error> {
        // The SDK retries the identical transaction/token. An uncertain result is never
        // re-created with a new token or a freshly read grant epoch by application code.
        let token = random()?;
        self.client
            .transact_write_items()
            .set_transact_items(Some(items))
            .client_request_token(&token[..32])
            .send()
            .await
            .map(|_| ())
            .map_err(|e| {
                if e.as_service_error()
                    .is_some_and(|e| e.is_transaction_canceled_exception())
                {
                    Error::Busy
                } else {
                    Error::Unavailable
                }
            })
    }
    async fn pair(&self, hash: &str, now: u64) -> Result<(Session, Connection), Error> {
        let first: Session = decode(
            &self
                .get(&format!("SESSION#{hash}"))
                .await?
                .ok_or(Error::Unauthorized)?,
        )?;
        let mut gets = Vec::new();
        for pk in [
            format!("SESSION#{hash}"),
            format!("CONNECTION#{}", first.connection_id),
        ] {
            gets.push(
                TransactGetItem::builder()
                    .get(
                        Get::builder()
                            .table_name(&self.table)
                            .key("pk", s(pk))
                            .build()
                            .map_err(|_| Error::Unavailable)?,
                    )
                    .build(),
            );
        }
        let output = self
            .client
            .transact_get_items()
            .set_transact_items(Some(gets))
            .send()
            .await
            .map_err(|_| Error::Unavailable)?;
        let records = output.responses();
        let session: Session = decode(
            records
                .first()
                .and_then(|r| r.item.as_ref())
                .ok_or(Error::Unauthorized)?,
        )?;
        if session.connection_id != first.connection_id
            || session.expires_at <= now
            || session.absolute_expires_at <= now
        {
            return Err(Error::Unauthorized);
        }
        let connection = Self::decode_connection(
            records
                .get(1)
                .and_then(|r| r.item.as_ref())
                .ok_or(Error::Unauthorized)?,
        )?;
        connection.active(session.generation, now)?;
        Ok((session, connection))
    }
    fn begin_revocation(connection: &mut Connection, now: u64) -> Result<(), Error> {
        connection.generation = add(connection.generation, 1)?;
        connection.version = add(connection.version, 1)?;
        connection.status = Status::Pending;
        connection.owner = None;
        connection.lease_until = 0;
        connection.revocation = Some(Revocation {
            id: random()?,
            requested: now,
            delete_at: add(now, DAY)?,
            due: now,
            attempts: 0,
            owner: None,
            lease_until: 0,
            phase: Phase::Queued,
        });
        Ok(())
    }
}
#[async_trait]
impl Store for DynamoStore {
    async fn grant_epoch(&self) -> Result<u64, Error> {
        if let Some(item) = self.get(CONTROL).await? {
            return number(&item, "epoch");
        }
        let result = self
            .client
            .put_item()
            .table_name(&self.table)
            .item("pk", s(CONTROL))
            .item("epoch", n(0))
            .condition_expression("attribute_not_exists(pk)")
            .send()
            .await;
        if result.is_err()
            && !result
                .as_ref()
                .err()
                .and_then(|e| e.as_service_error())
                .is_some_and(|e| e.is_conditional_check_failed_exception())
        {
            return Err(Error::Unavailable);
        }
        number(
            &self.get(CONTROL).await?.ok_or(Error::Unavailable)?,
            "epoch",
        )
    }
    async fn put_identity(&self, hash: &str, identity: PendingIdentity) -> Result<(), Error> {
        let mut item = data(format!("IDENTITY#{hash}"), &identity)?;
        item.insert("deleteAfter".into(), n(identity.expires_at));
        self.client
            .put_item()
            .table_name(&self.table)
            .set_item(Some(item))
            .condition_expression("attribute_not_exists(pk)")
            .send()
            .await
            .map(|_| ())
            .map_err(|_| Error::Unavailable)
    }
    async fn identity(&self, hash: &str, now: u64) -> Result<PendingIdentity, Error> {
        let item = self
            .get(&format!("IDENTITY#{hash}"))
            .await?
            .ok_or(Error::Unauthorized)?;
        let identity: PendingIdentity = decode(&item)?;
        if identity.expires_at <= now {
            return Err(Error::Unauthorized);
        }
        Ok(identity)
    }
    async fn delete_identity(&self, hash: &str) -> Result<(), Error> {
        self.client
            .delete_item()
            .table_name(&self.table)
            .key("pk", s(format!("IDENTITY#{hash}")))
            .send()
            .await
            .map(|_| ())
            .map_err(|_| Error::Unavailable)
    }
    async fn put_oauth(&self, hash: &str, transaction: Transaction) -> Result<(), Error> {
        if !matches!(transaction.purpose, OAuthPurpose::SignIn) {
            return Err(Error::InvalidRequest);
        }
        self.write(vec![self.oauth_put(hash, transaction)?]).await
    }
    async fn put_drive_oauth(
        &self,
        hash: &str,
        transaction: Transaction,
        expected: &PendingIdentity,
        now: u64,
    ) -> Result<(), Error> {
        let OAuthPurpose::Drive {
            identity_hash,
            expected_connection,
        } = &transaction.purpose
        else {
            return Err(Error::InvalidRequest);
        };
        if expected_connection != &expected.connection_id
            || transaction.expires_at > expected.expires_at
            || transaction.expires_at <= now
        {
            return Err(Error::IdentityExpired);
        }
        let check = self.identity_check(identity_hash, expected, now, false)?;
        self.write(vec![check, self.oauth_put(hash, transaction)?])
            .await
    }
    async fn take_oauth(&self, hash: &str, cookie: &str, now: u64) -> Result<Transaction, Error> {
        let result = self
            .client
            .delete_item()
            .table_name(&self.table)
            .key("pk", s(format!("OAUTH#{hash}")))
            .condition_expression("cookieHash = :c AND expiresAt > :now")
            .expression_attribute_values(":c", s(cookie))
            .expression_attribute_values(":now", n(now))
            .return_values(aws_sdk_dynamodb::types::ReturnValue::AllOld)
            .send()
            .await;
        let result = match result {
            Ok(value) => value,
            Err(error)
                if error
                    .as_service_error()
                    .is_some_and(|e| e.is_conditional_check_failed_exception()) =>
            {
                if let Some(item) = self.get(&format!("OAUTH#{hash}")).await?
                    && string(&item, "cookieHash").is_ok_and(|v| crate::service::equal(&v, cookie))
                    && number(&item, "expiresAt").is_ok_and(|v| v <= now)
                {
                    return Err(Error::IdentityExpired);
                }
                return Err(Error::Unauthorized);
            }
            Err(_) => return Err(Error::Unavailable),
        };
        let item = result.attributes.ok_or(Error::Unauthorized)?;
        Ok(Transaction {
            purpose: serde_json::from_str(
                &string(&item, "purpose").map_err(|_| Error::Unauthorized)?,
            )
            .map_err(|_| Error::Unauthorized)?,
            cookie_hash: string(&item, "cookieHash")?,
            nonce: Secret(string(&item, "nonce")?),
            verifier: Secret(string(&item, "verifier")?),
            expires_at: number(&item, "expiresAt")?,
        })
    }
    async fn connect(
        &self,
        id: &str,
        encrypted: Vec<u8>,
        hash: &str,
        epoch: u64,
        identity: IdentityConsumption<'_>,
        now: u64,
    ) -> Result<Session, Error> {
        if identity.expected.connection_id != id {
            return Err(Error::AccountMismatch);
        }
        let consume = self.identity_check(identity.hash, identity.expected, now, true)?;
        let old = self.connection(id).await?;
        if old.as_ref().is_some_and(|c| {
            !matches!(c.status, Status::Active | Status::Revoked) || c.lease_until > now
        }) {
            return Err(Error::Busy);
        }
        let generation = match &old {
            None => 1,
            Some(c) if c.status == Status::Revoked => add(c.generation, 1)?,
            Some(c) => c.generation,
        };
        let connection = Connection {
            generation,
            version: add(old.as_ref().map_or(0, |c| c.version), 1)?,
            status: Status::Active,
            activity: now,
            owner: None,
            lease_until: 0,
            last_attempt: None,
            revocation: None,
            encrypted,
        };
        let session = Session {
            connection_id: id.into(),
            generation,
            expires_at: add(now, SESSION_TTL)?,
            absolute_expires_at: add(now, ABSOLUTE_TTL)?,
        };
        self.write(vec![
            self.epoch_check(epoch)?,
            consume,
            self.put_connection(id, &connection, old.map(|c| c.version))?,
            self.put_session(hash, &session)?,
        ])
        .await?;
        Ok(session)
    }
    async fn session(&self, hash: &str, now: u64) -> Result<Session, Error> {
        Ok(self.pair(hash, now).await?.0)
    }
    async fn renew(&self, old: &str, new: &str, now: u64) -> Result<Session, Error> {
        let (session, mut connection) = self.pair(old, now).await?;
        let mut next = session.clone();
        next.expires_at = add(now, SESSION_TTL)?.min(next.absolute_expires_at);
        let version = connection.version;
        connection.version = add(version, 1)?;
        connection.activity = now;
        self.write(vec![
            self.session_check(old, &session, true)?,
            self.put_session(new, &next)?,
            self.put_connection(&session.connection_id, &connection, Some(version))?,
        ])
        .await?;
        Ok(next)
    }
    async fn logout(&self, hash: &str) -> Result<(), Error> {
        self.client
            .delete_item()
            .table_name(&self.table)
            .key("pk", s(format!("SESSION#{hash}")))
            .send()
            .await
            .map(|_| ())
            .map_err(|_| Error::Unavailable)
    }
    async fn claim(&self, hash: &str, owner: &str, now: u64) -> Result<Lease, Error> {
        let (session, mut c) = self.pair(hash, now).await?;
        if c.lease_until > now
            || c.last_attempt
                .is_some_and(|v| v.saturating_add(LEASE_TTL) > now)
        {
            return Err(Error::Busy);
        }
        let version = c.version;
        c.version = add(version, 1)?;
        c.owner = Some(owner.into());
        c.lease_until = add(now, LEASE_TTL)?;
        c.last_attempt = Some(now);
        self.write(vec![
            self.session_check(hash, &session, false)?,
            self.put_connection(&session.connection_id, &c, Some(version))?,
        ])
        .await?;
        Ok(Lease {
            session_hash: hash.into(),
            authorization_until: c
                .lease_until
                .min(session.expires_at)
                .min(session.absolute_expires_at)
                .min(add(c.activity, ABSOLUTE_TTL)?),
            connection_id: session.connection_id,
            generation: c.generation,
            owner: owner.into(),
            encrypted_refresh: c.encrypted,
        })
    }
    async fn finish(&self, lease: &Lease, rotated: Option<Vec<u8>>, now: u64) -> Result<(), Error> {
        let (session, mut c) = self.pair(&lease.session_hash, now).await?;
        if session.connection_id != lease.connection_id || session.generation != lease.generation {
            return Err(Error::Unauthorized);
        }
        c.active(lease.generation, now)?;
        if c.owner.as_deref() != Some(&lease.owner) || c.lease_until <= now {
            return Err(Error::Unauthorized);
        }
        let version = c.version;
        c.version = add(version, 1)?;
        c.owner = None;
        c.lease_until = 0;
        c.activity = now;
        if let Some(value) = rotated {
            c.encrypted = value;
        }
        self.write(vec![
            self.session_check(&lease.session_hash, &session, false)?,
            self.put_connection(&lease.connection_id, &c, Some(version))?,
        ])
        .await
    }
    async fn release(&self, lease: &Lease) -> Result<(), Error> {
        let mut c = self
            .connection(&lease.connection_id)
            .await?
            .ok_or(Error::Unauthorized)?;
        if c.generation != lease.generation || c.owner.as_deref() != Some(&lease.owner) {
            return Err(Error::Unauthorized);
        }
        let version = c.version;
        c.version = add(version, 1)?;
        c.owner = None;
        c.lease_until = 0;
        self.write(vec![self.put_connection(
            &lease.connection_id,
            &c,
            Some(version),
        )?])
        .await
    }
    async fn invalidate(
        &self,
        lease: &Lease,
        reason: InvalidationReason,
        now: u64,
    ) -> Result<(), Error> {
        let mut c = self
            .connection(&lease.connection_id)
            .await?
            .ok_or(Error::Unauthorized)?;
        c.active(lease.generation, now)?;
        if c.owner.as_deref() != Some(&lease.owner) || c.lease_until <= now {
            return Err(Error::Unauthorized);
        }
        let version = c.version;
        match reason {
            InvalidationReason::ScopeChanged => Self::begin_revocation(&mut c, now)?,
            InvalidationReason::InvalidGrant => {
                c.version = add(c.version, 1)?;
                c.generation = add(c.generation, 1)?;
                c.status = Status::Revoked;
                c.encrypted.clear();
                c.owner = None;
                c.lease_until = 0;
                c.revocation = None;
            }
        }
        self.write(vec![
            self.put_connection(&lease.connection_id, &c, Some(version))?,
            self.bump_epoch()?,
        ])
        .await
    }
    async fn disable(&self, hash: &str, now: u64) -> Result<RevocationKey, Error> {
        let (session, mut c) = self.pair(hash, now).await?;
        let version = c.version;
        Self::begin_revocation(&mut c, now)?;
        self.write(vec![
            self.session_check(hash, &session, false)?,
            self.put_connection(&session.connection_id, &c, Some(version))?,
            self.bump_epoch()?,
        ])
        .await?;
        c.key(&session.connection_id)
    }
    async fn claim_revocation(
        &self,
        key: &RevocationKey,
        owner: &str,
        now: u64,
    ) -> Result<RevocationClaim, Error> {
        let mut c = self
            .connection(&key.connection_id)
            .await?
            .ok_or(Error::Unauthorized)?;
        let r = c.revocation(key)?;
        if c.status != Status::Pending
            || r.phase != Phase::Queued
            || r.delete_at <= now
            || r.due > now
            || r.lease_until > now
            || c.encrypted.is_empty()
        {
            return Err(Error::Busy);
        }
        let version = c.version;
        c.version = add(version, 1)?;
        let r = c.revocation.as_mut().ok_or(Error::Unavailable)?;
        r.owner = Some(owner.into());
        r.lease_until = add(now, LEASE_TTL)?.min(r.delete_at);
        r.due = r.lease_until;
        r.attempts = add(r.attempts, 1)?;
        let claim = RevocationClaim {
            key: key.clone(),
            owner: owner.into(),
            lease_until: r.lease_until,
            delete_at: r.delete_at,
            encrypted_refresh: c.encrypted.clone(),
        };
        self.write(vec![
            self.put_connection(&key.connection_id, &c, Some(version))?,
            self.bump_epoch()?,
        ])
        .await?;
        Ok(claim)
    }
    async fn mark_revocation_dispatching(
        &self,
        claim: &RevocationClaim,
        now: u64,
    ) -> Result<(), Error> {
        let mut c = self
            .connection(&claim.key.connection_id)
            .await?
            .ok_or(Error::Unauthorized)?;
        let r = c.claim(claim, now)?;
        if r.phase != Phase::Queued {
            return Err(Error::Unauthorized);
        }
        let version = c.version;
        c.version = add(version, 1)?;
        c.revocation.as_mut().ok_or(Error::Unavailable)?.phase = Phase::Dispatching;
        self.write(vec![self.put_connection(
            &claim.key.connection_id,
            &c,
            Some(version),
        )?])
        .await
    }
    async fn complete_revocation(
        &self,
        claim: &RevocationClaim,
        outcome: RevokeOutcome,
        now: u64,
    ) -> Result<(), Error> {
        let mut c = self
            .connection(&claim.key.connection_id)
            .await?
            .ok_or(Error::Unauthorized)?;
        let r = c.claim(claim, now)?;
        if outcome == RevokeOutcome::NotDispatchedRetryable && r.phase != Phase::Queued {
            return Err(Error::Unauthorized);
        }
        if outcome != RevokeOutcome::NotDispatchedRetryable && r.phase != Phase::Dispatching {
            return Err(Error::Unauthorized);
        }
        let version = c.version;
        c.version = add(version, 1)?;
        match outcome {
            RevokeOutcome::Confirmed => {
                c.status = Status::Revoked;
                c.encrypted.clear();
                c.revocation = None;
            }
            RevokeOutcome::NotDispatchedRetryable => {
                let r = c.revocation.as_mut().ok_or(Error::Unavailable)?;
                r.owner = None;
                r.lease_until = 0;
                r.due = add(now, 60u64.saturating_mul(1u64 << r.attempts.min(6)))?.min(r.delete_at);
            }
            RevokeOutcome::Uncertain => {
                c.status = Status::Uncertain;
                let r = c.revocation.as_mut().ok_or(Error::Unavailable)?;
                r.owner = None;
                r.lease_until = 0;
                r.phase = Phase::Uncertain;
                r.due = r.delete_at;
            }
        }
        self.write(vec![
            self.put_connection(&claim.key.connection_id, &c, Some(version))?,
            self.bump_epoch()?,
        ])
        .await
    }
}

impl DynamoStore {
    /// GSI is discovery only. Every returned key is re-read consistently and checked below.
    pub async fn due(&self, kind: &str, now: u64, limit: i32) -> Result<Vec<String>, Error> {
        if !matches!(kind, "REVOCATION" | "INACTIVITY") || !(1..=25).contains(&limit) {
            return Err(Error::InvalidRequest);
        }
        let output = self
            .client
            .query()
            .table_name(&self.table)
            .index_name("work-due")
            .key_condition_expression("workType = :kind AND workAt <= :now")
            .expression_attribute_values(":kind", s(kind))
            .expression_attribute_values(":now", n(now))
            .limit(limit)
            .send()
            .await
            .map_err(|_| Error::Unavailable)?;
        output
            .items()
            .iter()
            .map(|item| {
                string(item, "pk").and_then(|pk| {
                    pk.strip_prefix("CONNECTION#")
                        .map(str::to_owned)
                        .ok_or(Error::Unavailable)
                })
            })
            .collect()
    }
    /// A bounded batch progresses the index; stale index entries never authorize work.
    pub async fn prepare_due(&self, id: &str, now: u64) -> Result<DueOutcome, Error> {
        let Some(mut c) = self.connection(id).await? else {
            return Ok(DueOutcome::NotDue);
        };
        let version = c.version;
        if c.status == Status::Active {
            if add(c.activity, ABSOLUTE_TTL)? > now {
                return Ok(DueOutcome::NotDue);
            }
            Self::begin_revocation(&mut c, now)?;
            self.write(vec![
                self.put_connection(id, &c, Some(version))?,
                self.bump_epoch()?,
            ])
            .await?;
            return Ok(DueOutcome::Revocation(c.key(id)?));
        }
        let Some(r) = c.revocation.as_ref() else {
            return Ok(DueOutcome::NotDue);
        };
        if c.encrypted.is_empty() || r.due > now {
            return Ok(DueOutcome::NotDue);
        }
        if r.delete_at <= now {
            c.version = add(version, 1)?;
            c.encrypted.clear();
            c.status = Status::Uncertain;
            let r = c.revocation.as_mut().ok_or(Error::Unavailable)?;
            r.owner = None;
            r.lease_until = 0;
            r.phase = Phase::Uncertain;
            self.write(vec![
                self.put_connection(id, &c, Some(version))?,
                self.bump_epoch()?,
            ])
            .await?;
            return Ok(DueOutcome::Purged);
        }
        if r.phase == Phase::Dispatching && r.lease_until <= now {
            c.version = add(version, 1)?;
            c.status = Status::Uncertain;
            let r = c.revocation.as_mut().ok_or(Error::Unavailable)?;
            r.owner = None;
            r.lease_until = 0;
            r.phase = Phase::Uncertain;
            r.due = r.delete_at;
            self.write(vec![
                self.put_connection(id, &c, Some(version))?,
                self.bump_epoch()?,
            ])
            .await?;
            return Ok(DueOutcome::Uncertain);
        }
        if c.status == Status::Pending && r.phase == Phase::Queued && r.lease_until <= now {
            return Ok(DueOutcome::Revocation(c.key(id)?));
        }
        Ok(DueOutcome::NotDue)
    }
    /// IAM-only operational API. The operator must confirm provider revocation and no
    /// in-flight execution; an expired lease alone is not that confirmation.
    pub async fn resolve_uncertain(&self, key: &RevocationKey, now: u64) -> Result<(), Error> {
        let mut c = self
            .connection(&key.connection_id)
            .await?
            .ok_or(Error::Unauthorized)?;
        let r = c.revocation(key)?;
        if c.status != Status::Uncertain || r.lease_until > now {
            return Err(Error::Busy);
        }
        let version = c.version;
        c.version = add(version, 1)?;
        c.status = Status::Revoked;
        c.encrypted.clear();
        c.revocation = None;
        self.write(vec![
            self.put_connection(&key.connection_id, &c, Some(version))?,
            self.bump_epoch()?,
        ])
        .await
    }
}
