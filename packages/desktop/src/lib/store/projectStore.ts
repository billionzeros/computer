/**
 * Project domain store — projects, agents, workflows, project context.
 */

import type {
  AgentSession,
  InstalledWorkflow,
  Project,
  WorkflowRegistryEntry,
} from '@anton/protocol'
import { create } from 'zustand'
import { connection } from '../connection.js'
import {
  loadActiveProjectId,
  loadProjects as loadPersistedProjects,
  saveActiveProjectId,
  saveProjects as savePersistedProjects,
} from '../projects.js'
import type { SessionMeta } from './types.js'

interface ProjectState {
  // Projects
  projects: Project[]
  activeProjectId: string | null
  activeProjectSessionId: string | null

  // Project sessions
  projectSessions: SessionMeta[]
  projectSessionsLoading: boolean

  // Project files
  projectFiles: { name: string; size: number; mimeType: string }[]
  projectFilesLoading: boolean

  // Project agents
  projectAgents: AgentSession[]
  projectAgentsLoading: boolean
  selectedAgentId: string | null
  agentRunLogs: import('@anton/protocol').AgentRunLogEntry[] | null
  agentRunLogsLoading: boolean
  allAgents: AgentSession[]
  allAgentsLoading: boolean

  // Workflows
  workflowRegistry: WorkflowRegistryEntry[]
  projectWorkflows: InstalledWorkflow[]
  workflowConnectorCheck: {
    workflowId: string
    satisfied: string[]
    missing: string[]
    optional: { id: string; connected: boolean }[]
  } | null

  // Project context
  projectInstructions: string
  projectInstructionsLoading: boolean
  projectPreferences: { id: string; title: string; content: string; createdAt: number }[]
  projectPreferencesLoading: boolean
  memories: { name: string; content: string; scope: 'global' | 'conversation' | 'project' }[]
  memoriesLoading: boolean

  // Project actions
  setProjects: (projects: Project[]) => void
  setActiveProject: (id: string | null) => void
  addProject: (project: Project) => void
  updateProject: (id: string, changes: Partial<Project>) => void
  removeProject: (id: string) => void
  setProjectSessions: (sessions: SessionMeta[]) => void
  setProjectFiles: (files: { name: string; size: number; mimeType: string }[]) => void
  setProjectAgents: (agents: AgentSession[]) => void
  setSelectedAgent: (id: string | null) => void
  setActiveProjectSession: (sessionId: string | null) => void
  setProjectInstructions: (content: string) => void
  setProjectPreferences: (
    prefs: { id: string; title: string; content: string; createdAt: number }[],
  ) => void
  setMemories: (
    memories: { name: string; content: string; scope: 'global' | 'conversation' | 'project' }[],
  ) => void
  setAllAgents: (agents: AgentSession[]) => void
  setAgentRunLogs: (logs: import('@anton/protocol').AgentRunLogEntry[] | null) => void
  setWorkflowRegistry: (entries: WorkflowRegistryEntry[]) => void
  setProjectWorkflows: (workflows: InstalledWorkflow[]) => void
  setWorkflowConnectorCheck: (check: ProjectState['workflowConnectorCheck']) => void
  fetchAllAgents: () => void

  // Connection actions
  createProject: (config: {
    name: string
    description?: string
    icon?: string
    color?: string
  }) => void
  deleteProject: (id: string) => void
  updateProjectRemote: (id: string, changes: Record<string, unknown>) => void
  listProjects: () => void
  listProjectSessions: (projectId: string) => void
  listProjectFiles: (projectId: string) => void
  uploadProjectFile: (
    projectId: string,
    filename: string,
    base64: string,
    mimeType: string,
    size: number,
  ) => void
  createTextFile: (projectId: string, filename: string, content: string) => void
  deleteProjectFile: (projectId: string, filename: string) => void
  listAgents: (projectId: string) => void
  createAgent: (
    projectId: string,
    config: {
      name: string
      instructions: string
      schedule?: string
      model?: string
      provider?: string
    },
  ) => void
  agentAction: (
    projectId: string,
    agentId: string,
    action: 'start' | 'stop' | 'pause' | 'resume' | 'delete',
  ) => void
  getAgentRunLogs: (
    projectId: string,
    sessionId: string,
    startedAt: number,
    completedAt: number,
    runSessionId?: string,
  ) => void
  listWorkflowRegistry: () => void
  checkWorkflowConnectors: (workflowId: string) => void
  installWorkflow: (
    projectId: string,
    workflowId: string,
    userInputs: Record<string, unknown>,
  ) => void
  listWorkflows: (projectId: string) => void
  uninstallWorkflow: (projectId: string, workflowId: string) => void
  getProjectInstructions: (projectId: string) => void
  saveProjectInstructions: (projectId: string, content: string) => void
  getProjectPreferences: (projectId: string) => void
  addProjectPreference: (projectId: string, title: string, content: string) => void
  deleteProjectPreference: (projectId: string, preferenceId: string) => void
  updateProjectContext: (projectId: string, field: 'notes' | 'summary', value: string) => void
  sendAgentAction: (
    projectId: string,
    sessionId: string,
    action: 'start' | 'stop' | 'pause' | 'resume' | 'delete',
  ) => void

