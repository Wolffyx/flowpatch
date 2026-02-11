/**
 * Project Type Detector
 *
 * Detects project type (Node.js, Python, Go, Rust) and extracts development commands.
 * Includes caching for performance.
 */

import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

export type PackageManager = 'npm' | 'yarn' | 'pnpm' | 'composer' | 'pip' | 'cargo' | 'go'

export interface ProjectTypeInfo {
  type: 'nodejs' | 'python' | 'go' | 'rust' | 'php' | 'unknown'
  hasPackageJson: boolean
  devCommand?: string
  installCommand?: string
  buildCommand?: string
  lintCommand?: string
  testCommand?: string
  port?: number
  startCommand?: string
  detectedFiles: string[]
  packageManager?: PackageManager
}

// Cache for project type detection (keyed by directory path)
const detectionCache = new Map<string, { info: ProjectTypeInfo; timestamp: number }>()
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Clear cache for a specific directory (call when files change)
 */
export function clearDetectionCache(dirPath: string): void {
  detectionCache.delete(dirPath)
}

/**
 * Clear all detection cache
 */
export function clearAllDetectionCache(): void {
  detectionCache.clear()
}

/**
 * Detect project type and extract commands.
 */
export function detectProjectType(projectPath: string): ProjectTypeInfo {
  // Check cache first
  const cached = detectionCache.get(projectPath)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.info
  }

  const detectedFiles: string[] = []
  const info: ProjectTypeInfo = {
    type: 'unknown',
    hasPackageJson: false,
    detectedFiles: []
  }

  // Check for Node.js (package.json)
  const packageJsonPath = join(projectPath, 'package.json')
  if (existsSync(packageJsonPath)) {
    detectedFiles.push('package.json')
    info.hasPackageJson = true
    info.type = 'nodejs'

    try {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))
      const scripts = packageJson.scripts || {}

      // Detect package manager first for consistent command generation
      let pm: 'npm' | 'yarn' | 'pnpm' = 'npm'
      if (existsSync(join(projectPath, 'pnpm-lock.yaml'))) {
        pm = 'pnpm'
        info.packageManager = 'pnpm'
      } else if (existsSync(join(projectPath, 'yarn.lock'))) {
        pm = 'yarn'
        info.packageManager = 'yarn'
      } else {
        info.packageManager = 'npm'
      }

      // Set install command based on package manager
      info.installCommand = `${pm} install`

      // Detect dev command (priority: dev > start > serve)
      if (scripts.dev) {
        info.devCommand = pm === 'yarn' ? 'yarn dev' : `${pm} run dev`
        // Try to detect port from dev script
        const devScript = scripts.dev
        const portMatch = devScript.match(/--port\s+(\d+)/) || devScript.match(/port:\s*(\d+)/)
        if (portMatch) {
          info.port = parseInt(portMatch[1], 10)
        }
      } else if (scripts.start) {
        info.devCommand = pm === 'yarn' ? 'yarn start' : `${pm} run start`
        const startScript = scripts.start
        const portMatch = startScript.match(/--port\s+(\d+)/) || startScript.match(/port:\s*(\d+)/)
        if (portMatch) {
          info.port = parseInt(portMatch[1], 10)
        }
      } else if (scripts.serve) {
        info.devCommand = pm === 'yarn' ? 'yarn serve' : `${pm} run serve`
      }

      // Detect build command
      if (scripts.build) {
        info.buildCommand = pm === 'yarn' ? 'yarn build' : `${pm} run build`
      }

      // Detect lint command (check for lint, eslint, prettier:check scripts)
      if (scripts.lint) {
        info.lintCommand = pm === 'yarn' ? 'yarn lint' : `${pm} run lint`
      } else if (scripts['lint:check']) {
        info.lintCommand = pm === 'yarn' ? 'yarn lint:check' : `${pm} run lint:check`
      } else if (scripts['prettier:check']) {
        info.lintCommand = pm === 'yarn' ? 'yarn prettier:check' : `${pm} run prettier:check`
      }

      // Detect test command (check for test, vitest, jest scripts)
      if (scripts.test) {
        // Use the standard test script shortcut where available
        info.testCommand = `${pm} test`
      } else if (scripts['test:run']) {
        info.testCommand = pm === 'yarn' ? 'yarn test:run' : `${pm} run test:run`
      } else if (scripts.vitest) {
        info.testCommand = pm === 'yarn' ? 'yarn vitest' : `${pm} run vitest`
      }

      // Default port for common frameworks
      if (!info.port) {
        if (scripts.dev?.includes('vite')) {
          info.port = 5173
        } else if (scripts.dev?.includes('next')) {
          info.port = 3000
        } else if (scripts.start?.includes('react-scripts')) {
          info.port = 3000
        } else if (
          packageJson.dependencies?.express ||
          packageJson.dependencies?.['@nestjs/core']
        ) {
          info.port = 3000
        }
      }
    } catch (error) {
      // Invalid JSON, continue with defaults
      console.warn(`Failed to parse package.json: ${error}`)
    }
  }

  // Check for Python
  if (info.type === 'unknown') {
    const requirementsPath = join(projectPath, 'requirements.txt')
    const pyprojectPath = join(projectPath, 'pyproject.toml')
    const managePyPath = join(projectPath, 'manage.py')
    const mainPyPath = join(projectPath, 'main.py')

    if (existsSync(requirementsPath)) {
      detectedFiles.push('requirements.txt')
      info.type = 'python'
      info.installCommand = 'pip install -r requirements.txt'
      info.packageManager = 'pip'
    } else if (existsSync(pyprojectPath)) {
      detectedFiles.push('pyproject.toml')
      info.type = 'python'
      info.installCommand = 'pip install -e .'
      info.packageManager = 'pip'
    }

    if (info.type === 'python') {
      if (existsSync(managePyPath)) {
        // Django
        info.devCommand = 'python manage.py runserver'
        info.testCommand = 'python manage.py test'
        info.port = 8000
      } else if (existsSync(mainPyPath)) {
        // FastAPI or similar
        info.devCommand = 'python main.py'
        info.port = 8000
      } else {
        info.devCommand = 'python -m uvicorn main:app --reload'
        info.port = 8000
      }

      // Check for pytest (common Python test framework)
      if (
        existsSync(join(projectPath, 'pytest.ini')) ||
        existsSync(join(projectPath, 'pyproject.toml'))
      ) {
        info.testCommand = info.testCommand ?? 'pytest'
      }

      // Check for common linters
      if (existsSync(join(projectPath, '.flake8'))) {
        info.lintCommand = 'flake8'
      } else if (existsSync(join(projectPath, 'pyproject.toml'))) {
        // ruff or black are commonly configured in pyproject.toml
        info.lintCommand = info.lintCommand ?? 'ruff check .'
      }
    }
  }

  // Check for Go
  if (info.type === 'unknown') {
    const goModPath = join(projectPath, 'go.mod')
    if (existsSync(goModPath)) {
      detectedFiles.push('go.mod')
      info.type = 'go'
      info.packageManager = 'go'
      info.installCommand = 'go mod download'
      info.devCommand = 'go run .'
      info.buildCommand = 'go build .'
      info.testCommand = 'go test ./...'
      info.lintCommand = 'go vet ./...'
      info.port = 8080
    }
  }

  // Check for Rust
  if (info.type === 'unknown') {
    const cargoTomlPath = join(projectPath, 'Cargo.toml')
    if (existsSync(cargoTomlPath)) {
      detectedFiles.push('Cargo.toml')
      info.type = 'rust'
      info.packageManager = 'cargo'
      info.installCommand = 'cargo build'
      info.devCommand = 'cargo run'
      info.buildCommand = 'cargo build --release'
      info.testCommand = 'cargo test'
      info.lintCommand = 'cargo clippy'
      info.port = 8080
    }
  }

  // Check for PHP (composer.json)
  if (info.type === 'unknown') {
    const composerJsonPath = join(projectPath, 'composer.json')
    if (existsSync(composerJsonPath)) {
      detectedFiles.push('composer.json')
      info.type = 'php'
      info.packageManager = 'composer'
      info.installCommand = 'composer install'

      try {
        const composerJson = JSON.parse(readFileSync(composerJsonPath, 'utf-8'))
        const scripts = composerJson.scripts || {}

        // Detect test command
        if (scripts.test) {
          info.testCommand = 'composer test'
        } else if (existsSync(join(projectPath, 'phpunit.xml')) || existsSync(join(projectPath, 'phpunit.xml.dist'))) {
          info.testCommand = './vendor/bin/phpunit'
        }

        // Detect lint command
        if (scripts.lint) {
          info.lintCommand = 'composer lint'
        } else if (scripts['cs-check'] || scripts['phpcs']) {
          info.lintCommand = scripts['cs-check'] ? 'composer cs-check' : 'composer phpcs'
        } else if (existsSync(join(projectPath, 'phpcs.xml')) || existsSync(join(projectPath, 'phpcs.xml.dist'))) {
          info.lintCommand = './vendor/bin/phpcs'
        }

        // Detect build command
        if (scripts.build) {
          info.buildCommand = 'composer build'
        }

        // Check for Laravel
        const artisanPath = join(projectPath, 'artisan')
        if (existsSync(artisanPath)) {
          detectedFiles.push('artisan')
          info.devCommand = 'php artisan serve'
          info.testCommand = info.testCommand ?? 'php artisan test'
          info.port = 8000
        }
      } catch (error) {
        // Invalid JSON, continue with defaults
        console.warn(`Failed to parse composer.json: ${error}`)
      }
    }
  }

  info.detectedFiles = detectedFiles

  // Cache the result
  detectionCache.set(projectPath, {
    info,
    timestamp: Date.now()
  })

  return info
}
