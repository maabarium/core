use async_trait::async_trait;
use chrono::Utc;
use futures::stream::{self, StreamExt};
use reqwest::{Client, Url};
use secrecy::ExposeSecret;
use serde::Deserialize;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{Mutex, Semaphore};
use tracing::{instrument, warn};

use crate::blueprint::MetricDef;
use crate::error::EvalError;
use crate::git_manager::{FilePatchOperation, Proposal};
use crate::secrets::SecretStore;

use super::{
    EvaluationContext, Evaluator, ExperimentResult, MetricScore, ResearchArtifacts, ResearchCitation,
    ResearchQueryTrace, ResearchSource,
};

pub struct ResearchEvaluator {
    client: Client,
    metrics: Vec<MetricDef>,
    discovery_provider: Option<DiscoveryProvider>,
    provider_hint: &'static str,
    topic_hint: Option<String>,
    verify_discovered_urls: bool,
}

enum DiscoveryProvider {
    Brave(BraveSearchProvider),
    DuckDuckGo(DuckDuckGoScrapeProvider),
}

struct BraveSearchProvider {
    client: Client,
    api_key: String,
}

struct DuckDuckGoScrapeProvider {
    client: Client,
}

#[derive(Debug, Deserialize)]
struct BraveSearchResponse {
    #[serde(default)]
    web: Option<BraveWebResults>,
}

#[derive(Debug, Deserialize, Default)]
struct BraveWebResults {
    #[serde(default)]
    results: Vec<BraveWebResult>,
}

#[derive(Debug, Deserialize)]
struct BraveWebResult {
    url: String,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    description: Option<String>,
}

const RESEARCH_SEARCH_PROVIDER_ENV: &str = "MAABARIUM_RESEARCH_SEARCH_PROVIDER";
const VERIFY_DISCOVERED_URLS_ENV: &str = "MAABARIUM_VERIFY_DISCOVERED_URLS";
const SCRAPER_FAILURE_MARKER: &str = "scraper_discovery";
const MAX_SOURCE_VERIFICATION_CONCURRENCY: usize = 6;
const MAX_SOURCE_VERIFICATION_PER_HOST: usize = 2;

#[derive(Clone)]
struct SourceVerificationRequest {
    url: String,
    label: Option<String>,
    fallback_title: Option<String>,
    citation_count: u32,
    host_key: String,
}

fn mark_discovery_error(provider_name: &str, message: String) -> String {
    if provider_name == "duckduckgo_html" {
        format!("[{SCRAPER_FAILURE_MARKER}] {message}")
    } else {
        message
    }
}

fn log_scraper_failure(stage: &str, query: &str, error: &str) {
    warn!(
        search_provider = "duckduckgo_html",
        marker = SCRAPER_FAILURE_MARKER,
        failure_stage = stage,
        query = %query,
        error = %error,
        "[scraper_discovery] DuckDuckGo HTML discovery failed"
    );
}

impl ResearchEvaluator {
    pub fn new(metrics: Vec<MetricDef>, topic_hint: Option<String>) -> Self {
        let brave_api_key = SecretStore::new()
            .resolve_api_key("brave", Some("BRAVE_SEARCH_API_KEY"))
            .ok()
            .flatten();
        let requested_provider = std::env::var(RESEARCH_SEARCH_PROVIDER_ENV).ok();
        let client = Client::new();
        let (discovery_provider, provider_hint) = match requested_provider.as_deref() {
            Some("brave_api") => (
                brave_api_key.map(|api_key| {
                    DiscoveryProvider::Brave(BraveSearchProvider {
                        client: Client::new(),
                        api_key: api_key.expose_secret().to_owned(),
                    })
                }),
                "brave_api",
            ),
            Some("duckduckgo_scrape") => (
                Some(DiscoveryProvider::DuckDuckGo(DuckDuckGoScrapeProvider {
                    client: Client::new(),
                })),
                "duckduckgo_scrape",
            ),
            _ => {
                if let Some(api_key) = brave_api_key {
                    (
                        Some(DiscoveryProvider::Brave(BraveSearchProvider {
                            client: Client::new(),
                            api_key: api_key.expose_secret().to_owned(),
                        })),
                        "brave_api",
                    )
                } else {
                    (
                        Some(DiscoveryProvider::DuckDuckGo(DuckDuckGoScrapeProvider {
                            client: Client::new(),
                        })),
                        "duckduckgo_scrape",
                    )
                }
            }
        };

        Self {
            client,
            metrics,
            discovery_provider,
            provider_hint,
            topic_hint: topic_hint
                .map(|value| value.trim().to_owned())
                .filter(|value| !value.is_empty()),
            verify_discovered_urls: env_flag_enabled(VERIFY_DISCOVERED_URLS_ENV, true),
        }
    }

