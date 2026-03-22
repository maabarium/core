use eframe::egui::{
    self, Align, CentralPanel, Color32, CornerRadius, FontId, Frame, Grid, Layout, Margin,
    RichText, Sense, Shape, SidePanel, Stroke, TopBottomPanel, Ui, Vec2, vec2,
};
use maabarium_core::{BlueprintFile, PersistedProposal, Persistence, default_db_path, default_log_path, read_recent_log_lines};
use maabarium_core::git_manager::{FilePatch, FilePatchOperation};
use maabarium_core::persistence::PersistedExperiment;
use std::path::PathBuf;
use std::process::Command;

const INDIGO: Color32 = Color32::from_rgb(99, 102, 241);
const EMERALD: Color32 = Color32::from_rgb(16, 185, 129);
const ROSE: Color32 = Color32::from_rgb(244, 63, 94);
const AMBER: Color32 = Color32::from_rgb(245, 158, 11);
const PANEL_FILL: Color32 = Color32::from_rgb(11, 18, 32);
const PANEL_STROKE: Color32 = Color32::from_rgb(30, 41, 59);
const TEXT_MUTED: Color32 = Color32::from_rgb(148, 163, 184);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ConsoleLayoutMode {
    Wide,
    Medium,
    Narrow,
}

fn main() -> eframe::Result<()> {
    let native_options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_inner_size([1440.0, 940.0])
            .with_min_inner_size([1200.0, 820.0]),
        ..Default::default()
    };

    eframe::run_native(
        "Maabarium Console",
        native_options,
        Box::new(|cc| {
            configure_theme(&cc.egui_ctx);
            Ok(Box::new(MaabariumConsoleApp::new()))
        }),
    )
}

fn configure_theme(ctx: &egui::Context) {
    let mut visuals = egui::Visuals::dark();
    visuals.override_text_color = Some(Color32::from_rgb(226, 232, 240));
    visuals.panel_fill = Color32::from_rgb(5, 6, 8);
    visuals.widgets.noninteractive.bg_fill = PANEL_FILL;
    visuals.widgets.noninteractive.bg_stroke = Stroke::new(1.0, PANEL_STROKE);
    visuals.widgets.inactive.bg_fill = Color32::from_rgb(15, 23, 42);
    visuals.widgets.inactive.bg_stroke = Stroke::new(1.0, PANEL_STROKE);
    visuals.widgets.hovered.bg_fill = Color32::from_rgb(30, 41, 59);
    visuals.widgets.hovered.bg_stroke = Stroke::new(1.0, INDIGO);
    visuals.widgets.active.bg_fill = Color32::from_rgb(49, 46, 129);
    visuals.widgets.active.bg_stroke = Stroke::new(1.0, INDIGO);
    visuals.window_corner_radius = CornerRadius::same(18);
    ctx.set_visuals(visuals);
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ConsoleTab {
    History,
    DiffView,
    Logs,
}

impl ConsoleTab {
    fn label(self) -> &'static str {
        match self {
            Self::History => "History",
            Self::DiffView => "Diff View",
            Self::Logs => "Logs",
        }
    }
}

fn console_layout_mode(width: f32) -> ConsoleLayoutMode {
    if width < 920.0 {
        ConsoleLayoutMode::Narrow
    } else if width < 1320.0 {
        ConsoleLayoutMode::Medium
    } else {
        ConsoleLayoutMode::Wide
    }
}

struct StatCard {
    label: &'static str,
    value: String,
    trend: String,
    color: Color32,
    sparkline: Vec<f32>,
}

struct HistoryEntry {
    experiment_id: i64,
    score: f32,
    delta: f32,
    summary: String,
    promoted: bool,
}

#[derive(Debug, Clone)]
struct DashboardMetrics {
    current_score: String,
    current_score_trend: String,
    current_score_sparkline: Vec<f32>,
    avg_iteration: String,
    avg_iteration_trend: String,
    avg_iteration_sparkline: Vec<f32>,
    token_usage: String,
    token_usage_trend: String,
    token_usage_sparkline: Vec<f32>,
}

impl Default for DashboardMetrics {
    fn default() -> Self {
        Self {
            current_score: "--".to_owned(),
            current_score_trend: "Waiting".to_owned(),
            current_score_sparkline: vec![20.0, 24.0, 22.0, 26.0, 25.0, 28.0],
            avg_iteration: "--".to_owned(),
            avg_iteration_trend: "Waiting".to_owned(),
            avg_iteration_sparkline: vec![80.0, 72.0, 74.0, 68.0, 64.0, 60.0],
            token_usage: "0".to_owned(),
            token_usage_trend: "No LLM traffic".to_owned(),
            token_usage_sparkline: vec![0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
        }
    }
}

#[derive(Debug, Default)]
struct LogTailState {
    cleared_log_count: usize,
    notice: Option<String>,
}

impl LogTailState {
    fn refresh(&mut self, log_count: usize) {
        if self.cleared_log_count > log_count {
            self.cleared_log_count = log_count;
        }
    }

    fn record_open_result(&mut self, path: &std::path::Path, result: Result<(), String>) {
        self.notice = Some(match result {
            Ok(()) => format!("Opened {}", path.display()),
            Err(error) => format!("Failed to open log file: {error}"),
        });
    }

    fn clear_displayed_tail(&mut self, log_count: usize) {
        self.cleared_log_count = log_count;
        self.notice = Some("Cleared the currently displayed log tail".to_owned());
    }

    fn visible_logs<'a>(&self, logs: &'a [String]) -> &'a [String] {
        if self.cleared_log_count >= logs.len() {
            &[]
        } else {
            &logs[self.cleared_log_count..]
        }
    }

    fn notice(&self) -> Option<&str> {
        self.notice.as_deref()
    }
}

struct MaabariumConsoleApp {
    blueprint: Option<BlueprintFile>,
    blueprint_error: Option<String>,
    active_tab: ConsoleTab,
    engine_running: bool,
    configure_panel_open: bool,
    history: Vec<HistoryEntry>,
    logs: Vec<String>,
    log_path: PathBuf,
    last_log_refresh_at: f64,
    db_path: PathBuf,
    last_metrics_refresh_at: f64,
    last_history_refresh_at: f64,
    last_proposal_refresh_at: f64,
    dashboard_metrics: DashboardMetrics,
    proposals: Vec<PersistedProposal>,
    log_tail_state: LogTailState,
}

