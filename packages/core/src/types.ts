/** Raw transcript event kinds we recognize. Unknown kinds are rejected by the reader. */
export type TranscriptEventKind = 'user' | 'assistant' | 'tool_use' | 'tool_result' | 'system';

/** One parsed event from a Claude Code JSONL transcript. */
export interface TranscriptEvent {
  kind: TranscriptEventKind;
  /** 0-indexed position within the session transcript, for citation references. */
  index: number;
  /** ISO timestamp, if present on the source event. */
  timestamp?: string;
  /** Free-form text payload; for tool_use, this is the tool name. */
  text: string;
  /** For tool_use / tool_result: the tool name (e.g., "Edit", "Bash"). */
  toolName?: string;
  /** For tool_use / tool_result: a short one-line summary of args/result. */
  toolSummary?: string;
  /** For tool_result: number of lines/chars stripped from the raw body (for auditing). */
  strippedSize?: number;
}

/** A prompt-bounded group of events: one user turn plus the assistant activity until the next user turn. */
export interface Segment {
  index: number;
  userEventIndex: number | null;
  userText: string | null;
  assistantEventIndices: number[];
  /** Compressed assistant actions as a list of one-liner summaries. */
  assistantActions: string[];
  /** Narrative markers extracted verbatim ("Chose X because...", "Rejected Y because..."). */
  narrativeMarkers: string[];
}

/** Confidence level emitted by the refiner per concept. */
export type Confidence = 'high' | 'medium' | 'low' | 'unknown';

/** The refiner's classification of how a concept appears in this session. */
export type ConceptKind = 'introduced' | 'refined' | 'referenced';

/** One concept the refiner identified in a session. */
export interface ConceptNode {
  slug: string;
  name: string;
  kind: ConceptKind;
  summary: string;
  reasoning: string[];
  depends_on: string[];
  files: string[];
  transcript_refs: number[];
  confidence: Confidence;
}

/** Something the refiner couldn't recover with confidence. */
export interface Unknown {
  slug_ref: string | null;
  question: string;
  recovery_prompt: string;
}

/** The refiner's structured output for one session. */
export interface RefinerOutput {
  concepts: ConceptNode[];
  unknowns: Unknown[];
}

/** The on-disk session artifact — frontmatter metadata + the refiner output. */
export interface SessionArtifact {
  session_id: string;
  transcript_path: string;
  analyzed_at: string;
  refiner_version: string;
  refiner_prompt_hash: string;
  model: string;
  segment_count: number;
  concept_count: number;
  unknown_count: number;
  concepts: ConceptNode[];
  unknowns: Unknown[];
}

/** Merged concept across all sessions, for the derived project view. */
export interface MergedConcept {
  slug: string;
  name: string;
  introduced_in: string;
  last_updated_in: string;
  depends_on: Array<{ slug: string; status: 'active' | 'deprecated'; last_asserted_in: string }>;
  depended_on_by: string[];
  files: string[];
  confidence: Confidence;
  /** Per-session contributions in chronological order. */
  history: Array<{ session_id: string; analyzed_at: string; kind: ConceptKind; summary: string; reasoning: string[] }>;
  /** Unknowns from any session that referenced this concept. */
  unknowns: Unknown[];
}

/** Derived from merging all sessions. Never written directly — always rebuilt. */
export interface ProjectView {
  concepts: Map<string, MergedConcept>;
  generated_at: string;
  project_view_version: number;
}

/** Input/output contracts for cost estimation and backfill. */
export interface CostEstimate {
  session_id: string;
  input_tokens_estimate: number;
  model_tier: string;
  usd_low: number;
  usd_high: number;
}

export interface BackfillReport {
  discovered: number;
  analyzed: number;
  skipped: string[];
  failed: Array<{ session_id: string; reason: string }>;
  total_cost_usd: number;
}
