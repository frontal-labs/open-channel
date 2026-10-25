//! Cross-language parity: decodes the TypeScript-produced fixture, checks the derived event name,
//! and re-encodes to byte-identical protobuf.

use std::fs;
use std::path::PathBuf;

use ocp_sdk::{EventEnvelope, EventPayload};
use serde_json::Value;

const FIXTURE: &str = "../../packages/protocol/tests/fixtures/event-parity.json";

/// Standard base64 (RFC 4648, with padding) decoder for the fixture's `binary` field.
fn base64_decode(input: &str) -> Vec<u8> {
    fn sextet(byte: u8) -> u32 {
        match byte {
            b'A'..=b'Z' => u32::from(byte - b'A'),
            b'a'..=b'z' => u32::from(byte - b'a') + 26,
            b'0'..=b'9' => u32::from(byte - b'0') + 52,
            b'+' => 62,
            b'/' => 63,
            other => panic!("invalid base64 byte {other:#x}"),
        }
    }
    let mut output = Vec::with_capacity(input.len() / 4 * 3);
    let bytes: Vec<u8> = input.bytes().filter(|byte| *byte != b'=').collect();
    for chunk in bytes.chunks(4) {
        let mut value = 0u32;
        for (index, byte) in chunk.iter().enumerate() {
            value |= sextet(*byte) << (18 - 6 * index);
        }
        let count = chunk.len() - 1;
        for index in 0..count {
            output.push((value >> (16 - 8 * index)) as u8);
        }
    }
    output
}

fn load_fixture() -> Vec<Value> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(FIXTURE);
    let text = fs::read_to_string(&path).expect("read parity fixture");
    serde_json::from_str(&text).expect("fixture is a JSON array")
}

#[test]
fn every_fixture_entry_decodes_by_type_and_re_encodes_identically() {
    let entries = load_fixture();
    assert!(!entries.is_empty(), "fixture has entries");

    let mut failures = Vec::new();
    for entry in &entries {
        let name = entry["name"].as_str().expect("name");
        let expected_type = entry["eventType"].as_str().expect("eventType");
        let original = base64_decode(entry["binary"].as_str().expect("binary"));

        let event = match EventEnvelope::from_binary(&original) {
            Ok(event) => event,
            Err(error) => {
                failures.push(format!("{name}: decode failed: {error}"));
                continue;
            }
        };
        if event.event_type() != expected_type {
            failures.push(format!(
                "{name}: derived {} but fixture says {expected_type}",
                event.event_type()
            ));
        }
        match event.to_binary() {
            Ok(bytes) if bytes == original => {}
            Ok(bytes) => failures.push(format!(
                "{name}: re-encoded {} bytes differ from fixture {} bytes",
                bytes.len(),
                original.len()
            )),
            Err(error) => failures.push(format!("{name}: re-encode failed: {error}")),
        }
    }
    assert!(failures.is_empty(), "{} entries failed:\n{}", failures.len(), failures.join("\n"));
}

#[test]
fn fixture_action_input_is_parsed_back_from_parameters() {
    let entries = load_fixture();
    let entry = entries
        .iter()
        .find(|entry| entry["eventType"] == "action.executed")
        .expect("fixture has an action.executed entry");
    let event =
        EventEnvelope::from_binary(&base64_decode(entry["binary"].as_str().expect("binary")))
            .expect("decodes");
    let EventPayload::ActionExecuted(payload) = event.payload else {
        panic!("expected action.executed");
    };
    let action = payload.action.expect("action present");
    assert_eq!(action.input, serde_json::json!({ "value": 2 }));
    assert_eq!(action.action_type, "customer.reply");
    assert_eq!(action.target, "customer:1");
    assert_eq!(payload.result, r#"{"ok":true}"#);
}
