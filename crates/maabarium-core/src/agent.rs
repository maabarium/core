use std::sync::Arc;
use crate::error::LLMError;
use crate::llm::{LLMProvider, CompletionRequest};
use crate::git_manager::Proposal;
use crate::blueprint::{AgentDef, MetricDef};

pub struct Agent {
    def: AgentDef,
    llm: Arc<dyn LLMProvider>,
}

impl Agent {
    pub fn new(def: AgentDef, llm: Arc<dyn LLMProvider>) -> Self {
        Self { def, llm }
    }

    pub async fn propose(
        &self,
        context: &str,
        metrics: &[MetricDef],
    ) -> Result<Proposal, LLMError> {
        let metrics_desc = metrics
            .iter()
            .map(|m| format!("- {} ({}): {}", m.name, m.direction, m.description))
            .collect::<Vec<_>>()
            .join("\n");
        let prompt = format!(
            "Context:\n{context}\n\nMetrics to optimize:\n{metrics_desc}\n\n\
             Propose a specific, actionable improvement. Describe the change concisely."
        );
        let req = CompletionRequest {
            system: self.def.system_prompt.clone(),
            prompt,
            temperature: 0.7,
            max_tokens: 512,
        };
        let resp = self.llm.complete(&req).await?;
        Ok(Proposal {
            summary: resp.content.trim().to_owned(),
            file_patches: vec![],
        })
    }

    pub async fn debate(
        &self,
        proposal: &Proposal,
        other_proposals: &[Proposal],
    ) -> Result<String, LLMError> {
        let others = other_proposals
            .iter()
            .map(|p| format!("- {}", p.summary))
            .collect::<Vec<_>>()
            .join("\n");
        let prompt = format!(
            "Your proposal: {}\n\nOther proposals:\n{others}\n\n\
             Critique the other proposals and defend yours briefly.",
            proposal.summary
        );
        let req = CompletionRequest {
            system: self.def.system_prompt.clone(),
            prompt,
            temperature: 0.5,
            max_tokens: 256,
        };
        let resp = self.llm.complete(&req).await?;
        Ok(resp.content.trim().to_owned())
    }

    pub fn name(&self) -> &str {
        &self.def.name
    }
}

pub struct Council {
    agents: Vec<Agent>,
    debate_rounds: u32,
}

impl Council {
    pub fn new(agents: Vec<Agent>, debate_rounds: u32) -> Self {
        Self { agents, debate_rounds }
    }

    pub async fn run(
        &self,
        context: &str,
        metrics: &[MetricDef],
    ) -> Result<Proposal, LLMError> {
        if self.agents.is_empty() {
            return Err(LLMError::Provider("Council has no agents".into()));
        }

        let mut proposals = Vec::new();
        for agent in &self.agents {
            match agent.propose(context, metrics).await {
                Ok(p) => proposals.push(p),
                Err(e) => {
                    tracing::warn!("Agent '{}' failed to propose: {e}", agent.name());
                }
            }
        }

        if proposals.is_empty() {
            return Err(LLMError::Provider("All agents failed to propose".into()));
        }

        for _round in 0..self.debate_rounds {
            for (i, agent) in self.agents.iter().enumerate() {
                if i >= proposals.len() {
                    break;
                }
                let others: Vec<Proposal> = proposals
                    .iter()
                    .enumerate()
                    .filter(|(j, _)| *j != i)
                    .map(|(_, p)| p.clone())
                    .collect();
                // The debate critique is logged via tracing but does not currently
                // mutate the proposal. In Phase 2 this will feed back into a
                // synthesis step that produces a refined consensus proposal.
                if let Ok(critique) = agent.debate(&proposals[i], &others).await {
                    tracing::debug!(
                        agent = agent.name(),
                        critique = %critique,
                        "Debate round critique"
                    );
                }
            }
        }

        Ok(proposals.remove(0))
    }
}
