import type { WorkflowRegistryEntry } from '@anton/protocol'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { projectStore } from '../../lib/store/projectStore.js'

const WORKFLOW_ICONS: Record<string, string> = {
  'lead-qualification': '\u{1F3AF}',
  'content-creation-pipeline': '\u{1F3AC}',
  'workflow-creator': '\u{1F527}',
  'customer-support-automation': '\u{1F4E8}',
}

const AGENTS: Record<string, string[]> = {
  'lead-qualification': ['lead-scanner', 'lead-scorer', 'outreach-writer'],
}

const SCRIPTS: Record<string, string[]> = {
  'lead-qualification': ['enrich-lead.py', 'compute-score.py', 'validate-email.py'],
}

const WORKFLOW_DESCRIPTIONS: Record<string, string> = {
  'lead-qualification':
    'Automatically score and qualify incoming leads from email and web forms using AI-powered research. Each lead is enriched with company data, scored against your ideal customer profile, and routed accordingly — hot prospects get personalized outreach via email, qualified leads are added to your Google Sheets pipeline, and your team gets Slack alerts for high-value opportunities. Runs on schedule so no lead slips through the cracks.',
  'content-creation-pipeline':
    'End-to-end content production from ideation to publishing. Generates topic ideas based on trending keywords, drafts long-form articles with SEO optimization, creates social media snippets, and queues everything for review — all orchestrated by AI agents working together.',
  'workflow-creator':
    'Build and publish your own custom workflows from scratch. Define agents, scripts, connectors, and scheduling — then package it all into a shareable workflow that others can install with one click.',
  'customer-support-automation':
    'Triage and respond to incoming support tickets automatically. Categorizes issues by urgency and type, drafts contextual replies using your knowledge base, escalates complex cases to the right team member, and tracks resolution metrics in real time.',
}

function Chip({ label }: { label: string }) {
  return (
    <span
      style={{
        fontSize: '13px',
        color: '#c8c8cc',
        background: 'rgba(255,255,255,0.07)',
        padding: '6px 14px',
        borderRadius: '20px',
        display: 'inline-block',
      }}
    >
      {label}
    </span>
  )
}

// ── Install Modal ───────────────────────────────────────────────

