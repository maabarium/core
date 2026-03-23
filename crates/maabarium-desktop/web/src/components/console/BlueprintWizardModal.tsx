import type { Dispatch, SetStateAction } from "react";
import {
  applyWizardTemplate,
  wizardTemplateDefaults,
} from "../../lib/blueprints";
import type {
  BlueprintWizardForm,
  WizardAgentForm,
  WizardMetricForm,
  WizardModelForm,
  WizardTemplate,
} from "../../types/console";

type BlueprintWizardModalProps = {
  open: boolean;
  isCreating: boolean;
  isEngineRunning: boolean;
  form: BlueprintWizardForm;
  metricWeightTotal: number;
  modelNames: string[];
  setForm: Dispatch<SetStateAction<BlueprintWizardForm>>;
  addMetric: () => void;
  updateMetric: (
    index: number,
    field: keyof WizardMetricForm,
    value: string | number,
  ) => void;
  removeMetric: (index: number) => void;
  addAgent: () => void;
  updateAgent: (
    index: number,
    field: keyof WizardAgentForm,
    value: string,
  ) => void;
  removeAgent: (index: number) => void;
  addModel: () => void;
  updateModel: (
    index: number,
    field: keyof WizardModelForm,
    value: string | number,
  ) => void;
  removeModel: (index: number) => void;
  onClose: () => void;
  onCreate: () => void;
};