    fn build_discovery_query(&self, proposal: &Proposal) -> Option<String> {
        let summary = proposal.summary.trim();
        if !summary.is_empty() {
            if let Some(query) = extract_search_query_from_summary(summary) {
                return Some(query);
            }

            if !is_unusable_discovery_summary(summary) {
                return Some(summary.to_owned());
            }
        }

        if let Some(topic_hint) = self.topic_hint.as_deref() {
            return Some(topic_hint.to_owned());
        }

        let patch_paths = proposal
            .file_patches
            .iter()
            .map(|patch| patch.path.as_str())
            .take(3)
            .collect::<Vec<_>>();
        if patch_paths.is_empty() {
            None
        } else {
            Some(format!("research context for {}", patch_paths.join(", ")))
        }
    }

    async fn discover_sources(
        &self,
        proposal: &Proposal,
    ) -> (Vec<ResearchSource>, Vec<ResearchQueryTrace>) {
        let Some(provider) = &self.discovery_provider else {
            return (Vec::new(), Vec::new());
        };

        let Some(query) = self.build_discovery_query(proposal) else {
            return (Vec::new(), Vec::new());
        };

        match provider.discover(&query).await {
            Ok((sources, trace)) => {
                let sources = if self.verify_discovered_urls {
                    self.verify_discovered_sources(sources).await
                } else {
                    sources
                };

                (sources, vec![trace])
            }
            Err(message) => {
                let provider_name = provider.name();
                let marked_message = mark_discovery_error(provider_name, message);
                (
                    Vec::new(),
                    vec![ResearchQueryTrace {
                        provider: provider_name.to_owned(),
                        query_text: query,
                        result_count: 0,
                        top_urls: Vec::new(),
                        latency_ms: 0,
                        executed_at: Utc::now().to_rfc3339(),
                        error: Some(marked_message),
                    }],
                )
            }
        }
    }

    fn collect_citations(&self, proposal: &Proposal) -> Vec<ResearchCitation> {
        let mut citations = Vec::new();
        let mut seen = BTreeSet::new();

        for patch in &proposal.file_patches {
            if matches!(patch.operation, FilePatchOperation::Delete) {
                continue;
            }

            let Some(content) = patch.content.as_deref() else {
                continue;
            };

            for (line_index, line) in content.lines().enumerate() {
                let line_number = (line_index + 1) as u32;
                let mut line_urls = BTreeSet::new();

                for citation in extract_markdown_link_citations(&patch.path, line, line_number) {
                    if seen.insert(citation_key(&citation)) {
                        line_urls.insert(citation.source_url.clone());
                        citations.push(citation);
                    }
                }

                for citation in
                    extract_bare_url_citations(&patch.path, line, line_number, &line_urls)
                {
                    if seen.insert(citation_key(&citation)) {
                        citations.push(citation);
                    }
                }
            }
        }

        citations
    }

    async fn build_sources(&self, citations: &[ResearchCitation]) -> Vec<ResearchSource> {
        let mut grouped = BTreeMap::<String, Vec<&ResearchCitation>>::new();
        for citation in citations {
            grouped
                .entry(citation.source_url.clone())
                .or_default()
                .push(citation);
        }

        let requests = grouped
            .into_iter()
            .map(|(url, records)| {
                let label = records
                    .iter()
                    .find_map(|citation| citation.label.clone())
                    .filter(|value| !value.trim().is_empty());
                SourceVerificationRequest {
                    host_key: source_host_key(&url),
                    url,
                    label,
                    fallback_title: None,
                    citation_count: records.len() as u32,
                }
            })
            .collect::<Vec<_>>();

        self.verify_source_requests(requests).await
    }

    async fn verify_discovered_sources(
        &self,
        discovered_sources: Vec<ResearchSource>,
    ) -> Vec<ResearchSource> {
        let requests = discovered_sources
            .into_iter()
            .map(|source| SourceVerificationRequest {
                host_key: source_host_key(&source.url),
                url: source.url,
                label: source.label,
                fallback_title: source.title,
                citation_count: source.citation_count,
            })
            .collect::<Vec<_>>();

        self.verify_source_requests(requests).await
    }

