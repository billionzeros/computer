import { connection } from './connection.js'
import { useStore } from './store.js'

export interface SkillParameter {
  name: string
  label: string
  type: 'text' | 'select' | 'boolean'
  placeholder?: string
  options?: string[]
  required?: boolean
}

export interface Skill {
  id: string
  name: string
  description: string
  icon: string
  command: string
  prompt: string
  category: string
  isCustom?: boolean
  parameters?: SkillParameter[]
}

export const builtinSkills: Skill[] = [
  // ── DevOps ──────────────────────────────────────────────────────
  {
    id: 'deploy-git',
    name: 'Deploy from Git',
    description:
      'Clone a repo, install dependencies, and start the app with zero-downtime deployment',
    icon: 'rocket',
    command: '/deploy',
    category: 'DevOps',
    prompt:
      'Deploy the application from the git repository: {repo}. Branch: {branch}. Follow zero-downtime deployment practices.',
    parameters: [
      {
        name: 'repo',
        label: 'Repository URL',
        type: 'text',
        placeholder: 'github.com/user/repo',
        required: true,
      },
      { name: 'branch', label: 'Branch', type: 'text', placeholder: 'main' },
    ],
  },
  {
    id: 'system-health',
    name: 'System Health Check',
    description: 'Check CPU, memory, disk usage, running services, and overall system health',
    icon: 'activity',
    command: '/health',
    category: 'DevOps',
    prompt:
      'Run a comprehensive system health check. Report on CPU usage, memory usage, disk space, load average, running services, and any potential issues. Flag anything that needs attention.',
  },
  {
    id: 'setup-nginx',
    name: 'Setup Nginx',
    description: 'Install and configure Nginx as a reverse proxy with SSL',
    icon: 'globe',
    command: '/nginx',
    category: 'DevOps',
    prompt:
      'Install nginx and set up a reverse proxy for the application running on port {port}. Domain: {domain}. Set up proper security headers.',
    parameters: [
      { name: 'domain', label: 'Domain', type: 'text', placeholder: 'example.com', required: true },
      { name: 'port', label: 'App Port', type: 'text', placeholder: '3000', required: true },
    ],
  },
  {
    id: 'docker-manage',
    name: 'Docker Containers',
    description: 'List, start, stop, and manage Docker containers and images',
    icon: 'box',
    command: '/docker',
    category: 'DevOps',
    prompt:
      'List all Docker containers (running and stopped) and images. Show resource usage for running containers. {action}',
    parameters: [
      {
        name: 'action',
        label: 'Action',
        type: 'select',
        options: ['Show status', 'Clean up unused', 'Restart all'],
      },
    ],
  },
  {
    id: 'setup-ssl',
    name: 'SSL Certificates',
    description: 'Install and configure Let\'s Encrypt SSL certificates with auto-renewal',
    icon: 'lock',
    command: '/ssl',
    category: 'DevOps',
    prompt:
      'Install certbot and set up Let\'s Encrypt SSL certificates for domain {domain}. Configure auto-renewal via cron. Set up HTTPS redirect.',
    parameters: [
      { name: 'domain', label: 'Domain', type: 'text', placeholder: 'example.com', required: true },
    ],
  },
  {
    id: 'process-manager',
    name: 'Process Manager',
    description: 'Set up PM2 or systemd to keep applications running and auto-restart on crash',
    icon: 'refresh-cw',
    command: '/pm',
    category: 'DevOps',
    prompt:
      'Set up a process manager for the application at {app_path}. Use {manager} to keep it running, auto-restart on crash, and start on boot.',
    parameters: [
      { name: 'app_path', label: 'App path', type: 'text', placeholder: '/home/app', required: true },
      {
        name: 'manager',
        label: 'Manager',
        type: 'select',
        options: ['PM2', 'systemd'],
      },
    ],
  },

  // ── Security ────────────────────────────────────────────────────
  {
    id: 'setup-firewall',
    name: 'Configure Firewall',
    description: 'Set up UFW firewall rules for secure server access',
    icon: 'shield',
    command: '/firewall',
    category: 'Security',
    prompt:
      'Configure UFW firewall. Allow SSH (22), HTTP (80), HTTPS (443), and port {extra_port} if specified. Deny all other incoming. Enable the firewall.',
    parameters: [
      { name: 'extra_port', label: 'Extra port to allow', type: 'text', placeholder: 'Optional' },
    ],
  },
  {
    id: 'ssh-harden',
    name: 'Harden SSH',
    description: 'Secure SSH config: disable root login, key-only auth, change port',
    icon: 'key',
    command: '/ssh-harden',
    category: 'Security',
    prompt:
      'Harden the SSH configuration: disable root login, disable password authentication (key-only), set MaxAuthTries to 3. Optionally change SSH port to {port}. Restart sshd after changes.',
    parameters: [
      { name: 'port', label: 'Custom SSH port', type: 'text', placeholder: '22 (default)' },
    ],
  },
  {
    id: 'security-audit',
    name: 'Security Audit',
    description: 'Run a full security audit: open ports, permissions, outdated packages',
    icon: 'shield-check',
    command: '/audit',
    category: 'Security',
    prompt:
      'Run a comprehensive security audit of this system. Check for: open ports, world-writable files, users with empty passwords, outdated packages with known CVEs, running services that shouldn\'t be exposed, and weak file permissions. Provide a prioritized list of findings.',
  },
  {
    id: 'fail2ban-setup',
    name: 'Setup Fail2ban',
    description: 'Install and configure Fail2ban to protect against brute-force attacks',
    icon: 'ban',
    command: '/fail2ban',
    category: 'Security',
    prompt:
      'Install and configure fail2ban. Set up jails for SSH, {extra_service}. Configure ban time to {ban_time} minutes. Set up email notifications if possible.',
    parameters: [
      { name: 'extra_service', label: 'Extra service', type: 'text', placeholder: 'nginx-http-auth' },
      { name: 'ban_time', label: 'Ban time (min)', type: 'text', placeholder: '60' },
    ],
  },

  // ── Analysis ────────────────────────────────────────────────────
  {
    id: 'analyze-logs',
    name: 'Analyze Logs',
    description: 'Find and analyze log files for errors, warnings, and patterns',
    icon: 'file-text',
    command: '/logs',
    category: 'Analysis',
    prompt:
      'Find and analyze log files in {path}. Look for errors, warnings, and unusual patterns. Summarize findings and suggest fixes.',
    parameters: [{ name: 'path', label: 'Log path', type: 'text', placeholder: '/var/log' }],
  },
  {
    id: 'disk-usage',
    name: 'Disk Usage Analysis',
    description: 'Find large files and directories consuming the most disk space',
    icon: 'hard-drive',
    command: '/disk',
    category: 'Analysis',
    prompt:
      'Analyze disk usage on this system. Find the top 20 largest files and directories. Identify any temp files, old logs, or caches that can be safely cleaned up. Show usage by mount point.',
  },
  {
    id: 'network-diagnostics',
    name: 'Network Diagnostics',
    description: 'Check connectivity, DNS, open ports, and network configuration',
    icon: 'wifi',
    command: '/network',
    category: 'Analysis',
    prompt:
      'Run network diagnostics: check internet connectivity, DNS resolution, list open ports and listening services, show active connections, check for any network issues. Test connectivity to {host} if specified.',
    parameters: [
      { name: 'host', label: 'Host to test', type: 'text', placeholder: 'google.com' },
    ],
  },

  // ── Data ────────────────────────────────────────────────────────
  {
    id: 'db-backup',
    name: 'Database Backup',
    description: 'Create a compressed backup of a PostgreSQL or MySQL database',
    icon: 'database',
    command: '/backup',
    category: 'Data',
    prompt:
      'Create a compressed backup of the {db_type} database named {db_name}. Store the backup in /backups/ with a timestamp.',
    parameters: [
      {
        name: 'db_type',
        label: 'Database type',
        type: 'select',
        options: ['PostgreSQL', 'MySQL', 'SQLite'],
        required: true,
      },
      {
        name: 'db_name',
        label: 'Database name',
        type: 'text',
        placeholder: 'mydb',
        required: true,
      },
    ],
  },
  {
    id: 'db-optimize',
    name: 'Database Optimize',
    description: 'Analyze and optimize database performance: indexes, slow queries, vacuuming',
    icon: 'gauge',
    command: '/db-optimize',
    category: 'Data',
    prompt:
      'Optimize the {db_type} database named {db_name}. Check for missing indexes, analyze slow queries, run vacuum/optimize tables, check connection pool settings.',
    parameters: [
      {
        name: 'db_type',
        label: 'Database type',
        type: 'select',
        options: ['PostgreSQL', 'MySQL'],
        required: true,
      },
      { name: 'db_name', label: 'Database name', type: 'text', placeholder: 'mydb', required: true },
    ],
  },

  // ── System ──────────────────────────────────────────────────────
  {
    id: 'cron-manager',
    name: 'Cron Job Manager',
    description: 'List, create, and manage scheduled cron jobs',
    icon: 'clock',
    command: '/cron',
    category: 'System',
    prompt: 'List all current cron jobs for all users. {action}',
    parameters: [
      {
        name: 'action',
        label: 'Action',
        type: 'select',
        options: ['List all jobs', 'Add a new job', 'Remove a job'],
      },
    ],
  },
  {
    id: 'user-management',
    name: 'User Management',
    description: 'Create, modify, or audit system users and their permissions',
    icon: 'users',
    command: '/users',
    category: 'System',
    prompt:
      'Manage system users. {action}. Username: {username}.',
    parameters: [
      {
        name: 'action',
        label: 'Action',
        type: 'select',
        options: ['List all users', 'Create new user', 'Audit permissions', 'Lock user'],
        required: true,
      },
      { name: 'username', label: 'Username', type: 'text', placeholder: 'Optional' },
    ],
  },
  {
    id: 'package-update',
    name: 'Update Packages',
    description: 'Update system packages and check for security patches',
    icon: 'download',
    command: '/update',
    category: 'System',
    prompt:
      'Check for available package updates. List packages with security updates separately. {action}',
    parameters: [
      {
        name: 'action',
        label: 'Action',
        type: 'select',
        options: ['Check only', 'Update security patches', 'Full upgrade'],
      },
    ],
  },
  {
    id: 'service-manager',
    name: 'Service Manager',
    description: 'List, start, stop, restart, and check status of system services',
    icon: 'settings',
    command: '/services',
    category: 'System',
    prompt:
      'Manage systemd services. {action}. Service name: {service}.',
    parameters: [
      {
        name: 'action',
        label: 'Action',
        type: 'select',
        options: ['List running', 'List failed', 'Restart service', 'View logs'],
        required: true,
      },
      { name: 'service', label: 'Service name', type: 'text', placeholder: 'nginx' },
    ],
  },

  // ── Monitoring ──────────────────────────────────────────────────
  {
    id: 'setup-monitoring',
    name: 'Setup Monitoring',
    description: 'Configure uptime monitoring, alerts, and status checks',
    icon: 'eye',
    command: '/monitor',
    category: 'Monitoring',
    prompt:
      'Set up monitoring for this server. Create a script that checks: HTTP endpoints ({url}), disk space, memory usage, and CPU load. Send alerts when thresholds are exceeded. Set up a cron job to run every {interval} minutes.',
    parameters: [
      { name: 'url', label: 'URL to monitor', type: 'text', placeholder: 'http://localhost:3000' },
      { name: 'interval', label: 'Check interval (min)', type: 'text', placeholder: '5' },
    ],
  },
  {
    id: 'resource-monitor',
    name: 'Resource Monitor',
    description: 'Real-time view of CPU, memory, disk I/O, and network traffic',
    icon: 'bar-chart',
    command: '/resources',
    category: 'Monitoring',
    prompt:
      'Show a detailed real-time resource usage report: CPU usage per core, memory breakdown (used, cached, buffers), disk I/O rates, network traffic per interface, and top processes by resource consumption.',
  },
]