  // Reset
  reset: () => void
  resetTransient: () => void
}

export const projectStore = create<ProjectState>((set, get) => ({
  projects: loadPersistedProjects(),
  activeProjectId: loadActiveProjectId(),
  activeProjectSessionId: null,
  projectSessions: [],
  projectSessionsLoading: false,
  projectFiles: [],
  projectFilesLoading: false,
  projectAgents: [],
  projectAgentsLoading: false,
  selectedAgentId: null,
  agentRunLogs: null,
  agentRunLogsLoading: false,
  allAgents: [],
  allAgentsLoading: false,
  workflowRegistry: [],
  projectWorkflows: [],
  workflowConnectorCheck: null,
  projectInstructions: '',
  projectInstructionsLoading: false,
  projectPreferences: [],
  projectPreferencesLoading: false,
  memories: [],
  memoriesLoading: false,

  // Project actions
  setProjects: (projects) => {
    savePersistedProjects(projects)
    set({ projects })
    const { activeProjectId } = get()
    if (!activeProjectId) {
      const defaultProject = projects.find((p) => p.isDefault)
      if (defaultProject) {
        get().setActiveProject(defaultProject.id)
      }
    }
  },

  setActiveProject: (id) => {
    saveActiveProjectId(id)
    set({
      activeProjectId: id,
      activeProjectSessionId: null,
      projectSessions: [],
      projectSessionsLoading: !!id,
      projectFiles: [],
      projectFilesLoading: !!id,
      projectAgents: [],
      projectAgentsLoading: !!id,
      selectedAgentId: null,
      agentRunLogs: null,
      agentRunLogsLoading: false,
    })
  },

  addProject: (project) => {
    set((state) => {
      const projects = [project, ...state.projects]
      savePersistedProjects(projects)
      return { projects }
    })
  },

  updateProject: (id, changes) => {
    set((state) => {
      const projects = state.projects.map((p) =>
        p.id === id ? { ...p, ...changes, updatedAt: Date.now() } : p,
      )
      savePersistedProjects(projects)
      return { projects }
    })
  },

  removeProject: (id) => {
    set((state) => {
      const projects = state.projects.filter((p) => p.id !== id)
      savePersistedProjects(projects)
      const activeProjectId = state.activeProjectId === id ? null : state.activeProjectId
      if (!activeProjectId) saveActiveProjectId(null)
      return { projects, activeProjectId }
    })
  },

  setProjectSessions: (sessions) =>
    set({ projectSessions: sessions, projectSessionsLoading: false }),
  setProjectFiles: (files) => set({ projectFiles: files, projectFilesLoading: false }),
  setProjectAgents: (agents) => set({ projectAgents: agents, projectAgentsLoading: false }),
  setSelectedAgent: (id) => set({ selectedAgentId: id }),
  setActiveProjectSession: (sessionId) => set({ activeProjectSessionId: sessionId }),
  setProjectInstructions: (content) =>
    set({ projectInstructions: content, projectInstructionsLoading: false }),
  setProjectPreferences: (prefs) =>
    set({ projectPreferences: prefs, projectPreferencesLoading: false }),
  setMemories: (memories) => set({ memories, memoriesLoading: false }),
  setAllAgents: (agents) => set({ allAgents: agents, allAgentsLoading: false }),
  setAgentRunLogs: (logs) => set({ agentRunLogs: logs, agentRunLogsLoading: false }),
  setWorkflowRegistry: (entries) => set({ workflowRegistry: entries }),
  setProjectWorkflows: (workflows) => set({ projectWorkflows: workflows }),
  setWorkflowConnectorCheck: (check) => set({ workflowConnectorCheck: check }),

  fetchAllAgents: () => {
    const state = get()
    if (state.projects.length === 0) return
    set({ allAgentsLoading: true })
    for (const project of state.projects) {
      connection.sendAgentsList(project.id)
    }
  },

  // Connection actions
  createProject: (config) => connection.sendProjectCreate(config),
  deleteProject: (id) => connection.sendProjectDelete(id),
  updateProjectRemote: (id, changes) => connection.sendProjectUpdate(id, changes),
  listProjects: () => connection.sendProjectsList(),
  listProjectSessions: (projectId) => connection.sendProjectSessionsList(projectId),
  listProjectFiles: (projectId) => connection.sendProjectFilesList(projectId),
  uploadProjectFile: (projectId, filename, base64, mimeType, size) =>
    connection.sendProjectFileUpload(projectId, filename, base64, mimeType, size),
  createTextFile: (projectId, filename, content) =>
    connection.sendProjectFileTextCreate(projectId, filename, content),
  deleteProjectFile: (projectId, filename) => connection.sendProjectFileDelete(projectId, filename),
  listAgents: (projectId) => connection.sendAgentsList(projectId),
  createAgent: (projectId, config) => connection.sendAgentCreate(projectId, config),
  agentAction: (projectId, agentId, action) =>
    connection.sendAgentAction(projectId, agentId, action),
  getAgentRunLogs: (projectId, sessionId, startedAt, completedAt, runSessionId) =>
    connection.sendAgentRunLogs(projectId, sessionId, startedAt, completedAt, runSessionId),
  listWorkflowRegistry: () => connection.sendWorkflowRegistryList(),
  checkWorkflowConnectors: (workflowId) => connection.sendWorkflowCheckConnectors(workflowId),
  installWorkflow: (projectId, workflowId, userInputs) =>
    connection.sendWorkflowInstall(projectId, workflowId, userInputs),
  listWorkflows: (projectId) => connection.sendWorkflowsList(projectId),
  uninstallWorkflow: (projectId, workflowId) =>
    connection.sendWorkflowUninstall(projectId, workflowId),
  getProjectInstructions: (projectId) => connection.sendProjectInstructionsGet(projectId),
  saveProjectInstructions: (projectId, content) =>
    connection.sendProjectInstructionsSave(projectId, content),
  getProjectPreferences: (projectId) => connection.sendProjectPreferencesGet(projectId),
  addProjectPreference: (projectId, title, content) =>
    connection.sendProjectPreferenceAdd(projectId, title, content),
  deleteProjectPreference: (projectId, preferenceId) =>
    connection.sendProjectPreferenceDelete(projectId, preferenceId),
  updateProjectContext: (projectId, field, value) =>
    connection.sendProjectContextUpdate(projectId, field, value),
  sendAgentAction: (projectId, sessionId, action) =>
    connection.sendAgentAction(projectId, sessionId, action),

  // Reset
  reset: () => {
    set({
      projects: [],
      activeProjectId: null,
      activeProjectSessionId: null,
      projectSessions: [],
      projectSessionsLoading: false,
      projectFiles: [],
      projectFilesLoading: false,
      projectAgents: [],
      projectAgentsLoading: false,
      selectedAgentId: null,
      agentRunLogs: null,
      agentRunLogsLoading: false,
      allAgents: [],
      allAgentsLoading: false,
      workflowRegistry: [],
      projectWorkflows: [],
      workflowConnectorCheck: null,
      projectInstructions: '',
      projectInstructionsLoading: false,
      projectPreferences: [],
      projectPreferencesLoading: false,
      memories: [],
      memoriesLoading: false,
    })
  },

  resetTransient: () => {
    set({
      projectSessions: [],
      projectSessionsLoading: false,
      projectFiles: [],
      projectFilesLoading: false,
      projectAgents: [],
      projectAgentsLoading: false,
      selectedAgentId: null,
      allAgents: [],
      allAgentsLoading: false,
    })
  },
}))