    fn merge_sources(
        &self,
        mut verified_sources: Vec<ResearchSource>,
        discovered_sources: Vec<ResearchSource>,
    ) -> Vec<ResearchSource> {
        let mut known_urls = verified_sources
            .iter()
            .map(|source| source.url.clone())
            .collect::<BTreeSet<_>>();

        for source in discovered_sources {
            if known_urls.insert(source.url.clone()) {
                verified_sources.push(source);
            }
        }

        verified_sources
    }

    async fn verify_source_requests(
        &self,
        requests: Vec<SourceVerificationRequest>,
    ) -> Vec<ResearchSource> {
        let total_limit = Arc::new(Semaphore::new(MAX_SOURCE_VERIFICATION_CONCURRENCY));
        let host_limits = Arc::new(Mutex::new(
            HashMap::<String, Arc<Semaphore>>::new(),
        ));

        stream::iter(requests.into_iter().map(|request| {
            let total_limit = Arc::clone(&total_limit);
            let host_limits = Arc::clone(&host_limits);

            async move {
                let _total_permit = total_limit
                    .acquire_owned()
                    .await
                    .expect("source verification semaphore should remain open");
                let host_limit = {
                    let mut limits = host_limits.lock().await;
                    limits
                        .entry(request.host_key.clone())
                        .or_insert_with(|| {
                            Arc::new(Semaphore::new(MAX_SOURCE_VERIFICATION_PER_HOST))
                        })
                        .clone()
                };
                let _host_permit = host_limit
                    .acquire_owned()
                    .await
                    .expect("host verification semaphore should remain open");

                self.build_verified_source(
                    &request.url,
                    request.label,
                    request.fallback_title,
                    request.citation_count,
                )
                .await
            }
        }))
        .buffered(MAX_SOURCE_VERIFICATION_CONCURRENCY)
        .collect()
        .await
    }

    async fn build_verified_source(
        &self,
        url: &str,
        label: Option<String>,
        fallback_title: Option<String>,
        citation_count: u32,
    ) -> ResearchSource {
        let parsed_url = Url::parse(url).ok();
        let host = parsed_url
            .as_ref()
            .and_then(Url::host_str)
            .map(str::to_owned);

        let response = tokio::time::timeout(
            Duration::from_secs(10),
            self.client
                .get(url)
                .header(
                    reqwest::header::USER_AGENT,
                    "maabarium-research-evaluator/0.1",
                )
                .send(),
        )
        .await;

        match response {
            Ok(Ok(response)) => {
                let status_code = Some(response.status().as_u16());
                let verified = response.status().is_success();
                let final_url = Some(response.url().to_string());
                let body = tokio::time::timeout(Duration::from_secs(5), response.text())
                    .await
                    .ok()
                    .and_then(Result::ok)
                    .unwrap_or_default();

                ResearchSource {
                    url: url.to_owned(),
                    final_url,
                    host,
                    label,
                    title: extract_html_title(&body).or(fallback_title),
                    citation_count,
                    verified,
                    status_code,
                    fetch_error: None,
                }
            }
            Ok(Err(error)) => ResearchSource {
                url: url.to_owned(),
                final_url: None,
                host,
                label,
                title: fallback_title,
                citation_count,
                verified: false,
                status_code: None,
                fetch_error: Some(error.to_string()),
            },
            Err(_) => ResearchSource {
                url: url.to_owned(),
                final_url: None,
                host,
                label,
                title: fallback_title,
                citation_count,
                verified: false,
                status_code: None,
                fetch_error: Some("source verification timed out".to_owned()),
            },
        }
    }

