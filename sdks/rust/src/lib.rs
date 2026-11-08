//! OpenChannel Protocol (OCP) for Rust: one event envelope, one protocol version
//! ([`PROTOCOL_VERSION`]), and an application facade, [`OpenChannel`], built with [`OpenChannel::new`].

pub mod generated;

mod app;
mod binary;
mod events;
mod models;
mod payloads;

pub use app::{
    Callback, Clock, EventStore, Hooks, ManualClock, MemoryEventStore, OpenChannel,
    OpenChannelOptions, SystemClock,
};
pub use events::{
    action_executed, action_failed, approval_decided, approval_expired, approval_requested,
    escalation_triggered, handoff_completed, handoff_initiated, message_received, message_sent,
    policy_evaluated, task_assigned, task_created, EventEnvelope, EventError, EventPayload,
    PROTOCOL_VERSION,
};
pub use models::{
    to_tool_failure, ActionDefinition, ActionError, ActionExecutionContext, ActionInvocation,
    ActionPolicy, ActionResult, ActorRef, ActorType, AgentCapabilities, AgentCard, AgentContext,
    AgentDefinition, AgentError, AgentHost, AgentSkill, ArtifactRef, ChannelDefinition, ChannelRef,
    ChannelSink, ChannelSource, ConversationRef, DeliveryReceipt, HandleResult, JsonObject, Logger,
    MessageReceived, MessageSent, PolicyDecision, ReceiveMetadata, StderrLogger,
};
pub use payloads::{
    ActionExecuted, ActionFailed, ApprovalDecided, ApprovalExpired, ApprovalOutcome,
    ApprovalRequested, EscalationTriggered, HandoffCompleted, HandoffInitiated, PolicyEvaluated,
    TaskAssigned, TaskCreated,
};
