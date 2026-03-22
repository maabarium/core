use async_trait::async_trait;
use reqwest::{Client, Url};
use std::collections::{BTreeMap, BTreeSet};
use std::time::Duration;
use tracing::instrument;

use crate::blueprint::MetricDef;
use crate::error::EvalError;
use crate::git_manager::{FilePatchOperation, Proposal};

use super::{
    Evaluator, ExperimentResult, MetricScore, ResearchArtifacts, ResearchCitation, ResearchSource,
};

pub struct ResearchEvaluator {
    client: Client,
    metrics: Vec<MetricDef>,
}

impl ResearchEvaluator {
    pub fn new(metrics: Vec<MetricDef>) -> Self {
        Self {
            client: Client::new(),
            metrics,
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

        let mut sources = Vec::with_capacity(grouped.len());
        for (url, records) in grouped {
            sources.push(self.verify_source(&url, &records).await);
        }

        sources
    }

    async fn verify_source(&self, url: &str, citations: &[&ResearchCitation]) -> ResearchSource {
        let label = citations
            .iter()
            .find_map(|citation| citation.label.clone())
            .filter(|value| !value.trim().is_empty());
        let citation_count = citations.len() as u32;
        let parsed_url = Url::parse(url).ok();
        let host = parsed_url
            .as_ref()
            .and_then(Url::host_str)
            .map(str::to_owned);

        let response = tokio::time::timeout(
            Duration::from_secs(10),
            self.client
                .get(url)
                .header(reqwest::header::USER_AGENT, "maabarium-research-evaluator/0.1")
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
                    title: extract_html_title(&body),
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
                title: None,
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
                title: None,
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
    ) -> Result<ExperimentResult, EvalError> {
        let start = std::time::Instant::now();
        let citations = self.collect_citations(proposal);
        if citations.is_empty() {
            return Err(EvalError::Parse(
                "research proposals must include at least one external citation URL in the proposed content"
                    .to_owned(),
            ));
        }

        let sources = self.build_sources(&citations).await;
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
            research: Some(ResearchArtifacts { sources, citations }),
        })
    }
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
        let evaluator = ResearchEvaluator::new(vec![research_metric("citation_coverage")]);
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
        assert!(citations.iter().any(|citation| citation.source_url.contains("sqlite.org")));
        assert!(citations.iter().any(|citation| citation.source_url.contains("rust-lang.org")));
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

        let evaluator = ResearchEvaluator::new(vec![research_metric("factual_grounding")]);
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
            .evaluate(&proposal, 1)
            .await
            .expect("research evaluation should succeed");

        let research = result.research.expect("research metadata should be present");
        assert_eq!(research.citations.len(), 1);
        assert_eq!(research.sources.len(), 1);
        assert!(research.sources[0].verified);
        assert_eq!(research.sources[0].title.as_deref(), Some("Example Source"));
    }
}