    fn score_metric(
        &self,
        metric: &MetricDef,
        proposal: &Proposal,
        citations: &[ResearchCitation],
        sources: &[ResearchSource],
    ) -> f64 {
        let source_count_score = (sources.len() as f64 / 5.0).clamp(0.0, 1.0);
        let citation_count_score = (citations.len() as f64 / 8.0).clamp(0.0, 1.0);
        let verified_ratio = if sources.is_empty() {
            0.0
        } else {
            sources.iter().filter(|source| source.verified).count() as f64 / sources.len() as f64
        };
        let https_ratio = if sources.is_empty() {
            0.0
        } else {
            sources
                .iter()
                .filter(|source| source.url.starts_with("https://"))
                .count() as f64
                / sources.len() as f64
        };
        let distinct_hosts = sources
            .iter()
            .filter_map(|source| source.host.as_deref())
            .collect::<BTreeSet<_>>()
            .len();
        let host_diversity = if sources.is_empty() {
            0.0
        } else {
            distinct_hosts as f64 / sources.len() as f64
        };
        let cited_files = citations
            .iter()
            .map(|citation| citation.file_path.as_str())
            .collect::<BTreeSet<_>>()
            .len();
        let modified_files = proposal
            .file_patches
            .iter()
            .filter(|patch| !matches!(patch.operation, FilePatchOperation::Delete))
            .count();
        let file_coverage = if modified_files == 0 {
            0.0
        } else {
            cited_files as f64 / modified_files as f64
        };
        let summary_signal =
            (proposal.summary.split_whitespace().count() as f64 / 28.0).clamp(0.2, 1.0);
        let metric_name = metric.name.to_ascii_lowercase();

        let value = if metric_name.contains("citation") {
            (file_coverage * 0.6) + (citation_count_score * 0.4)
        } else if metric_name.contains("source") {
            (verified_ratio * 0.45) + (host_diversity * 0.25) + (https_ratio * 0.3)
        } else if metric_name.contains("ground") || metric_name.contains("fact") {
            (verified_ratio * 0.5) + (source_count_score * 0.2) + (file_coverage * 0.3)
        } else if metric_name.contains("synth") || metric_name.contains("summary") {
            (summary_signal * 0.45) + (source_count_score * 0.25) + (file_coverage * 0.3)
        } else {
            (source_count_score * 0.25)
                + (citation_count_score * 0.2)
                + (verified_ratio * 0.25)
                + (host_diversity * 0.15)
                + (summary_signal * 0.15)
        };

        value.clamp(0.0, 1.0)
    }
}

fn source_host_key(url: &str) -> String {
    Url::parse(url)
        .ok()
        .and_then(|parsed| parsed.host_str().map(str::to_owned))
        .unwrap_or_else(|| "unknown-host".to_owned())
}

fn extract_search_query_from_summary(summary: &str) -> Option<String> {
    let lowered = summary.to_ascii_lowercase();
    if let Some(search_index) = lowered.find("search for") {
        let search_slice = &summary[search_index + "search for".len()..];
        if let Some(query) = extract_quoted_phrase(search_slice) {
            return Some(query);
        }

        let candidate = search_slice
            .split(['.', '\n'])
            .next()
            .map(str::trim)
            .unwrap_or_default()
            .trim_start_matches(':')
            .trim();
        if !candidate.is_empty() {
            return Some(candidate.to_owned());
        }
    }

    extract_quoted_phrase(summary)
}

fn is_unusable_discovery_summary(summary: &str) -> bool {
    let lowered = summary.to_ascii_lowercase();

    lowered.contains("no existing target files were found")
        || lowered.contains("return an empty file_patches array")
        || lowered.contains("insufficient evidence to create a new patch")
}

fn extract_quoted_phrase(input: &str) -> Option<String> {
    for delimiter in ['\'', '"'] {
        if let Some(start) = input.find(delimiter) {
            let remainder = &input[start + delimiter.len_utf8()..];
            if let Some(end) = remainder.find(delimiter) {
                let candidate = remainder[..end].trim();
                if !candidate.is_empty() {
                    return Some(candidate.to_owned());
                }
            }
        }
    }

    None
}

