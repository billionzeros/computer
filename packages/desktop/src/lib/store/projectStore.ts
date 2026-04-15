/**
 * Project domain store — projects, routines, workflows, project context.
 */

import type {
  RoutineSession,
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

  // Project routines
  projectRoutines: RoutineSession[]
  projectRoutinesLoading: boolean
  selectedRoutineId: string | null
  routineRunLogs: import('@anton/protocol').RoutineRunLogEntry[] | null
  routineRunLogsLoading: boolean
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
  setProjectRoutines: (routines: RoutineSession[]) => void
  setSelectedRoutine: (id: string | null) => void
  setActiveProjectSession: (sessionId: string | null) => void
  setProjectInstructions: (content: string) => void
  setProjectPreferences: (
    prefs: { id: string; title: string; content: string; createdAt: number }[],
  ) => void
  setMemories: (
    memories: { name: string; content: string; scope: 'global' | 'conversation' | 'project' }[],
  ) => void
  setRoutineRunLogs: (logs: import('@anton/protocol').RoutineRunLogEntry[] | null) => void
  setWorkflowRegistry: (entries: WorkflowRegistryEntry[]) => void
  setProjectWorkflows: (workflows: InstalledWorkflow[]) => void
  setWorkflowConnectorCheck: (check: ProjectState['workflowConnectorCheck']) => void

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
  listRoutines: (projectId: string) => void
  createRoutine: (
    projectId: string,
    config: {
      name: string
      instructions: string
      schedule?: string
      model?: string
      provider?: string
    },
  ) => void
  routineAction: (
    projectId: string,
    routineId: string,
    action: 'start' | 'stop' | 'pause' | 'resume' | 'delete',
  ) => void
  getRoutineRunLogs: (
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
  activateWorkflow: (projectId: string, workflowId: string) => void
  getProjectInstructions: (projectId: string) => void
  saveProjectInstructions: (projectId: string, content: string) => void
  getProjectPreferences: (projectId: string) => void
  addProjectPreference: (projectId: string, title: string, content: string) => void
  deleteProjectPreference: (projectId: string, preferenceId: string) => void
  updateProjectContext: (projectId: string, field: 'notes' | 'summary', value: string) => void
  sendRoutineAction: (
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
  projectRoutines: [],
  projectRoutinesLoading: false,
  selectedRoutineId: null,
  routineRunLogs: null,
  routineRunLogsLoading: false,
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
        console.log(`[ProjectSync] Auto-selecting default project: ${defaultProject.id}`)
        get().setActiveProject(defaultProject.id)
      }
    }
  },

  setActiveProject: (id) => {
    console.log(`[ProjectSync] setActiveProject: ${id ?? 'null'}`)
    saveActiveProjectId(id)
    set({
      activeProjectId: id,
      activeProjectSessionId: null,
      // Clear ALL project-scoped state to prevent cross-project leaks
      projectSessions: [],
      projectSessionsLoading: !!id,
      projectRoutines: [],
      projectRoutinesLoading: !!id,
      selectedRoutineId: null,
      routineRunLogs: null,
      routineRunLogsLoading: false,
      projectWorkflows: [],
      workflowConnectorCheck: null,
      projectInstructions: '',
      projectInstructionsLoading: !!id,
      projectPreferences: [],
      projectPreferencesLoading: !!id,
      memories: [],
      memoriesLoading: !!id,
    })
    // Always fetch project sessions when selecting a project.
    // Previously callers had to remember to also call listProjectSessions —
    // several paths (setProjects auto-select, workflow_installed) didn't,
    // leaving projectSessionsLoading stuck at true or sessions permanently empty.
    if (id) {
      console.log(`[ProjectSync] Requesting sessions for project ${id}`)
      connection.sendProjectSessionsList(id)
    }
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

  setProjectSessions: (sessions) => {
    console.log(`[ProjectSync] setProjectSessions: ${sessions.length} session(s), loading=false`)
    set({ projectSessions: sessions, projectSessionsLoading: false })
  },
  setProjectRoutines: (routines) => set({ projectRoutines: routines, projectRoutinesLoading: false }),
  setSelectedRoutine: (id) => set({ selectedRoutineId: id }),
  setActiveProjectSession: (sessionId) => set({ activeProjectSessionId: sessionId }),
  setProjectInstructions: (content) =>
    set({ projectInstructions: content, projectInstructionsLoading: false }),
  setProjectPreferences: (prefs) =>
    set({ projectPreferences: prefs, projectPreferencesLoading: false }),
  setMemories: (memories) => set({ memories, memoriesLoading: false }),
  setRoutineRunLogs: (logs) => set({ routineRunLogs: logs, routineRunLogsLoading: false }),
  setWorkflowRegistry: (entries) => set({ workflowRegistry: entries }),
  setProjectWorkflows: (workflows) => set({ projectWorkflows: workflows }),
  setWorkflowConnectorCheck: (check) => set({ workflowConnectorCheck: check }),

  // Connection actions
  createProject: (config) => connection.sendProjectCreate(config),
  deleteProject: (id) => connection.sendProjectDelete(id),
  updateProjectRemote: (id, changes) => connection.sendProjectUpdate(id, changes),
  listProjects: () => connection.sendProjectsList(),
  listProjectSessions: (projectId) => connection.sendProjectSessionsList(projectId),
  listRoutines: (projectId) => connection.sendRoutinesList(projectId),
  createRoutine: (projectId, config) => connection.sendRoutineCreate(projectId, config),
  routineAction: (projectId, routineId, action) =>
    connection.sendRoutineAction(projectId, routineId, action),
  getRoutineRunLogs: (projectId, sessionId, startedAt, completedAt, runSessionId) =>
    connection.sendRoutineRunLogs(projectId, sessionId, startedAt, completedAt, runSessionId),
  listWorkflowRegistry: () => connection.sendWorkflowRegistryList(),
  checkWorkflowConnectors: (workflowId) => connection.sendWorkflowCheckConnectors(workflowId),
  installWorkflow: (projectId, workflowId, userInputs) =>
    connection.sendWorkflowInstall(projectId, workflowId, userInputs),
  listWorkflows: (projectId) => connection.sendWorkflowsList(projectId),
  uninstallWorkflow: (projectId, workflowId) =>
    connection.sendWorkflowUninstall(projectId, workflowId),
  activateWorkflow: (projectId, workflowId) =>
    connection.sendWorkflowActivate(projectId, workflowId),
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
  sendRoutineAction: (projectId, sessionId, action) =>
    connection.sendRoutineAction(projectId, sessionId, action),

  // Reset
  reset: () => {
    set({
      projects: [],
      activeProjectId: null,
      activeProjectSessionId: null,
      projectSessions: [],
      projectSessionsLoading: false,
      projectRoutines: [],
      projectRoutinesLoading: false,
      selectedRoutineId: null,
      routineRunLogs: null,
      routineRunLogsLoading: false,
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
      projectRoutines: [],
      projectRoutinesLoading: false,
      selectedRoutineId: null,
    })
  },
}))