function InstallModal({
  workflow,
  onClose,
}: {
  workflow: WorkflowRegistryEntry
  onClose: () => void
}) {
  const [installing, setInstalling] = useState(false)
  const [pendingProjectName, setPendingProjectName] = useState<string | null>(null)
  const connectorCheck = projectStore((s) => s.workflowConnectorCheck)
  const projects = projectStore((s) => s.projects)

  // Request connector check on mount
  useEffect(() => {
    projectStore.getState().checkWorkflowConnectors(workflow.id)
  }, [workflow.id])

  // When the new project appears, install the workflow into it
  useEffect(() => {
    if (!pendingProjectName || !installing) return
    const newProject = projects.find((p) => p.name === pendingProjectName)
    if (newProject) {
      setPendingProjectName(null)
      projectStore.getState().installWorkflow(newProject.id, workflow.id, {})
    }
  }, [projects, pendingProjectName, installing, workflow.id])

  const handleConfirm = useCallback(() => {
    setInstalling(true)
    // Check if a project already has this specific workflow installed
    const ps = projectStore.getState()
    const existingWorkflow = ps.projectWorkflows.find((w) => w.workflowId === workflow.id)
    if (existingWorkflow) {
      // Workflow already installed somewhere — install into that project
      projectStore.getState().installWorkflow(existingWorkflow.projectId, workflow.id, {})
    } else {
      // Create a fresh project for this workflow
      projectStore.getState().createProject({
        name: workflow.name,
        description: workflow.description,
        icon: WORKFLOW_ICONS[workflow.id] || '\u{26A1}',
        color: '#6366f1',
      })
      setPendingProjectName(workflow.name)
    }
  }, [workflow.id, workflow.name, workflow.description])

  const allReady =
    connectorCheck &&
    connectorCheck.workflowId === workflow.id &&
    connectorCheck.missing.length === 0
  const loading = !connectorCheck || connectorCheck.workflowId !== workflow.id

  return (
    <>
      {/* Backdrop */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: modal backdrop dismiss */}
      <div
        onClick={!installing ? onClose : undefined}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.6)',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* Modal */}
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: stop propagation only */}
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            background: '#1e1e1e',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '16px',
            padding: '28px',
            width: '440px',
            maxWidth: '90vw',
          }}
        >
          {/* Title */}
          <h2 style={{ fontSize: '16px', fontWeight: 600, color: '#e4e4e7', margin: '0 0 4px' }}>
            Install {workflow.name}
          </h2>
          <p style={{ fontSize: '13px', color: '#71717a', margin: '0 0 6px' }}>
            This will create a new project and start an interactive setup.
          </p>

          {/* What happens */}
          <div
            style={{
              margin: '14px 0 20px',
              padding: '12px 14px',
              borderRadius: '10px',
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.05)',
            }}
          >
            <p style={{ fontSize: '12px', fontWeight: 500, color: '#a1a1aa', margin: '0 0 8px' }}>
              What happens next:
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              {[
                'A new project is created for this workflow',
                'An AI assistant guides you through setup (~5 min)',
                'The workflow starts running on schedule automatically',
              ].map((step, i) => (
                <div
                  key={step}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '8px',
                    fontSize: '12px',
                    color: '#71717a',
                  }}
                >
                  <span style={{ color: '#52525b', marginTop: '1px' }}>{i + 1}.</span>
                  {step}
                </div>
              ))}
            </div>
          </div>

          {/* Connection check */}
          {loading ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '12px 0',
                fontSize: '13px',
                color: '#71717a',
              }}
            >
              <Loader2
                size={14}
                strokeWidth={1.5}
                style={{ animation: 'spin 1s linear infinite' }}
              />
              Checking connections...
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {connectorCheck!.satisfied.map((c) => (
                <div
                  key={c}
                  style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px' }}
                >
                  <span style={{ color: '#34d399', fontSize: '15px' }}>{'\u2713'}</span>
                  <span style={{ color: '#d4d4d8' }}>{c}</span>
                  <span style={{ color: '#52525b' }}>connected</span>
                </div>
              ))}
              {connectorCheck!.missing.map((c) => (
                <div
                  key={c}
                  style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px' }}
                >
                  <span style={{ color: '#ef4444', fontSize: '15px' }}>{'\u2717'}</span>
                  <span style={{ color: '#d4d4d8' }}>{c}</span>
                  <span style={{ color: 'rgba(239,68,68,0.7)' }}>not connected</span>
                </div>
              ))}
              {connectorCheck!.optional.map((c) => (
                <div
                  key={c.id}
                  style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px' }}
                >
                  <span style={{ color: c.connected ? '#34d399' : '#52525b', fontSize: '15px' }}>
                    {c.connected ? '\u2713' : '\u25CB'}
                  </span>
                  <span style={{ color: '#d4d4d8' }}>{c.id}</span>
                  <span style={{ color: '#52525b' }}>
                    {c.connected ? 'connected' : 'not connected'} (optional)
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '24px' }}>
            {allReady ? (
              <button
                type="button"
                onClick={handleConfirm}
                disabled={installing}
                style={{
                  padding: '10px 22px',
                  borderRadius: '10px',
                  background: installing ? 'rgba(255,255,255,0.06)' : '#e4e4e7',
                  border: 'none',
                  fontSize: '13.5px',
                  fontWeight: 600,
                  color: installing ? '#a1a1aa' : '#18181b',
                  cursor: installing ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                {installing && (
                  <Loader2
                    size={14}
                    strokeWidth={2}
                    style={{ animation: 'spin 1s linear infinite' }}
                  />
                )}
                {installing ? 'Setting up...' : 'Create Project & Start Setup'}
              </button>
            ) : !loading ? (
              <span style={{ fontSize: '13px', color: 'rgba(239,68,68,0.7)' }}>
                Connect missing services in Settings first
              </span>
            ) : null}

            {!installing && (
              <button
                type="button"
                onClick={onClose}
                style={{
                  fontSize: '13px',
                  color: '#71717a',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '10px 12px',
                }}
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

// ── Detail Page ─────────────────────────────────────────────────

export function WorkflowDetailPage({
  workflow,
  installed,
  onBack,
}: {
  workflow: WorkflowRegistryEntry
  installed: boolean
  onBack: () => void
}) {
  const [showModal, setShowModal] = useState(false)

  const agents = AGENTS[workflow.id] || []
  const scripts = SCRIPTS[workflow.id] || []

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 24px' }}>
        <div style={{ maxWidth: '640px', margin: '0 auto', padding: '20px 0 40px' }}>
          {/* Back */}
          <button
            type="button"
            onClick={onBack}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '13px',
              color: '#71717a',
              cursor: 'pointer',
              background: 'none',
              border: 'none',
              padding: 0,
              marginBottom: '20px',
            }}
          >
            <ArrowLeft size={16} strokeWidth={1.5} />
            Back
          </button>

          {/* Title row with Install button */}
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: '16px',
            }}
          >
            <div style={{ flex: 1 }}>
              <h1
                style={{
                  fontSize: '28px',
                  fontWeight: 700,
                  color: '#e4e4e7',
                  margin: 0,
                  lineHeight: 1.2,
                }}
              >
                {workflow.name}
              </h1>
              <p
                style={{ fontSize: '14px', color: '#71717a', marginTop: '6px', margin: '6px 0 0' }}
              >
                by {workflow.author}
              </p>
            </div>
            {installed ? (
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 18px',
                  borderRadius: '10px',
                  background: 'rgba(52,211,153,0.08)',
                  fontSize: '14px',
                  fontWeight: 500,
                  color: '#34d399',
                  whiteSpace: 'nowrap',
                  marginTop: '4px',
                }}
              >
                Installed
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowModal(true)}
                style={{
                  padding: '8px 22px',
                  borderRadius: '10px',
                  background: '#e4e4e7',
                  border: 'none',
                  fontSize: '14px',
                  fontWeight: 600,
                  color: '#18181b',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  marginTop: '4px',
                }}
              >
                Install Workflow
              </button>
            )}
          </div>

          {/* Description */}
          <p
            style={{
              fontSize: '15px',
              lineHeight: '1.65',
              color: '#a1a1aa',
              marginTop: '20px',
              maxWidth: '680px',
            }}
          >
            {WORKFLOW_DESCRIPTIONS[workflow.id] || workflow.description}
          </p>

          {/* Agents */}
          {agents.length > 0 && (
            <div style={{ marginTop: '32px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <h3 style={{ fontSize: '15px', fontWeight: 600, color: '#e4e4e7', margin: 0 }}>
                  Agents
                </h3>
                <span
                  style={{
                    fontSize: '12px',
                    color: '#71717a',
                    background: 'rgba(255,255,255,0.07)',
                    padding: '2px 8px',
                    borderRadius: '6px',
                  }}
                >
                  {agents.length}
                </span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '12px' }}>
                {agents.map((a) => (
                  <Chip key={a} label={a} />
                ))}
              </div>
            </div>
          )}

          {/* Scripts */}
          {scripts.length > 0 && (
            <div style={{ marginTop: '24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <h3 style={{ fontSize: '15px', fontWeight: 600, color: '#e4e4e7', margin: 0 }}>
                  Scripts
                </h3>
                <span
                  style={{
                    fontSize: '12px',
                    color: '#71717a',
                    background: 'rgba(255,255,255,0.07)',
                    padding: '2px 8px',
                    borderRadius: '6px',
                  }}
                >
                  {scripts.length}
                </span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '12px' }}>
                {scripts.map((s) => (
                  <Chip key={s} label={s} />
                ))}
              </div>
            </div>
          )}

          {/* Connectors */}
          <div style={{ marginTop: '24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <h3 style={{ fontSize: '15px', fontWeight: 600, color: '#e4e4e7', margin: 0 }}>
                Connectors
              </h3>
              <span
                style={{
                  fontSize: '12px',
                  color: '#71717a',
                  background: 'rgba(255,255,255,0.07)',
                  padding: '2px 8px',
                  borderRadius: '6px',
                }}
              >
                {workflow.connectors.length}
              </span>
            </div>
            <p style={{ fontSize: '13px', color: '#52525b', marginTop: '6px' }}>
              Services this workflow connects to.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '10px' }}>
              {workflow.connectors.map((c: string) => (
                <Chip key={c} label={c} />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Install modal */}
      {showModal && <InstallModal workflow={workflow} onClose={() => setShowModal(false)} />}
    </div>
  )
}