#[async_trait]
impl Evaluator for ResearchEvaluator {
    #[instrument(
        name = "research_evaluator_evaluate",
        skip(self, proposal),
        fields(iteration = iteration, patch_count = proposal.file_patches.len())
    )]
    async fn evaluate(
        &self,
        proposal: &Proposal,
        iteration: u64,
        _context: &EvaluationContext,
    ) -> Result<ExperimentResult, EvalError> {
        let start = std::time::Instant::now();
        let citations = self.collect_citations(proposal);
        let (discovered_sources, query_traces) = self.discover_sources(proposal).await;
        let verified_sources = self.build_sources(&citations).await;
        let sources = self.merge_sources(verified_sources, discovered_sources);

        if citations.is_empty() && sources.is_empty() {
            let message = if self.discovery_provider.is_some() {
                "research proposals must include at least one external citation URL or a resolvable discovery query"
            } else if self.provider_hint == "brave_api" {
                "research proposals must include at least one external citation URL; Brave Search is selected but not configured, so resolvable discovery queries are unavailable until BRAVE_SEARCH_API_KEY is set"
            } else {
                "research proposals must include at least one external citation URL or a resolvable discovery query"
            };
            return Err(EvalError::Parse(message.to_owned()));
        }

        let scores = self
            .metrics
            .iter()
            .map(|metric| MetricScore {
                name: metric.name.clone(),
                value: self.score_metric(metric, proposal, &citations, &sources),
                weight: metric.weight,
            })
            .collect::<Vec<_>>();
        let weighted_total = ExperimentResult::compute_weighted_total(&scores);

        Ok(ExperimentResult {
            iteration,
            proposal: proposal.clone(),
            scores,
            weighted_total,
            duration_ms: start.elapsed().as_millis() as u64,
            research: Some(ResearchArtifacts {
                sources,
                citations,
                query_traces,
            }),
            lora: None,
        })
    }
}

impl DiscoveryProvider {
    async fn discover(
        &self,
        query: &str,
    ) -> Result<(Vec<ResearchSource>, ResearchQueryTrace), String> {
        match self {
            DiscoveryProvider::Brave(provider) => provider.discover(query).await,
            DiscoveryProvider::DuckDuckGo(provider) => provider.discover(query).await,
        }
    }

    fn name(&self) -> &'static str {
        match self {
            DiscoveryProvider::Brave(_) => "brave",
            DiscoveryProvider::DuckDuckGo(_) => "duckduckgo_html",
        }
    }
}

impl BraveSearchProvider {
    async fn discover(
        &self,
        query: &str,
    ) -> Result<(Vec<ResearchSource>, ResearchQueryTrace), String> {
        let started = std::time::Instant::now();
        let response = self
            .client
            .get("https://api.search.brave.com/res/v1/web/search")
            .header("X-Subscription-Token", &self.api_key)
            .query(&[("q", query), ("count", "5")])
            .send()
            .await
            .map_err(|error| format!("Failed to query Brave Search: {error}"))?
            .error_for_status()
            .map_err(|error| format!("Brave Search rejected the query: {error}"))?;

        let payload = response
            .json::<BraveSearchResponse>()
            .await
            .map_err(|error| format!("Failed to parse Brave Search response: {error}"))?;

        let mut sources = Vec::new();
        let mut top_urls = Vec::new();
        for result in payload.web.unwrap_or_default().results {
            let parsed_url = Url::parse(&result.url).ok();
            top_urls.push(result.url.clone());
            sources.push(ResearchSource {
                url: result.url,
                final_url: None,
                host: parsed_url
                    .as_ref()
                    .and_then(Url::host_str)
                    .map(str::to_owned),
                label: result.description,
                title: result.title,
                citation_count: 0,
                verified: false,
                status_code: None,
                fetch_error: None,
            });
        }

        Ok((
            sources,
            ResearchQueryTrace {
                provider: "brave".to_owned(),
                query_text: query.to_owned(),
                result_count: top_urls.len() as u32,
                top_urls,
                latency_ms: started.elapsed().as_millis() as u64,
                executed_at: Utc::now().to_rfc3339(),
                error: None,
            },
        ))
    }
}

