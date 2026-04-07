import { Plug } from 'lucide-react'
import type { JSX } from 'react'

// Brand SVG icons for each built-in connector
// Each renders at the given size prop (default 24)

function BraveIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M20.3 7.2l.7-1.6-1.6-1.7a3.1 3.1 0 00.1-2.1L18.2.5h-3L12 2.8 8.8.5h-3L4.5 1.8a3.1 3.1 0 00.1 2.1L3 5.6l.7 1.6-.4 2.7c0 .2 0 .4.1.6l2.3 7.4a9.3 9.3 0 004.1 5l1.6 1 .6.1.6-.1 1.6-1a9.3 9.3 0 004.1-5l2.3-7.4.1-.6-.4-2.7z"
        fill="#FB542B"
      />
      <path
        d="M16.1 6.2l-.5-.7-2.4-.7h-2.4l-2.4.7-.5.7-.6 1.5.3 1 1.6 3.5.5 1.2.7 1.5 1 1.3.6.5 1 .7 1-.7.6-.5 1-1.3.7-1.5.5-1.2L16.4 8.7l.3-1-.6-1.5z"
        fill="white"
      />
    </svg>
  )
}

function TelegramIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="11" fill="#2AABEE" />
      <path
        d="M6.5 11.7l8.6-3.8c.4-.2.8 0 .7.4l-1.5 7.2c-.1.5-.4.6-.8.4l-2.3-1.7-1.1 1.1c-.1.1-.2.2-.4.2l.2-2.4 4.6-4.1c.2-.2 0-.3-.3-.1L8.8 13l-2.2-.7c-.5-.2-.5-.5.1-.7z"
        fill="white"
      />
    </svg>
  )
}

function GmailIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="2" y="4" width="20" height="16" rx="2" fill="white" />
      {/* Left red flap */}
      <path d="M2 6.5V18a2 2 0 002 2h1.5V9.5L2 6.5z" fill="#EA4335" />
      {/* Right red flap */}
      <path d="M22 6.5V18a2 2 0 01-2 2h-1.5V9.5L22 6.5z" fill="#EA4335" />
      {/* Blue top-left diagonal */}
      <path d="M2 6a2 2 0 012-2h.5L12 11 19.5 4H20a2 2 0 012 2l-9.5 7L2 6z" fill="#4285F4" />
      {/* Green bottom fold */}
      <path d="M5.5 9.5V20h13V9.5L12 15.5 5.5 9.5z" fill="#34A853" opacity="0.15" />
      {/* The M center white cover */}
      <path d="M5.5 9.5L12 15.5l6.5-6V20H5.5V9.5z" fill="white" />
      {/* Yellow bottom-left triangle */}
      <path d="M2 6.5l3.5 3V20H4a2 2 0 01-2-2V6.5z" fill="#FBBC04" />
    </svg>
  )
}

function GoogleCalendarIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect
        x="3"
        y="3"
        width="18"
        height="18"
        rx="2"
        fill="white"
        stroke="#4285F4"
        strokeWidth="1.2"
      />
      <rect x="3" y="3" width="18" height="5" rx="2" fill="#4285F4" />
      <text
        x="12"
        y="17"
        textAnchor="middle"
        fontSize="8"
        fontWeight="bold"
        fill="#4285F4"
        fontFamily="system-ui"
      >
        17
      </text>
      <rect x="7" y="3" width="2" height="3" rx="1" fill="#1A73E8" y1="1" />
      <rect x="15" y="3" width="2" height="3" rx="1" fill="#1A73E8" y1="1" />
    </svg>
  )
}

function NotionIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="20" height="20" rx="4" fill="white" />
      {/* Notion's iconic skewed N */}
      <path
        d="M7 5.5c0-.6.5-.9 1-.7l9.5 1.8c.4.1.5.4.5.8V18c0 .6-.4.9-.9.8L7.5 17c-.3-.1-.5-.4-.5-.7V5.5z"
        fill="white"
        stroke="#37352F"
        strokeWidth="1.2"
      />
      <path d="M8.5 7.2l1.2.2v8.2l-1.2-.2V7.2z" fill="#37352F" />
      <path d="M9.7 7.4l5.6 7.2V8.4l-5.6-1V7.4z" fill="#37352F" />
      <path d="M15.3 14.6l1.2.2V8.6l-1.2-.2v6z" fill="#37352F" />
    </svg>
  )
}

function GitHubIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2C6.477 2 2 6.477 2 12c0 4.418 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.009-.866-.013-1.7-2.782.604-3.369-1.341-3.369-1.341-.454-1.155-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.115 2.504.337 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10z"
        fill="currentColor"
        opacity="0.85"
      />
    </svg>
  )
}

function SlackIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6.5 14.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zm1 0a1.5 1.5 0 013 0v4a1.5 1.5 0 01-3 0v-4z"
        fill="#E01E5A"
      />
      <path
        d="M9.5 6.5a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm0 1a1.5 1.5 0 010 3h-4a1.5 1.5 0 110-3h4z"
        fill="#36C5F0"
      />
      <path
        d="M17.5 9.5a1.5 1.5 0 113 0 1.5 1.5 0 01-3 0zm-1 0a1.5 1.5 0 01-3 0v-4a1.5 1.5 0 113 0v4z"
        fill="#2EB67D"
      />
      <path
        d="M14.5 17.5a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm0-1a1.5 1.5 0 010-3h4a1.5 1.5 0 110 3h-4z"
        fill="#ECB22E"
      />
    </svg>
  )
}

function LinearIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3.52 12.84l7.64 7.64a9.03 9.03 0 01-7.64-7.64zm-.4-2.4a9.03 9.03 0 011.57-3.58l10.45 10.45a9.03 9.03 0 01-3.58 1.57L3.12 10.44zm3.2-4.88a9 9 0 0114.12 14.12L6.72 5.56z"
        fill="#5E6AD2"
      />
    </svg>
  )
}

function GoogleDriveIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M8.6 3.5h6.8L22 14.8h-6.8L8.6 3.5z" fill="#0F9D58" opacity="0.9" />
      <path d="M2 14.8l3.4 5.7h13.2l3.4-5.7H2z" fill="#4285F4" opacity="0.9" />
      <path d="M8.6 3.5L2 14.8l3.4 5.7L12 9.2 8.6 3.5z" fill="#F4B400" opacity="0.9" />
    </svg>
  )
}

function GranolaIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="20" height="20" rx="6" fill="#FF5C35" />
      <rect x="6" y="11" width="2" height="6" rx="1" fill="white" />
      <rect x="10" y="7" width="2" height="10" rx="1" fill="white" />
      <rect x="14" y="9" width="2" height="8" rx="1" fill="white" />
      <rect x="18" y="12" width="2" height="5" rx="1" fill="white" />
    </svg>
  )
}

function GoogleSearchConsoleIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {/* Rising bar chart */}
      <rect x="2" y="14" width="3.5" height="7" rx="1" fill="#4285F4" />
      <rect x="7" y="10" width="3.5" height="11" rx="1" fill="#34A853" />
      <rect x="12" y="6" width="3.5" height="15" rx="1" fill="#FBBC04" />
      {/* Magnifying glass */}
      <circle cx="19" cy="6" r="3.2" stroke="#EA4335" strokeWidth="1.5" fill="none" />
      <line
        x1="21.2"
        y1="8.2"
        x2="23"
        y2="10"
        stroke="#EA4335"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

function GoogleDocsIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {/* Page background */}
      <rect x="4" y="2" width="16" height="20" rx="1.5" fill="#4285F4" />
      {/* Folded corner */}
      <path d="M14 2l6 6h-6V2z" fill="#A8C7FA" />
      {/* Text lines */}
      <rect x="7" y="10" width="10" height="1.5" rx="0.75" fill="white" opacity="0.9" />
      <rect x="7" y="13" width="10" height="1.5" rx="0.75" fill="white" opacity="0.9" />
      <rect x="7" y="16" width="7" height="1.5" rx="0.75" fill="white" opacity="0.9" />
    </svg>
  )
}

function GoogleSheetsIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {/* Page background */}
      <rect x="4" y="2" width="16" height="20" rx="1.5" fill="#0F9D58" />
      {/* Folded corner */}
      <path d="M14 2l6 6h-6V2z" fill="#81C995" />
      {/* Grid lines horizontal */}
      <rect x="6" y="9" width="12" height="0.75" rx="0.375" fill="white" opacity="0.5" />
      <rect x="6" y="12" width="12" height="0.75" rx="0.375" fill="white" opacity="0.5" />
      <rect x="6" y="15" width="12" height="0.75" rx="0.375" fill="white" opacity="0.5" />
      {/* Grid line vertical */}
      <rect x="11" y="9" width="0.75" height="9" rx="0.375" fill="white" opacity="0.5" />
      {/* Cells */}
      <rect x="6.5" y="9.75" width="4" height="2" rx="0.25" fill="white" opacity="0.2" />
      <rect x="11.75" y="9.75" width="5.75" height="2" rx="0.25" fill="white" opacity="0.2" />
      <rect x="6.5" y="12.75" width="4" height="2" rx="0.25" fill="white" opacity="0.2" />
    </svg>
  )
}

function ExaSearchIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="6" stroke="#6366F1" strokeWidth="1.5" fill="none" />
      <line
        x1="15.5"
        y1="15.5"
        x2="20"
        y2="20"
        stroke="#6366F1"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path d="M9 11h4M11 9v4" stroke="#6366F1" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function AirtableIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M11.5 3.2l-8 3.1c-.3.1-.5.4-.5.7v.2l8.5 3.3c.3.1.7.1 1 0l8.5-3.3v-.2c0-.3-.2-.6-.5-.7l-8-3.1a1.5 1.5 0 00-1 0z"
        fill="#FCB400"
      />
      <path
        d="M12.5 12.2V21c0 .4.4.7.8.5l8.4-4.2c.2-.1.3-.3.3-.5V8.7c0-.4-.4-.7-.8-.5l-8.4 3.5a.6.6 0 00-.3.5z"
        fill="#18BFFF"
      />
      <path
        d="M11.5 12.2V21c0 .4-.4.7-.8.5L2.3 17.3c-.2-.1-.3-.3-.3-.5V8.7c0-.4.4-.7.8-.5l8.4 3.5a.6.6 0 01.3.5z"
        fill="#F82B60"
      />
    </svg>
  )
}

function LinkedInIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="22" height="22" rx="4" fill="#0A66C2" />
      <path d="M7.5 9.5v7M7.5 6.5v.01" stroke="white" strokeWidth="2" strokeLinecap="round" />
      <path
        d="M11 16.5v-4c0-1.1.9-2 2-2s2 .9 2 2v4"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M11 12.5v4" stroke="white" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

// Map connector IDs to their brand icon components
const ICON_MAP: Record<string, (props: { size?: number }) => JSX.Element> = {
  brave: BraveIcon,
  'exa-search': ExaSearchIcon,
  telegram: TelegramIcon,
  gmail: GmailIcon,
  'google-calendar': GoogleCalendarIcon,
  notion: NotionIcon,
  github: GitHubIcon,
  slack: SlackIcon,
  'slack-bot': SlackIcon,
  linear: LinearIcon,
  'google-drive': GoogleDriveIcon,
  granola: GranolaIcon,
  'google-docs': GoogleDocsIcon,
  'google-sheets': GoogleSheetsIcon,
  'google-search-console': GoogleSearchConsoleIcon,
  airtable: AirtableIcon,
  linkedin: LinkedInIcon,
}

/**
 * Renders the appropriate brand icon for a connector by id.
 * Falls back to a generic Plug icon for unknown/custom connectors.
 */
export function ConnectorIcon({
  id,
  size = 24,
}: {
  id: string
  size?: number
}) {
  const IconComponent = ICON_MAP[id]
  if (IconComponent) {
    return <IconComponent size={size} />
  }
  // Fallback for custom connectors
  return <Plug size={size} strokeWidth={1.5} />
}
