//! Sends Telegram status notifications for workflow and group runs.
//!
//! Provides a `TelegramNotifier` that sends formatted messages via the Bot API.
//! Supports opt-out at the global, group, and per-workflow levels.

use serde::{Deserialize, Serialize};

/// Telegram bot configuration (singleton in the database).
#[derive(Clone, Serialize, Deserialize)]
pub struct TelegramConfig {
    /// Bot API token.
    #[serde(default, skip_serializing)]
    pub bot_token: String,
    /// Target chat ID (can be a group/channel ID).
    pub chat_id: String,
    /// Master toggle for all notifications.
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// Notify when a workflow run starts.
    #[serde(default = "default_true")]
    pub notify_on_start: bool,
    /// Notify when a workflow completes.
    #[serde(default = "default_true")]
    pub notify_on_complete: bool,
    /// Notify on fatal errors.
    #[serde(default = "default_true")]
    pub notify_on_error: bool,
    /// Notify when a blueprint is promoted.
    #[serde(default = "default_true")]
    pub notify_on_promotion: bool,
    /// When this config was last updated.
    pub updated_at: String,
}

impl std::fmt::Debug for TelegramConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("TelegramConfig")
            .field(
                "bot_token",
                &if self.bot_token.is_empty() {
                    ""
                } else {
                    "[redacted]"
                },
            )
            .field("chat_id", &self.chat_id)
            .field("enabled", &self.enabled)
            .field("notify_on_start", &self.notify_on_start)
            .field("notify_on_complete", &self.notify_on_complete)
            .field("notify_on_error", &self.notify_on_error)
            .field("notify_on_promotion", &self.notify_on_promotion)
            .field("updated_at", &self.updated_at)
            .finish()
    }
}

const fn default_true() -> bool {
    true
}

/// Event types for notification logging.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NotificationEvent {
    RunStart,
    RunComplete,
    RunError,
    Promotion,
    GroupStart,
    GroupComplete,
}

impl NotificationEvent {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::RunStart => "run_start",
            Self::RunComplete => "run_complete",
            Self::RunError => "run_error",
            Self::Promotion => "promotion",
            Self::GroupStart => "group_start",
            Self::GroupComplete => "group_complete",
        }
    }
}

/// Log entry for a sent notification.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationLogEntry {
    /// Database row ID.
    pub id: i64,
    /// Event type.
    pub event_type: String,
    /// Target name (blueprint name or group name).
    pub target: String,
    /// FK into experiments (nullable).
    pub experiment_id: Option<i64>,
    /// FK into group_runs (nullable).
    pub group_run_id: Option<String>,
    /// The message that was sent.
    pub message: String,
    /// ISO timestamp when sent.
    pub sent_at: String,
    /// Whether the send succeeded.
    pub success: bool,
}

/// Notification configuration for a specific workflow in a group.
///
/// Used to check whether a particular workflow should trigger notifications.
#[derive(Debug, Clone)]
pub struct NotificationConfig {
    /// Global enabled.
    pub global_enabled: bool,
    /// Group-level enabled.
    pub group_enabled: bool,
    /// Workflow-level enabled.
    pub workflow_notifications_enabled: bool,
    /// Which types of events to send.
    pub notify_on_start: bool,
    pub notify_on_complete: bool,
    pub notify_on_error: bool,
    pub notify_on_promotion: bool,
}

impl NotificationConfig {
    /// Check whether a notification of the given event type should be sent.
    pub fn should_notify(&self, event: NotificationEvent) -> bool {
        if !self.global_enabled || !self.group_enabled || !self.workflow_notifications_enabled {
            return false;
        }
        match event {
            NotificationEvent::RunStart => self.notify_on_start,
            NotificationEvent::RunComplete => self.notify_on_complete,
            NotificationEvent::RunError => self.notify_on_error,
            NotificationEvent::Promotion => self.notify_on_promotion,
            NotificationEvent::GroupStart | NotificationEvent::GroupComplete => true,
        }
    }
}

/// Async Telegram notification sender.
pub struct TelegramNotifier {
    client: reqwest::Client,
    bot_token: String,
    chat_id: String,
}

impl TelegramNotifier {
    /// Create a new notifier from config.
    pub fn new(config: &TelegramConfig) -> Self {
        Self {
            client: notification_client(),
            bot_token: config.bot_token.clone(),
            chat_id: config.chat_id.clone(),
        }
    }

    /// Create a disabled notifier (no-op).
    pub fn disabled() -> Self {
        Self {
            client: reqwest::Client::new(),
            bot_token: String::new(),
            chat_id: String::new(),
        }
    }

    /// Returns true if this notifier can actually send messages.
    pub fn is_enabled(&self) -> bool {
        !self.bot_token.is_empty() && !self.chat_id.is_empty()
    }