export function BlueprintWizardModal({
  open,
  isCreating,
  isEngineRunning,
  form,
  metricWeightTotal,
  modelNames,
  setForm,
  addMetric,
  updateMetric,
  removeMetric,
  addAgent,
  updateAgent,
  removeAgent,
  addModel,
  updateModel,
  removeModel,
  onClose,
  onCreate,
}: BlueprintWizardModalProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[140] overflow-y-auto bg-slate-950/80 px-4 py-8 backdrop-blur-sm">
      <div className="mx-auto max-w-5xl">
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-950/95 shadow-2xl">
          <div className="flex items-start justify-between gap-6 border-b border-white/5 bg-white/5 px-6 py-4">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.24em] text-amber-200">
                Blueprint Wizard
              </div>
              <h2 className="mt-2 text-2xl font-black tracking-tight text-white">
                Create a valid starter blueprint
              </h2>
              <p className="mt-2 max-w-2xl text-sm text-slate-400">
                Start from a template, generate a working TOML file in the
                blueprints directory, and load it immediately. Direct file
                loading stays available for manual edits.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={isCreating}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-black uppercase tracking-[0.18em] text-slate-300 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-70"
            >
              Close
            </button>
          </div>

          <div className="space-y-6 p-6">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {(
                [
                  "code_quality",
                  "product_builder",
                  "general_research",
                  "prompt_optimization",
                  "lora_validation",
                  "custom",
                ] as WizardTemplate[]
              ).map((template) => {
                const defaults = wizardTemplateDefaults(template);
                const active = form.template === template;

                return (
                  <button
                    key={template}
                    type="button"
                    onClick={() =>
                      setForm((current) =>
                        applyWizardTemplate(current, template),
                      )
                    }
                    className={`rounded-xl border px-4 py-4 text-left transition ${active ? "border-amber-400/40 bg-amber-500/10" : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"}`}
                  >
                    <div className="text-sm font-semibold text-slate-100">
                      {defaults.label}
                    </div>
                    <div className="mt-2 text-xs leading-relaxed text-slate-400">
                      {defaults.description}
                    </div>
                    <div className="mt-3 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                      {defaults.language} • {defaults.targetFiles[0]}
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.35fr)]">
              <div className="space-y-4">
                <div>
                  <label className="mb-2 block text-[10px] font-bold uppercase tracking-widest text-slate-500">
                    Blueprint Name
                  </label>
                  <input
                    value={form.name}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        name: event.target.value,
                      }))
                    }
                    placeholder="my-awesome-blueprint"
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-sm text-slate-100 outline-none focus:border-teal-400/60"
                    type="text"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-[10px] font-bold uppercase tracking-widest text-slate-500">
                    Description
                  </label>
                  <textarea
                    value={form.description}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        description: event.target.value,
                      }))
                    }
                    rows={4}
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-sm text-slate-100 outline-none focus:border-teal-400/60"
                  />
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-[10px] font-bold uppercase tracking-widest text-slate-500">
                      Repo Path
                    </label>
                    <input
                      value={form.repoPath}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          repoPath: event.target.value,
                        }))
                      }
                      className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-sm text-slate-100 outline-none focus:border-teal-400/60"
                      type="text"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-[10px] font-bold uppercase tracking-widest text-slate-500">
                      Version
                    </label>
                    <input
                      value={form.version}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          version: event.target.value,
                        }))
                      }
                      className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-sm text-slate-100 outline-none focus:border-teal-400/60"
                      type="text"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-[10px] font-bold uppercase tracking-widest text-slate-500">
                      Language
                    </label>
                    <input
                      value={form.language}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          language: event.target.value,
                        }))
                      }
                      className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-sm text-slate-100 outline-none focus:border-teal-400/60"
                      type="text"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-[10px] font-bold uppercase tracking-widest text-slate-500">
                      Min Improvement
                    </label>
                    <input
                      value={form.minImprovement}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          minImprovement: Number(event.target.value),
                        }))
                      }
                      className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-sm text-slate-100 outline-none focus:border-teal-400/60"
                      type="number"
                      min="0"
                      max="1"
                      step="0.01"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-[10px] font-bold uppercase tracking-widest text-slate-500">
                    Target Files
                  </label>
                  <textarea
                    value={form.targetFilesText}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        targetFilesText: event.target.value,
                      }))
                    }
                    rows={5}
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-sm text-slate-100 outline-none focus:border-teal-400/60"
                  />
                  <div className="mt-2 text-xs text-slate-500">
                    Use one glob per line or separate multiple patterns with
                    commas.
                  </div>
                </div>

                <div className="space-y-4 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-4">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <label className="mb-2 block text-[10px] font-bold uppercase tracking-widest text-slate-500">
                        Max Iterations
                      </label>
                      <input
                        value={form.maxIterations}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            maxIterations: Number(event.target.value),
                          }))
                        }
                        className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-sm text-slate-100 outline-none focus:border-teal-400/60"
                        type="number"
                        min="1"
                        step="1"
                      />
                    </div>
                    <div>
                      <label className="mb-2 block text-[10px] font-bold uppercase tracking-widest text-slate-500">
                        Timeout Seconds
                      </label>
                      <input
                        value={form.timeoutSeconds}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            timeoutSeconds: Number(event.target.value),
                          }))
                        }
                        className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-sm text-slate-100 outline-none focus:border-teal-400/60"
                        type="number"
                        min="1"
                        step="1"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <label className="mb-2 block text-[10px] font-bold uppercase tracking-widest text-slate-500">
                        Council Size
                      </label>
                      <input
                        value={form.councilSize}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            councilSize: Number(event.target.value),
                          }))
                        }
                        className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-sm text-slate-100 outline-none focus:border-teal-400/60"
                        type="number"
                        min="1"
                        step="1"
                      />
                    </div>
                    <div>
                      <label className="mb-2 block text-[10px] font-bold uppercase tracking-widest text-slate-500">
                        Debate Rounds
                      </label>
                      <input
                        value={form.debateRounds}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            debateRounds: Number(event.target.value),
                          }))
                        }
                        className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-sm text-slate-100 outline-none focus:border-teal-400/60"
                        type="number"
                        min="1"
                        step="1"
                      />
                    </div>
                  </div>

                  <label className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-sm text-slate-300">
                    <input
                      checked={form.requireTestsPass}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          requireTestsPass: event.target.checked,
                        }))
                      }
                      type="checkbox"
                      className="rounded border-white/20 bg-slate-900"
                    />
                    Require evaluator-backed test success before keeping a
                    change
                  </label>
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-4 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                        Metrics
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        Weight total: {metricWeightTotal.toFixed(2)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={addMetric}
                      className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-200 transition hover:bg-white/10"
                    >
                      Add Metric
                    </button>
                  </div>
                  <div className="space-y-3">
                    {form.metrics.map((metric, index) => (
                      <div
                        key={`${metric.name}-${index}`}
                        className="space-y-3 rounded-lg border border-white/10 bg-slate-950/50 p-3"
                      >
                        <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-[minmax(0,1.1fr)_8rem_9rem_auto]">
                          <input
                            value={metric.name}
                            onChange={(event) =>
                              updateMetric(index, "name", event.target.value)
                            }
                            placeholder="Metric name"
                            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-400/60"
                            type="text"
                          />
                          <input
                            value={metric.weight}
                            onChange={(event) =>
                              updateMetric(
                                index,
                                "weight",
                                Number(event.target.value),
                              )
                            }
                            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-400/60"
                            type="number"
                            min="0"
                            max="1"
                            step="0.01"
                          />
                          <select
                            value={metric.direction}
                            onChange={(event) =>
                              updateMetric(
                                index,
                                "direction",
                                event.target.value,
                              )
                            }
                            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-400/60"
                          >
                            <option value="maximize">maximize</option>
                            <option value="minimize">minimize</option>
                          </select>
                          <button
                            type="button"
                            onClick={() => removeMetric(index)}
                            disabled={form.metrics.length === 1}
                            className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-rose-300 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Remove
                          </button>
                        </div>
                        <textarea
                          value={metric.description}
                          onChange={(event) =>
                            updateMetric(
                              index,
                              "description",
                              event.target.value,
                            )
                          }
                          rows={2}
                          className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-400/60"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-4 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                        Agents
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        Configure who participates in the council and which
                        model each agent uses.
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={addAgent}
                      className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-200 transition hover:bg-white/10"
                    >
                      Add Agent
                    </button>
                  </div>
                  <div className="space-y-3">
                    {form.agents.map((agent, index) => (
                      <div
                        key={`${agent.name}-${index}`}
                        className="space-y-3 rounded-lg border border-white/10 bg-slate-950/50 p-3"
                      >
                        <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-[minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,0.8fr)_auto]">
                          <input
                            value={agent.name}
                            onChange={(event) =>
                              updateAgent(index, "name", event.target.value)
                            }
                            placeholder="Agent name"
                            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-400/60"
                            type="text"
                          />
                          <input
                            value={agent.role}
                            onChange={(event) =>
                              updateAgent(index, "role", event.target.value)
                            }
                            placeholder="Role"
                            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-400/60"
                            type="text"
                          />
                          <select
                            value={agent.model}
                            onChange={(event) =>
                              updateAgent(index, "model", event.target.value)
                            }
                            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-400/60"
                          >
                            {modelNames.map((modelName) => (
                              <option key={modelName} value={modelName}>
                                {modelName}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => removeAgent(index)}
                            disabled={form.agents.length === 1}
                            className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-rose-300 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Remove
                          </button>
                        </div>
                        <textarea
                          value={agent.systemPrompt}
                          onChange={(event) =>
                            updateAgent(
                              index,
                              "systemPrompt",
                              event.target.value,
                            )
                          }
                          rows={3}
                          className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-400/60"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-4 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                        Models
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        Add one or more backends and choose how the runtime
                        assigns them.
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={addModel}
                      className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-200 transition hover:bg-white/10"
                    >
                      Add Model
                    </button>
                  </div>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <label className="mb-2 block text-[10px] font-bold uppercase tracking-widest text-slate-500">
                        Model Assignment
                      </label>
                      <select
                        value={form.modelAssignment}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            modelAssignment: event.target.value as
                              | "explicit"
                              | "round_robin",
                          }))
                        }
                        className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-sm text-slate-100 outline-none focus:border-teal-400/60"
                      >
                        <option value="explicit">explicit</option>
                        <option value="round_robin">round_robin</option>
                      </select>
                    </div>
                    <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-3 text-xs text-slate-300">
                      Use explicit when each agent should pin to a specific
                      model. Use round-robin to spread requests across the
                      configured model list.
                    </div>
                  </div>
                  <div className="space-y-3">
                    {form.models.map((model, index) => (
                      <div
                        key={`${model.name}-${index}`}
                        className="space-y-3 rounded-lg border border-white/10 bg-slate-950/50 p-3"
                      >
                        <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-[minmax(0,0.8fr)_minmax(0,0.8fr)_auto]">
                          <input
                            value={model.name}
                            onChange={(event) =>
                              updateModel(index, "name", event.target.value)
                            }
                            placeholder="Model name"
                            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-400/60"
                            type="text"
                          />
                          <input
                            value={model.provider}
                            onChange={(event) =>
                              updateModel(index, "provider", event.target.value)
                            }
                            placeholder="Provider"
                            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-400/60"
                            type="text"
                          />
                          <button
                            type="button"
                            onClick={() => removeModel(index)}
                            disabled={form.models.length === 1}
                            className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-rose-300 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Remove
                          </button>
                        </div>
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                          <input
                            value={model.endpoint}
                            onChange={(event) =>
                              updateModel(index, "endpoint", event.target.value)
                            }
                            placeholder="Endpoint"
                            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-400/60"
                            type="text"
                          />
                          <input
                            value={model.apiKeyEnv}
                            onChange={(event) =>
                              updateModel(
                                index,
                                "apiKeyEnv",
                                event.target.value,
                              )
                            }
                            placeholder="API key env var (optional)"
                            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-400/60"
                            type="text"
                          />
                          <input
                            value={model.temperature}
                            onChange={(event) =>
                              updateModel(
                                index,
                                "temperature",
                                Number(event.target.value),
                              )
                            }
                            placeholder="Temperature"
                            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-400/60"
                            type="number"
                            min="0"
                            max="2"
                            step="0.1"
                          />
                          <input
                            value={model.maxTokens}
                            onChange={(event) =>
                              updateModel(
                                index,
                                "maxTokens",
                                Number(event.target.value),
                              )
                            }
                            placeholder="Max tokens"
                            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-400/60"
                            type="number"
                            min="1"
                            step="1"
                          />
                          <input
                            value={model.requestsPerMinute}
                            onChange={(event) =>
                              updateModel(
                                index,
                                "requestsPerMinute",
                                event.target.value,
                              )
                            }
                            placeholder="Requests per minute"
                            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-400/60 md:col-span-2"
                            type="text"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-4 text-sm text-slate-300">
                  The wizard now writes exactly the metrics, agents, and model
                  pool you configure here, while still generating a valid TOML
                  blueprint that loads immediately.
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t border-white/5 bg-white/[0.03] px-6 py-4 md:flex-row md:items-center md:justify-between">
            <div className="text-xs text-slate-500">
              The generated file is saved in the workspace blueprints directory
              and becomes the active blueprint.
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={isCreating}
                className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-slate-300 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-70"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onCreate}
                disabled={isCreating || isEngineRunning}
                className="rounded-lg border border-teal-300/20 bg-gradient-to-r from-teal-500 to-amber-400 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-slate-950 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isCreating ? "Creating..." : "Create Blueprint"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
