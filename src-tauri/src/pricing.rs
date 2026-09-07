//! Manual pricing overrides.
//!
//! Not a new mechanism: upstream tokscale already reads
//! `~/.config/tokscale/custom-pricing.json`, and `PricingService` consults it
//! *before* LiteLLM, OpenRouter and models.dev. This module is an editor for
//! that file, so a rate entered here is the same rate the CLI and TUI see.
//!
//! Rates are entered per million tokens because that is how vendors quote them,
//! and the file has first-class `*_per_million_tokens` keys for exactly that.
//! Core divides by a million on load; nothing here pre-divides.

use std::collections::BTreeMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tokscale_core::pricing::custom::CustomPricing;
use tokscale_core::pricing::PricingService;
use tokscale_core::pricing::{litellm, models_dev, openrouter};

/// The four rates the GUI edits, in dollars per million tokens.
///
/// Core's file format also carries tiered rates (`*_above_200k_tokens`) and
/// per-token spellings. Those are preserved on write but not editable here — a
/// hand-written tier is not something a four-field form should silently flatten.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Rates {
    pub input: Option<f64>,
    pub output: Option<f64>,
    pub cache_read: Option<f64>,
    pub cache_write: Option<f64>,
}

const INPUT_KEY: &str = "input_cost_per_million_tokens";
const OUTPUT_KEY: &str = "output_cost_per_million_tokens";
const CACHE_READ_KEY: &str = "cache_read_input_token_cost_per_million_tokens";
const CACHE_WRITE_KEY: &str = "cache_creation_input_token_cost_per_million_tokens";

fn path() -> PathBuf {
    tokscale_core::paths::get_config_dir().join("custom-pricing.json")
}