    /// Send a plain text message.
    pub async fn send_message(&self, text: &str) -> Result<bool, String> {
        if !self.is_enabled() {
            return Ok(false);
        }

        let url = format!("https://api.telegram.org/bot{}/sendMessage", self.bot_token);
        let payload = serde_json::json!({
            "chat_id": self.chat_id,
            "text": text,
            "parse_mode": "HTML",
            "disable_web_page_preview": true,
        });

        match self.client.post(&url).json(&payload).send().await {
            Ok(resp) => {
                if resp.status().is_success() {
                    Ok(true)
                } else {
                    Err(format!("Telegram API returned HTTP {}", resp.status()))
                }
            }
            Err(e) => Err(format!("Telegram request failed: {}", e.without_url())),
        }
    }

    // ---- High-level notification methods ----

    /// Notify that a blueprint run has started.
    pub async fn notify_run_start(
        &self,
        blueprint_name: &str,
        iteration: u64,
        max_iterations: u64,
    ) -> Result<bool, String> {
        // Local paths stay on this machine.
        let msg = format!(
            "\u{1F916} <b>Starting: {}</b>\n\
             Iteration {}/{}\n\
             Started: {}",
            escape_html(blueprint_name),
            iteration,
            max_iterations,
            chrono::Utc::now().format("%Y-%m-%d %H:%M"),
        );
        self.send_message(&msg).await
    }

    /// Notify that a blueprint has been promoted.
    pub async fn notify_promotion(
        &self,
        blueprint_name: &str,
        score: f64,
        duration_ms: u64,
        branch: &str,
        iteration: u64,
    ) -> Result<bool, String> {
        let duration_secs = duration_ms as f64 / 1000.0;
        let msg = format!(
            "\u{2705} <b>PROMOTED: {}</b>\n\
             Score: {:.3} | Duration: {:.1}s\n\
             Branch: {}\n\
             Iteration: {}",
            escape_html(blueprint_name),
            score,
            duration_secs,
            escape_html(branch),
            iteration,
        );
        self.send_message(&msg).await
    }

    /// Notify that a blueprint run completed without promotion.
    pub async fn notify_run_complete(
        &self,
        blueprint_name: &str,
        score: f64,
        duration_ms: u64,
        iteration: u64,
        reason: &str,
    ) -> Result<bool, String> {
        let duration_secs = duration_ms as f64 / 1000.0;
        let icon = if reason == "promoted" {
            "\u{2705}"
        } else {
            "\u{274C}"
        };
        let msg = format!(
            "{} <b>{}: {}</b>\n\
             Score: {:.3} | Duration: {:.1}s\n\
             Iteration: {} | Reason: {}",
            icon,
            if reason == "promoted" {
                "PROMOTED"
            } else {
                "COMPLETED"
            },
            escape_html(blueprint_name),
            score,
            duration_secs,
            iteration,
            escape_html(reason),
        );
        self.send_message(&msg).await
    }

    /// Notify that a blueprint run encountered a fatal error.
    pub async fn notify_run_error(
        &self,
        blueprint_name: &str,
        error: &str,
        iteration: u64,
    ) -> Result<bool, String> {
        let msg = format!(
            "\u{26A0}\u{FE0F} <b>ERROR: {}</b>\n\
             {}\n\
             Run aborted after {} iteration(s)",
            escape_html(blueprint_name),
            escape_html(error),
            iteration,
        );
        self.send_message(&msg).await
    }

    /// Notify that a group run has started.
    pub async fn notify_group_start(
        &self,
        group_name: &str,
        mode: &str,
        workflow_names: &[&str],
    ) -> Result<bool, String> {
        let workflows = workflow_names
            .iter()
            .enumerate()
            .map(|(i, name)| format!("{}.\u{2009}{}", i + 1, escape_html(name)))
            .collect::<Vec<_>>()
            .join("    ");
        let msg = format!(
            "\u{1F680} <b>Group run started: {}</b>\n\
             Mode: {} | Workflows: {}\n\
             {}",
            escape_html(group_name),
            escape_html(mode),
            workflow_names.len(),
            workflows,
        );
        self.send_message(&msg).await
    }

    /// Notify that a group run has completed.
    pub async fn notify_group_complete(
        &self,
        group_name: &str,
        promoted: u32,
        rejected: u32,
        errors: u32,
        duration_secs: f64,
    ) -> Result<bool, String> {
        let msg = format!(
            "\u{1F3C1} <b>Group run COMPLETED: {}</b>\n\
             \u{2705} {} promoted | \u{274C} {} not promoted | \u{26A0}\u{FE0F} {} errors\n\
             Duration: {:.1}s",
            escape_html(group_name),
            promoted,
            rejected,
            errors,
            duration_secs,
        );
        self.send_message(&msg).await
    }
}

