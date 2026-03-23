/**
 * Todo tool — persistent task management.
 * Stores tasks in ~/.anton/todos.json.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface TodoInput {
  operation: 'add' | 'list' | 'complete' | 'remove' | 'clear'
  text?: string
  id?: number
}

interface TodoItem {
  id: number
  text: string
  done: boolean
  createdAt: string
  completedAt?: string
}

const TODO_PATH = join(homedir(), '.anton', 'todos.json')

function ensureDir() {
  const dir = join(homedir(), '.anton')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function loadTodos(): TodoItem[] {
  try {
    if (!existsSync(TODO_PATH)) return []
    return JSON.parse(readFileSync(TODO_PATH, 'utf-8'))
  } catch {
    return []
  }
}

function saveTodos(todos: TodoItem[]) {
  ensureDir()
  writeFileSync(TODO_PATH, JSON.stringify(todos, null, 2), 'utf-8')
}

function formatList(todos: TodoItem[]): string {
  if (todos.length === 0) return 'No tasks.'
  return todos.map((t) => `${t.done ? '✓' : '○'} [${t.id}] ${t.text}`).join('\n')
}

export function executeTodo(input: TodoInput): string {
  const todos = loadTodos()

  switch (input.operation) {
    case 'add': {
      if (!input.text) return 'Error: text is required for add.'
      const id = todos.length > 0 ? Math.max(...todos.map((t) => t.id)) + 1 : 1
      todos.push({ id, text: input.text, done: false, createdAt: new Date().toISOString() })
      saveTodos(todos)
      return `Added task #${id}: "${input.text}"\n\n${formatList(todos)}`
    }

    case 'list':
      return formatList(todos)

    case 'complete': {
      if (input.id == null) return 'Error: id is required for complete.'
      const item = todos.find((t) => t.id === input.id)
      if (!item) return `Error: no task with id ${input.id}.`
      item.done = true
      item.completedAt = new Date().toISOString()
      saveTodos(todos)
      return `Completed task #${item.id}: "${item.text}"\n\n${formatList(todos)}`
    }

    case 'remove': {
      if (input.id == null) return 'Error: id is required for remove.'
      const idx = todos.findIndex((t) => t.id === input.id)
      if (idx < 0) return `Error: no task with id ${input.id}.`
      const removed = todos.splice(idx, 1)[0]
      saveTodos(todos)
      return `Removed task #${removed.id}: "${removed.text}"\n\n${formatList(todos)}`
    }

    case 'clear': {
      const count = todos.length
      saveTodos([])
      return `Cleared ${count} task(s).`
    }

    default:
      return `Error: unknown operation "${input.operation}".`
  }
}
