//! Machines: encrypted exchange of daily aggregate buckets.
//!
//! The server is deliberately dumb. It stores one opaque blob per machine;
//! the secret and all plaintext stay on the user's machines.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use argon2::Argon2;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use chacha20poly1305::{aead::Aead, KeyInit, XChaCha20Poly1305, XNonce};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokscale_core::{CostSource, TokenBreakdown, UnifiedMessage};

use crate::commands::{Snapshot, SnapshotData};

const KEYRING_SERVICE: &str = "dev.bunnygamezsc.tokscale-gui.machines";
const KDF_SALT: &[u8] = b"tokscale-machines-v1";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Bucket {
    pub date: String,
    pub client: String,
    pub provider: String,
    pub model: String,
    pub machine_id: String,
    pub input: i64,
    pub output: i64,
    pub cache_read: i64,
    pub cache_write: i64,
    pub messages: i32,
    pub cost: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MachineExport {
    pub version: u8,
    pub machine_id: String,
    pub label: String,
    pub generated_at: u64,
    pub buckets: Vec<Bucket>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MachineInfo {
    pub id: String,
    pub label: String,
    pub last_seen: Option<u64>,
    pub local: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MachinesStatus {
    pub connected: bool,
    pub key_id: Option<String>,
    pub machines: Vec<MachineInfo>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSummary {
    pub machines: usize,
    pub buckets: usize,
    pub messages: i32,
    pub cost: f64,
}

#[derive(Debug, Serialize, Deserialize)]
struct CipherBlob {
    version: u8,
    nonce: String,
    ciphertext: String,
}

#[derive(Default)]
pub struct FleetState(pub Mutex<BTreeMap<String, MachineExport>>);

impl FleetState {
    pub(crate) fn documents(&self) -> Result<Vec<MachineExport>, String> {
        Ok(self
            .0
            .lock()
            .map_err(|_| "machines lock poisoned")?
            .values()
            .cloned()
            .collect())
    }
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

pub(crate) fn export_of(
    messages: &[UnifiedMessage],
    machine_id: &str,
    label: &str,
) -> MachineExport {
    type Key = (String, String, String, String);
    let mut folded: BTreeMap<Key, Bucket> = BTreeMap::new();
    for message in messages {
        let key = (
            message.date.clone(),
            message.client.clone(),
            message.provider_id.clone(),
            message.model_id.clone(),
        );
        let bucket = folded.entry(key).or_insert_with(|| Bucket {
            date: message.date.clone(),
            client: message.client.clone(),
            provider: message.provider_id.clone(),
            model: message.model_id.clone(),
            machine_id: machine_id.to_string(),
            input: 0,
            output: 0,
            cache_read: 0,
            cache_write: 0,
            messages: 0,
            cost: 0.0,
        });
        bucket.input = bucket.input.saturating_add(message.tokens.input);
        bucket.output = bucket.output.saturating_add(message.tokens.output);
        bucket.cache_read = bucket.cache_read.saturating_add(message.tokens.cache_read);
        bucket.cache_write = bucket
            .cache_write
            .saturating_add(message.tokens.cache_write);
        bucket.messages = bucket.messages.saturating_add(message.message_count);
        bucket.cost += message.cost;
    }
    MachineExport {
        version: 1,
        machine_id: machine_id.to_string(),
        label: label.to_string(),
        generated_at: now(),
        buckets: folded.into_values().collect(),
    }
}

fn validate(document: &MachineExport) -> Result<(), String> {
    if document.version != 1 {
        return Err(format!(
            "unsupported machines export version {}",
            document.version
        ));
    }
    if document.machine_id.is_empty()
        || document
            .buckets
            .iter()
            .any(|bucket| bucket.machine_id != document.machine_id || !bucket.cost.is_finite())
    {
        return Err("invalid machines export".to_string());
    }
    Ok(())
}

pub(crate) fn messages_of(document: &MachineExport) -> Vec<UnifiedMessage> {
    document
        .buckets
        .iter()
        .map(|bucket| UnifiedMessage {
            client: bucket.client.clone(),
            model_id: bucket.model.clone(),
            provider_id: bucket.provider.clone(),
            session_id: format!("machine:{}", bucket.machine_id),
            workspace_key: None,
            workspace_label: None,
            timestamp: 0,
            date: bucket.date.clone(),
            tokens: TokenBreakdown {
                input: bucket.input,
                output: bucket.output,
                cache_read: bucket.cache_read,
                cache_write: bucket.cache_write,
                reasoning: 0,
            },
            cost: bucket.cost,
            cost_source: CostSource::Unknown,
            duration_ms: None,
            message_count: bucket.messages,
            agent: None,
            dedup_key: Some(format!(
                "machine:{}:{}:{}:{}:{}",
                bucket.machine_id, bucket.date, bucket.client, bucket.provider, bucket.model
            )),
            session_title: None,
            is_turn_start: false,
            model_attribution_conflicted: false,
        })
        .collect()
}

fn key_id(secret: &str) -> String {
    hex::encode(Sha256::digest(secret.as_bytes()))
}

fn key(secret: &str) -> Result<[u8; 32], String> {
    let mut key = [0u8; 32];
    Argon2::default()
        .hash_password_into(secret.as_bytes(), KDF_SALT, &mut key)
        .map_err(|_| "could not derive machines key".to_string())?;
    Ok(key)
}

fn encrypt(secret: &str, plaintext: &[u8]) -> Result<String, String> {
    let cipher = XChaCha20Poly1305::new_from_slice(&key(secret)?)
        .map_err(|_| "could not create machines cipher".to_string())?;
    let mut nonce = [0u8; 24];
    OsRng.fill_bytes(&mut nonce);
    let ciphertext = cipher
        .encrypt(XNonce::from_slice(&nonce), plaintext)
        .map_err(|_| "could not encrypt machines data".to_string())?;
    serde_json::to_string(&CipherBlob {
        version: 1,
        nonce: BASE64.encode(nonce),
        ciphertext: BASE64.encode(ciphertext),
    })
    .map_err(|e| format!("could not encode machines data: {e}"))
}

fn decrypt(secret: &str, blob: &str) -> Result<Vec<u8>, String> {
    let blob: CipherBlob = serde_json::from_str(blob)
        .map_err(|_| "machines data is not a supported encrypted blob".to_string())?;
    if blob.version != 1 {
        return Err("machines data uses an unsupported encryption version".to_string());
    }
    let nonce = BASE64
        .decode(blob.nonce)
        .map_err(|_| "machines data has an invalid nonce".to_string())?;
    let ciphertext = BASE64
        .decode(blob.ciphertext)
        .map_err(|_| "machines data has invalid ciphertext".to_string())?;
    let cipher = XChaCha20Poly1305::new_from_slice(&key(secret)?)
        .map_err(|_| "could not create machines cipher".to_string())?;
    cipher
        .decrypt(
            XNonce::from_slice(
                nonce
                    .as_slice()
                    .try_into()
                    .map_err(|_| "machines data has an invalid nonce".to_string())?,
            ),
            ciphertext.as_ref(),
        )
        .map_err(|_| "could not decrypt machines data; check the key".to_string())
}

fn entry(key_id: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, key_id)
        .map_err(|e| format!("could not open the OS keychain: {e}"))
}

fn secret_for(key_id: &str) -> Result<String, String> {
    entry(key_id)?
        .get_password()
        .map_err(|_| "the Machines key is missing from the OS keychain".to_string())
}

fn settings(app: &tauri::AppHandle) -> Result<crate::gui::GuiSettings, String> {
    crate::gui::load_settings(&crate::gui::settings_path(app)?)
}

#[tauri::command]
pub async fn export_buckets(
    state: tauri::State<'_, Snapshot>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let snapshot = state.local()?;
    let settings = settings(&app)?;
    let document = export_of(
        &snapshot.messages,
        &snapshot.machine_id,
        &settings.machine_label,
    );
    serde_json::to_string_pretty(&document).map_err(|e| format!("could not encode export: {e}"))
}

#[tauri::command]
pub async fn import_buckets(
    state: tauri::State<'_, FleetState>,
    app: tauri::AppHandle,
    files: Vec<String>,
) -> Result<ImportSummary, String> {
    let local_id = settings(&app)?.machine_id;
    let mut parsed = Vec::new();
    for file in files {
        let document: MachineExport = serde_json::from_str(&file)
            .map_err(|e| format!("could not read machines export: {e}"))?;
        validate(&document)?;
        if document.machine_id != local_id {
            parsed.push(document);
        }
    }
    let summary = summary(&parsed);
    let mut held = state.0.lock().map_err(|_| "machines lock poisoned")?;
    for document in parsed {
        held.insert(document.machine_id.clone(), document);
    }
    Ok(summary)
}

fn summary(documents: &[MachineExport]) -> ImportSummary {
    ImportSummary {
        machines: documents.len(),
        buckets: documents.iter().map(|d| d.buckets.len()).sum(),
        messages: documents
            .iter()
            .flat_map(|d| &d.buckets)
            .map(|b| b.messages)
            .sum(),
        cost: documents
            .iter()
            .flat_map(|d| &d.buckets)
            .map(|b| b.cost)
            .sum(),
    }
}

#[tauri::command]
pub async fn connect_machines(app: tauri::AppHandle, secret: String) -> Result<String, String> {
    if !secret.starts_with("tok_") || secret.len() < 20 {
        return Err(
            "Machines keys start with tok_ and must contain at least 16 secret characters"
                .to_string(),
        );
    }
    let id = key_id(&secret);
    entry(&id)?
        .set_password(&secret)
        .map_err(|e| format!("could not save the Machines key in the OS keychain: {e}"))?;
    let path = crate::gui::settings_path(&app)?;
    let mut current = crate::gui::load_settings(&path)?;
    current.machines_key_id = Some(id.clone());
    let document = crate::gui::with_settings(
        std::fs::read_to_string(&path)
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_else(|| serde_json::json!({})),
        &current,
    );
    crate::pricing::write_json(&path, &document)?;
    Ok(id)
}

#[tauri::command]
pub async fn machines_status(
    state: tauri::State<'_, FleetState>,
    app: tauri::AppHandle,
) -> Result<MachinesStatus, String> {
    let settings = settings(&app)?;
    let mut machines = vec![MachineInfo {
        id: settings.machine_id.clone(),
        label: settings.machine_label,
        last_seen: None,
        local: true,
    }];
    machines.extend(state.documents()?.into_iter().map(|document| MachineInfo {
        id: document.machine_id,
        label: document.label,
        last_seen: Some(document.generated_at),
        local: false,
    }));
    Ok(MachinesStatus {
        connected: settings.machines_key_id.is_some(),
        key_id: settings.machines_key_id,
        machines,
    })
}

#[tauri::command]
pub async fn remove_machine(
    state: tauri::State<'_, FleetState>,
    machine_id: String,
) -> Result<(), String> {
    state
        .0
        .lock()
        .map_err(|_| "machines lock poisoned")?
        .remove(&machine_id);
    Ok(())
}

#[tauri::command]
pub async fn refresh_machines(
    snapshot: tauri::State<'_, Snapshot>,
    fleet: tauri::State<'_, FleetState>,
    app: tauri::AppHandle,
) -> Result<ImportSummary, String> {
    let local: SnapshotData = snapshot.local()?;
    let settings = settings(&app)?;
    let id = settings
        .machines_key_id
        .as_deref()
        .ok_or("Machines is not connected")?;
    let secret = secret_for(id)?;
    if key_id(&secret) != id {
        return Err("the Machines key does not match its saved fingerprint".to_string());
    }

    let document = export_of(&local.messages, &local.machine_id, &settings.machine_label);
    let body = encrypt(
        &secret,
        &serde_json::to_vec(&document).map_err(|e| format!("could not encode export: {e}"))?,
    )?;
    let base = settings.machines_base_url.trim_end_matches('/');
    let client = reqwest::Client::new();
    let put = client
        .put(format!("{base}/v1/{id}/{}", local.machine_id))
        .body(body)
        .send()
        .await
        .map_err(|e| format!("could not reach the Machines server: {e}"))?;
    if !put.status().is_success() {
        return Err(format!("Machines upload failed with HTTP {}", put.status()));
    }

    let response = client
        .get(format!("{base}/v1/{id}"))
        .send()
        .await
        .map_err(|e| format!("could not reach the Machines server: {e}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "Machines download failed with HTTP {}",
            response.status()
        ));
    }
    let blobs: BTreeMap<String, String> = response
        .json()
        .await
        .map_err(|e| format!("Machines server returned invalid data: {e}"))?;

    // Decrypt and validate the complete response before replacing anything.
    // A wrong key therefore cannot leave a half-imported fleet behind.
    let mut documents = Vec::new();
    let mut seen = BTreeSet::new();
    for (machine_id, blob) in blobs {
        let plaintext = decrypt(&secret, &blob)?;
        let document: MachineExport = serde_json::from_slice(&plaintext)
            .map_err(|_| "decrypted Machines data is not a valid export".to_string())?;
        validate(&document)?;
        if document.machine_id != machine_id || !seen.insert(machine_id.clone()) {
            return Err("Machines server returned a mismatched machine ID".to_string());
        }
        if machine_id != local.machine_id {
            documents.push(document);
        }
    }
    let result = summary(&documents);
    let replacement = documents
        .into_iter()
        .map(|document| (document.machine_id.clone(), document))
        .collect();
    *fleet.0.lock().map_err(|_| "machines lock poisoned")? = replacement;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn message(machine: &str, input: i64, cost: f64) -> UnifiedMessage {
        let mut message = UnifiedMessage {
            client: "codex".into(),
            model_id: "gpt-5".into(),
            provider_id: "openai".into(),
            session_id: machine.into(),
            workspace_key: None,
            workspace_label: None,
            timestamp: 1,
            date: "2026-09-17".into(),
            tokens: TokenBreakdown::default(),
            cost,
            cost_source: CostSource::Estimated,
            duration_ms: None,
            message_count: 1,
            agent: None,
            dedup_key: None,
            session_title: None,
            is_turn_start: false,
            model_attribution_conflicted: false,
        };
        message.tokens.input = input;
        message
    }

    #[test]
    fn export_folds_overlapping_messages_and_import_round_trips_totals() {
        let document = export_of(
            &[message("a", 10, 1.25), message("a", 20, 2.75)],
            "a",
            "Laptop",
        );
        assert_eq!(document.buckets.len(), 1);
        assert_eq!(document.buckets[0].input, 30);
        assert_eq!(document.buckets[0].messages, 2);
        assert_eq!(document.buckets[0].cost, 4.0);
        let messages = messages_of(&document);
        assert_eq!(messages[0].tokens.input, 30);
        assert_eq!(messages[0].message_count, 2);
    }

    #[test]
    fn two_machines_sum_without_deduplication() {
        let a = export_of(&[message("a", 10, 1.0)], "a", "A");
        let b = export_of(&[message("b", 10, 1.0)], "b", "B");
        let merged: Vec<_> = [&a, &b].into_iter().flat_map(|d| messages_of(d)).collect();
        assert_eq!(merged.iter().map(|m| m.tokens.input).sum::<i64>(), 20);
        assert_eq!(merged.iter().map(|m| m.cost).sum::<f64>(), 2.0);
    }

    #[test]
    fn encryption_rejects_the_wrong_key() {
        let blob = encrypt("tok_1234567890123456", b"hello").unwrap();
        assert_eq!(decrypt("tok_1234567890123456", &blob).unwrap(), b"hello");
        assert!(decrypt("tok_6543210987654321", &blob)
            .unwrap_err()
            .contains("check the key"));
    }
}
