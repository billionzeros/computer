const { getDefaultConfig } = require('expo/metro-config')
const path = require('node:path')

const projectRoot = __dirname
const monorepoRoot = path.resolve(projectRoot, '../..')

const config = getDefaultConfig(projectRoot)

// Watch the monorepo root for changes in other packages
config.watchFolders = [monorepoRoot]

// Resolve modules from both the project and monorepo root
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
]

// Ensure @anton/protocol resolves to the workspace package
config.resolver.disableHierarchicalLookup = false

// Force all React-related imports to resolve to the mobile package's copies,
// regardless of which dependency requests them. This prevents the pnpm store
// from serving React 18 (cli) or React 19.2.4 (desktop) to mobile dependencies.
const mobileReactModules = {
  react: path.resolve(projectRoot, 'node_modules/react'),
  'react/jsx-runtime': path.resolve(projectRoot, 'node_modules/react/jsx-runtime'),
  'react/jsx-dev-runtime': path.resolve(projectRoot, 'node_modules/react/jsx-dev-runtime'),
  'react-native': path.resolve(projectRoot, 'node_modules/react-native'),
  'react-dom': path.resolve(projectRoot, 'node_modules/react-dom'),
}

const defaultResolveRequest = config.resolver.resolveRequest
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Intercept any react-related resolution and pin to mobile's copy
  if (mobileReactModules[moduleName]) {
    return {
      type: 'sourceFile',
      filePath: require.resolve(mobileReactModules[moduleName]),
    }
  }

  // Fall back to default resolution
  if (defaultResolveRequest) {
    return defaultResolveRequest(context, moduleName, platform)
  }
  return context.resolveRequest(context, moduleName, platform)
}

module.exports = config
