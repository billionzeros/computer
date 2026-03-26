import type { Project } from '@anton/protocol'

const STORAGE_KEY = 'anton.projects'
const ACTIVE_PROJECT_KEY = 'anton.activeProjectId'

export function loadProjects(): Project[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function saveProjects(projects: Project[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(projects))
}

export function loadActiveProjectId(): string | null {
  return localStorage.getItem(ACTIVE_PROJECT_KEY)
}

export function saveActiveProjectId(id: string | null) {
  if (id) {
    localStorage.setItem(ACTIVE_PROJECT_KEY, id)
  } else {
    localStorage.removeItem(ACTIVE_PROJECT_KEY)
  }
}