impl MaabariumConsoleApp {
    fn new() -> Self {
        let blueprint_path = blueprint_path();
        let (blueprint, blueprint_error) = match BlueprintFile::load(&blueprint_path) {
            Ok(blueprint) => (Some(blueprint), None),
            Err(error) => (None, Some(error.to_string())),
        };
        let log_path = default_log_path();
        let db_path = default_db_path();
        let logs = read_recent_log_lines(40).unwrap_or_default();
        let experiments = load_recent_experiments(&db_path, 12);
        let proposals = load_recent_proposals(&db_path, 5);
        let dashboard_metrics = DashboardMetrics::from_sources(&experiments, &logs);
        let history = history_entries_from_experiments(&experiments);

        Self {
            blueprint,
            blueprint_error,
            active_tab: ConsoleTab::History,
            engine_running: false,
            configure_panel_open: false,
            history,
            logs,
            log_path,
            last_log_refresh_at: 0.0,
            db_path,
            last_metrics_refresh_at: 0.0,
            last_history_refresh_at: 0.0,
            last_proposal_refresh_at: 0.0,
            dashboard_metrics,
            proposals,
            log_tail_state: LogTailState::default(),
        }
    }

    fn stat_cards(&self) -> [StatCard; 3] {
        [
            StatCard {
                label: "Current Score",
                value: self.dashboard_metrics.current_score.clone(),
                trend: self.dashboard_metrics.current_score_trend.clone(),
                color: INDIGO,
                sparkline: self.dashboard_metrics.current_score_sparkline.clone(),
            },
            StatCard {
                label: "Avg Iteration",
                value: self.dashboard_metrics.avg_iteration.clone(),
                trend: self.dashboard_metrics.avg_iteration_trend.clone(),
                color: EMERALD,
                sparkline: self.dashboard_metrics.avg_iteration_sparkline.clone(),
            },
            StatCard {
                label: "Token Usage",
                value: self.dashboard_metrics.token_usage.clone(),
                trend: self.dashboard_metrics.token_usage_trend.clone(),
                color: AMBER,
                sparkline: self.dashboard_metrics.token_usage_sparkline.clone(),
            },
        ]
    }

    fn blueprint_summary(&self) -> String {
        match &self.blueprint {
            Some(blueprint) => format!(
                "[blueprint]\nname = \"{}\"\nversion = \"{}\"\nlanguage = \"{}\"\n\n[constraints]\nmax_iterations = {}\ntimeout_seconds = {}\nrequire_tests_pass = {}\n\n[agents]\ncouncil_size = {}\ndebate_rounds = {}",
                blueprint.blueprint.name,
                blueprint.blueprint.version,
                blueprint.domain.language,
                blueprint.constraints.max_iterations,
                blueprint.constraints.timeout_seconds,
                blueprint.constraints.require_tests_pass,
                blueprint.agents.council_size,
                blueprint.agents.debate_rounds,
            ),
            None => self
                .blueprint_error
                .clone()
                .unwrap_or_else(|| "Blueprint unavailable".to_owned()),
        }
    }

    fn metric_points(&self) -> Vec<f32> {
        self.blueprint
            .as_ref()
            .map(|blueprint| {
                blueprint
                    .metrics
                    .metrics
                    .iter()
                    .take(5)
                    .map(|metric| (metric.weight as f32).clamp(0.15, 1.0))
                    .collect()
            })
            .filter(|points: &Vec<f32>| !points.is_empty())
            .unwrap_or_else(|| vec![0.68, 0.54, 0.62])
    }
}

impl eframe::App for MaabariumConsoleApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        self.refresh_logs(ctx.input(|input| input.time));
        self.refresh_dashboard_metrics(ctx.input(|input| input.time));
        self.refresh_history(ctx.input(|input| input.time));
        self.refresh_proposals(ctx.input(|input| input.time));
        let layout_mode = console_layout_mode(ctx.available_rect().width());

        TopBottomPanel::top("top_bar")
            .frame(
                Frame::default()
                    .fill(Color32::from_rgb(8, 11, 18))
                    .inner_margin(Margin::symmetric(24, 18)),
            )
            .show(ctx, |ui| {
                ui.horizontal(|ui| {
                    ui.vertical(|ui| {
                        ui.label(
                            RichText::new("MAABARIUM")
                                .size(22.0)
                                .strong()
                                .color(Color32::WHITE),
                        );
                        ui.label(
                            RichText::new("Phase 3 Console")
                                .size(11.0)
                                .color(TEXT_MUTED)
                                .italics(),
                        );
                    });
                    ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                        badge(ui, "Live metrics", INDIGO);
                        ui.add_space(8.0);
                        badge(
                            ui,
                            if self.engine_running {
                                "Engine active"
                            } else {
                                "Engine idle"
                            },
                            if self.engine_running {
                                EMERALD
                            } else {
                                TEXT_MUTED
                            },
                        );
                    });
                });
            });

        if matches!(layout_mode, ConsoleLayoutMode::Wide) {
            SidePanel::right("right_column")
                .resizable(false)
                .min_width(320.0)
                .frame(Frame::default().fill(Color32::from_rgb(5, 6, 8)))
                .show(ctx, |ui| {
                    ui.add_space(12.0);
                    right_panel_contents(ui, self);
                });
        }

        CentralPanel::default()
            .frame(Frame::default().fill(Color32::from_rgb(5, 6, 8)).inner_margin(Margin::same(20)))
            .show(ctx, |ui| {
                ui.spacing_mut().item_spacing = vec2(16.0, 16.0);
                draw_stats_row(ui, &self.stat_cards(), &mut self.engine_running, layout_mode);

                if !matches!(layout_mode, ConsoleLayoutMode::Wide) {
                    right_panel_contents(ui, self);
                    ui.add_space(16.0);
                }

                match layout_mode {
                    ConsoleLayoutMode::Wide | ConsoleLayoutMode::Medium => {
                        ui.horizontal_top(|ui| {
                            let available = ui.available_width();
                            let left_width = if matches!(layout_mode, ConsoleLayoutMode::Wide) {
                                (available * 0.32).max(220.0)
                            } else {
                                (available * 0.46).max(260.0)
                            };
                            let right_width = (available - left_width - 12.0).max(320.0);

                            ui.vertical(|ui| {
                                ui.set_width(left_width);
                                primary_metrics_column(ui, self);
                            });

                            ui.add_space(12.0);

                            ui.vertical(|ui| {
                                ui.set_width(right_width);
                                experiment_console_column(ui, self);
                            });
                        });
                    }
                    ConsoleLayoutMode::Narrow => {
                        primary_metrics_column(ui, self);
                        ui.add_space(16.0);
                        experiment_console_column(ui, self);
                    }
                }
            });
    }
}

