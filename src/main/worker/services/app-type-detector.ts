/**
 * App Type Detector
 *
 * Auto-detects the application type based on project structure and dependencies.
 * Used to determine the appropriate E2E testing strategy.
 */

import { existsSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'

import type { AppType } from '../../../shared/types/interfaces/e2e-test'

interface PackageJson {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  scripts?: Record<string, string>
}

const ELECTRON_INDICATORS = ['electron', 'electron-builder', 'electron-forge']

const WEB_FRAMEWORK_INDICATORS = [
  'vite',
  'next',
  '@vitejs/plugin-react',
  'react-scripts',
  'webpack-dev-server',
  '@angular/cli',
  'vue',
  '@vue/cli-service',
  'nuxt',
  'svelte',
  '@sveltejs/kit',
  'astro',
  'gatsby',
  'remix',
  'parcel'
]

const STATIC_SITE_GENERATORS = [
  '11ty',
  '@11ty/eleventy',
  'hexo',
  'hugo',
  'jekyll'
]

/**
 * Auto-detect the application type based on project structure.
 *
 * Detection logic:
 * 1. `electron` in dependencies -> 'electron'
 * 2. Web framework indicators -> 'web'
 * 3. Static site generators or index.html without build tools -> 'static'
 * 4. Default -> 'auto' (tries web, then static at runtime)
 */
export async function detectAppType(cwd: string): Promise<AppType> {
  const packageJson = readPackageJson(cwd)

  if (packageJson) {
    // Check for Electron
    if (hasElectronDependencies(packageJson)) {
      return 'electron'
    }

    // Check for web frameworks
    if (hasWebFrameworkIndicators(packageJson)) {
      return 'web'
    }

    // Check for static site generators
    if (hasStaticSiteGenerators(packageJson)) {
      return 'static'
    }
  }

  // Check for static site indicators
  if (isStaticSite(cwd, packageJson)) {
    return 'static'
  }

  // Default to auto (will try web first, then static)
  return 'auto'
}

/**
 * Read and parse package.json from the project directory.
 */
function readPackageJson(cwd: string): PackageJson | null {
  const packageJsonPath = join(cwd, 'package.json')

  if (!existsSync(packageJsonPath)) {
    return null
  }

  try {
    return JSON.parse(readFileSync(packageJsonPath, 'utf-8'))
  } catch {
    return null
  }
}

/**
 * Get all dependencies (both regular and dev).
 */
function getAllDependencies(packageJson: PackageJson): string[] {
  return [
    ...Object.keys(packageJson.dependencies || {}),
    ...Object.keys(packageJson.devDependencies || {})
  ]
}

/**
 * Check if project has Electron dependencies.
 */
function hasElectronDependencies(packageJson: PackageJson): boolean {
  const deps = getAllDependencies(packageJson)
  return ELECTRON_INDICATORS.some((indicator) =>
    deps.some((dep) => dep === indicator || dep.startsWith(`${indicator}/`))
  )
}

/**
 * Check if project has web framework indicators.
 */
function hasWebFrameworkIndicators(packageJson: PackageJson): boolean {
  const deps = getAllDependencies(packageJson)

  // Check dependencies
  const hasWebDep = WEB_FRAMEWORK_INDICATORS.some((indicator) =>
    deps.some((dep) => dep === indicator || dep.startsWith(`${indicator}/`))
  )

  if (hasWebDep) {
    return true
  }

  // Check scripts for dev server indicators
  const scripts = packageJson.scripts || {}
  const scriptValues = Object.values(scripts).join(' ')

  const devServerPatterns = [
    'vite',
    'next dev',
    'react-scripts start',
    'webpack serve',
    'ng serve',
    'vue-cli-service serve',
    'nuxt dev',
    'svelte-kit dev',
    'astro dev',
    'gatsby develop',
    'remix dev',
    'parcel'
  ]

  return devServerPatterns.some((pattern) => scriptValues.includes(pattern))
}

/**
 * Check if project uses static site generators.
 */
function hasStaticSiteGenerators(packageJson: PackageJson): boolean {
  const deps = getAllDependencies(packageJson)
  return STATIC_SITE_GENERATORS.some((indicator) =>
    deps.some((dep) => dep === indicator)
  )
}

/**
 * Check if project is a static site (has index.html without build tools).
 */
function isStaticSite(cwd: string, packageJson: PackageJson | null): boolean {
  // Check for index.html in common locations
  const staticLocations = [
    'index.html',
    'public/index.html',
    'src/index.html',
    'dist/index.html',
    'build/index.html'
  ]

  const hasIndexHtml = staticLocations.some((location) =>
    existsSync(join(cwd, location))
  )

  if (!hasIndexHtml) {
    return false
  }

  // If there's no package.json, it's likely static
  if (!packageJson) {
    return true
  }

  // If there's no build tool, it's likely static
  const deps = getAllDependencies(packageJson)
  const hasBuildTool = [
    ...WEB_FRAMEWORK_INDICATORS,
    'webpack',
    'rollup',
    'esbuild',
    'swc',
    'babel',
    'typescript'
  ].some((tool) => deps.some((dep) => dep === tool || dep.startsWith(`${tool}/`)))

  return !hasBuildTool
}

/**
 * Get a human-readable description of the detected app type.
 */
export function getAppTypeDescription(appType: AppType): string {
  switch (appType) {
    case 'electron':
      return 'Electron desktop application'
    case 'web':
      return 'Web application with dev server'
    case 'static':
      return 'Static web application (file:// protocol)'
    case 'auto':
      return 'Auto-detect at runtime'
  }
}

/**
 * Resolve 'auto' app type to a concrete type based on project analysis.
 * Used at runtime when appType is 'auto'.
 */
export async function resolveAutoAppType(cwd: string): Promise<'web' | 'static'> {
  const packageJson = readPackageJson(cwd)

  // If there's a package.json with scripts, assume web app
  if (packageJson?.scripts) {
    const scriptNames = Object.keys(packageJson.scripts)
    const hasDevScript = ['dev', 'start', 'serve'].some((name) =>
      scriptNames.includes(name)
    )

    if (hasDevScript) {
      return 'web'
    }
  }

  // Default to static
  return 'static'
}
