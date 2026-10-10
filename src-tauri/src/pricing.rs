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
use tokscale_core::pricing::PricingService;

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
    read_at(&path())
}

fn read_at(p: &std::path::Path) -> Result<Option<Value>, String> {
    match std::fs::read_to_string(p) {
        Ok(text) => serde_json::from_str(&text).map(Some).map_err(|e| {
            format!(
                "{} did not parse, so it was left untouched: {e}",
                p.display()
            )
        }),
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

    let doc = read_file()?.unwrap_or_else(|| Value::Object(Map::new()));
    write_file(&merged(doc, &model, &rates)?)
}

/// Applies one model's rates to the document, leaving everything else alone.
///
/// Separated from the IO because this is where the format's sharp edges live:
/// an existing entry is merged into rather than replaced, so tiered rates and
/// per-token spellings this form cannot edit survive a save, and a model whose
/// last rate is cleared drops out of the file entirely instead of lingering as
/// an empty object that core would read as "priced at nothing".
fn merged(mut doc: Value, model: &str, rates: &Rates) -> Result<Value, String> {
    let mut models = models_of(&doc);
    let mut entry = models
        .get(model)
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
        models.remove(model);
    } else {
        models.insert(model.to_string(), Value::Object(entry));
    }

    doc.as_object_mut()
        .ok_or("custom-pricing.json is not a JSON object")?
        .insert("models".into(), Value::Object(models));
    Ok(doc)
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

fn write_file(doc: &Value) -> Result<(), String> {
    write_json(&path(), doc)
}

/// Writes through a temp file in the same directory, so a crash mid-write
/// cannot leave a half-written file that its reader would then refuse.
pub(crate) fn write_json(final_path: &std::path::Path, doc: &Value) -> Result<(), String> {
    let dir = final_path
        .parent()
        .ok_or_else(|| format!("{} has no parent directory", final_path.display()))?;
    std::fs::create_dir_all(dir)
        .map_err(|e| format!("{} could not be created: {e}", dir.display()))?;

    let text = serde_json::to_string_pretty(doc).map_err(|e| e.to_string())?;
    let tmp = final_path.with_extension("json.tmp");
    std::fs::write(&tmp, text.as_bytes())
        .map_err(|e| format!("{} could not be written: {e}", tmp.display()))?;
    tokscale_core::fs_atomic::replace_file(&tmp, final_path)
        .map_err(|e| format!("{} could not be replaced: {e}", final_path.display()))
}

/// Use core's fetch/cache policy while re-reading manual overrides each scan.
pub async fn reloaded() -> Result<PricingService, String> {
    PricingService::reload().await
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokscale_core::pricing::custom::CustomPricing;

    #[test]
    fn reload_keeps_custom_edits_live_and_filters_subscription_rates() {
        const CHILD: &str = "TOKSCALE_GUI_PRICING_RELOAD_TEST";
        if std::env::var_os(CHILD).is_some() {
            let config = tokscale_core::paths::get_config_dir();
            let custom_path = config.join("custom-pricing.json");
            let write_rate = |rate| {
                std::fs::write(
                    &custom_path,
                    serde_json::json!({
                        "models": { "gui-test-model": {
                            "input_cost_per_million_tokens": rate
                        }}
                    })
                    .to_string(),
                )
                .unwrap();
            };
            let usage = tokscale_core::TokenBreakdown {
                input: 100_000,
                ..Default::default()
            };
            for rate in [2.0, 4.0] {
                write_rate(rate);
                let pricing = tauri::async_runtime::block_on(reloaded()).unwrap();
                let cost = pricing.calculate_cost_with_provider("gui-test-model", None, &usage);
                assert!((cost - rate / 10.0).abs() < 1e-10);
                assert!(pricing
                    .lookup_with_source("github_copilot/gui-subscription-model", Some("litellm"))
                    .is_none());
            }

            // Compare the GUI reload path with the TUI's shared service across
            // provider families, including Claude cache writes of both TTLs.
            let tui = tauri::async_runtime::block_on(PricingService::get_or_init()).unwrap();
            let gui = tauri::async_runtime::block_on(reloaded()).unwrap();
            let mixed_usage = tokscale_core::TokenBreakdown {
                input: 10_000,
                output: 1_000,
                cache_read: 100_000,
                cache_write: 10_000,
                cache_write_1h: 2_000,
                ..Default::default()
            };
            for (provider, model) in [
                ("anthropic", "claude-opus-5"),
                ("anthropic", "anthropic/claude-opus-5"),
                ("anthropic", "claude-sonnet-4-6"),
                ("openai", "gpt-5.3-codex"),
                ("google", "gemini-2.5-pro"),
                ("xai", "grok-4"),
            ] {
                for input in [10_000, 300_000] {
                    let usage = tokscale_core::TokenBreakdown {
                        input,
                        ..mixed_usage.clone()
                    };
                    let expected = tui.calculate_cost_with_provider(model, Some(provider), &usage);
                    let actual = gui.calculate_cost_with_provider(model, Some(provider), &usage);
                    assert!(expected > 0.0, "fixture must resolve {model}");
                    assert!(
                        (actual - expected).abs() < 1e-10,
                        "GUI/TUI differ for {model}"
                    );
                }
            }
            let opus =
                gui.calculate_cost_with_provider("claude-opus-5", Some("anthropic"), &mixed_usage);
            // 5/M input, 25/M output, .5/M reads, 6.25/M 5m writes,
            // 10/M 1h writes. The 1h count is a subset of total writes.
            assert!(
                (opus - 0.195).abs() < 1e-10,
                "Opus cache accounting: {opus}"
            );
            return;
        }

        // A subprocess isolates the config override from other parallel tests.
        let config =
            std::env::temp_dir().join(format!("tokscale-gui-reload-{}", std::process::id()));
        let cache = config.join("cache");
        std::fs::create_dir_all(&cache).unwrap();
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        for (filename, data) in [
            (
                "pricing-litellm.json",
                serde_json::json!({
                    "github_copilot/gui-subscription-model": {
                        "input_cost_per_token": 0.0,
                        "output_cost_per_token": 0.0
                    },
                    "claude-opus-5": {
                        "input_cost_per_token": 5e-6,
                        "output_cost_per_token": 25e-6,
                        "cache_read_input_token_cost": 0.5e-6,
                        "cache_creation_input_token_cost": 6.25e-6,
                        "cache_creation_input_token_cost_above_1hr": 10e-6
                    },
                    "claude-sonnet-4-6": { "input_cost_per_token": 3e-6 },
                    "gpt-5.3-codex": { "input_cost_per_token": 1.75e-6 },
                    "gemini-2.5-pro": { "input_cost_per_token": 1.25e-6 },
                    "xai/grok-4": { "input_cost_per_token": 3e-6 }
                }),
            ),
            ("pricing-openrouter.json", serde_json::json!({})),
            ("pricing-models-dev.json", serde_json::json!({})),
        ] {
            std::fs::write(
                cache.join(filename),
                serde_json::json!({
                    "timestamp": timestamp, "data": data
                })
                .to_string(),
            )
            .unwrap();
        }
        let result = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "pricing::tests::reload_keeps_custom_edits_live_and_filters_subscription_rates",
            ])
            .env(CHILD, "1")
            .env("TOKSCALE_CONFIG_DIR", &config)
            .output()
            .unwrap();
        std::fs::remove_dir_all(config).unwrap();
        assert!(
            result.status.success(),
            "{}{}",
            String::from_utf8_lossy(&result.stdout),
            String::from_utf8_lossy(&result.stderr)
        );
    }

    /// Codex bills OpenAI directly. A cheaper OpenRouter listing must not
    /// replace the direct provider's rates when the GUI reloads pricing.
    #[test]
    fn direct_openai_sol_pricing_matches_tui() {
        use std::collections::HashMap;
        use tokscale_core::{pricing::ModelPricing, TokenBreakdown};

        for (model, cache_rate) in [("gpt-6-sol", 0.2e-6), ("gpt-6.1-sol", 0.1e-6)] {
            let direct = ModelPricing {
                input_cost_per_token: Some(2e-6),
                output_cost_per_token: Some(10e-6),
                cache_read_input_token_cost: Some(cache_rate),
                input_cost_per_token_above_272k_tokens: Some(4e-6),
                output_cost_per_token_above_272k_tokens: Some(15e-6),
                cache_read_input_token_cost_above_272k_tokens: Some(cache_rate * 2.0),
                ..Default::default()
            };
            let router = ModelPricing {
                input_cost_per_token: Some(1e-6),
                output_cost_per_token: Some(5e-6),
                cache_read_input_token_cost: Some(cache_rate / 2.0),
                ..Default::default()
            };
            let service = PricingService::new(
                HashMap::from([(model.to_owned(), direct)]),
                HashMap::from([(format!("openai/{model}"), router)]),
            );
            let usage = TokenBreakdown {
                input: 10_000,
                cache_read: 100_000,
                output: 1_000,
                reasoning: 500,
                ..Default::default()
            };
            let expected = 10_000.0 * 2e-6 + 100_000.0 * cache_rate + 1_500.0 * 10e-6;
            let actual = service.calculate_cost_with_provider(model, Some("openai"), &usage);
            assert!(
                (actual - expected).abs() < 1e-10,
                "{model}: expected {expected}, got {actual}"
            );

            // Cached input counts toward the request-wide 272K threshold.
            let long_usage = TokenBreakdown {
                cache_read: 270_000,
                ..usage
            };
            let expected_long = 10_000.0 * 4e-6 + 270_000.0 * cache_rate * 2.0 + 1_500.0 * 15e-6;
            let actual_long =
                service.calculate_cost_with_provider(model, Some("openai"), &long_usage);
            assert!(
                (actual_long - expected_long).abs() < 1e-10,
                "{model} long context: expected {expected_long}, got {actual_long}"
            );
        }
    }

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

    fn rates(input: Option<f64>, output: Option<f64>) -> Rates {
        Rates {
            input,
            output,
            ..Default::default()
        }
    }

    /// The reason saving merges instead of replacing. `custom-pricing.json`
    /// carries tiered rates and per-token spellings that the four-field form
    /// cannot express; a save must not be the thing that deletes them.
    #[test]
    fn saving_preserves_keys_the_form_cannot_edit() {
        let doc = serde_json::json!({
            "models": {
                "m": {
                    INPUT_KEY: 1.0,
                    "input_cost_per_million_tokens_above_200k_tokens": 2.0,
                    "output_cost_per_token": 0.000003,
                }
            }
        });

        let out = merged(doc, "m", &rates(Some(5.0), None)).unwrap();
        let entry = &out["models"]["m"];

        assert_eq!(entry[INPUT_KEY], 5.0, "the edited field is replaced");
        assert_eq!(
            entry["input_cost_per_million_tokens_above_200k_tokens"], 2.0,
            "a tier the form cannot show must survive"
        );
        assert_eq!(
            entry["output_cost_per_token"], 0.000003,
            "a per-token spelling must survive"
        );
    }

    /// Another model's rates are none of this save's business.
    #[test]
    fn saving_leaves_other_models_alone() {
        let doc = serde_json::json!({ "models": { "other": { INPUT_KEY: 9.0 } } });
        let out = merged(doc, "m", &rates(Some(1.0), None)).unwrap();
        assert_eq!(out["models"]["other"][INPUT_KEY], 9.0);
        assert_eq!(out["models"]["m"][INPUT_KEY], 1.0);
    }

    /// Clearing every field drops the model rather than leaving `{}` behind,
    /// which core would read as an entry that prices nothing.
    #[test]
    fn clearing_every_field_removes_the_model() {
        let doc = serde_json::json!({ "models": { "m": { INPUT_KEY: 1.0 } } });
        let out = merged(doc, "m", &Rates::default()).unwrap();
        assert!(
            out["models"].as_object().unwrap().is_empty(),
            "model should be gone, got {out}"
        );
    }

    /// Zero is a rate. Round-tripping it through a save must not turn it into
    /// an absent rate, which would send the model back to upstream pricing.
    #[test]
    fn zero_is_written_not_dropped() {
        let doc = serde_json::json!({});
        let out = merged(doc, "m", &rates(Some(0.0), Some(0.0))).unwrap();
        assert_eq!(out["models"]["m"][INPUT_KEY], 0.0);
        assert_eq!(out["models"]["m"][OUTPUT_KEY], 0.0);
    }

    /// A file that exists but does not parse is an error, not an empty default.
    /// Every write path starts from `read_at`, so returning `Ok(None)` here is
    /// what would let a save erase someone's hand-written tiers.
    #[test]
    fn an_unparseable_file_is_an_error_not_an_empty_default() {
        let dir = std::env::temp_dir().join(format!("tokscale-gui-broken-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("custom-pricing.json");
        std::fs::write(&path, "{ this is not json").unwrap();

        let err = read_at(&path).expect_err("a broken file must not read as empty");
        assert!(err.contains("did not parse"), "unhelpful message: {err}");

        std::fs::remove_dir_all(&dir).ok();
    }

    /// An absent file is normal, and must read as empty rather than as an error
    /// — otherwise the Pricing view cannot open before the first rate is set.
    #[test]
    fn an_absent_file_reads_as_empty() {
        let path = std::env::temp_dir().join("tokscale-gui-definitely-absent.json");
        std::fs::remove_file(&path).ok();
        assert!(read_at(&path).unwrap().is_none());
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
