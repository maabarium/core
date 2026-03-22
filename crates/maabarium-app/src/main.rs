use eframe::egui::{
    self, Align, CentralPanel, Color32, CornerRadius, FontId, Frame, Grid, Layout, Margin,
    RichText, ScrollArea, Sense, Shape, SidePanel, Stroke, TopBottomPanel, Ui, Vec2, vec2,
};
use maabarium_core::BlueprintFile;
use std::path::PathBuf;

const EXAMPLE_BLUEPRINT: &str = include_str!("../../../blueprints/example.toml");
const INDIGO: Color32 = Color32::from_rgb(99, 102, 241);
const EMERALD: Color32 = Color32::from_rgb(16, 185, 129);
const ROSE: Color32 = Color32::from_rgb(244, 63, 94);
const AMBER: Color32 = Color32::from_rgb(245, 158, 11);
const PANEL_FILL: Color32 = Color32::from_rgb(11, 18, 32);
const PANEL_STROKE: Color32 = Color32::from_rgb(30, 41, 59);
const TEXT_MUTED: Color32 = Color32::from_rgb(148, 163, 184);

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

struct StatCard {
    label: &'static str,
    value: &'static str,
    trend: &'static str,
    color: Color32,
    sparkline: &'static [f32],
}

struct HistoryEntry {
    experiment_id: u32,
    score: f32,
    delta: f32,
    summary: &'static str,
    promoted: bool,
}

struct MaabariumConsoleApp {
    blueprint: Option<BlueprintFile>,
    blueprint_error: Option<String>,
    active_tab: ConsoleTab,
    engine_running: bool,
    history: Vec<HistoryEntry>,
}

impl MaabariumConsoleApp {
    fn new() -> Self {
        let blueprint_path = blueprint_path();
        let (blueprint, blueprint_error) = match BlueprintFile::load(&blueprint_path) {
            Ok(blueprint) => (Some(blueprint), None),
            Err(error) => (None, Some(error.to_string())),
        };

        Self {
            blueprint,
            blueprint_error,
            active_tab: ConsoleTab::History,
            engine_running: false,
            history: vec![
                HistoryEntry {
                    experiment_id: 104,
                    score: 8.42,
                    delta: 0.24,
                    summary: "Optimized for actionability and reduced evaluation time.",
                    promoted: true,
                },
                HistoryEntry {
                    experiment_id: 103,
                    score: 8.18,
                    delta: 0.11,
                    summary: "Improved system prompt clarity for the strategist agent.",
                    promoted: true,
                },
                HistoryEntry {
                    experiment_id: 102,
                    score: 8.07,
                    delta: -0.03,
                    summary: "Rejected due to latency regression during council debate.",
                    promoted: false,
                },
            ],
        }
    }