impl DuckDuckGoScrapeProvider {
    async fn discover(
        &self,
        query: &str,
    ) -> Result<(Vec<ResearchSource>, ResearchQueryTrace), String> {
        let started = std::time::Instant::now();
        let response = self
            .client
            .get("https://html.duckduckgo.com/html/")
            .header(
                reqwest::header::USER_AGENT,
                "maabarium-research-evaluator/0.1",
            )
            .query(&[("q", query)])
            .send()
            .await
            .map_err(|error| {
                let message = format!("Failed to query DuckDuckGo HTML search: {error}");
                log_scraper_failure("request", query, &message);
                message
            })?
            .error_for_status()
            .map_err(|error| {
                let message = format!("DuckDuckGo HTML search rejected the query: {error}");
                log_scraper_failure("status", query, &message);
                message
            })?;

        let body = response
            .text()
            .await
            .map_err(|error| {
                let message = format!("Failed to read DuckDuckGo HTML search response: {error}");
                log_scraper_failure("response_body", query, &message);
                message
            })?;
        let parsed_results = parse_duckduckgo_results(&body);
        if parsed_results.is_empty() {
            log_scraper_failure(
                "parse_empty",
                query,
                "DuckDuckGo HTML response produced no parseable results; the upstream layout may have changed or the request may have been blocked",
            );
        }
        let mut sources = Vec::new();
        let mut top_urls = Vec::new();

        for result in parsed_results.into_iter().take(5) {
            let parsed_url = Url::parse(&result.url).ok();
            top_urls.push(result.url.clone());
            sources.push(ResearchSource {
                url: result.url,
                final_url: None,
                host: parsed_url
                    .as_ref()
                    .and_then(Url::host_str)
                    .map(str::to_owned),
                label: result.snippet,
                title: Some(result.title),
                citation_count: 0,
                verified: false,
                status_code: None,
                fetch_error: None,
            });
        }

        Ok((
            sources,
            ResearchQueryTrace {
                provider: "duckduckgo_html".to_owned(),
                query_text: query.to_owned(),
                result_count: top_urls.len() as u32,
                top_urls,
                latency_ms: started.elapsed().as_millis() as u64,
                executed_at: Utc::now().to_rfc3339(),
                error: None,
            },
        ))
    }
}

struct DuckDuckGoSearchResult {
    url: String,
    title: String,
    snippet: Option<String>,
}

fn parse_duckduckgo_results(body: &str) -> Vec<DuckDuckGoSearchResult> {
    let mut results = Vec::new();
    let mut cursor = 0usize;

    while let Some(class_offset) = body[cursor..].find("result__a") {
        let class_index = cursor + class_offset;
        let Some(anchor_start) = body[..class_index].rfind("<a ") else {
            cursor = class_index + "result__a".len();
            continue;
        };
        let Some(href_offset) = body[anchor_start..].find("href=\"") else {
            cursor = class_index + "result__a".len();
            continue;
        };
        let href_start = anchor_start + href_offset + 6;
        let Some(href_end_rel) = body[href_start..].find('"') else {
            break;
        };
        let href_end = href_start + href_end_rel;
        let raw_href = &body[href_start..href_end];

        let Some(title_start_rel) = body[href_end..].find('>') else {
            break;
        };
        let title_start = href_end + title_start_rel + 1;
        let Some(title_end_rel) = body[title_start..].find("</a>") else {
            break;
        };
        let title_end = title_start + title_end_rel;

        let Some(url) = decode_duckduckgo_result_url(raw_href) else {
            cursor = title_end + 4;
            continue;
        };

        let snippet = body[title_end..]
            .find("result__snippet")
            .and_then(|snippet_class_offset| {
                let snippet_class_index = title_end + snippet_class_offset;
                let snippet_open_end = body[snippet_class_index..].find('>')? + snippet_class_index + 1;
                let snippet_close = body[snippet_open_end..].find("</")? + snippet_open_end;
                Some(clean_html_text(&body[snippet_open_end..snippet_close]))
            })
            .filter(|value| !value.is_empty());

        results.push(DuckDuckGoSearchResult {
            url,
            title: clean_html_text(&body[title_start..title_end]),
            snippet,
        });
        cursor = title_end + 4;
    }

    results
}

fn decode_duckduckgo_result_url(raw_href: &str) -> Option<String> {
    if raw_href.starts_with("http://") || raw_href.starts_with("https://") {
        return Some(raw_href.to_owned());
    }

    let absolute = Url::parse("https://html.duckduckgo.com")
        .ok()?
        .join(raw_href)
        .ok()?;
    absolute
        .query_pairs()
        .find(|(key, _)| key == "uddg")
        .map(|(_, value)| value.into_owned())
}

fn clean_html_text(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let mut in_tag = false;
    let mut chars = input.chars().peekable();

    while let Some(ch) = chars.next() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            '&' if !in_tag => {
                let mut entity = String::new();
                while let Some(next) = chars.peek().copied() {
                    entity.push(next);
                    chars.next();
                    if next == ';' || entity.len() > 10 {
                        break;
                    }
                }
                output.push_str(match entity.as_str() {
                    "amp;" => "&",
                    "quot;" => "\"",
                    "apos;" => "'",
                    "lt;" => "<",
                    "gt;" => ">",
                    _ => " ",
                });
            }
            _ if !in_tag => output.push(ch),
            _ => {}
        }
    }

    output.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn citation_key(citation: &ResearchCitation) -> String {
    format!(
        "{}:{}:{}:{}",
        citation.file_path,
        citation.line_number,
        citation.source_url,
        citation.label.clone().unwrap_or_default()
    )
}