impl MaabariumConsoleApp {
    fn refresh_logs(&mut self, now: f64) {
        if now - self.last_log_refresh_at < 1.0 {
            return;
        }

        if let Ok(logs) = read_recent_log_lines(40) {
            self.logs = logs;
            self.log_tail_state.refresh(self.logs.len());
        }
        self.last_log_refresh_at = now;
    }

    fn refresh_dashboard_metrics(&mut self, now: f64) {
        if now - self.last_metrics_refresh_at < 1.0 {
            return;
        }

        let experiments = load_recent_experiments(&self.db_path, 12);
        self.dashboard_metrics = DashboardMetrics::from_sources(&experiments, &self.logs);
        self.last_metrics_refresh_at = now;
    }

    fn refresh_history(&mut self, now: f64) {
        if now - self.last_history_refresh_at < 1.0 {
            return;
        }

        let experiments = load_recent_experiments(&self.db_path, 12);
        self.history = history_entries_from_experiments(&experiments);
        self.last_history_refresh_at = now;
    }

    fn refresh_proposals(&mut self, now: f64) {
        if now - self.last_proposal_refresh_at < 1.0 {
            return;
        }

        self.proposals = load_recent_proposals(&self.db_path, 5);
        self.last_proposal_refresh_at = now;
    }
}

fn blueprint_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../blueprints/example.toml")
}

fn card(ui: &mut Ui, title: &str, add_contents: impl FnOnce(&mut Ui)) {
    Frame::default()
        .fill(PANEL_FILL)
        .stroke(Stroke::new(1.0, PANEL_STROKE))
        .corner_radius(CornerRadius::same(16))
        .inner_margin(Margin::same(16))
        .show(ui, |ui| {
            ui.horizontal(|ui| {
                ui.label(RichText::new(title).size(12.0).strong().color(TEXT_MUTED));
                ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                    for _ in 0..2 {
                        let (rect, _) = ui.allocate_exact_size(vec2(6.0, 6.0), Sense::hover());
                        ui.painter().circle_filled(rect.center(), 3.0, PANEL_STROKE);
                        ui.add_space(4.0);
                    }
                });
            });
            ui.add_space(10.0);
            add_contents(ui);
        });
}

fn draw_stats_row(
    ui: &mut Ui,
    cards: &[StatCard; 3],
    engine_running: &mut bool,
    layout_mode: ConsoleLayoutMode,
) {
    let available = ui.available_width();
    match layout_mode {
        ConsoleLayoutMode::Wide => {
            ui.horizontal(|ui| {
                let card_width = ((available - 24.0) / 4.0).max(180.0);
                for stat in cards {
                    draw_stat_card(ui, stat, card_width);
                }
                draw_engine_toggle(ui, engine_running, card_width);
            });
        }
        ConsoleLayoutMode::Medium => {
            let card_width = ((available - 16.0) / 2.0).max(220.0);
            ui.horizontal(|ui| {
                draw_stat_card(ui, &cards[0], card_width);
                ui.add_space(16.0);
                draw_stat_card(ui, &cards[1], card_width);
            });
            ui.add_space(16.0);
            ui.horizontal(|ui| {
                draw_stat_card(ui, &cards[2], card_width);
                ui.add_space(16.0);
                draw_engine_toggle(ui, engine_running, card_width);
            });
        }
        ConsoleLayoutMode::Narrow => {
            let card_width = available.max(220.0);
            for stat in cards {
                draw_stat_card(ui, stat, card_width);
                ui.add_space(12.0);
            }
            draw_engine_toggle(ui, engine_running, card_width);
        }
    }
}

fn draw_stat_card(ui: &mut Ui, stat: &StatCard, width: f32) {
    Frame::default()
        .fill(PANEL_FILL)
        .stroke(Stroke::new(1.0, PANEL_STROKE))
        .corner_radius(CornerRadius::same(16))
        .inner_margin(Margin::same(14))
        .show(ui, |ui| {
            ui.set_min_width(width);
            ui.horizontal(|ui| {
                ui.vertical(|ui| {
                    ui.label(
                        RichText::new(stat.label)
                            .size(10.0)
                            .strong()
                            .color(TEXT_MUTED),
                    );
                    ui.label(
                        RichText::new(&stat.value)
                            .size(28.0)
                            .monospace()
                            .strong()
                            .color(Color32::WHITE),
                    );
                    ui.label(RichText::new(&stat.trend).size(10.0).strong().color(
                        if stat.trend.starts_with('+') {
                            EMERALD
                        } else if stat.trend.starts_with('-') {
                            ROSE
                        } else {
                            TEXT_MUTED
                        },
                    ));
                });
                ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                    sparkline(ui, &stat.sparkline, stat.color, vec2(74.0, 42.0));
                });
            });
        });
}

fn draw_engine_toggle(ui: &mut Ui, engine_running: &mut bool, width: f32) {
    let button_label = if *engine_running {
        "HALT ENGINE"
    } else {
        "INITIATE LOOP"
    };
    let button_fill = if *engine_running {
        Color32::from_rgb(24, 10, 16)
    } else {
        Color32::from_rgb(49, 46, 129)
    };
    let button_stroke = if *engine_running { ROSE } else { INDIGO };
    let response = Frame::default()
        .fill(button_fill)
        .stroke(Stroke::new(1.0, button_stroke))
        .corner_radius(CornerRadius::same(16))
        .inner_margin(Margin::same(14))
        .show(ui, |ui| {
            ui.set_min_width(width);
            ui.vertical_centered(|ui| {
                ui.add_space(18.0);
                if ui
                    .add_sized(
                        [width - 20.0, 48.0],
                        egui::Button::new(
                            RichText::new(button_label)
                                .size(15.0)
                                .strong()
                                .color(Color32::WHITE),
                        ),
                    )
                    .clicked()
                {
                    *engine_running = !*engine_running;
                }
                ui.add_space(18.0);
            });
        });
    response
        .response
        .on_hover_text("Toggle the autonomous research loop preview");
}

