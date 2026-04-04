import type { WorkflowRegistryEntry } from '@anton/protocol'
import { Zap } from 'lucide-react'
import { useEffect, useState } from 'react'
import { projectStore } from '../../lib/store/projectStore.js'
import { WorkflowCard } from './WorkflowCard.js'
import { WorkflowDetailPage } from './WorkflowDetailPage.js'

const PLACEHOLDER_WORKFLOWS: WorkflowRegistryEntry[] = [
  {
    id: 'content-creation-pipeline',
    name: 'Content Creation Pipeline',
    description:
      'Capture ideas from Slack, validate with trend research, generate production-ready briefs with shot lists, and track your content pipeline.',
    category: 'CONTENT',
    connectors: ['slack', 'google-sheets', 'exa-search'],
    version: '0.1.0',
    author: 'anton',
    featured: true,
  },
  {
    id: 'workflow-creator',
    name: 'Workflow Creator',
    description:
      'Build custom workflows through conversation. Describe what you want to automate and Anton generates the agents, scripts, and templates.',
    category: 'META',
    connectors: [],
    version: '0.1.0',
    author: 'anton',
    featured: true,
  },
  {
    id: 'customer-support-automation',
    name: 'Customer Support Automation',
    description:
      'Automate email responses to customer support inquiries from Gmail. Categorize tickets, draft replies, escalate complex issues.',
    category: 'SUPPORT',
    connectors: ['gmail', 'slack', 'google-sheets'],
    version: '0.1.0',
    author: 'anton',
    featured: true,
  },
]

export function WorkflowsPage() {
  const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowRegistryEntry | null>(null)
  const workflowRegistry = projectStore((s) => s.workflowRegistry)
  const projectWorkflows = projectStore((s) => s.projectWorkflows)

  useEffect(() => {
    projectStore.getState().listWorkflowRegistry()
  }, [])

  const realIds = new Set(workflowRegistry.map((w) => w.id))
  const allWorkflows = [
    ...workflowRegistry,
    ...PLACEHOLDER_WORKFLOWS.filter((p) => !realIds.has(p.id)),
  ]

  const isInstalled = (workflowId: string) =>
    projectWorkflows.some((w) => w.workflowId === workflowId)

  const isComingSoon = (workflowId: string) => !workflowRegistry.some((w) => w.id === workflowId)

  if (selectedWorkflow && !isComingSoon(selectedWorkflow.id)) {
    return (
      <WorkflowDetailPage
        workflow={selectedWorkflow}
        installed={isInstalled(selectedWorkflow.id)}
        onBack={() => setSelectedWorkflow(null)}
      />
    )
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '28px 24px' }}>
      <div style={{ maxWidth: '720px', margin: '0 auto' }}>
        {/* Subtitle */}
        <p style={{ fontSize: '13px', color: '#52525b', margin: '0 0 20px' }}>
          Automation that runs on your computer
        </p>

        {/* Grid */}
        {allWorkflows.length === 0 ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '14px',
              border: '1px solid rgba(255,255,255,0.06)',
              padding: '56px 20px',
              textAlign: 'center',
            }}
          >
            <Zap size={36} strokeWidth={1.5} style={{ color: '#3f3f46', marginBottom: '16px' }} />
            <p style={{ fontSize: '14px', fontWeight: 500, color: '#d4d4d8' }}>
              No workflows available
            </p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
            {allWorkflows.map((workflow) => {
              const comingSoon = isComingSoon(workflow.id)
              return (
                <WorkflowCard
                  key={workflow.id}
                  workflow={workflow}
                  comingSoon={comingSoon}
                  onClick={() => {
                    if (!comingSoon) setSelectedWorkflow(workflow)
                  }}
                />
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