/// Reads the file as raw JSON.
///
/// `Ok(None)` means the file is absent, which is normal. A parse failure is an
/// error rather than an empty default, because every write path below refuses
/// to clobber a file it could not read — silently treating a broken file as
/// empty is how a user's hand-written tiers get erased.
fn read_file() -> Result<Option<Value>, String> {
    let p = path();
    match std::fs::read_to_string(&p) {
        Ok(text) => serde_json::from_str(&text)
            .map(Some)
            .map_err(|e| format!("{} did not parse, so it was left untouched: {e}", p.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("{} could not be read: {e}", p.display())),
    }
}

fn models_of(doc: &Value) -> Map<String, Value> {
    doc.get("models")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default()
}

fn rates_of(entry: &Value) -> Rates {
    let get = |k: &str| entry.get(k).and_then(Value::as_f64);
    Rates {
        input: get(INPUT_KEY),
        output: get(OUTPUT_KEY),
        cache_read: get(CACHE_READ_KEY),
        cache_write: get(CACHE_WRITE_KEY),
    }
}

/// Every model that currently carries a manual rate.
#[tauri::command]
pub async fn custom_pricing() -> Result<BTreeMap<String, Rates>, String> {
    let Some(doc) = read_file()? else {
        return Ok(BTreeMap::new());
    };
    Ok(models_of(&doc)
        .iter()
        .map(|(k, v)| (k.clone(), rates_of(v)))
        .collect())
}

/// Writes one model's rates, preserving every other key in the file.
///
/// The existing entry is merged into rather than replaced, so tiered rates and
/// per-token spellings this form cannot edit survive a save. A field set to
/// `None` is removed; a field set to `0.0` is kept, because zero is a statement
/// — "this model is free" — and core accepts it deliberately.
#[tauri::command]
pub async fn set_custom_pricing(model: String, rates: Rates) -> Result<(), String> {
    let model = model.trim().to_string();
    if model.is_empty() {
        return Err("a model id is required".into());
    }
    for (label, value) in [
        ("input", rates.input),
        ("output", rates.output),
        ("cache read", rates.cache_read),
        ("cache write", rates.cache_write),
    ] {
        if let Some(v) = value {
            if !v.is_finite() || v < 0.0 {
                return Err(format!("{label} rate must be zero or more"));
            }
        }
    }

    let mut doc = read_file()?.unwrap_or_else(|| Value::Object(Map::new()));
    let mut models = models_of(&doc);
    let mut entry = models
        .get(&model)
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();

    for (key, value) in [
        (INPUT_KEY, rates.input),
        (OUTPUT_KEY, rates.output),
        (CACHE_READ_KEY, rates.cache_read),
        (CACHE_WRITE_KEY, rates.cache_write),
    ] {
        match value {
            Some(v) => {
                entry.insert(key.to_string(), Value::from(v));
            }
            None => {
                entry.remove(key);
            }
        }
    }

    if entry.is_empty() {
        models.remove(&model);
    } else {
        models.insert(model, Value::Object(entry));
    }

    doc.as_object_mut()
        .ok_or("custom-pricing.json is not a JSON object")?
        .insert("models".into(), Value::Object(models));

    write_file(&doc)
}

/// Drops a model's manual rates entirely, so it falls back to upstream pricing.
#[tauri::command]
pub async fn clear_custom_pricing(model: String) -> Result<(), String> {
    let Some(mut doc) = read_file()? else {
        return Ok(());
    };
    let mut models = models_of(&doc);
    if models.remove(&model).is_none() {
        return Ok(());
    }
    doc.as_object_mut()
        .ok_or("custom-pricing.json is not a JSON object")?
        .insert("models".into(), Value::Object(models));
    write_file(&doc)
}

/// Writes through a temp file in the same directory, so a crash mid-write
/// cannot leave a half-written pricing file that core would then refuse.
fn write_file(doc: &Value) -> Result<(), String> {
    let final_path = path();
    let dir = final_path
        .parent()
        .ok_or("custom-pricing.json has no parent directory")?;
    std::fs::create_dir_all(dir).map_err(|e| format!("{} could not be created: {e}", dir.display()))?;

    let text = serde_json::to_string_pretty(doc).map_err(|e| e.to_string())?;
    let tmp = final_path.with_extension("json.tmp");
    std::fs::write(&tmp, text.as_bytes())
        .map_err(|e| format!("{} could not be written: {e}", tmp.display()))?;
    tokscale_core::fs_atomic::replace_file(&tmp, &final_path)
        .map_err(|e| format!("{} could not be replaced: {e}", final_path.display()))
}

/// A pricing service that has just re-read the manual overrides.
///
/// `PricingService::get_or_init` caches in a process-wide `OnceCell`, so it
/// reads `custom-pricing.json` exactly once per launch. After an edit that
/// cached service is stale, and a rescan through it would show the old cost. So
/// a forced rescan builds a fresh service instead: freshly loaded overrides on
/// top of the upstream datasets already cached on disk by the first scan.
///
/// Returns `None` before those caches exist, in which case the caller falls
/// back to `get_or_init` and fetches them.
pub fn reloaded() -> Option<PricingService> {
    let litellm = litellm::load_cached_any_age()?;
    Some(PricingService::new_with_custom_and_models_dev(
        CustomPricing::load_from_default_path(),
        litellm,
        openrouter::load_cached_any_age().unwrap_or_default(),
        models_dev::load_cached_any_age().unwrap_or_default(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The whole feature hinges on these four key names being the ones core
    /// reads. If they drift — a fork bump renames one, or a typo slips in — the
    /// file still writes, the UI still says "saved", and the cost silently stays
    /// zero. That failure is invisible from the GUI, so it is pinned here
    /// against core's own reader rather than against a screenshot.
    #[test]
    fn core_reads_the_keys_this_module_writes() {
        let dir = std::env::temp_dir().join(format!("tokscale-gui-pricing-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("custom-pricing.json");

        let doc = serde_json::json!({
            "models": {
                "some-unpriced-model": {
                    INPUT_KEY: 1.0,
                    OUTPUT_KEY: 10.0,
                    CACHE_READ_KEY: 0.1,
                    CACHE_WRITE_KEY: 1.25,
                }
            }
        });
        std::fs::write(&path, serde_json::to_string_pretty(&doc).unwrap()).unwrap();

        let custom = CustomPricing::load_from_path(&path);
        let priced = custom
            .lookup("some-unpriced-model")
            .expect("core should find the model this module writes");

        // Core stores per-token, so a per-million rate divides by 1e6.
        assert_eq!(priced.input_cost_per_token, Some(1.0 / 1_000_000.0));
        assert_eq!(priced.output_cost_per_token, Some(10.0 / 1_000_000.0));
        assert_eq!(priced.cache_read_input_token_cost, Some(0.1 / 1_000_000.0));
        assert_eq!(
            priced.cache_creation_input_token_cost,
            Some(1.25 / 1_000_000.0)
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    /// Zero is a rate, not an absent rate: it means the model is free, and core
    /// accepts it deliberately. Round-tripping it as `None` would quietly send
    /// the model back to upstream pricing.
    #[test]
    fn zero_survives_the_round_trip() {
        let entry = serde_json::json!({ INPUT_KEY: 0.0, OUTPUT_KEY: 2.5 });
        let rates = rates_of(&entry);
        assert_eq!(rates.input, Some(0.0));
        assert_eq!(rates.output, Some(2.5));
        assert_eq!(rates.cache_read, None);
    }
}
