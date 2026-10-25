//! Runs a deterministic OCP application with the local `ocp_sdk` Rust SDK and no model
//! provider or credentials. An agent replies to a `message.received` event and requests a refund
//! action, which the policy holds until the designated approver grants it. The output is identical
//! on every run.
//!
//! Run with `cargo run --manifest-path examples/native-rust/Cargo.toml` and test with
//! `cargo test --manifest-path examples/native-rust/Cargo.toml`.

use std::error::Error;
use std::sync::Arc;

use ocp_sdk::{
    message_received, ActionDefinition, ActionInvocation, ActionPolicy, ActionResult, ActorRef,
    ActorType, AgentCard, AgentDefinition, AgentError, ChannelDefinition, ChannelRef, ChannelSink,
    ConversationRef, DeliveryReceipt, EventEnvelope, EventPayload, HandleResult, Hooks,
    MemoryEventStore, OpenChannel, OpenChannelOptions, PolicyDecision,
};

/// Stable OCP identifier of the example agent.
const AGENT_ID: &str = "agent:rust";
/// Display name of the example agent.
const AGENT_NAME: &str = "Native Rust Agent";
/// The only actor allowed to grant a held refund.
const APPROVER_ID: &str = "human:finance";
/// Action type the agent requests and the policy holds for approval.
const REFUND_ACTION: &str = "refund";
/// Provider name of the example channel.
const PROVIDER: &str = "example";

/// The outbound provider for this example. It prints each delivered event instead of calling a
/// real service, so the run needs no credentials.
struct ConsoleSink;

impl ChannelSink for ConsoleSink {
    fn provider(&self) -> &str {
        PROVIDER
    }

    fn send(&mut self, event: &EventEnvelope) -> Result<DeliveryReceipt, AgentError> {
        if let EventPayload::MessageSent(sent) = &event.payload {
            println!("delivered: {} -> {}", event.event_type(), sent.text);
        }
        Ok(DeliveryReceipt {
            provider: PROVIDER.to_owned(),
            event_id: event.event_id.clone(),
            delivered_at: event.occurred_at.clone(),
            external_id: None,
        })
    }
}

/// Holds every refund for a human decision and blocks any other action type. The policy decides;
/// the agent only requests the action.
struct RefundPolicy;

impl ActionPolicy for RefundPolicy {
    fn evaluate(&self, action: &ActionInvocation, _event: &EventEnvelope) -> PolicyDecision {
        if action.action_type == REFUND_ACTION {
            PolicyDecision {
                allowed: true,
                approval_required: true,
                reason: format!("refunds need approval from {APPROVER_ID}"),
            }
        } else {
            PolicyDecision {
                allowed: false,
                approval_required: false,
                reason: format!("no policy allows {}", action.action_type),
            }
        }
    }
}

/// Builds a human `ActorRef` with the given stable id and display name.
fn human(id: &str, display_name: &str) -> ActorRef {
    ActorRef {
        actor_type: ActorType::Human,
        id: id.to_owned(),
        display_name: display_name.to_owned(),
        ..ActorRef::default()
    }
}

/// Returns the example agent as an `ActorRef`, used as the message recipient.
fn agent() -> ActorRef {
    ActorRef::agent(AGENT_ID, AGENT_NAME)
}

/// Builds the application: one agent that replies and requests a refund, the refund action
/// handler, the refund policy, and the designated approver.
fn build_app() -> Result<OpenChannel, AgentError> {
    let responder = AgentDefinition::new(AgentCard::new(AGENT_ID, AGENT_NAME), |context| {
        let text = format!("Deterministic response to: {}", context.message.text);
        context.reply(text);
        context.request(REFUND_ACTION, serde_json::json!({ "amount": 250, "currency": "USD" }));
        Ok(())
    });
    let refund = ActionDefinition::new(REFUND_ACTION, |input, _context| {
        Ok(serde_json::json!({ "status": "refunded", "input": input }))
    });

    OpenChannel::new(OpenChannelOptions {
        agents: vec![responder],
        actions: vec![refund],
        channels: vec![ChannelDefinition {
            provider: PROVIDER.to_owned(),
            source: None,
            sink: Some(Box::new(ConsoleSink)),
        }],
        policy: Box::new(RefundPolicy),
        store: Arc::new(MemoryEventStore::default()),
        approver: Some(human(APPROVER_ID, "Finance Approver")),
        approval_timeout_ms: 60_000,
        concurrency: usize::MAX,
        hooks: Some(Hooks::default()),
        clock: None,
        logger: None,
        runtime_actor: None,
    })
}