fn extract_markdown_link_citations(
    file_path: &str,
    line: &str,
    line_number: u32,
) -> Vec<ResearchCitation> {
    let mut citations = Vec::new();
    let mut cursor = 0usize;

    while let Some(open_rel) = line[cursor..].find('[') {
        let open = cursor + open_rel;
        let Some(mid_rel) = line[open + 1..].find("](") else {
            break;
        };
        let mid = open + 1 + mid_rel;
        let Some(close_rel) = line[mid + 2..].find(')') else {
            break;
        };
        let close = mid + 2 + close_rel;

        let label = line[open + 1..mid].trim();
        let url = line[mid + 2..close].trim();
        if is_external_url(url) {
            citations.push(ResearchCitation {
                file_path: file_path.to_owned(),
                source_url: normalize_url(url),
                label: (!label.is_empty()).then(|| label.to_owned()),
                line_number,
                snippet: summarize_snippet(line),
            });
        }

        cursor = close + 1;
    }

    citations
}

fn extract_bare_url_citations(
    file_path: &str,
    line: &str,
    line_number: u32,
    existing_urls: &BTreeSet<String>,
) -> Vec<ResearchCitation> {
    let mut citations = Vec::new();
    let mut cursor = 0usize;

    while let Some(start_rel) = find_http_start(&line[cursor..]) {
        let start = cursor + start_rel;
        let end = line[start..]
            .find(|ch: char| ch.is_whitespace() || matches!(ch, '"' | '\'' | '<' | '>'))
            .map(|offset| start + offset)
            .unwrap_or(line.len());
        let normalized = normalize_url(&line[start..end]);
        if is_external_url(&normalized) && !existing_urls.contains(&normalized) {
            citations.push(ResearchCitation {
                file_path: file_path.to_owned(),
                source_url: normalized,
                label: None,
                line_number,
                snippet: summarize_snippet(line),
            });
        }
        cursor = end;
    }

    citations
}

fn find_http_start(input: &str) -> Option<usize> {
    let http = input.find("http://");
    let https = input.find("https://");
    match (http, https) {
        (Some(left), Some(right)) => Some(left.min(right)),
        (Some(left), None) => Some(left),
        (None, Some(right)) => Some(right),
        (None, None) => None,
    }
}

fn is_external_url(url: &str) -> bool {
    url.starts_with("http://") || url.starts_with("https://")
}

fn normalize_url(url: &str) -> String {
    url.trim_end_matches(|ch: char| matches!(ch, '.' | ',' | ';' | ':' | ')' | ']' | '}'))
        .to_owned()
}

fn summarize_snippet(line: &str) -> String {
    let normalized = line.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.len() > 220 {
        format!("{}...", &normalized[..217])
    } else {
        normalized
    }
}

fn extract_html_title(body: &str) -> Option<String> {
    let lower = body.to_ascii_lowercase();
    let start = lower.find("<title>")? + "<title>".len();
    let end = lower[start..].find("</title>")? + start;
    let title = body[start..end].trim();
    (!title.is_empty()).then(|| title.to_owned())
}

