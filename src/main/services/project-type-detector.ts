/**
 * Project Type Detector
 *
 * Detects project type (Node.js, Python, Go, Rust) and extracts development commands.
 * Includes caching for performance.
 */

import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

export interface ProjectTypeInfo {
  type: 'nodejs' | 'python' | 'go' | 'rust' | 'unknown'
  hasPackageJson: boolean
  devCommand?: string
  installCommand?: string
  buildCommand?: string
  port?: number
  startCommand?: string
  detectedFiles: string[]
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

      // Detect dev command (priority: dev > start > serve)
      if (scripts.dev) {
        info.devCommand = 'npm run dev'
        // Try to detect port from dev script
        const devScript = scripts.dev
        const portMatch = devScript.match(/--port\s+(\d+)/) || devScript.match(/port:\s*(\d+)/)
        if (portMatch) {
          info.port = parseInt(portMatch[1], 10)
        }
      } else if (scripts.start) {
        info.devCommand = 'npm run start'
        const startScript = scripts.start
        const portMatch = startScript.match(/--port\s+(\d+)/) || startScript.match(/port:\s*(\d+)/)
        if (portMatch) {
          info.port = parseInt(portMatch[1], 10)
        }
      } else if (scripts.serve) {
        info.devCommand = 'npm run serve'
      }

      // Detect install command
      if (existsSync(join(projectPath, 'package-lock.json'))) {
        info.installCommand = 'npm install'
      } else if (existsSync(join(projectPath, 'yarn.lock'))) {
        info.installCommand = 'yarn install'
        if (info.devCommand) {
          info.devCommand = info.devCommand.replace('npm run', 'yarn')
        }
      } else if (existsSync(join(projectPath, 'pnpm-lock.yaml'))) {
        info.installCommand = 'pnpm install'
        if (info.devCommand) {
          info.devCommand = info.devCommand.replace('npm run', 'pnpm')
        }
      } else {
        info.installCommand = 'npm install'
      }

      // Detect build command
      if (scripts.build) {
        info.buildCommand = info.installCommand?.replace('install', 'run build') || 'npm run build'
      }

      // Default port for common frameworks
      if (!info.port) {
        if (scripts.dev?.includes('vite')) {
          info.port = 5173
        } else if (scripts.dev?.includes('next')) {
          info.port = 3000
        } else if (scripts.start?.includes('react-scripts')) {
          info.port = 3000
        } else if (packageJson.dependencies?.express || packageJson.dependencies?.['@nestjs/core']) {
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
    } else if (existsSync(pyprojectPath)) {
      detectedFiles.push('pyproject.toml')
      info.type = 'python'
      info.installCommand = 'pip install -e .'
    }

    if (info.type === 'python') {
      if (existsSync(managePyPath)) {
        // Django
        info.devCommand = 'python manage.py runserver'
        info.port = 8000
      } else if (existsSync(mainPyPath)) {
        // FastAPI or similar
        info.devCommand = 'python main.py'
        info.port = 8000
      } else {
        info.devCommand = 'python -m uvicorn main:app --reload'
        info.port = 8000
      }
    }
  }

  // Check for Go
  if (info.type === 'unknown') {
    const goModPath = join(projectPath, 'go.mod')
    if (existsSync(goModPath)) {
      detectedFiles.push('go.mod')
      info.type = 'go'
      info.installCommand = 'go mod download'
      info.devCommand = 'go run .'
      info.port = 8080
    }
  }

  // Check for Rust
  if (info.type === 'unknown') {
    const cargoTomlPath = join(projectPath, 'Cargo.toml')
    if (existsSync(cargoTomlPath)) {
      detectedFiles.push('Cargo.toml')
      info.type = 'rust'
      info.installCommand = 'cargo build'
      info.devCommand = 'cargo run'
      info.port = 8080
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
