/**
 * Project domain store — projects, routines, project sessions.
 */

import type { Project, RoutineSession } from '@anton/protocol'
import { create } from 'zustand'
import { connection } from '../connection'
import type { SessionMeta } from './types'

interface ProjectStoreState {
  projects: Project[]
  activeProjectId: string | null
  projectSessions: SessionMeta[]
  projectSessionsLoading: boolean
  projectRoutines: RoutineSession[]
  projectRoutinesLoading: boolean

  setProjects: (projects: Project[]) => void
  addProject: (project: Project) => void
  updateProject: (project: Project) => void
  removeProject: (id: string) => void
  setActiveProject: (id: string | null) => void
  setProjectSessions: (sessions: SessionMeta[]) => void
  setProjectRoutines: (routines: RoutineSession[]) => void

  listProjects: () => void
  listProjectSessions: (projectId: string) => void
  listRoutines: (projectId: string) => void

  reset: () => void
  resetTransient: () => void
}

export const projectStore = create<ProjectStoreState>((set, _get) => ({
  projects: [],
  activeProjectId: null,
  projectSessions: [],
  projectSessionsLoading: false,
  projectRoutines: [],
  projectRoutinesLoading: false,

  setProjects: (projects) => set({ projects }),

  addProject: (project) => set((s) => ({ projects: [...s.projects, project] })),

  updateProject: (project) =>
    set((s) => ({
      projects: s.projects.map((p) => (p.id === project.id ? project : p)),
    })),

  removeProject: (id) => set((s) => ({ projects: s.projects.filter((p) => p.id !== id) })),

  setActiveProject: (id) => {
    set({
      activeProjectId: id,
      projectSessions: [],
      projectSessionsLoading: !!id,
      projectRoutines: [],
      projectRoutinesLoading: !!id,
    })
    if (id) {
      connection.sendProjectSessionsList(id)
      connection.sendRoutinesList(id)
    }
  },

  setProjectSessions: (sessions) =>
    set({ projectSessions: sessions, projectSessionsLoading: false }),

  setProjectRoutines: (routines) =>
    set({ projectRoutines: routines, projectRoutinesLoading: false }),

  listProjects: () => connection.sendProjectsList(),

  listProjectSessions: (projectId) => {
    set({ projectSessionsLoading: true })
    connection.sendProjectSessionsList(projectId)
  },

  listRoutines: (projectId) => {
    set({ projectRoutinesLoading: true })
    connection.sendRoutinesList(projectId)
  },

  reset: () =>
    set({
      projects: [],
      activeProjectId: null,
      projectSessions: [],
      projectSessionsLoading: false,
      projectRoutines: [],
      projectRoutinesLoading: false,
    }),

  resetTransient: () =>
    set({
      projectSessions: [],
      projectSessionsLoading: false,
      projectRoutines: [],
      projectRoutinesLoading: false,
    }),
}))