fn env_flag_enabled(key: &str, default: bool) -> bool {
    match std::env::var(key) {
        Ok(value) => {
            let value = value.trim().to_ascii_lowercase();
            !matches!(value.as_str(), "0" | "false" | "no" | "off")
        }
        Err(_) => default,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git_manager::{FilePatch, FilePatchOperation};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    fn research_metric(name: &str) -> MetricDef {
        MetricDef {
            name: name.to_owned(),
            weight: 1.0,
            direction: "maximize".to_owned(),
            description: name.to_owned(),
        }
    }

    #[test]
    fn extracts_markdown_and_bare_url_citations() {
        let evaluator = ResearchEvaluator::new(vec![research_metric("citation_coverage")], None);
        let proposal = Proposal {
            summary: "Research storage trade-offs".to_owned(),
            file_patches: vec![FilePatch {
                path: "docs/research.md".to_owned(),
                operation: FilePatchOperation::Modify,
                content: Some(
                    "See [SQLite docs](https://sqlite.org/index.html). Also compare https://www.rust-lang.org/.".to_owned(),
                ),
            }],
        };

        let citations = evaluator.collect_citations(&proposal);
        assert_eq!(citations.len(), 2);
        assert_eq!(citations[0].line_number, 1);
        assert!(
            citations
                .iter()
                .any(|citation| citation.source_url.contains("sqlite.org"))
        );
        assert!(
            citations
                .iter()
                .any(|citation| citation.source_url.contains("rust-lang.org"))
        );
    }

    #[tokio::test]
    async fn evaluates_research_with_verified_sources() {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("listener should bind");
        let address = listener.local_addr().expect("address should be available");

        tokio::spawn(async move {
            loop {
                let Ok((mut stream, _)) = listener.accept().await else {
                    break;
                };
                let mut buffer = [0_u8; 1024];
                let _ = stream.read(&mut buffer).await;
                let response = b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 62\r\n\r\n<html><head><title>Example Source</title></head><body>ok</body></html>";
                let _ = stream.write_all(response).await;
            }
        });

        let evaluator = ResearchEvaluator::new(vec![research_metric("factual_grounding")], None);
        let proposal = Proposal {
            summary: "Draft a researched note with citations".to_owned(),
            file_patches: vec![FilePatch {
                path: "docs/research.md".to_owned(),
                operation: FilePatchOperation::Modify,
                content: Some(format!(
                    "A sourced statement with [Example](http://{}/source).",
                    address
                )),
            }],
        };

        let result = evaluator
            .evaluate(&proposal, 1, &EvaluationContext::default())
            .await
            .expect("research evaluation should succeed");

        let research = result
            .research
            .expect("research metadata should be present");
        assert_eq!(research.citations.len(), 1);
        assert!(research.sources.iter().any(|source| source.verified));
        assert!(research.sources.iter().any(|source| {
            source.verified && source.title.as_deref() == Some("Example Source")
        }));
    }

    #[tokio::test]
    async fn verifies_discovered_sources_before_merging() {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("listener should bind");
        let address = listener.local_addr().expect("address should be available");

        tokio::spawn(async move {
            loop {
                let Ok((mut stream, _)) = listener.accept().await else {
                    break;
                };
                let mut buffer = [0_u8; 1024];
                let _ = stream.read(&mut buffer).await;
                let response = b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 69\r\n\r\n<html><head><title>Discovered Source</title></head><body>ok</body></html>";
                let _ = stream.write_all(response).await;
            }
        });

        let evaluator = ResearchEvaluator::new(vec![research_metric("source_quality")], None);
        let discovered_sources = vec![ResearchSource {
            url: format!("http://{address}/result"),
            final_url: None,
            host: Some(address.ip().to_string()),
            label: Some("Search result summary".to_owned()),
            title: Some("Fallback Search Title".to_owned()),
            citation_count: 0,
            verified: false,
            status_code: None,
            fetch_error: None,
        }];

        let verified_sources = evaluator.verify_discovered_sources(discovered_sources).await;

        assert_eq!(verified_sources.len(), 1);
        assert!(verified_sources[0].verified);
        assert_eq!(verified_sources[0].title.as_deref(), Some("Discovered Source"));
        assert_eq!(verified_sources[0].status_code, Some(200));
    }

    #[test]
    fn extracts_search_query_from_refusal_style_summary() {
        let summary = "No patch generated. The runtime note indicates DuckDuckGo HTML scrape fallback is active. A search for 'local-first AI workflow consoles' would be required to find evidence-backed strengths and trade-offs.";
        assert_eq!(
            extract_search_query_from_summary(summary).as_deref(),
            Some("local-first AI workflow consoles")
        );
    }

    #[test]
    fn falls_back_to_any_quoted_phrase_in_summary() {
        let summary = "Evidence is weak, but the topic \"adapter packaging best practices\" is likely the right follow-up query.";
        assert_eq!(
            extract_search_query_from_summary(summary).as_deref(),
            Some("adapter packaging best practices")
        );
    }

    #[test]
    fn ignores_empty_target_refusals_and_uses_topic_hint() {
        let evaluator = ResearchEvaluator::new(
            vec![research_metric("source_quality")],
            Some("Research the best way to perfect cake icing.".to_owned()),
        );
        let proposal = Proposal {
            summary: "No existing target files were found, and there is insufficient evidence to create a new patch.".to_owned(),
            file_patches: Vec::new(),
        };

        assert_eq!(
            evaluator.build_discovery_query(&proposal).as_deref(),
            Some("Research the best way to perfect cake icing.")
        );
    }
}
