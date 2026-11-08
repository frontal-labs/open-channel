use std::collections::BTreeMap;
use std::ops::Deref;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use thiserror::Error;
use uuid::Uuid;

use crate::events::{self, EventEnvelope};

/// Metadata a provider attaches to raw input passed to [`OpenChannel::receive`](crate::OpenChannel::receive).
pub type ReceiveMetadata = BTreeMap<String, String>;

pub type JsonObject = BTreeMap<String, serde_json::Value>;

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
pub enum ActorType {
    #[serde(rename = "ACTOR_TYPE_UNSPECIFIED")]
    Unspecified,
    #[serde(rename = "ACTOR_TYPE_HUMAN")]
    Human,
    #[serde(rename = "ACTOR_TYPE_AGENT")]
    #[default]
    Agent,
    #[serde(rename = "ACTOR_TYPE_SYSTEM")]
    System,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ActorRef {
    pub id: String,
    #[serde(rename = "type")]
    pub actor_type: ActorType,
    pub display_name: String,
    pub authority: String,
    pub capabilities: Vec<String>,
}

impl ActorRef {
    pub fn agent(id: impl Into<String>, display_name: impl Into<String>) -> Self {
        Self {
            actor_type: ActorType::Agent,
            display_name: display_name.into(),
            id: id.into(),
            ..Self::default()
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChannelRef {
    pub provider: String,
    pub channel_id: String,
    pub thread_id: String,
    pub address: String,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConversationRef {
    pub id: String,
    pub status: String,
    pub participants: Vec<ActorRef>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentCapabilities {
    pub push_notifications: bool,
    pub state_transition_history: bool,
    pub streaming: bool,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
pub struct AgentSkill {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub description: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub examples: Vec<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentCard {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub description: String,
    pub version: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub url: String,
    pub capabilities: AgentCapabilities,
    pub skills: Vec<AgentSkill>,
}

impl AgentCard {
    /// A card for `id`, versioned with the SDK release.
    pub fn new(id: impl Into<String>, name: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            version: env!("CARGO_PKG_VERSION").to_owned(),
            ..Self::default()
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactRef {
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub id: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub uri: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub title: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub media_type: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub source_of_truth: String,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MessageReceived {
    pub text: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub attachments: Vec<ArtifactRef>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub metadata: BTreeMap<String, String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MessageSent {
    pub text: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub attachments: Vec<ArtifactRef>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub metadata: BTreeMap<String, String>,
}

/// An action request. On the wire this is `ActionRequest`: `action_type` is `type`, and `input`
/// travels as a JSON string under `parameters["input"]`, matching the TypeScript SDK.
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(try_from = "ActionRequestJson", into = "ActionRequestJson")]
pub struct ActionInvocation {
    pub action_id: String,
    pub input: serde_json::Value,
    pub action_type: String,
    /// `ActionRequest.target`; empty when unset.
    pub target: String,
    /// Parameters other than `input`. The `input` key is reserved: it is always written from
    /// [`ActionInvocation::input`] and is never read from this map.
    pub parameters: BTreeMap<String, String>,
}

/// ProtoJSON shape of `ocp.types.ActionRequest`.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ActionRequestJson {
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub(crate) action_id: String,
    #[serde(default, rename = "type", skip_serializing_if = "String::is_empty")]
    pub(crate) action_type: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub(crate) target: String,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub(crate) parameters: BTreeMap<String, String>,
}

impl From<ActionInvocation> for ActionRequestJson {
    fn from(action: ActionInvocation) -> Self {
        let mut parameters = action.parameters;
        let input = serde_json::to_string(&action.input).unwrap_or_else(|_| "null".to_owned());
        parameters.insert("input".to_owned(), input);
        Self {
            action_id: action.action_id,
            action_type: action.action_type,
            target: action.target,
            parameters,
        }
    }
}

impl TryFrom<ActionRequestJson> for ActionInvocation {
    type Error = String;

    fn try_from(json: ActionRequestJson) -> Result<Self, Self::Error> {
        let mut parameters = json.parameters;
        let input = match parameters.remove("input") {
            Some(text) => serde_json::from_str(&text)
                .map_err(|error| format!("action input is not valid JSON: {error}"))?,
            None => serde_json::Value::Null,
        };
        Ok(Self {
            action_id: json.action_id,
            input,
            action_type: json.action_type,
            target: json.target,
            parameters,
        })
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", tag = "status")]
pub enum ActionResult {
    Blocked { action_id: String, reason: String },
    ApprovalRequired { action_id: String, approval_id: String },
    Executed { action_id: String, result: serde_json::Value },
    Failed { action_id: String, error: ActionError },
}

impl ActionResult {
    pub(crate) fn action_id(&self) -> &str {
        match self {
            Self::Blocked { action_id, .. }
            | Self::ApprovalRequired { action_id, .. }
            | Self::Executed { action_id, .. }
            | Self::Failed { action_id, .. } => action_id,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct ActionError {
    pub code: String,
    pub message: String,
    pub action_id: String,
    pub retryable: bool,
}

impl ActionError {
    pub(crate) fn from_agent_error(action_id: impl Into<String>, error: &AgentError) -> Self {
        Self {
            code: "OCP_ACTION".to_owned(),
            message: error.to_string(),
            action_id: action_id.into(),
            retryable: false,
        }
    }
}

/// The tool result an agent receives for a failed action. It contains only `success`, the scope,
/// the code and fixed public text. The developer message is never included.
pub fn to_tool_failure(error: &ActionError) -> Value {
    json!({
        "success": false,
        "error": {
            "scope": "ocp",
            "code": error.code,
            "message": channel_text(&error.code),
        },
    })
}

/// Fixed public text per code. Matches the TypeScript and Python SDKs.
fn channel_text(code: &str) -> &'static str {
    match code {
        "OCP_ACTION" => "The action couldn't be completed.",
        "OCP_AUTHORIZATION" => "You're not allowed to do that.",
        "OCP_TRANSPORT" => "The message couldn't be delivered.",
        _ => "Something went wrong.",
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
pub struct PolicyDecision {
    pub allowed: bool,
    pub approval_required: bool,
    pub reason: String,
}

pub trait ActionPolicy: Send + Sync {
    fn evaluate(&self, action: &ActionInvocation, event: &EventEnvelope) -> PolicyDecision;
}

pub struct ActionExecutionContext<'a> {
    pub actor: &'a ActorRef,
    pub event: &'a EventEnvelope,
}

impl<'a> Deref for ActionExecutionContext<'a> {
    type Target = EventEnvelope;

    fn deref(&self) -> &Self::Target {
        self.event
    }
}

type ActionValidator =
    dyn Fn(&serde_json::Value) -> Result<serde_json::Value, AgentError> + Send + Sync;
type ActionHandler = dyn for<'a> Fn(
        &serde_json::Value,
        &ActionExecutionContext<'a>,
    ) -> Result<serde_json::Value, AgentError>
    + Send
    + Sync;

/// A typed, policy-controlled action. Build one with [`ActionDefinition::new`].
pub struct ActionDefinition {
    pub action_type: String,
    pub(crate) validator: Box<ActionValidator>,
    pub(crate) handler: Box<ActionHandler>,
}

impl ActionDefinition {
    pub fn new<F>(action_type: impl Into<String>, handler: F) -> Self
    where
        F: for<'a> Fn(
                &serde_json::Value,
                &ActionExecutionContext<'a>,
            ) -> Result<serde_json::Value, AgentError>
            + Send
            + Sync
            + 'static,
    {
        Self {
            action_type: action_type.into(),
            handler: Box::new(handler),
            validator: Box::new(|value| Ok(value.clone())),
        }
    }

    /// Checks and normalizes the input before the handler runs.
    pub fn with_validator<F>(mut self, validator: F) -> Self
    where
        F: Fn(&serde_json::Value) -> Result<serde_json::Value, AgentError> + Send + Sync + 'static,
    {
        self.validator = Box::new(validator);
        self
    }
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum AgentError {
    #[error("OCP agent is already registered: {0}")]
    DuplicateAgent(String),
    #[error("OCP action is not registered: {0}")]
    UnknownAction(String),
    #[error("OCP agent is not registered: {0}")]
    UnknownAgent(String),
    #[error("OCP provider is not registered: {0}")]
    UnknownProvider(String),
    #[error("OCP handler failed: {0}")]
    Handler(String),
    #[error("OCP action failed: {0}")]
    Action(String),
}

type AgentHandler = dyn for<'a> Fn(&mut AgentContext<'a>) -> Result<(), AgentError> + Send + Sync;

/// An agent: its card, the capabilities its actor advertises, and the message handler.
pub struct AgentDefinition {
    pub card: AgentCard,
    pub actor_capabilities: Vec<String>,
    handler: Box<AgentHandler>,
}

impl AgentDefinition {
    pub fn new<F>(card: AgentCard, handler: F) -> Self
    where
        F: for<'a> Fn(&mut AgentContext<'a>) -> Result<(), AgentError> + Send + Sync + 'static,
    {
        Self { actor_capabilities: Vec::new(), card, handler: Box::new(handler) }
    }
}

/// What an agent sees while handling one `message.received` event.
pub struct AgentContext<'a> {
    /// The agent handling the message.
    pub agent: ActorRef,
    /// The inbound message.
    pub message: &'a MessageReceived,
    /// The inbound event envelope.
    pub event: &'a EventEnvelope,
    /// Conversation of the inbound event, when it has one.
    pub conversation: Option<&'a ConversationRef>,
    /// Channel of the inbound event, when it has one.
    pub channel: Option<&'a ChannelRef>,
    logger: &'a dyn Logger,
    actions: Vec<ActionInvocation>,
    replies: Vec<EventEnvelope>,
}

impl AgentContext<'_> {
    /// The logger configured on the application.
    pub fn logger(&self) -> &dyn Logger {
        self.logger
    }

    /// Queues a `message.sent` reply on the inbound event's channel and conversation.
    pub fn reply(&mut self, text: impl Into<String>) -> &EventEnvelope {
        let mut reply = events::message_sent(text);
        reply.actor = Some(self.agent.clone());
        reply.source = Some(self.agent.clone());
        reply.recipient = self.event.actor.clone();
        reply.causation_id = self.event.event_id.clone();
        reply.correlation_id = if self.event.correlation_id.is_empty() {
            self.event.event_id.clone()
        } else {
            self.event.correlation_id.clone()
        };
        reply.channel = self.event.channel.clone();
        reply.conversation = self.event.conversation.clone();
        self.replies.push(reply);
        // The reply was pushed on the line above, so the last element exists.
        self.replies.last().expect("reply was just pushed")
    }

    /// Requests an action. Policy decides whether it runs, is blocked, or needs approval.
    /// Returns the action ID.
    pub fn request(&mut self, action_type: impl Into<String>, input: serde_json::Value) -> String {
        let action_id = format!("action:{}", Uuid::new_v4());
        self.actions.push(ActionInvocation {
            action_id: action_id.clone(),
            input,
            action_type: action_type.into(),
            ..ActionInvocation::default()
        });
        action_id
    }

    fn finish(self) -> (Vec<EventEnvelope>, Vec<ActionInvocation>) {
        (self.replies, self.actions)
    }
}

/// The outcome of handling one event.
#[derive(Debug, Default)]
pub struct HandleResult {
    pub handled: bool,
    pub action_results: Vec<ActionResult>,
    pub actions: Vec<ActionInvocation>,
    pub replies: Vec<EventEnvelope>,
}

struct Registered {
    definition: AgentDefinition,
    /// The agent as an actor, built once at registration instead of per event.
    actor: ActorRef,
}

/// Routes `message.received` events to registered agents.
#[derive(Default)]
pub struct AgentHost {
    agents: BTreeMap<String, Registered>,
}

impl AgentHost {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&mut self, agent: AgentDefinition) -> Result<&mut Self, AgentError> {
        if self.agents.contains_key(&agent.card.id) {
            return Err(AgentError::DuplicateAgent(agent.card.id.clone()));
        }
        let actor = ActorRef {
            capabilities: agent.actor_capabilities.clone(),
            ..ActorRef::agent(&agent.card.id, &agent.card.name)
        };
        self.agents.insert(agent.card.id.clone(), Registered { definition: agent, actor });
        Ok(self)
    }

    pub fn unregister(&mut self, agent_id: &str) -> bool {
        self.agents.remove(agent_id).is_some()
    }

    pub fn agent_card(&self, agent_id: &str) -> Option<&AgentCard> {
        self.agents.get(agent_id).map(|agent| &agent.definition.card)
    }

    pub fn agent_cards(&self) -> Vec<&AgentCard> {
        self.agents.values().map(|agent| &agent.definition.card).collect()
    }

    /// Runs the addressed agent's handler for a `message.received` event. Other events are
    /// ignored.
    pub fn handle(
        &self,
        event: &EventEnvelope,
        logger: &dyn Logger,
    ) -> Result<HandleResult, AgentError> {
        let Some(message) = event.as_message_received() else {
            return Ok(HandleResult::default());
        };
        let agent_id =
            event.recipient.as_ref().map(|recipient| recipient.id.as_str()).unwrap_or_default();
        let registered = self
            .agents
            .get(agent_id)
            .ok_or_else(|| AgentError::UnknownAgent(agent_id.to_owned()))?;
        let mut context = AgentContext {
            agent: registered.actor.clone(),
            message,
            event,
            conversation: event.conversation.as_ref(),
            channel: event.channel.as_ref(),
            logger,
            actions: Vec::new(),
            replies: Vec::new(),
        };
        (registered.definition.handler)(&mut context)?;
        let (replies, actions) = context.finish();
        Ok(HandleResult { action_results: Vec::new(), actions, handled: true, replies })
    }
}

/// An inbound provider: turns raw provider input into OCP events.
pub trait ChannelSource: Send {
    fn provider(&self) -> &str;
    fn normalize(
        &self,
        input: serde_json::Value,
        metadata: &ReceiveMetadata,
    ) -> Result<Vec<EventEnvelope>, AgentError>;

    fn start(&mut self) -> Result<(), AgentError> {
        Ok(())
    }

    fn stop(&mut self) -> Result<(), AgentError> {
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct DeliveryReceipt {
    pub provider: String,
    pub event_id: String,
    pub delivered_at: String,
    pub external_id: Option<String>,
}

/// An outbound provider: delivers OCP events to the outside world.
pub trait ChannelSink: Send {
    fn provider(&self) -> &str;
    fn send(&mut self, event: &EventEnvelope) -> Result<DeliveryReceipt, AgentError>;

    fn close(&mut self) -> Result<(), AgentError> {
        Ok(())
    }
}

/// A provider registration: an optional inbound source and an optional outbound sink.
pub struct ChannelDefinition {
    pub provider: String,
    pub source: Option<Box<dyn ChannelSource>>,
    pub sink: Option<Box<dyn ChannelSink>>,
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;
    use crate::events::EventPayload;

    fn inbound_message(text: &str) -> EventEnvelope {
        let mut event = events::message_received(text);
        event.actor = Some(ActorRef {
            actor_type: ActorType::Human,
            id: "human:gabriel".to_owned(),
            ..ActorRef::default()
        });
        event.recipient = Some(ActorRef::agent("agent:support", "Support"));
        event.channel = Some(ChannelRef { provider: "slack".to_owned(), ..ChannelRef::default() });
        event
    }

    #[test]
    fn routes_a_message_and_replies_on_the_same_channel() {
        let mut host = AgentHost::new();
        host.register(AgentDefinition::new(
            AgentCard::new("agent:support", "Support"),
            |context| {
                let text = format!("Received: {}", context.message.text);
                context.reply(text);
                Ok(())
            },
        ))
        .expect("agent registers");

        let event = inbound_message("Can you help?");
        let result = host.handle(&event, &StderrLogger).expect("event is handled");

        assert!(result.handled);
        assert_eq!(result.replies.len(), 1);
        let reply = &result.replies[0];
        assert_eq!(reply.event_type(), "message.sent");
        assert_eq!(reply.causation_id, event.event_id);
        assert_eq!(reply.channel.as_ref().map(|channel| channel.provider.as_str()), Some("slack"));
        assert!(matches!(
            reply.payload,
            EventPayload::MessageSent(MessageSent { ref text, .. }) if text == "Received: Can you help?"
        ));
    }

    #[test]
    fn ignores_non_message_events_and_rejects_unknown_agents() {
        let host = AgentHost::new();
        let mut event = inbound_message("hi");
        event.payload = EventPayload::ApprovalExpired(crate::payloads::ApprovalExpired {
            approval_id: "approval:1".to_owned(),
            reason: "timed out".to_owned(),
        });
        assert!(!host.handle(&event, &StderrLogger).expect("ignored").handled);

        let unknown = inbound_message("hi");
        assert!(matches!(host.handle(&unknown, &StderrLogger), Err(AgentError::UnknownAgent(_))));
    }

    #[test]
    fn exposes_agent_cards() {
        let mut host = AgentHost::new();
        host.register(AgentDefinition::new(AgentCard::new("agent:triage", "Triage"), |_| Ok(())))
            .expect("agent registers");
        assert_eq!(host.agent_cards()[0].name, "Triage");
        assert_eq!(host.agent_cards()[0].version, env!("CARGO_PKG_VERSION"));
    }
}

/// Structured logging for applications and agents. `debug` and `info` are for tracing; `warn`
/// and `error` report problems.
pub trait Logger: Send + Sync {
    fn debug(&self, message: &str);
    fn info(&self, message: &str);
    fn warn(&self, message: &str);
    fn error(&self, message: &str);
}

/// The default logger: `warn` and `error` go to stderr, `debug` and `info` are silent.
#[derive(Clone, Copy, Debug, Default)]
pub struct StderrLogger;

impl Logger for StderrLogger {
    fn debug(&self, _message: &str) {}

    fn info(&self, _message: &str) {}

    fn warn(&self, message: &str) {
        eprintln!("[open-channel warn] {message}");
    }

    fn error(&self, message: &str) {
        eprintln!("[open-channel error] {message}");
    }
}

#[cfg(test)]
mod tool_failure_tests {
    use super::*;

    fn failure(code: &str, message: &str) -> ActionError {
        ActionError {
            code: code.to_owned(),
            message: message.to_owned(),
            action_id: "action:1".to_owned(),
            retryable: false,
        }
    }

    #[test]
    fn tool_failure_has_only_scope_code_and_fixed_text() {
        let value = to_tool_failure(&failure("OCP_AUTHORIZATION", "rule secret-7 blocks send"));

        assert_eq!(
            value,
            json!({
                "success": false,
                "error": {
                    "scope": "ocp",
                    "code": "OCP_AUTHORIZATION",
                    "message": "You're not allowed to do that.",
                },
            })
        );
        assert!(!value.to_string().contains("secret-7"));
    }

    #[test]
    fn unknown_codes_get_the_generic_text() {
        let value = to_tool_failure(&failure("OCP_VALIDATION", "agent:hidden-42 is invalid"));

        assert_eq!(value["error"]["message"], "Something went wrong.");
        assert!(!value.to_string().contains("hidden-42"));
    }
}