fn right_panel_contents(ui: &mut Ui, app: &mut MaabariumConsoleApp) {
    card(ui, "Active Blueprint", |ui| {
        let mut snippet = app.blueprint_summary();
        Frame::default()
            .fill(Color32::from_rgb(2, 6, 23))
            .stroke(Stroke::new(1.0, PANEL_STROKE))
            .corner_radius(CornerRadius::same(12))
            .inner_margin(Margin::same(14))
            .show(ui, |ui| {
                ui.add(
                    egui::TextEdit::multiline(&mut snippet)
                        .desired_rows(12)
                        .interactive(false)
                        .font(FontId::monospace(12.0))
                        .desired_width(f32::INFINITY),
                );
            });
        ui.add_space(10.0);
        let button_text = if app.engine_running {
            "Configure running engine"
        } else {
            "Configure engine"
        };
        if ui
            .add_sized(
                [ui.available_width(), 36.0],
                egui::Button::new(RichText::new(button_text).size(13.0).strong()),
            )
            .clicked()
        {
            app.configure_panel_open = !app.configure_panel_open;
        }

        if app.configure_panel_open {
            ui.add_space(10.0);
            Frame::default()
                .fill(Color32::from_rgb(2, 6, 23))
                .stroke(Stroke::new(1.0, PANEL_STROKE))
                .corner_radius(CornerRadius::same(12))
                .inner_margin(Margin::same(12))
                .show(ui, |ui| {
                    let iteration_cap = app
                        .blueprint
                        .as_ref()
                        .map(|bp| bp.constraints.max_iterations.to_string())
                        .unwrap_or_else(|| "Unavailable".to_owned());
                    let debate_rounds = app
                        .blueprint
                        .as_ref()
                        .map(|bp| bp.agents.debate_rounds.to_string())
                        .unwrap_or_else(|| "Unavailable".to_owned());
                    config_row(ui, "Loop mode", "Council debate");
                    config_row(ui, "Target repo", ".");
                    config_row(ui, "Iteration cap", &iteration_cap);
                    config_row(ui, "Debate rounds", &debate_rounds);
                });
        }
    });

    ui.add_space(16.0);
    gradient_callout(ui);
}

fn primary_metrics_column(ui: &mut Ui, app: &MaabariumConsoleApp) {
    card(ui, "Multi-Metric Radar", |ui| {
        radar_chart(ui, &app.metric_points());
        ui.add_space(8.0);
        if let Some(blueprint) = &app.blueprint {
            Grid::new("radar_legend")
                .num_columns(2)
                .spacing(vec2(10.0, 6.0))
                .show(ui, |ui| {
                    for (index, metric) in blueprint.metrics.metrics.iter().take(4).enumerate() {
                        let display_name = metric.name.replace('_', " ");
                        metric_legend_item(ui, display_name);
                        if index % 2 == 1 {
                            ui.end_row();
                        }
                    }
                });
        }
    });

    ui.add_space(16.0);
    card(ui, "Hardware Heat", |ui| {
        progress_bar(ui, "GPU (Metal)", "48°C", 0.65, ROSE, INDIGO);
        ui.add_space(12.0);
        ui.label(
            RichText::new("NPU Intensity")
                .size(11.0)
                .strong()
                .color(TEXT_MUTED),
        );
        ui.add_space(6.0);
        ui.horizontal_wrapped(|ui| {
            for index in 0..8 {
                let fill = if index < 6 { INDIGO } else { PANEL_STROKE };
                let (rect, _) = ui.allocate_exact_size(vec2(18.0, 28.0), Sense::hover());
                ui.painter().rect_filled(rect, 4.0, fill);
                ui.add_space(4.0);
            }
        });
    });
}

fn experiment_console_column(ui: &mut Ui, app: &mut MaabariumConsoleApp) {
    card(ui, "Autonomous Council Debate", |ui| {
        council_panel(ui, app.blueprint.as_ref(), app.engine_running);
    });

    ui.add_space(16.0);
    card(ui, "Experiment Console", |ui| {
        tab_selector(ui, &mut app.active_tab);
        ui.add_space(12.0);
        match app.active_tab {
            ConsoleTab::History => history_table(ui, &app.history),
            ConsoleTab::DiffView => diff_view(ui, &app.proposals),
            ConsoleTab::Logs => logs_view(ui, app),
        }
    });
}

fn config_row(ui: &mut Ui, label: &str, value: &str) {
    ui.horizontal(|ui| {
        ui.label(RichText::new(label).size(11.0).strong().color(TEXT_MUTED));
        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
            ui.label(RichText::new(value).size(11.0).color(Color32::WHITE));
        });
    });
    ui.add_space(4.0);
}

fn badge(ui: &mut Ui, text: &str, color: Color32) {
    Frame::default()
        .fill(color.gamma_multiply(0.12))
        .stroke(Stroke::new(1.0, color.gamma_multiply(0.45)))
        .corner_radius(CornerRadius::same(255))
        .inner_margin(Margin::symmetric(10, 5))
        .show(ui, |ui| {
            ui.label(RichText::new(text).size(11.0).strong().color(color));
        });
}

fn sparkline(ui: &mut Ui, values: &[f32], color: Color32, size: Vec2) {
    let (rect, _) = ui.allocate_exact_size(size, Sense::hover());
    if values.len() < 2 {
        return;
    }

    let min = values.iter().copied().fold(f32::MAX, f32::min);
    let max = values.iter().copied().fold(f32::MIN, f32::max);
    let range = (max - min).max(1.0);
    let points = values
        .iter()
        .enumerate()
        .map(|(index, value)| {
            let x = rect.left() + (index as f32 / (values.len() - 1) as f32) * rect.width();
            let y = rect.bottom() - ((value - min) / range) * rect.height();
            egui::pos2(x, y)
        })
        .collect::<Vec<_>>();
    ui.painter()
        .add(Shape::line(points, Stroke::new(2.2, color)));
}

