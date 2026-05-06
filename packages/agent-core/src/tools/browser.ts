import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  constants,
  accessSync,
  chmodSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
} from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { arch, platform } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { getAntonDir } from '@anton/agent-config'
import { createLogger } from '@anton/logger'
import type {
  BrowserAction,
  BrowserEngine,
  BrowserRuntimeComponent,
  BrowserRuntimeInstallTarget,
  BrowserRuntimeStatus,
  BrowserStreamState,
} from '@anton/protocol'

const execFileAsync = promisify(execFile)
const require = createRequire(import.meta.url)
const log = createLogger('browser')

const VISIBLE_SESSION = 'anton-visible'
const BACKGROUND_SESSION = 'anton-lightpanda'
const VISIBLE_PROFILE = join(getAntonDir(), 'browser', 'profiles', 'default')
const DEFAULT_VISIBLE_URL = 'https://antoncomputer.in'
const DEFAULT_VISIBLE_VIEWPORT_WIDTH = 1440
const DEFAULT_VISIBLE_VIEWPORT_HEIGHT = 1100
const VISIBLE_VIEWPORT_SCALE = 1.5
const MANAGED_LIGHTPANDA_DIR = join(getAntonDir(), 'browser', 'lightpanda')
const MANAGED_LIGHTPANDA_EXECUTABLE_PATH = join(MANAGED_LIGHTPANDA_DIR, 'lightpanda')
// Keep Lightpanda upgrades explicit and reviewable instead of tracking nightly.
const LIGHTPANDA_RELEASE_TAG = '0.2.9'
const LIGHTPANDA_RELEASE_API_URL = `https://api.github.com/repos/lightpanda-io/browser/releases/tags/${LIGHTPANDA_RELEASE_TAG}`
const LIGHTPANDA_ASSET_SUFFIXES = {
  darwin: {
    arm64: 'aarch64-macos',
    x64: 'x86_64-macos',
  },
  linux: {
    arm64: 'aarch64-linux',
    x64: 'x86_64-linux',
  },
} as const

export interface BrowserToolInput {
  operation:
    | 'fetch'
    | 'extract'
    | 'open'
    | 'snapshot'
    | 'click'
    | 'fill'
    | 'screenshot'
    | 'scroll'
    | 'get'
    | 'wait'
    | 'close'
    | 'back'
    | 'forward'
    | 'reload'
  url?: string
  ref?: string
  text?: string
  selector?: string
  direction?: 'up' | 'down'
  amount?: number
  property?: 'text' | 'url' | 'title' | 'html'
}

export interface BrowserCallbacks {
  onBrowserState?: (state: {
    url: string
    title: string
    screenshot?: string
    lastAction: BrowserAction
    elementCount?: number
    stream?: BrowserStreamState
    engine?: BrowserEngine
  }) => void
  onBrowserClose?: () => void
}

interface AgentBrowserRunOpts {
  engine: BrowserEngine
  session: string
  profile?: string
  json?: boolean
  timeoutMs?: number
}

function makeAction(action: string, target?: string, value?: string): BrowserAction {
  return { action, target, value, timestamp: Date.now() }
}

function normalizeUrl(url: string): string {
  const trimmed = url.trim()
  if (!trimmed) return DEFAULT_VISIBLE_URL
  if (/^(https?:|file:|about:)/i.test(trimmed)) return trimmed
  if (/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(\/|$)/i.test(trimmed)) {
    return `http://${trimmed}`
  }
  return trimmed
}

function formatAgentBrowserError(err: unknown, engine: BrowserEngine): string {
  const message = (err as Error).message || String(err)
  if (engine === 'lightpanda') {
    return [
      'agent-browser Lightpanda failed.',
      'Install or repair the Browser runtime from Customize → Connectors → Browser.',
      '',
      message,
    ].join('\n')
  }
  return [
    'agent-browser Chrome failed.',
    'Install or repair the Browser runtime from Customize → Connectors → Browser.',
    '',
    message,
  ].join('\n')
}

function shouldCloseAndRetryChrome(message: string): boolean {
  return (
    message.includes('No usable sandbox') ||
    message.includes('DevToolsActivePort') ||
    message.includes('Chrome exited early') ||
    message.includes('error while loading shared libraries')
  )
}

function shouldInstallChromeDeps(message: string): boolean {
  return message.includes('error while loading shared libraries')
}

function browserChildEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  // Anton owns browser runtime configuration through code defaults and CLI args.
  // Inherit normal service env only, so systemd does not need browser-specific vars.
  for (const key of Object.keys(env)) {
    if (key.startsWith('AGENT_BROWSER_') || key === 'LIGHTPANDA_EXECUTABLE_PATH') {
      delete env[key]
    }
  }
  return env
}

function resolveAgentBrowserBin(): string | null {
  try {
    return require.resolve('agent-browser/bin/agent-browser.js')
  } catch {
    return null
  }
}

function resolveAgentBrowserPackageJson(): string | null {
  try {
    return require.resolve('agent-browser/package.json')
  } catch {
    return null
  }
}

function getAgentBrowserBin(): string {
  const binPath = resolveAgentBrowserBin()
  if (binPath) return binPath
  throw new Error(
    'agent-browser is not installed in this Anton deployment. Run pnpm install with the current lockfile and redeploy.',
  )
}

function lightpandaExecutableReady(): boolean {
  if (!existsSync(MANAGED_LIGHTPANDA_EXECUTABLE_PATH)) return false
  try {
    accessSync(MANAGED_LIGHTPANDA_EXECUTABLE_PATH, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function getLightpandaAssetName(): string {
  const currentPlatform = platform()
  const currentArch = arch()
  const suffix =
    currentPlatform === 'darwin' || currentPlatform === 'linux'
      ? LIGHTPANDA_ASSET_SUFFIXES[currentPlatform][
          currentArch as keyof (typeof LIGHTPANDA_ASSET_SUFFIXES)[typeof currentPlatform]
        ]
      : undefined

  if (!suffix) {
    throw new Error(`Lightpanda is not available for ${currentPlatform}/${currentArch}`)
  }
  return `lightpanda-${suffix}`
}

interface LightpandaReleaseAsset {
  name?: string
  browser_download_url?: string
  digest?: string
}

async function fetchLightpandaReleaseAsset(): Promise<{
  assetName: string
  downloadUrl: string
  expectedDigest: string
}> {
  const assetName = getLightpandaAssetName()
  const response = await fetch(LIGHTPANDA_RELEASE_API_URL, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Anton-Browser-Runtime',
    },
  })
  if (!response.ok) {
    throw new Error(`Failed to read Lightpanda release metadata: HTTP ${response.status}`)
  }

  const release = (await response.json()) as { assets?: LightpandaReleaseAsset[] }
  const asset = release.assets?.find((candidate) => candidate.name === assetName)
  if (!asset?.browser_download_url) {
    throw new Error(`Lightpanda release ${LIGHTPANDA_RELEASE_TAG} is missing ${assetName}`)
  }
  if (!asset.digest?.startsWith('sha256:')) {
    throw new Error(`Lightpanda release ${assetName} is missing a SHA-256 digest`)
  }
  return {
    assetName,
    downloadUrl: asset.browser_download_url,
    expectedDigest: asset.digest,
  }
}

async function downloadLightpandaAsset(downloadUrl: string, expectedDigest: string): Promise<void> {
  const response = await fetch(downloadUrl, {
    headers: {
      'User-Agent': 'Anton-Browser-Runtime',
    },
  })
  if (!response.ok) {
    throw new Error(`Failed to download Lightpanda: HTTP ${response.status}`)
  }

  const bytes = Buffer.from(await response.arrayBuffer())
  const actualDigest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`
  if (actualDigest !== expectedDigest) {
    throw new Error(`Lightpanda checksum mismatch: expected ${expectedDigest}, got ${actualDigest}`)
  }

  mkdirSync(MANAGED_LIGHTPANDA_DIR, { recursive: true })
  const tempPath = join(MANAGED_LIGHTPANDA_DIR, `lightpanda.${process.pid}.${Date.now()}.tmp`)
  try {
    await writeFile(tempPath, bytes, { mode: 0o700 })
    chmodSync(tempPath, 0o700)
    renameSync(tempPath, MANAGED_LIGHTPANDA_EXECUTABLE_PATH)
  } catch (err) {
    rmSync(tempPath, { force: true })
    throw err
  }
}

async function runAgentBrowserCommand(args: string[], opts?: { timeoutMs?: number }) {
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [getAgentBrowserBin(), ...args],
    {
      encoding: 'utf8',
      timeout: opts?.timeoutMs ?? 30_000,
      maxBuffer: 8 * 1024 * 1024,
      env: browserChildEnv(),
    },
  )
  return (stdout || stderr).trim()
}

async function missingLinuxSharedLibraries(executablePath?: string): Promise<string[]> {
  if (!executablePath || platform() !== 'linux') return []
  try {
    const { stdout, stderr } = await execFileAsync('ldd', [executablePath], {
      encoding: 'utf8',
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    })
    const output = `${stdout}\n${stderr}`
    return Array.from(
      new Set(
        [...output.matchAll(/^\s*(\S+)\s+=>\s+not found\s*$/gm)]
          .map((match) => match[1])
          .filter(Boolean),
      ),
    )
  } catch {
    return []
  }
}

async function runAgentBrowser(args: string[], opts: AgentBrowserRunOpts): Promise<string> {
  const cliArgs: string[] = ['--engine', opts.engine, '--session', opts.session]
  if (opts.engine === 'lightpanda' && lightpandaExecutableReady()) {
    cliArgs.push('--executable-path', MANAGED_LIGHTPANDA_EXECUTABLE_PATH)
  }
  if (opts.engine === 'chrome' && platform() === 'linux') {
    cliArgs.push('--args', '--no-sandbox,--disable-dev-shm-usage')
  }
  cliArgs.push('--screenshot-format', 'jpeg', '--screenshot-quality', '88')
  if (opts.profile) cliArgs.push('--profile', opts.profile)
  cliArgs.push(...args)
  if (opts.json) cliArgs.push('--json')

  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [getAgentBrowserBin(), ...cliArgs],
      {
        encoding: 'utf8',
        timeout: opts.timeoutMs ?? 30_000,
        maxBuffer: 8 * 1024 * 1024,
        env: browserChildEnv(),
      },
    )
    return (stdout || stderr).trim()
  } catch (err: unknown) {
    throw new Error(formatAgentBrowserError(err, opts.engine))
  }
}

async function runVisible(args: string[], opts?: { json?: boolean; timeoutMs?: number }) {
  mkdirSync(VISIBLE_PROFILE, { recursive: true })
  return runAgentBrowser(args, {
    engine: 'chrome',
    session: VISIBLE_SESSION,
    profile: VISIBLE_PROFILE,
    json: opts?.json,
    timeoutMs: opts?.timeoutMs,
  })
}

async function runBackground(args: string[], opts?: { json?: boolean; timeoutMs?: number }) {
  return runAgentBrowser(args, {
    engine: 'lightpanda',
    session: BACKGROUND_SESSION,
    json: opts?.json,
    timeoutMs: opts?.timeoutMs,
  })
}

async function getVisibleProperty(property: 'url' | 'title'): Promise<string> {
  return runVisible(['get', property], { timeoutMs: 10_000 }).catch(() => '')
}

async function getVisibleStream(): Promise<BrowserStreamState> {
  const stream: BrowserStreamState = { session: VISIBLE_SESSION, engine: 'chrome' }
  const parseStatus = (raw: string) => {
    const parsed = JSON.parse(raw) as {
      success?: boolean
      data?: {
        enabled?: boolean
        port?: number
        connected?: boolean
        screencasting?: boolean
      }
      enabled?: boolean
      port?: number
      connected?: boolean
      screencasting?: boolean
    }
    return parsed.data ?? parsed
  }
  try {
    let raw = await runVisible(['stream', 'status'], { json: true, timeoutMs: 10_000 })
    let parsed = parseStatus(raw)
    if (!parsed.enabled || !parsed.port) {
      await runVisible(['stream', 'enable'], { timeoutMs: 10_000 }).catch(() => '')
      raw = await runVisible(['stream', 'status'], { json: true, timeoutMs: 10_000 })
      parsed = parseStatus(raw)
    }
    return { ...stream, ...parsed }
  } catch {
    return stream
  }
}

async function emitVisibleState(
  action: BrowserAction,
  callbacks?: BrowserCallbacks,
  elementCount?: number,
) {
  if (!callbacks?.onBrowserState) return
  const [url, title, stream] = await Promise.all([
    getVisibleProperty('url'),
    getVisibleProperty('title'),
    getVisibleStream(),
  ])
  callbacks.onBrowserState({
    url,
    title,
    lastAction: action,
    elementCount,
    stream,
    engine: 'chrome',
  })
}

function clampViewportSize(width: number, height: number): { width: number; height: number } {
  const safeWidth = Number.isFinite(width) ? Math.round(width) : DEFAULT_VISIBLE_VIEWPORT_WIDTH
  const safeHeight = Number.isFinite(height) ? Math.round(height) : DEFAULT_VISIBLE_VIEWPORT_HEIGHT
  return {
    width: Math.min(1920, Math.max(800, safeWidth)),
    height: Math.min(1400, Math.max(600, safeHeight)),
  }
}

async function setVisibleViewport(width: number, height: number): Promise<void> {
  const viewport = clampViewportSize(width, height)
  await runVisible(
    [
      'set',
      'viewport',
      String(viewport.width),
      String(viewport.height),
      String(VISIBLE_VIEWPORT_SCALE),
    ],
    {
      timeoutMs: 10_000,
    },
  )
}

async function openVisible(url: string, callbacks?: BrowserCallbacks): Promise<string> {
  const target = normalizeUrl(url)
  let output: string
  try {
    await setVisibleViewport(DEFAULT_VISIBLE_VIEWPORT_WIDTH, DEFAULT_VISIBLE_VIEWPORT_HEIGHT).catch(
      () => '',
    )
    output = await runVisible(['open', target], { timeoutMs: 45_000 })
  } catch (err) {
    const message = (err as Error).message || String(err)
    if (!shouldCloseAndRetryChrome(message)) throw err

    await runAgentBrowserCommand(['close', '--all'], { timeoutMs: 30_000 }).catch(() => '')
    if (shouldInstallChromeDeps(message)) {
      await installChromeRuntime()
    }
    await setVisibleViewport(DEFAULT_VISIBLE_VIEWPORT_WIDTH, DEFAULT_VISIBLE_VIEWPORT_HEIGHT).catch(
      () => '',
    )
    output = await runVisible(['open', target], { timeoutMs: 45_000 })
  }
  await emitVisibleState(makeAction('open', target), callbacks)
  return output || `Opened ${target}`
}

export async function refreshVisibleBrowserState(
  callbacks?: BrowserCallbacks,
  action: BrowserAction = makeAction('refresh'),
): Promise<void> {
  await emitVisibleState(action, callbacks)
}

export async function setVisibleBrowserViewport(
  width: number,
  height: number,
  callbacks?: BrowserCallbacks,
): Promise<void> {
  const viewport = clampViewportSize(width, height)
  await setVisibleViewport(viewport.width, viewport.height)
  await emitVisibleState(
    makeAction('viewport', `${viewport.width}x${viewport.height}`),
    callbacks,
  )
}

async function ensureLightpandaRuntime(): Promise<void> {
  if (lightpandaExecutableReady()) return
  await installLightpandaRuntime()
}

async function getLightpandaText(url: string, selector?: string): Promise<string> {
  await ensureLightpandaRuntime()
  const target = normalizeUrl(url)
  await runBackground(['open', target], { timeoutMs: 30_000 })
  const args = ['get', 'text', selector ?? 'body']
  return runBackground(args, { timeoutMs: 30_000 })
}

async function getLightpandaHtml(url: string, selector?: string): Promise<string> {
  await ensureLightpandaRuntime()
  const target = normalizeUrl(url)
  await runBackground(['open', target], { timeoutMs: 30_000 })
  const args = ['get', 'html', selector ?? 'html']
  return runBackground(args, { timeoutMs: 30_000 })
}

function browserRuntimeOverall(
  components: BrowserRuntimeComponent[],
): BrowserRuntimeStatus['overall'] {
  if (components.some((c) => c.status === 'installing')) return 'installing'
  const required = components.filter((c) => c.required)
  if (required.every((c) => c.status === 'ready')) return 'ready'
  if (required.some((c) => c.status === 'error')) return 'error'
  if (required.some((c) => c.status === 'ready')) return 'partial'
  return 'missing'
}

function agentBrowserComponent(): BrowserRuntimeComponent {
  const binPath = resolveAgentBrowserBin()
  const pkgPath = resolveAgentBrowserPackageJson()
  if (!binPath || !pkgPath) {
    return {
      id: 'agent-browser',
      label: 'agent-browser',
      status: 'missing',
      required: true,
      installable: false,
      detail:
        'agent-browser is missing from this deployment. Run pnpm install with the current lockfile and redeploy.',
    }
  }

  try {
    const pkg = require(pkgPath) as { version?: string }
    return {
      id: 'agent-browser',
      label: 'agent-browser',
      status: 'ready',
      required: true,
      installable: false,
      path: binPath,
      version: pkg.version,
      detail: 'Pinned with Anton',
    }
  } catch (err) {
    return {
      id: 'agent-browser',
      label: 'agent-browser',
      status: 'error',
      required: true,
      installable: false,
      detail: (err as Error).message,
    }
  }
}

async function chromeComponent(): Promise<BrowserRuntimeComponent> {
  try {
    const raw = await runAgentBrowserCommand(['doctor', '--offline', '--quick', '--json'], {
      timeoutMs: 20_000,
    })
    const parsed = JSON.parse(raw) as {
      checks?: Array<{ id?: string; status?: string; message?: string }>
    }
    const check = parsed.checks?.find((c) => c.id === 'chrome.installed')
    if (check?.status === 'pass') {
      const detail = check.message ?? 'Chrome is available'
      const chromePath = detail.match(/Chrome at ([^\s]+)(?:\s+\(|$)/)?.[1]
      const antonManaged =
        detail.includes('/.agent-browser/browsers/') ||
        detail.includes('.agent-browser/browsers/') ||
        detail.includes('Chrome for Testing')
      if (!antonManaged) {
        return {
          id: 'chrome',
          label: 'Chrome for Anton',
          status: 'missing',
          required: true,
          installable: true,
          path: chromePath,
          detail: 'Install Anton-managed Chrome to keep browser sessions isolated.',
        }
      }
      const missingLibraries = await missingLinuxSharedLibraries(chromePath)
      if (missingLibraries.length > 0) {
        return {
          id: 'chrome',
          label: 'Chrome for Anton',
          status: 'error',
          required: true,
          installable: true,
          path: chromePath,
          detail: `Chrome is installed, but Linux system libraries are missing: ${missingLibraries.join(', ')}. Run Repair to install Chrome dependencies.`,
        }
      }
      return {
        id: 'chrome',
        label: 'Chrome for Anton',
        status: 'ready',
        required: true,
        installable: true,
        path: chromePath,
        detail: 'Managed Chrome is installed',
      }
    }
    return {
      id: 'chrome',
      label: 'Chrome for Anton',
      status: check?.status === 'fail' ? 'missing' : 'unknown',
      required: true,
      installable: true,
      detail: check?.message ?? 'Chrome status is unknown',
    }
  } catch (err) {
    return {
      id: 'chrome',
      label: 'Chrome for Anton',
      status: 'error',
      required: true,
      installable: true,
      detail: (err as Error).message,
    }
  }
}

function lightpandaComponent(): BrowserRuntimeComponent {
  const executablePath = MANAGED_LIGHTPANDA_EXECUTABLE_PATH
  const exists = existsSync(executablePath)
  const installed = lightpandaExecutableReady()
  return {
    id: 'lightpanda',
    label: 'Lightpanda',
    status: installed ? 'ready' : exists ? 'error' : 'missing',
    required: true,
    installable: true,
    path: installed ? executablePath : undefined,
    detail: installed
      ? 'Installed in Anton-managed runtime directory'
      : exists
        ? `Lightpanda exists but is not executable at ${executablePath}. Run Repair.`
        : 'Install Lightpanda for fast background browsing',
  }
}

export async function getBrowserRuntimeStatus(): Promise<BrowserRuntimeStatus> {
  const components = [agentBrowserComponent(), await chromeComponent(), lightpandaComponent()]
  return {
    overall: browserRuntimeOverall(components),
    profileDir: VISIBLE_PROFILE,
    components,
    checkedAt: Date.now(),
  }
}

async function installChromeRuntime(): Promise<void> {
  const args = ['install']
  if (platform() === 'linux') args.push('--with-deps')
  await runAgentBrowserCommand(args, { timeoutMs: 300_000 })
}

async function installLightpandaRuntime(): Promise<void> {
  const asset = await fetchLightpandaReleaseAsset()
  log.info(
    { assetName: asset.assetName, path: MANAGED_LIGHTPANDA_EXECUTABLE_PATH },
    'installing Anton-managed Lightpanda runtime',
  )
  await downloadLightpandaAsset(asset.downloadUrl, asset.expectedDigest)
}

export async function installBrowserRuntime(
  target: BrowserRuntimeInstallTarget,
  onProgress?: (stage: 'checking' | 'installing' | 'verifying' | 'done', message: string) => void,
): Promise<BrowserRuntimeStatus> {
  onProgress?.('checking', 'Checking browser runtime')

  if (target === 'chrome' || target === 'all' || target === 'repair') {
    onProgress?.('installing', 'Installing Chrome for Anton')
    if (target === 'repair') {
      await runAgentBrowserCommand(['close', '--all'], { timeoutMs: 30_000 }).catch(() => '')
      await installChromeRuntime()
      await runAgentBrowserCommand(['doctor', '--fix'], { timeoutMs: 180_000 })
    } else {
      await installChromeRuntime()
    }
  }

  if (target === 'lightpanda' || target === 'all' || target === 'repair') {
    onProgress?.('installing', 'Installing Lightpanda for Anton')
    await installLightpandaRuntime()
  }

  onProgress?.('verifying', 'Verifying browser runtime')
  const status = await getBrowserRuntimeStatus()
  return status
}

export async function closeBrowserSession(): Promise<void> {
  await Promise.allSettled([
    runVisible(['close'], { timeoutMs: 10_000 }),
    runBackground(['close'], { timeoutMs: 10_000 }),
  ])
}

export async function executeBrowser(
  input: BrowserToolInput,
  callbacks?: BrowserCallbacks,
): Promise<string> {
  const { operation, url, ref, text, selector, direction, amount, property } = input

  try {
    switch (operation) {
      case 'fetch': {
        if (!url) return 'Error: url is required for fetch'
        return await getLightpandaText(url)
      }

      case 'extract': {
        if (!url) return 'Error: url is required for extract'
        return property === 'html'
          ? await getLightpandaHtml(url, selector)
          : await getLightpandaText(url, selector)
      }

      case 'open': {
        return openVisible(url || DEFAULT_VISIBLE_URL, callbacks)
      }

      case 'snapshot': {
        const output = await runVisible(['snapshot', '-i'], { timeoutMs: 30_000 })
        const match = output.match(/\[ref=/g)
        await emitVisibleState(makeAction('snapshot'), callbacks, match?.length)
        return output
      }

      case 'click': {
        if (!ref) return 'Error: ref is required for click (e.g. @e1)'
        const output = await runVisible(['click', ref], { timeoutMs: 30_000 })
        await emitVisibleState(makeAction('click', ref), callbacks)
        return output || `Clicked ${ref}`
      }

      case 'fill': {
        if (!ref) return 'Error: ref is required for fill'
        if (text === undefined) return 'Error: text is required for fill'
        const output = await runVisible(['fill', ref, text], { timeoutMs: 30_000 })
        await emitVisibleState(makeAction('fill', ref, text), callbacks)
        return output || `Filled ${ref}`
      }

      case 'screenshot': {
        const output = await runVisible(['screenshot'], { timeoutMs: 30_000 })
        await emitVisibleState(makeAction('screenshot'), callbacks)
        return output || 'Screenshot captured'
      }

      case 'scroll': {
        const dir = direction || 'down'
        const px = String(amount || 500)
        const output = await runVisible(['scroll', dir, px], { timeoutMs: 30_000 })
        await emitVisibleState(makeAction('scroll', dir, px), callbacks)
        return output || `Scrolled ${dir} ${px}px`
      }

      case 'get': {
        const prop = property || 'text'
        const defaultSelector = prop === 'html' ? 'html' : prop === 'text' ? 'body' : undefined
        const args = ref
          ? ['get', prop, ref]
          : defaultSelector
            ? ['get', prop, defaultSelector]
            : ['get', prop]
        return await runVisible(args, { timeoutMs: 30_000 })
      }

      case 'wait': {
        const target = ref || String(amount || 1000)
        const output = await runVisible(['wait', target], { timeoutMs: 35_000 })
        await emitVisibleState(makeAction('wait', target), callbacks)
        return output || `Waited for ${target}`
      }

      case 'back':
      case 'forward':
      case 'reload': {
        const output = await runVisible([operation], { timeoutMs: 30_000 })
        await emitVisibleState(makeAction(operation), callbacks)
        return output || `Browser ${operation}`
      }

      case 'close': {
        await closeBrowserSession()
        callbacks?.onBrowserClose?.()
        return 'Browser closed'
      }

      default:
        return `Unknown operation: ${operation}`
    }
  } catch (err: unknown) {
    log.warn({ err, operation }, 'browser operation failed')
    return `Error: ${(err as Error).message || String(err)}`
  }
}
