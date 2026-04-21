import { Check, Loader2 } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import type { ProviderInfo } from '../../lib/store.js'
import { sessionStore } from '../../lib/store/sessionStore.js'
import { Modal } from '../ui/Modal.js'
import { providerIcons } from './model-utils.js'

interface Props {
  provider: ProviderInfo | null
  onClose: () => void
}

export function HarnessSetupModal({ provider, onClose }: Props) {
  const statuses = sessionStore((s) => s.harnessStatuses)
  const progressMap = sessionStore((s) => s.harnessSetupProgress)
  const sendHarnessSetup = sessionStore((s) => s.sendHarnessSetup)
  const sendDetectHarnesses = sessionStore((s) => s.sendDetectHarnesses)
  const [code, setCode] = useState('')

  useEffect(() => {
    if (provider) sendDetectHarnesses()
  }, [provider, sendDetectHarnesses])

  if (!provider) return null

  const status = statuses[provider.name]
  const progress = progressMap[provider.name]
  const icon = providerIcons[provider.name]
  const providerLabel = provider.name.charAt(0).toUpperCase() + provider.name.slice(1)

  const installed = !!status?.installed
  const loggedIn = !!status?.auth?.loggedIn
  const busy =
    !!progress && progress.success === undefined && progress.step !== 'done' && !progress.message

  const connected = installed && loggedIn
  const installBusy = busy && progress?.action === 'install'
  const loginBusy = busy && progress?.action === 'login'
  const awaitingCode = progress?.action === 'login' && progress?.step === 'awaiting_code'

  return (
    <Modal open={!!provider} onClose={onClose}>
      <div className="prov-modal">
        <div className="prov-modal__titlebar">
          <div className="prov-modal__titlebar-left">
            {icon ? (
              <img src={icon} alt="" width={20} height={20} className="prov-modal__provider-icon" />
            ) : (
              <span className="prov-modal__provider-icon-fallback">
                {provider.name.charAt(0).toUpperCase()}
              </span>
            )}
            <span className="prov-modal__provider-name">{providerLabel} CLI</span>
            {status?.version && <span className="prov-modal__provider-url">v{status.version}</span>}
          </div>
          {connected && (
            <span className="prov-modal__connected-badge">
              <span className="prov-modal__connected-dot" />
              Connected
            </span>
          )}
        </div>

        {connected ? (
          <div className="prov-connected">
            <div className="prov-connected__check">
              <Check size={20} strokeWidth={2.25} />
            </div>
            <div className="prov-connected__body">
              <div className="prov-connected__title">{providerLabel} CLI is ready</div>
              <div className="prov-connected__meta">
                {status?.auth?.email ? (
                  <>
                    Signed in as <strong>{status.auth.email}</strong>
                  </>
                ) : (
                  'Signed in'
                )}
                {status?.auth?.subscriptionType && (
                  <span className="prov-connected__chip">{status.auth.subscriptionType}</span>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="prov-steps">
            <StepRow
              index={1}
              title="Install CLI"
              desc={
                installed
                  ? status?.version
                    ? `Installed · v${status.version}`
                    : 'Installed on this machine.'
                  : 'The CLI is not yet available on this machine.'
              }
              state={installed ? 'done' : installBusy ? 'busy' : 'pending'}
              action={
                installed ? null : (
                  <button
                    type="button"
                    className="prov-modal__key-btn"
                    disabled={busy}
                    onClick={() => sendHarnessSetup(provider.name, 'install')}
                  >
                    {installBusy ? (
                      <>
                        <Loader2 size={14} strokeWidth={1.5} className="spin" /> Installing…
                      </>
                    ) : (
                      'Install'
                    )}
                  </button>
                )
              }
            />

            <StepRow
              index={2}
              title="Sign in"
              desc={
                loggedIn
                  ? status?.auth?.email
                    ? `Signed in as ${status.auth.email}`
                    : 'Signed in'
                  : 'Start a browser login flow for the CLI.'
              }
              state={loggedIn ? 'done' : loginBusy ? 'busy' : 'pending'}
              disabled={!installed}
              action={
                loggedIn ? null : (
                  <button
                    type="button"
                    className="prov-modal__key-btn"
                    disabled={busy || !installed}
                    onClick={() => sendHarnessSetup(provider.name, 'login')}
                  >
                    {loginBusy ? (
                      <>
                        <Loader2 size={14} strokeWidth={1.5} className="spin" /> Waiting…
                      </>
                    ) : (
                      'Sign in'
                    )}
                  </button>
                )
              }
            />

            {awaitingCode && (
              <form
                className="prov-step__code"
                onSubmit={(e) => {
                  e.preventDefault()
                  const trimmed = code.trim()
                  if (!trimmed) return
                  sendHarnessSetup(provider.name, 'login_code', trimmed)
                  setCode('')
                }}
              >
                <input
                  className="prov-modal__key-input"
                  placeholder="Paste verification code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
                <button type="submit" disabled={!code.trim()} className="prov-modal__key-btn">
                  Submit
                </button>
              </form>
            )}
          </div>
        )}

        {progress?.message && (
          <div
            className={`prov-modal__status${progress.success === false ? ' is-error' : ''}`}
            role="status"
          >
            {progress.message}
          </div>
        )}
      </div>
    </Modal>
  )
}

interface StepRowProps {
  index: number
  title: string
  desc: string
  state: 'pending' | 'busy' | 'done'
  disabled?: boolean
  action: ReactNode
}

function StepRow({ index, title, desc, state, disabled, action }: StepRowProps) {
  return (
    <div
      className={`prov-step prov-step--${state}${disabled ? ' is-disabled' : ''}`}
      aria-disabled={disabled || undefined}
    >
      <div className="prov-step__indicator">
        {state === 'done' ? (
          <Check size={13} strokeWidth={2.5} />
        ) : state === 'busy' ? (
          <Loader2 size={13} strokeWidth={2} className="spin" />
        ) : (
          <span>{index}</span>
        )}
      </div>
      <div className="prov-step__body">
        <div className="prov-step__title">{title}</div>
        <div className="prov-step__desc">{desc}</div>
      </div>
      {action && <div className="prov-step__action">{action}</div>}
    </div>
  )
}
