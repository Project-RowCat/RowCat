import AfterstateFFI
import ExpoModulesCore

/// The afterstate engine's JSON bridge, exposed to JS.
///
/// Every call runs on a private concurrent utility queue, never the main thread: an `ingest` does
/// disk I/O. Handles are the library's registry keys (a closed handle answers "closed", it is never
/// dereferenced). Strings cross as UTF-8 and are freed with `afterstate_string_free`.
///
/// Storage: `Application Support/afterstate/`, excluded from iCloud/iTunes backup (the index is
/// derived and rebuilt from RowCat's records; a backup would only add another plaintext copy) and
/// protected `completeUntilFirstUserAuthentication` (background indexing can run after the first
/// unlock, never before). One file per member (the library derives its name from the member id).
public class AfterstateMemoryModule: Module {
  private let queue = DispatchQueue(
    label: "com.projectrowcat.afterstate", qos: .utility, attributes: .concurrent)

  public func definition() -> ModuleDefinition {
    Name("AfterstateMemory")

    Constant("protocol") { String(cString: afterstate_protocol()) }

    AsyncFunction("open") { (user: String) -> Double in
      let dir = try Self.storeDirectory()
      let config: [String: Any] = [
        "store": ["user": ["dir": dir.path, "user": user]],
        "read_connections": 1,
      ]
      let json = String(
        data: try JSONSerialization.data(withJSONObject: config), encoding: .utf8) ?? "{}"
      var handle: UInt64 = 0
      var error: UnsafeMutablePointer<CChar>? = nil
      let status = afterstate_open(json, &handle, &error)
      defer { if let error { afterstate_string_free(error) } }
      guard status == AFTERSTATE_OK else {
        let message = error.map { String(cString: $0) } ?? "status \(status)"
        throw Exception(name: "AfterstateOpenFailed", description: message)
      }
      return Double(handle)
    }.runOnQueue(queue)

    AsyncFunction("call") { (handle: Double, request: String) -> String in
      guard let out = afterstate_call(UInt64(handle), request) else {
        throw Exception(name: "AfterstateOutOfMemory", description: "no response")
      }
      defer { afterstate_string_free(out) }
      return String(cString: out)
    }.runOnQueue(queue)

    AsyncFunction("cancel") { (handle: Double, requestId: Double) -> Int32 in
      afterstate_cancel(UInt64(handle), UInt64(requestId))
    }.runOnQueue(queue)

    AsyncFunction("close") { (handle: Double) -> Int32 in
      afterstate_close(UInt64(handle))
    }.runOnQueue(queue)

    /// Closes the handle and deletes the member's store files (account deletion, local reset).
    AsyncFunction("destroy") { (handle: Double) -> Int32 in
      afterstate_destroy(UInt64(handle), 5_000)
    }.runOnQueue(queue)
  }

  static func storeDirectory() throws -> URL {
    var dir = try FileManager.default.url(
      for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true
    ).appendingPathComponent("afterstate", isDirectory: true)
    try FileManager.default.createDirectory(
      at: dir, withIntermediateDirectories: true,
      attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try dir.setResourceValues(values)
    return dir
  }
}