fn radar_chart(ui: &mut Ui, values: &[f32]) {
    let size = vec2(160.0, 160.0);
    let (rect, _) = ui.allocate_exact_size(size, Sense::hover());
    let painter = ui.painter();
    let center = rect.center();
    let radius = rect.width().min(rect.height()) * 0.36;

    for ring in [1.0_f32, 0.66, 0.38] {
        painter.circle_stroke(
            center,
            radius * ring,
            Stroke::new(1.0, Color32::from_gray(55)),
        );
    }

    let axis_count = values.len().max(3);
    for index in 0..axis_count {
        let angle =
            std::f32::consts::TAU * index as f32 / axis_count as f32 - std::f32::consts::FRAC_PI_2;
        let axis_end = center + vec2(angle.cos(), angle.sin()) * radius;
        painter.line_segment([center, axis_end], Stroke::new(1.0, Color32::from_gray(50)));
    }

    let polygon = values
        .iter()
        .enumerate()
        .map(|(index, value)| {
            let angle = std::f32::consts::TAU * index as f32 / axis_count as f32
                - std::f32::consts::FRAC_PI_2;
            center + vec2(angle.cos(), angle.sin()) * radius * *value
        })
        .collect::<Vec<_>>();

    painter.add(Shape::convex_polygon(
        polygon.clone(),
        INDIGO.gamma_multiply(0.2),
        Stroke::new(2.0, INDIGO),
    ));
    for point in polygon {
        painter.circle_filled(point, 4.0, INDIGO);
    }
}

fn metric_legend_item(ui: &mut Ui, label: String) {
    ui.horizontal(|ui| {
        let (rect, _) = ui.allocate_exact_size(vec2(8.0, 8.0), Sense::hover());
        ui.painter().circle_filled(rect.center(), 4.0, INDIGO);
        ui.label(
            RichText::new(label.to_uppercase())
                .size(10.0)
                .strong()
                .color(TEXT_MUTED),
        );
    });
}

fn progress_bar(
    ui: &mut Ui,
    label: &str,
    value_text: &str,
    progress: f32,
    start: Color32,
    end: Color32,
) {
    ui.horizontal(|ui| {
        ui.label(RichText::new(label).size(11.0).strong().color(TEXT_MUTED));
        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
            ui.label(RichText::new(value_text).size(11.0).color(Color32::WHITE));
        });
    });
    ui.add_space(4.0);
    let (rect, _) = ui.allocate_exact_size(vec2(ui.available_width(), 12.0), Sense::hover());
    ui.painter()
        .rect_filled(rect, 6.0, Color32::from_rgb(15, 23, 42));
    let fill_rect =
        egui::Rect::from_min_size(rect.min, vec2(rect.width() * progress, rect.height()));
    ui.painter()
        .rect_filled(fill_rect, 6.0, start.linear_multiply(0.7));
    ui.painter().rect_filled(
        egui::Rect::from_min_size(
            egui::pos2(fill_rect.left() + fill_rect.width() * 0.45, fill_rect.top()),
            vec2(fill_rect.width() * 0.55, fill_rect.height()),
        ),
        6.0,
        end.linear_multiply(0.9),
    );
}

fn council_panel(ui: &mut Ui, blueprint: Option<&BlueprintFile>, engine_running: bool) {
    Frame::default()
        .fill(Color32::from_rgb(2, 6, 23))
        .stroke(Stroke::new(1.0, Color32::from_gray(45)))
        .corner_radius(CornerRadius::same(12))
        .inner_margin(Margin::same(14))
        .show(ui, |ui| {
            for (index, (title, color, copy)) in council_entries(blueprint).into_iter().enumerate() {
                if index > 0 {
                    ui.add_space(12.0);
                    ui.separator();
                    ui.add_space(12.0);
                }
                agent_message(ui, &title, color, &copy);
            }

            if engine_running {
                ui.add_space(12.0);
                pulse_badge(ui, "Active reasoning", EMERALD);
            }
        });
}

fn council_entries(blueprint: Option<&BlueprintFile>) -> Vec<(String, Color32, String)> {
    if let Some(blueprint) = blueprint {
        let entries = blueprint
            .agents
            .agents
            .iter()
            .take(3)
            .map(|agent| {
                let title = format!("{} Agent", title_case(&agent.name));
                let lower = format!("{} {}", agent.name, agent.role).to_ascii_lowercase();
                let color = if lower.contains("critic") {
                    ROSE
                } else if lower.contains("engineer") || lower.contains("review") {
                    EMERALD
                } else {
                    INDIGO
                };
                let copy = if lower.contains("critic") {
                    "The last three experiments showed a 14% latency regression at higher token counts. Reject unless performance remains within budget.".to_owned()
                } else if lower.contains("engineer") || lower.contains("review") {
                    "I can keep the change set narrow, target the approved files, and package the final diff so the git manager can promote it safely.".to_owned()
                } else {
                    "The baseline prompt is too defensive. Relax token limits to allow richer reasoning steps without reducing guardrails.".to_owned()
                };
                (title, color, copy)
            })
            .collect::<Vec<_>>();

        if !entries.is_empty() {
            return entries;
        }
    }

    vec![
        (
            "Strategist Agent".to_owned(),
            INDIGO,
            "The baseline prompt is too defensive. Relax token limits to allow richer reasoning steps without reducing guardrails.".to_owned(),
        ),
        (
            "Critic Agent".to_owned(),
            ROSE,
            "The last three experiments showed a 14% latency regression at higher token counts. Reject unless performance remains within budget.".to_owned(),
        ),
        (
            "Engineer Agent".to_owned(),
            EMERALD,
            "I can keep the change set narrow, target the approved files, and package the final diff so the git manager can promote it safely.".to_owned(),
        ),
    ]
}

fn pulse_badge(ui: &mut Ui, text: &str, color: Color32) {
    let pulse = ((ui.ctx().input(|input| input.time) as f32).sin() + 1.2) * 0.45;
    Frame::default()
        .fill(color.gamma_multiply(0.08 + pulse * 0.08))
        .stroke(Stroke::new(1.0, color.gamma_multiply(0.35 + pulse * 0.25)))
        .corner_radius(CornerRadius::same(255))
        .inner_margin(Margin::symmetric(10, 5))
        .show(ui, |ui| {
            ui.label(RichText::new(text).size(11.0).strong().color(color));
        });
    ui.ctx().request_repaint();
}