// ── Custom skills (persisted in localStorage) ────────────────────

const CUSTOM_SKILLS_KEY = 'anton.customSkills'

function loadCustomSkills(): Skill[] {
  try {
    const raw = localStorage.getItem(CUSTOM_SKILLS_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveCustomSkills(skills: Skill[]) {
  localStorage.setItem(CUSTOM_SKILLS_KEY, JSON.stringify(skills))
}

export function getSkills(): Skill[] {
  return [...builtinSkills, ...loadCustomSkills()]
}

export function getCustomSkills(): Skill[] {
  return loadCustomSkills()
}

export function addCustomSkill(skill: Skill): void {
  const existing = loadCustomSkills()
  existing.push({ ...skill, isCustom: true })
  saveCustomSkills(existing)
}

export function removeCustomSkill(id: string): void {
  const existing = loadCustomSkills()
  saveCustomSkills(existing.filter((s) => s.id !== id))
}

export function findSkillByCommand(command: string): Skill | undefined {
  return getSkills().find((s) => s.command === command)
}

export function executeSkill(skill: Skill, params: Record<string, string> = {}) {
  let prompt = skill.prompt
  for (const [key, value] of Object.entries(params)) {
    prompt = prompt.replace(`{${key}}`, value || '')
  }
  // Clean up unfilled placeholders
  prompt = prompt
    .replace(/\{[^}]+\}/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()

  const store = useStore.getState()
  const convId = store.newConversation(skill.name)

  store.addMessage({
    id: `user_${Date.now()}`,
    role: 'user',
    content: prompt,
    timestamp: Date.now(),
  })

  connection.sendAiMessage(prompt)
  return convId
}
