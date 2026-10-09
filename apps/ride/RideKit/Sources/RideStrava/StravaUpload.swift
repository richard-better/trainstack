import Foundation

/// A ride Strava has made an activity of.
public struct StravaUpload: Equatable, Sendable {
  public var activityID: Int

  public var url: URL { URL(string: "https://www.strava.com/activities/\(activityID)")! }
}

/// A `multipart/form-data` body.
struct MultipartForm {
  let boundary = "Boundary-\(UUID().uuidString)"
  private var body = Data()

  var contentType: String { "multipart/form-data; boundary=\(boundary)" }

  mutating func addField(_ name: String, _ value: String) {
    body.append(
      Data(
        "--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"\r\n\r\n\(value)\r\n".utf8
      ))
  }

  mutating func addFile(_ name: String, fileName: String, data: Data) {
    body.append(
      Data(
        "--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"; filename=\"\(fileName)\"\r\nContent-Type: application/octet-stream\r\n\r\n"
          .utf8))
    body.append(data)
    body.append(Data("\r\n".utf8))
  }

  var data: Data { body + Data("--\(boundary)--\r\n".utf8) }
}
