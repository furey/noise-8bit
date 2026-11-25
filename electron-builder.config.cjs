const fs = require('node:fs')
const path = require('node:path')

const plainNamesByArchName = {
  'Noise-8bit-Mac-universal.dmg': 'Noise-8bit-Mac.dmg',
  'Noise-8bit-Mac-arm64.dmg': 'Noise-8bit-Mac-Apple-Chip.dmg',
  'Noise-8bit-Mac-x64.dmg': 'Noise-8bit-Mac-Intel.dmg',
  'Noise-8bit-Linux-x86_64.AppImage': 'Noise-8bit-Linux.AppImage',
  'Noise-8bit-Linux-arm64.AppImage': 'Noise-8bit-Linux-ARM.AppImage'
}

module.exports = {
  appId: 'io.github.furey.noise-8bit',
  productName: 'Noise 8bit',
  copyright: 'Copyright © James Furey. PolyForm Noncommercial 1.0.0.',
  directories: { output: 'release', buildResources: 'build' },
  files: ['dist/**/*', 'electron/**/*', 'package.json'],
  asar: true,
  electronLanguages: ['en', 'en-GB', 'en_GB'],
  extraMetadata: { main: 'electron/main.mjs' },
  publish: null,
  electronFuses: {
    runAsNode: false,
    enableCookieEncryption: true,
    enableNodeOptionsEnvironmentVariable: false,
    onlyLoadAppFromAsar: true,
    enableEmbeddedAsarIntegrityValidation: true,
    grantFileProtocolExtraPrivileges: false,
    loadBrowserProcessSpecificV8Snapshot: false
  },
  mac: {
    target: [
      { target: 'dmg', arch: ['universal', 'arm64', 'x64'] }
    ],
    icon: 'build/icon.icns',
    identity: '-',
    hardenedRuntime: false,
    gatekeeperAssess: false,
    category: 'public.app-category.music'
  },
  dmg: {
    sign: false,
    format: 'ULFO',
    title: 'Noise ${version}',
    artifactName: 'Noise-8bit-Mac-${arch}.${ext}'
  },
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'build/icon.ico',
    signAndEditExecutable: process.platform === 'win32'
  },
  nsis: {
    oneClick: true,
    perMachine: false,
    deleteAppDataOnUninstall: false,
    shortcutName: 'Noise 8bit',
    artifactName: 'Noise-8bit-Windows.${ext}'
  },
  linux: {
    target: [{ target: 'AppImage', arch: ['x64', 'arm64'] }],
    category: 'Audio',
    executableName: 'noise',
    icon: 'build/icons',
    synopsis: 'Five colours of noise for focus and sleep.'
  },
  appImage: { artifactName: 'Noise-8bit-Linux-${arch}.${ext}' },
  afterAllArtifactBuild: ({ artifactPaths }) => {
    artifactPaths.forEach(renameToPlainName)
    return []
  }
}

const renameToPlainName = (artifactPath) => {
  const plainName = plainNamesByArchName[path.basename(artifactPath)]
  if (!plainName) return
  fs.renameSync(artifactPath, path.join(path.dirname(artifactPath), plainName))
}