/// Escape text for Telegram's HTML parse mode.
pub fn escape_html(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for ch in text.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            _ => out.push(ch),
        }
    }
    out
}

/// A client that gives up quickly, so a stalled Telegram request never
/// holds up a workflow run.
fn notification_client() -> reqwest::Client {
    reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(5))
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

/// Notification log entry for database persistence.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistedNotificationLog {
    pub id: i64,
    pub event_type: String,
    pub target: String,
    pub experiment_id: Option<i64>,
    pub group_run_id: Option<String>,
    pub message: String,
    pub sent_at: String,
    pub success: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn notification_config_should_notify() {
        let config = NotificationConfig {
            global_enabled: true,
            group_enabled: true,
            workflow_notifications_enabled: true,
            notify_on_start: true,
            notify_on_complete: true,
            notify_on_error: true,
            notify_on_promotion: true,
        };
        assert!(config.should_notify(NotificationEvent::RunStart));
        assert!(config.should_notify(NotificationEvent::RunComplete));
        assert!(config.should_notify(NotificationEvent::RunError));
        assert!(config.should_notify(NotificationEvent::Promotion));
    }

    #[test]
    fn notification_config_respects_global_toggle() {
        let config = NotificationConfig {
            global_enabled: false,
            group_enabled: true,
            workflow_notifications_enabled: true,
            notify_on_start: true,
            notify_on_complete: true,
            notify_on_error: true,
            notify_on_promotion: true,
        };
        assert!(!config.should_notify(NotificationEvent::RunStart));
        assert!(!config.should_notify(NotificationEvent::RunComplete));
    }

    #[test]
    fn notification_config_respects_group_toggle() {
        let config = NotificationConfig {
            global_enabled: true,
            group_enabled: false,
            workflow_notifications_enabled: true,
            notify_on_start: true,
            notify_on_complete: true,
            notify_on_error: true,
            notify_on_promotion: true,
        };
        assert!(!config.should_notify(NotificationEvent::RunStart));
    }

    #[test]
    fn notification_config_respects_workflow_toggle() {
        let config = NotificationConfig {
            global_enabled: true,
            group_enabled: true,
            workflow_notifications_enabled: false,
            notify_on_start: true,
            notify_on_complete: true,
            notify_on_error: true,
            notify_on_promotion: true,
        };
        assert!(!config.should_notify(NotificationEvent::RunStart));
        assert!(!config.should_notify(NotificationEvent::RunComplete));
    }

    #[test]
    fn debug_output_redacts_the_token() {
        let config = TelegramConfig {
            bot_token: "123:synthetic-secret".into(),
            chat_id: "42".into(),
            enabled: true,
            notify_on_start: true,
            notify_on_complete: true,
            notify_on_error: true,
            notify_on_promotion: true,
            updated_at: String::new(),
        };
        let debug = format!("{config:?}");
        assert!(!debug.contains("synthetic-secret"));
        assert!(debug.contains("[redacted]"));
    }

    #[test]
    fn escape_html_neutralises_markup() {
        assert_eq!(escape_html("a<b>&\"c\""), "a&lt;b&gt;&amp;&quot;c&quot;");
    }

    #[test]
    fn notification_event_as_str() {
        assert_eq!(NotificationEvent::RunStart.as_str(), "run_start");
        assert_eq!(NotificationEvent::RunComplete.as_str(), "run_complete");
        assert_eq!(NotificationEvent::RunError.as_str(), "run_error");
        assert_eq!(NotificationEvent::Promotion.as_str(), "promotion");
        assert_eq!(NotificationEvent::GroupStart.as_str(), "group_start");
        assert_eq!(NotificationEvent::GroupComplete.as_str(), "group_complete");
    }

    #[test]
    fn telegram_notifier_disabled_is_noop() {
        let notifier = TelegramNotifier::disabled();
        assert!(!notifier.is_enabled());
    }

    #[test]
    fn telegram_config_serialization() {
        let config = TelegramConfig {
            bot_token: "123:abc".to_owned(),
            chat_id: "-100123456789".to_owned(),
            enabled: true,
            notify_on_start: true,
            notify_on_complete: true,
            notify_on_error: true,
            notify_on_promotion: true,
            updated_at: "2026-05-10T00:00:00Z".to_owned(),
        };
        let json = serde_json::to_string(&config).unwrap();
        let deserialized: TelegramConfig = serde_json::from_str(&json).unwrap();
        assert!(deserialized.bot_token.is_empty());
        assert!(!json.contains("123:abc"));
        assert_eq!(deserialized.chat_id, "-100123456789");
        assert!(deserialized.enabled);
    }
}
