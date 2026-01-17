const { spawn, execFileSync } = require('child_process')
const { existsSync } = require('fs')
const path = require('path')

const rootDir = path.resolve(__dirname, '..')
const electronModulePath = path.join(rootDir, 'node_modules', 'electron')
const electronDistPath = path.join(electronModulePath, 'dist')
const hostPlatform =
  process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'win32' : 'linux'

function detectElectronPlatform() {
  if (!existsSync(electronDistPath)) return 'missing'
  if (existsSync(path.join(electronDistPath, 'electron.exe'))) return 'win32'
  if (existsSync(path.join(electronDistPath, 'Electron.app'))) return 'darwin'
  if (existsSync(path.join(electronDistPath, 'electron'))) return 'linux'
  return 'unknown'
}

function reinstallElectron() {
  const installScript = path.join(electronModulePath, 'install.js')
  if (!existsSync(installScript)) return false

  try {
    execFileSync(process.execPath, [installScript], {
      stdio: 'inherit',
      env: {
        ...process.env,
        npm_config_platform: process.platform,
        npm_config_arch: process.arch
      }
    })
    return true
  } catch (err) {
    console.warn(`[dev] Electron reinstall failed: ${err?.message || err}`)
    return false
  }
}

function ensureElectronEnv(env) {
  let detected = detectElectronPlatform()
  if (detected === hostPlatform) {
    return env
  }

  console.warn(
    `[dev] Electron binary is for ${detected}, expected ${hostPlatform}. Reinstalling for this platform...`
  )

  if (reinstallElectron()) {
    detected = detectElectronPlatform()
    if (detected === hostPlatform) {
      return env
    }
  }

  if (process.platform === 'linux') {
    const linuxOverride = path.join(rootDir, 'dist', 'linux-unpacked')
    if (existsSync(path.join(linuxOverride, 'electron'))) {
      console.warn(
        `[dev] Using existing Linux build at ${linuxOverride} (ELECTRON_OVERRIDE_DIST_PATH) to avoid Wine.`
      )
      return { ...env, ELECTRON_OVERRIDE_DIST_PATH: linuxOverride }
    }
  }

  console.error(
    `[dev] Electron binary is ${detected}, expected ${hostPlatform}. Remove node_modules and reinstall on this OS (e.g. rm -rf node_modules && npm install).`
  )
  process.exit(1)
}

function runElectronVite(command) {
  const env = ensureElectronEnv({ ...process.env })
  const binName = process.platform === 'win32' ? 'electron-vite.cmd' : 'electron-vite'
  const binPath = path.join(rootDir, 'node_modules', '.bin', binName)

  if (!existsSync(binPath)) {
    console.error('[dev] electron-vite binary not found. Install dependencies first.')
    process.exit(1)
  }

  const child = spawn(binPath, [command], {
    cwd: rootDir,
    env,
    stdio: 'inherit'
  })

  child.on('exit', (code) => process.exit(code ?? 0))
  child.on('error', (err) => {
    console.error(`[dev] Failed to start electron-vite: ${err?.message || err}`)
    process.exit(1)
  })
}

const command = process.argv[2] || 'dev'
runElectronVite(command)