fn title_case(value: &str) -> String {
    value
        .split(['-', '_', ' '])
        .filter(|segment| !segment.is_empty())
        .map(|segment| {
            let mut chars = segment.chars();
            match chars.next() {
                Some(first) => format!("{}{}", first.to_ascii_uppercase(), chars.as_str()),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn agent_message(ui: &mut Ui, title: &str, color: Color32, copy: &str) {
    ui.horizontal_top(|ui| {
        let (rect, _) = ui.allocate_exact_size(vec2(28.0, 28.0), Sense::hover());
        ui.painter()
            .rect_filled(rect, 6.0, color.gamma_multiply(0.18));
        ui.painter().circle_filled(rect.center(), 5.0, color);
        ui.add_space(8.0);
        ui.vertical(|ui| {
            ui.label(RichText::new(title).size(11.0).strong().color(color));
            ui.label(
                RichText::new(copy)
                    .size(13.0)
                    .italics()
                    .color(Color32::from_rgb(203, 213, 225)),
            );
        });
    });
}

fn tab_selector(ui: &mut Ui, active_tab: &mut ConsoleTab) {
    ui.horizontal(|ui| {
        for tab in [ConsoleTab::History, ConsoleTab::DiffView, ConsoleTab::Logs] {
            let selected = *active_tab == tab;
            let button = egui::Button::new(
                RichText::new(tab.label())
                    .size(11.0)
                    .strong()
                    .color(if selected { INDIGO } else { TEXT_MUTED }),
            )
            .fill(if selected {
                Color32::from_rgb(15, 23, 42)
            } else {
                Color32::TRANSPARENT
            });
            if ui.add(button).clicked() {
                *active_tab = tab;
            }
        }
    });
}

fn history_table(ui: &mut Ui, history: &[HistoryEntry]) {
    Grid::new("history_table")
        .num_columns(5)
        .spacing(vec2(12.0, 10.0))
        .striped(true)
        .show(ui, |ui| {
            for entry in history {
                ui.label(
                    RichText::new(format!("#exp-{}", entry.experiment_id))
                        .monospace()
                        .size(12.0)
                        .color(TEXT_MUTED),
                );
                ui.label(RichText::new(format!("{:.2}", entry.score)).strong());
                ui.label(
                    RichText::new(format!("{:+.2}", entry.delta)).color(if entry.delta >= 0.0 {
                        EMERALD
                    } else {
                        ROSE
                    }),
                );
                badge(
                    ui,
                    if entry.promoted {
                        "Promoted"
                    } else {
                        "Rejected"
                    },
                    if entry.promoted { INDIGO } else { ROSE },
                );
                ui.label(RichText::new(&entry.summary).size(11.0).color(TEXT_MUTED));
                ui.end_row();
            }
        });
}

fn diff_view(ui: &mut Ui, proposals: &[PersistedProposal]) {
    if let Some(proposal) = proposals.first() {
        ui.label(
            RichText::new(format!("Latest proposal #{}", proposal.id))
                .size(12.0)
                .strong()
                .color(Color32::WHITE),
        );
        ui.add_space(6.0);
        ui.label(RichText::new(&proposal.summary).size(11.0).color(TEXT_MUTED));
        ui.add_space(10.0);

        if proposal.file_patches.is_empty() {
            ui.label(RichText::new("No file patches recorded for this proposal.").monospace().size(12.0).color(TEXT_MUTED));
            return;
        }

        for patch in &proposal.file_patches {
            ui.label(
                RichText::new(format_patch_header(patch))
                    .monospace()
                    .size(12.0)
                    .strong()
                    .color(Color32::WHITE),
            );
            ui.add_space(4.0);
            for (color, line) in patch_preview_lines(patch).into_iter().take(8) {
                ui.label(RichText::new(line).monospace().size(12.0).color(color));
                ui.add_space(3.0);
            }
            ui.add_space(10.0);
        }
    } else {
        ui.label(
            RichText::new("Waiting for persisted proposal data in the SQLite database")
                .monospace()
                .size(12.0)
                .color(TEXT_MUTED),
        );
    }
}

fn logs_view(ui: &mut Ui, app: &mut MaabariumConsoleApp) {
    ui.horizontal(|ui| {
        if ui.button("Open Log File").clicked() {
            let result = open_path_in_system_viewer(&app.log_path);
            app.log_tail_state.record_open_result(&app.log_path, result);
        }
        if ui.button("Clear Displayed Tail").clicked() {
            app.log_tail_state.clear_displayed_tail(app.logs.len());
        }
    });
    ui.add_space(8.0);

    if let Some(notice) = app.log_tail_state.notice() {
        ui.label(RichText::new(notice).size(11.0).color(TEXT_MUTED));
        ui.add_space(6.0);
    }

    let visible_logs = app.log_tail_state.visible_logs(&app.logs);

    if visible_logs.is_empty() {
        ui.label(
            RichText::new(format!("Waiting for tracing output in {}", app.log_path.display()))
                .monospace()
                .size(12.0)
                .color(TEXT_MUTED),
        );
        ui.add_space(6.0);
    } else {
        for line in visible_logs.iter().rev().take(8) {
            ui.label(RichText::new(line).monospace().size(12.0).color(TEXT_MUTED));
            ui.add_space(4.0);
        }
    }
    ui.label(
        RichText::new(if app.engine_running {
            "[23:42:14] Engine state changed: running"
        } else {
            "[23:42:14] Engine state changed: idle"
        })
        .monospace()
        .size(12.0)
        .color(if app.engine_running { EMERALD } else { TEXT_MUTED }),
    );
    ui.add_space(6.0);
    ui.label(
        RichText::new(format!("Log source: {}", app.log_path.display()))
            .size(11.0)
            .color(TEXT_MUTED),
    );
}

fn open_path_in_system_viewer(path: &std::path::Path) -> Result<(), String> {
    let command = if cfg!(target_os = "macos") {
        "open"
    } else if cfg!(target_os = "windows") {
        "cmd"
    } else {
        "xdg-open"
    };

    let mut process = Command::new(command);
    if cfg!(target_os = "windows") {
        process.arg("/C").arg("start").arg(path);
    } else {
        process.arg(path);
    }

    process.spawn().map_err(|error| error.to_string()).map(|_| ())
}

fn load_recent_experiments(db_path: &std::path::Path, limit: usize) -> Vec<PersistedExperiment> {
    Persistence::open(&db_path.display().to_string())
        .and_then(|persistence| persistence.recent_experiments(limit))
        .unwrap_or_default()
}

fn load_recent_proposals(db_path: &std::path::Path, limit: usize) -> Vec<PersistedProposal> {
    Persistence::open(&db_path.display().to_string())
        .and_then(|persistence| persistence.recent_proposals(limit))
        .unwrap_or_default()
}

fn format_patch_header(patch: &FilePatch) -> String {
    let operation = match patch.operation {
        FilePatchOperation::Create => "create",
        FilePatchOperation::Modify => "modify",
        FilePatchOperation::Delete => "delete",
    };
    format!("{} {}", operation.to_uppercase(), patch.path)
}

fn patch_preview_lines(patch: &FilePatch) -> Vec<(Color32, String)> {
    match patch.operation {
        FilePatchOperation::Delete => vec![(ROSE, format!("- removed {}", patch.path))],
        FilePatchOperation::Create => patch
            .content
            .as_deref()
            .unwrap_or_default()
            .lines()
            .map(|line| (EMERALD, format!("+{}", line)))
            .collect(),
        FilePatchOperation::Modify => patch
            .content
            .as_deref()
            .unwrap_or_default()
            .lines()
            .map(|line| (AMBER, format!("~{}", line)))
            .collect(),
    }
}

fn history_entries_from_experiments(experiments: &[PersistedExperiment]) -> Vec<HistoryEntry> {
    let successful = experiments
        .iter()
        .filter(|experiment| experiment.error.is_none())
        .collect::<Vec<_>>();
    let history = experiments
        .iter()
        .take(8)
        .map(|experiment| {
            let next_successful = successful
                .iter()
                .skip_while(|candidate| candidate.id != experiment.id)
                .nth(1)
                .copied();
            let delta = next_successful
                .map(|previous| experiment.weighted_total - previous.weighted_total)
                .unwrap_or(0.0) as f32;
            let summary = experiment.error.clone().filter(|error| !error.is_empty()).unwrap_or_else(|| {
                if experiment.proposal_summary.trim().is_empty() {
                    "No proposal summary recorded".to_owned()
                } else {
                    experiment.proposal_summary.clone()
                }
            });

            HistoryEntry {
                experiment_id: experiment.id,
                score: experiment.weighted_total as f32,
                delta,
                summary,
                promoted: experiment.error.is_none() && delta >= 0.0,
            }
        })
        .collect::<Vec<_>>();

    if history.is_empty() {
        vec![
            HistoryEntry {
                experiment_id: 104,
                score: 8.42,
                delta: 0.24,
                summary: "Optimized for actionability and reduced evaluation time.".to_owned(),
                promoted: true,
            },
            HistoryEntry {
                experiment_id: 103,
                score: 8.18,
                delta: 0.11,
                summary: "Improved system prompt clarity for the strategist agent.".to_owned(),
                promoted: true,
            },
            HistoryEntry {
                experiment_id: 102,
                score: 8.07,
                delta: -0.03,
                summary: "Rejected due to latency regression during council debate.".to_owned(),
                promoted: false,
            },
        ]
    } else {
        history
    }
}

impl DashboardMetrics {
    fn from_sources(experiments: &[PersistedExperiment], log_lines: &[String]) -> Self {
        let mut metrics = DashboardMetrics::default();

        let successful = experiments
            .iter()
            .filter(|experiment| experiment.error.is_none())
            .collect::<Vec<_>>();

        if let Some(current) = successful.first() {
            metrics.current_score = format!("{:.2}", current.weighted_total);
            metrics.current_score_trend = if let Some(previous) = successful.get(1) {
                format_percentage_delta(current.weighted_total, previous.weighted_total)
            } else {
                "Baseline".to_owned()
            };
            metrics.current_score_sparkline = successful
                .iter()
                .take(6)
                .map(|experiment| (experiment.weighted_total as f32 * 100.0).clamp(0.0, 100.0))
                .collect::<Vec<_>>();
            metrics.current_score_sparkline.reverse();
        }

        if !successful.is_empty() {
            let durations = successful
                .iter()
                .take(6)
                .map(|experiment| experiment.duration_ms as f32 / 1000.0)
                .collect::<Vec<_>>();
            let avg_duration = successful
                .iter()
                .take(6)
                .map(|experiment| experiment.duration_ms)
                .sum::<u64>() as f64
                / successful.iter().take(6).count() as f64;
            metrics.avg_iteration = format_duration(avg_duration as u64);
            metrics.avg_iteration_trend = if successful.len() >= 2 {
                let latest = successful[0].duration_ms as f64;
                let previous = successful[1].duration_ms as f64;
                invert_delta(format_percentage_delta(latest, previous))
            } else {
                "Baseline".to_owned()
            };
            metrics.avg_iteration_sparkline = durations;
            metrics.avg_iteration_sparkline.reverse();
        }

        let token_samples = log_lines
            .iter()
            .filter_map(|line| parse_token_usage(line))
            .collect::<Vec<_>>();
        if !token_samples.is_empty() {
            let total_tokens = token_samples.iter().sum::<u32>();
            metrics.token_usage = format_token_usage(total_tokens);
            metrics.token_usage_trend = format!("{} recent completions", token_samples.len());
            metrics.token_usage_sparkline = token_samples
                .iter()
                .rev()
                .take(6)
                .copied()
                .map(|value| value as f32)
                .collect::<Vec<_>>();
            metrics.token_usage_sparkline.reverse();
        }

        metrics
    }
}

fn parse_token_usage(line: &str) -> Option<u32> {
    line.split_whitespace().find_map(|segment| {
        segment
            .strip_prefix("tokens_used=")
            .and_then(|value| value.trim_end_matches(',').parse::<u32>().ok())
    })
}

fn format_percentage_delta(current: f64, previous: f64) -> String {
    if previous.abs() < f64::EPSILON {
        return "Baseline".to_owned();
    }

    let delta = ((current - previous) / previous) * 100.0;
    format!("{:+.1}%", delta)
}

fn invert_delta(delta: String) -> String {
    if let Some(rest) = delta.strip_prefix('+') {
        format!("-{}", rest)
    } else if let Some(rest) = delta.strip_prefix('-') {
        format!("+{}", rest)
    } else {
        delta
    }
}

fn format_duration(duration_ms: u64) -> String {
    if duration_ms >= 1_000 {
        format!("{:.1}s", duration_ms as f64 / 1_000.0)
    } else {
        format!("{}ms", duration_ms)
    }
}

fn format_token_usage(tokens: u32) -> String {
    if tokens >= 1_000_000 {
        format!("{:.1}M", tokens as f64 / 1_000_000.0)
    } else if tokens >= 1_000 {
        format!("{:.1}K", tokens as f64 / 1_000.0)
    } else {
        tokens.to_string()
    }
}

fn gradient_callout(ui: &mut Ui) {
    Frame::default()
        .fill(Color32::from_rgb(24, 24, 52))
        .stroke(Stroke::new(1.0, INDIGO.gamma_multiply(0.35)))
        .corner_radius(CornerRadius::same(18))
        .inner_margin(Margin::same(18))
        .show(ui, |ui| {
            ui.label(
                RichText::new("Experiment Stacks")
                    .size(16.0)
                    .strong()
                    .color(Color32::WHITE),
            );
            ui.add_space(6.0);
            ui.label(
                RichText::new(
                    "View multi-dimensional trees for every agent decision, promotion, rejection, and sandbox gate as the Phase 3 console grows.",
                )
                .size(13.0)
                .color(Color32::from_rgb(199, 210, 254)),
            );
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn example_blueprint_loads_for_console() {
        let blueprint =
            BlueprintFile::load(&blueprint_path()).expect("example blueprint should load");
        assert_eq!(blueprint.blueprint.name, "example-prompt-lab");
        assert_eq!(blueprint.agents.council_size, 3);
    }

    #[test]
    fn console_history_includes_promoted_entry() {
        let app = MaabariumConsoleApp::new();
        assert!(app.history.iter().any(|entry| entry.promoted));
    }

    #[test]
    fn history_entries_are_derived_from_persisted_experiments() {
        let experiments = vec![
            PersistedExperiment {
                id: 12,
                iteration: 3,
                blueprint_name: "example".into(),
                proposal_summary: "latest improvement".into(),
                weighted_total: 0.82,
                duration_ms: 1_500,
                error: None,
                created_at: "2026-03-22T12:00:00Z".into(),
                metrics: vec![],
            },
            PersistedExperiment {
                id: 11,
                iteration: 2,
                blueprint_name: "example".into(),
                proposal_summary: "previous candidate".into(),
                weighted_total: 0.76,
                duration_ms: 2_000,
                error: None,
                created_at: "2026-03-22T11:59:00Z".into(),
                metrics: vec![],
            },
            PersistedExperiment {
                id: 10,
                iteration: 1,
                blueprint_name: "example".into(),
                proposal_summary: String::new(),
                weighted_total: 0.0,
                duration_ms: 0,
                error: Some("timeout".into()),
                created_at: "2026-03-22T11:58:00Z".into(),
                metrics: vec![],
            },
        ];

        let history = history_entries_from_experiments(&experiments);

        assert_eq!(history.len(), 3);
        assert_eq!(history[0].experiment_id, 12);
        assert_eq!(history[0].summary, "latest improvement");
        assert!(history[0].promoted);
        assert_eq!(history[2].summary, "timeout");
        assert!(!history[2].promoted);
    }

    #[test]
    fn log_tail_state_clears_and_only_reveals_new_lines() {
        let mut state = LogTailState::default();
        let logs = vec!["one".to_owned(), "two".to_owned(), "three".to_owned()];

        state.clear_displayed_tail(logs.len());
        assert!(state.visible_logs(&logs).is_empty());
        assert_eq!(state.notice(), Some("Cleared the currently displayed log tail"));

        let appended_logs = vec![
            "one".to_owned(),
            "two".to_owned(),
            "three".to_owned(),
            "four".to_owned(),
        ];
        assert_eq!(state.visible_logs(&appended_logs), ["four".to_owned()]);
    }

    #[test]
    fn log_tail_state_records_open_results() {
        let mut state = LogTailState::default();
        let path = PathBuf::from("data/maabarium.log");

        state.record_open_result(&path, Ok(()));
        assert_eq!(state.notice(), Some("Opened data/maabarium.log"));

        state.record_open_result(&path, Err("permission denied".to_owned()));
        assert_eq!(
            state.notice(),
            Some("Failed to open log file: permission denied")
        );
    }

    #[test]
    fn dashboard_metrics_use_experiments_and_logs() {
        let experiments = vec![
            PersistedExperiment {
                id: 12,
                iteration: 3,
                blueprint_name: "example".into(),
                proposal_summary: "latest".into(),
                weighted_total: 0.82,
                duration_ms: 1_500,
                error: None,
                created_at: "2026-03-22T12:00:00Z".into(),
                metrics: vec![],
            },
            PersistedExperiment {
                id: 11,
                iteration: 2,
                blueprint_name: "example".into(),
                proposal_summary: "previous".into(),
                weighted_total: 0.76,
                duration_ms: 2_000,
                error: None,
                created_at: "2026-03-22T11:59:00Z".into(),
                metrics: vec![],
            },
        ];
        let logs = vec![
            "INFO tokens_used=120 latency_ms=24 LLM completion finished".to_owned(),
            "INFO tokens_used=80 latency_ms=22 LLM completion finished".to_owned(),
        ];

        let metrics = DashboardMetrics::from_sources(&experiments, &logs);

        assert_eq!(metrics.current_score, "0.82");
        assert_eq!(metrics.avg_iteration, "1.8s");
        assert_eq!(metrics.token_usage, "200");
        assert_eq!(metrics.token_usage_trend, "2 recent completions");
    }

    #[test]
    fn diff_view_patch_preview_uses_real_patch_data() {
        let create_lines = patch_preview_lines(&FilePatch {
            path: "src/lib.rs".into(),
            operation: FilePatchOperation::Create,
            content: Some("pub fn hello() {}".into()),
        });
        let delete_lines = patch_preview_lines(&FilePatch {
            path: "src/old.rs".into(),
            operation: FilePatchOperation::Delete,
            content: None,
        });

        assert_eq!(create_lines[0].1, "+pub fn hello() {}");
        assert_eq!(delete_lines[0].1, "- removed src/old.rs");
    }

    #[test]
    fn layout_mode_breakpoints_are_stable() {
        assert_eq!(console_layout_mode(1400.0), ConsoleLayoutMode::Wide);
        assert_eq!(console_layout_mode(1100.0), ConsoleLayoutMode::Medium);
        assert_eq!(console_layout_mode(800.0), ConsoleLayoutMode::Narrow);
    }
}