    fn stat_cards(&self) -> [StatCard; 3] {
        [
            StatCard {
                label: "Current Score",
                value: "8.42",
                trend: "+2.4%",
                color: INDIGO,
                sparkline: &[20.0, 40.0, 35.0, 60.0, 55.0, 80.0],
            },
            StatCard {
                label: "Avg Iteration",
                value: "42s",
                trend: "-12%",
                color: EMERALD,
                sparkline: &[80.0, 70.0, 75.0, 50.0, 45.0, 40.0],
            },
            StatCard {
                label: "Token Usage",
                value: "1.2M",
                trend: "Stable",
                color: AMBER,
                sparkline: &[30.0, 32.0, 31.0, 35.0, 33.0, 34.0],
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

        SidePanel::right("right_column")
            .resizable(false)
            .min_width(320.0)
            .frame(Frame::default().fill(Color32::from_rgb(5, 6, 8)))
            .show(ctx, |ui| {
                ui.add_space(12.0);
                card(ui, "Active Blueprint", |ui| {
                    let mut snippet = self.blueprint_summary();
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
                    let button_text = if self.engine_running {
                        "Configure running engine"
                    } else {
                        "Configure engine"
                    };
                    ui.add_sized(
                        [ui.available_width(), 36.0],
                        egui::Button::new(RichText::new(button_text).size(13.0).strong()),
                    );
                });

                ui.add_space(16.0);
                gradient_callout(ui);
            });

        CentralPanel::default()
            .frame(Frame::default().fill(Color32::from_rgb(5, 6, 8)).inner_margin(Margin::same(20)))
            .show(ctx, |ui| {
                ui.spacing_mut().item_spacing = vec2(16.0, 16.0);
                draw_stats_row(ui, &self.stat_cards(), &mut self.engine_running);

                ui.columns(2, |columns| {
                    columns[0].set_min_width(340.0);
                    columns[0].vertical(|ui| {
                        ui.horizontal_top(|ui| {
                            let available = ui.available_width();
                            let left_width = (available * 0.34).max(210.0);
                            let right_width = (available - left_width - 12.0).max(320.0);

                            ui.vertical(|ui| {
                                ui.set_width(left_width);
                                card(ui, "Multi-Metric Radar", |ui| {
                                    radar_chart(ui, &self.metric_points());
                                    ui.add_space(8.0);
                                    if let Some(blueprint) = &self.blueprint {
                                        Grid::new("radar_legend")
                                            .num_columns(2)
                                            .spacing(vec2(10.0, 6.0))
                                            .show(ui, |ui| {
                                                for (index, metric) in blueprint
                                                    .metrics
                                                    .metrics
                                                    .iter()
                                                    .take(4)
                                                    .enumerate()
                                                {
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
                                    ui.horizontal(|ui| {
                                        for index in 0..8 {
                                            let fill = if index < 6 { INDIGO } else { PANEL_STROKE };
                                            let (rect, _) =
                                                ui.allocate_exact_size(vec2(18.0, 28.0), Sense::hover());
                                            ui.painter().rect_filled(rect, 4.0, fill);
                                        }
                                    });
                                });
                            });

                            ui.add_space(12.0);

                            ui.vertical(|ui| {
                                ui.set_width(right_width);
                                card(ui, "Autonomous Council Debate", |ui| {
                                    council_panel(ui, self.engine_running);
                                });

                                ui.add_space(16.0);
                                card(ui, "Experiment Console", |ui| {
                                    tab_selector(ui, &mut self.active_tab);
                                    ui.add_space(12.0);
                                    match self.active_tab {
                                        ConsoleTab::History => history_table(ui, &self.history),
                                        ConsoleTab::DiffView => diff_view(ui),
                                        ConsoleTab::Logs => logs_view(ui, self.engine_running),
                                    }
                                });
                            });
                        });
                    });

                    columns[1].vertical(|ui| {
                        card(ui, "Console Source Extract", |ui| {
                            ui.label(
                                RichText::new(
                                    "This Phase 3 shell is derived from the pasted React console section: stat cards, radar, council debate, history/diff/logs tabs, and the active blueprint card.",
                                )
                                .size(13.0)
                                .color(Color32::from_rgb(203, 213, 225)),
                            );
                            ui.add_space(12.0);
                            ScrollArea::vertical().max_height(280.0).show(ui, |ui| {
                                ui.label(
                                    RichText::new(EXAMPLE_BLUEPRINT)
                                        .monospace()
                                        .size(11.0)
                                        .color(TEXT_MUTED),
                                );
                            });
                        });

                        ui.add_space(16.0);
                        card(ui, "Console Dependencies", |ui| {
                            dependency_row(ui, "eframe / egui", "Native Rust GUI shell");
                            dependency_row(ui, "maabarium-core::BlueprintFile", "Loads real workspace blueprint data");
                            dependency_row(ui, "blueprints/example.toml", "Feeds the Active Blueprint and metric radar");
                        });
                    });
                });
            });
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

fn draw_stats_row(ui: &mut Ui, cards: &[StatCard; 3], engine_running: &mut bool) {
    ui.horizontal(|ui| {
        let available = ui.available_width();
        let card_width = ((available - 24.0) / 4.0).max(180.0);

        for stat in cards {
            Frame::default()
                .fill(PANEL_FILL)
                .stroke(Stroke::new(1.0, PANEL_STROKE))
                .corner_radius(CornerRadius::same(16))
                .inner_margin(Margin::same(14))
                .show(ui, |ui| {
                    ui.set_min_width(card_width);
                    ui.horizontal(|ui| {
                        ui.vertical(|ui| {
                            ui.label(
                                RichText::new(stat.label)
                                    .size(10.0)
                                    .strong()
                                    .color(TEXT_MUTED),
                            );
                            ui.label(
                                RichText::new(stat.value)
                                    .size(28.0)
                                    .monospace()
                                    .strong()
                                    .color(Color32::WHITE),
                            );
                            ui.label(RichText::new(stat.trend).size(10.0).strong().color(
                                if stat.trend.starts_with('+') {
                                    EMERALD
                                } else {
                                    TEXT_MUTED
                                },
                            ));
                        });
                        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                            sparkline(ui, stat.sparkline, stat.color, vec2(74.0, 42.0));
                        });
                    });
                });
        }

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
                ui.set_min_width(card_width);
                ui.vertical_centered(|ui| {
                    ui.add_space(18.0);
                    if ui
                        .add_sized(
                            [card_width - 20.0, 48.0],
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
    });
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

fn council_panel(ui: &mut Ui, engine_running: bool) {
    Frame::default()
        .fill(Color32::from_rgb(2, 6, 23))
        .stroke(Stroke::new(1.0, Color32::from_gray(45)))
        .corner_radius(CornerRadius::same(12))
        .inner_margin(Margin::same(14))
        .show(ui, |ui| {
            agent_message(
                ui,
                "Strategist Agent",
                INDIGO,
                "The baseline prompt is too defensive. Relax token limits to allow richer reasoning steps without reducing guardrails.",
            );
            ui.add_space(12.0);
            ui.separator();
            ui.add_space(12.0);
            agent_message(
                ui,
                "Critic Agent",
                ROSE,
                "The last three experiments showed a 14% latency regression at higher token counts. Reject unless performance remains within budget.",
            );

            if engine_running {
                ui.add_space(12.0);
                badge(ui, "Active reasoning", EMERALD);
            }
        });
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
                ui.label(RichText::new(entry.summary).size(11.0).color(TEXT_MUTED));
                ui.end_row();
            }
        });
}

fn diff_view(ui: &mut Ui) {
    for (color, line) in [
        (EMERALD, "+ Optimized system instruction set for M4 NPU"),
        (ROSE, "- Removed deprecated reasoning anchors"),
        (
            TEXT_MUTED,
            "Iteration completed in 1.4s. Memory delta: -4MB. Branch promoted after council consensus.",
        ),
    ] {
        ui.label(RichText::new(line).monospace().size(12.0).color(color));
        ui.add_space(6.0);
    }
}

fn logs_view(ui: &mut Ui, engine_running: bool) {
    for line in [
        "[23:42:11] Loaded blueprint example-optimizer",
        "[23:42:12] Spawned strategist / optimizer / reviewer council",
        "[23:42:13] Evaluator ready: weighted_sum prompt analyzer",
    ] {
        ui.label(RichText::new(line).monospace().size(12.0).color(TEXT_MUTED));
        ui.add_space(4.0);
    }
    ui.label(
        RichText::new(if engine_running {
            "[23:42:14] Engine state changed: running"
        } else {
            "[23:42:14] Engine state changed: idle"
        })
        .monospace()
        .size(12.0)
        .color(if engine_running { EMERALD } else { TEXT_MUTED }),
    );
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

fn dependency_row(ui: &mut Ui, name: &str, detail: &str) {
    ui.horizontal_wrapped(|ui| {
        ui.label(RichText::new(name).strong().color(Color32::WHITE));
        ui.label(RichText::new("—").color(TEXT_MUTED));
        ui.label(RichText::new(detail).color(TEXT_MUTED));
    });
    ui.add_space(8.0);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn example_blueprint_loads_for_console() {
        let blueprint =
            BlueprintFile::load(&blueprint_path()).expect("example blueprint should load");
        assert_eq!(blueprint.blueprint.name, "example-optimizer");
        assert_eq!(blueprint.agents.council_size, 3);
    }

    #[test]
    fn console_history_includes_promoted_entry() {
        let app = MaabariumConsoleApp::new();
        assert!(app.history.iter().any(|entry| entry.promoted));
    }
}
