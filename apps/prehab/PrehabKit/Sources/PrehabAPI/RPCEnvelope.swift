import Foundation

struct RPCEnvelope<Value: Decodable>: Decodable { let json: Value }