/// Ingests one `message.received` addressed to the example agent.
fn ingest_message(app: &OpenChannel, text: &str) -> Result<HandleResult, AgentError> {
    let mut event = message_received(text);
    event.actor = Some(human("human:example", "Example User"));
    event.recipient = Some(agent());
    event.channel = Some(ChannelRef {
        provider: PROVIDER.to_owned(),
        channel_id: "channel:example".to_owned(),
        ..ChannelRef::default()
    });
    event.conversation = Some(ConversationRef {
        id: "conversation:example".to_owned(),
        status: "CONVERSATION_STATUS_OPEN".to_owned(),
        ..ConversationRef::default()
    });
    app.ingest(event)
}

/// Runs the end-to-end demonstration: ingest a message, hold and grant a refund, check the audit
/// trail, and round-trip an approval event through protobuf.
fn main() -> Result<(), Box<dyn Error>> {
    let app = build_app().map_err(|e| Box::new(e) as Box<dyn Error>)?;
    app.start().map_err(|e| Box::new(e) as Box<dyn Error>)?;

    let result = ingest_message(&app, "Explain why OCP keeps policy outside the model prompt.")?;
    println!("handled: {}", result.handled);
    println!("replies: {}", result.replies.len());

    let approval_id = match result.action_results.as_slice() {
        [ActionResult::ApprovalRequired { approval_id, .. }] => approval_id.clone(),
        other => return Err(format!("expected one held refund, got {other:?}").into()),
    };
    println!("action: {REFUND_ACTION} is held until {APPROVER_ID} grants it");

    // Only the designated approver can grant. A different actor is rejected and the refund stays held.
    let intruder = human("human:intruder", "Not the Approver");
    if app.approve(&approval_id, &intruder, "looks fine").is_ok() {
        return Err("a non-designated approver granted the refund".into());
    }
    println!("rejected: grant from a non-designated approver");

    let finance = human(APPROVER_ID, "Finance Approver");
    match app.approve(&approval_id, &finance, "refund within the approved limit")? {
        ActionResult::Executed { result, .. } => println!("granted: {result}"),
        other => return Err(format!("expected the refund to execute, got {other:?}").into()),
    }

    let trail: Vec<String> =
        app.store().events().iter().map(|event| event.event_type().to_owned()).collect();
    println!("audit: {}", trail.join(", "));

    // Approval payloads are real protobuf too: encode, then decode.
    let approval = app
        .store()
        .query_by_type("approval.requested")
        .into_iter()
        .next()
        .ok_or("approval.requested was not recorded")?;
    let decoded = EventEnvelope::from_binary(&approval.to_binary()?)?;
    println!("protobuf: {} round-trips", decoded.event_type());

    app.stop()?;
    Ok(())
}

/// Unit tests for the example's reply and approval behavior.
#[cfg(test)]
mod tests {
    use super::*;

    /// A message gets the deterministic reply, and its refund request is held for approval.
    #[test]
    fn replies_deterministically_and_holds_the_refund() -> Result<(), Box<dyn Error>> {
        let app = build_app()?;
        app.start()?;
        let result = ingest_message(&app, "hello")?;
        assert!(result.handled);
        assert!(matches!(
            &result.replies[0].payload,
            EventPayload::MessageSent(sent) if sent.text == "Deterministic response to: hello"
        ));
        assert!(matches!(
            result.action_results.as_slice(),
            [ActionResult::ApprovalRequired { .. }]
        ));
        app.stop()?;
        Ok(())
    }

    /// The refund runs only after the designated approver grants it; another actor is rejected.
    #[test]
    fn refund_executes_only_after_the_designated_approver_grants() -> Result<(), Box<dyn Error>> {
        let app = build_app()?;
        app.start()?;
        let result = ingest_message(&app, "refund order 42")?;
        let [ActionResult::ApprovalRequired { approval_id, .. }] = result.action_results.as_slice()
        else {
            return Err("expected a held refund".into());
        };

        assert!(app.approve(approval_id, &human("human:intruder", "Intruder"), "ok").is_err());
        let ActionResult::Executed { result, .. } =
            app.approve(approval_id, &human(APPROVER_ID, "Finance Approver"), "ok")?
        else {
            return Err("expected the refund to execute".into());
        };
        assert_eq!(
            result,
            serde_json::json!({
                "status": "refunded",
                "input": { "amount": 250, "currency": "USD" }
            })
        );
        app.stop()?;
        Ok(())
    }
}
