Pod::Spec.new do |s|
  s.name           = 'AfterstateMemory'
  s.version        = '0.0.0'
  s.summary        = 'The embedded afterstate engine behind the conversation memory port.'
  s.description    = 'Links the afterstate-ffi static library (XCFramework, device + simulator) and exposes its JSON bridge to JS, off the main thread.'
  s.license        = 'AGPL-3.0-only'
  s.author         = 'RowCat'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = "ios/**/*.{h,m,swift}"
  # Built by scripts/prepare-afterstate.sh (afterstate scripts/build-mobile.sh ios).
  s.vendored_frameworks = 'vendor/AfterstateFFI.xcframework'
  # The engine's bundled SQLite and Rust std need nothing else; dead code is stripped at link.
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
