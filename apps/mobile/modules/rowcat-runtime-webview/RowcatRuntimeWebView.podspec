Pod::Spec.new do |s|
  s.name           = 'RowcatRuntimeWebView'
  s.version        = '0.0.0'
  s.summary        = 'Trusted creator runtime assets and the Android bridge.'
  s.description    = 'iOS has no transport: all this pod does on iOS is place the harness HTML and QuickJS WASM in the app bundle and report that directory.'
  s.license        = 'AGPL-3.0-only'
  s.author         = 'RowCat'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = "ios/**/*.{h,m,swift}"

  # The harness HTML and QuickJS WASM. They must stand under `runtime/` inside the bundle as they
  # are, because the harness fetches the WASM by a path relative to its own document.
  s.resource_bundles = { 'RowcatRuntimeAssets' => ['assets/runtime'] }

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
